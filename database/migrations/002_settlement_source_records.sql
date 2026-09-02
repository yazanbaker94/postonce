CREATE TABLE settlement_source_records (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  source_system text NOT NULL CHECK (source_system IN ('NORTHSTAR_PROCESSOR', 'PRAIRIE_BANK')),
  component text NOT NULL CHECK (component IN ('PROCESSOR_FEE', 'BANK_DEPOSIT')),
  external_event_id text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  received_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, source_system, external_event_id),
  UNIQUE (session_id, component),
  CHECK (
    (component = 'PROCESSOR_FEE' AND source_system = 'NORTHSTAR_PROCESSOR') OR
    (component = 'BANK_DEPOSIT' AND source_system = 'PRAIRIE_BANK')
  )
);

CREATE TRIGGER settlement_source_records_append_only
  BEFORE UPDATE OR DELETE ON settlement_source_records
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
