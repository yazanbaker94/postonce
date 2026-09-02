import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { isIP, SocketAddress } from "node:net";
import {
  ActionRequestSchema,
  DEMO_SESSION_HEADER,
  DemoActionSchema,
  type ActionRequest,
  type ActionResponse,
  type DemoAction,
  type DemoState,
  type SessionResponse,
} from "@postonce/contracts";
import { DomainError } from "../common/domain-error.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { DemoService } from "./demo.service.js";

export const TRUSTED_CLIENT_IP_HEADER = "x-postonce-ingress-peer";

const CLIENT_KEY_DOMAIN = "postonce-demo-create-limit-v1";
const UNATTRIBUTED_CLIENT_IDENTITY = "unattributed-private-proxy-client";

function canonicalIp(value: string | undefined): string | null {
  if (!value || value !== value.trim() || value.length > 64) {
    return null;
  }

  const ipVersion = isIP(value);
  if (ipVersion === 0) {
    return null;
  }

  try {
    const canonical = new SocketAddress({
      address: value,
      family: ipVersion === 4 ? "ipv4" : "ipv6",
    }).address;
    const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(canonical);
    return mappedIpv4?.[1] ?? canonical;
  } catch {
    return null;
  }
}

/**
 * The immediate private proxy overwrites this internal header after deriving the
 * address from its trusted-hop configuration. Public forwarding headers are
 * intentionally ignored. Missing or malformed identities share one conservative
 * limiter bucket instead of trusting a caller-controlled fallback.
 */
export function createSessionClientKey(request: Pick<Request, "header" | "socket">): string {
  const identity = canonicalIp(request.header(TRUSTED_CLIENT_IP_HEADER))
    ?? canonicalIp(request.socket.remoteAddress)
    ?? UNATTRIBUTED_CLIENT_IDENTITY;
  return `client_${createHash("sha256")
    .update(CLIENT_KEY_DOMAIN)
    .update("\0")
    .update(identity)
    .digest("base64url")}`;
}

@Controller("api")
export class DemoController {
  public constructor(@Inject(DemoService) private readonly demo: DemoService) {}

  @Post("demo/sessions")
  async createSession(@Req() request: Request): Promise<SessionResponse> {
    return this.demo.createSession(createSessionClientKey(request));
  }

  @Get("demo/state")
  async state(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<DemoState> {
    return this.demo.state(sessionId);
  }

  @Post("demo/reset")
  @HttpCode(200)
  async reset(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<SessionResponse> {
    return this.demo.resetSession(sessionId);
  }

  @Post("demo/actions/:action")
  @HttpCode(200)
  async action(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Param("action") actionInput: string,
    @Body(new ZodValidationPipe(ActionRequestSchema)) request: ActionRequest,
  ): Promise<ActionResponse> {
    const parsed = DemoActionSchema.safeParse(actionInput);
    if (!parsed.success) {
      throw new DomainError("UNKNOWN_ACTION", "That guided-demo action is not supported.", 404, {
        requestedAction: actionInput,
        supportedActions: DemoActionSchema.options,
      });
    }
    return this.demo.execute(sessionId, parsed.data as DemoAction, request);
  }

  @Get("overview")
  async overview(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    return this.demo.overview(sessionId);
  }

  @Get("payments")
  async payments(@Headers(DEMO_SESSION_HEADER) sessionId: string) {
    return this.demo.list(sessionId, "payments");
  }

  @Get("invoices")
  async invoices(@Headers(DEMO_SESSION_HEADER) sessionId: string) {
    return this.demo.list(sessionId, "invoices");
  }

  @Get("exceptions")
  async exceptions(@Headers(DEMO_SESSION_HEADER) sessionId: string) {
    return this.demo.list(sessionId, "exceptions");
  }

  @Get("integration-attempts")
  async integrationAttempts(@Headers(DEMO_SESSION_HEADER) sessionId: string) {
    return this.demo.list(sessionId, "integrationAttempts");
  }

  @Get("audit-events")
  async auditEvents(@Headers(DEMO_SESSION_HEADER) sessionId: string) {
    return this.demo.list(sessionId, "auditEvents");
  }

  @Get("architecture/evidence")
  async evidence(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    return this.demo.architectureEvidence(sessionId);
  }
}
