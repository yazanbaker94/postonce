-- Product workspace expansion. The JSON document remains the fast read model;
-- these tables mirror the operational and financial facts with database-level
-- identity, arithmetic, and append-only guarantees.

ALTER TABLE demo_sessions
  DROP CONSTRAINT demo_sessions_close_status_check;

ALTER TABLE demo_sessions
  ADD CONSTRAINT demo_sessions_close_status_check
  CHECK (close_status IN ('PROCESSING', 'BLOCKED', 'READY', 'CLOSED'));

ALTER TABLE rooftops
  ADD COLUMN timezone text NOT NULL DEFAULT 'America/Edmonton';

ALTER TABLE rooftops
  ADD CONSTRAINT rooftops_timezone_check
  CHECK (timezone = 'America/Edmonton');

ALTER TABLE invoices
  ADD COLUMN department text,
  ADD COLUMN record_type text,
  ADD COLUMN record_number text,
  ADD COLUMN vehicle_label text,
  ADD COLUMN advisor_label text,
  ADD COLUMN business_status text,
  ADD COLUMN closed_at timestamptz;

UPDATE invoices
SET department = 'SERVICE',
    record_type = 'REPAIR_ORDER',
    record_number = repair_order_number,
    business_status = CASE WHEN status = 'PAID' THEN 'CLOSED' ELSE 'OPEN' END,
    closed_at = CASE WHEN status = 'PAID' THEN opened_at ELSE NULL END;

ALTER TABLE invoices
  ALTER COLUMN department SET NOT NULL,
  ALTER COLUMN record_type SET NOT NULL,
  ALTER COLUMN record_number SET NOT NULL,
  ALTER COLUMN business_status SET NOT NULL,
  ADD CONSTRAINT invoices_department_check CHECK (department IN ('SERVICE', 'PARTS', 'SALES')),
  ADD CONSTRAINT invoices_record_type_check CHECK (record_type IN ('REPAIR_ORDER', 'PARTS_TICKET', 'DEAL')),
  ADD CONSTRAINT invoices_business_status_check CHECK (business_status IN ('OPEN', 'CLOSED')),
  ADD CONSTRAINT invoices_record_type_department_check CHECK (
    (record_type = 'REPAIR_ORDER' AND department = 'SERVICE') OR
    (record_type = 'PARTS_TICKET' AND department = 'PARTS') OR
    (record_type = 'DEAL' AND department = 'SALES')
  ),
  ADD CONSTRAINT invoices_closed_timestamp_check CHECK (
    business_status = 'OPEN' OR closed_at IS NOT NULL
  );

CREATE UNIQUE INDEX invoices_record_number_key
  ON invoices (session_id, rooftop_id, record_number);

ALTER TABLE payments
  ADD COLUMN business_date date,
  ADD COLUMN department text,
  ADD COLUMN processor_transaction_id text,
  ADD COLUMN method_type text,
  ADD COLUMN card_last4 char(4),
  ADD COLUMN terminal_label text,
  ADD COLUMN payment_state text,
  ADD COLUMN dms_state text,
  ADD COLUMN settlement_state text,
  ADD COLUMN source_reference text,
  ADD COLUMN linked_record_id text,
  ADD COLUMN matched_at timestamptz,
  ADD COLUMN posted_at timestamptz,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN posting_operation_key text,
  ADD COLUMN in_friday_close boolean;

UPDATE payments
SET business_date = (received_at AT TIME ZONE 'America/Edmonton')::date,
    department = 'SERVICE',
    processor_transaction_id = 'legacy_' || id,
    method_type = 'VISA',
    card_last4 = '0000',
    terminal_label = 'Legacy import',
    payment_state = CASE WHEN kind = 'REFUND' OR status = 'REFUNDED' THEN 'REFUNDED' ELSE 'CAPTURED' END,
    dms_state = CASE
      WHEN status = 'POSTED' OR status = 'REFUNDED' THEN 'VERIFIED'
      WHEN status = 'MATCHED' THEN 'MATCHED'
      WHEN status = 'EXCEPTION' THEN 'NEEDS_REVIEW'
      ELSE 'UNMATCHED'
    END,
    settlement_state = 'PAYOUT_PENDING',
    source_reference = reference,
    in_friday_close = true;

