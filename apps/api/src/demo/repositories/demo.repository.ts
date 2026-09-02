import type { DemoState } from "@postonce/contracts";

export const DEMO_REPOSITORY = Symbol("DEMO_REPOSITORY");

export type MutationResult<T> = {
  value: T;
  changed: boolean;
};

export type SessionMutation<T> = (state: DemoState) => Promise<MutationResult<T>> | MutationResult<T>;

export type PersistenceHealth = {
  ok: boolean;
  mode: "memory" | "postgres";
  latencyMs: number;
  detail: string;
};

export interface DemoRepository {
  readonly mode: "memory" | "postgres";
  create(state: DemoState): Promise<void>;
  replace(state: DemoState): Promise<void>;
  get(sessionId: string): Promise<DemoState | null>;
  mutate<T>(sessionId: string, mutation: SessionMutation<T>): Promise<T | null>;
  health(): Promise<PersistenceHealth>;
  close(): Promise<void>;
}
