from datetime import datetime, timezone
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def to_python(value):
    """Converte valores vindos da FFI do Workers para objetos Python."""
    if hasattr(value, "to_py"):
        return value.to_py()
    return value


async def run(db, sql: str, *params):
    statement = db.prepare(sql)
    if params:
        statement = statement.bind(*params)
    return await statement.run()


async def rows(db, sql: str, *params) -> list[dict]:
    result = await run(db, sql, *params)
    data = to_python(result.results)
    return list(data or [])


async def first(db, sql: str, *params):
    statement = db.prepare(sql)
    if params:
        statement = statement.bind(*params)
    value = await statement.first()
    return to_python(value)


async def list_tags(db) -> list[dict]:
    return await rows(
        db,
        """
        SELECT id, name, color, created_at, updated_at
        FROM tags
        ORDER BY name COLLATE NOCASE ASC
        """,
    )


async def list_tasks(db) -> list[dict]:
    tasks = await rows(
        db,
        """
        SELECT id, title, description, due_date, completed, completed_at, created_at, updated_at
        FROM tasks
        ORDER BY completed ASC,
                 CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC,
                 due_date ASC,
                 created_at DESC
        """,
    )

    if not tasks:
        return []

    tag_rows = await rows(
        db,
        """
        SELECT tt.task_id, t.id, t.name, t.color
        FROM task_tags tt
        JOIN tags t ON t.id = tt.tag_id
        ORDER BY t.name COLLATE NOCASE ASC
        """,
    )
    tags_by_task: dict[str, list[dict]] = {}
    for tag in tag_rows:
        task_id = tag.pop("task_id")
        tags_by_task.setdefault(task_id, []).append(tag)

    for task in tasks:
        task["completed"] = bool(task["completed"])
        task["tags"] = tags_by_task.get(task["id"], [])
    return tasks


async def get_task(db, task_id: str):
    task = await first(
        db,
        """
        SELECT id, title, description, due_date, completed, completed_at, created_at, updated_at
        FROM tasks
        WHERE id = ?
        LIMIT 1
        """,
        task_id,
    )
    if not task:
        return None

    task["completed"] = bool(task["completed"])
    task["tags"] = await rows(
        db,
        """
        SELECT t.id, t.name, t.color
        FROM task_tags tt
        JOIN tags t ON t.id = tt.tag_id
        WHERE tt.task_id = ?
        ORDER BY t.name COLLATE NOCASE ASC
        """,
        task_id,
    )
    return task


async def _replace_task_tags(db, task_id: str, tag_ids: list[str]):
    await run(db, "DELETE FROM task_tags WHERE task_id = ?", task_id)
    for tag_id in tag_ids:
        await run(
            db,
            "INSERT OR IGNORE INTO task_tags(task_id, tag_id) VALUES(?, ?)",
            task_id,
            tag_id,
        )


async def create_task(db, payload):
    task_id = str(uuid4())
    now = utc_now()
    due_date = payload.due_date.isoformat() if payload.due_date else None
    await run(
        db,
        """
        INSERT INTO tasks(id, title, description, due_date, completed, completed_at, created_at, updated_at)
        VALUES(?, ?, ?, ?, 0, NULL, ?, ?)
        """,
        task_id,
        payload.title,
        payload.description,
        due_date,
        now,
        now,
    )
    await _replace_task_tags(db, task_id, payload.tag_ids)
    return await get_task(db, task_id)


async def update_task(db, task_id: str, payload):
    now = utc_now()
    due_date = payload.due_date.isoformat() if payload.due_date else None
    result = await run(
        db,
        """
        UPDATE tasks
        SET title = ?, description = ?, due_date = ?, updated_at = ?
        WHERE id = ?
        """,
        payload.title,
        payload.description,
        due_date,
        now,
        task_id,
    )
    meta = to_python(result.meta)
    if not meta or int(meta.get("changes", 0)) == 0:
        return None
    await _replace_task_tags(db, task_id, payload.tag_ids)
    return await get_task(db, task_id)


