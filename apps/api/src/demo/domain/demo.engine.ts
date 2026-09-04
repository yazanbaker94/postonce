import { createHash } from "node:crypto";
import {
  WORKSPACE_BUSINESS_DATE,
  type Allocation,
  type AuditEvent,
  type CloseLocationRequest,
  type CommandReceipt,
  type DemoException,
  type DmsRecord,
  type IntegrationAttempt,
  type OutboxItem,
  type Payment,
  type ProcessorPayout,
  type ResolveExceptionRequest,
  type SettlementAdjustmentRequest,
  type WorkspaceState,
} from "@postonce/contracts";
import { DomainError } from "../../common/domain-error.js";

export type EngineRejection = {
  code: "VERSION_CONFLICT";
  message: string;
  status: 409;
  correlationId: string;
  details: Record<string, unknown>;
};

export type EngineOutcome = {
  changed: boolean;
  replayed: boolean;
  result: Record<string, unknown>;
  rejected?: EngineRejection;
};

type CloseProof = {
  paymentCount: number;
  verifiedPostingCount: number;
  blockingExceptionCount: number;
  settlementStatus: WorkspaceState["operationalCloses"][number]["settlementStatus"];
  status: "PROCESSING" | "BLOCKED" | "READY";
};

type ResolutionAction = "APPLY_TO_RECORD" | "LINK_REFUND" | "ATTACH_SPLIT";

type ResolutionEffect = {
  action: ResolutionAction;
  targetId: string;
  targetLabel: string;
  amountCents: number;
  verifiedAt: string;
};

const FIXTURE_TOTALS: Record<string, { count: number; signedTotalCents: number }> = {
  roof_nlt: { count: 19, signedTotalCents: 1_384_217 },
  roof_nlf: { count: 27, signedTotalCents: 2_160_480 },
  roof_nls: { count: 16, signedTotalCents: 1_139_042 },
};

const FIXTURE_DEPARTMENTS: Record<string, Record<Payment["department"], number>> = {
  roof_nlt: { SERVICE: 11, PARTS: 5, SALES: 3 },
  roof_nlf: { SERVICE: 16, PARTS: 6, SALES: 5 },
  roof_nls: { SERVICE: 9, PARTS: 4, SALES: 3 },
};

const COMMAND_TIMES = [
  "2026-09-04T22:52:00.000Z",
  "2026-09-04T22:55:00.000Z",
  "2026-09-04T22:58:00.000Z",
  "2026-09-04T23:02:00.000Z",
  "2026-09-04T23:05:00.000Z",
] as const;

export class DemoEngine {
  resolveException(
    state: WorkspaceState,
    exceptionId: string,
    request: ResolveExceptionRequest,
  ): EngineOutcome {
    const scope = `exception:${exceptionId}:resolve`;
    const fingerprint = this.fingerprint(scope, {
      expectedVersion: request.expectedVersion,
      targetId: request.targetId,
    });
    const replay = this.replayCommand(state, request.idempotencyKey, scope, fingerprint);
    if (replay) return replay;

    const exception = this.requireException(state, exceptionId);
    if (request.expectedVersion !== exception.version) {
      return this.recordVersionConflict(state, {
        scope,
        idempotencyKey: request.idempotencyKey,
        fingerprint,
        entityType: "exception",
        entityId: exception.id,
        expectedVersion: request.expectedVersion,
        actualVersion: exception.version,
        message: "This item was already changed by another operation.",
        extraDetails: {
          winningActor: exception.resolution?.actor ?? null,
          winningResolution: exception.resolution,
        },
      });
    }
    if (exception.status !== "OPEN") {
      throw new DomainError(
        "EXCEPTION_ALREADY_RESOLVED",
        "This exception is already resolved. Reload the latest record.",
        409,
        { exceptionId: exception.id, version: exception.version, resolution: exception.resolution },
      );
    }

    const candidate = exception.candidates.find((item) =>
      item.targetId === request.targetId || item.id === request.targetId);
    if (!candidate) {
      throw new DomainError(
        "INVALID_EXCEPTION_TARGET",
        "Choose one of the evidence-backed records for this exception.",
        422,
        { exceptionId: exception.id, targetId: request.targetId },
      );
    }

    const payment = this.requirePayment(state, exception.paymentId);
    this.assertExceptionIdentity(exception, payment);
    const commandAt = this.nextCommandTime(state);
    const operationKey = this.operationKey("resolve", exception.id, request.idempotencyKey);
    let effect: ResolutionEffect;

    switch (exception.type) {
      case "AMBIGUOUS_MATCH":
        effect = this.resolveCaptureToRecord(state, exception, payment, candidate.targetId, operationKey, commandAt, "APPLY_TO_RECORD");
        break;
      case "SPLIT_ALLOCATION":
        effect = this.resolveCaptureToRecord(state, exception, payment, candidate.targetId, operationKey, commandAt, "ATTACH_SPLIT");
        break;
      case "UNMATCHED_REFUND":
        effect = this.resolveRefund(state, exception, payment, candidate.targetId, operationKey, commandAt);
        break;
      case "UNMATCHED_PAYMENT":
      case "POSTING_STATUS_UNKNOWN":
        throw new DomainError(
          "UNSUPPORTED_EXCEPTION_RESOLUTION",
          "This exception type does not have a configured deterministic resolution.",
          422,
          { exceptionId: exception.id, type: exception.type },
        );
    }

    exception.status = "RESOLVED";
    exception.version += 1;
    exception.resolution = {
      action: effect.action,
      targetId: effect.targetId,
      targetLabel: effect.targetLabel,
      amountCents: effect.amountCents,
      actor: state.user.name,
      reason: this.resolutionReason(exception, effect.targetLabel),
      operationKey,
      resolvedAt: effect.verifiedAt,
    };
    state.invariants.acceptedDecisions += 1;

    const close = this.recalculateLocationClose(state, exception.rooftopId);
    const result: Record<string, unknown> = {
      exceptionId: exception.id,
      status: exception.status,
      version: exception.version,
      resolution: exception.resolution,
      paymentId: payment.id,
      dmsState: payment.dmsState,
      locationClose: close,
    };
    this.appendAudit(state, {
      type: "EXCEPTION_RESOLVED",
      entityType: "exception",
      entityId: exception.id,
      actor: state.user.name,
      occurredAt: effect.verifiedAt,
      correlationId: this.correlationId(exception.id, request.idempotencyKey),
      summary: this.resolutionSummary(exception, payment, effect.targetLabel),
      details: {
        previousVersion: request.expectedVersion,
        resultingVersion: exception.version,
        paymentId: payment.id,
        targetId: effect.targetId,
        targetLabel: effect.targetLabel,
        amountCents: effect.amountCents,
        operationKey,
        postingVerified: true,
      },
    });
    this.recordCommand(state, request.idempotencyKey, scope, fingerprint, result, effect.verifiedAt);
    this.assertInvariants(state);
    return { changed: true, replayed: false, result };
  }

