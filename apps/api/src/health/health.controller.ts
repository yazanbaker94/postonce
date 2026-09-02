import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { DEMO_REPOSITORY, type DemoRepository } from "../demo/repositories/demo.repository.js";

@Controller()
export class HealthController {
  public constructor(@Inject(DEMO_REPOSITORY) private readonly repository: DemoRepository) {}

  @Get("health")
  async rootHealth(@Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    return this.health(response);
  }

  @Get("api/health")
  async apiHealth(@Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    return this.health(response);
  }

  private async health(response: Response): Promise<Record<string, unknown>> {
    const persistence = await this.repository.health();
    if (!persistence.ok) response.status(503);
    return {
      status: persistence.ok ? "ok" : "degraded",
      service: "postonce-api",
      persistence,
      time: new Date().toISOString(),
      syntheticDataOnly: true,
    };
  }
}
