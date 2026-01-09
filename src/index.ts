import postgres from "postgres";
import app from "./app";
import dotenv from "dotenv"
import { drizzle } from "drizzle-orm/postgres-js";

dotenv.config()
const PORT = process.env.PORT
const connectionString = process.env.DATABASE_URL!

console.log(connectionString)

const client = postgres(connectionString)
export const db = drizzle(client)

app.listen(PORT, () => {
    console.log(`Server is running in PORT ${PORT}`)
})