import { describe, expect, it } from 'vitest';
import { chapters, makeSeedState, runLocalAction } from './demoData';
import { countLogicalAttempts } from './trace';

const fixedSessionId = '3dfcb7a4-1f63-42e7-8755-22ef762d7ae1';

describe('canonical local preview fixture', () => {
  it('uses the same stable IDs and financial totals as the backend scenario', () => {
    const state = makeSeedState(fixedSessionId);

    expect(state.invoices.map((invoice) => invoice.id)).toEqual([
      'inv_8001', 'inv_8002', 'inv_8003', 'inv_8004', 'inv_8005', 'inv_8006',
      'inv_8007', 'inv_8008', 'inv_8031', 'inv_8037', 'inv_8010', 'inv_8011',
    ]);
    expect(state.payments.map((payment) => payment.id)).toEqual([
      'pay_1001', 'pay_1002', 'pay_1003', 'pay_1004', 'pay_1005', 'pay_1006',
      'pay_1007', 'pay_1008', 'pay_1009', 'pay_1010', 'pay_1011', 'pay_1012',
    ]);
    expect(state.totals).toMatchObject({
      currency: 'CAD',
      grossCents: 529_950,
      feeCents: 14_526,
      refundCents: 12_500,
      expectedDepositCents: 502_924,
    });
    expect(state.settlementEvidence).toMatchObject({
      processorFee: { id: 'fee_northstar_20260830_001', amountCents: 14_526 },
      bankDeposit: { id: 'deposit_prairie_20260830_001', amountCents: 502_924 },
    });
    expect(state.invoices.some((invoice) => invoice.id.startsWith('inv_100'))).toBe(false);
  });

  it('keeps every final-state relationship referentially intact', () => {
    const state = runLocalAction(makeSeedState(fixedSessionId), 'run-all');
    const paymentIds = new Set(state.payments.map((payment) => payment.id));
    const invoiceIds = new Set(state.invoices.map((invoice) => invoice.id));
    const paymentEventIds = new Set(state.payments.map((payment) => payment.externalEventId));

    for (const payment of state.payments) {
      if (!payment.reference) continue;
      expect(state.invoices.some((invoice) => invoice.repairOrderNumber === payment.reference)).toBe(true);
    }

    for (const allocation of state.allocations) {
      expect(paymentIds.has(allocation.paymentId)).toBe(true);
      expect(invoiceIds.has(allocation.invoiceId)).toBe(true);
    }

    for (const item of state.outbox) {
      expect(paymentIds.has(item.paymentId)).toBe(true);
      expect(invoiceIds.has(item.invoiceId)).toBe(true);
      expect(state.allocations).toContainEqual(expect.objectContaining({
        paymentId: item.paymentId,
        invoiceId: item.invoiceId,
        operationKey: item.operationKey,
      }));
    }

    for (const receipt of state.inbox) expect(paymentEventIds.has(receipt.externalEventId)).toBe(true);
    for (const exception of state.exceptions) {
      expect(paymentIds.has(exception.paymentId)).toBe(true);
      for (const candidate of exception.candidates) expect(invoiceIds.has(candidate.invoiceId)).toBe(true);
      if (exception.resolution) expect(invoiceIds.has(exception.resolution.candidateInvoiceId)).toBe(true);
    }

    expect(new Set(state.allocations.map((allocation) => allocation.operationKey)).size).toBe(state.allocations.length);
    expect(new Set(state.outbox.map((item) => item.operationKey)).size).toBe(state.outbox.length);
    expect(state.allocations).toHaveLength(11);
    expect(state.outbox).toHaveLength(11);
  });

  it('reproduces the canonical sequence, counters, retry trace, and race actors', () => {
    const state = runLocalAction(makeSeedState(fixedSessionId), 'run-all');

    expect(state.currentChapter).toBe(6);
    expect(state.close).toMatchObject({ status: 'READY', blockingExceptionCount: 0 });
    expect(state.totals).toMatchObject({ bankDepositCents: 502_924, varianceCents: 0 });
    expect(state.invariants).toMatchObject({
      processorDeliveriesReceived: 13,
      uniqueProcessorEventsApplied: 12,
      duplicateDeliveriesIgnored: 1,
      dmsAttempts: 12,
      dmsMutations: 11,
      lostResponses: 1,
      retriesResolvedByLookup: 1,
      concurrentDecisions: 2,
      acceptedDecisions: 1,
      rejectedVersionConflicts: 1,
      outboxCreated: 11,
      outboxDelivered: 11,
    });
    expect(state.auditEvents.map((event) => event.id)).toEqual(
      Array.from({ length: 9 }, (_, index) => `audit_${String(index + 1).padStart(4, '0')}`),
    );
    expect(state.auditEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(state.integrationAttempts.map((attempt) => attempt.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `try_${String(index + 1).padStart(4, '0')}`),
    );

    const lostTrace = state.integrationAttempts.filter((attempt) => attempt.correlationId === 'corr_3dfcb7a4_lost_response');
    expect(lostTrace).toHaveLength(2);
    expect(lostTrace.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(new Set(lostTrace.map((attempt) => attempt.operationKey))).toEqual(new Set(['op_3dfcb7a4_pay_1003']));
    expect(countLogicalAttempts(state.integrationAttempts, lostTrace[1]!)).toBe(2);
    const traceWithExtraObservation = [...state.integrationAttempts, { ...lostTrace[0]!, id: 'try_observation_only', operation: 'transport-observation' }];
    expect(countLogicalAttempts(traceWithExtraObservation, lostTrace[1]!)).toBe(2);

    const settlementAttempt = state.integrationAttempts.at(-1)!;
    expect(settlementAttempt).toMatchObject({
      operationKey: 'settlement_3dfcb7a4_deposit_prairie_20260830_001',
      externalEventId: 'bank_dep_20260830_001',
    });

    const exception = state.exceptions[0]!;
    expect(exception.resolution).toMatchObject({
      actor: 'Maya Chen',
      candidateInvoiceId: 'inv_8031',
      operationKey: 'resolve_3dfcb7a4_maya',
    });
    expect(state.evidence.race).toEqual({
      attempted: true,
      winner: 'Maya Chen',
      loser: 'Jon Bell',
      acceptedStatus: 200,
      rejectedStatus: 409,
      winningVersion: 2,
    });
  });

  it('describes the guided race as deterministic injection backed by real concurrency tests', () => {
    const chapter = chapters.find((item) => item.index === 5);
    expect(chapter?.eyebrow).toBe('DETERMINISTIC FAILURE INJECTION');
    expect(chapter?.body).toMatch(/same version guard exercised by real concurrent HTTP\/PostgreSQL tests/i);
  });

  it('keeps the backend manual-resolution branch coherent when run-all continues afterward', () => {
    let state = makeSeedState(fixedSessionId);
    for (const action of ['process-routine', 'deliver-duplicate', 'simulate-lost-response', 'open-ambiguous-exception'] as const) {
      state = runLocalAction(state, action);
    }
    state = runLocalAction(state, 'resolve-exception');
    state = runLocalAction(state, 'run-all');

    expect(state.close.status).toBe('READY');
    expect(state.evidence.race).toMatchObject({ attempted: false, winner: 'Maya Chen', loser: null, rejectedStatus: null });
    expect(state.auditEvents.map((event) => event.type)).toContain('RACE_SIMULATION_SKIPPED');
    expect(state.exceptions[0]?.resolution?.operationKey).toBe('resolve_3dfcb7a4_manual');
    expect(state.invariants).toMatchObject({ concurrentDecisions: 0, acceptedDecisions: 1, rejectedVersionConflicts: 0 });
    expect(state.allocations.filter((allocation) => allocation.paymentId === 'pay_1009')).toHaveLength(1);
  });
});
