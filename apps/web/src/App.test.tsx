import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { makeSeedState, runLocalAction } from './demoData';

describe('PostOnce reviewer experience', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('states the product thesis and opens the guided close', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Every payment posts once/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Watch the close prove itself/i })).toBeTruthy();
    expect(screen.getAllByText(/independent engineering case study/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Run the close/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Explore the control room/i }).some((link) => link.getAttribute('href') === '/demo')).toBe(true);
    expect(container.querySelector('img[src*="control-room-dashboard"]')).toBeNull();
    expect(container.textContent).not.toMatch(/1,246|98\.72%|99\.9%/);
  });

  it('creates an isolated API session and advances one deterministic chapter', async () => {
    const user = userEvent.setup();
    let state = makeSeedState('3dfcb7a4-1f63-42e7-8755-22ef762d7ae1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/demo/sessions')) return new Response(JSON.stringify({ sessionId: state.session.id, sessionHeader: 'X-Demo-Session', state }), { status: 201 });
      if (url.endsWith('/api/demo/actions/process-routine')) {
        state = runLocalAction(state, 'process-routine');
        return new Response(JSON.stringify({ action: 'process-routine', replayed: false, chapter: 1, result: {}, state }), { status: 200 });
      }
      return new Response(JSON.stringify(state), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter initialEntries={['/demo']}><App /></MemoryRouter>);
    const button = await screen.findByRole('button', { name: /Process routine payments/i });
    expect(screen.getByText('LIVE API')).toBeTruthy();
    await user.click(button);
    await waitFor(() => expect(screen.getByRole('heading', { name: /Nine captures match/i })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/demo/actions/process-routine', expect.objectContaining({ method: 'POST' }));
  });

  it('labels an API outage as a read-only preview and disables mutations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    render(<MemoryRouter initialEntries={['/demo']}><App /></MemoryRouter>);
    expect(await screen.findByText('Read-only local preview')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry live service/i })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Reset isolated session/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
