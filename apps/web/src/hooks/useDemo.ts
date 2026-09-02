import { useCallback, useEffect, useRef, useState } from 'react';
import {
  actOnLocalPreview,
  createLocalPreview,
  createSession,
  DemoApiError,
  getState,
  getStoredSessionId,
  performAction,
  resetLocalPreview,
  resetSession,
} from '../api';
import type { ActionKey, ConnectionMode, DemoState } from '../types';

export interface DemoController {
  state: DemoState | null;
  mode: ConnectionMode;
  loading: boolean;
  pendingAction: ActionKey | 'reset' | null;
  error: DemoApiError | null;
  run: (action: ActionKey) => Promise<void>;
  reset: () => Promise<void>;
  retryApi: () => Promise<void>;
}

export function useDemo(): DemoController {
  const [state, setState] = useState<DemoState | null>(null);
  const [mode, setMode] = useState<ConnectionMode>('api');
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<ActionKey | 'reset' | null>(null);
  const [error, setError] = useState<DemoApiError | null>(null);
  const started = useRef(false);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stored = getStoredSessionId();
      let next: DemoState;
      try {
        next = stored ? await getState(stored) : await createSession();
      } catch (initialError) {
        if (stored && initialError instanceof DemoApiError && initialError.status === 404) next = await createSession();
        else throw initialError;
      }
      setState(next);
      setMode('api');
    } catch (cause) {
      const apiError = cause instanceof DemoApiError ? cause : new DemoApiError('Live service is temporarily unavailable.');
      setState(createLocalPreview());
      setMode('local');
      setError(apiError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void connect();
  }, [connect]);

  const run = useCallback(async (action: ActionKey) => {
    if (!state || pendingAction) return;
    setPendingAction(action);
    setError(null);
    try {
      if (mode === 'local') setState(actOnLocalPreview(state, action));
      else setState(await performAction(state.session.id, action));
    } catch (cause) {
      setError(cause instanceof DemoApiError ? cause : new DemoApiError('The action could not be completed.'));
    } finally {
      setPendingAction(null);
    }
  }, [mode, pendingAction, state]);

  const reset = useCallback(async () => {
    if (!state || pendingAction) return;
    setPendingAction('reset');
    setError(null);
    try {
      setState(mode === 'local' ? resetLocalPreview() : await resetSession(state.session.id));
    } catch (cause) {
      setError(cause instanceof DemoApiError ? cause : new DemoApiError('The session could not be reset.'));
    } finally {
      setPendingAction(null);
    }
  }, [mode, pendingAction, state]);

  return { state, mode, loading, pendingAction, error, run, reset, retryApi: connect };
}
