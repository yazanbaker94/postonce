import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiExceptionFilter } from "../src/common/api-exception.filter.js";
import { AppModule } from "../src/app.module.js";

describe("PostOnce HTTP contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DEMO_STORE = "memory";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates an isolated session and returns a complete schema", async () => {
    const response = await request(app.getHttpServer()).post("/api/demo/sessions").send({}).expect(201);
    expect(response.body.sessionHeader).toBe("X-Demo-Session");
    expect(response.body.state.payments).toHaveLength(12);
    expect(response.body.state.metadata.disclaimer).toContain("Independent synthetic engineering case study");

    await request(app.getHttpServer())
      .get("/api/demo/state")
      .set("X-Demo-Session", response.body.sessionId)
      .expect(200);
  });

  it("returns one 200 and one 409 for simultaneous stale-version resolution requests", async () => {
    const created = await request(app.getHttpServer()).post("/api/demo/sessions").send({}).expect(201);
    const sessionId: string = created.body.sessionId;
    const headers = { "X-Demo-Session": sessionId };
    for (const action of [
      "process-routine",
      "deliver-duplicate",
      "simulate-lost-response",
      "open-ambiguous-exception",
    ]) {
      await request(app.getHttpServer()).post(`/api/demo/actions/${action}`).set(headers).send({}).expect(200);
    }

    const requests = [
      request(app.getHttpServer()).post("/api/demo/actions/resolve-exception").set(headers).send({
        operationKey: "resolve_maya_http",
        expectedVersion: 1,
        candidateInvoiceId: "inv_8031",
        acceptedAmountCents: 49_500,
        reason: "Synthetic worksheet confirms RO-8031.",
        actor: "Maya Chen",
      }),
      request(app.getHttpServer()).post("/api/demo/actions/resolve-exception").set(headers).send({
        operationKey: "resolve_jon_http",
        expectedVersion: 1,
        candidateInvoiceId: "inv_8037",
        acceptedAmountCents: 49_500,
        reason: "Synthetic worksheet appears to confirm RO-8037.",
        actor: "Jon Bell",
      }),
    ];
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const rejected = responses.find((response) => response.status === 409);
    expect(rejected?.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
      message: "This exception was resolved by another operation.",
    });
    expect(rejected?.body.error.details.winningResolution).toBeTruthy();

    const snapshot = await request(app.getHttpServer()).get("/api/demo/state").set(headers).expect(200);
    expect(snapshot.body.allocations.filter((allocation: { paymentId: string }) => allocation.paymentId === "pay_1009")).toHaveLength(1);
    expect(snapshot.body.exceptions[0]).toMatchObject({ status: "RESOLVED", version: 2 });
  });

  it("rejects partial resolutions and cross-operation key collisions over HTTP", async () => {
    const created = await request(app.getHttpServer()).post("/api/demo/sessions").send({}).expect(201);
    const headers = { "X-Demo-Session": created.body.sessionId as string };
    let state = created.body.state;
    for (const action of ["process-routine", "deliver-duplicate", "simulate-lost-response", "open-ambiguous-exception"]) {
      const response = await request(app.getHttpServer()).post(`/api/demo/actions/${action}`).set(headers).send({}).expect(200);
      state = response.body.state;
    }

    await request(app.getHttpServer()).post("/api/demo/actions/resolve-exception").set(headers).send({
      operationKey: "resolve_one_cent_http",
      expectedVersion: 1,
      candidateInvoiceId: "inv_8031",
      acceptedAmountCents: 1,
      reason: "Synthetic one-cent HTTP regression probe.",
      actor: "Regression Reviewer",
    }).expect(422).expect(({ body }) => {
      expect(body.error.code).toBe("RESOLUTION_AMOUNT_MUST_EQUAL_PAYMENT_REMAINDER");
    });

    const routineKey = state.allocations.find((allocation: { paymentId: string }) => allocation.paymentId === "pay_1001").operationKey;
    await request(app.getHttpServer()).post("/api/demo/actions/resolve-exception").set(headers).send({
      operationKey: routineKey,
      expectedVersion: 1,
      candidateInvoiceId: "inv_8031",
      acceptedAmountCents: 49_500,
      reason: "Synthetic operation-key HTTP regression probe.",
      actor: "Regression Reviewer",
    }).expect(409).expect(({ body }) => {
      expect(body.error.code).toBe("IDEMPOTENCY_KEY_REUSE");
    });

    const snapshot = await request(app.getHttpServer()).get("/api/demo/state").set(headers).expect(200);
    expect(snapshot.body.allocations.filter((allocation: { paymentId: string }) => allocation.paymentId === "pay_1009")).toHaveLength(0);
    expect(snapshot.body.exceptions[0]).toMatchObject({ status: "OPEN", version: 1 });
  });

  it("formats missing-session errors without stack traces", async () => {
    const response = await request(app.getHttpServer()).get("/api/demo/state").expect(400);
    expect(response.body.error).toMatchObject({ code: "DEMO_SESSION_REQUIRED" });
    expect(response.body.error.correlationId).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain("at DemoService");
  });
});
