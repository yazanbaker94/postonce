import type { ActionKey, AuditEvent, ChapterDefinition, DemoState, IntegrationAttempt } from './types';

const fixtureNow = '2026-08-31T22:55:02.000Z';
const stamp = (offset: number) => new Date(new Date(fixtureNow).getTime() + offset * 1_000).toISOString();
const sessionPrefix = (state: DemoState) => state.session.id.slice(0, 8);

export const chapters: ChapterDefinition[] = [
  { id: '00', index: 0, eyebrow: '4:55 PM / MONTH END', title: 'Can Northline close the day?', shortTitle: 'Start of close', body: 'Twelve processor events arrived across two rooftops. Most should disappear into automation; only uncertainty should reach Maya.', action: 'process-routine', actionLabel: 'Process routine payments', proof: 'A clean start with integer-cents totals and an isolated traceable session.' },
  { id: '01', index: 1, eyebrow: 'DETERMINISTIC MATCHING', title: 'Nine captures match without human review.', shortTitle: 'Routine automation', body: 'Eight post immediately. One waits safely at the DMS boundary, and a refund is recorded without manual work.', action: 'deliver-duplicate', actionLabel: 'Deliver duplicate webhook', proof: 'Immutable allocations plus a transactional outbox—no half-finished posting state.' },
  { id: '02', index: 2, eyebrow: 'AT-LEAST-ONCE DELIVERY', title: 'The webhook arrives twice. Money moves once.', shortTitle: 'Duplicate event', body: 'Northstar retries the same event. The delivery is recorded, but a provider/event constraint prevents a second financial mutation.', action: 'simulate-lost-response', actionLabel: 'Simulate lost DMS response', proof: 'Two deliveries are observable. Only one mutation exists.' },
  { id: '03', index: 3, eyebrow: 'COMMIT SUCCEEDED / RESPONSE LOST', title: 'The destination saved it. We never heard back.', shortTitle: 'Lost response', body: 'LegacyDMS commits posting OP-7Q3K, then the response disappears. Retry uses the original destination key and retrieves that same result.', action: 'open-ambiguous-exception', actionLabel: 'Inspect unmatched payment', proof: 'One DMS posting, two logical attempts, zero guessing.' },
  { id: '04', index: 4, eyebrow: 'AMBIGUITY IS A PRODUCT STATE', title: 'Two plausible invoices. PostOnce refuses to guess.', shortTitle: 'Ambiguous allocation', body: 'The reference is absent and two repair orders carry the same masked customer and value. Evidence goes to a controller; AI remains advisory.', action: 'simulate-resolution-race', actionLabel: 'Run deterministic race case', proof: 'Uncertainty is visible, owned, and blocked from mutating the ledger.' },
  { id: '05', index: 5, eyebrow: 'DETERMINISTIC FAILURE INJECTION', title: 'One decision wins. The stale version is rejected.', shortTitle: 'Concurrent decision', body: 'The guided action injects a repeatable winner and stale writer through the same version guard exercised by real concurrent HTTP/PostgreSQL tests: Maya receives 200; Jon receives 409 and the winning decision.', action: 'reconcile-settlement', actionLabel: 'Reconcile and close', proof: 'One accepted allocation, a preserved conflict, and no last-write-wins corruption.' },
  { id: '06', index: 6, eyebrow: 'PROVABLE CLOSE', title: 'Gross minus fees and refunds equals the deposit.', shortTitle: 'Settlement close', body: 'The processor settlement, ledger, and Prairie Bank deposit agree. Every blocking exception is resolved, so Northline is ready to close.', proof: 'A balanced equation backed by a complete correlation trail.' },
];

type InvoiceFixture = Pick<DemoState['invoices'][number], 'id' | 'rooftopId' | 'repairOrderNumber' | 'customerLabel' | 'amountCents'> & { openedAtOffset: number };
type PaymentFixture = Pick<DemoState['payments'][number], 'id' | 'rooftopId' | 'externalEventId' | 'customerLabel' | 'amountCents' | 'reference' | 'kind'>;

