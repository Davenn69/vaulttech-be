import http from "http";
import postgres from "postgres";
import app from "./app";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { attachWordCollaborationServer } from "./realtime/wordCollaborationServer";

dotenv.config();
const PORT = process.env.PORT;
const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString);
export const db = drizzle(client);

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

const server = http.createServer(app);

attachWordCollaborationServer(server);

server.listen(PORT, () => {
  console.log(`Server is running in PORT ${PORT}`);
});
