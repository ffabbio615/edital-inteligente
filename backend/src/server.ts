import { createApp } from "./app";
import { env } from "./config/env";
import { closeDatabase, isDatabaseConfigured } from "./database/connection";

const app = createApp();

const server = app.listen(env.PORT, () => {
  const database = isDatabaseConfigured() ? "configured" : "not configured";
  console.log(`[server] Edital Inteligente API listening on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`[server] Health check: ${env.API_PREFIX}/health | database: ${database}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(`[server] Failed to start (${error.code ?? error.name})`);
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[server] ${signal} received, shutting down...`);

  // Garante o encerramento mesmo se houver conexões abertas.
  setTimeout(() => process.exit(1), 10000).unref();

  server.close(() => {
    void closeDatabase().finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