const invoiceFixtures: InvoiceFixture[] = [
  { id: 'inv_8001', rooftopId: 'roof_central', repairOrderNumber: 'RO-8001', customerLabel: 'Customer •4821', amountCents: 45900, openedAtOffset: -4100 },
  { id: 'inv_8002', rooftopId: 'roof_north', repairOrderNumber: 'RO-8002', customerLabel: 'Customer •1974', amountCents: 73250, openedAtOffset: -3900 },
  { id: 'inv_8003', rooftopId: 'roof_central', repairOrderNumber: 'RO-8003', customerLabel: 'Customer •7310', amountCents: 12800, openedAtOffset: -3600 },
  { id: 'inv_8004', rooftopId: 'roof_central', repairOrderNumber: 'RO-8004', customerLabel: 'Customer •2208', amountCents: 109900, openedAtOffset: -3300 },
  { id: 'inv_8005', rooftopId: 'roof_north', repairOrderNumber: 'RO-8005', customerLabel: 'Customer •5630', amountCents: 68400, openedAtOffset: -3000 },
  { id: 'inv_8006', rooftopId: 'roof_central', repairOrderNumber: 'RO-8006', customerLabel: 'Customer •1142', amountCents: 52300, openedAtOffset: -2700 },
  { id: 'inv_8007', rooftopId: 'roof_north', repairOrderNumber: 'RO-8007', customerLabel: 'Customer •9091', amountCents: 31500, openedAtOffset: -2400 },
  { id: 'inv_8008', rooftopId: 'roof_central', repairOrderNumber: 'RO-8008', customerLabel: 'Customer •6620', amountCents: 46800, openedAtOffset: -2100 },
  { id: 'inv_8031', rooftopId: 'roof_central', repairOrderNumber: 'RO-8031', customerLabel: 'Customer •5004', amountCents: 49500, openedAtOffset: -1800 },
  { id: 'inv_8037', rooftopId: 'roof_central', repairOrderNumber: 'RO-8037', customerLabel: 'Customer •5004', amountCents: 49500, openedAtOffset: -1760 },
  { id: 'inv_8010', rooftopId: 'roof_north', repairOrderNumber: 'RO-8010', customerLabel: 'Customer •0418', amountCents: 18200, openedAtOffset: -1500 },
  { id: 'inv_8011', rooftopId: 'roof_north', repairOrderNumber: 'RO-8011', customerLabel: 'Customer •8133', amountCents: 21400, openedAtOffset: -1200 },
];

const paymentFixtures: PaymentFixture[] = [
  { id: 'pay_1001', rooftopId: 'roof_central', externalEventId: 'evt_ns_1001', customerLabel: 'Customer •4821', amountCents: 45900, reference: 'RO-8001', kind: 'CAPTURE' },
  { id: 'pay_1002', rooftopId: 'roof_north', externalEventId: 'evt_ns_1002', customerLabel: 'Customer •1974', amountCents: 73250, reference: 'RO-8002', kind: 'CAPTURE' },
  { id: 'pay_1003', rooftopId: 'roof_central', externalEventId: 'evt_ns_1003', customerLabel: 'Customer •7310', amountCents: 12800, reference: 'RO-8003', kind: 'CAPTURE' },
  { id: 'pay_1004', rooftopId: 'roof_central', externalEventId: 'evt_ns_1004', customerLabel: 'Customer •2208', amountCents: 109900, reference: 'RO-8004', kind: 'CAPTURE' },
  { id: 'pay_1005', rooftopId: 'roof_north', externalEventId: 'evt_ns_1005', customerLabel: 'Customer •5630', amountCents: 68400, reference: 'RO-8005', kind: 'CAPTURE' },
  { id: 'pay_1006', rooftopId: 'roof_central', externalEventId: 'evt_ns_1006', customerLabel: 'Customer •1142', amountCents: 52300, reference: 'RO-8006', kind: 'CAPTURE' },
  { id: 'pay_1007', rooftopId: 'roof_north', externalEventId: 'evt_ns_1007', customerLabel: 'Customer •9091', amountCents: 31500, reference: 'RO-8007', kind: 'CAPTURE' },
  { id: 'pay_1008', rooftopId: 'roof_central', externalEventId: 'evt_ns_1008', customerLabel: 'Customer •6620', amountCents: 46800, reference: 'RO-8008', kind: 'CAPTURE' },
  { id: 'pay_1009', rooftopId: 'roof_central', externalEventId: 'evt_ns_1009', customerLabel: 'Customer •5004', amountCents: 49500, reference: null, kind: 'CAPTURE' },
  { id: 'pay_1010', rooftopId: 'roof_north', externalEventId: 'evt_ns_1010', customerLabel: 'Customer •0418', amountCents: 18200, reference: 'RO-8010', kind: 'CAPTURE' },
  { id: 'pay_1011', rooftopId: 'roof_north', externalEventId: 'evt_ns_1011', customerLabel: 'Customer •8133', amountCents: 21400, reference: 'RO-8011', kind: 'CAPTURE' },
  { id: 'pay_1012', rooftopId: 'roof_central', externalEventId: 'evt_ns_1012', customerLabel: 'Customer •2208', amountCents: 12500, reference: 'RO-8004', kind: 'REFUND' },
];

