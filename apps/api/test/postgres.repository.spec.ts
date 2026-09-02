import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { DemoEngine } from "../src/demo/domain/demo.engine.js";
import { createSeedState } from "../src/demo/domain/seed.js";
import { PostgresDemoRepository } from "../src/demo/repositories/postgres-demo.repository.js";

const databaseUrl = process.env.POSTONCE_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("PostgreSQL aggregate lock and relational constraints", () => {
  it("serializes a real resolution race and mirrors one allocation with the snapshot", async () => {
    if (!databaseUrl) return;
    const repository = new PostgresDemoRepository(databaseUrl, 4);
    const pool = new Pool({ connectionString: databaseUrl });
    const engine = new DemoEngine();
    const sessionId = randomUUID();
    await repository.create(createSeedState(sessionId));

    for (const action of ["process-routine", "deliver-duplicate", "simulate-lost-response", "open-ambiguous-exception"] as const) {
      await repository.mutate(sessionId, (state) => {
        const outcome = engine.execute(state, action);
        return { value: outcome, changed: outcome.changed };
      });
    }

    const openException = await pool.query<{
      status: string;
      resolution: unknown;
      resolution_is_sql_null: boolean;
      constraint_state_valid: boolean;
    }>(
      `SELECT status,
              resolution,
              resolution IS NULL AS resolution_is_sql_null,
              ((status = 'OPEN' AND resolution IS NULL)
                OR (status = 'RESOLVED' AND resolution IS NOT NULL)) AS constraint_state_valid
       FROM payment_exceptions
       WHERE session_id = $1 AND id = 'exc_ambiguous_1009'`,
      [sessionId],
    );
    expect(openException.rows).toEqual([{
      status: "OPEN",
      resolution: null,
      resolution_is_sql_null: true,
      constraint_state_valid: true,
    }]);

    const resolve = (operationKey: string, candidateInvoiceId: string) => repository.mutate(sessionId, (state) => {
      const outcome = engine.execute(state, "resolve-exception", {
        operationKey,
        expectedVersion: 1,
        candidateInvoiceId,
        acceptedAmountCents: 49_500,
        reason: "Concurrent PostgreSQL fixture decision.",
        actor: operationKey.includes("maya") ? "Maya Chen" : "Jon Bell",
      });
      return { value: outcome, changed: outcome.changed };
    });

    const raced = await Promise.allSettled([
      resolve("resolve_maya_pg", "inv_8031"),
      resolve("resolve_jon_pg", "inv_8037"),
    ]);
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = raced.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "VERSION_CONFLICT", status: 409 } });

    const resolvedException = await pool.query<{
      status: string;
      version: number;
      resolution: {
        acceptedAmountCents: number;
        candidateInvoiceId: string;
        operationKey: string;
      };
      resolution_type: string | null;
      constraint_state_valid: boolean;
    }>(
      `SELECT status,
              version,
              resolution,
              jsonb_typeof(resolution) AS resolution_type,
              ((status = 'OPEN' AND resolution IS NULL)
                OR (status = 'RESOLVED' AND resolution IS NOT NULL)) AS constraint_state_valid
       FROM payment_exceptions
       WHERE session_id = $1 AND id = 'exc_ambiguous_1009'`,
      [sessionId],
    );
    expect(resolvedException.rows[0]).toMatchObject({
      status: "RESOLVED",
      version: 2,
      resolution_type: "object",
      constraint_state_valid: true,
      resolution: { acceptedAmountCents: 49_500 },
    });
    expect(["inv_8031", "inv_8037"]).toContain(resolvedException.rows[0]?.resolution.candidateInvoiceId);
    expect(["resolve_maya_pg", "resolve_jon_pg"]).toContain(resolvedException.rows[0]?.resolution.operationKey);

    const aggregate = await repository.get(sessionId);
    expect(aggregate?.allocations.filter((allocation) => allocation.paymentId === "pay_1009")).toHaveLength(1);
    const relational = await pool.query(
      `SELECT
         (SELECT state_version FROM demo_sessions WHERE id = $1) AS state_version,
         (SELECT count(*)::int FROM payment_allocations WHERE session_id = $1 AND payment_id = 'pay_1009') AS allocation_count,
         (SELECT count(*)::int FROM payment_exceptions WHERE session_id = $1 AND id = 'exc_ambiguous_1009' AND version = 2) AS resolved_count,
         (SELECT count(*)::int FROM settlement_source_records WHERE session_id = $1) AS settlement_source_count,
         (SELECT count(*)::int FROM dms_postings WHERE session_id = $1 AND posting_id = 'OP-7Q3K') AS recovered_posting_count`,
      [sessionId],
    );
    expect(relational.rows[0]).toMatchObject({
      allocation_count: 1,
      resolved_count: 1,
      settlement_source_count: 2,
      recovered_posting_count: 1,
    });
    expect(relational.rows[0].state_version).toBeGreaterThan(0);

    await expect(repository.mutate(sessionId, (state) => {
      const existing = state.allocations[0]!;
      state.allocations.push({
        ...existing,
        id: "alloc_conflicting_identity_probe",
        paymentId: "pay_1002",
        invoiceId: "inv_8002",
      });
      return { value: undefined, changed: true };
    })).rejects.toThrow(/reused with a different payload/);
    expect((await repository.get(sessionId))?.allocations.filter((allocation) =>
      allocation.id === "alloc_conflicting_identity_probe")).toHaveLength(0);

    const duplicateCode = async (sql: string): Promise<string | undefined> => {
      try {
        await pool.query(sql, [sessionId]);
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    await expect(duplicateCode(
      `INSERT INTO payment_allocations
       SELECT session_id, id, payment_id, invoice_id, amount_cents, source, operation_key, created_at
       FROM payment_allocations WHERE session_id = $1 LIMIT 1`,
    )).resolves.toBe("23505");
    await expect(duplicateCode(
      `INSERT INTO processor_inbox
       SELECT session_id, provider, external_event_id, first_seen_at, delivery_count
       FROM processor_inbox WHERE session_id = $1 LIMIT 1`,
    )).resolves.toBe("23505");
    await expect(duplicateCode(
      `INSERT INTO dms_postings
       SELECT session_id, operation_key, posting_id, correlation_id, committed_at
       FROM dms_postings WHERE session_id = $1 LIMIT 1`,
    )).resolves.toBe("23505");

    const cleanup = await pool.connect();
    await cleanup.query("BEGIN");
    await cleanup.query("SET LOCAL postonce.allow_session_reset = 'on'");
    await cleanup.query("DELETE FROM demo_sessions WHERE id = $1", [sessionId]);
    await cleanup.query("COMMIT");
    cleanup.release();
    await pool.end();
    await repository.close();
  });
});
