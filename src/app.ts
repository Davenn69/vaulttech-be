import express from "express"
import logger from "./middlewares/logger"

const app = express()

app.use(logger)

export default app