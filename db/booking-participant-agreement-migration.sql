-- Durable clickwrap evidence for Assessment checkout intents.
-- Apply to ATTEND_DB / amari-attendance before deploying the participant-
-- agreement checkout gate. This is deliberately separate because existing
-- environments already have paid_booking_intents from the prior migration.
ALTER TABLE paid_booking_intents ADD COLUMN participant_agreement_version TEXT;
ALTER TABLE paid_booking_intents ADD COLUMN participant_agreement_accepted_at INTEGER;
ALTER TABLE paid_booking_intents ADD COLUMN participant_agreement_ip TEXT;
ALTER TABLE paid_booking_intents ADD COLUMN participant_agreement_user_agent TEXT;