ALTER TABLE payments
  ALTER COLUMN business_date SET NOT NULL,
  ALTER COLUMN department SET NOT NULL,
  ALTER COLUMN processor_transaction_id SET NOT NULL,
  ALTER COLUMN method_type SET NOT NULL,
  ALTER COLUMN card_last4 SET NOT NULL,
  ALTER COLUMN terminal_label SET NOT NULL,
  ALTER COLUMN payment_state SET NOT NULL,
  ALTER COLUMN dms_state SET NOT NULL,
  ALTER COLUMN settlement_state SET NOT NULL,
  ALTER COLUMN in_friday_close SET NOT NULL,
  ADD CONSTRAINT payments_department_check CHECK (department IN ('SERVICE', 'PARTS', 'SALES')),
  ADD CONSTRAINT payments_method_type_check CHECK (method_type IN ('VISA', 'MASTERCARD', 'AMEX', 'DEBIT')),
  ADD CONSTRAINT payments_card_last4_check CHECK (card_last4 ~ '^[0-9]{4}$'),
  ADD CONSTRAINT payments_payment_state_check CHECK (payment_state IN ('CAPTURED', 'PENDING', 'FAILED', 'VOIDED', 'REFUNDED')),
  ADD CONSTRAINT payments_dms_state_check CHECK (dms_state IN ('UNMATCHED', 'MATCHED', 'POSTING', 'VERIFIED', 'NEEDS_REVIEW')),
  ADD CONSTRAINT payments_settlement_state_check CHECK (settlement_state IN ('NOT_YET_BATCHED', 'PAYOUT_PENDING', 'DEPOSIT_EXPECTED', 'RECONCILED', 'VARIANCE')),
  ADD CONSTRAINT payments_linked_record_fk FOREIGN KEY (session_id, linked_record_id)
    REFERENCES invoices(session_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX payments_processor_transaction_key
  ON payments (session_id, processor_transaction_id);

CREATE INDEX payments_business_date_idx
  ON payments (session_id, business_date, rooftop_id, department);

ALTER TABLE payment_exceptions
  DROP CONSTRAINT payment_exceptions_type_check;

UPDATE payment_exceptions
SET type = CASE
  WHEN type = 'AMBIGUOUS_ALLOCATION' THEN 'AMBIGUOUS_MATCH'
  WHEN type = 'VERSION_CONFLICT' THEN 'POSTING_STATUS_UNKNOWN'
  ELSE type
END;

ALTER TABLE payment_exceptions
  ADD COLUMN rooftop_id text,
  ADD COLUMN department text,
  ADD COLUMN suggested_candidate_id text,
  ADD COLUMN suggestion text,
  ADD COLUMN resolved_by text,
  ADD COLUMN resolved_at timestamptz;

UPDATE payment_exceptions AS exception
SET rooftop_id = payment.rooftop_id,
    department = payment.department,
    suggestion = exception.assistant_note,
    resolved_by = CASE
      WHEN exception.status = 'RESOLVED'
      THEN COALESCE(exception.resolution ->> 'actor', exception.resolution ->> 'selectedBy', 'Legacy operator')
      ELSE NULL
    END,
    resolved_at = CASE
      WHEN exception.status = 'RESOLVED' AND exception.resolution ? 'resolvedAt'
      THEN (exception.resolution ->> 'resolvedAt')::timestamptz
      WHEN exception.status = 'RESOLVED' THEN exception.opened_at
      ELSE NULL
    END
FROM payments AS payment
WHERE payment.session_id = exception.session_id
  AND payment.id = exception.payment_id;

ALTER TABLE payment_exceptions
  ALTER COLUMN rooftop_id SET NOT NULL,
  ALTER COLUMN department SET NOT NULL,
  ADD CONSTRAINT payment_exceptions_type_check CHECK (type IN (
    'UNMATCHED_PAYMENT',
    'AMBIGUOUS_MATCH',
    'SPLIT_ALLOCATION',
    'UNMATCHED_REFUND',
    'POSTING_STATUS_UNKNOWN'
  )),
  ADD CONSTRAINT payment_exceptions_department_check CHECK (department IN ('SERVICE', 'PARTS', 'SALES')),
  ADD CONSTRAINT payment_exceptions_rooftop_fk FOREIGN KEY (session_id, rooftop_id)
    REFERENCES rooftops(session_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT payment_exceptions_resolution_metadata_check CHECK (
    (status = 'OPEN' AND resolved_by IS NULL AND resolved_at IS NULL) OR
    (status = 'RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  );

ALTER TABLE posting_outbox
  ADD COLUMN mutation_kind text NOT NULL DEFAULT 'PAYMENT_POST';

ALTER TABLE posting_outbox
  ADD CONSTRAINT posting_outbox_mutation_kind_check
  CHECK (mutation_kind IN ('PAYMENT_POST', 'REFUND_LINK'));

DROP TRIGGER integration_attempts_append_only ON integration_attempts;

ALTER TABLE integration_attempts
  DROP CONSTRAINT integration_attempts_status_check;

UPDATE integration_attempts SET status = 'FOUND_EXISTING' WHERE status = 'REPLAYED';

ALTER TABLE integration_attempts
  ADD CONSTRAINT integration_attempts_status_check CHECK (status IN (
    'ACCEPTED', 'DUPLICATE', 'COMMITTED', 'RESPONSE_LOST',
    'FOUND_EXISTING', 'RECONCILED', 'REJECTED'
  ));

CREATE TRIGGER integration_attempts_append_only
  BEFORE UPDATE OR DELETE ON integration_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

ALTER TABLE dms_postings
  ADD COLUMN payment_id text,
  ADD COLUMN invoice_id text,
  ADD COLUMN mutation_kind text;

ALTER TABLE dms_postings
  ADD CONSTRAINT dms_postings_mutation_kind_check
  CHECK (mutation_kind IS NULL OR mutation_kind IN ('PAYMENT_POST', 'REFUND_LINK'));

CREATE TABLE operational_closes (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  rooftop_id text NOT NULL,
  business_date date NOT NULL,
  payment_count integer NOT NULL CHECK (payment_count >= 0),
  verified_posting_count integer NOT NULL CHECK (verified_posting_count >= 0 AND verified_posting_count <= payment_count),
  blocking_exception_count integer NOT NULL CHECK (blocking_exception_count >= 0),
  settlement_status text NOT NULL CHECK (settlement_status IN ('NOT_YET_BATCHED', 'PAYOUT_PENDING', 'DEPOSIT_EXPECTED', 'RECONCILED', 'VARIANCE')),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'BLOCKED', 'READY', 'CLOSED')),
  version integer NOT NULL CHECK (version > 0),
  closed_by text,
  closed_at timestamptz,
  attestation jsonb,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, rooftop_id, business_date),
  FOREIGN KEY (session_id, rooftop_id) REFERENCES rooftops(session_id, id) ON DELETE RESTRICT,
  CHECK (attestation IS NULL OR jsonb_typeof(attestation) = 'object'),
  CHECK (
    (status = 'CLOSED' AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND attestation IS NOT NULL) OR
    (status <> 'CLOSED' AND closed_by IS NULL AND closed_at IS NULL AND attestation IS NULL)
  ),
  CHECK (status NOT IN ('READY', 'CLOSED') OR (blocking_exception_count = 0 AND verified_posting_count = payment_count))
);

CREATE INDEX operational_closes_business_date_idx
  ON operational_closes (session_id, business_date, status);

CREATE OR REPLACE FUNCTION protect_operational_close_attestation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('postonce.allow_session_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'operational_closes is immutable after creation; reset the owning workspace instead';
  END IF;
  IF OLD.status = 'CLOSED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'closed operational attestation % is immutable', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operational_closes_immutable_after_close
  BEFORE UPDATE OR DELETE ON operational_closes
  FOR EACH ROW EXECUTE FUNCTION protect_operational_close_attestation();

CREATE TABLE processor_payouts (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  rooftop_id text NOT NULL,
  payout_date date NOT NULL,
  external_payout_id text,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  captured_cents bigint CHECK (captured_cents IS NULL OR captured_cents >= 0),
  refund_cents bigint CHECK (refund_cents IS NULL OR refund_cents >= 0),
  fee_cents bigint CHECK (fee_cents IS NULL OR fee_cents >= 0),
  original_expected_cents bigint,
  adjusted_expected_cents bigint,
  observed_bank_cents bigint,
  variance_cents bigint,
  status text NOT NULL CHECK (status IN ('NOT_YET_BATCHED', 'PAYOUT_PENDING', 'DEPOSIT_EXPECTED', 'RECONCILED', 'VARIANCE')),
  source_record_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_record_ids) = 'array'),
  reconciled_by text,
  reconciled_at timestamptz,
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, rooftop_id, payout_date),
  UNIQUE (session_id, external_payout_id),
  FOREIGN KEY (session_id, rooftop_id) REFERENCES rooftops(session_id, id) ON DELETE RESTRICT,
  CHECK (
    captured_cents IS NULL OR refund_cents IS NULL OR fee_cents IS NULL OR original_expected_cents IS NULL OR
    original_expected_cents = captured_cents - refund_cents - fee_cents
  ),
  CHECK (
    adjusted_expected_cents IS NULL OR observed_bank_cents IS NULL OR variance_cents IS NULL OR
    variance_cents = adjusted_expected_cents - observed_bank_cents
  ),
  CHECK (status <> 'RECONCILED' OR variance_cents = 0),
  CHECK (
    (reconciled_by IS NULL AND reconciled_at IS NULL) OR
    (reconciled_by IS NOT NULL AND reconciled_at IS NOT NULL)
  )
);

