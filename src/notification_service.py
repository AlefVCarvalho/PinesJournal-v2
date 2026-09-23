"""Regras de notificacao do Pine's Journal."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import repository
import webpush


DELIVERY_KIND = "daily-due-summary"
SEND_WINDOW_MINUTES = 1


def _plural(count: int, singular: str, plural: str) -> str:
    return singular if count == 1 else plural


def _daily_body(summary: dict) -> str:
    due = summary["due_today_count"]
    overdue = summary["overdue_count"]

    if due == 1 and overdue == 0 and summary["due_titles"]:
        return f"Vence hoje: {summary['due_titles'][0]}"
    if due == 0 and overdue == 1 and summary["overdue_titles"]:
        return f"Atrasada: {summary['overdue_titles'][0]}"

    parts: list[str] = []
    if due:
        parts.append(f"{due} {_plural(due, 'vence', 'vencem')} hoje")
    if overdue:
        parts.append(f"{overdue} {_plural(overdue, 'atrasada', 'atrasadas')}")
    return " · ".join(parts) + "."


def build_daily_payload(summary: dict, local_date: str) -> dict:
    return {
        "title": "Pine's Journal",
        "body": _daily_body(summary),
        "tag": f"pinesjournal-daily-{local_date}",
        "url": "/",
        "pending_count": summary["pending_count"],
        "icon": "/icons/icon-192.png",
        "badge": "/icons/icon-192.png",
    }


def build_test_payload(pending_count: int) -> dict:
    return {
        "title": "Pine's Journal",
        "body": "Notificações estão funcionando neste dispositivo.",
        "tag": "pinesjournal-test",
        "url": "/",
        "pending_count": pending_count,
        "icon": "/icons/icon-192.png",
        "badge": "/icons/icon-192.png",
    }


def _local_clock(subscription: dict, now_utc: datetime) -> datetime:
    return now_utc + timedelta(minutes=int(subscription.get("utc_offset_minutes") or 0))


def _inside_send_window(subscription: dict, local_now: datetime) -> bool:
    target = int(subscription["notify_hour"]) * 60 + int(subscription["notify_minute"])
    current = local_now.hour * 60 + local_now.minute
    return target <= current < target + SEND_WINDOW_MINUTES


async def send_test(env, db, endpoint: str) -> dict:
    subscription = await repository.get_push_subscription_for_delivery(db, endpoint)
    if not subscription or not subscription.get("enabled"):
        raise LookupError("Inscrição de notificações não encontrada neste dispositivo.")

    summary = await repository.notification_task_summary(db, datetime.now(timezone.utc).date().isoformat())
    status = await webpush.send(env, subscription, build_test_payload(summary["pending_count"]), ttl=300)
    if status in (404, 410):
        await repository.delete_push_subscription(db, endpoint)
    return {"status": status, "ok": 200 <= status < 300}


async def run_scheduled(env, scheduled_time_ms: int | float | None = None) -> dict:
    db = env.DB
    if not webpush.configured(env):
        return {"configured": False, "checked": 0, "sent": 0, "removed": 0}

    subscriptions = await repository.list_enabled_push_subscriptions(db)
    now_utc = (
        datetime.fromtimestamp(float(scheduled_time_ms) / 1000, tz=timezone.utc)
        if scheduled_time_ms is not None
        else datetime.now(timezone.utc)
    )
    sent = 0
    removed = 0
    checked = 0

    for subscription in subscriptions:
        local_now = _local_clock(subscription, now_utc)
        if not _inside_send_window(subscription, local_now):
            continue

        checked += 1
        local_date = local_now.date().isoformat()
        if await repository.notification_delivery_exists(db, subscription["id"], local_date, DELIVERY_KIND):
            continue

        summary = await repository.notification_task_summary(db, local_date)
        if summary["due_today_count"] == 0 and summary["overdue_count"] == 0:
            continue

        try:
            status = await webpush.send(env, subscription, build_daily_payload(summary, local_date))
        except Exception as exc:
            print(f"Falha ao preparar Web Push para {subscription['id']}: {type(exc).__name__}: {exc}")
            continue

        if 200 <= status < 300:
            await repository.record_notification_delivery(db, subscription["id"], local_date, DELIVERY_KIND)
            sent += 1
        elif status in (404, 410):
            await repository.delete_push_subscription(db, subscription["endpoint"])
            removed += 1
        else:
            print(f"Push service retornou HTTP {status} para {subscription['id']}")

    return {
        "configured": True,
        "checked": checked,
        "sent": sent,
        "removed": removed,
        "subscriptions": len(subscriptions),
    }
