import {
  boolean,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth";

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
  name: varchar("name").notNull(),
  color: varchar("color").notNull(),
  approvalRequired: boolean("approval_required").default(false).notNull(),
  approvalRole: varchar("approval_role"),
  userId: uuid("user_id")
    .references(() => authUsers.id)
    .notNull(),
});