  closeLocation(
    state: WorkspaceState,
    rooftopId: string,
    request: CloseLocationRequest,
  ): EngineOutcome {
    const scope = `close:${rooftopId}:${WORKSPACE_BUSINESS_DATE}`;
    const fingerprint = this.fingerprint(scope, { expectedVersion: request.expectedVersion });
    const replay = this.replayCommand(state, request.idempotencyKey, scope, fingerprint);
    if (replay) return replay;

    const close = this.requireClose(state, rooftopId);
    if (request.expectedVersion !== close.version) {
      return this.recordVersionConflict(state, {
        scope,
        idempotencyKey: request.idempotencyKey,
        fingerprint,
        entityType: "operational_close",
        entityId: close.id,
        expectedVersion: request.expectedVersion,
        actualVersion: close.version,
        message: "This location close changed before the request was applied.",
        extraDetails: { status: close.status, closedBy: close.closedBy, closedAt: close.closedAt },
      });
    }
    if (close.status === "CLOSED") {
      throw new DomainError(
        "LOCATION_ALREADY_CLOSED",
        "This location is already closed. Reload the latest close record.",
        409,
        { rooftopId, closedBy: close.closedBy, closedAt: close.closedAt },
      );
    }

    const proof = this.computeCloseProof(state, rooftopId);
    if (proof.status !== "READY") {
      throw new DomainError(
        "CLOSE_BLOCKED",
        "Resolve all operational work and verify every posting before closing this location.",
        409,
        {
          rooftopId,
          paymentCount: proof.paymentCount,
          verifiedPostingCount: proof.verifiedPostingCount,
          blockingExceptionCount: proof.blockingExceptionCount,
          settlementStatus: proof.settlementStatus,
        },
      );
    }

    const closedAt = this.nextCommandTime(state);
    close.paymentCount = proof.paymentCount;
    close.verifiedPostingCount = proof.verifiedPostingCount;
    close.blockingExceptionCount = proof.blockingExceptionCount;
    close.settlementStatus = proof.settlementStatus;
    close.status = "CLOSED";
    close.version += 1;
    close.closedBy = state.user.name;
    close.closedAt = closedAt;
    close.attestation = {
      paymentCount: proof.paymentCount,
      verifiedPostingCount: proof.verifiedPostingCount,
      blockingExceptionCount: proof.blockingExceptionCount,
      settlementStatusAtClose: proof.settlementStatus,
    };

    const rooftop = this.requireRooftop(state, rooftopId);
    const result: Record<string, unknown> = {
      rooftopId,
      status: close.status,
      version: close.version,
      closedBy: close.closedBy,
      closedAt: close.closedAt,
      attestation: close.attestation,
    };
    this.appendAudit(state, {
      type: "LOCATION_CLOSED",
      entityType: "operational_close",
      entityId: close.id,
      actor: state.user.name,
      occurredAt: closedAt,
      correlationId: this.correlationId(close.id, request.idempotencyKey),
      summary: `Closed ${rooftop.name}`,
      details: {
        rooftopId,
        businessDate: close.businessDate,
        paymentCount: proof.paymentCount,
        verifiedPostingCount: proof.verifiedPostingCount,
        blockingExceptionCount: proof.blockingExceptionCount,
        settlementStatusAtClose: proof.settlementStatus,
        payoutPendingWasNormal: proof.settlementStatus === "PAYOUT_PENDING",
      },
    });
    this.recordCommand(state, request.idempotencyKey, scope, fingerprint, result, closedAt);
    this.assertInvariants(state);
    return { changed: true, replayed: false, result };
  }

  recordAdjustment(
    state: WorkspaceState,
    payoutId: string,
    request: SettlementAdjustmentRequest,
  ): EngineOutcome {
    const scope = `payout:${payoutId}:adjustment`;
    const fingerprint = this.fingerprint(scope, {
      expectedVersion: request.expectedVersion,
      amountCents: request.amountCents,
      code: request.code,
      evidenceRecordId: request.evidenceRecordId,
      note: request.note ?? null,
    });
    const replay = this.replayCommand(state, request.idempotencyKey, scope, fingerprint);
    if (replay) return replay;

    const payout = this.requirePayout(state, payoutId);
    if (request.expectedVersion !== payout.version) {
      return this.recordVersionConflict(state, {
        scope,
        idempotencyKey: request.idempotencyKey,
        fingerprint,
        entityType: "processor_payout",
        entityId: payout.id,
        expectedVersion: request.expectedVersion,
        actualVersion: payout.version,
        message: "This payout changed before the adjustment was applied.",
        extraDetails: { status: payout.status, varianceCents: payout.varianceCents },
      });
    }
    if (payout.status === "RECONCILED") {
      throw new DomainError(
        "PAYOUT_ALREADY_RECONCILED",
        "This payout is already reconciled.",
        409,
        { payoutId, reconciledBy: payout.reconciledBy, reconciledAt: payout.reconciledAt },
      );
    }
    if (payout.status !== "VARIANCE") {
      throw new DomainError(
        "PAYOUT_NOT_ADJUSTABLE",
        "Only a payout with a supported variance can be adjusted.",
        422,
        { payoutId, status: payout.status },
      );
    }

    const evidence = state.payoutSourceRecords.find((item) => item.id === request.evidenceRecordId);
    if (
      !evidence ||
      evidence.payoutId !== payout.id ||
      evidence.component !== "NETWORK_ASSESSMENT_NOTICE" ||
      evidence.amountCents !== request.amountCents
    ) {
      throw new DomainError(
        "INVALID_ADJUSTMENT_EVIDENCE",
        "The adjustment must match the payout's stored network-assessment evidence.",
        422,
        { payoutId, evidenceRecordId: request.evidenceRecordId, amountCents: request.amountCents },
      );
    }
    if (state.settlementAdjustments.some((item) => item.evidenceRecordId === evidence.id)) {
      throw new DomainError(
        "ADJUSTMENT_EVIDENCE_ALREADY_USED",
        "This source evidence already supports a recorded adjustment.",
        409,
        { payoutId, evidenceRecordId: evidence.id },
      );
    }
    if (payout.originalExpectedCents === null || payout.observedBankCents === null) {
      throw new DomainError(
        "PAYOUT_COMPONENTS_INCOMPLETE",
        "Expected and observed payout amounts are required before recording an adjustment.",
        422,
        { payoutId },
      );
    }

    const createdAt = this.nextCommandTime(state);
    const operationKey = this.operationKey("adjust", payout.id, request.idempotencyKey);
    state.settlementAdjustments.push({
      id: `adjustment_${payout.id}_${String(state.settlementAdjustments.length + 1).padStart(2, "0")}`,
      payoutId: payout.id,
      amountCents: request.amountCents,
      code: request.code,
      reason: "Network assessment adjustment supported by processor settlement evidence.",
      evidenceRecordId: evidence.id,
      note: request.note ?? null,
      actor: state.user.name,
      operationKey,
      createdAt,
    });

    const adjustmentTotalCents = this.sum(
      state.settlementAdjustments.filter((item) => item.payoutId === payout.id),
      (item) => item.amountCents,
    );
    payout.adjustedExpectedCents = payout.originalExpectedCents + adjustmentTotalCents;
    payout.varianceCents = payout.adjustedExpectedCents - payout.observedBankCents;
    payout.status = payout.varianceCents === 0 ? "RECONCILED" : "VARIANCE";
    payout.version += 1;
    payout.reconciledBy = payout.status === "RECONCILED" ? state.user.name : null;
    payout.reconciledAt = payout.status === "RECONCILED" ? createdAt : null;

    const rooftop = this.requireRooftop(state, payout.rooftopId);
    const result: Record<string, unknown> = {
      payoutId: payout.id,
      status: payout.status,
      version: payout.version,
      originalExpectedCents: payout.originalExpectedCents,
      adjustmentTotalCents,
      adjustedExpectedCents: payout.adjustedExpectedCents,
      observedBankCents: payout.observedBankCents,
      varianceCents: payout.varianceCents,
      reconciledBy: payout.reconciledBy,
      reconciledAt: payout.reconciledAt,
    };
    this.appendAudit(state, {
      type: "SETTLEMENT_ADJUSTMENT_RECORDED",
      entityType: "processor_payout",
      entityId: payout.id,
      actor: state.user.name,
      occurredAt: createdAt,
      correlationId: this.correlationId(payout.id, request.idempotencyKey),
      summary: `Recorded -$25.00 network assessment adjustment for ${rooftop.name}`,
      details: {
        payoutId: payout.id,
        evidenceRecordId: evidence.id,
        originalExpectedCents: payout.originalExpectedCents,
        adjustmentCents: request.amountCents,
        adjustedExpectedCents: payout.adjustedExpectedCents,
        observedBankCents: payout.observedBankCents,
        varianceCents: payout.varianceCents,
        operationKey,
      },
    });
    this.recordCommand(state, request.idempotencyKey, scope, fingerprint, result, createdAt);
    this.assertInvariants(state);
    return { changed: true, replayed: false, result };
  }

