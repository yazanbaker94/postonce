import type { DemoAction, DemoState, Invoice, Payment } from "@postonce/contracts";

const DISCLAIMER = "Independent synthetic engineering case study. Not affiliated with Anchorbase, DealerTrack, any payment processor, bank, or dealership. No real payments or customer data.";

const ACTIONS: Array<{ action: Exclude<DemoAction, "run-all" | "resolve-exception">; label: string; summary: string }> = [
  { action: "process-routine", label: "Routine automation", summary: "Exact references match and post without manual work." },
  { action: "deliver-duplicate", label: "Duplicate event", summary: "Two deliveries produce one financial mutation." },
  { action: "simulate-lost-response", label: "Lost response", summary: "A committed posting is retrieved safely with the same key." },
  { action: "open-ambiguous-exception", label: "Ambiguous allocation", summary: "Uncertain work is escalated instead of guessed." },
  { action: "simulate-resolution-race", label: "Concurrent decision", summary: "One controller wins; the stale write is rejected." },
  { action: "reconcile-settlement", label: "Settlement close", summary: "The bank deposit reconciles before close." },
];

function at(base: Date, seconds: number): string {
  return new Date(base.getTime() + seconds * 1_000).toISOString();
}

function invoice(
  id: string,
  rooftopId: string,
  repairOrderNumber: string,
  customerLabel: string,
  amountCents: number,
  openedAt: string,
): Invoice {
  return {
    id,
    rooftopId,
    repairOrderNumber,
    customerLabel,
    amountCents,
    balanceCents: amountCents,
    currency: "CAD",
    status: "OPEN",
    openedAt,
  };
}

function payment(
  id: string,
  rooftopId: string,
  externalEventId: string,
  customerLabel: string,
  amountCents: number,
  reference: string | null,
  receivedAt: string,
  kind: "CAPTURE" | "REFUND" = "CAPTURE",
): Payment {
  return {
    id,
    rooftopId,
    provider: "northstar",
    externalEventId,
    customerLabel,
    amountCents,
    currency: "CAD",
    kind,
    status: "RECEIVED",
    reference,
    receivedAt,
  };
}

