export type ActionKey =
  | 'process-routine'
  | 'deliver-duplicate'
  | 'simulate-lost-response'
  | 'open-ambiguous-exception'
  | 'simulate-resolution-race'
  | 'resolve-exception'
  | 'reconcile-settlement'
  | 'run-all';

export type ChapterId = '00' | '01' | '02' | '03' | '04' | '05' | '06';
export type ConnectionMode = 'api' | 'local';

export interface MoneyTotals {
  currency: string;
  grossCents: number;
  feeCents: number;
  refundCents: number;
  expectedDepositCents: number;
  bankDepositCents: number;
  varianceCents: number;
}

export interface SettlementEvidence {
  processorFee: {
    id: string; system: 'NORTHSTAR_PROCESSOR'; component: 'PROCESSOR_FEE';
    externalEventId: string; amountCents: number; currency: string; receivedAt: string;
  };
  bankDeposit: {
    id: string; system: 'PRAIRIE_BANK'; component: 'BANK_DEPOSIT';
    externalEventId: string; amountCents: number; currency: string; receivedAt: string;
  };
}

export interface Rooftop { id: string; code: string; name: string; city: string }
export interface Invoice {
  id: string; rooftopId: string; repairOrderNumber: string; customerLabel: string;
  amountCents: number; balanceCents: number; currency: string;
  status: 'OPEN' | 'PARTIAL' | 'PAID'; openedAt: string;
}
export interface Payment {
  id: string; rooftopId: string; provider: 'northstar'; externalEventId: string;
  customerLabel: string; amountCents: number; currency: string; kind: 'CAPTURE' | 'REFUND';
  status: 'RECEIVED' | 'MATCHED' | 'EXCEPTION' | 'POSTED' | 'REFUNDED';
  reference: string | null; receivedAt: string;
}
export interface Allocation {
  id: string; paymentId: string; invoiceId: string; amountCents: number;
  source: 'EXACT_REFERENCE' | 'HUMAN_RESOLUTION'; operationKey: string; createdAt: string;
}
export interface Candidate { invoiceId: string; repairOrderNumber: string; amountCents: number; score: number; reasons: string[] }
export interface Resolution {
  candidateInvoiceId: string; acceptedAmountCents: number; actor: string;
  reason: string; operationKey: string; resolvedAt: string;
}
export interface DemoException {
  id: string; paymentId: string; type: 'AMBIGUOUS_ALLOCATION' | 'VERSION_CONFLICT';
  severity: 'BLOCKING' | 'REVIEW'; status: 'OPEN' | 'RESOLVED'; version: number;
  title: string; summary: string; openedAt: string; candidates: Candidate[];
  assistantNote: string | null; resolution: Resolution | null;
}
export interface IntegrationAttempt {
  id: string; system: 'NORTHSTAR_PROCESSOR' | 'LEGACY_DMS' | 'PRAIRIE_BANK';
  direction: 'INBOUND' | 'OUTBOUND'; operation: string; externalEventId: string | null;
  operationKey: string; correlationId: string;
  status: 'ACCEPTED' | 'DUPLICATE' | 'COMMITTED' | 'RESPONSE_LOST' | 'REPLAYED' | 'RECONCILED' | 'REJECTED';
  httpStatus: number | null; attempt: number; occurredAt: string; note: string;
  sanitizedRequest: Record<string, unknown>; sanitizedResponse: Record<string, unknown> | null;
}
export interface AuditEvent {
  id: string; sequence: number; type: string; entityType: string; entityId: string;
  actor: string; occurredAt: string; correlationId: string; summary: string;
  details: Record<string, unknown>;
}
export interface OutboxItem {
  id: string; paymentId: string; invoiceId: string; operationKey: string;
  destination: 'LEGACY_DMS'; status: 'PENDING' | 'DELIVERED'; attemptCount: number;
  createdAt: string; deliveredAt: string | null;
}
export interface InboxReceipt { provider: 'northstar'; externalEventId: string; firstSeenAt: string; deliveryCount: number }
export interface ChapterState { number: number; key: string; label: string; status: 'COMPLETE' | 'ACTIVE' | 'READY' | 'LOCKED'; summary: string }
export interface Check { id: string; label: string; status: 'PASS' | 'PENDING'; value: string; explanation: string }

export interface DemoState {
  metadata: { title: 'PostOnce'; scenario: 'Friday 4:55 PM Close'; organization: 'Northline Motor Group'; disclaimer: string; generatedAt: string };
  session: { id: string; createdAt: string; resetAt: string; version: number };
  currentChapter: number;
  close: { status: 'PROCESSING' | 'BLOCKED' | 'READY'; blockingExceptionCount: number; lastEvaluatedAt: string };
  totals: MoneyTotals;
  settlementEvidence: SettlementEvidence;
  rooftops: Rooftop[];
  invoices: Invoice[];
  payments: Payment[];
  allocations: Allocation[];
  exceptions: DemoException[];
  integrationAttempts: IntegrationAttempt[];
  inbox: InboxReceipt[];
  outbox: OutboxItem[];
  auditEvents: AuditEvent[];
  chapters: ChapterState[];
  completedActions: ActionKey[];
  invariants: {
    processorDeliveriesReceived: number; uniqueProcessorEventsApplied: number;
    duplicateDeliveriesIgnored: number; dmsAttempts: number; dmsMutations: number;
    lostResponses: number; retriesResolvedByLookup: number; concurrentDecisions: number;
    acceptedDecisions: number; rejectedVersionConflicts: number; outboxCreated: number; outboxDelivered: number;
  };
  evidence: {
    checks: Check[];
    benchmark: {
      datasetSize: number; indexedLookupComplexity: 'O(1) expected'; sequentialScanComplexity: 'O(n)';
      indexedLookupMicros: number; sequentialScanMicros: number; generatedFrom: 'deterministic synthetic fixture';
    };
    race: {
      attempted: boolean; winner: string | null; loser: string | null;
      acceptedStatus: number | null; rejectedStatus: number | null; winningVersion: number | null;
    };
  };
}

export interface ApiErrorShape { error: { code: string; message: string; correlationId?: string; details?: Record<string, unknown> } }
export interface ChapterDefinition {
  id: ChapterId; index: number; eyebrow: string; title: string; shortTitle: string;
  body: string; action?: ActionKey; actionLabel?: string; proof: string;
}
