import express, { NextFunction, Request, Response } from "express"
import logger from "./middlewares/logger"
import errorHandler from "./middlewares/error"
import authRoutes from "./routes/authRoutes"
import fileRoute from "./routes/fileRoutes"
import multer from "multer"
import { protect } from "./middlewares/protected"

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(logger)

//handlers
app.use("/api/v1/auth", authRoutes)
app.use("/api/v1/file", protect, fileRoute)
//

app.use(errorHandler)

export default app