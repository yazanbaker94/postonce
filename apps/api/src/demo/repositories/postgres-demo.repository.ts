import type { OnModuleDestroy } from "@nestjs/common";
import { DemoStateSchema, type DemoState } from "@postonce/contracts";
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

  async create(state: DemoState): Promise<void> {
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

  async replace(state: DemoState): Promise<void> {
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

  async get(sessionId: string): Promise<DemoState | null> {
    const result = await this.pool.query<StateRow>("SELECT state FROM demo_sessions WHERE id = $1", [sessionId]);
    const row = result.rows[0];
    return row ? this.parseState(row.state) : null;
  }

  async mutate<T>(sessionId: string, mutation: SessionMutation<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<StateRow>(
        "SELECT state FROM demo_sessions WHERE id = $1 FOR UPDATE",
        [sessionId],
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
        detail: "PostgreSQL reachable; migrations present",
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

  private parseState(input: unknown): DemoState {
    const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
    return DemoStateSchema.parse(value);
  }

  private async persistState(client: PoolClient, state: DemoState, inserting: boolean): Promise<void> {
    if (inserting) {
      await client.query(
        `INSERT INTO demo_sessions (id, created_at, reset_at, state_version, current_chapter, close_status, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          state.session.id,
          state.session.createdAt,
          state.session.resetAt,
          state.session.version,
          state.currentChapter,
          state.close.status,
          JSON.stringify(state),
        ],
      );
    } else {
      await client.query(
        `UPDATE demo_sessions
         SET updated_at = now(), state_version = $2, current_chapter = $3, close_status = $4, state = $5::jsonb
         WHERE id = $1`,
        [state.session.id, state.session.version, state.currentChapter, state.close.status, JSON.stringify(state)],
      );
    }

    for (const record of [state.settlementEvidence.processorFee, state.settlementEvidence.bankDeposit]) {
      const inserted = await client.query(
        `INSERT INTO settlement_source_records
           (session_id, id, source_system, component, external_event_id, amount_cents, currency, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (session_id, id) DO NOTHING
         RETURNING id`,
        [state.session.id, record.id, record.system, record.component, record.externalEventId,
          record.amountCents, record.currency, record.receivedAt],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{
          source_system: string;
          component: string;
          external_event_id: string;
          amount_cents: string;
          currency: string;
          received_at: Date;
        }>(
          `SELECT source_system, component, external_event_id, amount_cents, currency, received_at
           FROM settlement_source_records WHERE session_id = $1 AND id = $2`,
          [state.session.id, record.id],
        );
        const row = existing.rows[0];
        if (
          !row ||
          row.source_system !== record.system ||
          row.component !== record.component ||
          row.external_event_id !== record.externalEventId ||
          Number(row.amount_cents) !== record.amountCents ||
          row.currency !== record.currency ||
          row.received_at.toISOString() !== record.receivedAt
        ) {
          throw new Error(`Settlement source identity ${record.id} was reused with a different payload`);
        }
      }
    }

    for (const rooftop of state.rooftops) {
      await client.query(
        `INSERT INTO rooftops (session_id, id, code, name, city)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id, id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, city = EXCLUDED.city`,
        [state.session.id, rooftop.id, rooftop.code, rooftop.name, rooftop.city],
      );
    }

    for (const invoice of state.invoices) {
      await client.query(
        `INSERT INTO invoices
           (session_id, id, rooftop_id, repair_order_number, customer_label, amount_cents, balance_cents, currency, status, opened_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (session_id, id) DO UPDATE
         SET balance_cents = EXCLUDED.balance_cents, status = EXCLUDED.status`,
        [state.session.id, invoice.id, invoice.rooftopId, invoice.repairOrderNumber, invoice.customerLabel,
          invoice.amountCents, invoice.balanceCents, invoice.currency, invoice.status, invoice.openedAt],
      );
    }

    for (const payment of state.payments) {
      await client.query(
        `INSERT INTO payments
           (session_id, id, rooftop_id, provider, external_event_id, customer_label, amount_cents, currency, kind, status, reference, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (session_id, id) DO UPDATE SET status = EXCLUDED.status`,
        [state.session.id, payment.id, payment.rooftopId, payment.provider, payment.externalEventId,
          payment.customerLabel, payment.amountCents, payment.currency, payment.kind, payment.status,
          payment.reference, payment.receivedAt],
      );
    }

    for (const receipt of state.inbox) {
      await client.query(
        `INSERT INTO processor_inbox (session_id, provider, external_event_id, first_seen_at, delivery_count)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id, provider, external_event_id)
         DO UPDATE SET delivery_count = GREATEST(processor_inbox.delivery_count, EXCLUDED.delivery_count)`,
        [state.session.id, receipt.provider, receipt.externalEventId, receipt.firstSeenAt, receipt.deliveryCount],
      );
    }

    for (const allocation of state.allocations) {
      const persisted = await client.query(
        `INSERT INTO payment_allocations
           (session_id, id, payment_id, invoice_id, amount_cents, source, operation_key, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (session_id, operation_key) DO UPDATE
         SET operation_key = payment_allocations.operation_key
         WHERE payment_allocations.id = EXCLUDED.id
           AND payment_allocations.payment_id = EXCLUDED.payment_id
           AND payment_allocations.invoice_id = EXCLUDED.invoice_id
           AND payment_allocations.amount_cents = EXCLUDED.amount_cents
           AND payment_allocations.source = EXCLUDED.source
           AND payment_allocations.created_at = EXCLUDED.created_at
         RETURNING id`,
        [state.session.id, allocation.id, allocation.paymentId, allocation.invoiceId, allocation.amountCents,
          allocation.source, allocation.operationKey, allocation.createdAt],
      );
      if (persisted.rowCount !== 1) {
        throw new Error(`Allocation operation key ${allocation.operationKey} was reused with a different payload`);
      }
    }

    for (const exception of state.exceptions) {
      await client.query(
        `INSERT INTO payment_exceptions
           (session_id, id, payment_id, type, severity, status, version, title, summary, candidates, assistant_note, resolution, opened_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13)
         ON CONFLICT (session_id, id) DO UPDATE
         SET status = EXCLUDED.status, version = EXCLUDED.version, resolution = EXCLUDED.resolution`,
        [state.session.id, exception.id, exception.paymentId, exception.type, exception.severity,
          exception.status, exception.version, exception.title, exception.summary, JSON.stringify(exception.candidates),
          exception.assistantNote, JSON.stringify(exception.resolution), exception.openedAt],
      );
    }

    for (const item of state.outbox) {
      const persisted = await client.query(
        `INSERT INTO posting_outbox
           (session_id, id, payment_id, invoice_id, operation_key, destination, status, attempt_count, created_at, delivered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (session_id, operation_key) DO UPDATE
         SET status = EXCLUDED.status, attempt_count = EXCLUDED.attempt_count, delivered_at = EXCLUDED.delivered_at
         WHERE posting_outbox.id = EXCLUDED.id
           AND posting_outbox.payment_id = EXCLUDED.payment_id
           AND posting_outbox.invoice_id = EXCLUDED.invoice_id
           AND posting_outbox.destination = EXCLUDED.destination
           AND posting_outbox.created_at = EXCLUDED.created_at
         RETURNING id`,
        [state.session.id, item.id, item.paymentId, item.invoiceId, item.operationKey, item.destination,
          item.status, item.attemptCount, item.createdAt, item.deliveredAt],
      );
      if (persisted.rowCount !== 1) {
        throw new Error(`Outbox operation key ${item.operationKey} was reused with a different payload`);
      }
    }

    for (const attempt of state.integrationAttempts) {
      await client.query(
        `INSERT INTO integration_attempts
           (session_id, id, system, direction, operation, external_event_id, operation_key, correlation_id,
            status, http_status, attempt_number, occurred_at, note, sanitized_request, sanitized_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)
         ON CONFLICT (session_id, id) DO NOTHING`,
        [state.session.id, attempt.id, attempt.system, attempt.direction, attempt.operation, attempt.externalEventId,
          attempt.operationKey, attempt.correlationId, attempt.status, attempt.httpStatus, attempt.attempt,
          attempt.occurredAt, attempt.note, JSON.stringify(attempt.sanitizedRequest),
          JSON.stringify(attempt.sanitizedResponse)],
      );
    }

    for (const event of state.auditEvents) {
      await client.query(
        `INSERT INTO audit_events
           (session_id, id, sequence, type, entity_type, entity_id, actor, occurred_at, correlation_id, summary, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (session_id, id) DO NOTHING`,
        [state.session.id, event.id, event.sequence, event.type, event.entityType, event.entityId,
          event.actor, event.occurredAt, event.correlationId, event.summary, JSON.stringify(event.details)],
      );
    }

    const committed = state.integrationAttempts.filter((attempt) =>
      attempt.system === "LEGACY_DMS" &&
      (
        attempt.status === "COMMITTED" ||
        (attempt.status === "RESPONSE_LOST" && attempt.sanitizedResponse?.committed === true)
      ));
    for (const posting of committed) {
      const postingId = typeof posting.sanitizedResponse?.postingId === "string"
        ? posting.sanitizedResponse.postingId
        : "OP-SYNTHETIC";
      const persisted = await client.query(
        `INSERT INTO dms_postings (session_id, operation_key, posting_id, correlation_id, committed_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id, operation_key) DO UPDATE
         SET operation_key = dms_postings.operation_key
         WHERE dms_postings.posting_id = EXCLUDED.posting_id
           AND dms_postings.correlation_id = EXCLUDED.correlation_id
           AND dms_postings.committed_at = EXCLUDED.committed_at
         RETURNING operation_key`,
        [state.session.id, posting.operationKey, postingId, posting.correlationId, posting.occurredAt],
      );
      if (persisted.rowCount !== 1) {
        throw new Error(`DMS operation key ${posting.operationKey} was reused with a different committed result`);
      }
    }

    await client.query(
      `INSERT INTO settlements
         (session_id, id, currency, gross_cents, fee_cents, refund_cents, expected_deposit_cents,
          bank_deposit_cents, variance_cents, status, evaluated_at)
       VALUES ($1,'settlement_close',$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (session_id, id) DO UPDATE
       SET bank_deposit_cents = EXCLUDED.bank_deposit_cents,
           variance_cents = EXCLUDED.variance_cents,
           status = EXCLUDED.status,
           evaluated_at = EXCLUDED.evaluated_at`,
      [state.session.id, state.totals.currency, state.totals.grossCents, state.totals.feeCents,
        state.totals.refundCents, state.totals.expectedDepositCents, state.totals.bankDepositCents,
        state.totals.varianceCents, state.close.status, state.close.lastEvaluatedAt],
    );
  }
}
