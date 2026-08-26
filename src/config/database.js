import mongoose from "mongoose";
import env from "./env.js";

mongoose.set("strictQuery", true);

const CONNECT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

/**
 * `mongodb+srv://` URIs need a DNS SRV lookup before the driver can reach the
 * cluster, and local resolvers fail that lookup intermittently. Those failures
 * clear on their own, so a short retry is worth more than an immediate crash.
 */
const isTransientConnectionError = (error) =>
  ["ENOTFOUND", "EAI_AGAIN", "ETIMEOUT", "ESERVFAIL", "ECONNRESET"].includes(error.code) ||
  error.name === "MongooseServerSelectionError";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const connectDB = async () => {
  let lastError;

  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      const connection = await mongoose.connect(env.db.uri, {
        serverSelectionTimeoutMS: 10000,
        autoIndex: !env.isProduction,
      });

      mongoose.connection.on("error", (error) => {
        console.error("MongoDB connection error:", error.message);
      });

      mongoose.connection.on("disconnected", () => {
        console.warn("MongoDB disconnected");
      });

      console.log(`MongoDB connected: ${connection.connection.host}/${connection.connection.name}`);
      return connection;
    } catch (error) {
      lastError = error;

      if (attempt === CONNECT_ATTEMPTS || !isTransientConnectionError(error)) {
        break;
      }

      console.warn(
        `MongoDB connection attempt ${attempt}/${CONNECT_ATTEMPTS} failed (${error.message}). Retrying...`
      );
      await wait(RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
};

export const disconnectDB = () => mongoose.connection.close();

export default connectDB;
