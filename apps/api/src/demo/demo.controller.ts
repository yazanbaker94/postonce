import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { isIP, SocketAddress } from "node:net";
import {
  CloseLocationRequestSchema,
  DEMO_SESSION_HEADER,
  ResolveExceptionRequestSchema,
  SettlementAdjustmentRequestSchema,
  type CloseLocationRequest,
  type DemoState,
  type MutationResponse,
  type ResolveExceptionRequest,
  type SessionResponse,
  type SettlementAdjustmentRequest,
} from "@postonce/contracts";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { DemoService } from "./demo.service.js";

export const TRUSTED_CLIENT_IP_HEADER = "x-postonce-ingress-peer";

const CLIENT_KEY_DOMAIN = "postonce-demo-create-limit-v1";
const UNATTRIBUTED_CLIENT_IDENTITY = "unattributed-private-proxy-client";

function canonicalIp(value: string | undefined): string | null {
  if (!value || value !== value.trim() || value.length > 64) return null;
  const ipVersion = isIP(value);
  if (ipVersion === 0) return null;
  try {
    const canonical = new SocketAddress({ address: value, family: ipVersion === 4 ? "ipv4" : "ipv6" }).address;
    return /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(canonical)?.[1] ?? canonical;
  } catch {
    return null;
  }
}

/**
 * The trusted ingress overwrites this internal header from its peer chain. Public
 * forwarding headers remain intentionally ignored.
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

  @Post("demo/reset")
  @HttpCode(200)
  async reset(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<SessionResponse> {
    return this.demo.resetSession(sessionId);
  }

  @Get("demo/state")
  async legacyState(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<DemoState> {
    return this.demo.state(sessionId);
  }

  @Get("workspace")
  async workspace(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<DemoState> {
    return this.demo.state(sessionId);
  }

  @Get("overview")
  async overview(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    return this.demo.closeOverview(sessionId);
  }

  @Get("close")
  async closeOverview(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    return this.demo.closeOverview(sessionId);
  }

  @Get("close/:rooftopId")
  async closeDetail(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Param("rooftopId") rooftopId: string,
  ): Promise<Record<string, unknown>> {
    return this.demo.closeDetail(sessionId, rooftopId);
  }

  @Post("close/:rooftopId/close")
  @HttpCode(200)
  async closeLocation(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Param("rooftopId") rooftopId: string,
    @Body(new ZodValidationPipe(CloseLocationRequestSchema)) request: CloseLocationRequest,
  ): Promise<MutationResponse> {
    return this.demo.closeLocation(sessionId, rooftopId, request);
  }

  @Get("exceptions")
  async exceptions(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Query("location") location?: string,
    @Query("status") status?: string,
    @Query("sort") sort?: string,
    @Query("q") q?: string,
  ): Promise<Record<string, unknown>> {
    return this.demo.listExceptions(sessionId, { location, status, sort, q });
  }

  @Get("exceptions/:exceptionId")
  async exceptionDetail(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Param("exceptionId") exceptionId: string,
  ): Promise<Record<string, unknown>> {
    return this.demo.exceptionDetail(sessionId, exceptionId);
  }

  @Post("exceptions/:exceptionId/resolve")
  @HttpCode(200)
  async resolveException(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Param("exceptionId") exceptionId: string,
    @Body(new ZodValidationPipe(ResolveExceptionRequestSchema)) request: ResolveExceptionRequest,
  ): Promise<MutationResponse> {
    return this.demo.resolveException(sessionId, exceptionId, request);
  }

  @Get("payments")
  async payments(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Query("location") location?: string,
    @Query("department") department?: string,
    @Query("dmsState") dmsState?: string,
    @Query("q") q?: string,
  ): Promise<Record<string, unknown>> {
    return this.demo.listPayments(sessionId, { location, department, dmsState, q });
  }

  @Get("payments/:paymentId")
  async paymentDetail(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Param("paymentId") paymentId: string,
  ): Promise<Record<string, unknown>> {
    return this.demo.paymentDetail(sessionId, paymentId);
  }

  @Get("deposits")
  async deposits(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    return this.demo.listDeposits(sessionId);
  }

  @Get("deposits/:payoutId")
  async depositDetail(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Param("payoutId") payoutId: string,
  ): Promise<Record<string, unknown>> {
    return this.demo.depositDetail(sessionId, payoutId);
  }

  @Post("deposits/:payoutId/adjustments")
  @HttpCode(200)
  async recordAdjustment(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Param("payoutId") payoutId: string,
    @Body(new ZodValidationPipe(SettlementAdjustmentRequestSchema)) request: SettlementAdjustmentRequest,
  ): Promise<MutationResponse> {
    return this.demo.recordAdjustment(sessionId, payoutId, request);
  }

  @Get("activity")
  async activity(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    return this.demo.activity(sessionId);
  }

  @Get("integrations")
  async integrations(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    return this.demo.integrations(sessionId);
  }

  @Get("integration-attempts")
  async integrationAttempts(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    const integrations = await this.demo.integrations(sessionId);
    return integrations;
  }

  @Get("audit-events")
  async auditEvents(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    return this.demo.activity(sessionId);
  }

  @Get("search")
  async search(
    @Headers(DEMO_SESSION_HEADER) sessionId: string,
    @Query("q") query = "",
  ): Promise<Record<string, unknown>> {
    return this.demo.search(sessionId, query);
  }

  @Get("architecture/evidence")
  async evidence(@Headers(DEMO_SESSION_HEADER) sessionId: string): Promise<Record<string, unknown>> {
    return this.demo.architectureEvidence(sessionId);
  }
}
