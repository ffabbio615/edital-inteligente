import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { env } from "../config/env";
import { DatabaseNotConfiguredError } from "../database/connection";
import { DatabaseUnavailableError } from "../database/transaction";
import { AppError, type ErrorDetail } from "../errors/app-error";

interface ErrorResponse {
  success: false;
  status: "error";
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
}

interface HttpError extends Error {
  status: number;
  type?: string;
}

function isHttpError(error: unknown): error is HttpError {
  if (!(error instanceof Error)) {
    return false;
  }
  const status = (error as Partial<HttpError>).status;
  return typeof status === "number" && status >= 400 && status < 500;
}

// Código SQLSTATE de erros do pg (ex.: "23514"). Códigos de rede (ECONNRESET etc.) não são numéricos.
function getErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : undefined;
}

function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: ErrorDetail[],
): void {
  const body: ErrorResponse = {
    success: false,
    status: "error",
    error: { code, message, ...(details ? { details } : {}) },
  };
  res.status(statusCode).json(body);
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, "not_found", "Route not found.");
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    sendError(res, error.statusCode, error.code, error.message, error.details);
    return;
  }

  if (error instanceof ZodError) {
    sendError(
      res,
      400,
      "validation_error",
      "Invalid request data.",
      error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
    return;
  }

  if (error instanceof DatabaseNotConfiguredError) {
    sendError(res, 503, "database_not_configured", "The database is not configured.");
    return;
  }

  if (error instanceof DatabaseUnavailableError) {
    sendError(res, 503, "database_unavailable", "The database is currently unavailable.");
    return;
  }

  // Erros 4xx gerados pelo Express (ex.: JSON inválido, corpo grande demais).
  if (isHttpError(error)) {
    const isInvalidJson = error.type === "entity.parse.failed";
    sendError(
      res,
      error.status,
      isInvalidJson ? "invalid_json" : "bad_request",
      isInvalidJson ? "Request body contains invalid JSON." : "The request could not be processed.",
    );
    return;
  }

  // Violações de integridade (23xxx) e dados inválidos (22xxx) do PostgreSQL. A mensagem é
  // genérica: nome de constraint, tabela e valores não são expostos.
  const sqlState = getErrorCode(error);
  if (sqlState === "23505") {
    sendError(res, 409, "conflict", "The request conflicts with existing data.");
    return;
  }
  if (sqlState !== undefined && /^(22|23)/.test(sqlState)) {
    sendError(res, 422, "data_rejected", "The data was rejected by the database.");
    return;
  }

  // Erro inesperado: o cliente recebe uma mensagem genérica; detalhes ficam só no log.
  const name = error instanceof Error ? error.name : "UnknownError";
  const detail = error instanceof Error && env.NODE_ENV !== "production" ? `: ${error.message}` : "";
  console.error(`[error] Unhandled error (${name})${detail}`);

  sendError(res, 500, "internal_error", "Internal server error.");
};