function chapterStates(current: number): DemoState['chapters'] {
  const labels = ['Start of close', 'Routine automation', 'Duplicate event', 'Lost response', 'Ambiguous allocation', 'Concurrent decision', 'Settlement close', 'Evidence'];
  const summaries = [
    'Twelve events across two fictional rooftops are ready to process.',
    'Exact references match and post without manual work.',
    'Two deliveries produce one financial mutation.',
    'A committed posting is retrieved safely with the same key.',
    'Uncertain work is escalated instead of guessed.',
    'One controller wins; the stale write is rejected.',
    'The bank deposit reconciles before close.',
    'Inspect the complete, sanitized correlation trace.',
  ];
  return labels.map((label, number) => ({
    number,
    key: number === 0 ? 'start' : number === 7 ? 'evidence' : chapters[number - 1]?.action ?? 'evidence',
    label,
    status: current === 0 ? (number === 0 ? 'ACTIVE' : 'LOCKED') : number <= current ? 'COMPLETE' : number === current + 1 ? 'ACTIVE' : 'LOCKED',
    summary: summaries[number] ?? '',
  }));
}

export function makeSeedState(sessionId = crypto.randomUUID()): DemoState {
  return {
    metadata: { title: 'PostOnce', scenario: 'Friday 4:55 PM Close', organization: 'Northline Motor Group', disclaimer: 'Independent synthetic engineering case study. Not affiliated with Anchorbase, DealerTrack, any payment processor, bank, or dealership. No real payments or customer data.', generatedAt: fixtureNow },
    session: { id: sessionId, createdAt: fixtureNow, resetAt: fixtureNow, version: 0 },
    currentChapter: 0,
    close: { status: 'PROCESSING', blockingExceptionCount: 0, lastEvaluatedAt: fixtureNow },
    totals: { currency: 'CAD', grossCents: 529950, feeCents: 14526, refundCents: 12500, expectedDepositCents: 502924, bankDepositCents: 0, varianceCents: 502924 },
    rooftops: [
      { id: 'roof_central', code: 'NMG-01', name: 'Northline Central', city: 'Calgary' },
      { id: 'roof_north', code: 'NMG-02', name: 'Northline North', city: 'Calgary' },
    ],
    settlementEvidence: {
      processorFee: { id: 'fee_northstar_20260830_001', system: 'NORTHSTAR_PROCESSOR', component: 'PROCESSOR_FEE', externalEventId: 'settlement_northstar_20260830_001', amountCents: 14526, currency: 'CAD', receivedAt: stamp(-300) },
      bankDeposit: { id: 'deposit_prairie_20260830_001', system: 'PRAIRIE_BANK', component: 'BANK_DEPOSIT', externalEventId: 'bank_dep_20260830_001', amountCents: 502924, currency: 'CAD', receivedAt: stamp(-60) },
    },
    invoices: invoiceFixtures.map(({ openedAtOffset, ...invoice }) => ({ ...invoice, balanceCents: invoice.amountCents, currency: 'CAD', status: 'OPEN', openedAt: stamp(openedAtOffset) })),
    payments: paymentFixtures.map((payment, index) => ({ ...payment, provider: 'northstar', currency: 'CAD', status: 'RECEIVED', receivedAt: stamp(-800 + index * 40) })),
    allocations: [], exceptions: [], integrationAttempts: [], inbox: [], outbox: [],
    auditEvents: [{ id: 'audit_0001', sequence: 1, type: 'DEMO_SESSION_CREATED', entityType: 'session', entityId: sessionId, actor: 'system', occurredAt: fixtureNow, correlationId: `corr_${sessionId.slice(0, 8)}_start`, summary: 'A private synthetic close workspace was created.', details: { paymentEvents: 12, rooftops: 2, realMoney: false } }],
    chapters: chapterStates(0), completedActions: [],
    invariants: { processorDeliveriesReceived: 0, uniqueProcessorEventsApplied: 0, duplicateDeliveriesIgnored: 0, dmsAttempts: 0, dmsMutations: 0, lostResponses: 0, retriesResolvedByLookup: 0, concurrentDecisions: 0, acceptedDecisions: 0, rejectedVersionConflicts: 0, outboxCreated: 0, outboxDelivered: 0 },
    evidence: {
      checks: [
        { id: 'unique_event', label: 'Unique processor event', status: 'PENDING', value: '0 duplicates absorbed', explanation: 'A provider event may be delivered repeatedly but mutates financial state once.' },
        { id: 'stable_key', label: 'Stable DMS operation key', status: 'PENDING', value: 'Not exercised', explanation: 'A retry checks the original operation key instead of posting again.' },
        { id: 'version_guard', label: 'Optimistic version guard', status: 'PENDING', value: 'Not exercised', explanation: 'A stale human decision is rejected with the winning state.' },
        { id: 'settlement', label: 'Settlement equation', status: 'PENDING', value: '$0.00 received', explanation: 'Gross minus fees and refunds must equal the bank deposit.' },
      ],
      benchmark: { datasetSize: 50000, indexedLookupComplexity: 'O(1) expected', sequentialScanComplexity: 'O(n)', indexedLookupMicros: 0.42, sequentialScanMicros: 412.8, generatedFrom: 'deterministic synthetic fixture' },
      race: { attempted: false, winner: null, loser: null, acceptedStatus: null, rejectedStatus: null, winningVersion: null },
    },
  };
}

