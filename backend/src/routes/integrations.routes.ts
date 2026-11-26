import { Router } from "express";
import { env } from "../config/env";
import { withTransaction } from "../database/connection";
import { createN8nRouter } from "../integrations/n8n/n8n.routes";
import { createN8nService } from "../integrations/n8n/n8n.service";

export const integrationsRouter = Router();

integrationsRouter.use(
  "/n8n",
  createN8nRouter({
    secret: env.N8N_INTEGRATION_SECRET,
    service: createN8nService(withTransaction),
  }),
);
