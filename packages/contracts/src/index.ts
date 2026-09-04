import { z } from "zod";

export const DEMO_SESSION_HEADER = "X-Demo-Session" as const;
export const WORKSPACE_BUSINESS_DATE = "2026-09-04" as const;
export const WORKSPACE_TIMEZONE = "America/Edmonton" as const;
export const WORKSPACE_AS_OF = "2026-09-04T22:55:00.000Z" as const;

const DateTimeSchema = z.string().datetime();
const BusinessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MoneyCentsSchema = z.number().int();

export const DepartmentSchema = z.enum(["SERVICE", "PARTS", "SALES"]);
export const PaymentStateSchema = z.enum(["CAPTURED", "PENDING", "FAILED", "VOIDED", "REFUNDED"]);
export const DmsStateSchema = z.enum(["UNMATCHED", "MATCHED", "POSTING", "VERIFIED", "NEEDS_REVIEW"]);
export const SettlementStatusSchema = z.enum(["NOT_YET_BATCHED", "PAYOUT_PENDING", "DEPOSIT_EXPECTED", "RECONCILED", "VARIANCE"]);
export const CloseStatusSchema = z.enum(["PROCESSING", "BLOCKED", "READY", "CLOSED"]);
export const ExceptionTypeSchema = z.enum([
  "UNMATCHED_PAYMENT",
  "AMBIGUOUS_MATCH",
  "SPLIT_ALLOCATION",
  "UNMATCHED_REFUND",
  "POSTING_STATUS_UNKNOWN",
]);
export const ExceptionStatusSchema = z.enum(["OPEN", "RESOLVED"]);

export const WorkspaceUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
  role: z.literal("GROUP_CONTROLLER"),
  roleLabel: z.literal("Group Controller"),
});

export const RooftopSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  city: z.string(),
  timezone: z.literal(WORKSPACE_TIMEZONE),
});

export const DmsRecordSchema = z.object({
  id: z.string(),
  rooftopId: z.string(),
  department: DepartmentSchema,
  recordType: z.enum(["REPAIR_ORDER", "PARTS_TICKET", "DEAL"]),
  recordNumber: z.string(),
  customerLabel: z.string(),
  vehicleLabel: z.string().nullable(),
  advisorLabel: z.string().nullable(),
  customerPayCents: z.number().int().nonnegative(),
  balanceCents: z.number().int().nonnegative(),
  currency: z.literal("CAD"),
  businessStatus: z.enum(["OPEN", "CLOSED"]),
  openedAt: DateTimeSchema,
  closedAt: DateTimeSchema.nullable(),
});

export const PaymentSchema = z.object({
  id: z.string(),
  rooftopId: z.string(),
  businessDate: BusinessDateSchema,
  department: DepartmentSchema,
  provider: z.literal("northstar"),
  externalEventId: z.string(),
  processorTransactionId: z.string(),
  customerLabel: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.literal("CAD"),
  kind: z.enum(["CAPTURE", "REFUND"]),
  methodType: z.enum(["VISA", "MASTERCARD", "AMEX", "DEBIT"]),
  cardLast4: z.string().regex(/^\d{4}$/),
  terminalLabel: z.string(),
  paymentState: PaymentStateSchema,
  dmsState: DmsStateSchema,
  settlementState: SettlementStatusSchema,
  sourceReference: z.string().nullable(),
  linkedRecordId: z.string().nullable(),
  receivedAt: DateTimeSchema,
  matchedAt: DateTimeSchema.nullable(),
  postedAt: DateTimeSchema.nullable(),
  verifiedAt: DateTimeSchema.nullable(),
  postingOperationKey: z.string().nullable(),
  inFridayClose: z.boolean(),
});

export const AllocationSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  dmsRecordId: z.string(),
  amountCents: z.number().int().positive(),
  source: z.enum(["EXACT_REFERENCE", "HUMAN_RESOLUTION"]),
  operationKey: z.string(),
  createdAt: DateTimeSchema,
});

export const RefundLinkSchema = z.object({
  id: z.string(),
  refundPaymentId: z.string(),
  originalPaymentId: z.string(),
  dmsRecordId: z.string(),
  operationKey: z.string(),
  actor: z.string(),
  createdAt: DateTimeSchema,
});

export const CandidateEvidenceSchema = z.object({
  label: z.string(),
  value: z.string(),
  tone: z.enum(["MATCH", "DIFFERENCE", "CONTEXT"]),
});

export const ExceptionCandidateSchema = z.object({
  id: z.string(),
  targetType: z.enum(["DMS_RECORD", "ORIGINAL_PAYMENT"]),
  targetId: z.string(),
  recordNumber: z.string(),
  customerLabel: z.string(),
  amountCents: z.number().int().nonnegative(),
  department: DepartmentSchema,
  vehicleLabel: z.string().nullable(),
  advisorLabel: z.string().nullable(),
  statusLabel: z.string(),
  occurredAt: DateTimeSchema,
  recommendation: z.enum(["STRONG_MATCH", "POSSIBLE_MATCH"]),
  evidence: z.array(CandidateEvidenceSchema),
});

