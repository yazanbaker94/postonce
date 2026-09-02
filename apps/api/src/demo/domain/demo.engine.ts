import {
  type ActionRequest,
  type Allocation,
  type AuditEvent,
  type DemoAction,
  type DemoException,
  type DemoState,
  type IntegrationAttempt,
  type OutboxItem,
} from "@postonce/contracts";
import { DomainError, VersionConflictError } from "../../common/domain-error.js";

export type EngineOutcome = {
  changed: boolean;
  replayed: boolean;
  chapter: number;
  result: Record<string, unknown>;
};

type ResolutionCommand = {
  operationKey: string;
  expectedVersion: number;
  candidateInvoiceId: string;
  acceptedAmountCents: number;
  reason: string;
  actor: string;
};

const ACTION_CHAPTER: Record<Exclude<DemoAction, "run-all" | "resolve-exception">, number> = {
  "process-routine": 1,
  "deliver-duplicate": 2,
  "simulate-lost-response": 3,
  "open-ambiguous-exception": 4,
  "simulate-resolution-race": 5,
  "reconcile-settlement": 6,
};

export class DemoEngine {
  execute(state: DemoState, action: DemoAction, request: ActionRequest = {}): EngineOutcome {
    if (action === "run-all") return this.runAll(state);
    if (action === "resolve-exception") return this.resolveException(state, request);

    if (state.completedActions.includes(action)) {
      return {
        changed: false,
        replayed: true,
        chapter: ACTION_CHAPTER[action],
        result: this.replayResult(state, action),
      };
    }

    this.assertPrerequisite(state, action);
    let result: Record<string, unknown>;
    switch (action) {
      case "process-routine":
        result = this.processRoutine(state);
        break;
      case "deliver-duplicate":
        result = this.deliverDuplicate(state);
        break;
      case "simulate-lost-response":
        result = this.simulateLostResponse(state);
        break;
      case "open-ambiguous-exception":
        result = this.openAmbiguousException(state);
        break;
      case "simulate-resolution-race":
        result = this.simulateResolutionRace(state);
        break;
      case "reconcile-settlement":
        result = this.reconcileSettlement(state);
        break;
    }

    this.completeAction(state, action, ACTION_CHAPTER[action]);
    this.assertInvariants(state);
    return { changed: true, replayed: false, chapter: ACTION_CHAPTER[action], result };
  }

  private runAll(state: DemoState): EngineOutcome {
    if (state.completedActions.includes("run-all")) {
      return {
        changed: false,
        replayed: true,
        chapter: state.currentChapter,
        result: this.replayResult(state, "run-all"),
      };
    }

    const actions: Array<Exclude<DemoAction, "run-all" | "resolve-exception">> = [
      "process-routine",
      "deliver-duplicate",
      "simulate-lost-response",
      "open-ambiguous-exception",
      "simulate-resolution-race",
      "reconcile-settlement",
    ];
    const executed: string[] = [];
    for (const action of actions) {
      if (state.completedActions.includes(action)) continue;
      if (
        action === "simulate-resolution-race" &&
        state.exceptions.some((item) => item.id === "exc_ambiguous_1009" && item.status === "RESOLVED")
      ) {
        const exception = state.exceptions.find((item) => item.id === "exc_ambiguous_1009")!;
        state.completedActions.push(action);
        this.setChapter(state, ACTION_CHAPTER[action]);
        state.evidence.race = {
          attempted: false,
          winner: exception.resolution?.actor ?? null,
          loser: null,
          acceptedStatus: 200,
          rejectedStatus: null,
          winningVersion: exception.version,
        };
        this.updateCheck(state, "version_guard", "PASS", "Manual resolution already committed; race simulation skipped");
        this.appendAudit(state, {
          type: "RACE_SIMULATION_SKIPPED",
          entityType: "exception",
          entityId: exception.id,
          actor: "guided-demo",
          correlationId: this.correlation(state, "race_skipped"),
          summary: "The exception was already resolved, so the synthetic race chapter did not submit another decision.",
          details: { resolutionOperationKey: exception.resolution?.operationKey, resultingVersion: exception.version },
        });
        executed.push(`${action}:skipped-already-resolved`);
        continue;
      }
      this.execute(state, action);
      executed.push(action);
    }
    state.completedActions.push("run-all");
    this.appendAudit(state, {
      type: "GUIDED_RUN_COMPLETED",
      entityType: "session",
      entityId: state.session.id,
      actor: "reviewer",
      correlationId: this.correlation(state, "run_all"),
      summary: "The entire failure-safe close was completed.",
      details: { executed, closeStatus: state.close.status },
    });
    this.assertInvariants(state);
    return {
      changed: true,
      replayed: false,
      chapter: 7,
      result: {
        executed,
        closeStatus: state.close.status,
        mutationProof: `${state.invariants.dmsAttempts} DMS attempts / ${state.invariants.dmsMutations} DMS mutations`,
      },
    };
  }

