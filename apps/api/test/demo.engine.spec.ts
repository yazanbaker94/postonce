import { createHash, randomUUID } from "node:crypto";
import { WorkspaceStateSchema, type WorkspaceState } from "@postonce/contracts";
import { describe, expect, it } from "vitest";
import { DomainError } from "../src/common/domain-error.js";
import { DemoEngine } from "../src/demo/domain/demo.engine.js";
import { createSeedState } from "../src/demo/domain/seed.js";

const FIXED_NOW = new Date("2026-09-04T22:55:00.000Z");

function newWorkspace(): WorkspaceState {
  return createSeedState(randomUUID(), FIXED_NOW);
}

function signedFridayTotal(state: WorkspaceState, rooftopId: string): number {
  return state.payments
    .filter((payment) => payment.inFridayClose && payment.rooftopId === rooftopId)
    .reduce((total, payment) => total + (payment.kind === "REFUND" ? -payment.amountCents : payment.amountCents), 0);
}

function captureDomainError(operation: () => unknown): DomainError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error("Expected the operation to throw a DomainError");
}

function resolveAllFordExceptions(engine: DemoEngine, state: WorkspaceState): void {
  const resolutions = [
    ["EX-104", "rec_ro_8004", "resolve-ex104-close"],
    ["EX-105", "PAY-H18401", "resolve-ex105-close"],
    ["EX-106", "rec_ro_8018", "resolve-ex106-close"],
  ] as const;
  for (const [exceptionId, targetId, idempotencyKey] of resolutions) {
    const outcome = engine.resolveException(state, exceptionId, {
      expectedVersion: 1,
      idempotencyKey,
      targetId,
    });
    expect(outcome).toMatchObject({ changed: true, replayed: false });
  }
}

