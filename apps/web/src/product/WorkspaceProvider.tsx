import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { WorkspaceState } from '@postonce/contracts';
import {
  WorkspaceApiError,
  bootstrapWorkspace,
  closeLocation as closeLocationRequest,
  loadWorkspace,
  recordAdjustment as recordAdjustmentRequest,
  resetWorkspace,
  resolveException as resolveExceptionRequest,
  storedSessionId,
} from './api';

type WorkspaceContextValue = {
  state: WorkspaceState | null;
  status: 'loading' | 'ready' | 'unavailable';
  error: WorkspaceApiError | null;
  actionError: WorkspaceApiError | null;
  pendingLabel: string | null;
  reload: () => Promise<void>;
  reset: () => Promise<void>;
  clearActionError: () => void;
  resolveException: (exceptionId: string, version: number, targetId: string) => Promise<boolean>;
  closeLocation: (rooftopId: string, version: number) => Promise<boolean>;
  recordAdjustment: (payoutId: string, version: number, evidenceRecordId: string, note?: string) => Promise<boolean>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
let bootstrapInFlight: Promise<WorkspaceState> | null = null;

function asApiError(error: unknown): WorkspaceApiError {
  if (error instanceof WorkspaceApiError) return error;
  return new WorkspaceApiError(error instanceof Error ? error.message : 'An unexpected workspace error occurred.');
}

function isMissingSession(error: WorkspaceApiError): boolean {
  return ['DEMO_SESSION_NOT_FOUND', 'INVALID_DEMO_SESSION'].includes(error.code);
}

function isServiceUnavailable(error: WorkspaceApiError): boolean {
  return ['SERVICE_UNAVAILABLE', 'INVALID_RESPONSE'].includes(error.code) || (error.status !== undefined && error.status >= 500);
}

const refreshedWorkspaceError = () => new WorkspaceApiError(
  'The prior workspace expired, so PostOnce opened a fresh synthetic workspace. The attempted action was not applied.',
  'WORKSPACE_REFRESHED',
);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [status, setStatus] = useState<WorkspaceContextValue['status']>('loading');
  const [error, setError] = useState<WorkspaceApiError | null>(null);
  const [actionError, setActionError] = useState<WorkspaceApiError | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const boot = useCallback(async () => {
    setState(null);
    setStatus('loading');
    setError(null);
    setActionError(null);
    bootstrapInFlight ??= bootstrapWorkspace().finally(() => { bootstrapInFlight = null; });
    try {
      const workspace = await bootstrapInFlight;
      setState(workspace);
      setStatus('ready');
    } catch (cause) {
      setState(null);
      setError(asApiError(cause));
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => { void boot(); }, [boot]);

  const reload = useCallback(async () => {
    const sessionId = state?.session.id ?? storedSessionId();
    if (!sessionId) return boot();
    setState(null);
    setStatus('loading');
    setError(null);
    try {
      setState(await loadWorkspace(sessionId));
      setStatus('ready');
    } catch (cause) {
      const apiError = asApiError(cause);
      if (isMissingSession(apiError)) return boot();
      setState(null);
      setError(apiError);
      setStatus('unavailable');
    }
  }, [boot, state?.session.id]);

  const reset = useCallback(async () => {
    const sessionId = state?.session.id ?? storedSessionId();
    if (!sessionId) return boot();
    setPendingLabel('Resetting workspace…');
    setActionError(null);
    try {
      setState(await resetWorkspace(sessionId));
      setStatus('ready');
    } catch (cause) {
      const apiError = asApiError(cause);
      if (isMissingSession(apiError)) {
        await boot();
      } else if (isServiceUnavailable(apiError)) {
        setState(null);
        setError(apiError);
        setStatus('unavailable');
      } else {
        setActionError(apiError);
      }
    } finally {
      setPendingLabel(null);
    }
  }, [boot, state?.session.id]);

  const runMutation = useCallback(async (
    label: string,
    mutation: (sessionId: string) => Promise<{ state: WorkspaceState }>,
  ): Promise<boolean> => {
    const sessionId = state?.session.id;
    if (!sessionId || pendingLabel || status !== 'ready') return false;
    setPendingLabel(label);
    setActionError(null);
    try {
      const response = await mutation(sessionId);
      setState(response.state);
      setStatus('ready');
      return true;
    } catch (cause) {
      const apiError = asApiError(cause);
      if (apiError.code === 'VERSION_CONFLICT') {
        try {
          setState(await loadWorkspace(sessionId));
          setStatus('ready');
          setActionError(apiError);
        } catch (reloadCause) {
          const reloadError = asApiError(reloadCause);
          if (isMissingSession(reloadError)) {
            await boot();
            setActionError(refreshedWorkspaceError());
          } else {
            setState(null);
            setError(reloadError);
            setStatus('unavailable');
          }
        }
      } else if (isMissingSession(apiError)) {
        await boot();
        setActionError(refreshedWorkspaceError());
      } else if (isServiceUnavailable(apiError)) {
        setState(null);
        setError(apiError);
        setStatus('unavailable');
      } else {
        setActionError(apiError);
      }
      return false;
    } finally {
      setPendingLabel(null);
    }
  }, [boot, pendingLabel, state?.session.id, status]);

  const resolveException = useCallback((exceptionId: string, version: number, targetId: string) =>
    runMutation('Posting to dealership system…', (sessionId) => resolveExceptionRequest(sessionId, exceptionId, version, targetId)),
  [runMutation]);

  const closeLocation = useCallback((rooftopId: string, version: number) =>
    runMutation('Sealing close attestation…', (sessionId) => closeLocationRequest(sessionId, rooftopId, version)),
  [runMutation]);

  const recordAdjustment = useCallback((payoutId: string, version: number, evidenceRecordId: string, note?: string) =>
    runMutation('Recording settlement adjustment…', (sessionId) => recordAdjustmentRequest(sessionId, payoutId, version, evidenceRecordId, note)),
  [runMutation]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    state,
    status,
    error,
    actionError,
    pendingLabel,
    reload,
    reset,
    clearActionError: () => setActionError(null),
    resolveException,
    closeLocation,
    recordAdjustment,
  }), [state, status, error, actionError, pendingLabel, reload, reset, resolveException, closeLocation, recordAdjustment]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used within WorkspaceProvider.');
  return value;
}
