import type { OnModuleDestroy } from "@nestjs/common";
import { WorkspaceStateSchema, type WorkspaceState } from "@postonce/contracts";
import { Pool, type PoolClient } from "pg";
import type { DemoRepository, PersistenceHealth, SessionMutation } from "./demo.repository.js";

type StateRow = { state: unknown };

export class PostgresDemoRepository implements DemoRepository, OnModuleDestroy {
  readonly mode = "postgres" as const;
  private readonly pool: Pool;

  public constructor(
    connectionString: string,
    maxConnections: number,
    private readonly maxActiveSessions = 500,
    private readonly sessionTtlMinutes = 240,
  ) {
    this.pool = new Pool({
      connectionString,
      max: maxConnections,
      application_name: "postonce-api",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  }

  async create(state: WorkspaceState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [7_210_042]);
      await client.query("SET LOCAL postonce.allow_session_reset = 'on'");
      await client.query(
        "DELETE FROM demo_sessions WHERE updated_at < now() - ($1 * interval '1 minute')",
        [this.sessionTtlMinutes],
      );
      await client.query(
        `DELETE FROM demo_sessions
         WHERE id IN (
           SELECT id FROM demo_sessions ORDER BY updated_at ASC
           LIMIT GREATEST((SELECT count(*)::int FROM demo_sessions) - $1 + 1, 0)
         )`,
        [this.maxActiveSessions],
      );
      await this.persistState(client, state, true);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async replace(state: WorkspaceState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL postonce.allow_session_reset = 'on'");
      await client.query("DELETE FROM demo_sessions WHERE id = $1", [state.session.id]);
      await this.persistState(client, state, true);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(sessionId: string): Promise<WorkspaceState | null> {
    const result = await this.pool.query<StateRow>(
      "SELECT state FROM demo_sessions WHERE id = $1 AND updated_at >= now() - ($2 * interval '1 minute')",
      [sessionId, this.sessionTtlMinutes],
    );
    const row = result.rows[0];
    return row ? this.parseState(row.state) : null;
  }

  async mutate<T>(sessionId: string, mutation: SessionMutation<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<StateRow>(
        "SELECT state FROM demo_sessions WHERE id = $1 AND updated_at >= now() - ($2 * interval '1 minute') FOR UPDATE",
        [sessionId, this.sessionTtlMinutes],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }

      const state = this.parseState(row.state);
      const mutationResult = await mutation(state);
      if (mutationResult.changed) {
        state.session.version += 1;
        state.metadata.generatedAt = new Date().toISOString();
        await this.persistState(client, state, false);
      }
      await client.query("COMMIT");
      return mutationResult.value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async health(): Promise<PersistenceHealth> {
    const started = performance.now();
    try {
      await this.pool.query("SELECT 1 FROM demo_sessions LIMIT 1");
      return {
        ok: true,
        mode: this.mode,
        latencyMs: Number((performance.now() - started).toFixed(2)),
        detail: "PostgreSQL reachable; product workspace migrations present",
      };
    } catch {
      return {
        ok: false,
        mode: this.mode,
        latencyMs: Number((performance.now() - started).toFixed(2)),
        detail: "PostgreSQL unavailable or schema not migrated",
      };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private parseState(input: unknown): WorkspaceState {
    const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
    return WorkspaceStateSchema.parse(value);
  }

  private overallCloseStatus(state: WorkspaceState): "PROCESSING" | "BLOCKED" | "READY" | "CLOSED" {
    const statuses = state.operationalCloses.map((close) => close.status);
    if (statuses.some((status) => status === "BLOCKED")) return "BLOCKED";
    if (statuses.length > 0 && statuses.every((status) => status === "CLOSED")) return "CLOSED";
    if (statuses.length > 0 && statuses.every((status) => status === "READY" || status === "CLOSED")) return "READY";
    return "PROCESSING";
  }

  private async persistState(client: PoolClient, state: WorkspaceState, inserting: boolean): Promise<void> {
    await this.persistSession(client, state, inserting);

    for (const rooftop of state.rooftops) await this.persistRooftop(client, state, rooftop);
    for (const record of state.dmsRecords) await this.persistDmsRecord(client, state, record);
    for (const payment of state.payments) await this.persistPayment(client, state, payment);
    for (const receipt of state.inbox) await this.persistInboxReceipt(client, state, receipt);
    for (const allocation of state.allocations) await this.persistAllocation(client, state, allocation);
    for (const exception of state.exceptions) await this.persistException(client, state, exception);
    for (const item of state.outbox) await this.persistOutboxItem(client, state, item);
    for (const attempt of state.integrationAttempts) await this.persistIntegrationAttempt(client, state, attempt);
    for (const event of state.auditEvents) await this.persistAuditEvent(client, state, event);
    for (const close of state.operationalCloses) await this.persistOperationalClose(client, state, close);
    for (const payout of state.payouts) await this.persistPayout(client, state, payout);
    for (const record of state.payoutSourceRecords) await this.persistPayoutSourceRecord(client, state, record);
    for (const link of state.refundLinks) await this.persistRefundLink(client, state, link);
    for (const adjustment of state.settlementAdjustments) await this.persistSettlementAdjustment(client, state, adjustment);
    for (const connection of state.integrations) await this.persistIntegrationConnection(client, state, connection);
    for (const receipt of state.commandReceipts) await this.persistCommandReceipt(client, state, receipt);

    await this.persistCommittedDmsPostings(client, state);
  }

  private async persistSession(client: PoolClient, state: WorkspaceState, inserting: boolean): Promise<void> {
    const closeStatus = this.overallCloseStatus(state);
    if (inserting) {
      await client.query(
        `INSERT INTO demo_sessions
           (id, created_at, reset_at, state_version, current_chapter, close_status, state)
         VALUES ($1,$2,$3,$4,0,$5,$6::jsonb)`,
        [state.session.id, state.session.createdAt, state.session.resetAt, state.session.version,
          closeStatus, JSON.stringify(state)],
      );
      return;
    }

    const result = await client.query(
      `UPDATE demo_sessions
       SET updated_at = now(), state_version = $2, current_chapter = 0, close_status = $3, state = $4::jsonb
       WHERE id = $1`,
      [state.session.id, state.session.version, closeStatus, JSON.stringify(state)],
    );
    if (result.rowCount !== 1) throw new Error(`Workspace session ${state.session.id} disappeared during persistence`);
  }

  private async persistRooftop(client: PoolClient, state: WorkspaceState, rooftop: WorkspaceState["rooftops"][number]): Promise<void> {
    const persisted = await client.query(
      `INSERT INTO rooftops (session_id, id, code, name, city, timezone)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (session_id, id) DO UPDATE
       SET code = EXCLUDED.code, name = EXCLUDED.name, city = EXCLUDED.city, timezone = EXCLUDED.timezone
       WHERE rooftops.code = EXCLUDED.code
       RETURNING id`,
      [state.session.id, rooftop.id, rooftop.code, rooftop.name, rooftop.city, rooftop.timezone],
    );
    if (persisted.rowCount !== 1) throw new Error(`Rooftop identity ${rooftop.id} was reused with a different code`);
  }

  private async persistDmsRecord(client: PoolClient, state: WorkspaceState, record: WorkspaceState["dmsRecords"][number]): Promise<void> {
    const legacyStatus = record.balanceCents === 0
      ? "PAID"
      : record.balanceCents < record.customerPayCents ? "PARTIAL" : "OPEN";
    const persisted = await client.query(
      `INSERT INTO invoices
         (session_id, id, rooftop_id, repair_order_number, customer_label, amount_cents, balance_cents,
          currency, status, opened_at, department, record_type, record_number, vehicle_label,
          advisor_label, business_status, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (session_id, id) DO UPDATE
       SET balance_cents = EXCLUDED.balance_cents,
           status = EXCLUDED.status,
           business_status = EXCLUDED.business_status,
           closed_at = EXCLUDED.closed_at,
           vehicle_label = EXCLUDED.vehicle_label,
           advisor_label = EXCLUDED.advisor_label
       WHERE invoices.rooftop_id = EXCLUDED.rooftop_id
         AND invoices.repair_order_number = EXCLUDED.repair_order_number
         AND invoices.customer_label = EXCLUDED.customer_label
         AND invoices.amount_cents = EXCLUDED.amount_cents
         AND invoices.currency = EXCLUDED.currency
         AND invoices.opened_at = EXCLUDED.opened_at
         AND invoices.department = EXCLUDED.department
         AND invoices.record_type = EXCLUDED.record_type
         AND invoices.record_number = EXCLUDED.record_number
       RETURNING id`,
      [state.session.id, record.id, record.rooftopId, record.recordNumber, record.customerLabel,
        record.customerPayCents, record.balanceCents, record.currency, legacyStatus, record.openedAt,
        record.department, record.recordType, record.recordNumber, record.vehicleLabel,
        record.advisorLabel, record.businessStatus, record.closedAt],
    );
    if (persisted.rowCount !== 1) throw new Error(`DMS record identity ${record.id} was reused with a different payload`);
  }

  private async persistPayment(client: PoolClient, state: WorkspaceState, payment: WorkspaceState["payments"][number]): Promise<void> {
    const legacyStatus = payment.paymentState === "REFUNDED"
      ? "REFUNDED"
      : payment.dmsState === "VERIFIED" ? "POSTED"
        : payment.dmsState === "MATCHED" || payment.dmsState === "POSTING" ? "MATCHED"
          : payment.dmsState === "NEEDS_REVIEW" ? "EXCEPTION" : "RECEIVED";
    const persisted = await client.query(
      `INSERT INTO payments
         (session_id, id, rooftop_id, provider, external_event_id, customer_label, amount_cents,
          currency, kind, status, reference, received_at, business_date, department,
          processor_transaction_id, method_type, card_last4, terminal_label, payment_state,
          dms_state, settlement_state, source_reference, linked_record_id, matched_at, posted_at,
          verified_at, posting_operation_key, in_friday_close)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       ON CONFLICT (session_id, id) DO UPDATE
       SET status = EXCLUDED.status,
           reference = COALESCE(payments.reference, EXCLUDED.reference),
           payment_state = EXCLUDED.payment_state,
           dms_state = EXCLUDED.dms_state,
           settlement_state = EXCLUDED.settlement_state,
           source_reference = COALESCE(payments.source_reference, EXCLUDED.source_reference),
           linked_record_id = EXCLUDED.linked_record_id,
           matched_at = EXCLUDED.matched_at,
           posted_at = EXCLUDED.posted_at,
           verified_at = EXCLUDED.verified_at,
           posting_operation_key = EXCLUDED.posting_operation_key
       WHERE payments.rooftop_id = EXCLUDED.rooftop_id
         AND payments.provider = EXCLUDED.provider
         AND payments.external_event_id = EXCLUDED.external_event_id
         AND payments.customer_label = EXCLUDED.customer_label
         AND payments.amount_cents = EXCLUDED.amount_cents
         AND payments.currency = EXCLUDED.currency
         AND payments.kind = EXCLUDED.kind
         AND payments.received_at = EXCLUDED.received_at
         AND payments.business_date = EXCLUDED.business_date
         AND payments.department = EXCLUDED.department
         AND payments.processor_transaction_id = EXCLUDED.processor_transaction_id
         AND payments.method_type = EXCLUDED.method_type
         AND payments.card_last4 = EXCLUDED.card_last4
         AND payments.terminal_label = EXCLUDED.terminal_label
         AND (payments.reference IS NULL OR payments.reference = EXCLUDED.reference)
         AND (payments.source_reference IS NULL OR payments.source_reference = EXCLUDED.source_reference)
         AND payments.in_friday_close = EXCLUDED.in_friday_close
       RETURNING id`,
      [state.session.id, payment.id, payment.rooftopId, payment.provider, payment.externalEventId,
        payment.customerLabel, payment.amountCents, payment.currency, payment.kind, legacyStatus,
        payment.sourceReference, payment.receivedAt, payment.businessDate, payment.department,
        payment.processorTransactionId, payment.methodType, payment.cardLast4, payment.terminalLabel,
        payment.paymentState, payment.dmsState, payment.settlementState, payment.sourceReference,
        payment.linkedRecordId, payment.matchedAt, payment.postedAt, payment.verifiedAt,
        payment.postingOperationKey, payment.inFridayClose],
    );
    if (persisted.rowCount !== 1) throw new Error(`Payment identity ${payment.id} was reused with a different payload`);
  }

  private async persistInboxReceipt(client: PoolClient, state: WorkspaceState, receipt: WorkspaceState["inbox"][number]): Promise<void> {
    const persisted = await client.query(
      `INSERT INTO processor_inbox (session_id, provider, external_event_id, first_seen_at, delivery_count)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (session_id, provider, external_event_id) DO UPDATE
       SET delivery_count = EXCLUDED.delivery_count
       WHERE processor_inbox.first_seen_at = EXCLUDED.first_seen_at
         AND processor_inbox.delivery_count <= EXCLUDED.delivery_count
       RETURNING external_event_id`,
      [state.session.id, receipt.provider, receipt.externalEventId, receipt.firstSeenAt, receipt.deliveryCount],
    );
    if (persisted.rowCount !== 1) throw new Error(`Inbox event ${receipt.externalEventId} regressed or changed identity`);
  }

  private async persistAllocation(client: PoolClient, state: WorkspaceState, allocation: WorkspaceState["allocations"][number]): Promise<void> {
    await this.persistImmutable(
      client,
      `INSERT INTO payment_allocations
         (session_id, id, payment_id, invoice_id, amount_cents, source, operation_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING RETURNING id`,
      [state.session.id, allocation.id, allocation.paymentId, allocation.dmsRecordId,
        allocation.amountCents, allocation.source, allocation.operationKey, allocation.createdAt],
      `SELECT id FROM payment_allocations
       WHERE session_id = $1 AND id = $2 AND payment_id = $3 AND invoice_id = $4
         AND amount_cents = $5 AND source = $6 AND operation_key = $7 AND created_at = $8`,
      [state.session.id, allocation.id, allocation.paymentId, allocation.dmsRecordId,
        allocation.amountCents, allocation.source, allocation.operationKey, allocation.createdAt],
      `Allocation identity ${allocation.id}/${allocation.operationKey} was reused with a different payload`,
    );
  }

  private async persistException(client: PoolClient, state: WorkspaceState, exception: WorkspaceState["exceptions"][number]): Promise<void> {
    const resolution = exception.resolution === null ? null : JSON.stringify(exception.resolution);
    const persisted = await client.query(
      `INSERT INTO payment_exceptions
         (session_id, id, payment_id, type, severity, status, version, title, summary, candidates,
          assistant_note, resolution, opened_at, rooftop_id, department, suggested_candidate_id,
          suggestion, resolved_by, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (session_id, id) DO UPDATE
       SET status = EXCLUDED.status,
           version = EXCLUDED.version,
           resolution = EXCLUDED.resolution,
           resolved_by = EXCLUDED.resolved_by,
           resolved_at = EXCLUDED.resolved_at
       WHERE payment_exceptions.payment_id = EXCLUDED.payment_id
         AND payment_exceptions.type = EXCLUDED.type
         AND payment_exceptions.severity = EXCLUDED.severity
         AND payment_exceptions.title = EXCLUDED.title
         AND payment_exceptions.summary = EXCLUDED.summary
         AND payment_exceptions.candidates = EXCLUDED.candidates
         AND payment_exceptions.opened_at = EXCLUDED.opened_at
         AND payment_exceptions.rooftop_id = EXCLUDED.rooftop_id
         AND payment_exceptions.department = EXCLUDED.department
         AND payment_exceptions.suggested_candidate_id IS NOT DISTINCT FROM EXCLUDED.suggested_candidate_id
         AND payment_exceptions.suggestion IS NOT DISTINCT FROM EXCLUDED.suggestion
         AND payment_exceptions.version <= EXCLUDED.version
       RETURNING id`,
      [state.session.id, exception.id, exception.paymentId, exception.type, exception.severity,
        exception.status, exception.version, exception.title, exception.summary,
        JSON.stringify(exception.candidates), exception.suggestion, resolution, exception.openedAt,
        exception.rooftopId, exception.department, exception.suggestedCandidateId, exception.suggestion,
        exception.resolution?.actor ?? null, exception.resolution?.resolvedAt ?? null],
    );
    if (persisted.rowCount !== 1) throw new Error(`Exception identity ${exception.id} was reused with a different payload or stale version`);
  }

  private async persistOutboxItem(client: PoolClient, state: WorkspaceState, item: WorkspaceState["outbox"][number]): Promise<void> {
    const persisted = await client.query(
      `INSERT INTO posting_outbox
         (session_id, id, payment_id, invoice_id, operation_key, mutation_kind, destination,
          status, attempt_count, created_at, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (session_id, operation_key) DO UPDATE
       SET status = EXCLUDED.status,
           attempt_count = EXCLUDED.attempt_count,
           delivered_at = EXCLUDED.delivered_at
       WHERE posting_outbox.id = EXCLUDED.id
         AND posting_outbox.payment_id = EXCLUDED.payment_id
         AND posting_outbox.invoice_id = EXCLUDED.invoice_id
         AND posting_outbox.mutation_kind = EXCLUDED.mutation_kind
         AND posting_outbox.destination = EXCLUDED.destination
         AND posting_outbox.created_at = EXCLUDED.created_at
         AND posting_outbox.attempt_count <= EXCLUDED.attempt_count
         AND NOT (posting_outbox.status = 'DELIVERED' AND EXCLUDED.status = 'PENDING')
         AND (posting_outbox.delivered_at IS NULL OR posting_outbox.delivered_at = EXCLUDED.delivered_at)
       RETURNING id`,
      [state.session.id, item.id, item.paymentId, item.dmsRecordId, item.operationKey,
        item.mutationKind, item.destination, item.status, item.attemptCount, item.createdAt, item.deliveredAt],
    );
    if (persisted.rowCount !== 1) throw new Error(`Outbox operation key ${item.operationKey} was reused with a different payload or regressed`);
  }

  private async persistIntegrationAttempt(client: PoolClient, state: WorkspaceState, attempt: WorkspaceState["integrationAttempts"][number]): Promise<void> {
    const response = attempt.sanitizedResponse === null ? null : JSON.stringify(attempt.sanitizedResponse);
    await this.persistImmutable(
      client,
      `INSERT INTO integration_attempts
         (session_id, id, system, direction, operation, external_event_id, operation_key,
          correlation_id, status, http_status, attempt_number, occurred_at, note,
          sanitized_request, sanitized_response)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)
       ON CONFLICT DO NOTHING RETURNING id`,
      [state.session.id, attempt.id, attempt.system, attempt.direction, attempt.operation,
        attempt.externalEventId, attempt.operationKey, attempt.correlationId, attempt.status,
        attempt.httpStatus, attempt.attempt, attempt.occurredAt, attempt.note,
        JSON.stringify(attempt.sanitizedRequest), response],
      `SELECT id FROM integration_attempts
       WHERE session_id = $1 AND id = $2 AND system = $3 AND direction = $4 AND operation = $5
         AND external_event_id IS NOT DISTINCT FROM $6 AND operation_key = $7 AND correlation_id = $8
         AND status = $9 AND http_status IS NOT DISTINCT FROM $10 AND attempt_number = $11
         AND occurred_at = $12 AND note = $13 AND sanitized_request = $14::jsonb
         AND sanitized_response IS NOT DISTINCT FROM $15::jsonb`,
      [state.session.id, attempt.id, attempt.system, attempt.direction, attempt.operation,
        attempt.externalEventId, attempt.operationKey, attempt.correlationId, attempt.status,
        attempt.httpStatus, attempt.attempt, attempt.occurredAt, attempt.note,
        JSON.stringify(attempt.sanitizedRequest), response],
      `Integration attempt identity ${attempt.id} was reused with a different payload`,
    );
  }

  private async persistAuditEvent(client: PoolClient, state: WorkspaceState, event: WorkspaceState["auditEvents"][number]): Promise<void> {
    await this.persistImmutable(
      client,
      `INSERT INTO audit_events
         (session_id, id, sequence, type, entity_type, entity_id, actor, occurred_at,
          correlation_id, summary, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT DO NOTHING RETURNING id`,
      [state.session.id, event.id, event.sequence, event.type, event.entityType, event.entityId,
        event.actor, event.occurredAt, event.correlationId, event.summary, JSON.stringify(event.details)],
      `SELECT id FROM audit_events
       WHERE session_id = $1 AND id = $2 AND sequence = $3 AND type = $4 AND entity_type = $5
         AND entity_id = $6 AND actor = $7 AND occurred_at = $8 AND correlation_id = $9
         AND summary = $10 AND details = $11::jsonb`,
      [state.session.id, event.id, event.sequence, event.type, event.entityType, event.entityId,
        event.actor, event.occurredAt, event.correlationId, event.summary, JSON.stringify(event.details)],
      `Audit event identity ${event.id}/${event.sequence} was reused with a different payload`,
    );
  }

  private async persistOperationalClose(client: PoolClient, state: WorkspaceState, close: WorkspaceState["operationalCloses"][number]): Promise<void> {
    const attestation = close.attestation === null ? null : JSON.stringify(close.attestation);
    const persisted = await client.query(
      `INSERT INTO operational_closes
         (session_id, id, rooftop_id, business_date, payment_count, verified_posting_count,
          blocking_exception_count, settlement_status, status, version, closed_by, closed_at, attestation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
       ON CONFLICT (session_id, id) DO UPDATE
       SET verified_posting_count = EXCLUDED.verified_posting_count,
           blocking_exception_count = EXCLUDED.blocking_exception_count,
           settlement_status = EXCLUDED.settlement_status,
           status = EXCLUDED.status,
           version = EXCLUDED.version,
           closed_by = EXCLUDED.closed_by,
           closed_at = EXCLUDED.closed_at,
           attestation = EXCLUDED.attestation
        WHERE operational_closes.rooftop_id = EXCLUDED.rooftop_id
          AND operational_closes.business_date = EXCLUDED.business_date
          AND operational_closes.payment_count = EXCLUDED.payment_count
          AND operational_closes.version <= EXCLUDED.version
          AND (
            operational_closes.status <> 'CLOSED' OR (
              operational_closes.verified_posting_count = EXCLUDED.verified_posting_count
              AND operational_closes.blocking_exception_count = EXCLUDED.blocking_exception_count
              AND operational_closes.settlement_status = EXCLUDED.settlement_status
              AND operational_closes.status = EXCLUDED.status
              AND operational_closes.version = EXCLUDED.version
              AND operational_closes.closed_by IS NOT DISTINCT FROM EXCLUDED.closed_by
              AND operational_closes.closed_at IS NOT DISTINCT FROM EXCLUDED.closed_at
              AND operational_closes.attestation IS NOT DISTINCT FROM EXCLUDED.attestation
            )
          )
        RETURNING id`,
      [state.session.id, close.id, close.rooftopId, close.businessDate, close.paymentCount,
        close.verifiedPostingCount, close.blockingExceptionCount, close.settlementStatus,
        close.status, close.version, close.closedBy, close.closedAt, attestation],
    );
    if (persisted.rowCount !== 1) throw new Error(`Operational close identity ${close.id} changed or regressed`);
  }

  private async persistPayout(client: PoolClient, state: WorkspaceState, payout: WorkspaceState["payouts"][number]): Promise<void> {
    const persisted = await client.query(
      `INSERT INTO processor_payouts
         (session_id, id, rooftop_id, payout_date, external_payout_id, currency, captured_cents,
          refund_cents, fee_cents, original_expected_cents, adjusted_expected_cents,
          observed_bank_cents, variance_cents, status, source_record_ids, reconciled_by,
          reconciled_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)
       ON CONFLICT (session_id, id) DO UPDATE
       SET external_payout_id = COALESCE(processor_payouts.external_payout_id, EXCLUDED.external_payout_id),
           captured_cents = COALESCE(processor_payouts.captured_cents, EXCLUDED.captured_cents),
           refund_cents = COALESCE(processor_payouts.refund_cents, EXCLUDED.refund_cents),
           fee_cents = COALESCE(processor_payouts.fee_cents, EXCLUDED.fee_cents),
           original_expected_cents = COALESCE(processor_payouts.original_expected_cents, EXCLUDED.original_expected_cents),
           adjusted_expected_cents = EXCLUDED.adjusted_expected_cents,
           observed_bank_cents = COALESCE(processor_payouts.observed_bank_cents, EXCLUDED.observed_bank_cents),
           variance_cents = EXCLUDED.variance_cents,
           status = EXCLUDED.status,
           source_record_ids = EXCLUDED.source_record_ids,
           reconciled_by = EXCLUDED.reconciled_by,
           reconciled_at = EXCLUDED.reconciled_at,
           version = EXCLUDED.version
       WHERE processor_payouts.rooftop_id = EXCLUDED.rooftop_id
         AND processor_payouts.payout_date = EXCLUDED.payout_date
         AND processor_payouts.currency = EXCLUDED.currency
         AND (processor_payouts.external_payout_id IS NULL OR processor_payouts.external_payout_id = EXCLUDED.external_payout_id)
         AND (processor_payouts.captured_cents IS NULL OR processor_payouts.captured_cents = EXCLUDED.captured_cents)
         AND (processor_payouts.refund_cents IS NULL OR processor_payouts.refund_cents = EXCLUDED.refund_cents)
         AND (processor_payouts.fee_cents IS NULL OR processor_payouts.fee_cents = EXCLUDED.fee_cents)
         AND (processor_payouts.original_expected_cents IS NULL OR processor_payouts.original_expected_cents = EXCLUDED.original_expected_cents)
         AND (processor_payouts.observed_bank_cents IS NULL OR processor_payouts.observed_bank_cents = EXCLUDED.observed_bank_cents)
         AND processor_payouts.version <= EXCLUDED.version
       RETURNING id`,
      [state.session.id, payout.id, payout.rooftopId, payout.payoutDate, payout.externalPayoutId,
        payout.currency, payout.capturedCents, payout.refundCents, payout.feeCents,
        payout.originalExpectedCents, payout.adjustedExpectedCents, payout.observedBankCents,
        payout.varianceCents, payout.status, JSON.stringify(payout.sourceRecordIds),
        payout.reconciledBy, payout.reconciledAt, payout.version],
    );
    if (persisted.rowCount !== 1) throw new Error(`Processor payout identity ${payout.id} changed or regressed`);
  }

  private async persistPayoutSourceRecord(client: PoolClient, state: WorkspaceState, record: WorkspaceState["payoutSourceRecords"][number]): Promise<void> {
    await this.persistImmutable(
      client,
      `INSERT INTO settlement_source_records
         (session_id, id, payout_id, source_system, component, external_event_id, amount_cents,
          currency, received_at, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING RETURNING id`,
      [state.session.id, record.id, record.payoutId, record.sourceSystem, record.component,
        record.externalEventId, record.amountCents, record.currency, record.receivedAt, record.description],
      `SELECT id FROM settlement_source_records
       WHERE session_id = $1 AND id = $2 AND payout_id = $3 AND source_system = $4
         AND component = $5 AND external_event_id = $6 AND amount_cents = $7
         AND currency = $8 AND received_at = $9 AND description = $10`,
      [state.session.id, record.id, record.payoutId, record.sourceSystem, record.component,
        record.externalEventId, record.amountCents, record.currency, record.receivedAt, record.description],
      `Payout source identity ${record.id} was reused with a different payload`,
    );
  }

  private async persistRefundLink(client: PoolClient, state: WorkspaceState, link: WorkspaceState["refundLinks"][number]): Promise<void> {
    await this.persistImmutable(
      client,
      `INSERT INTO refund_links
         (session_id, id, refund_payment_id, original_payment_id, invoice_id, operation_key, actor, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING RETURNING id`,
      [state.session.id, link.id, link.refundPaymentId, link.originalPaymentId,
        link.dmsRecordId, link.operationKey, link.actor, link.createdAt],
      `SELECT id FROM refund_links
       WHERE session_id = $1 AND id = $2 AND refund_payment_id = $3 AND original_payment_id = $4
         AND invoice_id = $5 AND operation_key = $6 AND actor = $7 AND created_at = $8`,
      [state.session.id, link.id, link.refundPaymentId, link.originalPaymentId,
        link.dmsRecordId, link.operationKey, link.actor, link.createdAt],
      `Refund link identity ${link.id}/${link.operationKey} was reused with a different payload`,
    );
  }

  private async persistSettlementAdjustment(client: PoolClient, state: WorkspaceState, adjustment: WorkspaceState["settlementAdjustments"][number]): Promise<void> {
    await this.persistImmutable(
      client,
      `INSERT INTO settlement_adjustments
         (session_id, id, payout_id, amount_cents, code, reason, evidence_record_id,
          note, actor, operation_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT DO NOTHING RETURNING id`,
      [state.session.id, adjustment.id, adjustment.payoutId, adjustment.amountCents,
        adjustment.code, adjustment.reason, adjustment.evidenceRecordId, adjustment.note ?? null,
        adjustment.actor, adjustment.operationKey, adjustment.createdAt],
      `SELECT id FROM settlement_adjustments
       WHERE session_id = $1 AND id = $2 AND payout_id = $3 AND amount_cents = $4
         AND code = $5 AND reason = $6 AND evidence_record_id = $7
         AND note IS NOT DISTINCT FROM $8 AND actor = $9 AND operation_key = $10 AND created_at = $11`,
      [state.session.id, adjustment.id, adjustment.payoutId, adjustment.amountCents,
        adjustment.code, adjustment.reason, adjustment.evidenceRecordId, adjustment.note ?? null,
        adjustment.actor, adjustment.operationKey, adjustment.createdAt],
      `Settlement adjustment identity ${adjustment.id}/${adjustment.operationKey} was reused with a different payload`,
    );
  }

  private async persistIntegrationConnection(client: PoolClient, state: WorkspaceState, connection: WorkspaceState["integrations"][number]): Promise<void> {
    const persisted = await client.query(
      `INSERT INTO integration_connections
         (session_id, id, name, status, simulated, last_successful_at, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (session_id, id) DO UPDATE
       SET name = EXCLUDED.name,
           status = EXCLUDED.status,
           simulated = EXCLUDED.simulated,
           last_successful_at = EXCLUDED.last_successful_at,
           description = EXCLUDED.description
       RETURNING id`,
      [state.session.id, connection.id, connection.name, connection.status, connection.simulated,
        connection.lastSuccessfulAt, connection.description],
    );
    if (persisted.rowCount !== 1) throw new Error(`Integration connection ${connection.id} could not be persisted`);
  }

  private async persistCommandReceipt(client: PoolClient, state: WorkspaceState, receipt: WorkspaceState["commandReceipts"][number]): Promise<void> {
    await this.persistImmutable(
      client,
      `INSERT INTO product_command_receipts
         (session_id, idempotency_key, scope, fingerprint, result, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT DO NOTHING RETURNING idempotency_key`,
      [state.session.id, receipt.idempotencyKey, receipt.scope, receipt.fingerprint,
        JSON.stringify(receipt.result), receipt.createdAt],
      `SELECT idempotency_key FROM product_command_receipts
       WHERE session_id = $1 AND idempotency_key = $2 AND scope = $3 AND fingerprint = $4
         AND result = $5::jsonb AND created_at = $6`,
      [state.session.id, receipt.idempotencyKey, receipt.scope, receipt.fingerprint,
        JSON.stringify(receipt.result), receipt.createdAt],
      `Idempotency key ${receipt.idempotencyKey} was reused with a different command or result`,
    );
  }

  private async persistCommittedDmsPostings(client: PoolClient, state: WorkspaceState): Promise<void> {
    const committed = state.integrationAttempts.filter((attempt) =>
      attempt.system === "LEGACY_DMS" &&
      (
        attempt.status === "COMMITTED" ||
        (attempt.status === "RESPONSE_LOST" && attempt.sanitizedResponse?.committed === true)
      ));

    for (const posting of committed) {
      const outbox = state.outbox.find((item) => item.operationKey === posting.operationKey);
      const postingId = typeof posting.sanitizedResponse?.postingId === "string"
        ? posting.sanitizedResponse.postingId
        : `DMS-${posting.operationKey}`;
      await this.persistImmutable(
        client,
        `INSERT INTO dms_postings
           (session_id, operation_key, posting_id, correlation_id, committed_at,
            payment_id, invoice_id, mutation_kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING RETURNING operation_key`,
        [state.session.id, posting.operationKey, postingId, posting.correlationId, posting.occurredAt,
          outbox?.paymentId ?? null, outbox?.dmsRecordId ?? null, outbox?.mutationKind ?? null],
        `SELECT operation_key FROM dms_postings
         WHERE session_id = $1 AND operation_key = $2 AND posting_id = $3
           AND correlation_id = $4 AND committed_at = $5
           AND payment_id IS NOT DISTINCT FROM $6
           AND invoice_id IS NOT DISTINCT FROM $7
           AND mutation_kind IS NOT DISTINCT FROM $8`,
        [state.session.id, posting.operationKey, postingId, posting.correlationId, posting.occurredAt,
          outbox?.paymentId ?? null, outbox?.dmsRecordId ?? null, outbox?.mutationKind ?? null],
        `DMS operation key ${posting.operationKey} was reused with a different committed result`,
      );
    }
  }

  private async persistImmutable(
    client: PoolClient,
    insertSql: string,
    insertParameters: unknown[],
    identicalSql: string,
    identicalParameters: unknown[],
    conflictMessage: string,
  ): Promise<void> {
    const inserted = await client.query(insertSql, insertParameters);
    if (inserted.rowCount === 1) return;
    const identical = await client.query(identicalSql, identicalParameters);
    if (identical.rowCount !== 1) throw new Error(conflictMessage);
  }
}
