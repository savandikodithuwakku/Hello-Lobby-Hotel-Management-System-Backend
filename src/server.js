import env, { assertEnvIsValid } from "./config/env.js";
import connectDB, { disconnectDB } from "./config/database.js";
import app from "./app.js";

let server;

const shutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server?.close(async () => {
    await disconnectDB();
    process.exit(0);
  });

  // Never hang forever waiting for in-flight requests.
  setTimeout(() => process.exit(1), 10000).unref();
};

const start = async () => {
  assertEnvIsValid();
  await connectDB();

  server = app.listen(env.app.port, () => {
    console.log(`${env.app.name} API listening on port ${env.app.port} [${env.nodeEnv}]`);
    console.log(`Base URL: http://localhost:${env.app.port}${env.app.apiPrefix}`);
  });
};

["SIGINT", "SIGTERM"].forEach((signal) => process.on(signal, () => shutdown(signal)));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  shutdown("unhandledRejection");
});

start().catch((error) => {
  console.error("Failed to start server:", error.message);
  process.exit(1);
});