  assertInvariants(state: WorkspaceState): void {
    const fridayPayments = state.payments.filter((payment) =>
      payment.inFridayClose && payment.businessDate === WORKSPACE_BUSINESS_DATE);
    this.invariant(fridayPayments.length === 62, "Friday close must contain exactly 62 payments");
    this.invariant(state.rooftops.length === 3, "Workspace must contain exactly three rooftops");

    for (const [rooftopId, expected] of Object.entries(FIXTURE_TOTALS)) {
      const payments = fridayPayments.filter((payment) => payment.rooftopId === rooftopId);
      const signedTotal = this.sum(payments, (payment) =>
        payment.kind === "REFUND" ? -payment.amountCents : payment.amountCents);
      this.invariant(payments.length === expected.count, `${rooftopId} payment count changed`);
      this.invariant(signedTotal === expected.signedTotalCents, `${rooftopId} processed total changed`);
      const departments = FIXTURE_DEPARTMENTS[rooftopId]!;
      for (const department of ["SERVICE", "PARTS", "SALES"] as const) {
        this.invariant(
          payments.filter((payment) => payment.department === department).length === departments[department],
          `${rooftopId} ${department.toLowerCase()} payment distribution changed`,
        );
      }
    }

    const cents = [
      ...state.payments.map((item) => item.amountCents),
      ...state.dmsRecords.flatMap((item) => [item.customerPayCents, item.balanceCents]),
      ...state.allocations.map((item) => item.amountCents),
      ...state.payouts.flatMap((item) => [
        item.capturedCents,
        item.refundCents,
        item.feeCents,
        item.originalExpectedCents,
        item.adjustedExpectedCents,
        item.observedBankCents,
        item.varianceCents,
      ]).filter((item): item is number => item !== null),
      ...state.payoutSourceRecords.map((item) => item.amountCents),
      ...state.settlementAdjustments.map((item) => item.amountCents),
    ];
    this.invariant(cents.every(Number.isInteger), "Every monetary value must use integer cents");
    this.invariant(state.payments.every((item) => item.amountCents > 0), "Payments store positive absolute cents");

    this.assertUnique(state.payments.map((item) => item.id), "payment ids");
    this.assertUnique(state.payments.map((item) => `${item.provider}:${item.externalEventId}`), "processor event ids");
    this.assertUnique(state.dmsRecords.map((item) => item.id), "DMS record ids");
    this.assertUnique(state.allocations.map((item) => item.id), "allocation ids");
    this.assertUnique(state.allocations.map((item) => item.operationKey), "allocation operation keys");
    this.assertUnique(state.refundLinks.map((item) => item.refundPaymentId), "refund payment links");
    this.assertUnique(state.refundLinks.map((item) => item.operationKey), "refund operation keys");
    this.assertUnique(state.outbox.map((item) => item.id), "outbox ids");
    this.assertUnique(state.outbox.map((item) => item.operationKey), "outbox operation keys");
    this.assertUnique(state.exceptions.map((item) => item.id), "exception ids");
    this.assertUnique(state.operationalCloses.map((item) => `${item.rooftopId}:${item.businessDate}`), "location closes");
    this.assertUnique(state.payouts.map((item) => item.id), "payout ids");
    this.assertUnique(state.payoutSourceRecords.map((item) => item.id), "payout source ids");
    this.assertUnique(state.settlementAdjustments.map((item) => item.id), "adjustment ids");
    this.assertUnique(state.settlementAdjustments.map((item) => item.operationKey), "adjustment operation keys");
    this.assertUnique(state.commandReceipts.map((item) => item.idempotencyKey), "command idempotency keys");

    const receiptKeys = new Set(state.inbox.map((item) => `${item.provider}:${item.externalEventId}`));
    this.invariant(receiptKeys.size === state.inbox.length, "Inbox receipts must be unique");
    for (const payment of fridayPayments) {
      this.invariant(receiptKeys.has(`${payment.provider}:${payment.externalEventId}`), `Inbox receipt missing for ${payment.id}`);
    }
    const receivedDeliveries = this.sum(state.inbox, (item) => item.deliveryCount);
    const duplicateDeliveries = this.sum(state.inbox, (item) => item.deliveryCount - 1);
    this.invariant(state.invariants.processorDeliveriesReceived === receivedDeliveries, "Processor delivery counter drifted");
    this.invariant(state.invariants.uniqueProcessorEventsApplied === state.inbox.length, "Unique processor event counter drifted");
    this.invariant(state.invariants.duplicateDeliveriesIgnored === duplicateDeliveries, "Duplicate delivery counter drifted");

    for (const allocation of state.allocations) {
      const payment = this.requirePayment(state, allocation.paymentId);
      const record = this.requireDmsRecord(state, allocation.dmsRecordId);
      this.invariant(payment.rooftopId === record.rooftopId, `Cross-rooftop allocation ${allocation.id}`);
      this.invariant(payment.department === record.department, `Cross-department allocation ${allocation.id}`);
      this.invariant(payment.currency === record.currency, `Cross-currency allocation ${allocation.id}`);
    }
    for (const payment of state.payments) {
      const allocatedCents = this.sum(
        state.allocations.filter((item) => item.paymentId === payment.id),
        (item) => item.amountCents,
      );
      this.invariant(allocatedCents <= payment.amountCents, `Payment ${payment.id} is over-allocated`);
      if (payment.inFridayClose && payment.kind === "CAPTURE" && payment.dmsState === "VERIFIED") {
        this.invariant(allocatedCents === payment.amountCents, `Verified capture ${payment.id} is not fully allocated`);
        this.invariant(payment.postingOperationKey !== null, `Verified capture ${payment.id} has no operation key`);
        this.invariant(payment.postedAt !== null && payment.verifiedAt !== null, `Verified capture ${payment.id} lacks posting timestamps`);
        this.invariant(
          state.outbox.some((item) =>
            item.paymentId === payment.id &&
            item.operationKey === payment.postingOperationKey &&
            item.status === "DELIVERED"),
          `Verified capture ${payment.id} lacks delivered posting intent`,
        );
      }
      if (payment.inFridayClose && payment.kind === "REFUND" && payment.dmsState === "VERIFIED") {
        this.invariant(
          state.refundLinks.filter((item) => item.refundPaymentId === payment.id).length === 1,
          `Verified refund ${payment.id} must have exactly one original link`,
        );
        this.invariant(
          state.outbox.some((item) =>
            item.paymentId === payment.id &&
            item.operationKey === payment.postingOperationKey &&
            item.status === "DELIVERED"),
          `Verified refund ${payment.id} lacks delivered posting intent`,
        );
      }
    }
    for (const record of state.dmsRecords) {
      this.invariant(record.balanceCents >= 0 && record.balanceCents <= record.customerPayCents, `Invalid balance on ${record.id}`);
      const allocations = state.allocations.filter((item) => item.dmsRecordId === record.id);
      const allocatedCents = this.sum(allocations, (item) => item.amountCents);
      this.invariant(allocatedCents <= record.customerPayCents, `DMS record ${record.id} is over-allocated`);
      if (allocations.length > 0) {
        this.invariant(
          record.balanceCents === record.customerPayCents - allocatedCents,
          `DMS record balance drifted for ${record.id}`,
        );
      }
    }

    for (const link of state.refundLinks) {
      const refund = this.requirePayment(state, link.refundPaymentId);
      const original = this.requirePayment(state, link.originalPaymentId);
      const record = this.requireDmsRecord(state, link.dmsRecordId);
      this.invariant(refund.kind === "REFUND" && original.kind === "CAPTURE", `Invalid refund relationship ${link.id}`);
      this.invariant(refund.rooftopId === original.rooftopId && original.rooftopId === record.rooftopId, `Cross-rooftop refund ${link.id}`);
      this.invariant(refund.department === original.department && original.department === record.department, `Cross-department refund ${link.id}`);
      this.invariant(original.linkedRecordId === record.id, `Refund ${link.id} points to the wrong DMS record`);
      this.invariant(refund.amountCents <= original.amountCents, `Refund ${link.id} exceeds its original payment`);
    }
    for (const original of state.payments.filter((item) => item.kind === "CAPTURE")) {
      const linkedRefundCents = this.sum(
        state.refundLinks.filter((item) => item.originalPaymentId === original.id),
        (item) => this.requirePayment(state, item.refundPaymentId).amountCents,
      );
      this.invariant(linkedRefundCents <= original.amountCents, `Refunds exceed original payment ${original.id}`);
    }

    for (const item of state.outbox) {
      if (item.mutationKind === "PAYMENT_POST") {
        this.invariant(
          state.allocations.some((allocation) =>
            allocation.paymentId === item.paymentId &&
            allocation.dmsRecordId === item.dmsRecordId &&
            allocation.operationKey === item.operationKey),
          `Payment outbox ${item.id} has no matching allocation`,
        );
      } else {
        this.invariant(
          state.refundLinks.some((link) =>
            link.refundPaymentId === item.paymentId &&
            link.dmsRecordId === item.dmsRecordId &&
            link.operationKey === item.operationKey),
          `Refund outbox ${item.id} has no matching refund link`,
        );
      }
      if (item.status === "DELIVERED") {
        const committed = state.integrationAttempts.filter((attempt) =>
          attempt.system === "LEGACY_DMS" &&
          attempt.operationKey === item.operationKey &&
          (attempt.status === "COMMITTED" ||
            (attempt.status === "RESPONSE_LOST" && attempt.sanitizedResponse?.committed === true)));
        this.invariant(committed.length === 1, `Delivered outbox ${item.id} must have one DMS mutation`);
      }
    }

    const dmsAttempts = state.integrationAttempts.filter((item) => item.system === "LEGACY_DMS");
    const dmsMutations = dmsAttempts.filter((item) =>
      item.status === "COMMITTED" ||
      (item.status === "RESPONSE_LOST" && item.sanitizedResponse?.committed === true));
    this.invariant(state.invariants.dmsAttempts === dmsAttempts.length, "DMS attempt counter drifted");
    this.invariant(state.invariants.dmsMutations === dmsMutations.length, "DMS mutation counter drifted");
    this.invariant(
      state.invariants.lostResponses === dmsAttempts.filter((item) => item.status === "RESPONSE_LOST").length,
      "Lost-response counter drifted",
    );
    this.invariant(
      state.invariants.retriesResolvedByLookup === dmsAttempts.filter((item) => item.status === "FOUND_EXISTING").length,
      "Recovery-lookup counter drifted",
    );
    this.invariant(state.invariants.outboxCreated === state.outbox.length, "Outbox creation counter drifted");
    this.invariant(
      state.invariants.outboxDelivered === state.outbox.filter((item) => item.status === "DELIVERED").length,
      "Outbox delivery counter drifted",
    );

    const duplicateFixture = this.requirePayment(state, "PAY-1006");
    const duplicateReceipt = state.inbox.find((item) => item.externalEventId === duplicateFixture.externalEventId);
    this.invariant(duplicateReceipt?.deliveryCount === 2, "PAY-1006 must retain two processor deliveries");
    this.invariant(
      state.allocations.filter((item) => item.paymentId === duplicateFixture.id).length === 1,
      "PAY-1006 duplicate delivery must retain one allocation",
    );
    this.invariant(
      !state.exceptions.some((item) => item.paymentId === duplicateFixture.id),
      "PAY-1006 duplicate delivery must not become operator work",
    );
    const recoveredFixture = this.requirePayment(state, "PAY-1017");
    const recoveredAttempts = dmsAttempts.filter((item) => item.operationKey === recoveredFixture.postingOperationKey);
    this.invariant(recoveredAttempts.length === 2, "PAY-1017 must retain its two recovery attempts");
    this.invariant(new Set(recoveredAttempts.map((item) => item.operationKey)).size === 1, "PAY-1017 recovery key changed");
    this.invariant(
      recoveredAttempts.filter((item) =>
        item.status === "COMMITTED" ||
        (item.status === "RESPONSE_LOST" && item.sanitizedResponse?.committed === true)).length === 1,
      "PAY-1017 recovery must retain one financial mutation",
    );
    this.invariant(recoveredFixture.dmsState === "VERIFIED", "PAY-1017 must remain verified");
    this.invariant(
      !state.exceptions.some((item) => item.paymentId === recoveredFixture.id),
      "PAY-1017 recovery must not become operator work",
    );

    for (const exception of state.exceptions) {
      const payment = this.requirePayment(state, exception.paymentId);
      this.assertExceptionIdentity(exception, payment);
      if (exception.status === "OPEN") {
        this.invariant(exception.resolution === null, `Open exception ${exception.id} has a resolution`);
        this.invariant(payment.dmsState === "NEEDS_REVIEW", `Open exception ${exception.id} payment is not in review`);
        continue;
      }
      const resolution = exception.resolution;
      this.invariant(resolution !== null, `Resolved exception ${exception.id} has no resolution`);
      if (!resolution) continue;
      this.invariant(payment.dmsState === "VERIFIED", `Resolved exception ${exception.id} was not verified`);
      if (exception.type === "UNMATCHED_REFUND") {
        this.invariant(
          state.refundLinks.some((link) =>
            link.refundPaymentId === payment.id &&
            link.originalPaymentId === resolution.targetId &&
            link.operationKey === resolution.operationKey),
          `Resolved refund ${exception.id} lacks its immutable link`,
        );
      } else {
        this.invariant(
          state.allocations.some((allocation) =>
            allocation.paymentId === payment.id &&
            allocation.dmsRecordId === resolution.targetId &&
            allocation.amountCents === resolution.amountCents &&
            allocation.source === "HUMAN_RESOLUTION" &&
            allocation.operationKey === resolution.operationKey),
          `Resolved exception ${exception.id} lacks its allocation`,
        );
      }
    }
    this.invariant(
      state.invariants.acceptedDecisions === state.exceptions.filter((item) => item.status === "RESOLVED").length,
      "Accepted decision counter drifted",
    );
    this.invariant(
      state.invariants.rejectedVersionConflicts === state.auditEvents.filter((item) => item.type === "STALE_VERSION_CONFLICT").length,
      "Rejected version-conflict counter drifted",
    );

    for (const close of state.operationalCloses) {
      if (close.status === "CLOSED") {
        this.invariant(close.closedBy !== null && close.closedAt !== null && close.attestation !== null, `Closed location ${close.id} lacks attestation`);
        if (close.attestation) {
          this.invariant(close.paymentCount === close.attestation.paymentCount, `Closed payment count changed for ${close.id}`);
          this.invariant(close.verifiedPostingCount === close.attestation.verifiedPostingCount, `Closed verified count changed for ${close.id}`);
          this.invariant(close.blockingExceptionCount === close.attestation.blockingExceptionCount, `Closed blocker count changed for ${close.id}`);
          this.invariant(close.settlementStatus === close.attestation.settlementStatusAtClose, `Closed settlement snapshot changed for ${close.id}`);
          this.invariant(close.attestation.paymentCount === close.attestation.verifiedPostingCount, `Closed location ${close.id} was not fully verified`);
          this.invariant(close.attestation.blockingExceptionCount === 0, `Closed location ${close.id} retained blockers`);
        }
      } else {
        const proof = this.computeCloseProof(state, close.rooftopId);
        this.invariant(close.paymentCount === proof.paymentCount, `Close payment count drifted for ${close.id}`);
        this.invariant(close.verifiedPostingCount === proof.verifiedPostingCount, `Close verified count drifted for ${close.id}`);
        this.invariant(close.blockingExceptionCount === proof.blockingExceptionCount, `Close blocker count drifted for ${close.id}`);
        this.invariant(close.settlementStatus === proof.settlementStatus, `Close settlement status drifted for ${close.id}`);
        this.invariant(close.status === proof.status, `Close readiness drifted for ${close.id}`);
      }
    }

    for (const payout of state.payouts) {
      if (
        payout.capturedCents !== null &&
        payout.refundCents !== null &&
        payout.feeCents !== null
      ) {
        this.invariant(
          payout.originalExpectedCents === payout.capturedCents - payout.refundCents - payout.feeCents,
          `Original settlement arithmetic changed for ${payout.id}`,
        );
      }
      const adjustments = state.settlementAdjustments.filter((item) => item.payoutId === payout.id);
      if (payout.originalExpectedCents !== null) {
        const adjusted = payout.originalExpectedCents + this.sum(adjustments, (item) => item.amountCents);
        this.invariant(payout.adjustedExpectedCents === adjusted, `Adjusted expected amount drifted for ${payout.id}`);
        if (payout.observedBankCents !== null) {
          this.invariant(payout.varianceCents === adjusted - payout.observedBankCents, `Payout variance drifted for ${payout.id}`);
        }
      }
      if (payout.status === "RECONCILED") {
        this.invariant(payout.varianceCents === 0, `Reconciled payout ${payout.id} has nonzero variance`);
        this.invariant(payout.reconciledBy !== null && payout.reconciledAt !== null, `Reconciled payout ${payout.id} lacks attribution`);
      }
      if (payout.status === "VARIANCE") {
        this.invariant(payout.varianceCents !== null && payout.varianceCents !== 0, `Variance payout ${payout.id} has no variance`);
      }
      for (const sourceId of payout.sourceRecordIds) {
        const source = state.payoutSourceRecords.find((item) => item.id === sourceId);
        this.invariant(source?.payoutId === payout.id, `Payout source ${sourceId} is missing or mis-scoped`);
      }
    }
    for (const source of state.payoutSourceRecords) {
      this.invariant(state.payouts.some((item) => item.id === source.payoutId), `Orphan payout source ${source.id}`);
    }
    for (const adjustment of state.settlementAdjustments) {
      const source = state.payoutSourceRecords.find((item) => item.id === adjustment.evidenceRecordId);
      this.invariant(source?.payoutId === adjustment.payoutId, `Adjustment ${adjustment.id} has invalid evidence`);
      this.invariant(source?.component === "NETWORK_ASSESSMENT_NOTICE", `Adjustment ${adjustment.id} lacks assessment evidence`);
      this.invariant(source?.amountCents === adjustment.amountCents, `Adjustment ${adjustment.id} changed the source amount`);
    }
    this.assertUnique(state.settlementAdjustments.map((item) => item.evidenceRecordId), "adjustment evidence records");
    this.invariant(
      state.auditEvents.every((event, index) => event.sequence === index + 1),
      "Audit event sequence must be contiguous and append-only",
    );
  }

