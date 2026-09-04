import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WorkspaceState } from '@postonce/contracts';
import { App } from './App';

const sessionId = '3dfcb7a4-1f63-42e7-8755-22ef762d7ae1';

function workspaceFixture(): WorkspaceState {
  const rooftops = [
    { id: 'roof_nlt', code: 'NLT', name: 'Northline Toyota', city: 'Calgary', timezone: 'America/Edmonton' as const },
    { id: 'roof_nlf', code: 'NLF', name: 'Northline Ford', city: 'Calgary', timezone: 'America/Edmonton' as const },
    { id: 'roof_nls', code: 'NLS', name: 'Northline Subaru', city: 'Calgary', timezone: 'America/Edmonton' as const },
  ];
  const payment = (id: string, rooftopId: string, amountCents: number) => ({
    id, rooftopId, businessDate: '2026-09-04', department: 'SERVICE' as const, provider: 'northstar' as const,
    externalEventId: `evt_${id}`, processorTransactionId: `txn_${id}`, customerLabel: 'Synthetic Customer', amountCents,
    currency: 'CAD' as const, kind: 'CAPTURE' as const, methodType: 'VISA' as const, cardLast4: '4242', terminalLabel: 'Terminal 01',
    paymentState: 'CAPTURED' as const, dmsState: rooftopId === 'roof_nlf' ? 'NEEDS_REVIEW' as const : 'VERIFIED' as const,
    settlementState: 'PAYOUT_PENDING' as const, sourceReference: null, linkedRecordId: null,
    receivedAt: '2026-09-04T22:37:00.000Z', matchedAt: null, postedAt: null, verifiedAt: null,
    postingOperationKey: null, inFridayClose: true,
  });
  const payments = [payment('PAY-1001', 'roof_nlt', 10000), payment('PAY-104', 'roof_nlf', 112500), payment('PAY-3001', 'roof_nls', 20000)];
  return {
    metadata: { title: 'PostOnce', organization: 'Northline Motor Group', disclaimer: 'Synthetic data.', businessDate: '2026-09-04', workspaceAsOf: '2026-09-04T22:55:00.000Z', timezone: 'America/Edmonton', currency: 'CAD', generatedAt: '2026-09-04T22:55:00.000Z' },
    user: { id: 'maya', name: 'Maya Chen', initials: 'MC', role: 'GROUP_CONTROLLER', roleLabel: 'Group Controller' },
    session: { id: sessionId, createdAt: '2026-09-04T22:55:00.000Z', resetAt: '2026-09-04T22:55:00.000Z', version: 0 },
    rooftops,
    dmsRecords: [], payments, allocations: [], refundLinks: [],
    exceptions: [1, 2, 3].map((index) => ({ id: `EX-10${index + 3}`, rooftopId: 'roof_nlf', department: 'SERVICE' as const, paymentId: 'PAY-104', type: 'AMBIGUOUS_MATCH' as const, severity: 'BLOCKING' as const, status: 'OPEN' as const, version: 1, title: 'Payment needs a record', summary: 'Controller decision required.', openedAt: '2026-09-04T22:37:00.000Z', candidates: [], suggestedCandidateId: null, suggestion: null, resolution: null })),
    inbox: [], outbox: [], integrationAttempts: [], auditEvents: [],
    operationalCloses: [
      { id: 'close_nlt', rooftopId: 'roof_nlt', businessDate: '2026-09-04', paymentCount: 1, verifiedPostingCount: 1, blockingExceptionCount: 0, settlementStatus: 'PAYOUT_PENDING', status: 'READY', version: 1, closedBy: null, closedAt: null, attestation: null },
      { id: 'close_nlf', rooftopId: 'roof_nlf', businessDate: '2026-09-04', paymentCount: 3, verifiedPostingCount: 0, blockingExceptionCount: 3, settlementStatus: 'PAYOUT_PENDING', status: 'BLOCKED', version: 1, closedBy: null, closedAt: null, attestation: null },
      { id: 'close_nls', rooftopId: 'roof_nls', businessDate: '2026-09-04', paymentCount: 1, verifiedPostingCount: 1, blockingExceptionCount: 0, settlementStatus: 'PAYOUT_PENDING', status: 'READY', version: 1, closedBy: null, closedAt: null, attestation: null },
    ],
    payouts: rooftops.map((item) => ({ id: `payout_${item.code}`, rooftopId: item.id, payoutDate: '2026-09-04', externalPayoutId: null, currency: 'CAD' as const, capturedCents: null, refundCents: null, feeCents: null, originalExpectedCents: null, adjustedExpectedCents: null, observedBankCents: null, varianceCents: null, status: 'PAYOUT_PENDING' as const, sourceRecordIds: [], reconciledBy: null, reconciledAt: null, version: 1 })),
    payoutSourceRecords: [], settlementAdjustments: [],
    integrations: [], commandReceipts: [],
    invariants: { processorDeliveriesReceived: 0, uniqueProcessorEventsApplied: 0, duplicateDeliveriesIgnored: 0, dmsAttempts: 0, dmsMutations: 0, lostResponses: 0, retriesResolvedByLookup: 0, acceptedDecisions: 0, rejectedVersionConflicts: 0, outboxCreated: 0, outboxDelivered: 0 },
  };
}

describe('PostOnce product experience', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('makes the product workspace the primary entry', async () => {
    const state = workspaceFixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessionId, sessionHeader: 'X-Demo-Session', state }), { status: 201 })));
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Friday Close' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Every payment posts once/i })).toBeNull();
  });

  it('routes retired public paths into the product workspace', async () => {
    const state = workspaceFixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessionId, sessionHeader: 'X-Demo-Session', state }), { status: 201 })));
    render(<MemoryRouter initialEntries={['/case-study']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Friday Close' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Every payment posts once/i })).toBeNull();
  });

  it('boots an isolated workspace and renders operational close apart from settlement', async () => {
    const state = workspaceFixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessionId, sessionHeader: 'X-Demo-Session', state }), { status: 201 })));
    render(<MemoryRouter initialEntries={['/app/close']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Friday Close' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Northline Ford' })).toBeTruthy();
    const blockedEndpoint = screen.getByRole('link', { name: '3 blockers' });
    expect(blockedEndpoint.getAttribute('href')).toBe('/app/exceptions?location=NLF&status=OPEN&sort=newest');
    expect(screen.getByText('3 items')).toBeTruthy();
    expect(screen.getAllByText('Payout pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Independent').length).toBe(4);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search workspace' }));
  });

  it('keeps financial actions unavailable when the workspace service is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    render(<MemoryRouter initialEntries={['/app/close']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Workspace unavailable' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry workspace' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close location' })).toBeNull();
  });

  it('fails closed instead of leaving stale financial actions enabled after service loss', async () => {
    const state = workspaceFixture();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessionId, sessionHeader: 'X-Demo-Session', state }), { status: 201 }))
      .mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/app/close']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Friday Close' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset workspace' }));

    expect(await screen.findByRole('heading', { name: 'Workspace unavailable' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close location' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry workspace' })).toBeTruthy();
  });
});
