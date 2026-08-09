PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staff_media_folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES staff_media_folders(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_media_folder_name_active
  ON staff_media_folders(COALESCE(parent_id, ''), normalized_name)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS staff_media_assets (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES staff_media_folders(id),
  object_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS staff_media_assets_active
  ON staff_media_assets(status, folder_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS staff_media_asset_name_active
  ON staff_media_assets(COALESCE(folder_id, ''), normalized_name)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS staff_media_events (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES staff_media_assets(id),
  folder_id TEXT REFERENCES staff_media_folders(id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS staff_media_events_recent
  ON staff_media_events(occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS staff_media_events_no_update
BEFORE UPDATE ON staff_media_events
BEGIN
  SELECT RAISE(ABORT, 'staff_media_events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS staff_media_events_no_delete
BEFORE DELETE ON staff_media_events
BEGIN
  SELECT RAISE(ABORT, 'staff_media_events are append-only');
END;
