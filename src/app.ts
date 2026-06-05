import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import logger from "./middlewares/logger";
import errorHandler from "./middlewares/error";
import authRoutes from "./routes/authRoutes";
import fileRoute from "./routes/fileRoutes";
import folderRoute from "./routes/folderRoutes";
import categoryRoute from "./routes/categoryRoutes";
import recentRoutes from "./routes/recentRoutes";
import searchRoutes from "./routes/searchRoutes";
import wordRoutes from "./routes/wordRoutes";
import excelRoutes from "./routes/excelRoutes";
import revisionRoutes from "./routes/revisionRoutes";
import invitationRoutes from "./routes/invitationRoutes";
import reviewRoutes from "./routes/reviewRoutes";
import permissionRoutes from "./routes/permissionRoutes";
import { protect } from "./middlewares/protected";
import { notFound } from "./middlewares/notFound";
import { drizzleError } from "./middlewares/postgresError";
import cors from "cors";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();
const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://192.168.126.1:3000",
];

const envAllowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envAllowedOrigins])];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

//Added Cors policy (Remove when done)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  }),
);

app.use(logger);

//handlers
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/file", protect, fileRoute);
app.use("/api/v1/folder", protect, folderRoute);
app.use("/api/v1/category", protect, categoryRoute);
app.use("/api/v1/recent", protect, recentRoutes);
app.use("/api/v1/search", protect, searchRoutes);
app.use("/api/v1/word", protect, wordRoutes);
app.use("/api/v1/excel", protect, excelRoutes);
app.use("/api/v1/revision", protect, revisionRoutes);
app.use("/api/v1/invitation", protect, invitationRoutes);
app.use("/api/v1/review", protect, reviewRoutes);
app.use("/api/v1/permission", protect, permissionRoutes);
//

app.get("/debug-env", (req, res) => {
  res.json({
    hasDatabaseUrl: !!process.env.DATABASE_URL,
  });
});

app.use(drizzleError);
app.use(errorHandler);

app.use(notFound);

export default app;
