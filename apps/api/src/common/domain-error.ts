import { HttpStatus } from "@nestjs/common";

export class DomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY,
    public readonly details: Record<string, unknown> = {},
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class SessionNotFoundError extends DomainError {
  public constructor(sessionId: string, correlationId?: string) {
    super(
      "DEMO_SESSION_NOT_FOUND",
      "The demo session does not exist or has expired. Start a new isolated run.",
      HttpStatus.NOT_FOUND,
      { sessionId },
      correlationId,
    );
  }
}

export class VersionConflictError extends DomainError {
  public constructor(details: Record<string, unknown>, correlationId?: string) {
    super(
      "VERSION_CONFLICT",
      "This exception was resolved by another operation.",
      HttpStatus.CONFLICT,
      details,
      correlationId,
    );
  }
}
