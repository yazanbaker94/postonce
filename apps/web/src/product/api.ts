import type {
  CloseLocationRequest,
  MutationResponse,
  ResolveExceptionRequest,
  SessionResponse,
  SettlementAdjustmentRequest,
  WorkspaceState,
} from '@postonce/contracts';

const SESSION_KEY = 'postonce.workspace.session.v1';

export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    public readonly code = 'REQUEST_FAILED',
    public readonly status?: number,
    public readonly details: Record<string, unknown> = {},
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'WorkspaceApiError';
  }
}

type ErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    correlationId?: string;
  };
};

const mutationKeys = new Map<string, string>();

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WorkspaceApiError('PostOnce returned an unreadable response.', 'INVALID_RESPONSE', response.status);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
    });
  } catch {
    throw new WorkspaceApiError('PostOnce cannot reach the workspace service.', 'SERVICE_UNAVAILABLE');
  }
  const payload = await parseJson(response);
  if (!response.ok) {
    const error = (payload as ErrorEnvelope).error;
    throw new WorkspaceApiError(
      error?.message ?? `Request failed with HTTP ${response.status}.`,
      error?.code ?? 'REQUEST_FAILED',
      response.status,
      error?.details ?? {},
      error?.correlationId,
    );
  }
  return payload as T;
}

function headers(sessionId: string): HeadersInit {
  return { 'X-Demo-Session': sessionId };
}

function idempotencyKey(scope: string): string {
  const existing = mutationKeys.get(scope);
  if (existing) return existing;
  const key = `workspace-${scope}-${crypto.randomUUID()}`;
  mutationKeys.set(scope, key);
  return key;
}

export function storedSessionId(): string | null {
  return window.localStorage.getItem(SESSION_KEY);
}

export async function bootstrapWorkspace(): Promise<WorkspaceState> {
  const existing = storedSessionId();
  if (existing) {
    try {
      return await loadWorkspace(existing);
    } catch (error) {
      if (!(error instanceof WorkspaceApiError) || !['DEMO_SESSION_NOT_FOUND', 'INVALID_DEMO_SESSION'].includes(error.code)) throw error;
      window.localStorage.removeItem(SESSION_KEY);
    }
  }
  const created = await request<SessionResponse>('/api/demo/sessions', { method: 'POST' });
  window.localStorage.setItem(SESSION_KEY, created.sessionId);
  return created.state;
}

export async function loadWorkspace(sessionId: string): Promise<WorkspaceState> {
  return request<WorkspaceState>('/api/workspace', { headers: headers(sessionId) });
}

export async function resetWorkspace(sessionId: string): Promise<WorkspaceState> {
  const response = await request<SessionResponse>('/api/demo/reset', {
    method: 'POST',
    headers: { ...headers(sessionId), 'Content-Type': 'application/json' },
    body: '{}',
  });
  mutationKeys.clear();
  window.localStorage.setItem(SESSION_KEY, response.sessionId);
  return response.state;
}

export async function resolveException(
  sessionId: string,
  exceptionId: string,
  expectedVersion: number,
  targetId: string,
): Promise<MutationResponse> {
  const scope = `resolve-${exceptionId}-${expectedVersion}-${targetId}`;
  const body: ResolveExceptionRequest = { expectedVersion, targetId, idempotencyKey: idempotencyKey(scope) };
  const response = await request<MutationResponse>(`/api/exceptions/${encodeURIComponent(exceptionId)}/resolve`, {
    method: 'POST',
    headers: { ...headers(sessionId), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  mutationKeys.delete(scope);
  return response;
}

export async function closeLocation(
  sessionId: string,
  rooftopId: string,
  expectedVersion: number,
): Promise<MutationResponse> {
  const scope = `close-${rooftopId}-${expectedVersion}`;
  const body: CloseLocationRequest = { expectedVersion, idempotencyKey: idempotencyKey(scope) };
  const response = await request<MutationResponse>(`/api/close/${encodeURIComponent(rooftopId)}/close`, {
    method: 'POST',
    headers: { ...headers(sessionId), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  mutationKeys.delete(scope);
  return response;
}

export async function recordAdjustment(
  sessionId: string,
  payoutId: string,
  expectedVersion: number,
  evidenceRecordId: string,
  note?: string,
): Promise<MutationResponse> {
  const scope = `adjust-${payoutId}-${expectedVersion}-${evidenceRecordId}`;
  const body: SettlementAdjustmentRequest = {
    expectedVersion,
    idempotencyKey: idempotencyKey(scope),
    amountCents: -2500,
    code: 'NETWORK_ASSESSMENT',
    evidenceRecordId,
    ...(note ? { note } : {}),
  };
  const response = await request<MutationResponse>(`/api/deposits/${encodeURIComponent(payoutId)}/adjustments`, {
    method: 'POST',
    headers: { ...headers(sessionId), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  mutationKeys.delete(scope);
  return response;
}

export async function searchWorkspace(sessionId: string, query: string): Promise<{
  groups: Array<{ key: string; label: string; items: Array<{ id: string; label: string; meta: string; href: string }> }>;
  total: number;
}> {
  return request(`/api/search?q=${encodeURIComponent(query)}`, { headers: headers(sessionId) });
}