  private resolveCaptureToRecord(
    state: WorkspaceState,
    exception: DemoException,
    payment: Payment,
    targetId: string,
    operationKey: string,
    commandAt: string,
    action: "APPLY_TO_RECORD" | "ATTACH_SPLIT",
  ): ResolutionEffect {
    if (payment.kind !== "CAPTURE") {
      throw new DomainError("INVALID_PAYMENT_KIND", "This resolution requires a captured payment.", 422, {
        exceptionId: exception.id, paymentId: payment.id, kind: payment.kind,
      });
    }
    const record = this.requireDmsRecord(state, targetId);
    this.assertCompatibleTarget(payment, record);
    const alreadyAllocated = this.sum(
      state.allocations.filter((item) => item.paymentId === payment.id),
      (item) => item.amountCents,
    );
    const paymentRemainder = payment.amountCents - alreadyAllocated;
    if (paymentRemainder <= 0) {
      throw new DomainError("PAYMENT_ALREADY_ALLOCATED", "This payment is already fully allocated.", 409, { paymentId: payment.id });
    }
    if (paymentRemainder > record.balanceCents) {
      throw new DomainError(
        "ALLOCATION_EXCEEDS_BALANCE",
        "The payment remainder exceeds the selected record's available customer-pay balance.",
        422,
        { paymentId: payment.id, dmsRecordId: record.id, paymentRemainderCents: paymentRemainder, recordBalanceCents: record.balanceCents },
      );
    }

    const allocation: Allocation = {
      id: `alloc_${exception.id.toLowerCase().replaceAll("-", "_")}`,
      paymentId: payment.id,
      dmsRecordId: record.id,
      amountCents: paymentRemainder,
      source: "HUMAN_RESOLUTION",
      operationKey,
      createdAt: commandAt,
    };
    this.assertFreshFinancialOperation(state, allocation.id, operationKey);
    state.allocations.push(allocation);
    record.balanceCents -= paymentRemainder;
    const verifiedAt = this.postToDms(state, payment, record, operationKey, "PAYMENT_POST", commandAt);
    return { action, targetId: record.id, targetLabel: record.recordNumber, amountCents: paymentRemainder, verifiedAt };
  }

