import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { AppModule } from "./app.module.js";
import { parseAllowedOrigins } from "./config/environment.js";
import type { NextFunction, Request, Response } from "express";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });
  const config = app.get(ConfigService);
  const allowedOrigins = parseAllowedOrigins(config.get<string>("CORS_ORIGINS", ""));

  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path === "/api" || request.path.startsWith("/api/")) {
      response.setHeader("Cache-Control", "no-store");
    }
    next();
  });
  app.enableCors({
    origin: allowedOrigins.length === 0 ? false : allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Demo-Session", "X-Correlation-Id"],
    exposedHeaders: ["X-Correlation-Id"],
    maxAge: 3_600,
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const port = config.get<number>("PORT", 3001);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