function payment(state: DemoState, id: string) { return state.payments.find((item) => item.id === id)!; }
function invoice(state: DemoState, id: string) { return state.invoices.find((item) => item.id === id)!; }
function updateCheck(state: DemoState, id: string, value: string) { state.evidence.checks = state.evidence.checks.map((item) => item.id === id ? { ...item, status: 'PASS', value } : item); }

function appendAudit(state: DemoState, input: Omit<AuditEvent, 'id' | 'sequence' | 'occurredAt'>): void {
  const sequence = state.auditEvents.length + 1;
  state.auditEvents.push({ id: `audit_${String(sequence).padStart(4, '0')}`, sequence, occurredAt: stamp(sequence), ...input });
}

function appendAttempt(state: DemoState, input: Omit<IntegrationAttempt, 'id' | 'occurredAt'>): void {
  const sequence = state.integrationAttempts.length + 1;
  state.integrationAttempts.push({ id: `try_${String(sequence).padStart(4, '0')}`, occurredAt: stamp(sequence), ...input });
}

function acceptInbox(state: DemoState, externalEventId: string): boolean {
  state.invariants.processorDeliveriesReceived += 1;
  const existing = state.inbox.find((item) => item.externalEventId === externalEventId);
  if (existing) { existing.deliveryCount += 1; state.invariants.duplicateDeliveriesIgnored += 1; return false; }
  state.inbox.push({ provider: 'northstar', externalEventId, firstSeenAt: stamp(state.inbox.length), deliveryCount: 1 });
  state.invariants.uniqueProcessorEventsApplied += 1;
  return true;
}

function allocate(state: DemoState, paymentId: string, invoiceId: string, source: 'EXACT_REFERENCE' | 'HUMAN_RESOLUTION', operationKey: string): void {
  if (state.allocations.some((item) => item.operationKey === operationKey)) return;
  const pay = payment(state, paymentId);
  const bill = invoice(state, invoiceId);
  state.allocations.push({ id: `alloc_${String(state.allocations.length + 1).padStart(4, '0')}`, paymentId, invoiceId, amountCents: pay.amountCents, source, operationKey, createdAt: stamp(state.allocations.length) });
  bill.balanceCents -= pay.amountCents;
  bill.status = bill.balanceCents === 0 ? 'PAID' : 'PARTIAL';
  pay.status = 'MATCHED';
}

function createOutbox(state: DemoState, paymentId: string, invoiceId: string, operationKey: string): void {
  if (state.outbox.some((item) => item.operationKey === operationKey)) return;
  state.outbox.push({ id: `out_${String(state.outbox.length + 1).padStart(4, '0')}`, paymentId, invoiceId, operationKey, destination: 'LEGACY_DMS', status: 'PENDING', attemptCount: 0, createdAt: stamp(state.outbox.length), deliveredAt: null });
  state.invariants.outboxCreated += 1;
}

