ALTER TABLE purchases ADD COLUMN classification_review_state TEXT NOT NULL DEFAULT 'pending_review'
  CHECK (classification_review_state IN ('pending_review', 'confirmed', 'not_a_package'));
ALTER TABLE purchases ADD COLUMN classification_reviewed_at TEXT;
ALTER TABLE purchases ADD COLUMN classification_reviewed_by TEXT;
