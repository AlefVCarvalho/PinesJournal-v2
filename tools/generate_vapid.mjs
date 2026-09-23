import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const secretsPath = args.get("--secrets");
const devVarsPath = args.get("--dev-vars");
if (!secretsPath || !devVarsPath) {
  console.error("Uso: node tools/generate_vapid.mjs --secrets arquivo.json --dev-vars .dev.vars");
  process.exit(2);
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });

const rawPublic = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(publicJwk.x, "base64url"),
  Buffer.from(publicJwk.y, "base64url"),
]);
const vapidPublicKey = rawPublic.toString("base64url");
const vapidPrivateKey = privateJwk.d;

writeFileSync(
  secretsPath,
  JSON.stringify({
    VAPID_PUBLIC_KEY: vapidPublicKey,
    VAPID_PRIVATE_KEY: vapidPrivateKey,
  }),
  { encoding: "utf8", mode: 0o600 },
);

writeFileSync(
  devVarsPath,
  `VAPID_PUBLIC_KEY="${vapidPublicKey}"\nVAPID_PRIVATE_KEY="${vapidPrivateKey}"\n`,
  { encoding: "utf8", mode: 0o600 },
);

console.log("Chaves VAPID geradas.");
