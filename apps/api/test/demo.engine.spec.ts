import { randomUUID } from "node:crypto";
import { DemoStateSchema } from "@postonce/contracts";
import { describe, expect, it } from "vitest";
import { DemoEngine } from "../src/demo/domain/demo.engine.js";
import { createSeedState } from "../src/demo/domain/seed.js";

describe("DemoEngine narrative and financial invariants", () => {
  it("keeps cumulative counters and a coherent pending outbox through the lost-response chapter", () => {
    const engine = new DemoEngine();
    const state = createSeedState(randomUUID(), new Date("2026-08-30T23:55:00.000Z"));

    const captures = state.payments.filter((payment) => payment.kind === "CAPTURE");
    expect(captures).toHaveLength(11);
    expect(captures.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(state.totals.grossCents);

    engine.execute(state, "process-routine");
    expect(state.invariants.processorDeliveriesReceived).toBe(10);
    expect(state.invariants.uniqueProcessorEventsApplied).toBe(10);
    expect(state.invariants.duplicateDeliveriesIgnored).toBe(0);
    expect(state.outbox).toHaveLength(9);
    expect(state.outbox.filter((item) => item.status === "DELIVERED")).toHaveLength(8);
    expect(state.outbox.find((item) => item.paymentId === "pay_1003")?.status).toBe("PENDING");

    engine.execute(state, "deliver-duplicate");
    expect(state.invariants.processorDeliveriesReceived).toBe(12);
    expect(state.invariants.uniqueProcessorEventsApplied).toBe(11);
    expect(state.invariants.duplicateDeliveriesIgnored).toBe(1);
    expect(state.allocations.filter((allocation) => allocation.paymentId === "pay_1010")).toHaveLength(1);

    engine.execute(state, "simulate-lost-response");
    expect(state.outbox.find((item) => item.paymentId === "pay_1003")?.status).toBe("DELIVERED");
    expect(state.invariants.dmsAttempts).toBe(11);
    expect(state.invariants.dmsMutations).toBe(10);
    expect(state.invariants.lostResponses).toBe(1);
    expect(state.invariants.retriesResolvedByLookup).toBe(1);

    const lostOperation = state.outbox.find((item) => item.paymentId === "pay_1003")?.operationKey;
    const attempts = state.integrationAttempts.filter((item) => item.operationKey === lostOperation);
    expect(attempts.map((item) => item.status)).toEqual(["RESPONSE_LOST", "REPLAYED"]);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.sanitizedResponse).toMatchObject({ postingId: "OP-7Q3K", committed: true });
    expect(new Set(attempts.map((item) => item.operationKey)).size).toBe(1);
    expect(attempts.at(-1)?.sanitizedResponse).toMatchObject({ postingId: "OP-7Q3K", replay: true });
    expect(DemoStateSchema.safeParse(state).success).toBe(true);
  });

  it("runs the full close with one allocation for each risky event and append-only sequence evidence", () => {
    const engine = new DemoEngine();
    const state = createSeedState(randomUUID(), new Date("2026-08-30T23:55:00.000Z"));
    const result = engine.execute(state, "run-all");

    expect(result.changed).toBe(true);
    expect(state.close.status).toBe("READY");
    expect(state.totals.varianceCents).toBe(0);
    expect(state.invariants.processorDeliveriesReceived).toBe(13);
    expect(state.invariants.uniqueProcessorEventsApplied).toBe(12);
    expect(state.invariants.duplicateDeliveriesIgnored).toBe(1);
    expect(state.invariants.dmsAttempts).toBe(12);
    expect(state.invariants.dmsMutations).toBe(11);
    expect(state.invariants.outboxCreated).toBe(11);
    expect(state.invariants.outboxDelivered).toBe(11);
    expect(state.allocations.filter((allocation) => allocation.paymentId === "pay_1009")).toHaveLength(1);
    expect(state.exceptions[0]).toMatchObject({ status: "RESOLVED", version: 2 });
    expect(state.evidence.race).toMatchObject({ acceptedStatus: 200, rejectedStatus: 409 });
    expect(state.auditEvents.map((event) => event.sequence)).toEqual(
      Array.from({ length: state.auditEvents.length }, (_, index) => index + 1),
    );
    expect(state.evidence.checks.every((check) => check.status === "PASS")).toBe(true);
  });

  it("replays a completed chapter without mutating any state", () => {
    const engine = new DemoEngine();
    const state = createSeedState(randomUUID());
    engine.execute(state, "process-routine");
    const before = structuredClone(state);
    const replay = engine.execute(state, "process-routine");

    expect(replay.replayed).toBe(true);
    expect(replay.changed).toBe(false);
    expect(state).toEqual(before);
  });

  it("rejects a partial manual resolution before it can mark a payment posted", () => {
    const engine = new DemoEngine();
    const state = createSeedState(randomUUID());
    for (const action of ["process-routine", "deliver-duplicate", "simulate-lost-response", "open-ambiguous-exception"] as const) {
      engine.execute(state, action);
    }

    expect(() => engine.execute(state, "resolve-exception", {
      operationKey: "resolve_one_cent",
      expectedVersion: 1,
      candidateInvoiceId: "inv_8031",
      acceptedAmountCents: 1,
      reason: "Synthetic one-cent regression probe.",
      actor: "Regression Reviewer",
    })).toThrow(expect.objectContaining({ code: "RESOLUTION_AMOUNT_MUST_EQUAL_PAYMENT_REMAINDER", status: 422 }));
    expect(state.payments.find((payment) => payment.id === "pay_1009")?.status).toBe("EXCEPTION");
    expect(state.allocations.filter((allocation) => allocation.paymentId === "pay_1009")).toHaveLength(0);
    expect(state.exceptions[0]).toMatchObject({ status: "OPEN", version: 1 });
  });

  it("rejects reuse of a routine operation key for a different resolution payload", () => {
    const engine = new DemoEngine();
    const state = createSeedState(randomUUID());
    for (const action of ["process-routine", "deliver-duplicate", "simulate-lost-response", "open-ambiguous-exception"] as const) {
      engine.execute(state, action);
    }
    const routineKey = state.allocations.find((allocation) => allocation.paymentId === "pay_1001")!.operationKey;

    expect(() => engine.execute(state, "resolve-exception", {
      operationKey: routineKey,
      expectedVersion: 1,
      candidateInvoiceId: "inv_8031",
      acceptedAmountCents: 49_500,
      reason: "Synthetic collision regression probe.",
      actor: "Regression Reviewer",
    })).toThrow(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSE", status: 409 }));
    expect(state.allocations.filter((allocation) => allocation.paymentId === "pay_1009")).toHaveLength(0);
    expect(state.close.status).toBe("BLOCKED");
  });

  it("accepts an identical resolution replay but rejects changed payload under the same key", () => {
    const engine = new DemoEngine();
    const state = createSeedState(randomUUID());
    for (const action of ["process-routine", "deliver-duplicate", "simulate-lost-response", "open-ambiguous-exception"] as const) {
      engine.execute(state, action);
    }
    const command = {
      operationKey: "resolve_identical_replay",
      expectedVersion: 1,
      candidateInvoiceId: "inv_8031",
      acceptedAmountCents: 49_500,
      reason: "Synthetic worksheet confirms the repair order.",
      actor: "Regression Reviewer",
    } as const;
    engine.execute(state, "resolve-exception", command);

    expect(engine.execute(state, "resolve-exception", command)).toMatchObject({ changed: false, replayed: true });
    expect(() => engine.execute(state, "resolve-exception", { ...command, candidateInvoiceId: "inv_8037" }))
      .toThrow(expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSE", status: 409 }));
  });

  it("keeps settlement blocked when the independent bank record has a nonzero variance", () => {
    const engine = new DemoEngine();
    const state = createSeedState(randomUUID());
    for (const action of [
      "process-routine",
      "deliver-duplicate",
      "simulate-lost-response",
      "open-ambiguous-exception",
      "simulate-resolution-race",
    ] as const) {
      engine.execute(state, action);
    }
    state.settlementEvidence.bankDeposit.amountCents -= 1;

    const result = engine.execute(state, "reconcile-settlement");
    expect(result.result).toMatchObject({ matched: false, varianceCents: 1, closeStatus: "BLOCKED" });
    expect(state.close.status).toBe("BLOCKED");
    expect(state.evidence.checks.find((check) => check.id === "settlement")?.status).toBe("PENDING");
    expect(state.auditEvents.at(-1)?.type).toBe("SETTLEMENT_VARIANCE_DETECTED");
  });

  it("refuses close when a capture is not fully posted even with a resolved exception", () => {
    const engine = new DemoEngine();
    const state = createSeedState(randomUUID());
    for (const action of ["process-routine", "deliver-duplicate", "simulate-lost-response", "open-ambiguous-exception"] as const) {
      engine.execute(state, action);
    }
    engine.execute(state, "resolve-exception", {
      operationKey: "resolve_incomplete_close",
      expectedVersion: 1,
      candidateInvoiceId: "inv_8031",
      acceptedAmountCents: 49_500,
      reason: "Synthetic worksheet confirms the repair order.",
      actor: "Regression Reviewer",
    });
    const payment = state.payments.find((item) => item.id === "pay_1009")!;
    payment.status = "MATCHED";

    expect(() => engine.execute(state, "reconcile-settlement"))
      .toThrow(expect.objectContaining({ code: "CLOSE_INCOMPLETE", status: 409 }));
    expect(state.close.status).not.toBe("READY");
  });

  it("finishes run-all after a legitimate manual resolution without fabricating a race", () => {
    const engine = new DemoEngine();
    const state = createSeedState(randomUUID());
    for (const action of ["process-routine", "deliver-duplicate", "simulate-lost-response", "open-ambiguous-exception"] as const) {
      engine.execute(state, action);
    }
    engine.execute(state, "resolve-exception", {
      operationKey: "resolve_before_run_all",
      expectedVersion: 1,
      candidateInvoiceId: "inv_8031",
      acceptedAmountCents: 49_500,
      reason: "Synthetic worksheet confirms the repair order.",
      actor: "Regression Reviewer",
    });

    const outcome = engine.execute(state, "run-all");
    expect(outcome.result).toMatchObject({ closeStatus: "READY" });
    expect(state.completedActions).toContain("simulate-resolution-race");
    expect(state.evidence.race).toMatchObject({ attempted: false, winner: "Regression Reviewer", rejectedStatus: null });
    expect(state.auditEvents.some((event) => event.type === "RACE_SIMULATION_SKIPPED")).toBe(true);
  });
});
