import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DemoController } from "./demo.controller.js";
import { DemoService } from "./demo.service.js";
import { DEMO_REPOSITORY, type DemoRepository } from "./repositories/demo.repository.js";
import { MemoryDemoRepository } from "./repositories/memory-demo.repository.js";
import { PostgresDemoRepository } from "./repositories/postgres-demo.repository.js";

@Module({
  controllers: [DemoController],
  providers: [
    DemoService,
    {
      provide: DEMO_REPOSITORY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DemoRepository => {
        const requested = config.get<string>("DEMO_STORE", "auto");
        const databaseUrl = config.get<string>("DATABASE_URL");
        if (requested === "postgres" && !databaseUrl) {
          throw new Error("DEMO_STORE=postgres requires DATABASE_URL");
        }
        if ((requested === "postgres" || requested === "auto") && databaseUrl) {
          return new PostgresDemoRepository(
            databaseUrl,
            config.get<number>("DB_POOL_MAX", 10),
            config.get<number>("DEMO_MAX_ACTIVE_SESSIONS", 500),
            config.get<number>("DEMO_SESSION_TTL_MINUTES", 240),
          );
        }
        return new MemoryDemoRepository(
          config.get<number>("DEMO_MAX_ACTIVE_SESSIONS", 500),
          config.get<number>("DEMO_SESSION_TTL_MINUTES", 240),
        );
      },
    },
  ],
  exports: [DEMO_REPOSITORY],
})
export class DemoModule {}
