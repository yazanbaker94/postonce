import { makeSeedState, runLocalAction } from './demoData';
import type { ActionKey, ApiErrorShape, DemoState } from './types';

const SESSION_KEY = 'postonce.demo.session';
const LOCAL_STATE_KEY = 'postonce.demo.local-state.v3';

export class DemoApiError extends Error {
  constructor(
    message: string,
    public readonly code = 'REQUEST_FAILED',
    public readonly correlationId?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'DemoApiError';
  }
}

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DemoApiError('The service returned an unreadable response.', 'INVALID_RESPONSE', undefined, response.status);
  }
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;

const getStateFromPayload = (payload: unknown): DemoState | undefined => {
  const record = asRecord(payload);
  if (!record) return undefined;
  if (asRecord(record.state)) return record.state as unknown as DemoState;
  if (asRecord(record.session) && Array.isArray(record.payments)) return record as unknown as DemoState;
  return undefined;
};

const throwForResponse = (response: Response, payload: unknown): never => {
  const api = payload as Partial<ApiErrorShape>;
  throw new DemoApiError(
    api.error?.message ?? `Request failed with HTTP ${response.status}.`,
    api.error?.code ?? 'REQUEST_FAILED',
    api.error?.correlationId,
    response.status,
  );
};

export function getStoredSessionId(): string | null {
  return window.localStorage.getItem(SESSION_KEY);
}

export async function createSession(): Promise<DemoState> {
  const response = await fetch('/api/demo/sessions', { method: 'POST', headers: { Accept: 'application/json' } });
  const payload = await readJson(response);
  if (!response.ok) throwForResponse(response, payload);
  const record = asRecord(payload);
  const state = getStateFromPayload(payload);
  const sessionId = String(record?.sessionId ?? state?.session?.id ?? response.headers.get('x-demo-session') ?? '');
  if (!state || !sessionId) throw new DemoApiError('The service did not return a demo session.', 'INVALID_RESPONSE');
  window.localStorage.setItem(SESSION_KEY, sessionId);
  return state;
}

export async function getState(sessionId: string): Promise<DemoState> {
  const response = await fetch('/api/demo/state', {
    headers: { Accept: 'application/json', 'X-Demo-Session': sessionId },
  });
  const payload = await readJson(response);
  if (!response.ok) throwForResponse(response, payload);
  const state = getStateFromPayload(payload);
  if (!state) throw new DemoApiError('The service returned an incomplete demo state.', 'INVALID_RESPONSE');
  return state;
}

export async function performAction(sessionId: string, action: ActionKey): Promise<DemoState> {
  const response = await fetch(`/api/demo/actions/${action}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Demo-Session': sessionId },
    body: '{}',
  });
  const payload = await readJson(response);
  if (!response.ok) throwForResponse(response, payload);
  const state = getStateFromPayload(payload);
  if (state) return state;
  return getState(sessionId);
}

export async function resetSession(sessionId: string): Promise<DemoState> {
  const response = await fetch('/api/demo/reset', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Demo-Session': sessionId },
    body: '{}',
  });
  const payload = await readJson(response);
  if (!response.ok) throwForResponse(response, payload);
  const state = getStateFromPayload(payload);
  if (state) {
    window.localStorage.setItem(SESSION_KEY, state.session.id);
    return state;
  }
  return getState(sessionId);
}

export function createLocalPreview(): DemoState {
  const saved = window.localStorage.getItem(LOCAL_STATE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as DemoState;
    } catch {
      window.localStorage.removeItem(LOCAL_STATE_KEY);
    }
  }
  const state = runLocalAction(makeSeedState(), 'run-all');
  saveLocalPreview(state);
  return state;
}

export function actOnLocalPreview(state: DemoState, action: ActionKey): DemoState {
  const next = runLocalAction(state, action);
  saveLocalPreview(next);
  return next;
}

export function resetLocalPreview(): DemoState {
  const state = makeSeedState();
  saveLocalPreview(state);
  return state;
}

function saveLocalPreview(state: DemoState): void {
  window.localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
}