async def set_completed(db, task_id: str, completed: bool):
    now = utc_now()
    completed_at = now if completed else None
    result = await run(
        db,
        """
        UPDATE tasks
        SET completed = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
        """,
        1 if completed else 0,
        completed_at,
        now,
        task_id,
    )
    meta = to_python(result.meta)
    if not meta or int(meta.get("changes", 0)) == 0:
        return None
    return await get_task(db, task_id)


async def delete_task(db, task_id: str) -> bool:
    result = await run(db, "DELETE FROM tasks WHERE id = ?", task_id)
    meta = to_python(result.meta)
    return bool(meta and int(meta.get("changes", 0)) > 0)


async def create_tag(db, payload):
    tag_id = str(uuid4())
    now = utc_now()
    await run(
        db,
        """
        INSERT INTO tags(id, name, color, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?)
        """,
        tag_id,
        payload.name,
        payload.color,
        now,
        now,
    )
    return await first(
        db,
        "SELECT id, name, color, created_at, updated_at FROM tags WHERE id = ?",
        tag_id,
    )


async def delete_tag(db, tag_id: str) -> bool:
    result = await run(db, "DELETE FROM tags WHERE id = ?", tag_id)
    meta = to_python(result.meta)
    return bool(meta and int(meta.get("changes", 0)) > 0)


async def database_health(db) -> bool:
    result = await first(db, "SELECT 1 AS ok")
    return bool(result and int(result.get("ok", 0)) == 1)


async def database_stats(db) -> dict:
    result = await first(
        db,
        """
        SELECT
            (SELECT COUNT(*) FROM tasks) AS tasks,
            (SELECT COUNT(*) FROM tasks WHERE completed = 0) AS pending_tasks,
            (SELECT COUNT(*) FROM tasks WHERE completed = 1) AS completed_tasks,
            (SELECT COUNT(*) FROM tags) AS tags,
            (SELECT COUNT(*) FROM task_tags) AS task_tag_links,
            (SELECT COUNT(*) FROM push_subscriptions) AS push_subscriptions
        """,
    )
    return result or {
        "tasks": 0,
        "pending_tasks": 0,
        "completed_tasks": 0,
        "tags": 0,
        "task_tag_links": 0,
        "push_subscriptions": 0,
    }


async def upsert_push_subscription(db, payload, user_agent: str = ""):
    now = utc_now()
    notify_hour, notify_minute = (int(part) for part in payload.notify_time.split(":", 1))
    existing = await first(
        db,
        "SELECT id, created_at FROM push_subscriptions WHERE endpoint = ? LIMIT 1",
        payload.endpoint,
    )
    subscription_id = existing["id"] if existing else str(uuid4())
    created_at = existing["created_at"] if existing else now

    await run(
        db,
        """
        INSERT INTO push_subscriptions(
            id, endpoint, p256dh, auth, timezone, utc_offset_minutes,
            notify_hour, notify_minute, enabled, user_agent, created_at, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            timezone = excluded.timezone,
            utc_offset_minutes = excluded.utc_offset_minutes,
            notify_hour = excluded.notify_hour,
            notify_minute = excluded.notify_minute,
            enabled = 1,
            user_agent = excluded.user_agent,
            updated_at = excluded.updated_at
        """,
        subscription_id,
        payload.endpoint,
        payload.keys.p256dh,
        payload.keys.auth,
        payload.timezone,
        payload.utc_offset_minutes,
        notify_hour,
        notify_minute,
        user_agent[:500],
        created_at,
        now,
    )
    return await get_push_subscription(db, payload.endpoint)


async def get_push_subscription(db, endpoint: str):
    row = await first(
        db,
        """
        SELECT id, endpoint, timezone, utc_offset_minutes, notify_hour, notify_minute,
               enabled, user_agent, created_at, updated_at
        FROM push_subscriptions
        WHERE endpoint = ?
        LIMIT 1
        """,
        endpoint,
    )
    if not row:
        return None
    row["enabled"] = bool(row["enabled"])
    row["notify_time"] = f"{int(row['notify_hour']):02d}:{int(row['notify_minute']):02d}"
    return row


