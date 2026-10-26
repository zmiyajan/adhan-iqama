-- Web Push subscribers. One row per browser/phone; settings is the JSON the page sends.
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  p256dh   TEXT NOT NULL,
  auth     TEXT NOT NULL,
  settings TEXT NOT NULL,
  updated  INTEGER NOT NULL
);
