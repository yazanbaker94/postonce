import { z } from "zod";

export const DEMO_SESSION_HEADER = "X-Demo-Session" as const;

export const DemoActionSchema = z.enum([
  "process-routine",
  "deliver-duplicate",
  "simulate-lost-response",
  "open-ambiguous-exception",
  "simulate-resolution-race",
  "resolve-exception",
  "reconcile-settlement",
  "run-all",
]);

export type DemoAction = z.infer<typeof DemoActionSchema>;

export const ActionRequestSchema = z.object({
  operationKey: z.string().trim().min(4).max(120).optional(),
  expectedVersion: z.number().int().positive().optional(),
  candidateInvoiceId: z.string().trim().min(1).max(80).optional(),
  acceptedAmountCents: z.number().int().positive().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
  actor: z.string().trim().min(2).max(80).optional(),
}).strict();

export type ActionRequest = z.infer<typeof ActionRequestSchema>;

export const MoneySummarySchema = z.object({
  currency: z.string().length(3),
  grossCents: z.number().int(),
  feeCents: z.number().int(),
  refundCents: z.number().int(),
  expectedDepositCents: z.number().int(),
  bankDepositCents: z.number().int(),
  varianceCents: z.number().int(),
});

export const ProcessorFeeRecordSchema = z.object({
  id: z.string(),
  system: z.literal("NORTHSTAR_PROCESSOR"),
  component: z.literal("PROCESSOR_FEE"),
  externalEventId: z.string(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  receivedAt: z.string().datetime(),
});

export const BankDepositRecordSchema = z.object({
  id: z.string(),
  system: z.literal("PRAIRIE_BANK"),
  component: z.literal("BANK_DEPOSIT"),
  externalEventId: z.string(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  receivedAt: z.string().datetime(),
});

export const SettlementEvidenceSchema = z.object({
  processorFee: ProcessorFeeRecordSchema,
  bankDeposit: BankDepositRecordSchema,
});

export const RooftopSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  city: z.string(),
});

export const InvoiceSchema = z.object({
  id: z.string(),
  rooftopId: z.string(),
  repairOrderNumber: z.string(),
  customerLabel: z.string(),
  amountCents: z.number().int().nonnegative(),
  balanceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.enum(["OPEN", "PARTIAL", "PAID"]),
  openedAt: z.string().datetime(),
});

export const PaymentSchema = z.object({
  id: z.string(),
  rooftopId: z.string(),
  provider: z.literal("northstar"),
  externalEventId: z.string(),
  customerLabel: z.string(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  kind: z.enum(["CAPTURE", "REFUND"]),
  status: z.enum(["RECEIVED", "MATCHED", "EXCEPTION", "POSTED", "REFUNDED"]),
  reference: z.string().nullable(),
  receivedAt: z.string().datetime(),
});

export const AllocationSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  invoiceId: z.string(),
  amountCents: z.number().int().positive(),
  source: z.enum(["EXACT_REFERENCE", "HUMAN_RESOLUTION"]),
  operationKey: z.string(),
  createdAt: z.string().datetime(),
});

export const CandidateSchema = z.object({
  invoiceId: z.string(),
  repairOrderNumber: z.string(),
  amountCents: z.number().int(),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
});

export const ResolutionSchema = z.object({
  candidateInvoiceId: z.string(),
  acceptedAmountCents: z.number().int().positive(),
  actor: z.string(),
  reason: z.string(),
  operationKey: z.string(),
  resolvedAt: z.string().datetime(),
});

export const ExceptionSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  type: z.enum(["AMBIGUOUS_ALLOCATION", "VERSION_CONFLICT"]),
  severity: z.enum(["BLOCKING", "REVIEW"]),
  status: z.enum(["OPEN", "RESOLVED"]),
  version: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  openedAt: z.string().datetime(),
  candidates: z.array(CandidateSchema),
  assistantNote: z.string().nullable(),
  resolution: ResolutionSchema.nullable(),
});

export const IntegrationAttemptSchema = z.object({
  id: z.string(),
  system: z.enum(["NORTHSTAR_PROCESSOR", "LEGACY_DMS", "PRAIRIE_BANK"]),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  operation: z.string(),
  externalEventId: z.string().nullable(),
  operationKey: z.string(),
  correlationId: z.string(),
  status: z.enum(["ACCEPTED", "DUPLICATE", "COMMITTED", "RESPONSE_LOST", "REPLAYED", "RECONCILED", "REJECTED"]),
  httpStatus: z.number().int().nullable(),
  attempt: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  note: z.string(),
  sanitizedRequest: z.record(z.unknown()),
  sanitizedResponse: z.record(z.unknown()).nullable(),
});

export const AuditEventSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  type: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actor: z.string(),
  occurredAt: z.string().datetime(),
  correlationId: z.string(),
  summary: z.string(),
  details: z.record(z.unknown()),
});