export function createSeedState(sessionId: string, now = new Date()): DemoState {
  const base = new Date(now);
  const createdAt = base.toISOString();
  const processorFeeCents = 14_526;
  const bankDepositCents = 502_924;
  const rooftops = [
    { id: "roof_central", code: "NMG-01", name: "Northline Central", city: "Calgary" },
    { id: "roof_north", code: "NMG-02", name: "Northline North", city: "Calgary" },
  ];

  const invoices: Invoice[] = [
    invoice("inv_8001", "roof_central", "RO-8001", "Customer •4821", 45_900, at(base, -4_100)),
    invoice("inv_8002", "roof_north", "RO-8002", "Customer •1974", 73_250, at(base, -3_900)),
    invoice("inv_8003", "roof_central", "RO-8003", "Customer •7310", 12_800, at(base, -3_600)),
    invoice("inv_8004", "roof_central", "RO-8004", "Customer •2208", 109_900, at(base, -3_300)),
    invoice("inv_8005", "roof_north", "RO-8005", "Customer •5630", 68_400, at(base, -3_000)),
    invoice("inv_8006", "roof_central", "RO-8006", "Customer •1142", 52_300, at(base, -2_700)),
    invoice("inv_8007", "roof_north", "RO-8007", "Customer •9091", 31_500, at(base, -2_400)),
    invoice("inv_8008", "roof_central", "RO-8008", "Customer •6620", 46_800, at(base, -2_100)),
    invoice("inv_8031", "roof_central", "RO-8031", "Customer •5004", 49_500, at(base, -1_800)),
    invoice("inv_8037", "roof_central", "RO-8037", "Customer •5004", 49_500, at(base, -1_760)),
    invoice("inv_8010", "roof_north", "RO-8010", "Customer •0418", 18_200, at(base, -1_500)),
    invoice("inv_8011", "roof_north", "RO-8011", "Customer •8133", 21_400, at(base, -1_200)),
  ];

  const payments: Payment[] = [
    payment("pay_1001", "roof_central", "evt_ns_1001", "Customer •4821", 45_900, "RO-8001", at(base, -800)),
    payment("pay_1002", "roof_north", "evt_ns_1002", "Customer •1974", 73_250, "RO-8002", at(base, -760)),
    payment("pay_1003", "roof_central", "evt_ns_1003", "Customer •7310", 12_800, "RO-8003", at(base, -720)),
    payment("pay_1004", "roof_central", "evt_ns_1004", "Customer •2208", 109_900, "RO-8004", at(base, -680)),
    payment("pay_1005", "roof_north", "evt_ns_1005", "Customer •5630", 68_400, "RO-8005", at(base, -640)),
    payment("pay_1006", "roof_central", "evt_ns_1006", "Customer •1142", 52_300, "RO-8006", at(base, -600)),
    payment("pay_1007", "roof_north", "evt_ns_1007", "Customer •9091", 31_500, "RO-8007", at(base, -560)),
    payment("pay_1008", "roof_central", "evt_ns_1008", "Customer •6620", 46_800, "RO-8008", at(base, -520)),
    payment("pay_1009", "roof_central", "evt_ns_1009", "Customer •5004", 49_500, null, at(base, -480)),
    payment("pay_1010", "roof_north", "evt_ns_1010", "Customer •0418", 18_200, "RO-8010", at(base, -440)),
    payment("pay_1011", "roof_north", "evt_ns_1011", "Customer •8133", 21_400, "RO-8011", at(base, -400)),
    payment("pay_1012", "roof_central", "evt_ns_1012", "Customer •2208", 12_500, "RO-8004", at(base, -360), "REFUND"),
  ];

  return {
    metadata: {
      title: "PostOnce",
      scenario: "Friday 4:55 PM Close",
      organization: "Northline Motor Group",
      disclaimer: DISCLAIMER,
      generatedAt: createdAt,
    },
    session: {
      id: sessionId,
      createdAt,
      resetAt: createdAt,
      version: 0,
    },
    currentChapter: 0,
    close: {
      status: "PROCESSING",
      blockingExceptionCount: 0,
      lastEvaluatedAt: createdAt,
    },
    totals: {
      currency: "CAD",
      grossCents: 529_950,
      feeCents: processorFeeCents,
      refundCents: 12_500,
      expectedDepositCents: 502_924,
      bankDepositCents: 0,
      varianceCents: 502_924,
    },
    settlementEvidence: {
      processorFee: {
        id: "fee_northstar_20260830_001",
        system: "NORTHSTAR_PROCESSOR",
        component: "PROCESSOR_FEE",
        externalEventId: "settlement_northstar_20260830_001",
        amountCents: processorFeeCents,
        currency: "CAD",
        receivedAt: at(base, -300),
      },
      bankDeposit: {
        id: "deposit_prairie_20260830_001",
        system: "PRAIRIE_BANK",
        component: "BANK_DEPOSIT",
        externalEventId: "bank_dep_20260830_001",
        amountCents: bankDepositCents,
        currency: "CAD",
        receivedAt: at(base, -60),
      },
    },
    rooftops,
    invoices,
    payments,
    allocations: [],
    exceptions: [],
    integrationAttempts: [],
    inbox: [],
    outbox: [],
    auditEvents: [
      {
        id: "audit_0001",
        sequence: 1,
        type: "DEMO_SESSION_CREATED",
        entityType: "session",
        entityId: sessionId,
        actor: "system",
        occurredAt: createdAt,
        correlationId: `corr_${sessionId.slice(0, 8)}_start`,
        summary: "A private synthetic close workspace was created.",
        details: { paymentEvents: 12, rooftops: 2, realMoney: false },
      },
    ],
    chapters: [
      { number: 0, key: "start", label: "Start of close", status: "ACTIVE", summary: "Twelve events across two fictional rooftops are ready to process." },
      ...ACTIONS.map((chapter, index) => ({
        number: index + 1,
        key: chapter.action,
        label: chapter.label,
        status: "LOCKED" as const,
        summary: chapter.summary,
      })),
      { number: 7, key: "evidence", label: "Evidence", status: "LOCKED", summary: "Inspect the complete, sanitized correlation trace." },
    ],
    completedActions: [],
    invariants: {
      processorDeliveriesReceived: 0,
      uniqueProcessorEventsApplied: 0,
      duplicateDeliveriesIgnored: 0,
      dmsAttempts: 0,
      dmsMutations: 0,
      lostResponses: 0,
      retriesResolvedByLookup: 0,
      concurrentDecisions: 0,
      acceptedDecisions: 0,
      rejectedVersionConflicts: 0,
      outboxCreated: 0,
      outboxDelivered: 0,
    },
    evidence: {
      checks: [
        { id: "unique_event", label: "Unique processor event", status: "PENDING", value: "0 duplicates absorbed", explanation: "A provider event may be delivered repeatedly but mutates financial state once." },
        { id: "stable_key", label: "Stable DMS operation key", status: "PENDING", value: "Not exercised", explanation: "A retry checks the original operation key instead of posting again." },
        { id: "version_guard", label: "Optimistic version guard", status: "PENDING", value: "Not exercised", explanation: "A stale human decision is rejected with the winning state." },
        { id: "settlement", label: "Settlement equation", status: "PENDING", value: "$0.00 received", explanation: "Gross minus fees and refunds must equal the bank deposit." },
      ],
      benchmark: {
        datasetSize: 50_000,
        indexedLookupComplexity: "O(1) expected",
        sequentialScanComplexity: "O(n)",
        indexedLookupMicros: 0.42,
        sequentialScanMicros: 412.8,
        generatedFrom: "deterministic synthetic fixture",
      },
      race: {
        attempted: false,
        winner: null,
        loser: null,
        acceptedStatus: null,
        rejectedStatus: null,
        winningVersion: null,
      },
    },
  };
}
