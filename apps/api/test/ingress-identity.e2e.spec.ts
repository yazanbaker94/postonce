import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { ApiExceptionFilter } from "../src/common/api-exception.filter.js";
import {
  DemoController,
  TRUSTED_CLIENT_IP_HEADER,
} from "../src/demo/demo.controller.js";
import { DemoService } from "../src/demo/demo.service.js";
import { MemoryDemoRepository } from "../src/demo/repositories/memory-demo.repository.js";

const openApps: INestApplication[] = [];

async function createLimiterApp(): Promise<INestApplication> {
  const service = new DemoService(
    new MemoryDemoRepository(),
    new ConfigService({
      DEMO_SESSION_CREATE_LIMIT: 1,
      DEMO_SESSION_CREATE_WINDOW_SECONDS: 600,
      DEMO_RATE_LIMIT_TRACKED_KEYS: 100,
    }),
  );
  const module = await Test.createTestingModule({
    controllers: [DemoController],
    providers: [{ provide: DemoService, useValue: service }],
  }).compile();
  const app = module.createNestApplication();

  // Mirror production's current Express setting. The limiter must remain safe
  // even though this makes request.ip sensitive to X-Forwarded-For.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("trusted ingress identity boundary", () => {
  it("ignores forged public forwarding headers when deriving the create-session bucket", async () => {
    const app = await createLimiterApp();

    await request(app.getHttpServer())
      .post("/api/demo/sessions")
      .set("CF-Connecting-IP", "198.51.100.10")
      .set("True-Client-IP", "198.51.100.11")
      .set("X-Forwarded-For", "198.51.100.12")
      .set("X-Real-IP", "198.51.100.13")
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/demo/sessions")
      .set("CF-Connecting-IP", "203.0.113.20")
      .set("True-Client-IP", "203.0.113.21")
      .set("X-Forwarded-For", "203.0.113.22")
      .set("X-Real-IP", "203.0.113.23")
      .send({})
      .expect(429)
      .expect(({ body, headers }) => {
        expect(body.error.code).toBe("SESSION_RATE_LIMITED");
        expect(headers["retry-after"]).toBeTruthy();
      });
  });

  it("uses only the private ingress-overwritten header to distinguish clients", async () => {
    const app = await createLimiterApp();

    await request(app.getHttpServer())
      .post("/api/demo/sessions")
      .set(TRUSTED_CLIENT_IP_HEADER, "198.51.100.30")
      .set("CF-Connecting-IP", "192.0.2.1")
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post("/api/demo/sessions")
      .set(TRUSTED_CLIENT_IP_HEADER, "198.51.100.31")
      .set("CF-Connecting-IP", "192.0.2.1")
      .send({})
      .expect(201);
  });

  it("canonicalizes trusted IPv6 identities and rejects malformed bypass values", async () => {
    const ipv6App = await createLimiterApp();
    await request(ipv6App.getHttpServer())
      .post("/api/demo/sessions")
      .set(TRUSTED_CLIENT_IP_HEADER, "2001:0db8:0:0:0:0:0:1")
      .send({})
      .expect(201);
    await request(ipv6App.getHttpServer())
      .post("/api/demo/sessions")
      .set(TRUSTED_CLIENT_IP_HEADER, "2001:db8::1")
      .send({})
      .expect(429);

    const invalidApp = await createLimiterApp();
    await request(invalidApp.getHttpServer()).post("/api/demo/sessions").send({}).expect(201);
    await request(invalidApp.getHttpServer())
      .post("/api/demo/sessions")
      .set(TRUSTED_CLIENT_IP_HEADER, "203.0.113.40, 198.51.100.40")
      .send({})
      .expect(429);
  });
});
