import { Router } from "express";
import { createGetOpportunityController, createListOpportunitiesController } from "./opportunities.controller";
import type { OpportunitiesService } from "./opportunities.service";

export interface OpportunitiesRouterOptions {
  service: OpportunitiesService;
}

// Consulta pública de oportunidades (sem autenticação nesta etapa).
export function createOpportunitiesRouter({ service }: OpportunitiesRouterOptions): Router {
  const router = Router();
  router.get("/", createListOpportunitiesController(service));
  router.get("/:id", createGetOpportunityController(service));
  return router;
}
