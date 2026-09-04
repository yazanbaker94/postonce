import type { DemoState } from "@postonce/contracts";
import type { DemoRepository, MutationResult, PersistenceHealth, SessionMutation } from "./demo.repository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryDemoRepository implements DemoRepository {
  readonly mode = "memory" as const;
  private readonly sessions = new Map<string, DemoState>();
  private readonly locks = new Map<string, Promise<void>>();

  public constructor(
    private readonly maxActiveSessions = 500,
    private readonly sessionTtlMinutes = 240,
  ) {}

  async create(state: DemoState): Promise<void> {
    this.pruneExpiredAndBounded();
    if (this.sessions.has(state.session.id)) {
      throw new Error(`Session ${state.session.id} already exists`);
    }
    this.sessions.set(state.session.id, clone(state));
  }

  async replace(state: DemoState): Promise<void> {
    await this.exclusive(state.session.id, async () => {
      this.sessions.set(state.session.id, clone(state));
    });
  }

  async get(sessionId: string): Promise<DemoState | null> {
    const state = this.sessions.get(sessionId);
    if (state && this.isExpired(state)) {
      this.sessions.delete(sessionId);
      return null;
    }
    return state ? clone(state) : null;
  }

  async mutate<T>(sessionId: string, mutation: SessionMutation<T>): Promise<T | null> {
    return this.exclusive(sessionId, async () => {
      const current = this.sessions.get(sessionId);
      if (!current) return null;
      if (this.isExpired(current)) {
        this.sessions.delete(sessionId);
        return null;
      }

      const candidate = clone(current);
      const result: MutationResult<T> = await mutation(candidate);
      if (result.changed) {
        candidate.session.version += 1;
        candidate.metadata.generatedAt = new Date().toISOString();
        this.sessions.set(sessionId, clone(candidate));
      }
      return result.value;
    });
  }

  async health(): Promise<PersistenceHealth> {
    const started = performance.now();
    const count = this.sessions.size;
    return {
      ok: true,
      mode: this.mode,
      latencyMs: Number((performance.now() - started).toFixed(2)),
      detail: `${count} isolated demo session${count === 1 ? "" : "s"} in local memory`,
    };
  }

  async close(): Promise<void> {
    // Nothing to release. Kept for parity with the PostgreSQL adapter.
  }

  private async exclusive<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    this.locks.set(sessionId, queued);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(sessionId) === queued) {
        this.locks.delete(sessionId);
      }
    }
  }

  private pruneExpiredAndBounded(): void {
    for (const [sessionId, state] of this.sessions) {
      if (this.isExpired(state)) this.sessions.delete(sessionId);
    }
    if (this.sessions.size < this.maxActiveSessions) return;
    const oldest = [...this.sessions.entries()]
      .sort((left, right) => new Date(left[1].metadata.generatedAt).getTime() - new Date(right[1].metadata.generatedAt).getTime());
    const toRemove = this.sessions.size - this.maxActiveSessions + 1;
    for (const [sessionId] of oldest.slice(0, toRemove)) this.sessions.delete(sessionId);
  }

  private isExpired(state: DemoState): boolean {
    const lastTouched = new Date(state.metadata.generatedAt).getTime();
    return !Number.isFinite(lastTouched) || lastTouched < Date.now() - this.sessionTtlMinutes * 60_000;
  }
}
