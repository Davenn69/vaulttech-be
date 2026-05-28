import {
  bigserial,
  boolean,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { files } from "./files";
import { authUsers } from "./auth";

export const filePermissions = pgTable("file_permissions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  permissionType: varchar("permission_type").notNull(),
  grantedBy: uuid("granted_by")
    .references(() => authUsers.id)
    .notNull(),
  fileId: uuid("file_id")
    .references(() => files.id)
    .notNull(),
  grantedTo: uuid("granted_to")
    .references(() => authUsers.id)
    .notNull(),
});
