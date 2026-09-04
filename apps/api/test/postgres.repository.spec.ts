import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { DemoEngine, type EngineOutcome } from "../src/demo/domain/demo.engine.js";
import { createSeedState } from "../src/demo/domain/seed.js";
import { PostgresDemoRepository } from "../src/demo/repositories/postgres-demo.repository.js";

const databaseUrl = process.env.POSTONCE_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("PostgreSQL product workspace locking and relational evidence", () => {
  it("persists the canonical fixture, serializes stale decisions, and mirrors append-only product mutations", async () => {
    if (!databaseUrl) return;
    const repository = new PostgresDemoRepository(databaseUrl, 4);
    const pool = new Pool({ connectionString: databaseUrl });
    const engine = new DemoEngine();
    const sessionId = randomUUID();
    let sessionCreated = false;

    const mutate = async (operation: Parameters<typeof repository.mutate<EngineOutcome>>[1]): Promise<EngineOutcome> => {
      const outcome = await repository.mutate(sessionId, operation);
      if (!outcome) throw new Error(`Workspace ${sessionId} unexpectedly disappeared`);
      return outcome;
    };
    const resolve = async (exceptionId: string, targetId: string, idempotencyKey: string): Promise<EngineOutcome> => mutate((state) => {
      const outcome = engine.resolveException(state, exceptionId, { expectedVersion: 1, idempotencyKey, targetId });
      return { value: outcome, changed: outcome.changed };
    });
    const sqlState = async (sql: string): Promise<string | undefined> => {
      try {
        await pool.query(sql, [sessionId]);
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };

    try {
      await repository.create(createSeedState(sessionId, new Date("2026-09-04T22:55:00.000Z")));
      sessionCreated = true;

      const seed = await pool.query<{
        payment_count: number;
        friday_payment_count: number;
        inbox_event_count: number;
        processor_delivery_count: number;
        allocation_count: number;
        dms_posting_count: number;
        open_exception_count: number;
        close_count: number;
        source_record_count: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM payments WHERE session_id = $1) AS payment_count,
           (SELECT count(*)::int FROM payments WHERE session_id = $1 AND in_friday_close) AS friday_payment_count,
           (SELECT count(*)::int FROM processor_inbox WHERE session_id = $1) AS inbox_event_count,
           (SELECT sum(delivery_count)::int FROM processor_inbox WHERE session_id = $1) AS processor_delivery_count,
           (SELECT count(*)::int FROM payment_allocations WHERE session_id = $1) AS allocation_count,
           (SELECT count(*)::int FROM dms_postings WHERE session_id = $1) AS dms_posting_count,
           (SELECT count(*)::int FROM payment_exceptions WHERE session_id = $1 AND status = 'OPEN') AS open_exception_count,
           (SELECT count(*)::int FROM operational_closes WHERE session_id = $1) AS close_count,
           (SELECT count(*)::int FROM settlement_source_records WHERE session_id = $1) AS source_record_count`,
        [sessionId],
      );
      expect(seed.rows[0]).toEqual({
        payment_count: 64,
        friday_payment_count: 62,
        inbox_event_count: 62,
        processor_delivery_count: 63,
        allocation_count: 59,
        dms_posting_count: 59,
        open_exception_count: 3,
        close_count: 3,
        source_record_count: 3,
      });

      const openExceptions = await pool.query<{ id: string; version: number; resolution_is_null: boolean; state_valid: boolean }>(
        `SELECT id,
                version,
                resolution IS NULL AS resolution_is_null,
                ((status = 'OPEN' AND resolution IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
                  OR (status = 'RESOLVED' AND resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)) AS state_valid
         FROM payment_exceptions
         WHERE session_id = $1
         ORDER BY id`,
        [sessionId],
      );
      expect(openExceptions.rows).toEqual([
        { id: "EX-104", version: 1, resolution_is_null: true, state_valid: true },
        { id: "EX-105", version: 1, resolution_is_null: true, state_valid: true },
        { id: "EX-106", version: 1, resolution_is_null: true, state_valid: true },
      ]);

      const raceCommands = [
        { idempotencyKey: "postgres-race-maya", targetId: "rec_ro_8004" },
        { idempotencyKey: "postgres-race-jon", targetId: "rec_ro_8004" },
      ] as const;
      const raced = await Promise.all(raceCommands.map(async (command) => ({
        command,
        outcome: await resolve("EX-104", command.targetId, command.idempotencyKey),
      })));
      const winners = raced.filter((item) => !item.outcome.rejected);
      const losers = raced.filter((item) => item.outcome.rejected);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.outcome).toMatchObject({ changed: true, replayed: false, result: { exceptionId: "EX-104", version: 2 } });
      expect(losers).toHaveLength(1);
      expect(losers[0]?.outcome).toMatchObject({
        changed: true,
        replayed: false,
        rejected: { code: "VERSION_CONFLICT", status: 409, details: { expectedVersion: 1, actualVersion: 2 } },
      });

      const raceEvidence = await pool.query<{
        state_version: number;
        exception_status: string;
        exception_version: number;
        resolution_type: string;
        target_id: string;
        accepted_amount_cents: number;
        allocation_count: number;
        conflict_audit_count: number;
        command_receipt_count: number;
        rejection_receipt_count: number;
        dms_posting_count: number;
      }>(
        `SELECT
           (SELECT state_version FROM demo_sessions WHERE id = $1) AS state_version,
           (SELECT status FROM payment_exceptions WHERE session_id = $1 AND id = 'EX-104') AS exception_status,
           (SELECT version FROM payment_exceptions WHERE session_id = $1 AND id = 'EX-104') AS exception_version,
           (SELECT jsonb_typeof(resolution) FROM payment_exceptions WHERE session_id = $1 AND id = 'EX-104') AS resolution_type,
           (SELECT resolution ->> 'targetId' FROM payment_exceptions WHERE session_id = $1 AND id = 'EX-104') AS target_id,
           (SELECT (resolution ->> 'amountCents')::int FROM payment_exceptions WHERE session_id = $1 AND id = 'EX-104') AS accepted_amount_cents,
           (SELECT count(*)::int FROM payment_allocations WHERE session_id = $1 AND payment_id = 'PAY-104') AS allocation_count,
           (SELECT count(*)::int FROM audit_events WHERE session_id = $1 AND type = 'STALE_VERSION_CONFLICT') AS conflict_audit_count,
           (SELECT count(*)::int FROM product_command_receipts WHERE session_id = $1) AS command_receipt_count,
           (SELECT count(*)::int FROM product_command_receipts WHERE session_id = $1 AND result ? 'rejection') AS rejection_receipt_count,
           (SELECT count(*)::int FROM dms_postings WHERE session_id = $1) AS dms_posting_count`,
        [sessionId],
      );
      expect(raceEvidence.rows[0]).toEqual({
        state_version: 2,
        exception_status: "RESOLVED",
        exception_version: 2,
        resolution_type: "object",
        target_id: "rec_ro_8004",
        accepted_amount_cents: 112_500,
        allocation_count: 1,
        conflict_audit_count: 1,
        command_receipt_count: 2,
        rejection_receipt_count: 1,
        dms_posting_count: 60,
      });

      const losingCommand = losers[0]!.command;
      const replayedConflict = await resolve("EX-104", losingCommand.targetId, losingCommand.idempotencyKey);
      expect(replayedConflict).toMatchObject({ changed: false, replayed: true, rejected: { code: "VERSION_CONFLICT" } });
      const afterReplay = await pool.query<{ state_version: number; audit_count: number; receipt_count: number }>(
        `SELECT
           (SELECT state_version FROM demo_sessions WHERE id = $1) AS state_version,
           (SELECT count(*)::int FROM audit_events WHERE session_id = $1 AND type = 'STALE_VERSION_CONFLICT') AS audit_count,
           (SELECT count(*)::int FROM product_command_receipts WHERE session_id = $1) AS receipt_count`,
        [sessionId],
      );
      expect(afterReplay.rows[0]).toEqual({ state_version: 2, audit_count: 1, receipt_count: 2 });

      const ex105 = await resolve("EX-105", "PAY-H18401", "postgres-resolve-ex105");
      expect(ex105).toMatchObject({ changed: true });
      expect(ex105).not.toHaveProperty("rejected");
      const ex106 = await resolve("EX-106", "rec_ro_8018", "postgres-resolve-ex106");
      expect(ex106).toMatchObject({ changed: true });
      expect(ex106).not.toHaveProperty("rejected");

      const closed = await mutate((state) => {
        const outcome = engine.closeLocation(state, "roof_nlf", { expectedVersion: 4, idempotencyKey: "postgres-close-ford" });
        return { value: outcome, changed: outcome.changed };
      });
      expect(closed).toMatchObject({ result: { status: "CLOSED", version: 5 } });

      await expect(sqlState(
        `UPDATE operational_closes
         SET closed_by = 'Mallory', attestation = jsonb_set(attestation, '{closedBy}', '"Mallory"')
         WHERE session_id = $1 AND rooftop_id = 'roof_nlf'`,
      )).resolves.toBe("P0001");
      await expect(sqlState(
        `DELETE FROM operational_closes
         WHERE session_id = $1 AND rooftop_id = 'roof_nlf'`,
      )).resolves.toBe("P0001");

      await expect(sqlState(
        `INSERT INTO settlement_adjustments
           (session_id, id, payout_id, amount_cents, code, reason, evidence_record_id,
            note, actor, operation_key, created_at)
         VALUES ($1, 'adjustment_wrong_payout', 'payout_9834', -2500, 'NETWORK_ASSESSMENT',
                 'Invalid cross-payout evidence', 'source_assessment_9842', NULL, 'Probe',
                 'adjustment:wrong-payout', now())`,
      )).resolves.toBe("P0001");
      await expect(sqlState(
        `INSERT INTO settlement_adjustments
           (session_id, id, payout_id, amount_cents, code, reason, evidence_record_id,
            note, actor, operation_key, created_at)
         VALUES ($1, 'adjustment_wrong_amount', 'payout_9842', -2499, 'NETWORK_ASSESSMENT',
                 'Invalid evidence amount', 'source_assessment_9842', NULL, 'Probe',
                 'adjustment:wrong-amount', now())`,
      )).resolves.toBe("P0001");

      const adjusted = await mutate((state) => {
        const outcome = engine.recordAdjustment(state, "payout_9842", {
          expectedVersion: 1,
          idempotencyKey: "postgres-adjust-9842",
          amountCents: -2_500,
          code: "NETWORK_ASSESSMENT",
          evidenceRecordId: "source_assessment_9842",
          note: "PostgreSQL append-only regression proof.",
        });
        return { value: outcome, changed: outcome.changed };
      });
      expect(adjusted).toMatchObject({ result: { status: "RECONCILED", adjustedExpectedCents: 1_871_761, varianceCents: 0 } });

      const finalEvidence = await pool.query<{
        state_version: number;
        refund_link_count: number;
        human_allocation_count: number;
        dms_posting_count: number;
        ford_close_status: string;
        settlement_status_at_close: string;
        ford_verified_count: number;
        adjustment_count: number;
        adjustment_cents: number;
        source_assessment_cents: number;
        payout_status: string;
        original_expected_cents: number;
        adjusted_expected_cents: number;
        observed_bank_cents: number;
        variance_cents: number;
        command_receipt_count: number;
      }>(
        `SELECT
           (SELECT state_version FROM demo_sessions WHERE id = $1) AS state_version,
           (SELECT count(*)::int FROM refund_links WHERE session_id = $1 AND refund_payment_id = 'PAY-105') AS refund_link_count,
           (SELECT count(*)::int FROM payment_allocations WHERE session_id = $1 AND payment_id IN ('PAY-104', 'PAY-106') AND source = 'HUMAN_RESOLUTION') AS human_allocation_count,
           (SELECT count(*)::int FROM dms_postings WHERE session_id = $1) AS dms_posting_count,
           (SELECT status FROM operational_closes WHERE session_id = $1 AND rooftop_id = 'roof_nlf') AS ford_close_status,
           (SELECT attestation ->> 'settlementStatusAtClose' FROM operational_closes WHERE session_id = $1 AND rooftop_id = 'roof_nlf') AS settlement_status_at_close,
           (SELECT verified_posting_count FROM operational_closes WHERE session_id = $1 AND rooftop_id = 'roof_nlf') AS ford_verified_count,
           (SELECT count(*)::int FROM settlement_adjustments WHERE session_id = $1 AND payout_id = 'payout_9842') AS adjustment_count,
           (SELECT amount_cents::int FROM settlement_adjustments WHERE session_id = $1 AND payout_id = 'payout_9842') AS adjustment_cents,
           (SELECT amount_cents::int FROM settlement_source_records WHERE session_id = $1 AND id = 'source_assessment_9842') AS source_assessment_cents,
           (SELECT status FROM processor_payouts WHERE session_id = $1 AND id = 'payout_9842') AS payout_status,
           (SELECT original_expected_cents::int FROM processor_payouts WHERE session_id = $1 AND id = 'payout_9842') AS original_expected_cents,
           (SELECT adjusted_expected_cents::int FROM processor_payouts WHERE session_id = $1 AND id = 'payout_9842') AS adjusted_expected_cents,
           (SELECT observed_bank_cents::int FROM processor_payouts WHERE session_id = $1 AND id = 'payout_9842') AS observed_bank_cents,
           (SELECT variance_cents::int FROM processor_payouts WHERE session_id = $1 AND id = 'payout_9842') AS variance_cents,
           (SELECT count(*)::int FROM product_command_receipts WHERE session_id = $1) AS command_receipt_count`,
        [sessionId],
      );
      expect(finalEvidence.rows[0]).toEqual({
        state_version: 6,
        refund_link_count: 1,
        human_allocation_count: 2,
        dms_posting_count: 62,
        ford_close_status: "CLOSED",
        settlement_status_at_close: "PAYOUT_PENDING",
        ford_verified_count: 27,
        adjustment_count: 1,
        adjustment_cents: -2_500,
        source_assessment_cents: -2_500,
        payout_status: "RECONCILED",
        original_expected_cents: 1_874_261,
        adjusted_expected_cents: 1_871_761,
        observed_bank_cents: 1_871_761,
        variance_cents: 0,
        command_receipt_count: 6,
      });

      const aggregate = await repository.get(sessionId);
      expect(aggregate).toMatchObject({
        session: { version: 6 },
        invariants: { acceptedDecisions: 3, rejectedVersionConflicts: 1, dmsMutations: 62 },
      });
      expect(aggregate?.allocations.filter((item) => item.paymentId === "PAY-104")).toHaveLength(1);
      expect(aggregate?.settlementAdjustments).toHaveLength(1);

      await expect(sqlState(
        `INSERT INTO settlement_adjustments
           (session_id, id, payout_id, amount_cents, code, reason, evidence_record_id,
            note, actor, operation_key, created_at)
         VALUES ($1, 'adjustment_reused_evidence', 'payout_9842', -2500, 'NETWORK_ASSESSMENT',
                 'Invalid reused evidence', 'source_assessment_9842', NULL, 'Probe',
                 'adjustment:reused-evidence', now())`,
      )).resolves.toBe("23505");

      await expect(repository.mutate(sessionId, (state) => {
        const existing = state.allocations[0]!;
        state.allocations.push({ ...existing, id: "alloc_conflicting_identity_probe" });
        return { value: undefined, changed: true };
      })).rejects.toThrow(/reused with a different payload/);
      expect((await repository.get(sessionId))?.allocations.some((item) => item.id === "alloc_conflicting_identity_probe")).toBe(false);

      await expect(sqlState(
        `INSERT INTO payment_allocations
         SELECT session_id, id, payment_id, invoice_id, amount_cents, source, operation_key, created_at
         FROM payment_allocations WHERE session_id = $1 LIMIT 1`,
      )).resolves.toBe("23505");
      await expect(sqlState(
        `INSERT INTO processor_inbox
         SELECT session_id, provider, external_event_id, first_seen_at, delivery_count
         FROM processor_inbox WHERE session_id = $1 LIMIT 1`,
      )).resolves.toBe("23505");
      await expect(sqlState(
        `INSERT INTO dms_postings
         SELECT session_id, operation_key, posting_id, correlation_id, committed_at, payment_id, invoice_id, mutation_kind
         FROM dms_postings WHERE session_id = $1 LIMIT 1`,
      )).resolves.toBe("23505");
      await expect(sqlState(
        `UPDATE settlement_source_records
         SET description = description || ' tampered'
         WHERE session_id = $1 AND id = 'source_assessment_9842'`,
      )).resolves.toBe("P0001");

      await pool.query(
        "UPDATE demo_sessions SET updated_at = now() - interval '241 minutes' WHERE id = $1",
        [sessionId],
      );
      let expiredMutationRan = false;
      expect(await repository.get(sessionId)).toBeNull();
      expect(await repository.mutate(sessionId, () => {
        expiredMutationRan = true;
        return { value: true, changed: true };
      })).toBeNull();
      expect(expiredMutationRan).toBe(false);
    } finally {
      if (sessionCreated) {
        const cleanup = await pool.connect();
        try {
          await cleanup.query("BEGIN");
          await cleanup.query("SET LOCAL postonce.allow_session_reset = 'on'");
          await cleanup.query("DELETE FROM demo_sessions WHERE id = $1", [sessionId]);
          await cleanup.query("COMMIT");
        } catch (error) {
          await cleanup.query("ROLLBACK");
          throw error;
        } finally {
          cleanup.release();
        }
      }
      await pool.end();
      await repository.close();
    }
  }, 20_000);
});