async def get_push_subscription_for_delivery(db, endpoint: str):
    row = await first(
        db,
        """
        SELECT id, endpoint, p256dh, auth, timezone, utc_offset_minutes,
               notify_hour, notify_minute, enabled, user_agent, created_at, updated_at
        FROM push_subscriptions
        WHERE endpoint = ?
        LIMIT 1
        """,
        endpoint,
    )
    if row:
        row["enabled"] = bool(row["enabled"])
    return row


async def list_enabled_push_subscriptions(db) -> list[dict]:
    data = await rows(
        db,
        """
        SELECT id, endpoint, p256dh, auth, timezone, utc_offset_minutes,
               notify_hour, notify_minute, enabled, user_agent, created_at, updated_at
        FROM push_subscriptions
        WHERE enabled = 1
        ORDER BY created_at ASC
        """,
    )
    for row in data:
        row["enabled"] = bool(row["enabled"])
    return data


async def update_push_preferences(db, payload):
    now = utc_now()
    notify_hour, notify_minute = (int(part) for part in payload.notify_time.split(":", 1))
    result = await run(
        db,
        """
        UPDATE push_subscriptions
        SET timezone = ?, utc_offset_minutes = ?, notify_hour = ?, notify_minute = ?, updated_at = ?
        WHERE endpoint = ?
        """,
        payload.timezone,
        payload.utc_offset_minutes,
        notify_hour,
        notify_minute,
        now,
        payload.endpoint,
    )
    meta = to_python(result.meta)
    if not meta or int(meta.get("changes", 0)) == 0:
        return None
    return await get_push_subscription(db, payload.endpoint)


async def delete_push_subscription(db, endpoint: str) -> bool:
    result = await run(db, "DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint)
    meta = to_python(result.meta)
    return bool(meta and int(meta.get("changes", 0)) > 0)


async def notification_delivery_exists(db, subscription_id: str, local_date: str, kind: str) -> bool:
    row = await first(
        db,
        """
        SELECT 1 AS found
        FROM notification_deliveries
        WHERE subscription_id = ? AND local_date = ? AND kind = ?
        LIMIT 1
        """,
        subscription_id,
        local_date,
        kind,
    )
    return bool(row)


async def record_notification_delivery(db, subscription_id: str, local_date: str, kind: str):
    await run(
        db,
        """
        INSERT OR IGNORE INTO notification_deliveries(subscription_id, local_date, kind, created_at)
        VALUES(?, ?, ?, ?)
        """,
        subscription_id,
        local_date,
        kind,
        utc_now(),
    )


async def notification_task_summary(db, local_date: str) -> dict:
    counts = await first(
        db,
        """
        SELECT
            COUNT(*) AS pending_count,
            SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) AS due_today_count,
            SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue_count
        FROM tasks
        WHERE completed = 0
        """,
        local_date,
        local_date,
    ) or {}

    due_titles = await rows(
        db,
        """
        SELECT title
        FROM tasks
        WHERE completed = 0 AND due_date = ?
        ORDER BY created_at ASC
        LIMIT 3
        """,
        local_date,
    )
    overdue_titles = await rows(
        db,
        """
        SELECT title
        FROM tasks
        WHERE completed = 0 AND due_date IS NOT NULL AND due_date < ?
        ORDER BY due_date ASC, created_at ASC
        LIMIT 3
        """,
        local_date,
    )

    return {
        "pending_count": int(counts.get("pending_count") or 0),
        "due_today_count": int(counts.get("due_today_count") or 0),
        "overdue_count": int(counts.get("overdue_count") or 0),
        "due_titles": [row["title"] for row in due_titles],
        "overdue_titles": [row["title"] for row in overdue_titles],
    }
