import {
  WORKSPACE_AS_OF,
  WORKSPACE_BUSINESS_DATE,
  WORKSPACE_TIMEZONE,
  type Allocation,
  type Department,
  type DmsRecord,
  type IntegrationAttempt,
  type OutboxItem,
  type Payment,
  type WorkspaceState,
} from "@postonce/contracts";

const DISCLAIMER = "Independent synthetic engineering case study. All organizations, transactions, integrations, and identities are fictional. No real payment data.";
const AS_OF = new Date(WORKSPACE_AS_OF);

const TOYOTA_AMOUNTS = [66_903, 78_219, 58_950, 70_267, 81_584, 45_900, 73_631, 84_948, 65_679, 76_996, 57_727, 69_044, 80_360, 61_091, 72_408, 83_725, 124_500, 75_773, 56_512];
const FORD_ROUTINE_AMOUNTS = [68_078, 79_712, 59_902, 71_537, 83_171, 63_361, 74_995, 86_630, 66_820, 78_454, 58_645, 70_279, 81_913, 155_000, 73_738, 85_372, 65_562, 77_197, 57_387, 69_021, 80_655, 60_846, 72_480, 84_125];
const SUBARU_AMOUNTS = [66_631, 77_875, 58_730, 69_974, 81_218, 62_073, 73_317, 84_560, 65_416, 76_660, 57_515, 68_759, 80_002, 60_858, 72_101, 83_353];

const NAMES = [
  "Amelia Brooks", "Noah Bennett", "Sofia Martin", "Ethan Parker", "Mila Thompson", "Emma Wilson",
  "Lucas Stewart", "Ava Campbell", "Oliver Murphy", "Nora Adams", "Liam Cooper", "Chloe Reed",
  "Mason Bailey", "Layla Foster", "Henry Collins", "Grace Turner", "Riley Chen", "Jack Sullivan",
  "Maya Edwards", "Leo Richardson", "Zoe Mitchell", "Caleb Morgan", "Ivy Peterson", "Owen Hughes",
  "Ella Ward", "Isaac Ross", "Ruby Price", "Julian Bell", "Mia Sanders", "Theo Russell",
];

const METHODS = ["VISA", "MASTERCARD", "DEBIT", "VISA", "AMEX"] as const;

function iso(secondsFromAsOf: number): string {
  return new Date(AS_OF.getTime() + secondsFromAsOf * 1_000).toISOString();
}

function departmentFor(location: "NLT" | "NLF" | "NLS", position: number): Department {
  if (location === "NLT") {
    if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 17, 18].includes(position)) return "SERVICE";
    if ([10, 11, 12, 13, 14].includes(position)) return "PARTS";
    return "SALES";
  }
  if (location === "NLF") {
    if (position <= 14) return "SERVICE";
    if (position <= 19) return "PARTS";
    return "SALES";
  }
  if (position <= 9) return "SERVICE";
  if (position <= 13) return "PARTS";
  return "SALES";
}

function recordNumber(location: "NLT" | "NLF" | "NLS", department: Department, position: number): string {
  const offset = location === "NLT" ? 7900 : location === "NLF" ? 8100 : 8200;
  if (department === "SERVICE") return `RO-${offset + position}`;
  if (department === "PARTS") return `P-${18_000 + offset - 7_800 + position}`;
  return `D-${6_000 + offset - 7_800 + position}`;
}

function basePayment(input: {
  id: string;
  rooftopId: string;
  department: Department;
  amountCents: number;
  customerLabel: string;
  receivedAt: string;
  sourceReference: string | null;
  cardLast4: string;
  methodType?: Payment["methodType"];
  terminalLabel?: string;
  kind?: Payment["kind"];
  businessDate?: string;
  inFridayClose?: boolean;
}): Payment {
  const kind = input.kind ?? "CAPTURE";
  const inFridayClose = input.inFridayClose ?? true;
  return {
    id: input.id,
    rooftopId: input.rooftopId,
    businessDate: input.businessDate ?? WORKSPACE_BUSINESS_DATE,
    department: input.department,
    provider: "northstar",
    externalEventId: `evt_${input.id.toLowerCase().replaceAll("-", "_")}`,
    processorTransactionId: `txn_${input.id.replaceAll("-", "")}`,
    customerLabel: input.customerLabel,
    amountCents: input.amountCents,
    currency: "CAD",
    kind,
    methodType: input.methodType ?? "VISA",
    cardLast4: input.cardLast4,
    terminalLabel: input.terminalLabel ?? "Terminal 02",
    paymentState: kind === "REFUND" ? "REFUNDED" : "CAPTURED",
    dmsState: inFridayClose ? "VERIFIED" : "VERIFIED",
    settlementState: inFridayClose ? "PAYOUT_PENDING" : "RECONCILED",
    sourceReference: input.sourceReference,
    linkedRecordId: null,
    receivedAt: input.receivedAt,
    matchedAt: null,
    postedAt: null,
    verifiedAt: null,
    postingOperationKey: null,
    inFridayClose,
  };
}

