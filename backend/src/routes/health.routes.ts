import { Router } from "express";
import { checkDatabaseStatus } from "../database/connection";

export const healthRouter = Router();

// "status" e "api" indicam que o servidor está no ar; "database" é reportado de forma independente.
healthRouter.get("/", async (_req, res) => {
  const database = await checkDatabaseStatus();

  res.status(200).json({
    status: "ok",
    application: "Edital Inteligente",
    api: "online",
    database,
  });
});
