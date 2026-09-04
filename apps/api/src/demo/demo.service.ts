import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CloseLocationRequestSchema,
  DEMO_SESSION_HEADER,
  DemoStateSchema,
  ResolveExceptionRequestSchema,
  SettlementAdjustmentRequestSchema,
  WORKSPACE_AS_OF,
  type CloseLocationRequest,
  type DemoException,
  type DemoState,
  type MutationResponse,
  type ResolveExceptionRequest,
  type SessionResponse,
  type SettlementAdjustmentRequest,
} from "@postonce/contracts";
import { z } from "zod";
import { DomainError, SessionNotFoundError } from "../common/domain-error.js";
import { DemoEngine } from "./domain/demo.engine.js";
import { createSeedState } from "./domain/seed.js";
import { DEMO_REPOSITORY, type DemoRepository } from "./repositories/demo.repository.js";

type PersistedRejection = {
  code: string;
  message: string;
  status?: number;
  details: Record<string, unknown>;
  correlationId?: string;
};

type ProductMutationOutcome = {
  changed: boolean;
  replayed: boolean;
  result: Record<string, unknown>;
  rejected?: PersistedRejection;
};

type ExceptionFilters = {
  location?: string | undefined;
  status?: string | undefined;
  sort?: string | undefined;
  q?: string | undefined;
};

type PaymentFilters = {
  location?: string | undefined;
  department?: string | undefined;
  dmsState?: string | undefined;
  q?: string | undefined;
};

@Injectable()
export class DemoService {
  private readonly engine = new DemoEngine();
  private readonly creationWindows = new Map<string, number[]>();
  private readonly mutationWindows = new Map<string, number[]>();
  private rateLimitOperations = 0;

  public constructor(
    @Inject(DEMO_REPOSITORY) private readonly repository: DemoRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async createSession(clientKey = "anonymous"): Promise<SessionResponse> {
    this.enforceCreationLimit(clientKey);
    const sessionId = randomUUID();
    const state = DemoStateSchema.parse(createSeedState(sessionId));
    this.engine.assertInvariants(state);
    await this.repository.create(state);
    return { sessionId, sessionHeader: DEMO_SESSION_HEADER, state };
  }

  async resetSession(sessionId: string): Promise<SessionResponse> {
    this.assertSessionId(sessionId);
    this.enforceMutationLimit(sessionId);
    const existing = await this.requireState(sessionId);
    const state = createSeedState(sessionId);
    state.session.createdAt = existing.session.createdAt;
    state.session.resetAt = new Date().toISOString();
    state.metadata.generatedAt = state.session.resetAt;
    const parsed = DemoStateSchema.parse(state);
    this.engine.assertInvariants(parsed);
    await this.repository.replace(parsed);
    return { sessionId, sessionHeader: DEMO_SESSION_HEADER, state: parsed };
  }

  async state(sessionId: string): Promise<DemoState> {
    return this.requireState(sessionId);
  }

  async resolveException(
    sessionId: string,
    exceptionId: string,
    request: ResolveExceptionRequest,
  ): Promise<MutationResponse> {
    const parsed = ResolveExceptionRequestSchema.parse(request);
    return this.mutate(sessionId, (state) => this.engine.resolveException(state, exceptionId, parsed));
  }

  async closeLocation(
    sessionId: string,
    rooftopId: string,
    request: CloseLocationRequest,
  ): Promise<MutationResponse> {
    const parsed = CloseLocationRequestSchema.parse(request);
    return this.mutate(sessionId, (state) => this.engine.closeLocation(state, rooftopId, parsed));
  }

  async recordAdjustment(
    sessionId: string,
    payoutId: string,
    request: SettlementAdjustmentRequest,
  ): Promise<MutationResponse> {
    const parsed = SettlementAdjustmentRequestSchema.parse(request);
    return this.mutate(sessionId, (state) => this.engine.recordAdjustment(state, payoutId, parsed));
  }

  async closeOverview(sessionId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    const items = state.operationalCloses.map((close) => this.closeProjection(state, close.rooftopId));
    return {
      items,
      total: items.length,
      summary: {
        ready: items.filter((item) => item.close.status === "READY").length,
        blocked: items.filter((item) => item.close.status === "BLOCKED").length,
        closed: items.filter((item) => item.close.status === "CLOSED").length,
        openOperationalExceptions: state.exceptions.filter((item) => item.status === "OPEN" && item.severity === "BLOCKING").length,
        priorPayoutVariances: state.payouts.filter((item) => item.payoutDate !== state.metadata.businessDate && item.status === "VARIANCE").length,
      },
      businessDate: state.metadata.businessDate,
      workspaceAsOf: state.metadata.workspaceAsOf,
    };
  }

  async closeDetail(sessionId: string, rooftopId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    return this.closeProjection(state, rooftopId);
  }

  async listExceptions(sessionId: string, filters: ExceptionFilters): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    const rooftopId = this.resolveRooftopFilter(state, filters.location);
    const query = filters.q?.trim().toLocaleLowerCase() ?? "";
    let items = state.exceptions.filter((exception) => {
      const payment = state.payments.find((candidate) => candidate.id === exception.paymentId);
      const rooftop = state.rooftops.find((candidate) => candidate.id === exception.rooftopId);
      const statusMatches = !filters.status || exception.status === filters.status.toUpperCase();
      const locationMatches = !rooftopId || exception.rooftopId === rooftopId;
      const text = [exception.id, exception.title, exception.summary, payment?.id, payment?.customerLabel, rooftop?.name]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return statusMatches && locationMatches && (!query || text.includes(query));
    });

    const asOf = new Date(WORKSPACE_AS_OF).getTime();
    const sort = filters.sort ?? "newest";
    items = [...items].sort((left, right) => {
      if (sort === "oldest") return Date.parse(left.openedAt) - Date.parse(right.openedAt);
      if (sort === "amount-high" || sort === "amount-low") {
        const leftAmount = state.payments.find((item) => item.id === left.paymentId)?.amountCents ?? 0;
        const rightAmount = state.payments.find((item) => item.id === right.paymentId)?.amountCents ?? 0;
        return sort === "amount-high" ? rightAmount - leftAmount : leftAmount - rightAmount;
      }
      return Date.parse(right.openedAt) - Date.parse(left.openedAt);
    });

    return {
      items: items.map((exception) => ({
        ...exception,
        payment: state.payments.find((candidate) => candidate.id === exception.paymentId),
        rooftop: state.rooftops.find((candidate) => candidate.id === exception.rooftopId),
        ageMinutes: Math.max(0, Math.round((asOf - Date.parse(exception.openedAt)) / 60_000)),
      })),
      total: items.length,
      filters: { ...filters, location: filters.location ?? null, status: filters.status ?? null, sort },
    };
  }