function baseRecord(input: {
  id: string;
  rooftopId: string;
  department: Department;
  recordNumber: string;
  customerLabel: string;
  customerPayCents: number;
  balanceCents: number;
  openedAt: string;
  businessStatus?: DmsRecord["businessStatus"];
  closedAt?: string | null;
  vehicleLabel?: string | null;
  advisorLabel?: string | null;
}): DmsRecord {
  return {
    id: input.id,
    rooftopId: input.rooftopId,
    department: input.department,
    recordType: input.department === "SERVICE" ? "REPAIR_ORDER" : input.department === "PARTS" ? "PARTS_TICKET" : "DEAL",
    recordNumber: input.recordNumber,
    customerLabel: input.customerLabel,
    vehicleLabel: input.vehicleLabel ?? null,
    advisorLabel: input.advisorLabel ?? null,
    customerPayCents: input.customerPayCents,
    balanceCents: input.balanceCents,
    currency: "CAD",
    businessStatus: input.businessStatus ?? "CLOSED",
    openedAt: input.openedAt,
    closedAt: input.closedAt ?? iso(-7_200),
  };
}

function routineLocation(
  location: "NLT" | "NLF" | "NLS",
  rooftopId: string,
  idStart: number,
  amounts: number[],
  timeStartSeconds: number,
): { payments: Payment[]; records: DmsRecord[] } {
  const payments: Payment[] = [];
  const records: DmsRecord[] = [];
  amounts.forEach((amountCents, index) => {
    const position = index + 1;
    const id = `PAY-${idStart + index}`;
    const department = departmentFor(location, position);
    const customerLabel = NAMES[(idStart + index) % NAMES.length]!;
    const number = recordNumber(location, department, position);
    const recordId = `rec_${id.toLowerCase().replaceAll("-", "_")}`;
    const receivedAt = iso(timeStartSeconds + index * 900);
    const payment = basePayment({
      id,
      rooftopId,
      department,
      amountCents,
      customerLabel,
      receivedAt,
      sourceReference: number,
      cardLast4: String(1200 + ((idStart + index) * 73) % 8_700).padStart(4, "0"),
      methodType: METHODS[index % METHODS.length]!,
      terminalLabel: `Terminal ${String((index % 5) + 1).padStart(2, "0")}`,
    });
    const record = baseRecord({
      id: recordId,
      rooftopId,
      department,
      recordNumber: number,
      customerLabel,
      customerPayCents: amountCents,
      balanceCents: 0,
      openedAt: iso(timeStartSeconds - 10_800 + index * 600),
    });
    payment.linkedRecordId = record.id;
    payments.push(payment);
    records.push(record);
  });
  return { payments, records };
}

