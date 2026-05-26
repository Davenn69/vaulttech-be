import {
  bigserial,
  boolean,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { folders } from "./folders";
import { authUsers } from "./auth";

export const folderPermissions = pgTable("folder_permissions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  folderId: uuid("folder_id")
    .references(() => folders.id)
    .notNull(),
  grantedTo: uuid("granted_to")
    .references(() => authUsers.id)
    .notNull(),
  grantedBy: uuid("granted_by")
    .references(() => authUsers.id)
    .notNull(),
  permissionType: varchar("permission_type").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});