  private resolveRefund(
    state: WorkspaceState,
    exception: DemoException,
    refund: Payment,
    originalPaymentId: string,
    operationKey: string,
    commandAt: string,
  ): ResolutionEffect {
    if (refund.kind !== "REFUND") {
      throw new DomainError("INVALID_PAYMENT_KIND", "This resolution requires a refund.", 422, {
        exceptionId: exception.id, paymentId: refund.id, kind: refund.kind,
      });
    }
    const original = this.requirePayment(state, originalPaymentId);
    if (original.kind !== "CAPTURE" || !original.linkedRecordId) {
      throw new DomainError("INVALID_REFUND_ORIGINAL", "Choose an original captured payment with a DMS record.", 422, {
        refundPaymentId: refund.id, originalPaymentId,
      });
    }
    const record = this.requireDmsRecord(state, original.linkedRecordId);
    this.assertCompatibleTarget(refund, record);
    if (original.rooftopId !== refund.rooftopId || original.department !== refund.department) {
      throw new DomainError("INVALID_REFUND_ORIGINAL", "The original payment must belong to the same location and department.", 422, {
        refundPaymentId: refund.id, originalPaymentId,
      });
    }
    const alreadyRefunded = this.sum(
      state.refundLinks.filter((item) => item.originalPaymentId === original.id),
      (item) => this.requirePayment(state, item.refundPaymentId).amountCents,
    );
    if (refund.amountCents > original.amountCents - alreadyRefunded) {
      throw new DomainError("REFUND_EXCEEDS_ORIGINAL", "The refund exceeds the original payment's refundable remainder.", 422, {
        refundPaymentId: refund.id, originalPaymentId, refundableCents: original.amountCents - alreadyRefunded,
      });
    }
    if (state.refundLinks.some((item) => item.refundPaymentId === refund.id)) {
      throw new DomainError("REFUND_ALREADY_LINKED", "This refund already has an original payment.", 409, { refundPaymentId: refund.id });
    }

    const linkId = `refund_link_${refund.id.toLowerCase().replaceAll("-", "_")}`;
    this.assertFreshFinancialOperation(state, linkId, operationKey);
    state.refundLinks.push({
      id: linkId,
      refundPaymentId: refund.id,
      originalPaymentId: original.id,
      dmsRecordId: record.id,
      operationKey,
      actor: state.user.name,
      createdAt: commandAt,
    });
    const verifiedAt = this.postToDms(state, refund, record, operationKey, "REFUND_LINK", commandAt, original.id);
    return { action: "LINK_REFUND", targetId: original.id, targetLabel: record.recordNumber, amountCents: refund.amountCents, verifiedAt };
  }