CREATE INDEX processor_payouts_date_idx
  ON processor_payouts (session_id, payout_date, status);

DROP TRIGGER settlement_source_records_append_only ON settlement_source_records;

ALTER TABLE settlement_source_records
  DROP CONSTRAINT settlement_source_records_component_check,
  DROP CONSTRAINT settlement_source_records_amount_cents_check,
  DROP CONSTRAINT settlement_source_records_check,
  DROP CONSTRAINT settlement_source_records_session_id_component_key;

ALTER TABLE settlement_source_records
  ADD COLUMN payout_id text,
  ADD COLUMN description text NOT NULL DEFAULT 'Legacy settlement evidence';

UPDATE settlement_source_records
SET component = 'PROCESSOR_SETTLEMENT'
WHERE component = 'PROCESSOR_FEE';

ALTER TABLE settlement_source_records
  ADD CONSTRAINT settlement_source_records_component_check CHECK (
    component IN ('PROCESSOR_SETTLEMENT', 'BANK_DEPOSIT', 'NETWORK_ASSESSMENT_NOTICE')
  ),
  ADD CONSTRAINT settlement_source_records_source_component_check CHECK (
    (component IN ('PROCESSOR_SETTLEMENT', 'NETWORK_ASSESSMENT_NOTICE') AND source_system = 'NORTHSTAR_PROCESSOR') OR
    (component = 'BANK_DEPOSIT' AND source_system = 'PRAIRIE_BANK')
  ),
  ADD CONSTRAINT settlement_source_records_payout_fk FOREIGN KEY (session_id, payout_id)
    REFERENCES processor_payouts(session_id, id) ON DELETE RESTRICT;