export const OutboxItemSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  invoiceId: z.string(),
  operationKey: z.string(),
  destination: z.literal("LEGACY_DMS"),
  status: z.enum(["PENDING", "DELIVERED"]),
  attemptCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable(),
});

export const InboxReceiptSchema = z.object({
  provider: z.literal("northstar"),
  externalEventId: z.string(),
  firstSeenAt: z.string().datetime(),
  deliveryCount: z.number().int().positive(),
});

export const ChapterSchema = z.object({
  number: z.number().int().min(0).max(7),
  key: z.string(),
  label: z.string(),
  status: z.enum(["COMPLETE", "ACTIVE", "READY", "LOCKED"]),
  summary: z.string(),
});

export const CheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["PASS", "PENDING"]),
  value: z.string(),
  explanation: z.string(),
});

export const BenchmarkSchema = z.object({
  datasetSize: z.number().int(),
  indexedLookupComplexity: z.literal("O(1) expected"),
  sequentialScanComplexity: z.literal("O(n)"),
  indexedLookupMicros: z.number().nonnegative(),
  sequentialScanMicros: z.number().nonnegative(),
  generatedFrom: z.literal("deterministic synthetic fixture"),
});

export const DemoStateSchema = z.object({
  metadata: z.object({
    title: z.literal("PostOnce"),
    scenario: z.literal("Friday 4:55 PM Close"),
    organization: z.literal("Northline Motor Group"),
    disclaimer: z.string(),
    generatedAt: z.string().datetime(),
  }),
  session: z.object({
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
    resetAt: z.string().datetime(),
    version: z.number().int().nonnegative(),
  }),
  currentChapter: z.number().int().min(0).max(7),
  close: z.object({
    status: z.enum(["PROCESSING", "BLOCKED", "READY"]),
    blockingExceptionCount: z.number().int().nonnegative(),
    lastEvaluatedAt: z.string().datetime(),
  }),
  totals: MoneySummarySchema,
  settlementEvidence: SettlementEvidenceSchema,
  rooftops: z.array(RooftopSchema),
  invoices: z.array(InvoiceSchema),
  payments: z.array(PaymentSchema),
  allocations: z.array(AllocationSchema),
  exceptions: z.array(ExceptionSchema),
  integrationAttempts: z.array(IntegrationAttemptSchema),
  inbox: z.array(InboxReceiptSchema),
  outbox: z.array(OutboxItemSchema),
  auditEvents: z.array(AuditEventSchema),
  chapters: z.array(ChapterSchema),
  completedActions: z.array(DemoActionSchema),
  invariants: z.object({
    processorDeliveriesReceived: z.number().int().nonnegative(),
    uniqueProcessorEventsApplied: z.number().int().nonnegative(),
    duplicateDeliveriesIgnored: z.number().int().nonnegative(),
    dmsAttempts: z.number().int().nonnegative(),
    dmsMutations: z.number().int().nonnegative(),
    lostResponses: z.number().int().nonnegative(),
    retriesResolvedByLookup: z.number().int().nonnegative(),
    concurrentDecisions: z.number().int().nonnegative(),
    acceptedDecisions: z.number().int().nonnegative(),
    rejectedVersionConflicts: z.number().int().nonnegative(),
    outboxCreated: z.number().int().nonnegative(),
    outboxDelivered: z.number().int().nonnegative(),
  }),
  evidence: z.object({
    checks: z.array(CheckSchema),
    benchmark: BenchmarkSchema,
    race: z.object({
      attempted: z.boolean(),
      winner: z.string().nullable(),
      loser: z.string().nullable(),
      acceptedStatus: z.number().int().nullable(),
      rejectedStatus: z.number().int().nullable(),
      winningVersion: z.number().int().nullable(),
    }),
  }),
});

export type DemoState = z.infer<typeof DemoStateSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type Allocation = z.infer<typeof AllocationSchema>;
export type DemoException = z.infer<typeof ExceptionSchema>;
export type IntegrationAttempt = z.infer<typeof IntegrationAttemptSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type OutboxItem = z.infer<typeof OutboxItemSchema>;
export type InboxReceipt = z.infer<typeof InboxReceiptSchema>;
export type SettlementEvidence = z.infer<typeof SettlementEvidenceSchema>;

export const ActionResponseSchema = z.object({
  action: DemoActionSchema,
  replayed: z.boolean(),
  chapter: z.number().int(),
  result: z.record(z.unknown()),
  state: DemoStateSchema,
});

export type ActionResponse = z.infer<typeof ActionResponseSchema>;

export const SessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  sessionHeader: z.literal(DEMO_SESSION_HEADER),
  state: DemoStateSchema,
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    details: z.record(z.unknown()),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
