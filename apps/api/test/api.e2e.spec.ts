import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiExceptionFilter } from "../src/common/api-exception.filter.js";

type SessionFixture = {
  sessionId: string;
  headers: Record<string, string>;
  state: Record<string, any>;
};

describe("PostOnce product HTTP contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DEMO_STORE = "memory";
    // Load configuration only after fixing this suite to the in-memory adapter.
    // CI intentionally exports PostgreSQL globally for its separate repository
    // gate, and a static ESM import would evaluate ConfigModule too early.
    const { AppModule } = await import("../src/app.module.js");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createSession(): Promise<SessionFixture> {
    const response = await request(app.getHttpServer()).post("/api/demo/sessions").send({}).expect(201);
    return {
      sessionId: response.body.sessionId as string,
      headers: { "X-Demo-Session": response.body.sessionId as string },
      state: response.body.state as Record<string, any>,
    };
  }

  it("bootstraps an isolated workspace and binds every read to the returned session header", async () => {
    const response = await request(app.getHttpServer()).post("/api/demo/sessions").send({}).expect(201);
    expect(response.body).toMatchObject({
      sessionHeader: "X-Demo-Session",
      state: {
        metadata: {
          title: "PostOnce",
          organization: "Northline Motor Group",
          businessDate: "2026-09-04",
          timezone: "America/Edmonton",
          currency: "CAD",
        },
        user: { name: "Maya Chen", role: "GROUP_CONTROLLER" },
      },
    });
    expect(response.body.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.body.state.session.id).toBe(response.body.sessionId);
    expect(response.body.state.rooftops).toHaveLength(3);
    expect(response.body.state.payments).toHaveLength(64);
    expect(response.body.state.payments.filter((item: { inFridayClose: boolean }) => item.inFridayClose)).toHaveLength(62);
    expect(response.body.state.metadata.disclaimer).toContain("Independent synthetic engineering case study");

    const workspace = await request(app.getHttpServer())
      .get("/api/workspace")
      .set("X-Demo-Session", response.body.sessionId)
      .expect(200);
    expect(workspace.body.session.id).toBe(response.body.sessionId);
    expect(workspace.body.exceptions.map((item: { id: string }) => item.id)).toEqual(["EX-104", "EX-105", "EX-106"]);

    const legacy = await request(app.getHttpServer())
      .get("/api/demo/state")
      .set("X-Demo-Session", response.body.sessionId)
      .expect(200);
    expect(legacy.body).toEqual(workspace.body);
  });

  it("keeps reads and mutations isolated between workspaces", async () => {
    const first = await createSession();
    const second = await createSession();
    expect(second.sessionId).not.toBe(first.sessionId);

    await request(app.getHttpServer())
      .post("/api/exceptions/EX-104/resolve")
      .set(second.headers)
      .send({
        expectedVersion: 1,
        idempotencyKey: "isolation-second-workspace-ex104",
        targetId: "rec_ro_8004",
      })
      .expect(200);

    const [firstAfter, secondAfter] = await Promise.all([
      request(app.getHttpServer()).get("/api/workspace").set(first.headers).expect(200),
      request(app.getHttpServer()).get("/api/workspace").set(second.headers).expect(200),
    ]);

    expect(firstAfter.body.session).toMatchObject({ id: first.sessionId, version: 0 });
    expect(firstAfter.body.exceptions.find((item: { id: string }) => item.id === "EX-104")).toMatchObject({ status: "OPEN", version: 1 });
    expect(firstAfter.body.allocations.filter((item: { paymentId: string }) => item.paymentId === "PAY-104")).toHaveLength(0);

    expect(secondAfter.body.session).toMatchObject({ id: second.sessionId, version: 1 });
    expect(secondAfter.body.exceptions.find((item: { id: string }) => item.id === "EX-104")).toMatchObject({ status: "RESOLVED", version: 2 });
    expect(secondAfter.body.allocations.filter((item: { paymentId: string }) => item.paymentId === "PAY-104")).toHaveLength(1);
  });

  it("serves close, exception, payment, deposit, search, integration, and evidence projections", async () => {
    const { headers } = await createSession();

    const close = await request(app.getHttpServer()).get("/api/close").set(headers).expect(200);
    expect(close.body).toMatchObject({
      total: 3,
      businessDate: "2026-09-04",
      summary: { ready: 2, blocked: 1, closed: 0, openOperationalExceptions: 3, priorPayoutVariances: 1 },
    });
    const ford = await request(app.getHttpServer()).get("/api/close/NLF").set(headers).expect(200);
    expect(ford.body).toMatchObject({
      rooftop: { id: "roof_nlf", code: "NLF", name: "Northline Ford" },
      close: { status: "BLOCKED", version: 1, paymentCount: 27, verifiedPostingCount: 24, blockingExceptionCount: 3 },
      payments: { count: 27, netAmountCents: 2_160_480, departmentCounts: { SERVICE: 16, PARTS: 6, SALES: 5 } },
      settlement: { status: "PAYOUT_PENDING" },
    });

    const exceptions = await request(app.getHttpServer())
      .get("/api/exceptions?location=nlf&status=open&sort=amount-high")
      .set(headers)
      .expect(200);
    expect(exceptions.body.total).toBe(3);
    expect(exceptions.body.items.map((item: { id: string }) => item.id)).toEqual(["EX-106", "EX-104", "EX-105"]);
    expect(exceptions.body.items.every((item: { ageMinutes: number }) => Number.isInteger(item.ageMinutes))).toBe(true);

    const exceptionSearch = await request(app.getHttpServer()).get("/api/exceptions?q=refund").set(headers).expect(200);
    expect(exceptionSearch.body.items.map((item: { id: string }) => item.id)).toEqual(["EX-105"]);
    const exceptionDetail = await request(app.getHttpServer()).get("/api/exceptions/EX-104").set(headers).expect(200);
    expect(exceptionDetail.body).toMatchObject({
      exception: { id: "EX-104", paymentId: "PAY-104", suggestedCandidateId: "candidate_ro_8004" },
      payment: { amountCents: 112_500, cardLast4: "4242", dmsState: "NEEDS_REVIEW" },
    });
    expect(exceptionDetail.body.candidates).toEqual([
      expect.objectContaining({ id: "candidate_ro_8004", dmsRecord: expect.objectContaining({ recordNumber: "RO-8004" }) }),
      expect.objectContaining({ id: "candidate_ro_8031", dmsRecord: expect.objectContaining({ recordNumber: "RO-8031" }) }),
    ]);

    const partsReview = await request(app.getHttpServer())
      .get("/api/payments?location=NLF&department=parts&dmsState=needs_review")
      .set(headers)
      .expect(200);
    expect(partsReview.body).toMatchObject({ total: 1, fridayTotal: 1 });
    expect(partsReview.body.items[0]).toMatchObject({ id: "PAY-105", kind: "REFUND", amountCents: 21_900 });

    const processorSearch = await request(app.getHttpServer()).get("/api/payments?q=txn_84K1F").set(headers).expect(200);
    expect(processorSearch.body.items.map((item: { id: string }) => item.id)).toEqual(["PAY-104"]);
    const amountSearch = await request(app.getHttpServer()).get(`/api/payments?q=${encodeURIComponent("$1,125.00")}`).set(headers).expect(200);
    expect(amountSearch.body.items.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(["PAY-104"]));

    const duplicate = await request(app.getHttpServer()).get("/api/payments/PAY-1006").set(headers).expect(200);
    expect(duplicate.body.evidence.inbox.deliveryCount).toBe(2);
    expect(duplicate.body.allocations).toHaveLength(1);
    expect(duplicate.body.evidence.outbox).toHaveLength(1);

    const recovered = await request(app.getHttpServer()).get("/api/payments/PAY-1017").set(headers).expect(200);
    expect(recovered.body.payment).toMatchObject({ id: "PAY-1017", dmsState: "VERIFIED", sourceReference: "RO-7921" });
    expect(recovered.body.evidence.attempts.map((item: { status: string }) => item.status)).toEqual(expect.arrayContaining([
      "ACCEPTED",
      "RESPONSE_LOST",
      "FOUND_EXISTING",
    ]));
    const recoveryDmsAttempts = recovered.body.evidence.attempts.filter((item: { system: string }) => item.system === "LEGACY_DMS");
    expect(recoveryDmsAttempts).toHaveLength(2);
    expect(new Set(recoveryDmsAttempts.map((item: { operationKey: string }) => item.operationKey)).size).toBe(1);

    const deposits = await request(app.getHttpServer()).get("/api/deposits").set(headers).expect(200);
    expect(deposits.body.total).toBe(5);
    const payout = await request(app.getHttpServer()).get("/api/deposits/payout_9842").set(headers).expect(200);
    expect(payout.body).toMatchObject({
      payout: { externalPayoutId: "PAYOUT-9842", varianceCents: 2_500, status: "VARIANCE" },
      rooftop: { code: "NLS" },
      adjustments: [],
    });
    expect(payout.body.sourceRecords).toHaveLength(3);

    const searchCases = [
      ["txn_84K1F", "payments", "PAY-104"],
      ["$1,125.00", "payments", "PAY-104"],
      ["EX-105", "exceptions", "EX-105"],
      ["RO-8018", "records", "rec_ro_8018"],
      ["PAYOUT-9842", "deposits", "payout_9842"],
    ] as const;
    for (const [query, groupKey, id] of searchCases) {
      const result = await request(app.getHttpServer()).get(`/api/search?q=${encodeURIComponent(query)}`).set(headers).expect(200);
      const group = result.body.groups.find((item: { key: string }) => item.key === groupKey);
      expect(group?.items).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
      expect(result.body.total).toBeGreaterThan(0);
    }
    await request(app.getHttpServer()).get("/api/search?q=x").set(headers).expect(200).expect(({ body }) => {
      expect(body).toEqual({ query: "x", groups: [], total: 0 });
    });

    const activity = await request(app.getHttpServer()).get("/api/activity").set(headers).expect(200);
    expect(activity.body.total).toBe(3);
    expect(activity.body.items[0].sequence).toBe(3);
    const integrations = await request(app.getHttpServer()).get("/api/integrations").set(headers).expect(200);
    expect(integrations.body.total).toBe(3);
    expect(integrations.body.items.every((item: { status: string; simulated: boolean }) => item.status === "CONNECTED" && item.simulated)).toBe(true);
    const evidence = await request(app.getHttpServer()).get("/api/architecture/evidence").set(headers).expect(200);
    expect(evidence.body).toMatchObject({
      deliverySemantics: expect.stringContaining("At-least-once"),
      persistence: { mode: "memory" },
      fixture: { fridayPayments: 62, rooftops: 3, openExceptions: 3 },
      invariants: { processorDeliveriesReceived: 63, uniqueProcessorEventsApplied: 62, dmsMutations: 59 },
    });
    expect(evidence.body.topology).toHaveLength(4);
  });

  it("completes the canonical operator journey with idempotent mutations and independent close", async () => {
    const { headers } = await createSession();
    const ex104 = { expectedVersion: 1, idempotencyKey: "http-resolve-ex104", targetId: "rec_ro_8004" };

    const resolved104 = await request(app.getHttpServer())
      .post("/api/exceptions/EX-104/resolve")
      .set(headers)
      .send(ex104)
      .expect(200);
    expect(resolved104.body).toMatchObject({
      replayed: false,
      result: { exceptionId: "EX-104", version: 2, dmsState: "VERIFIED" },
    });
    expect(resolved104.body.state.operationalCloses.find((item: { rooftopId: string }) => item.rooftopId === "roof_nlf")).toMatchObject({
      status: "BLOCKED",
      version: 2,
      verifiedPostingCount: 25,
      blockingExceptionCount: 2,
    });

    const replay = await request(app.getHttpServer())
      .post("/api/exceptions/EX-104/resolve")
      .set(headers)
      .send(ex104)
      .expect(200);
    expect(replay.body).toMatchObject({ replayed: true, result: resolved104.body.result });
    expect(replay.body.state.allocations.filter((item: { paymentId: string }) => item.paymentId === "PAY-104")).toHaveLength(1);

    await request(app.getHttpServer())
      .post("/api/exceptions/EX-104/resolve")
      .set(headers)
      .send({ ...ex104, targetId: "rec_ro_8031" })
      .expect(409)
      .expect(({ body }) => expect(body.error).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE" }));

    await request(app.getHttpServer())
      .post("/api/exceptions/EX-105/resolve")
      .set(headers)
      .send({ expectedVersion: 1, idempotencyKey: "http-resolve-ex105", targetId: "PAY-H18401" })
      .expect(200);
    const resolved106 = await request(app.getHttpServer())
      .post("/api/exceptions/EX-106/resolve")
      .set(headers)
      .send({ expectedVersion: 1, idempotencyKey: "http-resolve-ex106", targetId: "rec_ro_8018" })
      .expect(200);
    expect(resolved106.body.state.operationalCloses.find((item: { rooftopId: string }) => item.rooftopId === "roof_nlf")).toMatchObject({
      status: "READY",
      version: 4,
      verifiedPostingCount: 27,
      blockingExceptionCount: 0,
    });

    const closed = await request(app.getHttpServer())
      .post("/api/close/roof_nlf/close")
      .set(headers)
      .send({ expectedVersion: 4, idempotencyKey: "http-close-ford" })
      .expect(200);
    expect(closed.body).toMatchObject({
      replayed: false,
      result: {
        rooftopId: "roof_nlf",
        status: "CLOSED",
        version: 5,
        closedBy: "Maya Chen",
        attestation: {
          paymentCount: 27,
          verifiedPostingCount: 27,
          blockingExceptionCount: 0,
          settlementStatusAtClose: "PAYOUT_PENDING",
        },
      },
    });
    expect(closed.body.state.operationalCloses.find((item: { rooftopId: string }) => item.rooftopId === "roof_nlt").status).toBe("READY");
    expect(closed.body.state.operationalCloses.find((item: { rooftopId: string }) => item.rooftopId === "roof_nls").status).toBe("READY");

    const adjusted = await request(app.getHttpServer())
      .post("/api/deposits/payout_9842/adjustments")
      .set(headers)
      .send({
        expectedVersion: 1,
        idempotencyKey: "http-adjust-9842",
        amountCents: -2_500,
        code: "NETWORK_ASSESSMENT",
        evidenceRecordId: "source_assessment_9842",
        note: "Confirmed against processor evidence.",
      })
      .expect(200);
    expect(adjusted.body).toMatchObject({
      replayed: false,
      result: {
        payoutId: "payout_9842",
        status: "RECONCILED",
        version: 2,
        originalExpectedCents: 1_874_261,
        adjustmentTotalCents: -2_500,
        adjustedExpectedCents: 1_871_761,
        observedBankCents: 1_871_761,
        varianceCents: 0,
      },
    });
    expect(adjusted.body.state).toMatchObject({
      invariants: { acceptedDecisions: 3, dmsAttempts: 63, dmsMutations: 62, outboxCreated: 62, outboxDelivered: 62 },
    });
    expect(adjusted.body.state.refundLinks).toHaveLength(1);
    expect(adjusted.body.state.settlementAdjustments).toHaveLength(1);
    expect(adjusted.body.state.allocations.filter((item: { paymentId: string }) => ["PAY-104", "PAY-106"].includes(item.paymentId))).toHaveLength(2);

    const payout = await request(app.getHttpServer()).get("/api/deposits/payout_9842").set(headers).expect(200);
    expect(payout.body.payout).toMatchObject({ status: "RECONCILED", originalExpectedCents: 1_874_261, adjustedExpectedCents: 1_871_761 });
    expect(payout.body.sourceRecords.find((item: { id: string }) => item.id === "source_assessment_9842")).toMatchObject({ amountCents: -2_500 });
    expect(payout.body.adjustments).toEqual([
      expect.objectContaining({ amountCents: -2_500, evidenceRecordId: "source_assessment_9842", actor: "Maya Chen" }),
    ]);
  });

  it("serializes concurrent exception decisions and persists one replayable stale rejection", async () => {
    const { headers } = await createSession();
    const intents = [
      { expectedVersion: 1, idempotencyKey: "http-race-maya", targetId: "rec_ro_8004" },
      { expectedVersion: 1, idempotencyKey: "http-race-jon", targetId: "rec_ro_8004" },
    ];
    const responses = await Promise.all(intents.map((intent) => request(app.getHttpServer())
      .post("/api/exceptions/EX-104/resolve")
      .set(headers)
      .send(intent)));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const losingIndex = responses.findIndex((response) => response.status === 409);
    const rejected = responses[losingIndex]!;
    expect(rejected.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
      message: "This item was already changed by another operation.",
      details: {
        entityId: "EX-104",
        expectedVersion: 1,
        actualVersion: 2,
        winningActor: "Maya Chen",
        winningResolution: expect.objectContaining({ targetId: "rec_ro_8004", amountCents: 112_500 }),
      },
    });
    expect(rejected.body.error.correlationId).toBeTruthy();

    const snapshot = await request(app.getHttpServer()).get("/api/workspace").set(headers).expect(200);
    expect(snapshot.body.exceptions.find((item: { id: string }) => item.id === "EX-104")).toMatchObject({ status: "RESOLVED", version: 2 });
    expect(snapshot.body.allocations.filter((item: { paymentId: string }) => item.paymentId === "PAY-104")).toHaveLength(1);
    expect(snapshot.body.auditEvents.filter((item: { type: string }) => item.type === "STALE_VERSION_CONFLICT")).toHaveLength(1);
    expect(snapshot.body.commandReceipts).toHaveLength(2);
    expect(snapshot.body.invariants).toMatchObject({ acceptedDecisions: 1, rejectedVersionConflicts: 1 });

    const replayedRejection = await request(app.getHttpServer())
      .post("/api/exceptions/EX-104/resolve")
      .set(headers)
      .send(intents[losingIndex])
      .expect(409);
    expect(replayedRejection.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
      correlationId: rejected.body.error.correlationId,
    });
    const afterReplay = await request(app.getHttpServer()).get("/api/workspace").set(headers).expect(200);
    expect(afterReplay.body.auditEvents.filter((item: { type: string }) => item.type === "STALE_VERSION_CONFLICT")).toHaveLength(1);
    expect(afterReplay.body.commandReceipts).toHaveLength(2);
    expect(afterReplay.body.session.version).toBe(snapshot.body.session.version);
  });

  it("returns bounded validation and session errors without leaking stack traces", async () => {
    const missing = await request(app.getHttpServer()).get("/api/workspace").expect(400);
    expect(missing.body.error).toMatchObject({ code: "DEMO_SESSION_REQUIRED", details: { sessionHeader: "X-Demo-Session" } });
    expect(missing.body.error.correlationId).toBeTruthy();

    await request(app.getHttpServer())
      .get("/api/workspace")
      .set("X-Demo-Session", "not-a-uuid")
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("INVALID_DEMO_SESSION"));

    await request(app.getHttpServer())
      .get("/api/workspace")
      .set("X-Demo-Session", "11111111-1111-4111-8111-111111111111")
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe("DEMO_SESSION_NOT_FOUND"));

    const { headers } = await createSession();
    const invalid = await request(app.getHttpServer())
      .post("/api/exceptions/EX-104/resolve")
      .set(headers)
      .send({ expectedVersion: 1, idempotencyKey: "short", targetId: "rec_ro_8004" })
      .expect(400);
    expect(invalid.body.error).toMatchObject({ code: "INVALID_REQUEST" });
    expect(invalid.body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "idempotencyKey" }),
    ]));
    expect(JSON.stringify([missing.body, invalid.body])).not.toContain("at DemoService");
  });
});