function deliverNormally(state: DemoState, operationKey: string, correlationId: string): void {
  const outbox = state.outbox.find((item) => item.operationKey === operationKey)!;
  if (outbox.status === 'DELIVERED') return;
  const pay = payment(state, outbox.paymentId);
  const bill = invoice(state, outbox.invoiceId);
  outbox.attemptCount += 1; outbox.status = 'DELIVERED'; outbox.deliveredAt = stamp(state.integrationAttempts.length);
  pay.status = 'POSTED'; state.invariants.dmsAttempts += 1; state.invariants.dmsMutations += 1; state.invariants.outboxDelivered += 1;
  appendAttempt(state, { system: 'LEGACY_DMS', direction: 'OUTBOUND', operation: 'post-payment', externalEventId: pay.externalEventId, operationKey, correlationId, status: 'COMMITTED', httpStatus: 201, attempt: outbox.attemptCount, note: 'LegacyDMS accepted one synthetic payment posting.', sanitizedRequest: { repairOrderNumber: bill.repairOrderNumber, amountCents: pay.amountCents, operationKey }, sanitizedResponse: { postingId: `OP-${outbox.id.slice(-4).toUpperCase()}`, committed: true } });
}

function processRoutine(state: DemoState): void {
  const prefix = sessionPrefix(state); const correlationId = `corr_${prefix}_routine`;
  const routineIds = ['pay_1001', 'pay_1002', 'pay_1003', 'pay_1004', 'pay_1005', 'pay_1006', 'pay_1007', 'pay_1008', 'pay_1011'];
  for (const id of routineIds) {
    const pay = payment(state, id); acceptInbox(state, pay.externalEventId);
    const bill = state.invoices.find((item) => item.repairOrderNumber === pay.reference)!;
    const key = `op_${prefix}_${pay.id}`; allocate(state, pay.id, bill.id, 'EXACT_REFERENCE', key); createOutbox(state, pay.id, bill.id, key);
    if (id !== 'pay_1003') deliverNormally(state, key, correlationId);
  }
  const refund = payment(state, 'pay_1012'); acceptInbox(state, refund.externalEventId); refund.status = 'REFUNDED';
  appendAudit(state, { type: 'ROUTINE_BATCH_PROCESSED', entityType: 'close', entityId: 'close_2026_08_30', actor: 'matcher', correlationId, summary: '9 exact-reference captures matched; 8 posted without review.', details: { indexedLookup: 'O(1) expected', exactMatches: 9, dmsPosted: 8, pendingBoundaryTest: 'pay_1003', refundsRecorded: 1 } });
}

function deliverDuplicate(state: DemoState): void {
  const prefix = sessionPrefix(state); const pay = payment(state, 'pay_1010'); const correlationId = `corr_${prefix}_duplicate`; const inboxKey = `inbox_northstar_${pay.externalEventId}`;
  acceptInbox(state, pay.externalEventId);
  appendAttempt(state, { system: 'NORTHSTAR_PROCESSOR', direction: 'INBOUND', operation: 'processor.payment.captured', externalEventId: pay.externalEventId, operationKey: inboxKey, correlationId, status: 'ACCEPTED', httpStatus: 202, attempt: 1, note: 'The first delivery entered the durable inbox.', sanitizedRequest: { eventId: pay.externalEventId, amountCents: pay.amountCents, currency: pay.currency }, sanitizedResponse: { accepted: true } });
  const destinationKey = `op_${prefix}_${pay.id}`; allocate(state, pay.id, 'inv_8010', 'EXACT_REFERENCE', destinationKey); createOutbox(state, pay.id, 'inv_8010', destinationKey); deliverNormally(state, destinationKey, correlationId);
  acceptInbox(state, pay.externalEventId);
  appendAttempt(state, { system: 'NORTHSTAR_PROCESSOR', direction: 'INBOUND', operation: 'processor.payment.captured', externalEventId: pay.externalEventId, operationKey: inboxKey, correlationId, status: 'DUPLICATE', httpStatus: 200, attempt: 2, note: 'The duplicate delivery was acknowledged but did not reapply financial state.', sanitizedRequest: { eventId: pay.externalEventId, amountCents: pay.amountCents, currency: pay.currency }, sanitizedResponse: { accepted: true, replay: true } });
  updateCheck(state, 'unique_event', '2 deliveries → 1 mutation');
  appendAudit(state, { type: 'DUPLICATE_EVENT_ABSORBED', entityType: 'payment', entityId: pay.id, actor: 'processor-inbox', correlationId, summary: 'Two webhook deliveries produced one allocation and one posting.', details: { externalEventId: pay.externalEventId, firstAccepted: true, secondAccepted: false, financialMutations: 1 } });
}

