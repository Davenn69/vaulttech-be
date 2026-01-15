import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth";
import { folders } from "./folders";

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id),
  username: varchar("username").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { mode: "string" }),
  homeFolderId: uuid("home_folder_id").references(() => folders.id),
});
