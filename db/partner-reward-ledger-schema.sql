-- Manual partner-reward source of truth. No sender, payout job, or provider write.
CREATE TABLE IF NOT EXISTS partner_reward_events (
  id TEXT PRIMARY KEY,
  reward_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('attributed','qualifying_purchase','chargeback_hold','payable','paid','expired','refunded','disputed','voided','correction')),
  detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_partner_reward_events_reward ON partner_reward_events(reward_id, ts);
CREATE TRIGGER IF NOT EXISTS partner_reward_events_no_update BEFORE UPDATE ON partner_reward_events BEGIN SELECT RAISE(ABORT, 'partner reward events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS partner_reward_events_no_delete BEFORE DELETE ON partner_reward_events BEGIN SELECT RAISE(ABORT, 'partner reward events are append-only'); END;
