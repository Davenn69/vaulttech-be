import http from "http";
import app from "./app";
import "./db";
const PORT = process.env.PORT;

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server is running in PORT ${PORT}`);
});