function finalizeRoutine(
  payments: Payment[],
  records: DmsRecord[],
): { allocations: Allocation[]; outbox: OutboxItem[]; attempts: IntegrationAttempt[] } {
  const allocations: Allocation[] = [];
  const outbox: OutboxItem[] = [];
  const attempts: IntegrationAttempt[] = [];
  for (const payment of payments) {
    const record = records.find((item) => item.id === payment.linkedRecordId);
    if (!record) throw new Error(`Missing routine record for ${payment.id}`);
    const operationKey = `op_${payment.rooftopId}_${payment.id.toLowerCase().replaceAll("-", "_")}`;
    const matchedAt = new Date(new Date(payment.receivedAt).getTime() + 250).toISOString();
    const postedAt = new Date(new Date(payment.receivedAt).getTime() + 900).toISOString();
    const verifiedAt = new Date(new Date(payment.receivedAt).getTime() + 1_550).toISOString();
    payment.matchedAt = matchedAt;
    payment.postedAt = postedAt;
    payment.verifiedAt = verifiedAt;
    payment.postingOperationKey = operationKey;
    allocations.push({
      id: `alloc_${payment.id.toLowerCase().replaceAll("-", "_")}`,
      paymentId: payment.id,
      dmsRecordId: record.id,
      amountCents: payment.amountCents,
      source: "EXACT_REFERENCE",
      operationKey,
      createdAt: matchedAt,
    });
    const lostResponse = payment.id === "PAY-1017";
    outbox.push({
      id: `out_${payment.id.toLowerCase().replaceAll("-", "_")}`,
      paymentId: payment.id,
      dmsRecordId: record.id,
      operationKey,
      mutationKind: "PAYMENT_POST",
      destination: "LEGACY_DMS",
      status: "DELIVERED",
      attemptCount: lostResponse ? 2 : 1,
      createdAt: matchedAt,
      deliveredAt: verifiedAt,
    });
    const attemptBase = attempts.length;
    attempts.push({
      id: `try_dms_${String(attemptBase + 1).padStart(4, "0")}`,
      system: "LEGACY_DMS",
      direction: "OUTBOUND",
      operation: "POST /cash-receipts",
      externalEventId: payment.externalEventId,
      operationKey,
      correlationId: `corr_${payment.id.toLowerCase().replaceAll("-", "_")}`,
      status: lostResponse ? "RESPONSE_LOST" : "COMMITTED",
      httpStatus: lostResponse ? null : 201,
      attempt: 1,
      occurredAt: postedAt,
      note: lostResponse ? "The dealership-system write committed; its HTTP response was lost." : "The dealership system accepted one payment posting.",
      sanitizedRequest: { recordNumber: record.recordNumber, amountCents: payment.amountCents, operationKey },
      sanitizedResponse: { postingId: `DMS-${payment.id}`, committed: true },
    });
    if (lostResponse) {
      attempts.push({
        id: `try_dms_${String(attemptBase + 2).padStart(4, "0")}`,
        system: "LEGACY_DMS",
        direction: "OUTBOUND",
        operation: "GET /cash-receipts/:operationKey",
        externalEventId: payment.externalEventId,
        operationKey,
        correlationId: `corr_${payment.id.toLowerCase().replaceAll("-", "_")}`,
        status: "FOUND_EXISTING",
        httpStatus: 200,
        attempt: 2,
        occurredAt: verifiedAt,
        note: "Recovery reused the same operation key and found the existing posting.",
        sanitizedRequest: { operationKey },
        sanitizedResponse: { postingId: `DMS-${payment.id}`, existing: true, financialMutations: 1 },
      });
    }
  }
  return { allocations, outbox, attempts };
}

