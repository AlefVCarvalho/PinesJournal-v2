"""Envio Web Push sem servico externo, usando Web Crypto do runtime Workers.

Implementa o perfil aes128gcm (RFC 8291/RFC 8188) e autenticacao VAPID
(RFC 8292). As chaves VAPID ficam em Worker Secrets.
"""

from __future__ import annotations

import base64
import json
import time
from urllib.parse import urlsplit

from js import Object, crypto, fetch
from pyodide.ffi import to_js as _to_js


MAX_PAYLOAD_BYTES = 3000
RECORD_SIZE = 4096


def to_js(value):
    return _to_js(value, dict_converter=Object.fromEntries)


def b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _buffer_bytes(value) -> bytes:
    converted = value.to_py()
    if hasattr(converted, "tobytes"):
        return converted.tobytes()
    return bytes(converted)


async def _hmac_sha256(key_bytes: bytes, data: bytes) -> bytes:
    key = await crypto.subtle.importKey(
        "raw",
        to_js(key_bytes),
        to_js({"name": "HMAC", "hash": "SHA-256"}),
        False,
        ["sign"],
    )
    signature = await crypto.subtle.sign("HMAC", key, to_js(data))
    return _buffer_bytes(signature)


async def _encrypt_payload(payload: bytes, p256dh: str, auth: str) -> bytes:
    if len(payload) > MAX_PAYLOAD_BYTES:
        raise ValueError("Payload de notificacao grande demais para Web Push.")

    ua_public = b64url_decode(p256dh)
    auth_secret = b64url_decode(auth)
    if len(ua_public) != 65 or ua_public[0] != 0x04:
        raise ValueError("Chave p256dh invalida.")
    if len(auth_secret) < 16:
        raise ValueError("Segredo auth invalido.")

    server_pair = await crypto.subtle.generateKey(
        to_js({"name": "ECDH", "namedCurve": "P-256"}),
        True,
        ["deriveBits"],
    )
    server_public_buffer = await crypto.subtle.exportKey("raw", server_pair.publicKey)
    server_public = _buffer_bytes(server_public_buffer)

    ua_key = await crypto.subtle.importKey(
        "raw",
        to_js(ua_public),
        to_js({"name": "ECDH", "namedCurve": "P-256"}),
        False,
        [],
    )
    shared_buffer = await crypto.subtle.deriveBits(
        to_js({"name": "ECDH", "public": ua_key}),
        server_pair.privateKey,
        256,
    )
    shared_secret = _buffer_bytes(shared_buffer)

    # RFC 8291 sec. 3.4.
    prk_key = await _hmac_sha256(auth_secret, shared_secret)
    key_info = b"WebPush: info\x00" + ua_public + server_public
    ikm = await _hmac_sha256(prk_key, key_info + b"\x01")

    salt_buffer = crypto.getRandomValues(to_js(bytearray(16)))
    salt = _buffer_bytes(salt_buffer)
    prk = await _hmac_sha256(salt, ikm)
    cek = (await _hmac_sha256(prk, b"Content-Encoding: aes128gcm\x00\x01"))[:16]
    nonce = (await _hmac_sha256(prk, b"Content-Encoding: nonce\x00\x01"))[:12]

    aes_key = await crypto.subtle.importKey(
        "raw",
        to_js(cek),
        "AES-GCM",
        False,
        ["encrypt"],
    )
    plaintext = payload + b"\x02"
    encrypted_buffer = await crypto.subtle.encrypt(
        to_js({"name": "AES-GCM", "iv": to_js(nonce), "tagLength": 128}),
        aes_key,
        to_js(plaintext),
    )
    encrypted = _buffer_bytes(encrypted_buffer)

    # RFC 8188 aes128gcm header: salt | rs | idlen | keyid.
    return (
        salt
        + RECORD_SIZE.to_bytes(4, "big")
        + bytes([len(server_public)])
        + server_public
        + encrypted
    )


def _audience(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Endpoint Web Push invalido.")
    return f"{parsed.scheme}://{parsed.netloc}"


async def _vapid_token(endpoint: str, public_key: str, private_key: str, subject: str) -> str:
    raw_public = b64url_decode(public_key)
    if len(raw_public) != 65 or raw_public[0] != 0x04:
        raise ValueError("VAPID_PUBLIC_KEY invalida.")
    private_bytes = b64url_decode(private_key)
    if len(private_bytes) != 32:
        raise ValueError("VAPID_PRIVATE_KEY invalida.")

    jwk = {
        "kty": "EC",
        "crv": "P-256",
        "x": b64url_encode(raw_public[1:33]),
        "y": b64url_encode(raw_public[33:65]),
        "d": b64url_encode(private_bytes),
        "ext": True,
    }
    signing_key = await crypto.subtle.importKey(
        "jwk",
        to_js(jwk),
        to_js({"name": "ECDSA", "namedCurve": "P-256"}),
        False,
        ["sign"],
    )

    header = {"typ": "JWT", "alg": "ES256"}
    claims = {
        "aud": _audience(endpoint),
        "exp": int(time.time()) + 12 * 60 * 60,
        "sub": subject,
    }
    encoded_header = b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    encoded_claims = b64url_encode(json.dumps(claims, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{encoded_header}.{encoded_claims}"

    signature_buffer = await crypto.subtle.sign(
        to_js({"name": "ECDSA", "hash": "SHA-256"}),
        signing_key,
        to_js(signing_input.encode("ascii")),
    )
    signature = _buffer_bytes(signature_buffer)
    if len(signature) != 64:
        raise ValueError("Assinatura VAPID inesperada.")
    return f"{signing_input}.{b64url_encode(signature)}"


def configured(env) -> bool:
    return bool(
        getattr(env, "VAPID_PUBLIC_KEY", None)
        and getattr(env, "VAPID_PRIVATE_KEY", None)
        and getattr(env, "VAPID_SUBJECT", None)
    )


async def send(env, subscription: dict, payload: dict, ttl: int = 86400) -> int:
    public_key = getattr(env, "VAPID_PUBLIC_KEY", None)
    private_key = getattr(env, "VAPID_PRIVATE_KEY", None)
    subject = getattr(env, "VAPID_SUBJECT", None)
    if not public_key or not private_key or not subject:
        raise RuntimeError("As chaves VAPID ainda nao foram configuradas no Worker.")

    body_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encrypted_body = await _encrypt_payload(body_json, subscription["p256dh"], subscription["auth"])
    token = await _vapid_token(subscription["endpoint"], public_key, private_key, subject)

    response = await fetch(
        subscription["endpoint"],
        to_js(
            {
                "method": "POST",
                "headers": {
                    "Authorization": f"vapid t={token}, k={public_key}",
                    "Content-Encoding": "aes128gcm",
                    "Content-Type": "application/octet-stream",
                    "TTL": str(max(0, min(int(ttl), 2419200))),
                    "Urgency": "normal",
                },
                "body": encrypted_body,
            }
        ),
    )
    return int(response.status)