describe("PostOnce product workspace engine", () => {
  it("creates the canonical three-rooftop fixture with stable counts, amounts, and failure evidence", () => {
    const engine = new DemoEngine();
    const state = newWorkspace();

    expect(() => engine.assertInvariants(state)).not.toThrow();
    expect(() => WorkspaceStateSchema.parse(state)).not.toThrow();
    expect(state.rooftops.map((item) => item.code)).toEqual(["NLT", "NLF", "NLS"]);
    expect(state.payments).toHaveLength(64);
    const fridayManifest = state.payments.filter((item) => item.inFridayClose);
    expect(fridayManifest).toHaveLength(62);
    expect(createHash("sha256").update(JSON.stringify(fridayManifest)).digest("hex"))
      .toBe("b91345e6cb067ebd1b91a9207a276f47c4917c3f6d6d399b2f4b6d987169e85d");
    expect(state.exceptions.map((item) => item.id)).toEqual(["EX-104", "EX-105", "EX-106"]);

    const checksums = [
      { rooftopId: "roof_nlt", count: 19, total: 1_384_217, departments: { SERVICE: 11, PARTS: 5, SALES: 3 } },
      { rooftopId: "roof_nlf", count: 27, total: 2_160_480, departments: { SERVICE: 16, PARTS: 6, SALES: 5 } },
      { rooftopId: "roof_nls", count: 16, total: 1_139_042, departments: { SERVICE: 9, PARTS: 4, SALES: 3 } },
    ] as const;
    for (const expected of checksums) {
      const payments = state.payments.filter((item) => item.inFridayClose && item.rooftopId === expected.rooftopId);
      expect(payments).toHaveLength(expected.count);
      expect(signedFridayTotal(state, expected.rooftopId)).toBe(expected.total);
      expect(Object.fromEntries(["SERVICE", "PARTS", "SALES"].map((department) => [
        department,
        payments.filter((item) => item.department === department).length,
      ]))).toEqual(expected.departments);
    }

    expect(state.operationalCloses).toEqual(expect.arrayContaining([
      expect.objectContaining({ rooftopId: "roof_nlt", status: "READY", verifiedPostingCount: 19, blockingExceptionCount: 0 }),
      expect.objectContaining({ rooftopId: "roof_nlf", status: "BLOCKED", verifiedPostingCount: 24, blockingExceptionCount: 3 }),
      expect.objectContaining({ rooftopId: "roof_nls", status: "READY", verifiedPostingCount: 16, blockingExceptionCount: 0 }),
    ]));
    expect(state.invariants).toEqual({
      processorDeliveriesReceived: 63,
      uniqueProcessorEventsApplied: 62,
      duplicateDeliveriesIgnored: 1,
      dmsAttempts: 60,
      dmsMutations: 59,
      lostResponses: 1,
      retriesResolvedByLookup: 1,
      acceptedDecisions: 0,
      rejectedVersionConflicts: 0,
      outboxCreated: 59,
      outboxDelivered: 59,
    });

    const duplicate = state.payments.find((item) => item.id === "PAY-1006")!;
    expect(state.inbox.find((item) => item.externalEventId === duplicate.externalEventId)?.deliveryCount).toBe(2);
    expect(state.allocations.filter((item) => item.paymentId === duplicate.id)).toHaveLength(1);
    expect(state.exceptions.some((item) => item.paymentId === duplicate.id)).toBe(false);

    const recovered = state.payments.find((item) => item.id === "PAY-1017")!;
    const recoveryAttempts = state.integrationAttempts.filter((item) =>
      item.system === "LEGACY_DMS" && item.operationKey === recovered.postingOperationKey);
    expect(recoveryAttempts.map((item) => item.status)).toEqual(["RESPONSE_LOST", "FOUND_EXISTING"]);
    expect(new Set(recoveryAttempts.map((item) => item.operationKey))).toHaveLength(1);
    expect(state.allocations.filter((item) => item.paymentId === recovered.id)).toHaveLength(1);

    expect(state.payouts.find((item) => item.id === "payout_9842")).toMatchObject({
      capturedCents: 1_916_245,
      refundCents: 21_900,
      feeCents: 20_084,
      originalExpectedCents: 1_874_261,
      adjustedExpectedCents: 1_874_261,
      observedBankCents: 1_871_761,
      varianceCents: 2_500,
      status: "VARIANCE",
    });
  });

  it("resolves EX-104 once, replays the exact intent, rejects key reuse, and persists stale outcomes", () => {
    const engine = new DemoEngine();
    const state = newWorkspace();
    const command = {
      expectedVersion: 1,
      idempotencyKey: "resolve-ex104-primary",
      targetId: "rec_ro_8004",
    } as const;

    const first = engine.resolveException(state, "EX-104", command);
    expect(first).toMatchObject({
      changed: true,
      replayed: false,
      result: {
        exceptionId: "EX-104",
        status: "RESOLVED",
        version: 2,
        paymentId: "PAY-104",
        dmsState: "VERIFIED",
      },
    });
    expect(state.exceptions.find((item) => item.id === "EX-104")?.resolution).toMatchObject({
      action: "APPLY_TO_RECORD",
      targetId: "rec_ro_8004",
      targetLabel: "RO-8004",
      amountCents: 112_500,
      actor: "Maya Chen",
    });
    expect(state.payments.find((item) => item.id === "PAY-104")).toMatchObject({
      dmsState: "VERIFIED",
      linkedRecordId: "rec_ro_8004",
      sourceReference: "RO-8004",
    });
    expect(state.dmsRecords.find((item) => item.id === "rec_ro_8004")?.balanceCents).toBe(0);
    expect(state.allocations.filter((item) => item.paymentId === "PAY-104")).toEqual([
      expect.objectContaining({ dmsRecordId: "rec_ro_8004", amountCents: 112_500, source: "HUMAN_RESOLUTION" }),
    ]);
    expect(state.outbox.filter((item) => item.paymentId === "PAY-104")).toEqual([
      expect.objectContaining({ mutationKind: "PAYMENT_POST", status: "DELIVERED", attemptCount: 1 }),
    ]);
    expect(state.operationalCloses.find((item) => item.rooftopId === "roof_nlf")).toMatchObject({
      status: "BLOCKED",
      version: 2,
      verifiedPostingCount: 25,
      blockingExceptionCount: 2,
    });

    const countsAfterFirst = {
      allocations: state.allocations.length,
      outbox: state.outbox.length,
      attempts: state.integrationAttempts.length,
      audit: state.auditEvents.length,
      receipts: state.commandReceipts.length,
    };
    const replay = engine.resolveException(state, "EX-104", command);
    expect(replay).toMatchObject({ changed: false, replayed: true, result: first.result });
    expect({
      allocations: state.allocations.length,
      outbox: state.outbox.length,
      attempts: state.integrationAttempts.length,
      audit: state.auditEvents.length,
      receipts: state.commandReceipts.length,
    }).toEqual(countsAfterFirst);

    const collision = captureDomainError(() => engine.resolveException(state, "EX-104", {
      ...command,
      targetId: "rec_ro_8031",
    }));
    expect(collision).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE", status: 409 });

    const staleCommand = {
      expectedVersion: 1,
      idempotencyKey: "resolve-ex104-stale",
      targetId: "rec_ro_8004",
    } as const;
    const stale = engine.resolveException(state, "EX-104", staleCommand);
    expect(stale).toMatchObject({
      changed: true,
      replayed: false,
      rejected: {
        code: "VERSION_CONFLICT",
        status: 409,
        details: { entityId: "EX-104", expectedVersion: 1, actualVersion: 2, winningActor: "Maya Chen" },
      },
    });
    expect(state.exceptions.find((item) => item.id === "EX-104")?.version).toBe(2);
    expect(state.allocations.filter((item) => item.paymentId === "PAY-104")).toHaveLength(1);
    expect(state.auditEvents.filter((item) => item.type === "STALE_VERSION_CONFLICT")).toHaveLength(1);
    expect(state.commandReceipts.filter((item) => item.idempotencyKey === staleCommand.idempotencyKey)).toHaveLength(1);
    expect(state.invariants.rejectedVersionConflicts).toBe(1);

    const staleReplay = engine.resolveException(state, "EX-104", staleCommand);
    expect(staleReplay).toMatchObject({
      changed: false,
      replayed: true,
      rejected: { code: "VERSION_CONFLICT", correlationId: stale.rejected?.correlationId },
    });
    expect(state.auditEvents.filter((item) => item.type === "STALE_VERSION_CONFLICT")).toHaveLength(1);
    expect(state.commandReceipts.filter((item) => item.idempotencyKey === staleCommand.idempotencyKey)).toHaveLength(1);
    expect(() => WorkspaceStateSchema.parse(state)).not.toThrow();
  });

  it("links EX-105 to one original payment and completes EX-106 split arithmetic", () => {
    const engine = new DemoEngine();
    const state = newWorkspace();

    const refund = engine.resolveException(state, "EX-105", {
      expectedVersion: 1,
      idempotencyKey: "resolve-ex105-primary",
      targetId: "PAY-H18401",
    });
    expect(refund).toMatchObject({
      result: {
        resolution: { action: "LINK_REFUND", targetId: "PAY-H18401", amountCents: 21_900 },
        paymentId: "PAY-105",
        dmsState: "VERIFIED",
      },
    });
    expect(state.refundLinks).toEqual([
      expect.objectContaining({
        refundPaymentId: "PAY-105",
        originalPaymentId: "PAY-H18401",
        dmsRecordId: "rec_p_18401",
        actor: "Maya Chen",
      }),
    ]);
    expect(state.outbox.find((item) => item.paymentId === "PAY-105")).toMatchObject({
      mutationKind: "REFUND_LINK",
      dmsRecordId: "rec_p_18401",
      status: "DELIVERED",
    });

    const splitRecord = state.dmsRecords.find((item) => item.id === "rec_ro_8018")!;
    expect(splitRecord).toMatchObject({ customerPayCents: 400_000, balanceCents: 245_000 });
    expect(state.allocations.filter((item) => item.dmsRecordId === splitRecord.id)).toEqual([
      expect.objectContaining({ paymentId: "PAY-2014", amountCents: 155_000 }),
    ]);

    const split = engine.resolveException(state, "EX-106", {
      expectedVersion: 1,
      idempotencyKey: "resolve-ex106-primary",
      targetId: "rec_ro_8018",
    });
    expect(split).toMatchObject({
      result: {
        resolution: { action: "ATTACH_SPLIT", targetId: "rec_ro_8018", amountCents: 245_000 },
        paymentId: "PAY-106",
      },
    });
    const splitAllocations = state.allocations.filter((item) => item.dmsRecordId === splitRecord.id);
    expect(splitAllocations).toHaveLength(2);
    expect(splitAllocations.reduce((total, item) => total + item.amountCents, 0)).toBe(400_000);
    expect(splitAllocations.map((item) => item.paymentId)).toEqual(["PAY-2014", "PAY-106"]);
    expect(splitRecord.balanceCents).toBe(0);
    expect(state.refundLinks).toHaveLength(1);
    expect(state.invariants.acceptedDecisions).toBe(2);
    expect(() => engine.assertInvariants(state)).not.toThrow();
  });

  it("closes each rooftop independently with a frozen operational attestation while payout is pending", () => {
    const engine = new DemoEngine();
    const state = newWorkspace();
    const fordBefore = structuredClone(state.operationalCloses.find((item) => item.rooftopId === "roof_nlf"));

    const toyotaCommand = { expectedVersion: 1, idempotencyKey: "close-toyota-primary" } as const;
    const toyota = engine.closeLocation(state, "roof_nlt", toyotaCommand);
    expect(toyota).toMatchObject({
      changed: true,
      replayed: false,
      result: {
        rooftopId: "roof_nlt",
        status: "CLOSED",
        version: 2,
        closedBy: "Maya Chen",
        attestation: {
          paymentCount: 19,
          verifiedPostingCount: 19,
          blockingExceptionCount: 0,
          settlementStatusAtClose: "PAYOUT_PENDING",
        },
      },
    });
    expect(state.operationalCloses.find((item) => item.rooftopId === "roof_nlf")).toEqual(fordBefore);
    expect(engine.closeLocation(state, "roof_nlt", toyotaCommand)).toMatchObject({ changed: false, replayed: true });

    const crossScopeCollision = captureDomainError(() => engine.closeLocation(state, "roof_nls", toyotaCommand));
    expect(crossScopeCollision).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE", status: 409 });

    const blocked = captureDomainError(() => engine.closeLocation(state, "roof_nlf", {
      expectedVersion: 1,
      idempotencyKey: "close-ford-blocked",
    }));
    expect(blocked).toMatchObject({
      code: "CLOSE_BLOCKED",
      status: 409,
      details: {
        paymentCount: 27,
        verifiedPostingCount: 24,
        blockingExceptionCount: 3,
        settlementStatus: "PAYOUT_PENDING",
      },
    });
    expect(state.commandReceipts.some((item) => item.idempotencyKey === "close-ford-blocked")).toBe(false);

    resolveAllFordExceptions(engine, state);
    expect(state.operationalCloses.find((item) => item.rooftopId === "roof_nlf")).toMatchObject({
      status: "READY",
      version: 4,
      verifiedPostingCount: 27,
      blockingExceptionCount: 0,
      settlementStatus: "PAYOUT_PENDING",
    });
    const ford = engine.closeLocation(state, "roof_nlf", {
      expectedVersion: 4,
      idempotencyKey: "close-ford-primary",
    });
    expect(ford.result).toMatchObject({
      rooftopId: "roof_nlf",
      status: "CLOSED",
      version: 5,
      attestation: {
        paymentCount: 27,
        verifiedPostingCount: 27,
        blockingExceptionCount: 0,
        settlementStatusAtClose: "PAYOUT_PENDING",
      },
    });
    expect(state.operationalCloses.find((item) => item.rooftopId === "roof_nls")?.status).toBe("READY");
    expect(() => engine.assertInvariants(state)).not.toThrow();
  });

  it("records a signed append-only settlement adjustment without rewriting source evidence", () => {
    const engine = new DemoEngine();
    const state = newWorkspace();
    const sourceBefore = structuredClone(state.payoutSourceRecords);
    const command = {
      expectedVersion: 1,
      idempotencyKey: "adjust-payout-9842",
      amountCents: -2_500,
      code: "NETWORK_ASSESSMENT",
      evidenceRecordId: "source_assessment_9842",
      note: "Confirmed against the processor assessment notice.",
    } as const;

    const outcome = engine.recordAdjustment(state, "payout_9842", command);
    expect(outcome).toMatchObject({
      changed: true,
      replayed: false,
      result: {
        payoutId: "payout_9842",
        status: "RECONCILED",
        version: 2,
        originalExpectedCents: 1_874_261,
        adjustmentTotalCents: -2_500,
        adjustedExpectedCents: 1_871_761,
        observedBankCents: 1_871_761,
        varianceCents: 0,
        reconciledBy: "Maya Chen",
      },
    });
    expect(state.payoutSourceRecords).toEqual(sourceBefore);
    expect(state.settlementAdjustments).toEqual([
      expect.objectContaining({
        payoutId: "payout_9842",
        amountCents: -2_500,
        code: "NETWORK_ASSESSMENT",
        evidenceRecordId: "source_assessment_9842",
        actor: "Maya Chen",
      }),
    ]);
    expect(state.payouts.find((item) => item.id === "payout_9842")).toMatchObject({
      originalExpectedCents: 1_874_261,
      adjustedExpectedCents: 1_871_761,
      observedBankCents: 1_871_761,
      varianceCents: 0,
      status: "RECONCILED",
      version: 2,
    });
    expect(state.auditEvents.at(-1)).toMatchObject({
      type: "SETTLEMENT_ADJUSTMENT_RECORDED",
      entityId: "payout_9842",
      details: { adjustmentCents: -2_500, evidenceRecordId: "source_assessment_9842", varianceCents: 0 },
    });

    const counts = { adjustments: state.settlementAdjustments.length, audit: state.auditEvents.length, receipts: state.commandReceipts.length };
    expect(engine.recordAdjustment(state, "payout_9842", command)).toMatchObject({ changed: false, replayed: true });
    expect({ adjustments: state.settlementAdjustments.length, audit: state.auditEvents.length, receipts: state.commandReceipts.length }).toEqual(counts);

    const stale = engine.recordAdjustment(state, "payout_9842", {
      ...command,
      idempotencyKey: "adjust-payout-stale",
    });
    expect(stale).toMatchObject({
      changed: true,
      rejected: { code: "VERSION_CONFLICT", details: { expectedVersion: 1, actualVersion: 2, status: "RECONCILED", varianceCents: 0 } },
    });
    expect(state.settlementAdjustments).toHaveLength(1);

    const invalidState = newWorkspace();
    const invalidEvidence = captureDomainError(() => engine.recordAdjustment(invalidState, "payout_9842", {
      ...command,
      idempotencyKey: "adjust-invalid-evidence",
      evidenceRecordId: "source_bank_9842",
    }));
    expect(invalidEvidence).toMatchObject({ code: "INVALID_ADJUSTMENT_EVIDENCE", status: 422 });
    expect(invalidState.settlementAdjustments).toHaveLength(0);
    expect(() => WorkspaceStateSchema.parse(state)).not.toThrow();
  });
});