function simulateLostResponse(state: DemoState): void {
  const prefix = sessionPrefix(state); const pay = payment(state, 'pay_1003'); const key = `op_${prefix}_${pay.id}`; const correlationId = `corr_${prefix}_lost_response`; const outbox = state.outbox.find((item) => item.operationKey === key)!;
  outbox.attemptCount += 1; state.invariants.dmsAttempts += 1; state.invariants.dmsMutations += 1; state.invariants.lostResponses += 1;
  appendAttempt(state, { system: 'LEGACY_DMS', direction: 'OUTBOUND', operation: 'post-payment', externalEventId: pay.externalEventId, operationKey: key, correlationId, status: 'RESPONSE_LOST', httpStatus: null, attempt: 1, note: 'LegacyDMS committed the posting, but the caller observed a timeout instead of the success response.', sanitizedRequest: { repairOrderNumber: 'RO-8003', amountCents: pay.amountCents, operationKey: key }, sanitizedResponse: { postingId: 'OP-7Q3K', committed: true, deliveredToClient: false } });
  outbox.attemptCount += 1; outbox.status = 'DELIVERED'; outbox.deliveredAt = stamp(14); pay.status = 'POSTED'; state.invariants.dmsAttempts += 1; state.invariants.retriesResolvedByLookup += 1; state.invariants.outboxDelivered += 1;
  appendAttempt(state, { system: 'LEGACY_DMS', direction: 'OUTBOUND', operation: 'lookup-by-operation-key', externalEventId: pay.externalEventId, operationKey: key, correlationId, status: 'REPLAYED', httpStatus: 200, attempt: 2, note: 'The retry reused the key and retrieved the original committed result.', sanitizedRequest: { operationKey: key }, sanitizedResponse: { postingId: 'OP-7Q3K', committed: true, replay: true } });
  updateCheck(state, 'stable_key', '2 attempts → OP-7Q3K once');
  appendAudit(state, { type: 'LOST_RESPONSE_RECOVERED', entityType: 'outbox', entityId: outbox.id, actor: 'outbox-relay', correlationId, summary: 'A timeout after commit was recovered without a second DMS mutation.', details: { attempts: 2, mutations: 1, operationKey: key, postingId: 'OP-7Q3K' } });
}

function openAmbiguity(state: DemoState): void {
  const prefix = sessionPrefix(state); const pay = payment(state, 'pay_1009'); const correlationId = `corr_${prefix}_ambiguity`; acceptInbox(state, pay.externalEventId); pay.status = 'EXCEPTION';
  state.exceptions.push({ id: 'exc_ambiguous_1009', paymentId: pay.id, type: 'AMBIGUOUS_ALLOCATION', severity: 'BLOCKING', status: 'OPEN', version: 1, title: 'One payment, two credible repair orders', summary: 'Amount and masked customer label match two open invoices; deterministic evidence is insufficient.', openedAt: stamp(15), candidates: [
    { invoiceId: 'inv_8031', repairOrderNumber: 'RO-8031', amountCents: 49500, score: 0.78, reasons: ['Exact amount', 'Same masked customer', 'Within 31-minute window'] },
    { invoiceId: 'inv_8037', repairOrderNumber: 'RO-8037', amountCents: 49500, score: 0.76, reasons: ['Exact amount', 'Same masked customer', 'Within 33-minute window'] },
  ], assistantNote: 'Advisory only: both candidates are plausible. A repair-order reference or authorized human decision is required.', resolution: null });
  state.close.status = 'BLOCKED'; state.close.blockingExceptionCount = 1; state.close.lastEvaluatedAt = stamp(15);
  appendAudit(state, { type: 'AMBIGUOUS_ALLOCATION_ESCALATED', entityType: 'exception', entityId: 'exc_ambiguous_1009', actor: 'matcher', correlationId, summary: 'The matcher refused to guess between two credible candidates.', details: { confidenceThreshold: 0.9, leadingScore: 0.78, assistantCanMutate: false } });
}