  private postToDms(
    state: WorkspaceState,
    payment: Payment,
    record: DmsRecord,
    operationKey: string,
    mutationKind: OutboxItem["mutationKind"],
    commandAt: string,
    originalPaymentId?: string,
  ): string {
    if (state.outbox.some((item) => item.operationKey === operationKey)) {
      throw new DomainError("IDEMPOTENCY_KEY_REUSE", "The operation key already belongs to another posting.", 409, { operationKey });
    }
    const postedAt = this.addMilliseconds(commandAt, 1_000);
    const verifiedAt = this.addMilliseconds(commandAt, 2_000);
    const outbox: OutboxItem = {
      id: `out_${payment.id.toLowerCase().replaceAll("-", "_")}`,
      paymentId: payment.id,
      dmsRecordId: record.id,
      operationKey,
      mutationKind,
      destination: "LEGACY_DMS",
      status: "DELIVERED",
      attemptCount: 1,
      createdAt: commandAt,
      deliveredAt: verifiedAt,
    };
    this.invariant(!state.outbox.some((item) => item.id === outbox.id), `Outbox id ${outbox.id} was reused`);
    state.outbox.push(outbox);
    state.invariants.outboxCreated += 1;
    state.invariants.outboxDelivered += 1;
    state.invariants.dmsAttempts += 1;
    state.invariants.dmsMutations += 1;

    payment.linkedRecordId = record.id;
    payment.sourceReference = record.recordNumber;
    payment.matchedAt = commandAt;
    payment.dmsState = "VERIFIED";
    payment.postedAt = postedAt;
    payment.verifiedAt = verifiedAt;
    payment.postingOperationKey = operationKey;

    this.appendIntegrationAttempt(state, {
      system: "LEGACY_DMS",
      direction: "OUTBOUND",
      operation: mutationKind === "REFUND_LINK" ? "POST /refund-links" : "POST /cash-receipts",
      externalEventId: payment.externalEventId,
      operationKey,
      correlationId: this.correlationId(payment.id, operationKey),
      status: "COMMITTED",
      httpStatus: 201,
      attempt: 1,
      occurredAt: postedAt,
      note: mutationKind === "REFUND_LINK"
        ? "The dealership system accepted one refund-to-original relationship."
        : "The dealership system accepted one payment posting.",
      sanitizedRequest: mutationKind === "REFUND_LINK"
        ? { refundPaymentId: payment.id, originalPaymentId, recordNumber: record.recordNumber, amountCents: payment.amountCents, operationKey }
        : { paymentId: payment.id, recordNumber: record.recordNumber, amountCents: payment.amountCents, operationKey },
      sanitizedResponse: { postingId: `DMS-${payment.id}`, committed: true, verified: true },
    });
    return verifiedAt;
  }

