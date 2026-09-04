#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const rawBaseUrl = process.argv[2] ?? process.env.POSTONCE_BASE_URL ?? "http://127.0.0.1:3001";
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
  if (!condition) throw new Error(message);
}

async function createSession() {
  const result = await request("/api/demo/sessions", { method: "POST", body: "{}" });
  assert(typeof result.sessionId === "string", "session creation did not return a sessionId");
  return result;
}

function mutationBody(idempotencyKey, targetId) {
  return JSON.stringify({ expectedVersion: 1, idempotencyKey, targetId });
}

async function run() {
  const health = await request("/api/health");
  assert(health.status === "ok" || health.status === "ready", "API is not ready");
  assert(health.persistence?.ok === true, "persistence is not healthy");

  const first = await createSession();
  const headers = { "X-Demo-Session": first.sessionId };
  assert(first.state.payments.filter((payment) => payment.inFridayClose).length === 62, "canonical Friday manifest is not 62 payments");
  assert(first.state.exceptions.filter((exception) => exception.status === "OPEN").length === 3, "canonical workspace is not at three open exceptions");

  const ex104Key = `smoke-ex104-${randomUUID()}`;
  const resolved104 = await request("/api/exceptions/EX-104/resolve", {
    method: "POST",
    headers,
    body: mutationBody(ex104Key, "rec_ro_8004"),
  });
  assert(resolved104.result.status === "RESOLVED", "EX-104 did not resolve");

  const replay104 = await request("/api/exceptions/EX-104/resolve", {
    method: "POST",
    headers,
    body: mutationBody(ex104Key, "rec_ro_8004"),
  });
  assert(replay104.replayed === true, "EX-104 exact retry was not replay-safe");
  assert(replay104.state.allocations.filter((allocation) => allocation.paymentId === "PAY-104").length === 1, "EX-104 retry duplicated its allocation");

  await request("/api/exceptions/EX-105/resolve", {
    method: "POST",
    headers,
    body: mutationBody(`smoke-ex105-${randomUUID()}`, "PAY-H18401"),
  });
  const resolved106 = await request("/api/exceptions/EX-106/resolve", {
    method: "POST",
    headers,
    body: mutationBody(`smoke-ex106-${randomUUID()}`, "rec_ro_8018"),
  });
  const fordReady = resolved106.state.operationalCloses.find((close) => close.rooftopId === "roof_nlf");
  assert(fordReady?.status === "READY" && fordReady.version === 4, "Ford did not reach READY after all three decisions");

  const closed = await request("/api/close/roof_nlf/close", {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedVersion: fordReady.version, idempotencyKey: `smoke-close-${randomUUID()}` }),
  });
  assert(closed.result.status === "CLOSED", "Ford operational close was not sealed");
  assert(closed.result.attestation?.settlementStatusAtClose === "PAYOUT_PENDING", "operational close incorrectly depended on settlement");

  const adjusted = await request("/api/deposits/payout_9842/adjustments", {
    method: "POST",
    headers,
    body: JSON.stringify({
      expectedVersion: 1,
      idempotencyKey: `smoke-adjust-${randomUUID()}`,
      amountCents: -2500,
      code: "NETWORK_ASSESSMENT",
      evidenceRecordId: "source_assessment_9842",
      note: "Public smoke verification against immutable source evidence.",
    }),
  });
  assert(adjusted.result.status === "RECONCILED" && adjusted.result.varianceCents === 0, "Subaru payout did not reconcile to zero variance");
  assert(adjusted.result.originalExpectedCents === 1_874_261, "settlement adjustment rewrote the original expected amount");

  const recovered = await request("/api/payments/PAY-1017", { headers });
  const recoveryAttempts = recovered.evidence.attempts.filter((attempt) => attempt.system === "LEGACY_DMS");
  assert(recoveryAttempts.map((attempt) => attempt.status).join(",") === "RESPONSE_LOST,FOUND_EXISTING", "PAY-1017 recovery evidence is incomplete");
  assert(recovered.allocations.length === 1, "PAY-1017 contains more than one financial effect");

  const amountSearch = await request(`/api/search?q=${encodeURIComponent("$1,125.00")}`, { headers });
  assert(amountSearch.groups.some((group) => group.key === "payments" && group.items.some((item) => item.id === "PAY-104")), "amount search did not find PAY-104");

  const finalState = await request("/api/workspace", { headers });
  assert(finalState.invariants.dmsAttempts === 63 && finalState.invariants.dmsMutations === 62, "lost-response proof does not preserve one financial mutation per operation");
  assert(finalState.refundLinks.length === 1 && finalState.settlementAdjustments.length === 1, "canonical links or adjustment are missing");

  const second = await createSession();
  assert(second.sessionId !== first.sessionId, "two workspaces received the same ID");
  assert(second.state.session.version === 0 && second.state.exceptions.filter((item) => item.status === "OPEN").length === 3, "a fresh workspace inherited mutated state");

  process.stdout.write(`${JSON.stringify({
    baseUrl,
    health: health.status,
    persistence: health.persistence.mode,
    fridayPayments: 62,
    fordClose: closed.result.status,
    settlement: adjusted.result.status,
    varianceCents: adjusted.result.varianceCents,
    dmsAttempts: finalState.invariants.dmsAttempts,
    dmsMutations: finalState.invariants.dmsMutations,
    recovery: recoveryAttempts.map((attempt) => attempt.status),
    isolatedSessions: true,
    replaySafe: true,
  }, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`PostOnce smoke check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