function resolveRace(state: DemoState): void {
  const prefix = sessionPrefix(state); const exception = state.exceptions.find((item) => item.id === 'exc_ambiguous_1009')!; const correlationId = `corr_${prefix}_race`; const key = `resolve_${prefix}_maya`;
  state.invariants.concurrentDecisions += 2;
  allocate(state, exception.paymentId, 'inv_8031', 'HUMAN_RESOLUTION', key); createOutbox(state, exception.paymentId, 'inv_8031', key); deliverNormally(state, key, correlationId);
  exception.status = 'RESOLVED'; exception.version = 2; exception.resolution = { candidateInvoiceId: 'inv_8031', acceptedAmountCents: 49500, actor: 'Maya Chen', reason: 'Repair-order reference confirmed from the synthetic end-of-day worksheet.', operationKey: key, resolvedAt: stamp(16) };
  state.close.status = 'PROCESSING'; state.close.blockingExceptionCount = 0; state.close.lastEvaluatedAt = stamp(16); state.invariants.acceptedDecisions += 1;
  appendAudit(state, { type: 'EXCEPTION_RESOLVED', entityType: 'exception', entityId: exception.id, actor: 'Maya Chen', correlationId, summary: 'Maya Chen resolved the ambiguous payment without editing prior evidence.', details: { previousVersion: 1, resultingVersion: 2, candidateInvoiceId: 'inv_8031', acceptedAmountCents: 49500, operationKey: key } });
  state.invariants.rejectedVersionConflicts += 1;
  appendAudit(state, { type: 'STALE_RESOLUTION_REJECTED', entityType: 'exception', entityId: exception.id, actor: 'Jon Bell', correlationId, summary: 'A concurrent stale decision received HTTP 409 and the winning version.', details: { expectedVersion: 1, actualVersion: 2, status: 409, winner: 'Maya Chen' } });
  state.evidence.race = { attempted: true, winner: 'Maya Chen', loser: 'Jon Bell', acceptedStatus: 200, rejectedStatus: 409, winningVersion: 2 };
  updateCheck(state, 'version_guard', '200 winner / 409 stale writer');
}

function resolveManually(state: DemoState): void {
  const prefix = sessionPrefix(state); const exception = state.exceptions.find((item) => item.id === 'exc_ambiguous_1009')!;
  if (exception.status === 'RESOLVED') return;
  const key = `resolve_${prefix}_manual`; const correlationId = `corr_${prefix}_manual_resolution`;
  allocate(state, exception.paymentId, 'inv_8031', 'HUMAN_RESOLUTION', key); createOutbox(state, exception.paymentId, 'inv_8031', key); deliverNormally(state, key, correlationId);
  exception.status = 'RESOLVED'; exception.version = 2; exception.resolution = { candidateInvoiceId: 'inv_8031', acceptedAmountCents: 49500, actor: 'Maya Chen', reason: 'Authorized reviewer confirmed the repair-order evidence.', operationKey: key, resolvedAt: stamp(16) };
  state.close.status = 'PROCESSING'; state.close.blockingExceptionCount = 0; state.close.lastEvaluatedAt = stamp(16); state.invariants.acceptedDecisions += 1;
  appendAudit(state, { type: 'EXCEPTION_RESOLVED', entityType: 'exception', entityId: exception.id, actor: 'Maya Chen', correlationId, summary: 'Maya Chen resolved the ambiguous payment without editing prior evidence.', details: { previousVersion: 1, resultingVersion: 2, candidateInvoiceId: 'inv_8031', acceptedAmountCents: 49500, operationKey: key } });
}

