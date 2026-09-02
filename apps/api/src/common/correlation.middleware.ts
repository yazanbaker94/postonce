import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

export type CorrelatedRequest = Request & { correlationId: string };

function safeIncomingId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[a-zA-Z0-9_.:-]{8,96}$/.test(value) ? value : null;
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    const correlationId = safeIncomingId(request.header("x-correlation-id")) ?? `corr_${randomUUID()}`;
    request.correlationId = correlationId;
    response.setHeader("X-Correlation-Id", correlationId);
    next();
  }
}