  private recalculateLocationClose(state: WorkspaceState, rooftopId: string) {
    const close = this.requireClose(state, rooftopId);
    if (close.status === "CLOSED") return close;
    const proof = this.computeCloseProof(state, rooftopId);
    const changed =
      close.paymentCount !== proof.paymentCount ||
      close.verifiedPostingCount !== proof.verifiedPostingCount ||
      close.blockingExceptionCount !== proof.blockingExceptionCount ||
      close.settlementStatus !== proof.settlementStatus ||
      close.status !== proof.status;
    close.paymentCount = proof.paymentCount;
    close.verifiedPostingCount = proof.verifiedPostingCount;
    close.blockingExceptionCount = proof.blockingExceptionCount;
    close.settlementStatus = proof.settlementStatus;
    close.status = proof.status;
    if (changed) close.version += 1;
    return close;
  }

  private computeCloseProof(state: WorkspaceState, rooftopId: string): CloseProof {
    const close = this.requireClose(state, rooftopId);
    const payments = state.payments.filter((payment) =>
      payment.rooftopId === rooftopId && payment.inFridayClose && payment.businessDate === close.businessDate);
    const verifiedPostingCount = payments.filter((payment) => payment.dmsState === "VERIFIED").length;
    const blockingExceptionCount = state.exceptions.filter((exception) =>
      exception.rooftopId === rooftopId && exception.severity === "BLOCKING" && exception.status === "OPEN").length;
    const currentPayout = state.payouts.find((payout) =>
      payout.rooftopId === rooftopId && payout.payoutDate === close.businessDate);
    const settlementStatus = currentPayout?.status ?? close.settlementStatus;
    const status = blockingExceptionCount > 0
      ? "BLOCKED"
      : verifiedPostingCount === payments.length
        ? "READY"
        : "PROCESSING";
    return { paymentCount: payments.length, verifiedPostingCount, blockingExceptionCount, settlementStatus, status };
  }

  private recordVersionConflict(
    state: WorkspaceState,
    input: {
      scope: string;
      idempotencyKey: string;
      fingerprint: string;
      entityType: string;
      entityId: string;
      expectedVersion: number;
      actualVersion: number;
      message: string;
      extraDetails: Record<string, unknown>;
    },
  ): EngineOutcome {
    const occurredAt = this.nextCommandTime(state);
    const correlationId = this.correlationId(input.entityId, input.idempotencyKey);
    const details: Record<string, unknown> = {
      entityId: input.entityId,
      expectedVersion: input.expectedVersion,
      actualVersion: input.actualVersion,
      ...input.extraDetails,
    };
    const rejection: EngineRejection = {
      code: "VERSION_CONFLICT",
      message: input.message,
      status: 409,
      correlationId,
      details,
    };
    const result: Record<string, unknown> = { outcome: "REJECTED", rejection };
    this.appendAudit(state, {
      type: "STALE_VERSION_CONFLICT",
      entityType: input.entityType,
      entityId: input.entityId,
      actor: state.user.name,
      occurredAt,
      correlationId,
      summary: `Rejected a stale update to ${input.entityId}; the latest state was preserved.`,
      details,
    });
    state.invariants.rejectedVersionConflicts += 1;
    this.recordCommand(state, input.idempotencyKey, input.scope, input.fingerprint, result, occurredAt);
    this.assertInvariants(state);
    return { changed: true, replayed: false, result, rejected: rejection };
  }

