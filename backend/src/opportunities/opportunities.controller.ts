import type { RequestHandler } from "express";
import {
  listOpportunitiesQuerySchema,
  opportunityDetailQuerySchema,
  opportunityParamsSchema,
} from "./opportunities.schemas";
import type { OpportunitiesService } from "./opportunities.service";

export function createListOpportunitiesController(service: OpportunitiesService): RequestHandler {
  return async (req, res) => {
    // ZodError é convertido em 400 pelo middleware central de erros.
    const query = listOpportunitiesQuerySchema.parse(req.query);
    const result = await service.listOpportunities(query);
    res.status(200).json({ success: true, data: result });
  };
}

export function createGetOpportunityController(service: OpportunitiesService): RequestHandler {
  return async (req, res) => {
    // id inválido: ZodError (400). Não encontrado: AppError 404 lançado pelo serviço.
    const { id } = opportunityParamsSchema.parse(req.params);
    opportunityDetailQuerySchema.parse(req.query);
    const result = await service.getOpportunity(id);
    res.status(200).json({ success: true, data: result });
  };
}
