CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE demo_sessions (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL,
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  state_version integer NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  current_chapter smallint NOT NULL DEFAULT 0 CHECK (current_chapter BETWEEN 0 AND 7),
  close_status text NOT NULL CHECK (close_status IN ('PROCESSING', 'BLOCKED', 'READY')),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object')
);

CREATE TABLE rooftops (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  city text NOT NULL,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, code)
);

CREATE TABLE invoices (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  rooftop_id text NOT NULL,
  repair_order_number text NOT NULL,
  customer_label text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  balance_cents bigint NOT NULL CHECK (balance_cents >= 0 AND balance_cents <= amount_cents),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL CHECK (status IN ('OPEN', 'PARTIAL', 'PAID')),
  opened_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, rooftop_id, repair_order_number),
  FOREIGN KEY (session_id, rooftop_id) REFERENCES rooftops(session_id, id) ON DELETE RESTRICT
);

CREATE INDEX invoices_open_reference_idx
  ON invoices (session_id, repair_order_number)
  WHERE status <> 'PAID';

CREATE TABLE payments (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  rooftop_id text NOT NULL,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  customer_label text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  kind text NOT NULL CHECK (kind IN ('CAPTURE', 'REFUND')),
  status text NOT NULL CHECK (status IN ('RECEIVED', 'MATCHED', 'EXCEPTION', 'POSTED', 'REFUNDED')),
  reference text,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, provider, external_event_id),
  FOREIGN KEY (session_id, rooftop_id) REFERENCES rooftops(session_id, id) ON DELETE RESTRICT
);

CREATE INDEX payments_reference_idx ON payments (session_id, reference);

CREATE TABLE processor_inbox (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  delivery_count integer NOT NULL DEFAULT 1 CHECK (delivery_count > 0),
  PRIMARY KEY (session_id, provider, external_event_id)
);

CREATE TABLE payment_allocations (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  payment_id text NOT NULL,
  invoice_id text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  source text NOT NULL CHECK (source IN ('EXACT_REFERENCE', 'HUMAN_RESOLUTION')),
  operation_key text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, operation_key),
  FOREIGN KEY (session_id, payment_id) REFERENCES payments(session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id, invoice_id) REFERENCES invoices(session_id, id) ON DELETE RESTRICT
);

CREATE INDEX payment_allocations_payment_idx ON payment_allocations (session_id, payment_id);
CREATE INDEX payment_allocations_invoice_idx ON payment_allocations (session_id, invoice_id);

CREATE TABLE payment_exceptions (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  payment_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('AMBIGUOUS_ALLOCATION', 'VERSION_CONFLICT')),
  severity text NOT NULL CHECK (severity IN ('BLOCKING', 'REVIEW')),
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  summary text NOT NULL,
  candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates) = 'array'),
  assistant_note text,
  resolution jsonb,
  opened_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, id),
  FOREIGN KEY (session_id, payment_id) REFERENCES payments(session_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'OPEN' AND resolution IS NULL) OR (status = 'RESOLVED' AND resolution IS NOT NULL))
);

CREATE INDEX payment_exceptions_open_idx
  ON payment_exceptions (session_id, severity, opened_at)
  WHERE status = 'OPEN';

CREATE TABLE posting_outbox (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  payment_id text NOT NULL,
  invoice_id text NOT NULL,
  operation_key text NOT NULL,
  destination text NOT NULL CHECK (destination = 'LEGACY_DMS'),
  status text NOT NULL CHECK (status IN ('PENDING', 'DELIVERED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, operation_key),
  FOREIGN KEY (session_id, payment_id) REFERENCES payments(session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id, invoice_id) REFERENCES invoices(session_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'PENDING' AND delivered_at IS NULL) OR (status = 'DELIVERED' AND delivered_at IS NOT NULL))
);

CREATE INDEX posting_outbox_pending_idx
  ON posting_outbox (session_id, created_at)
  WHERE status = 'PENDING';

CREATE TABLE dms_postings (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  operation_key text NOT NULL,
  posting_id text NOT NULL,
  correlation_id text NOT NULL,
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, operation_key),
  UNIQUE (session_id, posting_id)
);

CREATE TABLE integration_attempts (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  system text NOT NULL CHECK (system IN ('NORTHSTAR_PROCESSOR', 'LEGACY_DMS', 'PRAIRIE_BANK')),
  direction text NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  operation text NOT NULL,
  external_event_id text,
  operation_key text NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACCEPTED', 'DUPLICATE', 'COMMITTED', 'RESPONSE_LOST', 'REPLAYED', 'RECONCILED', 'REJECTED')),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  occurred_at timestamptz NOT NULL,
  note text NOT NULL,
  sanitized_request jsonb NOT NULL CHECK (jsonb_typeof(sanitized_request) = 'object'),
  sanitized_response jsonb,
  PRIMARY KEY (session_id, id)
);

CREATE INDEX integration_attempts_correlation_idx
  ON integration_attempts (session_id, correlation_id, occurred_at);
CREATE INDEX integration_attempts_operation_idx
  ON integration_attempts (session_id, operation_key, attempt_number);

CREATE TABLE audit_events (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, sequence)
);

CREATE INDEX audit_events_entity_idx ON audit_events (session_id, entity_type, entity_id, sequence);
CREATE INDEX audit_events_correlation_idx ON audit_events (session_id, correlation_id, sequence);

CREATE TABLE settlements (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gross_cents bigint NOT NULL CHECK (gross_cents >= 0),
  fee_cents bigint NOT NULL CHECK (fee_cents >= 0),
  refund_cents bigint NOT NULL CHECK (refund_cents >= 0),
  expected_deposit_cents bigint NOT NULL,
  bank_deposit_cents bigint NOT NULL CHECK (bank_deposit_cents >= 0),
  variance_cents bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING', 'BLOCKED', 'READY')),
  evaluated_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, id),
  CHECK (expected_deposit_cents = gross_cents - fee_cents - refund_cents),
  CHECK (variance_cents = expected_deposit_cents - bank_deposit_cents),
  CHECK (status <> 'READY' OR variance_cents = 0)
);

CREATE OR REPLACE FUNCTION reject_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('postonce.allow_session_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only; write a new evidence row instead', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE TRIGGER integration_attempts_append_only
  BEFORE UPDATE OR DELETE ON integration_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
