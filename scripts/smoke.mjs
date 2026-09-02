#!/usr/bin/env node

const rawBaseUrl = process.argv[2] ?? process.env.POSTONCE_BASE_URL ?? "http://localhost:4100";
const baseUrl = rawBaseUrl.replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${options.method ?? "GET"} ${path} returned non-JSON (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function createSession() {
  const result = await request("/api/demo/sessions", {
    method: "POST",
    body: "{}",
  });
  assert(typeof result.sessionId === "string", "session creation did not return a sessionId");
  return result;
}

async function run() {
  const health = await request("/api/health");
  assert(health.status === "ok" || health.status === "ready", "API is not ready");

  const first = await createSession();
  const firstHeaders = { "X-Demo-Session": first.sessionId };
  const completed = await request("/api/demo/actions/run-all", {
    method: "POST",
    headers: firstHeaders,
    body: "{}",
  });

  const state = completed.state;
  assert(state.close.status === "READY", `close finished as ${state.close.status}, expected READY`);
  assert(state.totals.varianceCents === 0, "settlement did not reconcile to zero variance");
  assert(
    state.settlementEvidence?.processorFee?.system === "NORTHSTAR_PROCESSOR",
    "settlement fee did not come from the independent processor evidence record",
  );
  assert(
    state.settlementEvidence?.bankDeposit?.system === "PRAIRIE_BANK",
    "settlement deposit did not come from the independent bank evidence record",
  );
  assert(
    state.totals.feeCents === state.settlementEvidence.processorFee.amountCents,
    "derived fee total does not match the processor evidence record",
  );
  assert(
    state.totals.bankDepositCents === state.settlementEvidence.bankDeposit.amountCents,
    "derived deposit total does not match the bank evidence record",
  );
  assert(state.invariants.duplicateDeliveriesIgnored >= 1, "duplicate-delivery invariant was not exercised");
  assert(
    state.invariants.dmsAttempts === state.invariants.dmsMutations + 1,
    `expected exactly one extra DMS attempt from the lost response, got ${state.invariants.dmsAttempts} attempts / ${state.invariants.dmsMutations} mutations`,
  );
  assert(state.invariants.lostResponses >= 1, "lost-response path was not exercised");
  assert(state.invariants.retriesResolvedByLookup >= 1, "lost response was not recovered by lookup");
  const lostResponseTrace = state.integrationAttempts.filter(
    (attempt) => attempt.correlationId.endsWith("_lost_response"),
  );
  assert(
    lostResponseTrace.length === 2 &&
      lostResponseTrace[0]?.status === "RESPONSE_LOST" &&
      lostResponseTrace[1]?.status === "REPLAYED",
    "lost-response evidence must contain exactly the failed observation and the safe replay",
  );
  assert(state.invariants.acceptedDecisions === 1, "concurrent decision did not produce one winner");
  assert(state.invariants.rejectedVersionConflicts === 1, "concurrent decision did not produce one conflict");

  const replay = await request("/api/demo/actions/run-all", {
    method: "POST",
    headers: firstHeaders,
    body: "{}",
  });
  assert(replay.replayed === true, "repeated run-all action was not identified as a replay");
  assert(replay.state.allocations.length === state.allocations.length, "replay changed allocation count");

  const second = await createSession();
  assert(second.sessionId !== first.sessionId, "two demo sessions received the same ID");
  assert(second.state.currentChapter === 0, "new session inherited another session's progress");

  process.stdout.write(`${JSON.stringify({
    baseUrl,
    health: health.status,
    close: state.close.status,
    varianceCents: state.totals.varianceCents,
    processorFeeRecord: state.settlementEvidence.processorFee.id,
    bankDepositRecord: state.settlementEvidence.bankDeposit.id,
    allocations: state.allocations.length,
    auditEvents: state.auditEvents.length,
    processorDeliveries: state.invariants.processorDeliveriesReceived,
    uniqueProcessorEvents: state.invariants.uniqueProcessorEventsApplied,
    dmsAttempts: state.invariants.dmsAttempts,
    dmsMutations: state.invariants.dmsMutations,
    lostResponseTraceRows: lostResponseTrace.length,
    acceptedDecisions: state.invariants.acceptedDecisions,
    rejectedVersionConflicts: state.invariants.rejectedVersionConflicts,
    isolatedSessions: true,
    replaySafe: true,
  }, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`PostOnce smoke check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