function reconcile(state: DemoState): void {
  const prefix = sessionPrefix(state); const correlationId = `corr_${prefix}_settlement`;
  const grossCents = state.payments.filter((item) => item.kind === 'CAPTURE').reduce((sum, item) => sum + item.amountCents, 0);
  const refundCents = state.payments.filter((item) => item.kind === 'REFUND').reduce((sum, item) => sum + item.amountCents, 0);
  const feeCents = state.settlementEvidence.processorFee.amountCents;
  const expectedDepositCents = grossCents - feeCents - refundCents;
  const bankDepositCents = state.settlementEvidence.bankDeposit.amountCents;
  const varianceCents = expectedDepositCents - bankDepositCents;
  state.totals = { currency: 'CAD', grossCents, feeCents, refundCents, expectedDepositCents, bankDepositCents, varianceCents };
  state.close.status = varianceCents === 0 ? 'READY' : 'BLOCKED'; state.close.blockingExceptionCount = 0; state.close.lastEvaluatedAt = stamp(17);
  appendAttempt(state, { system: 'PRAIRIE_BANK', direction: 'INBOUND', operation: 'settlement.deposit.received', externalEventId: state.settlementEvidence.bankDeposit.externalEventId, operationKey: `settlement_${prefix}_${state.settlementEvidence.bankDeposit.id}`, correlationId, status: varianceCents === 0 ? 'RECONCILED' : 'REJECTED', httpStatus: 200, attempt: 1, note: varianceCents === 0 ? 'The independent synthetic bank deposit equals captures minus processor fees and refunds.' : 'The independent synthetic bank deposit does not equal the expected settlement net.', sanitizedRequest: { depositRecordId: state.settlementEvidence.bankDeposit.id, depositCents: bankDepositCents, currency: state.totals.currency }, sanitizedResponse: { matched: varianceCents === 0, expectedDepositCents, varianceCents } });
  updateCheck(state, 'settlement', '$5,299.50 − $145.26 − $125.00 = $5,029.24');
  appendAudit(state, { type: varianceCents === 0 ? 'SETTLEMENT_RECONCILED' : 'SETTLEMENT_VARIANCE_DETECTED', entityType: 'settlement', entityId: 'settlement_close', actor: 'reconciliation-engine', correlationId, summary: varianceCents === 0 ? 'The independent deposit matched the expected net and the close became ready.' : 'The independent deposit did not match the expected net, so the close remained blocked.', details: { processorFeeRecordId: state.settlementEvidence.processorFee.id, bankDepositRecordId: state.settlementEvidence.bankDeposit.id, grossCents, feeCents, refundCents, expectedDepositCents, bankDepositCents, varianceCents } });
}

const orderedActions: Array<Exclude<ActionKey, 'run-all' | 'resolve-exception'>> = ['process-routine', 'deliver-duplicate', 'simulate-lost-response', 'open-ambiguous-exception', 'simulate-resolution-race', 'reconcile-settlement'];

function applyAction(state: DemoState, action: Exclude<ActionKey, 'run-all' | 'resolve-exception'>): void {
  if (action === 'process-routine') processRoutine(state);
  if (action === 'deliver-duplicate') deliverDuplicate(state);
  if (action === 'simulate-lost-response') simulateLostResponse(state);
  if (action === 'open-ambiguous-exception') openAmbiguity(state);
  if (action === 'simulate-resolution-race') resolveRace(state);
  if (action === 'reconcile-settlement') reconcile(state);
  if (!state.completedActions.includes(action)) state.completedActions.push(action);
  state.currentChapter = orderedActions.indexOf(action) + 1;
  state.chapters = chapterStates(state.currentChapter);
}

export function runLocalAction(previous: DemoState, action: ActionKey): DemoState {
  if (previous.completedActions.includes(action)) return previous;
  const state = structuredClone(previous);
  if (action === 'run-all') {
    for (const step of orderedActions) {
      if (state.completedActions.includes(step)) continue;
      if (step === 'simulate-resolution-race' && state.exceptions.some((item) => item.id === 'exc_ambiguous_1009' && item.status === 'RESOLVED')) {
        const exception = state.exceptions.find((item) => item.id === 'exc_ambiguous_1009')!;
        state.completedActions.push(step); state.currentChapter = 5; state.chapters = chapterStates(5);
        state.evidence.race = { attempted: false, winner: exception.resolution?.actor ?? null, loser: null, acceptedStatus: 200, rejectedStatus: null, winningVersion: exception.version };
        updateCheck(state, 'version_guard', 'Manual resolution already committed; race simulation skipped');
        appendAudit(state, { type: 'RACE_SIMULATION_SKIPPED', entityType: 'exception', entityId: exception.id, actor: 'guided-demo', correlationId: `corr_${sessionPrefix(state)}_race_skipped`, summary: 'The exception was already resolved, so the synthetic race chapter did not submit another decision.', details: { resolutionOperationKey: exception.resolution?.operationKey, resultingVersion: exception.version } });
        continue;
      }
      applyAction(state, step);
    }
    state.completedActions.push('run-all');
    appendAudit(state, { type: 'GUIDED_RUN_COMPLETED', entityType: 'session', entityId: state.session.id, actor: 'reviewer', correlationId: `corr_${sessionPrefix(state)}_run_all`, summary: 'The entire failure-safe close was completed.', details: { executed: orderedActions, closeStatus: state.close.status } });
  } else if (action === 'resolve-exception') {
    resolveManually(state); state.completedActions.push('resolve-exception'); state.currentChapter = 5; state.chapters = chapterStates(5);
  } else {
    applyAction(state, action);
  }
  state.session.version = previous.session.version + 1;
  return state;
}