  private processRoutine(state: DemoState): Record<string, unknown> {
    const correlationId = this.correlation(state, "routine");
    const referenceIndex = new Map(state.invoices.map((invoice) => [invoice.repairOrderNumber, invoice]));
    const routineIds = new Set(["pay_1001", "pay_1002", "pay_1003", "pay_1004", "pay_1005", "pay_1006", "pay_1007", "pay_1008", "pay_1011"]);
    let matched = 0;
    let posted = 0;

    for (const payment of state.payments) {
      if (!routineIds.has(payment.id)) continue;
      this.acceptInboxDelivery(state, payment.externalEventId);
      const invoice = payment.reference ? referenceIndex.get(payment.reference) : undefined;
      if (!invoice) throw new Error(`Seed invariant failed: invoice missing for ${payment.id}`);
      const operationKey = `op_${state.session.id.slice(0, 8)}_${payment.id}`;
      this.allocate(state, payment.id, invoice.id, payment.amountCents, "EXACT_REFERENCE", operationKey);
      this.createOutbox(state, payment.id, invoice.id, operationKey);
      matched += 1;

      // pay_1003 is intentionally left committed-to-local-ledger but pending at the boundary.
      if (payment.id === "pay_1003") continue;
      this.deliverOutboxNormally(state, operationKey, correlationId);
      posted += 1;
    }

    const refund = this.requirePayment(state, "pay_1012");
    this.acceptInboxDelivery(state, refund.externalEventId);
    refund.status = "REFUNDED";

    this.appendAudit(state, {
      type: "ROUTINE_BATCH_PROCESSED",
      entityType: "close",
      entityId: "close_2026_08_30",
      actor: "matcher",
      correlationId,
      summary: `${matched} exact-reference captures matched; ${posted} posted without review.`,
      details: {
        indexedLookup: "O(1) expected",
        exactMatches: matched,
        dmsPosted: posted,
        pendingBoundaryTest: "pay_1003",
        refundsRecorded: 1,
      },
    });

    return {
      exactMatches: matched,
      postedWithoutReview: posted,
      pendingOutbox: 1,
      lookup: "indexed repair-order reference",
      complexity: "O(1) expected per event",
    };
  }

  private deliverDuplicate(state: DemoState): Record<string, unknown> {
    const payment = this.requirePayment(state, "pay_1010");
    const invoice = this.requireInvoice(state, "inv_8010");
    const correlationId = this.correlation(state, "duplicate");
    const operationKey = `inbox_northstar_${payment.externalEventId}`;

    const firstAccepted = this.acceptInboxDelivery(state, payment.externalEventId);
    this.integration(state, {
      system: "NORTHSTAR_PROCESSOR",
      direction: "INBOUND",
      operation: "processor.payment.captured",
      externalEventId: payment.externalEventId,
      operationKey,
      correlationId,
      status: "ACCEPTED",
      httpStatus: 202,
      attempt: 1,
      note: "The first delivery entered the durable inbox.",
      sanitizedRequest: { eventId: payment.externalEventId, amountCents: payment.amountCents, currency: payment.currency },
      sanitizedResponse: { accepted: true },
    });

    const destinationKey = `op_${state.session.id.slice(0, 8)}_${payment.id}`;
    this.allocate(state, payment.id, invoice.id, payment.amountCents, "EXACT_REFERENCE", destinationKey);
    this.createOutbox(state, payment.id, invoice.id, destinationKey);
    this.deliverOutboxNormally(state, destinationKey, correlationId);

    const secondAccepted = this.acceptInboxDelivery(state, payment.externalEventId);
    this.integration(state, {
      system: "NORTHSTAR_PROCESSOR",
      direction: "INBOUND",
      operation: "processor.payment.captured",
      externalEventId: payment.externalEventId,
      operationKey,
      correlationId,
      status: "DUPLICATE",
      httpStatus: 200,
      attempt: 2,
      note: "The duplicate delivery was acknowledged but did not reapply financial state.",
      sanitizedRequest: { eventId: payment.externalEventId, amountCents: payment.amountCents, currency: payment.currency },
      sanitizedResponse: { accepted: true, replay: true },
    });
    this.updateCheck(state, "unique_event", "PASS", "2 deliveries → 1 mutation");
    this.appendAudit(state, {
      type: "DUPLICATE_EVENT_ABSORBED",
      entityType: "payment",
      entityId: payment.id,
      actor: "processor-inbox",
      correlationId,
      summary: "Two webhook deliveries produced one allocation and one posting.",
      details: { externalEventId: payment.externalEventId, firstAccepted, secondAccepted, financialMutations: 1 },
    });

    return {
      deliveries: 2,
      firstAccepted,
      secondAccepted,
      allocationsCreated: 1,
      postingsCreated: 1,
      databaseGuard: "UNIQUE (session_id, provider, external_event_id)",
    };
  }

  private simulateLostResponse(state: DemoState): Record<string, unknown> {
    const payment = this.requirePayment(state, "pay_1003");
    const outbox = this.requireOutbox(state, `op_${state.session.id.slice(0, 8)}_${payment.id}`);
    const correlationId = this.correlation(state, "lost_response");
    const postingId = "OP-7Q3K";

    outbox.attemptCount += 1;
    state.invariants.dmsAttempts += 1;
    state.invariants.dmsMutations += 1;
    state.invariants.lostResponses += 1;
    this.integration(state, {
      system: "LEGACY_DMS",
      direction: "OUTBOUND",
      operation: "post-payment",
      externalEventId: payment.externalEventId,
      operationKey: outbox.operationKey,
      correlationId,
      status: "RESPONSE_LOST",
      httpStatus: null,
      attempt: 1,
      note: "LegacyDMS committed the posting, but the caller observed a timeout instead of the success response.",
      sanitizedRequest: { repairOrderNumber: "RO-8003", amountCents: payment.amountCents, operationKey: outbox.operationKey },
      sanitizedResponse: { postingId, committed: true, deliveredToClient: false },
    });

    outbox.attemptCount += 1;
    outbox.status = "DELIVERED";
    outbox.deliveredAt = this.timestamp(state);
    payment.status = "POSTED";
    state.invariants.dmsAttempts += 1;
    state.invariants.retriesResolvedByLookup += 1;
    state.invariants.outboxDelivered += 1;
    this.integration(state, {
      system: "LEGACY_DMS",
      direction: "OUTBOUND",
      operation: "lookup-by-operation-key",
      externalEventId: payment.externalEventId,
      operationKey: outbox.operationKey,
      correlationId,
      status: "REPLAYED",
      httpStatus: 200,
      attempt: 2,
      note: "The retry reused the key and retrieved the original committed result.",
      sanitizedRequest: { operationKey: outbox.operationKey },
      sanitizedResponse: { postingId, committed: true, replay: true },
    });
    this.updateCheck(state, "stable_key", "PASS", "2 attempts → OP-7Q3K once");
    this.appendAudit(state, {
      type: "LOST_RESPONSE_RECOVERED",
      entityType: "outbox",
      entityId: outbox.id,
      actor: "outbox-relay",
      correlationId,
      summary: "A timeout after commit was recovered without a second DMS mutation.",
      details: { attempts: 2, mutations: 1, operationKey: outbox.operationKey, postingId },
    });

    return {
      attempts: 2,
      destinationMutations: 1,
      postingId,
      operationKey: outbox.operationKey,
      outcome: "original result retrieved",
    };
  }

