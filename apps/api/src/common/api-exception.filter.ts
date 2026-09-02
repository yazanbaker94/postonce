import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { DomainError } from "./domain-error.js";
import type { CorrelatedRequest } from "./correlation.middleware.js";

type HttpPayload = {
  code?: string;
  message?: string | string[];
  details?: Record<string, unknown>;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest>();
    const response = context.getResponse<Response>();
    const fallbackCorrelation = request.correlationId ?? "corr_unavailable";

    if (exception instanceof DomainError) {
      const retryAfterSeconds = exception.details.retryAfterSeconds;
      if (exception.status === HttpStatus.TOO_MANY_REQUESTS && typeof retryAfterSeconds === "number") {
        response.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
      }
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          correlationId: exception.correlationId ?? fallbackCorrelation,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const payload: HttpPayload = typeof raw === "object" && raw !== null ? raw as HttpPayload : {};
      const rawMessage = payload.message ?? exception.message;
      const message = Array.isArray(rawMessage) ? rawMessage.join("; ") : rawMessage;
      response.status(status).json({
        error: {
          code: payload.code ?? httpCode(status),
          message,
          correlationId: fallbackCorrelation,
          details: payload.details ?? {},
        },
      });
      return;
    }

    // The server logs the full exception; the browser receives no stack or secret.
    console.error("Unhandled API error", { correlationId: fallbackCorrelation, exception });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        correlationId: fallbackCorrelation,
        details: {},
      },
    });
  }
}

function httpCode(status: number): string {
  if (status === HttpStatus.BAD_REQUEST) return "BAD_REQUEST";
  if (status === HttpStatus.NOT_FOUND) return "NOT_FOUND";
  if (status === HttpStatus.CONFLICT) return "CONFLICT";
  if (status === HttpStatus.SERVICE_UNAVAILABLE) return "SERVICE_UNAVAILABLE";
  return "REQUEST_FAILED";
}