CREATE TRIGGER settlement_source_records_append_only
  BEFORE UPDATE OR DELETE ON settlement_source_records
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE INDEX settlement_source_records_payout_idx
  ON settlement_source_records (session_id, payout_id, received_at);

ALTER TABLE settlement_source_records
  ADD CONSTRAINT settlement_source_records_session_payout_id_key
  UNIQUE (session_id, payout_id, id);

CREATE TABLE refund_links (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  refund_payment_id text NOT NULL,
  original_payment_id text NOT NULL,
  invoice_id text NOT NULL,
  operation_key text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, refund_payment_id),
  UNIQUE (session_id, operation_key),
  FOREIGN KEY (session_id, refund_payment_id) REFERENCES payments(session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id, original_payment_id) REFERENCES payments(session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id, invoice_id) REFERENCES invoices(session_id, id) ON DELETE RESTRICT,
  CHECK (refund_payment_id <> original_payment_id)
);

CREATE TABLE settlement_adjustments (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  payout_id text NOT NULL,
  amount_cents bigint NOT NULL,
  code text NOT NULL CHECK (code = 'NETWORK_ASSESSMENT'),
  reason text NOT NULL,
  evidence_record_id text NOT NULL,
  note text,
  actor text NOT NULL,
  operation_key text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, id),
  UNIQUE (session_id, operation_key),
  UNIQUE (session_id, evidence_record_id),
  FOREIGN KEY (session_id, payout_id) REFERENCES processor_payouts(session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id, payout_id, evidence_record_id)
    REFERENCES settlement_source_records(session_id, payout_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION validate_settlement_adjustment_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evidence_component text;
  evidence_amount bigint;
BEGIN
  SELECT component, amount_cents
    INTO evidence_component, evidence_amount
    FROM settlement_source_records
   WHERE session_id = NEW.session_id
     AND payout_id = NEW.payout_id
     AND id = NEW.evidence_record_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement adjustment evidence must belong to the same payout';
  END IF;
  IF NEW.code = 'NETWORK_ASSESSMENT' AND
     (evidence_component <> 'NETWORK_ASSESSMENT_NOTICE' OR evidence_amount <> NEW.amount_cents) THEN
    RAISE EXCEPTION 'network assessment adjustment must equal its assessment notice';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER settlement_adjustments_validate_evidence
  BEFORE INSERT ON settlement_adjustments
  FOR EACH ROW EXECUTE FUNCTION validate_settlement_adjustment_evidence();

CREATE TABLE integration_connections (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status = 'CONNECTED'),
  simulated boolean NOT NULL CHECK (simulated),
  last_successful_at timestamptz NOT NULL,
  description text NOT NULL,
  PRIMARY KEY (session_id, id)
);

CREATE TABLE product_command_receipts (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  scope text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, idempotency_key)
);

CREATE INDEX product_command_receipts_scope_idx
  ON product_command_receipts (session_id, scope, created_at);

CREATE TRIGGER payment_allocations_append_only
  BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE TRIGGER dms_postings_append_only
  BEFORE UPDATE OR DELETE ON dms_postings
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE TRIGGER refund_links_append_only
  BEFORE UPDATE OR DELETE ON refund_links
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE TRIGGER settlement_adjustments_append_only
  BEFORE UPDATE OR DELETE ON settlement_adjustments
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

CREATE TRIGGER product_command_receipts_append_only
  BEFORE UPDATE OR DELETE ON product_command_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
