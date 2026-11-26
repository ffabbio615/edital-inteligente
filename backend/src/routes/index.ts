import { Router } from "express";
import { healthRouter } from "./health.routes";
import { integrationsRouter } from "./integrations.routes";
import { opportunitiesRouter } from "./opportunities.routes";

export const routes = Router();

routes.use("/health", healthRouter);
routes.use("/integrations", integrationsRouter);
routes.use("/opportunities", opportunitiesRouter);
