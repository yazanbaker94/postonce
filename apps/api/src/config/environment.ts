import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z.string().url().optional(),
  DEMO_STORE: z.enum(["auto", "memory", "postgres"]).default("auto"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:5173"),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(30).default(10),
  DEMO_MAX_ACTIVE_SESSIONS: z.coerce.number().int().min(10).max(10_000).default(500),
  DEMO_SESSION_TTL_MINUTES: z.coerce.number().int().min(15).max(10_080).default(240),
  DEMO_SESSION_CREATE_LIMIT: z.coerce.number().int().min(1).max(100).default(12),
  DEMO_SESSION_CREATE_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
  DEMO_SESSION_MUTATION_LIMIT: z.coerce.number().int().min(10).max(2_000).default(120),
  DEMO_SESSION_MUTATION_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
  DEMO_RATE_LIMIT_TRACKED_KEYS: z.coerce.number().int().min(100).max(100_000).default(4_096),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const parsed = EnvironmentSchema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return parsed.data;
}

export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
