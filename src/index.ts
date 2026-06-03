import http from "http";
import app from "./app";
import "./db";
import { attachWordCollaborationServer } from "./realtime/wordCollaborationServer";
const PORT = process.env.PORT;

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