  private openAmbiguousException(state: DemoState): Record<string, unknown> {
    const payment = this.requirePayment(state, "pay_1009");
    const correlationId = this.correlation(state, "ambiguity");
    this.acceptInboxDelivery(state, payment.externalEventId);
    payment.status = "EXCEPTION";
    const openedAt = this.timestamp(state);
    const exception: DemoException = {
      id: "exc_ambiguous_1009",
      paymentId: payment.id,
      type: "AMBIGUOUS_ALLOCATION",
      severity: "BLOCKING",
      status: "OPEN",
      version: 1,
      title: "One payment, two credible repair orders",
      summary: "Amount and masked customer label match two open invoices; deterministic evidence is insufficient.",
      openedAt,
      candidates: [
        {
          invoiceId: "inv_8031",
          repairOrderNumber: "RO-8031",
          amountCents: 49_500,
          score: 0.78,
          reasons: ["Exact amount", "Same masked customer", "Within 31-minute window"],
        },
        {
          invoiceId: "inv_8037",
          repairOrderNumber: "RO-8037",
          amountCents: 49_500,
          score: 0.76,
          reasons: ["Exact amount", "Same masked customer", "Within 33-minute window"],
        },
      ],
      assistantNote: "Advisory only: both candidates are plausible. A repair-order reference or authorized human decision is required.",
      resolution: null,
    };
    state.exceptions.push(exception);
    state.close.status = "BLOCKED";
    state.close.blockingExceptionCount = 1;
    state.close.lastEvaluatedAt = openedAt;
    this.appendAudit(state, {
      type: "AMBIGUOUS_ALLOCATION_ESCALATED",
      entityType: "exception",
      entityId: exception.id,
      actor: "matcher",
      correlationId,
      summary: "The matcher refused to guess between two credible candidates.",
      details: { confidenceThreshold: 0.9, leadingScore: 0.78, assistantCanMutate: false },
    });

    return {
      exceptionId: exception.id,
      candidates: 2,
      leadingScore: 0.78,
      threshold: 0.9,
      decision: "human review required",
      aiAuthority: "read-only advisory",
    };
  }

  private simulateResolutionRace(state: DemoState): Record<string, unknown> {
    const exception = this.requireOpenException(state);
    const expectedVersion = exception.version;
    const winner = "Maya Chen";
    const loser = "Jon Bell";
    const operationKey = `resolve_${state.session.id.slice(0, 8)}_maya`;
    const correlationId = this.correlation(state, "race");

    state.invariants.concurrentDecisions += 2;
    this.applyResolution(state, exception, {
      operationKey,
      expectedVersion,
      candidateInvoiceId: "inv_8031",
      acceptedAmountCents: 49_500,
      reason: "Repair-order reference confirmed from the synthetic end-of-day worksheet.",
      actor: winner,
    }, correlationId);
    state.invariants.rejectedVersionConflicts += 1;
    this.appendAudit(state, {
      type: "STALE_RESOLUTION_REJECTED",
      entityType: "exception",
      entityId: exception.id,
      actor: loser,
      correlationId,
      summary: "A concurrent stale decision received HTTP 409 and the winning version.",
      details: { expectedVersion, actualVersion: exception.version, status: 409, winner },
    });
    state.evidence.race = {
      attempted: true,
      winner,
      loser,
      acceptedStatus: 200,
      rejectedStatus: 409,
      winningVersion: exception.version,
    };
    this.updateCheck(state, "version_guard", "PASS", "200 winner / 409 stale writer");

    return {
      submittedAtSameVersion: expectedVersion,
      winner: { actor: winner, status: 200, resultingVersion: exception.version },
      loser: { actor: loser, status: 409, code: "VERSION_CONFLICT", observedWinner: winner },
      allocationsCreated: 1,
    };
  }

