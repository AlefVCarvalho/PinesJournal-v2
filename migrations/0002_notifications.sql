PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    utc_offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (utc_offset_minutes BETWEEN -840 AND 840),
    notify_hour INTEGER NOT NULL DEFAULT 9 CHECK (notify_hour BETWEEN 0 AND 23),
    notify_minute INTEGER NOT NULL DEFAULT 0 CHECK (notify_minute BETWEEN 0 AND 59),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_enabled
    ON push_subscriptions(enabled);

CREATE TABLE IF NOT EXISTS notification_deliveries (
    subscription_id TEXT NOT NULL,
    local_date TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(subscription_id, local_date, kind),
    FOREIGN KEY(subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_date
    ON notification_deliveries(local_date);
