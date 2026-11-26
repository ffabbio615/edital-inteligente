import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error";

const HEADER_NAME = "x-integration-key";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Exige o header x-integration-key. Sem segredo configurado, o acesso é negado (fail closed).
 * A comparação usa os hashes SHA-256 (tamanho fixo) com timingSafeEqual, evitando
 * vazamento por diferença de tempo ou de tamanho. A chave nunca é registrada em log.
 */
export function createIntegrationAuth(secret: string | undefined): RequestHandler {
  const expected = secret ? sha256(secret) : undefined;

  return (req, _res, next) => {
    if (!expected) {
      next(new AppError(503, "integration_not_configured", "The integration endpoint is not configured."));
      return;
    }

    const provided = req.header(HEADER_NAME);
    if (!provided || !timingSafeEqual(sha256(provided), expected)) {
      next(new AppError(401, "unauthorized", "Invalid or missing integration key."));
      return;
    }

    next();
  };
}
