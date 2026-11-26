export interface ErrorDetail {
  path: string;
  message: string;
}

/** Erro esperado, com status HTTP e código estável. Tratado em error.middleware.ts. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
  }
}
