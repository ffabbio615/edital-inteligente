import { Router } from "express";
import { createIntegrationAuth } from "../../middlewares/integration-auth.middleware";
import { createN8nController } from "./n8n.controller";
import type { N8nService } from "./n8n.service";

export interface N8nRouterOptions {
  secret: string | undefined;
  service: N8nService;
}

export function createN8nRouter({ secret, service }: N8nRouterOptions): Router {
  const router = Router();
  router.post("/opportunities", createIntegrationAuth(secret), createN8nController(service));
  return router;
}
