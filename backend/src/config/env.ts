import "dotenv/config";
import { z } from "zod";

// Variáveis vazias no .env (ex.: "DB_HOST=") são tratadas como ausentes.
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const booleanString = z.preprocess(
  (value) => {
    const normalized = emptyToUndefined(value);
    return typeof normalized === "string" ? normalized.trim().toLowerCase() : normalized;
  },
  z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
);

const port = (defaultValue: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(defaultValue));

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "production", "test"]).default("development"),
  ),
  PORT: port(3001),
  API_PREFIX: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\/[A-Za-z0-9\-_/]*$/, "must start with '/' and contain only letters, numbers, '-', '_' or '/'")
      .default("/api"),
  ),

  // Banco de dados: todos opcionais, o servidor inicia sem eles.
  DATABASE_URL: optionalString,
  DB_HOST: optionalString,
  DB_PORT: port(5432),
  DB_NAME: optionalString,
  DB_USER: optionalString,
  DB_PASSWORD: optionalString,
  DB_SSL: booleanString,

  // Chave do endpoint de integração com o n8n (header x-integration-key).
  // Obrigatória em produção. Sem ela, o endpoint nega todas as requisições.
  N8N_INTEGRATION_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(32, "must have at least 32 characters").optional(),
  ),

  // Reservadas para uso futuro (n8n e Gemini).
  N8N_WEBHOOK_URL: optionalString,
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === "production" && !value.N8N_INTEGRATION_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["N8N_INTEGRATION_SECRET"],
      message: "is required in production",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // Exibe apenas o nome da variável e o motivo, nunca o valor informado.
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(`Invalid environment configuration:\n${problems}`);
    process.exit(1);
  }

  return result.data;
}

export const env: Env = loadEnv();