export function createSeedState(sessionId: string, now = new Date()): WorkspaceState {
  const createdAt = now.toISOString();
  const toyota = routineLocation("NLT", "roof_nlt", 1001, TOYOTA_AMOUNTS, -28_800);
  const ford = routineLocation("NLF", "roof_nlf", 2001, FORD_ROUTINE_AMOUNTS, -27_000);
  const subaru = routineLocation("NLS", "roof_nls", 3001, SUBARU_AMOUNTS, -25_200);

  const pay1006 = toyota.payments.find((item) => item.id === "PAY-1006")!;
  pay1006.customerLabel = "Emma Wilson";
  pay1006.processorTransactionId = "txn_6DUP459";
  const rec1006 = toyota.records.find((item) => item.id === pay1006.linkedRecordId)!;
  rec1006.customerLabel = pay1006.customerLabel;

  const pay1017 = toyota.payments.find((item) => item.id === "PAY-1017")!;
  pay1017.customerLabel = "Riley Chen";
  pay1017.department = "SERVICE";
  pay1017.methodType = "VISA";
  pay1017.cardLast4 = "9012";
  pay1017.terminalLabel = "Terminal 02";
  pay1017.processorTransactionId = "txn_7T2X9";
  pay1017.receivedAt = "2026-09-04T22:37:14.000Z";
  const rec1017 = toyota.records.find((item) => item.id === pay1017.linkedRecordId)!;
  rec1017.customerLabel = pay1017.customerLabel;
  rec1017.department = "SERVICE";
  rec1017.recordType = "REPAIR_ORDER";
  rec1017.recordNumber = "RO-7921";
  pay1017.sourceReference = rec1017.recordNumber;

  const splitExisting = ford.payments.find((item) => item.id === "PAY-2014")!;
  const splitRecord = ford.records.find((item) => item.id === splitExisting.linkedRecordId)!;
  splitExisting.customerLabel = "Riley Morgan";
  splitExisting.methodType = "VISA";
  splitExisting.cardLast4 = "9012";
  splitExisting.receivedAt = "2026-09-04T22:01:00.000Z";
  splitExisting.sourceReference = "RO-8018";
  splitRecord.id = "rec_ro_8018";
  splitRecord.recordNumber = "RO-8018";
  splitRecord.customerLabel = "Riley Morgan";
  splitRecord.customerPayCents = 400_000;
  splitRecord.balanceCents = 245_000;
  splitRecord.vehicleLabel = "2021 Ford Bronco";
  splitRecord.advisorLabel = "S. Lewis";
  splitExisting.linkedRecordId = splitRecord.id;

  const routinePayments = [...toyota.payments, ...ford.payments, ...subaru.payments];
  const routineRecords = [...toyota.records, ...ford.records, ...subaru.records];
  const routine = finalizeRoutine(routinePayments, routineRecords);

  const ex104Payment = basePayment({
    id: "PAY-104", rooftopId: "roof_nlf", department: "SERVICE", amountCents: 112_500,
    customerLabel: "Daniel Harper", receivedAt: "2026-09-04T22:37:00.000Z", sourceReference: null,
    cardLast4: "4242", methodType: "VISA", terminalLabel: "Terminal 04",
  });
  ex104Payment.dmsState = "NEEDS_REVIEW";
  ex104Payment.processorTransactionId = "txn_84K1F";

  const ex105Payment = basePayment({
    id: "PAY-105", rooftopId: "roof_nlf", department: "PARTS", amountCents: 21_900,
    customerLabel: "Morgan Brooks", receivedAt: "2026-09-04T22:18:00.000Z", sourceReference: null,
    cardLast4: "1148", methodType: "VISA", terminalLabel: "Terminal 03", kind: "REFUND",
  });
  ex105Payment.dmsState = "NEEDS_REVIEW";
  ex105Payment.processorTransactionId = "txn_RF219M";

  const ex106Payment = basePayment({
    id: "PAY-106", rooftopId: "roof_nlf", department: "SERVICE", amountCents: 245_000,
    customerLabel: "Riley Morgan", receivedAt: "2026-09-04T22:09:00.000Z", sourceReference: null,
    cardLast4: "6621", methodType: "MASTERCARD", terminalLabel: "Terminal 04",
  });
  ex106Payment.dmsState = "NEEDS_REVIEW";
  ex106Payment.processorTransactionId = "txn_ST2450";

  const ro8004 = baseRecord({
    id: "rec_ro_8004", rooftopId: "roof_nlf", department: "SERVICE", recordNumber: "RO-8004",
    customerLabel: "Daniel Harper", customerPayCents: 112_500, balanceCents: 112_500,
    openedAt: "2026-09-04T14:14:00.000Z", businessStatus: "CLOSED", closedAt: "2026-09-04T22:31:00.000Z",
    vehicleLabel: "2022 Ford F-150", advisorLabel: "J. Patel",
  });
  const ro8031 = baseRecord({
    id: "rec_ro_8031", rooftopId: "roof_nlf", department: "SERVICE", recordNumber: "RO-8031",
    customerLabel: "Daniel Harper", customerPayCents: 110_000, balanceCents: 110_000,
    openedAt: "2026-09-04T15:12:00.000Z", businessStatus: "OPEN", closedAt: null,
    vehicleLabel: "2020 Ford Escape", advisorLabel: "A. Ross",
  });
  const parts18401 = baseRecord({
    id: "rec_p_18401", rooftopId: "roof_nlf", department: "PARTS", recordNumber: "P-18401",
    customerLabel: "Morgan Brooks", customerPayCents: 21_900, balanceCents: 0,
    openedAt: "2026-04-03T16:10:00.000Z", businessStatus: "CLOSED", closedAt: "2026-04-03T18:22:00.000Z",
  });
  const parts18372 = baseRecord({
    id: "rec_p_18372", rooftopId: "roof_nlf", department: "PARTS", recordNumber: "P-18372",
    customerLabel: "Morgan Brooks", customerPayCents: 47_850, balanceCents: 0,
    openedAt: "2026-04-02T15:45:00.000Z", businessStatus: "CLOSED", closedAt: "2026-04-02T20:04:00.000Z",
  });
  const historical18401 = basePayment({
    id: "PAY-H18401", rooftopId: "roof_nlf", department: "PARTS", amountCents: 21_900,
    customerLabel: "Morgan Brooks", receivedAt: "2026-04-03T18:20:00.000Z", sourceReference: "P-18401",
    cardLast4: "1148", businessDate: "2026-04-03", inFridayClose: false,
  });
  historical18401.linkedRecordId = parts18401.id;
  const historical18372 = basePayment({
    id: "PAY-H18372", rooftopId: "roof_nlf", department: "PARTS", amountCents: 47_850,
    customerLabel: "Morgan Brooks", receivedAt: "2026-04-02T20:01:00.000Z", sourceReference: "P-18372",
    cardLast4: "1148", businessDate: "2026-04-02", inFridayClose: false,
  });
  historical18372.linkedRecordId = parts18372.id;

  const fridayPayments = [...routinePayments, ex104Payment, ex105Payment, ex106Payment];
  const inbox = fridayPayments.map((payment) => ({
    provider: "northstar" as const,
    externalEventId: payment.externalEventId,
    firstSeenAt: payment.receivedAt,
    deliveryCount: payment.id === "PAY-1006" ? 2 : 1,
  }));

  const processorAttempts: IntegrationAttempt[] = fridayPayments.flatMap((payment, index) => {
    const accepted: IntegrationAttempt = {
      id: `try_processor_${String(index * 2 + 1).padStart(4, "0")}`,
      system: "NORTHSTAR_PROCESSOR",
      direction: "INBOUND",
      operation: "payment-event",
      externalEventId: payment.externalEventId,
      operationKey: `inbox_${payment.externalEventId}`,
      correlationId: `corr_${payment.id.toLowerCase().replaceAll("-", "_")}`,
      status: "ACCEPTED",
      httpStatus: 202,
      attempt: 1,
      occurredAt: payment.receivedAt,
      note: "Processor event accepted once into the isolated workspace.",
      sanitizedRequest: { paymentId: payment.id, amountCents: payment.amountCents, kind: payment.kind },
      sanitizedResponse: { accepted: true },
    };
    if (payment.id !== "PAY-1006") return [accepted];
    return [accepted, {
      ...accepted,
      id: `try_processor_${String(index * 2 + 2).padStart(4, "0")}`,
      status: "DUPLICATE",
      attempt: 2,
      occurredAt: new Date(new Date(payment.receivedAt).getTime() + 600).toISOString(),
      note: "Duplicate processor delivery absorbed without another domain mutation.",
      sanitizedResponse: { accepted: false, duplicate: true },
    }];
  });

  const state: WorkspaceState = {
    metadata: {
      title: "PostOnce",
      organization: "Northline Motor Group",
      disclaimer: DISCLAIMER,
      businessDate: WORKSPACE_BUSINESS_DATE,
      workspaceAsOf: WORKSPACE_AS_OF,
      timezone: WORKSPACE_TIMEZONE,
      currency: "CAD",
      generatedAt: createdAt,
    },
    user: { id: "user_maya_chen", name: "Maya Chen", initials: "MC", role: "GROUP_CONTROLLER", roleLabel: "Group Controller" },
    session: { id: sessionId, createdAt, resetAt: createdAt, version: 0 },
    rooftops: [
      { id: "roof_nlt", code: "NLT", name: "Northline Toyota", city: "Calgary", timezone: WORKSPACE_TIMEZONE },
      { id: "roof_nlf", code: "NLF", name: "Northline Ford", city: "Calgary", timezone: WORKSPACE_TIMEZONE },
      { id: "roof_nls", code: "NLS", name: "Northline Subaru", city: "Calgary", timezone: WORKSPACE_TIMEZONE },
    ],
    dmsRecords: [...routineRecords, ro8004, ro8031, parts18401, parts18372],
    payments: [...fridayPayments, historical18401, historical18372],
    allocations: routine.allocations,
    refundLinks: [],
    exceptions: [
      {
        id: "EX-104", rooftopId: "roof_nlf", department: "SERVICE", paymentId: "PAY-104",
        type: "AMBIGUOUS_MATCH", severity: "BLOCKING", status: "OPEN", version: 1,
        title: "Ambiguous payment match",
        summary: "The payment has two plausible service repair orders and deterministic matching cannot safely choose one.",
        openedAt: ex104Payment.receivedAt,
        suggestedCandidateId: "candidate_ro_8004",
        suggestion: "Suggested: RO-8004 — exact amount, customer, location and timing align.",
        candidates: [
          {
            id: "candidate_ro_8004", targetType: "DMS_RECORD", targetId: ro8004.id, recordNumber: ro8004.recordNumber,
            customerLabel: ro8004.customerLabel, amountCents: ro8004.customerPayCents, department: ro8004.department,
            vehicleLabel: ro8004.vehicleLabel, advisorLabel: ro8004.advisorLabel, statusLabel: "Closed 4:31 PM",
            occurredAt: ro8004.closedAt!, recommendation: "STRONG_MATCH",
            evidence: [
              { label: "Amount", value: "$1,125.00 — exact", tone: "MATCH" },
              { label: "Customer", value: "Daniel Harper", tone: "MATCH" },
              { label: "Location", value: "Northline Ford", tone: "MATCH" },
              { label: "Department", value: "Service", tone: "MATCH" },
              { label: "Timing", value: "Closed six minutes before payment", tone: "MATCH" },
            ],
          },
          {
            id: "candidate_ro_8031", targetType: "DMS_RECORD", targetId: ro8031.id, recordNumber: ro8031.recordNumber,
            customerLabel: ro8031.customerLabel, amountCents: ro8031.customerPayCents, department: ro8031.department,
            vehicleLabel: ro8031.vehicleLabel, advisorLabel: ro8031.advisorLabel, statusLabel: "Open",
            occurredAt: ro8031.openedAt, recommendation: "POSSIBLE_MATCH",
            evidence: [
              { label: "Amount", value: "$1,100.00 — $25 difference", tone: "DIFFERENCE" },
              { label: "Customer", value: "Daniel Harper", tone: "MATCH" },
              { label: "Location", value: "Northline Ford", tone: "MATCH" },
              { label: "Department", value: "Service", tone: "MATCH" },
              { label: "Timing", value: "Repair order is still open", tone: "CONTEXT" },
            ],
          },
        ],
        resolution: null,
      },
      {
        id: "EX-105", rooftopId: "roof_nlf", department: "PARTS", paymentId: "PAY-105",
        type: "UNMATCHED_REFUND", severity: "BLOCKING", status: "OPEN", version: 1,
        title: "Refund needs original transaction",
        summary: "This refund has no verified link to its original payment.",
        openedAt: ex105Payment.receivedAt,
        suggestedCandidateId: "candidate_p_18401",
        suggestion: "Suggested: P-18401 — customer, department and exact amount align.",
        candidates: [
          {
            id: "candidate_p_18401", targetType: "ORIGINAL_PAYMENT", targetId: historical18401.id,
            recordNumber: "P-18401", customerLabel: "Morgan Brooks", amountCents: 21_900, department: "PARTS",
            vehicleLabel: null, advisorLabel: null, statusLabel: "Apr 3", occurredAt: historical18401.receivedAt,
            recommendation: "STRONG_MATCH",
            evidence: [
              { label: "Amount", value: "$219.00 — exact", tone: "MATCH" },
              { label: "Customer", value: "Morgan Brooks", tone: "MATCH" },
              { label: "Department", value: "Parts", tone: "MATCH" },
              { label: "Date", value: "Apr 3, 2026", tone: "CONTEXT" },
            ],
          },
          {
            id: "candidate_p_18372", targetType: "ORIGINAL_PAYMENT", targetId: historical18372.id,
            recordNumber: "P-18372", customerLabel: "Morgan Brooks", amountCents: 47_850, department: "PARTS",
            vehicleLabel: null, advisorLabel: null, statusLabel: "Apr 2", occurredAt: historical18372.receivedAt,
            recommendation: "POSSIBLE_MATCH",
            evidence: [
              { label: "Amount", value: "$478.50 — not exact", tone: "DIFFERENCE" },
              { label: "Customer", value: "Morgan Brooks", tone: "MATCH" },
              { label: "Department", value: "Parts", tone: "MATCH" },
              { label: "Date", value: "Apr 2, 2026", tone: "CONTEXT" },
            ],
          },
        ],
        resolution: null,
      },
      {
        id: "EX-106", rooftopId: "roof_nlf", department: "SERVICE", paymentId: "PAY-106",
        type: "SPLIT_ALLOCATION", severity: "BLOCKING", status: "OPEN", version: 1,
        title: "Likely second half of split tender",
        summary: "An existing $1,550 payment plus this $2,450 payment equals the $4,000 customer-pay total.",
        openedAt: ex106Payment.receivedAt,
        suggestedCandidateId: "candidate_ro_8018",
        suggestion: "Suggested: RO-8018 — the two tenders exactly cover the customer-pay total.",
        candidates: [{
          id: "candidate_ro_8018", targetType: "DMS_RECORD", targetId: splitRecord.id, recordNumber: "RO-8018",
          customerLabel: "Riley Morgan", amountCents: 400_000, department: "SERVICE",
          vehicleLabel: splitRecord.vehicleLabel, advisorLabel: splitRecord.advisorLabel,
          statusLabel: "$2,450 remaining", occurredAt: splitExisting.receivedAt, recommendation: "STRONG_MATCH",
          evidence: [
            { label: "Existing payment", value: "Visa •••• 9012 — $1,550.00 at 4:01 PM", tone: "CONTEXT" },
            { label: "New payment", value: "Mastercard •••• 6621 — $2,450.00 at 4:09 PM", tone: "CONTEXT" },
            { label: "Customer-pay total", value: "$4,000.00 — exact combined amount", tone: "MATCH" },
            { label: "Customer", value: "Riley Morgan", tone: "MATCH" },
          ],
        }],
        resolution: null,
      },
    ],
    inbox,
    outbox: routine.outbox,
    integrationAttempts: [...processorAttempts, ...routine.attempts],
    auditEvents: [
      { id: "audit_0001", sequence: 1, type: "ROUTINE_AUTOMATION_COMPLETED", entityType: "workspace", entityId: sessionId, actor: "System", occurredAt: iso(-1_080), correlationId: "corr_workspace_seed", summary: "Completed routine posting for 59 Friday payments", details: { verifiedPostings: 59 } },
      { id: "audit_0002", sequence: 2, type: "DUPLICATE_DELIVERY_ABSORBED", entityType: "payment", entityId: "PAY-1006", actor: "System", occurredAt: "2026-09-04T22:39:00.000Z", correlationId: "corr_pay_1006", summary: "Absorbed a duplicate processor delivery for PAY-1006", details: { deliveries: 2, mutations: 1 } },
      { id: "audit_0003", sequence: 3, type: "DMS_RESPONSE_RECOVERED", entityType: "payment", entityId: "PAY-1017", actor: "System", occurredAt: "2026-09-04T22:48:00.000Z", correlationId: "corr_pay_1017", summary: "Recovered an uncertain dealership-system response for PAY-1017", details: { operationKey: pay1017.postingOperationKey, financialMutations: 1 } },
    ],
    operationalCloses: [
      { id: "close_nlt_20260904", rooftopId: "roof_nlt", businessDate: WORKSPACE_BUSINESS_DATE, paymentCount: 19, verifiedPostingCount: 19, blockingExceptionCount: 0, settlementStatus: "PAYOUT_PENDING", status: "READY", version: 1, closedBy: null, closedAt: null, attestation: null },
      { id: "close_nlf_20260904", rooftopId: "roof_nlf", businessDate: WORKSPACE_BUSINESS_DATE, paymentCount: 27, verifiedPostingCount: 24, blockingExceptionCount: 3, settlementStatus: "PAYOUT_PENDING", status: "BLOCKED", version: 1, closedBy: null, closedAt: null, attestation: null },
      { id: "close_nls_20260904", rooftopId: "roof_nls", businessDate: WORKSPACE_BUSINESS_DATE, paymentCount: 16, verifiedPostingCount: 16, blockingExceptionCount: 0, settlementStatus: "PAYOUT_PENDING", status: "READY", version: 1, closedBy: null, closedAt: null, attestation: null },
    ],
    payouts: [
      { id: "payout_9834", rooftopId: "roof_nlt", payoutDate: "2026-09-03", externalPayoutId: "PAYOUT-9834", currency: "CAD", capturedCents: null, refundCents: null, feeCents: null, originalExpectedCents: 1_488_492, adjustedExpectedCents: 1_488_492, observedBankCents: 1_488_492, varianceCents: 0, status: "RECONCILED", sourceRecordIds: [], reconciledBy: "System", reconciledAt: "2026-09-04T15:05:00.000Z", version: 1 },
      { id: "payout_9842", rooftopId: "roof_nls", payoutDate: "2026-09-03", externalPayoutId: "PAYOUT-9842", currency: "CAD", capturedCents: 1_916_245, refundCents: 21_900, feeCents: 20_084, originalExpectedCents: 1_874_261, adjustedExpectedCents: 1_874_261, observedBankCents: 1_871_761, varianceCents: 2_500, status: "VARIANCE", sourceRecordIds: ["source_payout_9842", "source_bank_9842", "source_assessment_9842"], reconciledBy: null, reconciledAt: null, version: 1 },
      ...["nlt", "nlf", "nls"].map((code) => ({ id: `payout_pending_${code}`, rooftopId: `roof_${code}`, payoutDate: WORKSPACE_BUSINESS_DATE, externalPayoutId: null, currency: "CAD" as const, capturedCents: null, refundCents: null, feeCents: null, originalExpectedCents: null, adjustedExpectedCents: null, observedBankCents: null, varianceCents: null, status: "PAYOUT_PENDING" as const, sourceRecordIds: [], reconciledBy: null, reconciledAt: null, version: 1 })),
    ],
    payoutSourceRecords: [
      { id: "source_payout_9842", payoutId: "payout_9842", sourceSystem: "NORTHSTAR_PROCESSOR", component: "PROCESSOR_SETTLEMENT", externalEventId: "settlement_northstar_9842", amountCents: 1_874_261, currency: "CAD", receivedAt: "2026-09-04T14:12:00.000Z", description: "Processor settlement calculated from captured payments, refunds, and fees." },
      { id: "source_bank_9842", payoutId: "payout_9842", sourceSystem: "PRAIRIE_BANK", component: "BANK_DEPOSIT", externalEventId: "bank_deposit_9842", amountCents: 1_871_761, currency: "CAD", receivedAt: "2026-09-04T14:44:00.000Z", description: "Observed bank deposit for Northline Subaru." },
      { id: "source_assessment_9842", payoutId: "payout_9842", sourceSystem: "NORTHSTAR_PROCESSOR", component: "NETWORK_ASSESSMENT_NOTICE", externalEventId: "assessment_notice_9842", amountCents: -2_500, currency: "CAD", receivedAt: "2026-09-04T14:18:00.000Z", description: "Network assessment withheld from the payout and omitted from the expected model." },
    ],
    settlementAdjustments: [],
    integrations: [
      { id: "legacy-dms", name: "LegacyDMS Simulator", status: "CONNECTED", simulated: true, lastSuccessfulAt: iso(-12), description: "Payment posting and repair-order lookup" },
      { id: "northstar-processor", name: "Northstar Processor Simulator", status: "CONNECTED", simulated: true, lastSuccessfulAt: iso(-4), description: "Captured payment and refund events" },
      { id: "prairie-bank", name: "Prairie Bank Feed Simulator", status: "CONNECTED", simulated: true, lastSuccessfulAt: iso(-120), description: "Observed payout deposits" },
    ],
    commandReceipts: [],
    invariants: {
      processorDeliveriesReceived: 63,
      uniqueProcessorEventsApplied: 62,
      duplicateDeliveriesIgnored: 1,
      dmsAttempts: 60,
      dmsMutations: 59,
      lostResponses: 1,
      retriesResolvedByLookup: 1,
      acceptedDecisions: 0,
      rejectedVersionConflicts: 0,
      outboxCreated: 59,
      outboxDelivered: 59,
    },
  };

  return state;
}
