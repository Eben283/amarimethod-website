-- Additive only. Apply after db/staff-media-schema.sql to an existing Staff Media D1 database.
ALTER TABLE staff_media_assets ADD COLUMN internal_description TEXT NOT NULL DEFAULT '';
ALTER TABLE staff_media_assets ADD COLUMN website_usage TEXT NOT NULL DEFAULT 'not_used' CHECK (website_usage IN ('currently_used', 'not_used'));
ALTER TABLE staff_media_assets ADD COLUMN curation_status TEXT NOT NULL DEFAULT 'good' CHECK (curation_status IN ('good', 'delete_candidate'));
ALTER TABLE staff_media_assets ADD COLUMN source_path TEXT;

CREATE INDEX IF NOT EXISTS staff_media_assets_curation
  ON staff_media_assets(website_usage, curation_status, status, updated_at DESC);