export const ExceptionResolutionSchema = z.object({
  action: z.enum(["APPLY_TO_RECORD", "LINK_REFUND", "ATTACH_SPLIT"]),
  targetId: z.string(),
  targetLabel: z.string(),
  amountCents: z.number().int().positive(),
  actor: z.string(),
  reason: z.string(),
  operationKey: z.string(),
  resolvedAt: DateTimeSchema,
});

export const ExceptionSchema = z.object({
  id: z.string(),
  rooftopId: z.string(),
  department: DepartmentSchema,
  paymentId: z.string(),
  type: ExceptionTypeSchema,
  severity: z.enum(["BLOCKING", "REVIEW"]),
  status: ExceptionStatusSchema,
  version: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  openedAt: DateTimeSchema,
  candidates: z.array(ExceptionCandidateSchema),
  suggestedCandidateId: z.string().nullable(),
  suggestion: z.string().nullable(),
  resolution: ExceptionResolutionSchema.nullable(),
});

export const InboxReceiptSchema = z.object({
  provider: z.literal("northstar"),
  externalEventId: z.string(),
  firstSeenAt: DateTimeSchema,
  deliveryCount: z.number().int().positive(),
});

export const OutboxItemSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  dmsRecordId: z.string(),
  operationKey: z.string(),
  mutationKind: z.enum(["PAYMENT_POST", "REFUND_LINK"]),
  destination: z.literal("LEGACY_DMS"),
  status: z.enum(["PENDING", "DELIVERED"]),
  attemptCount: z.number().int().nonnegative(),
  createdAt: DateTimeSchema,
  deliveredAt: DateTimeSchema.nullable(),
});

export const IntegrationAttemptSchema = z.object({
  id: z.string(),
  system: z.enum(["NORTHSTAR_PROCESSOR", "LEGACY_DMS", "PRAIRIE_BANK"]),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  operation: z.string(),
  externalEventId: z.string().nullable(),
  operationKey: z.string(),
  correlationId: z.string(),
  status: z.enum(["ACCEPTED", "DUPLICATE", "COMMITTED", "RESPONSE_LOST", "FOUND_EXISTING", "RECONCILED", "REJECTED"]),
  httpStatus: z.number().int().nullable(),
  attempt: z.number().int().positive(),
  occurredAt: DateTimeSchema,
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
  occurredAt: DateTimeSchema,
  correlationId: z.string(),
  summary: z.string(),
  details: z.record(z.unknown()),
});

export const CloseAttestationSchema = z.object({
  paymentCount: z.number().int().nonnegative(),
  verifiedPostingCount: z.number().int().nonnegative(),
  blockingExceptionCount: z.number().int().nonnegative(),
  settlementStatusAtClose: SettlementStatusSchema,
});

export const OperationalCloseSchema = z.object({
  id: z.string(),
  rooftopId: z.string(),
  businessDate: BusinessDateSchema,
  paymentCount: z.number().int().nonnegative(),
  verifiedPostingCount: z.number().int().nonnegative(),
  blockingExceptionCount: z.number().int().nonnegative(),
  settlementStatus: SettlementStatusSchema,
  status: CloseStatusSchema,
  version: z.number().int().positive(),
  closedBy: z.string().nullable(),
  closedAt: DateTimeSchema.nullable(),
  attestation: CloseAttestationSchema.nullable(),
});

export const PayoutSourceRecordSchema = z.object({
  id: z.string(),
  payoutId: z.string(),
  sourceSystem: z.enum(["NORTHSTAR_PROCESSOR", "PRAIRIE_BANK"]),
  component: z.enum(["PROCESSOR_SETTLEMENT", "BANK_DEPOSIT", "NETWORK_ASSESSMENT_NOTICE"]),
  externalEventId: z.string(),
  amountCents: MoneyCentsSchema,
  currency: z.literal("CAD"),
  receivedAt: DateTimeSchema,
  description: z.string(),
});

export const ProcessorPayoutSchema = z.object({
  id: z.string(),
  rooftopId: z.string(),
  payoutDate: BusinessDateSchema,
  externalPayoutId: z.string().nullable(),
  currency: z.literal("CAD"),
  capturedCents: z.number().int().nonnegative().nullable(),
  refundCents: z.number().int().nonnegative().nullable(),
  feeCents: z.number().int().nonnegative().nullable(),
  originalExpectedCents: MoneyCentsSchema.nullable(),
  adjustedExpectedCents: MoneyCentsSchema.nullable(),
  observedBankCents: MoneyCentsSchema.nullable(),
  varianceCents: MoneyCentsSchema.nullable(),
  status: SettlementStatusSchema,
  sourceRecordIds: z.array(z.string()),
  reconciledBy: z.string().nullable(),
  reconciledAt: DateTimeSchema.nullable(),
  version: z.number().int().positive(),
});

export const SettlementAdjustmentSchema = z.object({
  id: z.string(),
  payoutId: z.string(),
  amountCents: MoneyCentsSchema,
  code: z.literal("NETWORK_ASSESSMENT"),
  reason: z.string(),
  evidenceRecordId: z.string(),
  note: z.string().nullable(),
  actor: z.string(),
  operationKey: z.string(),
  createdAt: DateTimeSchema,
});

