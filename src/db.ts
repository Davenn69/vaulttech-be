import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

dotenv.config();

const createUnconfiguredDb = () =>
  new Proxy(
    function runtimeDbProxy() {},
    {
      get() {
        return createUnconfiguredDb();
      },
      apply() {
        throw new Error(
          "Missing DATABASE_URL. Set it in Vercel environment variables.",
        );
      },
    },
  );

const connectionString = process.env.DATABASE_URL;
const client = connectionString ? postgres(connectionString) : null;

type DbClient = ReturnType<typeof drizzle>;

export const db: DbClient = client
  ? drizzle(client)
  : (createUnconfiguredDb() as unknown as DbClient);