  private replayCommand(
    state: WorkspaceState,
    idempotencyKey: string,
    scope: string,
    fingerprint: string,
  ): EngineOutcome | null {
    const receipt = state.commandReceipts.find((item) => item.idempotencyKey === idempotencyKey);
    if (!receipt) return null;
    if (receipt.scope !== scope || receipt.fingerprint !== fingerprint) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSE",
        "That idempotency key already belongs to a different command payload.",
        409,
        { idempotencyKey, existingScope: receipt.scope, requestedScope: scope },
      );
    }
    const rejected = this.readStoredRejection(receipt);
    this.assertInvariants(state);
    return rejected
      ? { changed: false, replayed: true, result: receipt.result, rejected }
      : { changed: false, replayed: true, result: receipt.result };
  }

  private readStoredRejection(receipt: CommandReceipt): EngineRejection | null {
    const value = receipt.result.rejection;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const rejection = value as Record<string, unknown>;
    if (
      rejection.code !== "VERSION_CONFLICT" || typeof rejection.message !== "string" ||
      rejection.status !== 409 || typeof rejection.correlationId !== "string" ||
      !rejection.details || typeof rejection.details !== "object" || Array.isArray(rejection.details)
    ) {
      throw new Error(`Command receipt ${receipt.idempotencyKey} contains an invalid rejection result`);
    }
    return {
      code: "VERSION_CONFLICT",
      message: rejection.message,
      status: 409,
      correlationId: rejection.correlationId,
      details: rejection.details as Record<string, unknown>,
    };
  }

  private recordCommand(
    state: WorkspaceState,
    idempotencyKey: string,
    scope: string,
    fingerprint: string,
    result: Record<string, unknown>,
    createdAt: string,
  ): void {
    this.invariant(!state.commandReceipts.some((item) => item.idempotencyKey === idempotencyKey), `Command receipt ${idempotencyKey} already exists`);
    state.commandReceipts.push({
      idempotencyKey,
      scope,
      fingerprint,
      result: structuredClone(result),
      createdAt,
    });
  }

  private assertFreshFinancialOperation(state: WorkspaceState, id: string, operationKey: string): void {
    if (
      state.allocations.some((item) => item.id === id || item.operationKey === operationKey) ||
      state.refundLinks.some((item) => item.id === id || item.operationKey === operationKey) ||
      state.outbox.some((item) => item.operationKey === operationKey) ||
      state.settlementAdjustments.some((item) => item.id === id || item.operationKey === operationKey)
    ) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSE",
        "That operation identity already belongs to another financial mutation.",
        409,
        { operationKey },
      );
    }
  }

  private assertExceptionIdentity(exception: DemoException, payment: Payment): void {
    this.invariant(exception.rooftopId === payment.rooftopId, `Exception ${exception.id} crossed rooftop boundaries`);
    this.invariant(exception.department === payment.department, `Exception ${exception.id} crossed department boundaries`);
  }

  private assertCompatibleTarget(payment: Payment, record: DmsRecord): void {
    if (payment.rooftopId !== record.rooftopId) {
      throw new DomainError("CROSS_ROOFTOP_ALLOCATION", "A payment cannot be applied to another location.", 422, {
        paymentId: payment.id, paymentRooftopId: payment.rooftopId, dmsRecordId: record.id, recordRooftopId: record.rooftopId,
      });
    }
    if (payment.department !== record.department) {
      throw new DomainError("CROSS_DEPARTMENT_ALLOCATION", "A payment cannot be applied across departments.", 422, {
        paymentId: payment.id, paymentDepartment: payment.department, dmsRecordId: record.id, recordDepartment: record.department,
      });
    }
    if (payment.currency !== record.currency) {
      throw new DomainError("CURRENCY_MISMATCH", "Payment and record currencies must match.", 422, { paymentId: payment.id, dmsRecordId: record.id });
    }
  }

  private resolutionReason(exception: DemoException, targetLabel: string): string {
    if (exception.type === "UNMATCHED_REFUND") return `Linked the refund to ${targetLabel} after reviewing the original transaction evidence.`;
    if (exception.type === "SPLIT_ALLOCATION") return `Attached the second split-tender payment to ${targetLabel}.`;
    return `Applied the payment to ${targetLabel} after reviewing amount, customer, location, department, and timing evidence.`;
  }

  private resolutionSummary(exception: DemoException, payment: Payment, targetLabel: string): string {
    const amount = this.formatCents(payment.amountCents);
    if (exception.type === "UNMATCHED_REFUND") return `Linked -${amount} refund to original Parts payment ${targetLabel}`;
    if (exception.type === "SPLIT_ALLOCATION") return `Attached ${amount} payment to ${targetLabel}`;
    return `Applied ${amount} payment to ${targetLabel}`;
  }

  private appendIntegrationAttempt(state: WorkspaceState, input: Omit<IntegrationAttempt, "id">): void {
    state.integrationAttempts.push({
      id: `try_command_${String(state.integrationAttempts.length + 1).padStart(4, "0")}`,
      ...input,
    });
  }

  private appendAudit(state: WorkspaceState, input: Omit<AuditEvent, "id" | "sequence">): void {
    const sequence = state.auditEvents.length + 1;
    state.auditEvents.push({ id: `audit_${String(sequence).padStart(4, "0")}`, sequence, ...input });
  }

  private nextCommandTime(state: WorkspaceState): string {
    const commandIndex = Math.max(0, state.auditEvents.length - 3);
    const scheduled = COMMAND_TIMES[commandIndex];
    if (scheduled) return scheduled;
    const last = COMMAND_TIMES.at(-1)!;
    return this.addMilliseconds(last, (commandIndex - COMMAND_TIMES.length + 1) * 180_000);
  }

  private addMilliseconds(iso: string, milliseconds: number): string {
    return new Date(new Date(iso).getTime() + milliseconds).toISOString();
  }

  private operationKey(prefix: string, entityId: string, idempotencyKey: string): string {
    return `${prefix}_${entityId.toLowerCase().replaceAll("-", "_")}_${this.digest(idempotencyKey).slice(0, 16)}`;
  }

  private correlationId(entityId: string, identity: string): string {
    return `corr_${entityId.toLowerCase().replaceAll("-", "_")}_${this.digest(identity).slice(0, 12)}`;
  }

  private fingerprint(scope: string, payload: Record<string, unknown>): string {
    return this.digest(JSON.stringify({ scope, ...payload }));
  }

  private digest(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private formatCents(cents: number): string {
    return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private requireException(state: WorkspaceState, exceptionId: string): DemoException {
    const exception = state.exceptions.find((item) => item.id === exceptionId);
    if (!exception) throw new DomainError("EXCEPTION_NOT_FOUND", "That exception does not exist in this workspace.", 404, { exceptionId });
    return exception;
  }

  private requirePayment(state: WorkspaceState, paymentId: string): Payment {
    const payment = state.payments.find((item) => item.id === paymentId);
    if (!payment) throw new Error(`Payment ${paymentId} is missing from the workspace`);
    return payment;
  }

  private requireDmsRecord(state: WorkspaceState, recordId: string): DmsRecord {
    const record = state.dmsRecords.find((item) => item.id === recordId);
    if (!record) throw new DomainError("DMS_RECORD_NOT_FOUND", "That dealership record does not exist.", 404, { recordId });
    return record;
  }

  private requireClose(state: WorkspaceState, rooftopId: string) {
    const close = state.operationalCloses.find((item) =>
      item.rooftopId === rooftopId && item.businessDate === WORKSPACE_BUSINESS_DATE);
    if (!close) throw new DomainError("LOCATION_CLOSE_NOT_FOUND", "That location is not part of this close.", 404, { rooftopId });
    return close;
  }

  private requirePayout(state: WorkspaceState, payoutId: string): ProcessorPayout {
    const payout = state.payouts.find((item) => item.id === payoutId);
    if (!payout) throw new DomainError("PAYOUT_NOT_FOUND", "That payout does not exist.", 404, { payoutId });
    return payout;
  }

  private requireRooftop(state: WorkspaceState, rooftopId: string) {
    const rooftop = state.rooftops.find((item) => item.id === rooftopId);
    if (!rooftop) throw new DomainError("ROOFTOP_NOT_FOUND", "That location does not exist.", 404, { rooftopId });
    return rooftop;
  }

  private assertUnique(values: string[], label: string): void {
    this.invariant(new Set(values).size === values.length, `${label} must be unique`);
  }

  private sum<T>(items: T[], select: (item: T) => number): number {
    return items.reduce((total, item) => total + select(item), 0);
  }

  private invariant(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(`Workspace invariant failed: ${message}`);
  }
}