  private resolveException(state: DemoState, request: ActionRequest): EngineOutcome {
    const exception = state.exceptions.find((item) => item.id === "exc_ambiguous_1009");
    if (!exception) {
      throw new DomainError("ACTION_OUT_OF_ORDER", "Open the ambiguous exception before resolving it.", 409, {
        requiredAction: "open-ambiguous-exception",
      });
    }

    const operationKey = request.operationKey ?? `resolve_${state.session.id.slice(0, 8)}_manual`;
    if (exception.resolution?.operationKey === operationKey) {
      this.assertIdenticalResolutionReplay(state, exception, request);
      return {
        changed: false,
        replayed: true,
        chapter: 5,
        result: { exceptionId: exception.id, resolution: exception.resolution },
      };
    }
    const expectedVersion = request.expectedVersion ?? exception.version;
    if (exception.status === "RESOLVED" || expectedVersion !== exception.version) {
      throw new VersionConflictError({
        exceptionId: exception.id,
        expectedVersion,
        actualVersion: exception.version,
        winningResolution: exception.resolution,
      }, this.correlation(state, "resolution_conflict"));
    }

    const candidateInvoiceId = request.candidateInvoiceId ?? exception.candidates[0]?.invoiceId;
    if (!candidateInvoiceId || !exception.candidates.some((candidate) => candidate.invoiceId === candidateInvoiceId)) {
      throw new DomainError("INVALID_CANDIDATE", "Choose one of the evidence-backed invoice candidates.", 422, {
        candidateInvoiceId: candidateInvoiceId ?? null,
      });
    }
    const acceptedAmountCents = request.acceptedAmountCents ?? this.requirePayment(state, exception.paymentId).amountCents;
    const correlationId = this.correlation(state, "manual_resolution");
    this.applyResolution(state, exception, {
      operationKey,
      expectedVersion,
      candidateInvoiceId,
      acceptedAmountCents,
      reason: request.reason ?? "Authorized reviewer confirmed the repair-order evidence.",
      actor: request.actor ?? "Maya Chen",
    }, correlationId);
    if (!state.completedActions.includes("resolve-exception")) state.completedActions.push("resolve-exception");
    this.setChapter(state, 5);
    this.assertInvariants(state);
    return {
      changed: true,
      replayed: false,
      chapter: 5,
      result: { exceptionId: exception.id, resolution: exception.resolution },
    };
  }

