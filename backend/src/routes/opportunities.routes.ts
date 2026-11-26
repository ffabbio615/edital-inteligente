import { Router } from "express";
import { withTransaction } from "../database/connection";
import { createOpportunitiesRouter } from "../opportunities/opportunities.routes";
import { createOpportunitiesService } from "../opportunities/opportunities.service";

export const opportunitiesRouter: Router = createOpportunitiesRouter({
  service: createOpportunitiesService(withTransaction),
});