  async exceptionDetail(sessionId: string, exceptionId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    const exception = this.requireException(state, exceptionId);
    const payment = state.payments.find((item) => item.id === exception.paymentId)!;
    return {
      exception,
      payment,
      rooftop: state.rooftops.find((item) => item.id === exception.rooftopId),
      candidates: exception.candidates.map((candidate) => ({
        ...candidate,
        dmsRecord: candidate.targetType === "DMS_RECORD"
          ? state.dmsRecords.find((item) => item.id === candidate.targetId) ?? null
          : state.dmsRecords.find((item) => item.recordNumber === candidate.recordNumber && item.rooftopId === exception.rooftopId) ?? null,
        originalPayment: candidate.targetType === "ORIGINAL_PAYMENT"
          ? state.payments.find((item) => item.id === candidate.targetId) ?? null
          : null,
      })),
      relatedAllocations: state.allocations.filter((item) => item.paymentId === payment.id),
      relatedRefundLinks: state.refundLinks.filter((item) => item.refundPaymentId === payment.id),
    };
  }

  async listPayments(sessionId: string, filters: PaymentFilters): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    const rooftopId = this.resolveRooftopFilter(state, filters.location);
    const query = filters.q?.trim().toLocaleLowerCase() ?? "";
    const items = state.payments
      .filter((payment) => {
        const rooftop = state.rooftops.find((item) => item.id === payment.rooftopId);
        const dollars = (payment.amountCents / 100).toFixed(2);
        const formattedAmount = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol" }).format(payment.amountCents / 100);
        const text = [payment.id, payment.processorTransactionId, payment.customerLabel, payment.sourceReference, payment.cardLast4, rooftop?.name, String(payment.amountCents), dollars, formattedAmount]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        return (!rooftopId || payment.rooftopId === rooftopId)
          && (!filters.department || payment.department === filters.department.toUpperCase())
          && (!filters.dmsState || payment.dmsState === filters.dmsState.toUpperCase())
          && (!query || text.includes(query));
      })
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
    return {
      items: items.map((payment) => ({
        ...payment,
        rooftop: state.rooftops.find((item) => item.id === payment.rooftopId),
        record: payment.linkedRecordId ? state.dmsRecords.find((item) => item.id === payment.linkedRecordId) ?? null : null,
      })),
      total: items.length,
      fridayTotal: items.filter((item) => item.inFridayClose).length,
    };
  }

  async paymentDetail(sessionId: string, paymentId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    const payment = state.payments.find((item) => item.id.toLocaleLowerCase() === paymentId.toLocaleLowerCase());
    if (!payment) this.notFound("PAYMENT_NOT_FOUND", "Payment", paymentId);
    const allocations = state.allocations.filter((item) => item.paymentId === payment.id);
    const operationKeys = new Set([
      payment.postingOperationKey,
      ...allocations.map((item) => item.operationKey),
      ...state.refundLinks.filter((item) => item.refundPaymentId === payment.id).map((item) => item.operationKey),
    ].filter((item): item is string => Boolean(item)));
    return {
      payment,
      rooftop: state.rooftops.find((item) => item.id === payment.rooftopId),
      record: payment.linkedRecordId ? state.dmsRecords.find((item) => item.id === payment.linkedRecordId) ?? null : null,
      allocations,
      refundLinks: state.refundLinks.filter((item) => item.refundPaymentId === payment.id || item.originalPaymentId === payment.id),
      evidence: {
        inbox: state.inbox.find((item) => item.externalEventId === payment.externalEventId) ?? null,
        outbox: state.outbox.filter((item) => item.paymentId === payment.id),
        attempts: state.integrationAttempts.filter((item) => item.externalEventId === payment.externalEventId || operationKeys.has(item.operationKey)),
        auditEvents: state.auditEvents.filter((item) => item.entityId === payment.id || operationKeys.has(String(item.details.operationKey ?? ""))),
      },
    };
  }

  async listDeposits(sessionId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    const items = [...state.payouts]
      .sort((left, right) => right.payoutDate.localeCompare(left.payoutDate) || left.rooftopId.localeCompare(right.rooftopId))
      .map((payout) => this.depositProjection(state, payout.id));
    return { items, total: items.length };
  }

  async depositDetail(sessionId: string, payoutId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    return this.depositProjection(state, payoutId);
  }

  async activity(sessionId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    const items = [...state.auditEvents].sort((left, right) => right.sequence - left.sequence);
    return { items, total: items.length };
  }

  async integrations(sessionId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    const items = state.integrations.map((integration) => {
      const system = integration.id === "legacy-dms"
        ? "LEGACY_DMS"
        : integration.id === "northstar-processor"
          ? "NORTHSTAR_PROCESSOR"
          : "PRAIRIE_BANK";
      const attempts = state.integrationAttempts.filter((item) => item.system === system);
      return {
        ...integration,
        attemptCount: attempts.length,
        recentAttempts: [...attempts].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, 12),
      };
    });
    return { items, total: items.length };
  }

  async search(sessionId: string, rawQuery: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    const query = rawQuery.trim().toLocaleLowerCase();
    if (query.length < 2) return { query: rawQuery, groups: [], total: 0 };
    const includes = (...values: Array<string | null | undefined>) => values.some((value) => value?.toLocaleLowerCase().includes(query));
    const paymentItems = state.payments.filter((item) => {
      const correlationIds = state.integrationAttempts
        .filter((attempt) => attempt.externalEventId === item.externalEventId || attempt.operationKey === item.postingOperationKey)
        .map((attempt) => attempt.correlationId);
      const dollars = (item.amountCents / 100).toFixed(2);
      const formattedAmount = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol" }).format(item.amountCents / 100);
      return includes(item.id, item.customerLabel, item.processorTransactionId, item.externalEventId, item.sourceReference, item.postingOperationKey, item.cardLast4, String(item.amountCents), dollars, formattedAmount, ...correlationIds);
    }).slice(0, 6).map((item) => ({ id: item.id, label: `${item.customerLabel} · ${item.id}`, meta: item.sourceReference ?? item.processorTransactionId, href: `/app/payments/${item.id}` }));
    const exceptionItems = state.exceptions.filter((item) => includes(item.id, item.title, item.summary, item.paymentId))
      .slice(0, 6).map((item) => ({ id: item.id, label: `${item.id} · ${item.title}`, meta: item.status, href: `/app/exceptions/${item.id}` }));
    const recordItems = state.dmsRecords.filter((item) => includes(item.id, item.recordNumber, item.customerLabel, item.vehicleLabel, item.advisorLabel))
      .slice(0, 6).map((item) => ({ id: item.id, label: `${item.recordNumber} · ${item.customerLabel}`, meta: item.recordType, href: `/app/payments?q=${encodeURIComponent(item.recordNumber)}` }));
    const depositItems = state.payouts.filter((item) => includes(item.id, item.externalPayoutId, item.payoutDate))
      .slice(0, 6).map((item) => ({ id: item.id, label: item.externalPayoutId ?? "Pending payout", meta: item.payoutDate, href: `/app/deposits/${item.id}` }));
    const groups = [
      { key: "payments", label: "Payments", items: paymentItems },
      { key: "exceptions", label: "Exceptions", items: exceptionItems },
      { key: "records", label: "DMS records", items: recordItems },
      { key: "deposits", label: "Deposits", items: depositItems },
    ].filter((group) => group.items.length > 0);
    return { query: rawQuery, groups, total: groups.reduce((total, group) => total + group.items.length, 0) };
  }

  async architectureEvidence(sessionId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    return {
      disclaimer: state.metadata.disclaimer,
      topology: [
        { boundary: "Northstar Processor simulator", direction: "inbound", guard: "durable inbox + unique provider event" },
        { boundary: "PostOnce ledger", direction: "internal", guard: "integer cents + immutable allocations + optimistic version" },
        { boundary: "LegacyDMS simulator", direction: "outbound", guard: "transactional outbox + stable operation key" },
        { boundary: "Prairie Bank feed simulator", direction: "inbound", guard: "immutable payout evidence + append-only adjustments" },
      ],
      deliverySemantics: "At-least-once transport with idempotent financial mutation; exactly-once network delivery is not claimed.",
      persistence: {
        mode: this.repository.mode,
        readModel: "Versioned workspace snapshot for fast rendering",
        sourceOfEvidence: "Relational payments, allocations, refund links, outbox, attempts, audit, closes, payouts, and adjustments",
      },
      fixture: {
        fridayPayments: state.payments.filter((item) => item.inFridayClose).length,
        rooftops: state.rooftops.length,
        openExceptions: state.exceptions.filter((item) => item.status === "OPEN").length,
      },
      invariants: state.invariants,
    };
  }

  private async mutate(
    sessionId: string,
    operation: (state: DemoState) => ProductMutationOutcome,
  ): Promise<MutationResponse> {
    this.assertSessionId(sessionId);
    this.enforceMutationLimit(sessionId);
    const outcome = await this.repository.mutate(sessionId, (state) => {
      const result = operation(state);
      this.engine.assertInvariants(state);
      DemoStateSchema.parse(state);
      return { value: result, changed: result.changed };
    });
    if (!outcome) throw new SessionNotFoundError(sessionId);
    const state = await this.requireState(sessionId);
    if (outcome.rejected) {
      throw new DomainError(
        outcome.rejected.code,
        outcome.rejected.message,
        outcome.rejected.status ?? 409,
        outcome.rejected.details,
        outcome.rejected.correlationId,
      );
    }
    return { replayed: outcome.replayed, result: outcome.result, state };
  }

  private closeProjection(state: DemoState, rooftopInput: string): {
    rooftop: DemoState["rooftops"][number];
    close: DemoState["operationalCloses"][number];
    payments: { count: number; netAmountCents: number; departmentCounts: Record<string, number> };
    openExceptions: DemoException[];
    settlement: DemoState["payouts"][number] | null;
  } {
    const rooftop = state.rooftops.find((item) => item.id === rooftopInput || item.code.toLocaleLowerCase() === rooftopInput.toLocaleLowerCase());
    if (!rooftop) this.notFound("ROOFTOP_NOT_FOUND", "Location", rooftopInput);
    const close = state.operationalCloses.find((item) => item.rooftopId === rooftop.id && item.businessDate === state.metadata.businessDate);
    if (!close) this.notFound("CLOSE_NOT_FOUND", "Close", rooftopInput);
    const payments = state.payments.filter((item) => item.rooftopId === rooftop.id && item.inFridayClose);
    const departmentCounts = Object.fromEntries(["SERVICE", "PARTS", "SALES"].map((department) => [
      department,
      payments.filter((item) => item.department === department).length,
    ]));
    return {
      rooftop,
      close,
      payments: {
        count: payments.length,
        netAmountCents: payments.reduce((sum, item) => sum + (item.kind === "REFUND" ? -item.amountCents : item.amountCents), 0),
        departmentCounts,
      },
      openExceptions: state.exceptions.filter((item) => item.rooftopId === rooftop.id && item.status === "OPEN"),
      settlement: state.payouts.find((item) => item.rooftopId === rooftop.id && item.payoutDate === state.metadata.businessDate) ?? null,
    };
  }

  private depositProjection(state: DemoState, payoutId: string): Record<string, unknown> {
    const payout = state.payouts.find((item) => item.id.toLocaleLowerCase() === payoutId.toLocaleLowerCase());
    if (!payout) this.notFound("PAYOUT_NOT_FOUND", "Payout", payoutId);
    return {
      payout,
      rooftop: state.rooftops.find((item) => item.id === payout.rooftopId),
      sourceRecords: state.payoutSourceRecords.filter((item) => item.payoutId === payout.id),
      adjustments: state.settlementAdjustments.filter((item) => item.payoutId === payout.id),
    };
  }

  private requireException(state: DemoState, exceptionId: string): DemoException {
    const exception = state.exceptions.find((item) => item.id.toLocaleLowerCase() === exceptionId.toLocaleLowerCase());
    if (!exception) this.notFound("EXCEPTION_NOT_FOUND", "Exception", exceptionId);
    return exception;
  }

  private resolveRooftopFilter(state: DemoState, location: string | undefined): string | null {
    if (!location) return null;
    return state.rooftops.find((item) => item.id === location || item.code.toLocaleLowerCase() === location.toLocaleLowerCase())?.id ?? "__not_found__";
  }

  private notFound(code: string, label: string, id: string): never {
    throw new DomainError(code, `${label} ${id} was not found in this workspace.`, 404, { id });
  }

  private async requireState(sessionId: string): Promise<DemoState> {
    this.assertSessionId(sessionId);
    const state = await this.repository.get(sessionId);
    if (!state) throw new SessionNotFoundError(sessionId);
    return DemoStateSchema.parse(state);
  }

  private assertSessionId(sessionId: string): void {
    if (!sessionId) {
      throw new DomainError(
        "DEMO_SESSION_REQUIRED",
        `Send the session identifier in the ${DEMO_SESSION_HEADER} header.`,
        400,
        { sessionHeader: DEMO_SESSION_HEADER },
      );
    }
    if (!z.string().uuid().safeParse(sessionId).success) {
      throw new DomainError(
        "INVALID_DEMO_SESSION",
        "The workspace session identifier is not valid.",
        400,
        { sessionHeader: DEMO_SESSION_HEADER },
      );
    }
  }

  private enforceCreationLimit(clientKey: string): void {
    this.enforceWindowLimit(
      this.creationWindows,
      clientKey,
      this.config.get<number>("DEMO_SESSION_CREATE_LIMIT", 12),
      this.config.get<number>("DEMO_SESSION_CREATE_WINDOW_SECONDS", 600),
      "SESSION_RATE_LIMITED",
      "Too many isolated workspaces were created from this client. Reuse the current workspace or try again shortly.",
    );
  }

  private enforceMutationLimit(sessionId: string): void {
    this.enforceWindowLimit(
      this.mutationWindows,
      sessionId,
      this.config.get<number>("DEMO_SESSION_MUTATION_LIMIT", 120),
      this.config.get<number>("DEMO_SESSION_MUTATION_WINDOW_SECONDS", 600),
      "DEMO_MUTATION_RATE_LIMITED",
      "This isolated workspace received too many commands. Wait briefly or reset it.",
    );
  }

  private enforceWindowLimit(
    windows: Map<string, number[]>,
    key: string,
    limit: number,
    windowSeconds: number,
    code: string,
    message: string,
  ): void {
    const now = Date.now();
    const cutoff = now - windowSeconds * 1_000;
    const active = windows.get(key)?.filter((timestamp) => timestamp > cutoff) ?? [];
    if (active.length >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((active[0]! + windowSeconds * 1_000 - now) / 1_000));
      throw new DomainError(code, message, 429, { retryAfterSeconds, limit, windowSeconds });
    }

    const maxTrackedKeys = this.config.get<number>("DEMO_RATE_LIMIT_TRACKED_KEYS", 4_096);
    if (!windows.has(key) && windows.size >= maxTrackedKeys) {
      const oldest = [...windows].sort((left, right) => (left[1].at(-1) ?? 0) - (right[1].at(-1) ?? 0))[0];
      if (oldest) windows.delete(oldest[0]);
    }
    active.push(now);
    windows.set(key, active);
    this.rateLimitOperations += 1;
    if (this.rateLimitOperations % 64 === 0) {
      for (const [candidateKey, timestamps] of windows) {
        const stillActive = timestamps.filter((timestamp) => timestamp > cutoff);
        if (stillActive.length === 0) windows.delete(candidateKey);
        else if (stillActive.length !== timestamps.length) windows.set(candidateKey, stillActive);
      }
    }
  }
}
