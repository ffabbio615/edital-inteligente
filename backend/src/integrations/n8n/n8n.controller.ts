import type { RequestHandler } from "express";
import { n8nIngestSchema } from "./n8n.schemas";
import type { N8nService } from "./n8n.service";

export function createN8nController(service: N8nService): RequestHandler {
  return async (req, res) => {
    // ZodError é convertido em 400 pelo middleware central de erros.
    const input = n8nIngestSchema.parse(req.body);
    const result = await service.ingestOpportunityAnalysis(input);

    const created = result.opportunity.action === "created" || result.analysis.action === "created";
    res.status(created ? 201 : 200).json({ success: true, data: result });
  };
}