export const IntegrationConnectionSchema = z.object({
  id: z.enum(["legacy-dms", "northstar-processor", "prairie-bank"]),
  name: z.string(),
  status: z.literal("CONNECTED"),
  simulated: z.literal(true),
  lastSuccessfulAt: DateTimeSchema,
  description: z.string(),
});

export const CommandReceiptSchema = z.object({
  idempotencyKey: z.string(),
  scope: z.string(),
  fingerprint: z.string(),
  result: z.record(z.unknown()),
  createdAt: DateTimeSchema,
});

export const WorkspaceStateSchema = z.object({
  metadata: z.object({
    title: z.literal("PostOnce"),
    organization: z.literal("Northline Motor Group"),
    disclaimer: z.string(),
    businessDate: z.literal(WORKSPACE_BUSINESS_DATE),
    workspaceAsOf: z.literal(WORKSPACE_AS_OF),
    timezone: z.literal(WORKSPACE_TIMEZONE),
    currency: z.literal("CAD"),
    generatedAt: DateTimeSchema,
  }),
  user: WorkspaceUserSchema,
  session: z.object({
    id: z.string().uuid(),
    createdAt: DateTimeSchema,
    resetAt: DateTimeSchema,
    version: z.number().int().nonnegative(),
  }),
  rooftops: z.array(RooftopSchema),
  dmsRecords: z.array(DmsRecordSchema),
  payments: z.array(PaymentSchema),
  allocations: z.array(AllocationSchema),
  refundLinks: z.array(RefundLinkSchema),
  exceptions: z.array(ExceptionSchema),
  inbox: z.array(InboxReceiptSchema),
  outbox: z.array(OutboxItemSchema),
  integrationAttempts: z.array(IntegrationAttemptSchema),
  auditEvents: z.array(AuditEventSchema),
  operationalCloses: z.array(OperationalCloseSchema),
  payouts: z.array(ProcessorPayoutSchema),
  payoutSourceRecords: z.array(PayoutSourceRecordSchema),
  settlementAdjustments: z.array(SettlementAdjustmentSchema),
  integrations: z.array(IntegrationConnectionSchema),
  commandReceipts: z.array(CommandReceiptSchema),
  invariants: z.object({
    processorDeliveriesReceived: z.number().int().nonnegative(),
    uniqueProcessorEventsApplied: z.number().int().nonnegative(),
    duplicateDeliveriesIgnored: z.number().int().nonnegative(),
    dmsAttempts: z.number().int().nonnegative(),
    dmsMutations: z.number().int().nonnegative(),
    lostResponses: z.number().int().nonnegative(),
    retriesResolvedByLookup: z.number().int().nonnegative(),
    acceptedDecisions: z.number().int().nonnegative(),
    rejectedVersionConflicts: z.number().int().nonnegative(),
    outboxCreated: z.number().int().nonnegative(),
    outboxDelivered: z.number().int().nonnegative(),
  }),
});

export const ResolveExceptionRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(120),
  targetId: z.string().trim().min(1).max(120),
}).strict();

export const CloseLocationRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export const SettlementAdjustmentRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(120),
  amountCents: z.literal(-2500),
  code: z.literal("NETWORK_ASSESSMENT"),
  evidenceRecordId: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500).optional(),
}).strict();

export type Department = z.infer<typeof DepartmentSchema>;
export type Rooftop = z.infer<typeof RooftopSchema>;
export type DmsRecord = z.infer<typeof DmsRecordSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type Allocation = z.infer<typeof AllocationSchema>;
export type RefundLink = z.infer<typeof RefundLinkSchema>;
export type DemoException = z.infer<typeof ExceptionSchema>;
export type InboxReceipt = z.infer<typeof InboxReceiptSchema>;
export type OutboxItem = z.infer<typeof OutboxItemSchema>;
export type IntegrationAttempt = z.infer<typeof IntegrationAttemptSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type OperationalClose = z.infer<typeof OperationalCloseSchema>;
export type ProcessorPayout = z.infer<typeof ProcessorPayoutSchema>;
export type PayoutSourceRecord = z.infer<typeof PayoutSourceRecordSchema>;
export type SettlementAdjustment = z.infer<typeof SettlementAdjustmentSchema>;
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;
export type DemoState = WorkspaceState;
export type ResolveExceptionRequest = z.infer<typeof ResolveExceptionRequestSchema>;
export type CloseLocationRequest = z.infer<typeof CloseLocationRequestSchema>;
export type SettlementAdjustmentRequest = z.infer<typeof SettlementAdjustmentRequestSchema>;

export const DemoStateSchema = WorkspaceStateSchema;

export const SessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  sessionHeader: z.literal(DEMO_SESSION_HEADER),
  state: WorkspaceStateSchema,
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const MutationResponseSchema = z.object({
  replayed: z.boolean(),
  result: z.record(z.unknown()),
  state: WorkspaceStateSchema,
});

export type MutationResponse = z.infer<typeof MutationResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    details: z.record(z.unknown()),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
