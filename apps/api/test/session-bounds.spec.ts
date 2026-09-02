import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { DemoService } from "../src/demo/demo.service.js";
import { createSeedState } from "../src/demo/domain/seed.js";
import { MemoryDemoRepository } from "../src/demo/repositories/memory-demo.repository.js";

describe("Public demo resource bounds", () => {
  it("rate-limits repeated session creation for one client", async () => {
    const repository = new MemoryDemoRepository();
    const config = new ConfigService({
      DEMO_SESSION_CREATE_LIMIT: 1,
      DEMO_SESSION_CREATE_WINDOW_SECONDS: 600,
    });
    const service = new DemoService(repository, config);
    await service.createSession("203.0.113.10");

    await expect(service.createSession("203.0.113.10")).rejects.toMatchObject({
      code: "SESSION_RATE_LIMITED",
      status: 429,
    });
    await expect(service.createSession("203.0.113.11")).resolves.toMatchObject({
      sessionHeader: "X-Demo-Session",
    });
  });

  it("evicts the oldest session when the configured memory cap is reached", async () => {
    const repository = new MemoryDemoRepository(2, 240);
    const now = Date.now();
    const first = createSeedState(randomUUID(), new Date(now - 120_000));
    const second = createSeedState(randomUUID(), new Date(now - 60_000));
    const third = createSeedState(randomUUID(), new Date(now));
    await repository.create(first);
    await repository.create(second);
    await repository.create(third);

    expect(await repository.get(first.session.id)).toBeNull();
    expect(await repository.get(second.session.id)).not.toBeNull();
    expect(await repository.get(third.session.id)).not.toBeNull();
  });

  it("rate-limits mutation and reset traffic per isolated session", async () => {
    const repository = new MemoryDemoRepository();
    const config = new ConfigService({
      DEMO_SESSION_CREATE_LIMIT: 10,
      DEMO_SESSION_CREATE_WINDOW_SECONDS: 600,
      DEMO_SESSION_MUTATION_LIMIT: 1,
      DEMO_SESSION_MUTATION_WINDOW_SECONDS: 600,
      DEMO_RATE_LIMIT_TRACKED_KEYS: 100,
    });
    const service = new DemoService(repository, config);
    const session = await service.createSession("203.0.113.12");

    await expect(service.resetSession(session.sessionId)).resolves.toMatchObject({ sessionId: session.sessionId });
    await expect(service.resetSession(session.sessionId)).rejects.toMatchObject({
      code: "DEMO_MUTATION_RATE_LIMITED",
      status: 429,
    });
  });
});
