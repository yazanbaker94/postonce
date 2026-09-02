import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DEMO_SESSION_HEADER,
  DemoStateSchema,
  type ActionRequest,
  type ActionResponse,
  type DemoAction,
  type DemoState,
  type SessionResponse,
} from "@postonce/contracts";
import { z } from "zod";
import { DomainError, SessionNotFoundError } from "../common/domain-error.js";
import { DemoEngine } from "./domain/demo.engine.js";
import { createSeedState } from "./domain/seed.js";
import { DEMO_REPOSITORY, type DemoRepository } from "./repositories/demo.repository.js";

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
    await this.repository.replace(DemoStateSchema.parse(state));
    return { sessionId, sessionHeader: DEMO_SESSION_HEADER, state };
  }

  async state(sessionId: string): Promise<DemoState> {
    return this.requireState(sessionId);
  }

  async execute(sessionId: string, action: DemoAction, request: ActionRequest): Promise<ActionResponse> {
    this.assertSessionId(sessionId);
    this.enforceMutationLimit(sessionId);
    const outcome = await this.repository.mutate(sessionId, (state) => {
      const result = this.engine.execute(state, action, request);
      DemoStateSchema.parse(state);
      return { value: result, changed: result.changed };
    });
    if (!outcome) throw new SessionNotFoundError(sessionId);
    const state = await this.requireState(sessionId);
    return {
      action,
      replayed: outcome.replayed,
      chapter: outcome.chapter,
      result: outcome.result,
      state,
    };
  }

  async overview(sessionId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    return {
      session: state.session,
      currentChapter: state.currentChapter,
      close: state.close,
      totals: state.totals,
      chapters: state.chapters,
      counts: {
        rooftops: state.rooftops.length,
        paymentEvents: state.payments.length,
        allocations: state.allocations.length,
        openExceptions: state.exceptions.filter((item) => item.status === "OPEN").length,
        pendingOutbox: state.outbox.filter((item) => item.status === "PENDING").length,
      },
      invariants: state.invariants,
    };
  }

  async architectureEvidence(sessionId: string): Promise<Record<string, unknown>> {
    const state = await this.requireState(sessionId);
    return {
      disclaimer: state.metadata.disclaimer,
      topology: [
        { boundary: "Northstar Processor", direction: "inbound", guard: "durable inbox + unique provider event" },
        { boundary: "PostOnce ledger", direction: "internal", guard: "integer cents + immutable allocations + optimistic version" },
        { boundary: "LegacyDMS", direction: "outbound", guard: "transactional outbox + stable destination key" },
        { boundary: "Prairie Bank", direction: "inbound", guard: "gross - fees - refunds = deposit" },
      ],
      deliverySemantics: "At-least-once transport; idempotent domain mutation. Exactly-once network delivery is not claimed.",
      persistence: {
        mode: this.repository.mode,
        readModel: "Session JSON snapshot for one-request reviewer rendering",
        sourceOfEvidence: "Relational invoices, payments, allocations, inbox, outbox, exceptions, attempts, audit, and settlement rows",
      },
      invariants: state.invariants,
      checks: state.evidence.checks,
      benchmark: state.evidence.benchmark,
      race: state.evidence.race,
    };
  }

  async list<K extends "payments" | "invoices" | "exceptions" | "integrationAttempts" | "auditEvents">(
    sessionId: string,
    key: K,
  ): Promise<DemoState[K]> {
    const state = await this.requireState(sessionId);
    return state[key];
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
        "The demo session identifier is not valid.",
        400,
        { sessionHeader: DEMO_SESSION_HEADER },
      );
    }
  }

  private enforceCreationLimit(clientKey: string): void {
    const windowSeconds = this.config.get<number>("DEMO_SESSION_CREATE_WINDOW_SECONDS", 600);
    const limit = this.config.get<number>("DEMO_SESSION_CREATE_LIMIT", 12);
    this.enforceWindowLimit(
      this.creationWindows,
      clientKey,
      limit,
      windowSeconds,
      "SESSION_RATE_LIMITED",
      "Too many isolated demo sessions were created from this client. Reuse the current run or try again shortly.",
    );
  }

  private enforceMutationLimit(sessionId: string): void {
    this.enforceWindowLimit(
      this.mutationWindows,
      sessionId,
      this.config.get<number>("DEMO_SESSION_MUTATION_LIMIT", 120),
      this.config.get<number>("DEMO_SESSION_MUTATION_WINDOW_SECONDS", 600),
      "DEMO_MUTATION_RATE_LIMITED",
      "This isolated demo run received too many commands. Wait briefly or start a fresh run.",
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
      let oldestKey: string | undefined;
      let oldestTimestamp = Number.POSITIVE_INFINITY;
      for (const [candidateKey, timestamps] of windows) {
        const lastSeen = timestamps.at(-1) ?? 0;
        if (lastSeen < oldestTimestamp) {
          oldestTimestamp = lastSeen;
          oldestKey = candidateKey;
        }
      }
      if (oldestKey) windows.delete(oldestKey);
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