  private assertIdenticalResolutionReplay(state: DemoState, exception: DemoException, request: ActionRequest): void {
    const resolution = exception.resolution;
    if (!resolution) return;
    const conflictingFields: string[] = [];
    if (request.expectedVersion !== undefined && request.expectedVersion !== exception.version - 1) {
      conflictingFields.push("expectedVersion");
    }
    if (request.candidateInvoiceId !== undefined && request.candidateInvoiceId !== resolution.candidateInvoiceId) {
      conflictingFields.push("candidateInvoiceId");
    }
    if (request.acceptedAmountCents !== undefined && request.acceptedAmountCents !== resolution.acceptedAmountCents) {
      conflictingFields.push("acceptedAmountCents");
    }
    if (request.reason !== undefined && request.reason !== resolution.reason) conflictingFields.push("reason");
    if (request.actor !== undefined && request.actor !== resolution.actor) conflictingFields.push("actor");
    if (conflictingFields.length > 0) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSE",
        "That operation key already belongs to a different resolution payload.",
        409,
        { operationKey: resolution.operationKey, conflictingFields },
        this.correlation(state, "idempotency_reuse"),
      );
    }
  }

  private reconcileSettlement(state: DemoState): Record<string, unknown> {
    if (state.exceptions.some((exception) => exception.severity === "BLOCKING" && exception.status === "OPEN")) {
      throw new DomainError("CLOSE_BLOCKED", "Resolve every blocking exception before settlement close.", 409, {
        blockingExceptions: state.exceptions.filter((item) => item.status === "OPEN").map((item) => item.id),
      });
    }
    const correlationId = this.correlation(state, "settlement");
    this.assertCloseOperationsComplete(state, correlationId);
    const grossCents = state.payments
      .filter((payment) => payment.kind === "CAPTURE")
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    const refundCents = state.payments
      .filter((payment) => payment.kind === "REFUND")
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    const feeCents = state.settlementEvidence.processorFee.amountCents;
    const expectedDepositCents = grossCents - feeCents - refundCents;
    const bankDepositCents = state.settlementEvidence.bankDeposit.amountCents;
    const varianceCents = expectedDepositCents - bankDepositCents;
    const matched = varianceCents === 0;

    state.totals.grossCents = grossCents;
    state.totals.feeCents = feeCents;
    state.totals.refundCents = refundCents;
    state.totals.expectedDepositCents = expectedDepositCents;
    state.totals.bankDepositCents = bankDepositCents;
    state.totals.varianceCents = varianceCents;
    state.close.status = matched ? "READY" : "BLOCKED";
    state.close.blockingExceptionCount = 0;
    state.close.lastEvaluatedAt = this.timestamp(state);
    this.integration(state, {
      system: "PRAIRIE_BANK",
      direction: "INBOUND",
      operation: "settlement.deposit.received",
      externalEventId: state.settlementEvidence.bankDeposit.externalEventId,
      operationKey: `settlement_${state.session.id.slice(0, 8)}_${state.settlementEvidence.bankDeposit.id}`,
      correlationId,
      status: matched ? "RECONCILED" : "REJECTED",
      httpStatus: 200,
      attempt: 1,
      note: matched
        ? "The independent synthetic bank deposit equals captures minus processor fees and refunds."
        : "The independent synthetic bank deposit does not equal the expected settlement net.",
      sanitizedRequest: {
        depositRecordId: state.settlementEvidence.bankDeposit.id,
        depositCents: bankDepositCents,
        currency: state.totals.currency,
      },
      sanitizedResponse: { matched, expectedDepositCents, varianceCents },
    });
    this.updateCheck(
      state,
      "settlement",
      matched ? "PASS" : "PENDING",
      matched ? "$5,299.50 − $145.26 − $125.00 = $5,029.24" : `${varianceCents} cents variance; close blocked`,
    );
    this.appendAudit(state, {
      type: matched ? "SETTLEMENT_RECONCILED" : "SETTLEMENT_VARIANCE_DETECTED",
      entityType: "settlement",
      entityId: "settlement_close",
      actor: "reconciliation-engine",
      correlationId,
      summary: matched
        ? "The independent deposit matched the expected net and the close became ready."
        : "The independent deposit did not match the expected net, so the close remained blocked.",
      details: {
        processorFeeRecordId: state.settlementEvidence.processorFee.id,
        bankDepositRecordId: state.settlementEvidence.bankDeposit.id,
        grossCents,
        feeCents,
        refundCents,
        expectedDepositCents,
        bankDepositCents,
        varianceCents,
      },
    });

    return {
      equation: "gross - fees - refunds = expected deposit",
      grossCents,
      feeCents,
      refundCents,
      expectedDepositCents,
      bankDepositCents,
      varianceCents,
      matched,
      closeStatus: state.close.status,
    };
  }

  private applyResolution(
    state: DemoState,
    exception: DemoException,
    request: ResolutionCommand,
    correlationId: string,
  ): void {
    if (request.expectedVersion !== exception.version) {
      throw new VersionConflictError({
        exceptionId: exception.id,
        expectedVersion: request.expectedVersion,
        actualVersion: exception.version,
        winningResolution: exception.resolution,
      }, correlationId);
    }
    const payment = this.requirePayment(state, exception.paymentId);
    const invoice = this.requireInvoice(state, request.candidateInvoiceId);
    const alreadyAllocated = state.allocations
      .filter((allocation) => allocation.paymentId === payment.id)
      .reduce((sum, allocation) => sum + allocation.amountCents, 0);
    const paymentRemainderCents = payment.amountCents - alreadyAllocated;
    if (request.acceptedAmountCents !== paymentRemainderCents) {
      throw new DomainError(
        "RESOLUTION_AMOUNT_MUST_EQUAL_PAYMENT_REMAINDER",
        "This whole-payment demo requires the accepted amount to equal the payment remainder.",
        422,
        {
          paymentId: payment.id,
          acceptedAmountCents: request.acceptedAmountCents,
          paymentRemainderCents,
        },
        correlationId,
      );
    }
    if (request.acceptedAmountCents > invoice.balanceCents) {
      throw new DomainError("ALLOCATION_EXCEEDS_BALANCE", "The accepted amount exceeds an available balance.", 422, {
        paymentRemainderCents,
        invoiceBalanceCents: invoice.balanceCents,
      }, correlationId);
    }

    this.allocate(state, payment.id, invoice.id, request.acceptedAmountCents, "HUMAN_RESOLUTION", request.operationKey);
    this.createOutbox(state, payment.id, invoice.id, request.operationKey);
    this.deliverOutboxNormally(state, request.operationKey, correlationId);
    exception.status = "RESOLVED";
    exception.version += 1;
    exception.resolution = {
      candidateInvoiceId: request.candidateInvoiceId,
      acceptedAmountCents: request.acceptedAmountCents,
      actor: request.actor,
      reason: request.reason,
      operationKey: request.operationKey,
      resolvedAt: this.timestamp(state),
    };
    state.close.status = "PROCESSING";
    state.close.blockingExceptionCount = 0;
    state.close.lastEvaluatedAt = this.timestamp(state);
    state.invariants.acceptedDecisions += 1;
    this.appendAudit(state, {
      type: "EXCEPTION_RESOLVED",
      entityType: "exception",
      entityId: exception.id,
      actor: request.actor,
      correlationId,
      summary: `${request.actor} resolved the ambiguous payment without editing prior evidence.`,
      details: {
        previousVersion: request.expectedVersion,
        resultingVersion: exception.version,
        candidateInvoiceId: request.candidateInvoiceId,
        acceptedAmountCents: request.acceptedAmountCents,
        operationKey: request.operationKey,
      },
    });
  }

  private allocate(
    state: DemoState,
    paymentId: string,
    invoiceId: string,
    amountCents: number,
    source: Allocation["source"],
    operationKey: string,
  ): Allocation {
    const existing = state.allocations.find((allocation) => allocation.operationKey === operationKey);
    if (existing) {
      if (
        existing.paymentId === paymentId &&
        existing.invoiceId === invoiceId &&
        existing.amountCents === amountCents &&
        existing.source === source
      ) {
        return existing;
      }
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSE",
        "That operation key already belongs to a different allocation payload.",
        409,
        { operationKey, existingPaymentId: existing.paymentId, requestedPaymentId: paymentId },
      );
    }
    const payment = this.requirePayment(state, paymentId);
    const invoice = this.requireInvoice(state, invoiceId);
    const alreadyFromPayment = state.allocations
      .filter((allocation) => allocation.paymentId === paymentId)
      .reduce((sum, allocation) => sum + allocation.amountCents, 0);
    if (amountCents > payment.amountCents - alreadyFromPayment || amountCents > invoice.balanceCents) {
      throw new DomainError("ALLOCATION_EXCEEDS_BALANCE", "An allocation cannot exceed the payment remainder or invoice balance.", 422, {
        paymentId,
        invoiceId,
        amountCents,
      });
    }
    const allocation: Allocation = {
      id: `alloc_${String(state.allocations.length + 1).padStart(4, "0")}`,
      paymentId,
      invoiceId,
      amountCents,
      source,
      operationKey,
      createdAt: this.timestamp(state),
    };
    state.allocations.push(allocation);
    invoice.balanceCents -= amountCents;
    invoice.status = invoice.balanceCents === 0 ? "PAID" : "PARTIAL";
    payment.status = "MATCHED";
    return allocation;
  }

  private createOutbox(state: DemoState, paymentId: string, invoiceId: string, operationKey: string): OutboxItem {
    const existing = state.outbox.find((item) => item.operationKey === operationKey);
    if (existing) {
      if (existing.paymentId === paymentId && existing.invoiceId === invoiceId && existing.destination === "LEGACY_DMS") {
        return existing;
      }
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSE",
        "That operation key already belongs to a different outbound posting payload.",
        409,
        { operationKey, existingPaymentId: existing.paymentId, requestedPaymentId: paymentId },
      );
    }
    const item: OutboxItem = {
      id: `out_${String(state.outbox.length + 1).padStart(4, "0")}`,
      paymentId,
      invoiceId,
      operationKey,
      destination: "LEGACY_DMS",
      status: "PENDING",
      attemptCount: 0,
      createdAt: this.timestamp(state),
      deliveredAt: null,
    };
    state.outbox.push(item);
    state.invariants.outboxCreated += 1;
    return item;
  }

  private deliverOutboxNormally(state: DemoState, operationKey: string, correlationId: string): void {
    const outbox = this.requireOutbox(state, operationKey);
    if (outbox.status === "DELIVERED") return;
    const payment = this.requirePayment(state, outbox.paymentId);
    const invoice = this.requireInvoice(state, outbox.invoiceId);
    const allocatedCents = state.allocations
      .filter((allocation) => allocation.paymentId === payment.id)
      .reduce((sum, allocation) => sum + allocation.amountCents, 0);
    if (allocatedCents !== payment.amountCents) {
      throw new DomainError(
        "POSTING_REQUIRES_FULL_ALLOCATION",
        "A payment cannot be posted until its complete amount is allocated.",
        409,
        { paymentId: payment.id, paymentAmountCents: payment.amountCents, allocatedCents },
        correlationId,
      );
    }
    outbox.attemptCount += 1;
    outbox.status = "DELIVERED";
    outbox.deliveredAt = this.timestamp(state);
    payment.status = "POSTED";
    state.invariants.dmsAttempts += 1;
    state.invariants.dmsMutations += 1;
    state.invariants.outboxDelivered += 1;
    this.integration(state, {
      system: "LEGACY_DMS",
      direction: "OUTBOUND",
      operation: "post-payment",
      externalEventId: payment.externalEventId,
      operationKey,
      correlationId,
      status: "COMMITTED",
      httpStatus: 201,
      attempt: outbox.attemptCount,
      note: "LegacyDMS accepted one synthetic payment posting.",
      sanitizedRequest: { repairOrderNumber: invoice.repairOrderNumber, amountCents: payment.amountCents, operationKey },
      sanitizedResponse: { postingId: `OP-${outbox.id.slice(-4).toUpperCase()}`, committed: true },
    });
  }

  private acceptInboxDelivery(state: DemoState, externalEventId: string): boolean {
    state.invariants.processorDeliveriesReceived += 1;
    const existing = state.inbox.find((entry) => entry.provider === "northstar" && entry.externalEventId === externalEventId);
    if (existing) {
      existing.deliveryCount += 1;
      state.invariants.duplicateDeliveriesIgnored += 1;
      return false;
    }
    state.inbox.push({
      provider: "northstar",
      externalEventId,
      firstSeenAt: this.timestamp(state),
      deliveryCount: 1,
    });
    state.invariants.uniqueProcessorEventsApplied += 1;
    return true;
  }

  private integration(state: DemoState, input: Omit<IntegrationAttempt, "id" | "occurredAt">): void {
    state.integrationAttempts.push({
      id: `try_${String(state.integrationAttempts.length + 1).padStart(4, "0")}`,
      occurredAt: this.timestamp(state),
      ...input,
    });
  }

  private appendAudit(state: DemoState, input: Omit<AuditEvent, "id" | "sequence" | "occurredAt">): void {
    const sequence = state.auditEvents.length + 1;
    state.auditEvents.push({
      id: `audit_${String(sequence).padStart(4, "0")}`,
      sequence,
      occurredAt: this.timestamp(state),
      ...input,
    });
  }

  private completeAction(
    state: DemoState,
    action: Exclude<DemoAction, "run-all" | "resolve-exception">,
    chapter: number,
  ): void {
    state.completedActions.push(action);
    this.setChapter(state, chapter);
  }

  private setChapter(state: DemoState, chapter: number): void {
    state.currentChapter = chapter;
    for (const item of state.chapters) {
      if (item.number <= chapter) item.status = "COMPLETE";
      else if (item.number === chapter + 1) item.status = "ACTIVE";
      else item.status = "LOCKED";
    }
  }

  private assertPrerequisite(
    state: DemoState,
    action: Exclude<DemoAction, "run-all" | "resolve-exception">,
  ): void {
    const ordered: Array<Exclude<DemoAction, "run-all" | "resolve-exception">> = [
      "process-routine",
      "deliver-duplicate",
      "simulate-lost-response",
      "open-ambiguous-exception",
      "simulate-resolution-race",
      "reconcile-settlement",
    ];
    const index = ordered.indexOf(action);
    const prerequisite = index > 0 ? ordered[index - 1] : undefined;
    if (
      action === "reconcile-settlement" &&
      state.exceptions.some((item) => item.id === "exc_ambiguous_1009" && item.status === "RESOLVED")
    ) {
      return;
    }
    if (prerequisite && !state.completedActions.includes(prerequisite)) {
      throw new DomainError("ACTION_OUT_OF_ORDER", `Complete ${prerequisite} before ${action}.`, 409, {
        requiredAction: prerequisite,
        requestedAction: action,
      });
    }
  }

  private replayResult(state: DemoState, action: DemoAction): Record<string, unknown> {
    return {
      message: "This chapter was already applied. The original state was returned without another mutation.",
      action,
      sessionVersion: state.session.version,
      allocations: state.allocations.length,
      dmsAttempts: state.invariants.dmsAttempts,
      dmsMutations: state.invariants.dmsMutations,
      closeStatus: state.close.status,
    };
  }

  private assertCloseOperationsComplete(state: DemoState, correlationId: string): void {
    const incompleteCaptureIds = state.payments
      .filter((payment) => payment.kind === "CAPTURE")
      .filter((payment) => {
        const allocatedCents = state.allocations
          .filter((allocation) => allocation.paymentId === payment.id)
          .reduce((sum, allocation) => sum + allocation.amountCents, 0);
        return allocatedCents !== payment.amountCents || payment.status !== "POSTED";
      })
      .map((payment) => payment.id);
    const unaccountedRefundIds = state.payments
      .filter((payment) => payment.kind === "REFUND" && payment.status !== "REFUNDED")
      .map((payment) => payment.id);
    const pendingOutboxIds = state.outbox
      .filter((item) => item.status !== "DELIVERED")
      .map((item) => item.id);

    if (incompleteCaptureIds.length > 0 || unaccountedRefundIds.length > 0 || pendingOutboxIds.length > 0) {
      throw new DomainError(
        "CLOSE_INCOMPLETE",
        "Every capture, refund, and outbound posting must be complete before settlement close.",
        409,
        { incompleteCaptureIds, unaccountedRefundIds, pendingOutboxIds },
        correlationId,
      );
    }
  }

  private requirePayment(state: DemoState, paymentId: string) {
    const payment = state.payments.find((item) => item.id === paymentId);
    if (!payment) throw new Error(`Payment ${paymentId} is missing from the synthetic fixture`);
    return payment;
  }

  private requireInvoice(state: DemoState, invoiceId: string) {
    const invoice = state.invoices.find((item) => item.id === invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} is missing from the synthetic fixture`);
    return invoice;
  }

  private requireOutbox(state: DemoState, operationKey: string) {
    const item = state.outbox.find((candidate) => candidate.operationKey === operationKey);
    if (!item) throw new Error(`Outbox item ${operationKey} is missing from the synthetic fixture`);
    return item;
  }

  private requireOpenException(state: DemoState): DemoException {
    const exception = state.exceptions.find((item) => item.id === "exc_ambiguous_1009");
    if (!exception) {
      throw new DomainError("ACTION_OUT_OF_ORDER", "Open the ambiguous exception before simulating the race.", 409, {
        requiredAction: "open-ambiguous-exception",
      });
    }
    if (exception.status !== "OPEN") {
      throw new VersionConflictError({ exceptionId: exception.id, actualVersion: exception.version, winningResolution: exception.resolution });
    }
    return exception;
  }

  private updateCheck(state: DemoState, id: string, status: "PASS" | "PENDING", value: string): void {
    const check = state.evidence.checks.find((item) => item.id === id);
    if (!check) throw new Error(`Evidence check ${id} is missing`);
    check.status = status;
    check.value = value;
  }

  private correlation(state: DemoState, suffix: string): string {
    return `corr_${state.session.id.slice(0, 8)}_${suffix}`;
  }

  private timestamp(state: DemoState): string {
    const base = new Date(state.session.resetAt).getTime();
    const offset = state.auditEvents.length * 1_000 + state.integrationAttempts.length * 100 + state.allocations.length * 10;
    return new Date(base + offset).toISOString();
  }

  private assertInvariants(state: DemoState): void {
    const cents = [
      state.totals.grossCents,
      state.totals.feeCents,
      state.totals.refundCents,
      state.totals.expectedDepositCents,
      state.totals.bankDepositCents,
      state.totals.varianceCents,
      ...state.payments.map((payment) => payment.amountCents),
      ...state.invoices.flatMap((invoice) => [invoice.amountCents, invoice.balanceCents]),
      ...state.allocations.map((allocation) => allocation.amountCents),
    ];
    if (!cents.every(Number.isInteger)) throw new Error("Financial invariant failed: all money must use integer cents");

    const currency = state.totals.currency;
    if (
      state.settlementEvidence.processorFee.currency !== currency ||
      state.settlementEvidence.bankDeposit.currency !== currency ||
      state.payments.some((payment) => payment.currency !== currency) ||
      state.invoices.some((invoice) => invoice.currency !== currency)
    ) {
      throw new Error("Financial invariant failed: every component must use the close currency");
    }
    const grossCents = state.payments
      .filter((payment) => payment.kind === "CAPTURE")
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    const refundCents = state.payments
      .filter((payment) => payment.kind === "REFUND")
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    const feeCents = state.settlementEvidence.processorFee.amountCents;
    const expectedDepositCents = grossCents - feeCents - refundCents;
    if (
      state.totals.grossCents !== grossCents ||
      state.totals.refundCents !== refundCents ||
      state.totals.feeCents !== feeCents ||
      state.totals.expectedDepositCents !== expectedDepositCents
    ) {
      throw new Error("Settlement invariant failed: source components do not match the derived totals");
    }
    if (state.totals.varianceCents !== expectedDepositCents - state.totals.bankDepositCents) {
      throw new Error("Settlement invariant failed: variance must equal expected deposit minus bank deposit");
    }

    for (const payment of state.payments) {
      const allocated = state.allocations
        .filter((allocation) => allocation.paymentId === payment.id)
        .reduce((sum, allocation) => sum + allocation.amountCents, 0);
      if (allocated > payment.amountCents) throw new Error(`Payment over-allocation invariant failed for ${payment.id}`);
      if (payment.kind === "CAPTURE" && payment.status === "POSTED" && allocated !== payment.amountCents) {
        throw new Error(`Posted payment completeness invariant failed for ${payment.id}`);
      }
    }
    for (const invoice of state.invoices) {
      const allocated = state.allocations
        .filter((allocation) => allocation.invoiceId === invoice.id)
        .reduce((sum, allocation) => sum + allocation.amountCents, 0);
      if (allocated > invoice.amountCents || invoice.balanceCents !== invoice.amountCents - allocated) {
        throw new Error(`Invoice balance invariant failed for ${invoice.id}`);
      }
    }
    const allocationKeys = new Set(state.allocations.map((allocation) => allocation.operationKey));
    const outboxKeys = new Set(state.outbox.map((item) => item.operationKey));
    if (allocationKeys.size !== state.allocations.length) throw new Error("Allocation operation keys must be unique");
    if (outboxKeys.size !== state.outbox.length) throw new Error("Outbox operation keys must be unique");

    for (const allocation of state.allocations) {
      const matchingOutbox = state.outbox.filter((item) => item.operationKey === allocation.operationKey);
      if (
        matchingOutbox.length !== 1 ||
        matchingOutbox[0]?.paymentId !== allocation.paymentId ||
        matchingOutbox[0]?.invoiceId !== allocation.invoiceId
      ) {
        throw new Error(`Allocation/outbox identity invariant failed for ${allocation.operationKey}`);
      }
    }
    for (const outbox of state.outbox.filter((item) => item.status === "DELIVERED")) {
      const committed = state.integrationAttempts.filter((attempt) =>
        attempt.system === "LEGACY_DMS" &&
        attempt.operationKey === outbox.operationKey &&
        (
          attempt.status === "COMMITTED" ||
          (attempt.status === "RESPONSE_LOST" && attempt.sanitizedResponse?.committed === true)
        ));
      if (committed.length !== 1) {
        throw new Error(`Delivered outbox must have exactly one destination mutation for ${outbox.operationKey}`);
      }
    }
    for (const exception of state.exceptions.filter((item) => item.status === "RESOLVED")) {
      const resolution = exception.resolution;
      if (!resolution) throw new Error(`Resolved exception ${exception.id} has no resolution`);
      const payment = this.requirePayment(state, exception.paymentId);
      const matchingAllocations = state.allocations.filter((allocation) =>
        allocation.paymentId === exception.paymentId && allocation.operationKey === resolution.operationKey);
      const allocation = matchingAllocations[0];
      const outbox = state.outbox.find((item) => item.operationKey === resolution.operationKey);
      if (
        matchingAllocations.length !== 1 ||
        !allocation ||
        allocation.source !== "HUMAN_RESOLUTION" ||
        allocation.invoiceId !== resolution.candidateInvoiceId ||
        allocation.amountCents !== resolution.acceptedAmountCents ||
        allocation.amountCents !== payment.amountCents ||
        payment.status !== "POSTED" ||
        !outbox ||
        outbox.paymentId !== payment.id ||
        outbox.invoiceId !== allocation.invoiceId ||
        outbox.status !== "DELIVERED"
      ) {
        throw new Error(`Resolved exception evidence invariant failed for ${exception.id}`);
      }
    }

    const openBlocking = state.exceptions.filter((item) => item.severity === "BLOCKING" && item.status === "OPEN").length;
    if (state.close.blockingExceptionCount !== openBlocking) {
      throw new Error("Close blocker count must equal the open blocking exception count");
    }
    if (state.invariants.uniqueProcessorEventsApplied !== state.inbox.length) {
      throw new Error("Inbox invariant failed: applied event count does not match unique receipts");
    }
    const receivedDeliveries = state.inbox.reduce((sum, receipt) => sum + receipt.deliveryCount, 0);
    const duplicateDeliveries = state.inbox.reduce((sum, receipt) => sum + receipt.deliveryCount - 1, 0);
    if (
      state.invariants.processorDeliveriesReceived !== receivedDeliveries ||
      state.invariants.duplicateDeliveriesIgnored !== duplicateDeliveries
    ) {
      throw new Error("Inbox invariant failed: delivery counters do not match durable receipts");
    }
    const dmsAttempts = state.integrationAttempts.filter((attempt) => attempt.system === "LEGACY_DMS").length;
    const dmsMutations = state.integrationAttempts.filter((attempt) =>
      attempt.system === "LEGACY_DMS" &&
      (
        attempt.status === "COMMITTED" ||
        (attempt.status === "RESPONSE_LOST" && attempt.sanitizedResponse?.committed === true)
      )).length;
    if (state.invariants.dmsAttempts !== dmsAttempts || state.invariants.dmsMutations !== dmsMutations) {
      throw new Error("DMS invariant failed: attempt and mutation counters do not match evidence");
    }
    const deliveredOutbox = state.outbox.filter((item) => item.status === "DELIVERED").length;
    if (
      state.invariants.outboxCreated !== state.outbox.length ||
      state.invariants.outboxDelivered !== deliveredOutbox
    ) {
      throw new Error("Outbox invariant failed: counters do not match persisted intent");
    }

    if (state.completedActions.includes("reconcile-settlement") &&
      state.totals.bankDepositCents !== state.settlementEvidence.bankDeposit.amountCents) {
      throw new Error("Settlement invariant failed: evaluated deposit must come from the independent bank record");
    }
    if (state.close.status === "READY") {
      if (!state.completedActions.includes("reconcile-settlement")) {
        throw new Error("Close cannot be ready before settlement evaluation");
      }
      if (openBlocking !== 0 || state.outbox.some((item) => item.status !== "DELIVERED")) {
        throw new Error("Close cannot be ready with blocking work or pending outbox intent");
      }
      const incompleteCapture = state.payments.some((payment) => {
        if (payment.kind !== "CAPTURE") return false;
        const allocated = state.allocations
          .filter((allocation) => allocation.paymentId === payment.id)
          .reduce((sum, allocation) => sum + allocation.amountCents, 0);
        return payment.status !== "POSTED" || allocated !== payment.amountCents;
      });
      const unaccountedRefund = state.payments.some((payment) => payment.kind === "REFUND" && payment.status !== "REFUNDED");
      if (incompleteCapture || unaccountedRefund || state.totals.varianceCents !== 0) {
        throw new Error("Close cannot be ready until every financial component is complete and reconciled");
      }
    }
  }
}
