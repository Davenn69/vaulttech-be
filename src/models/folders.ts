import {
  boolean,
  foreignKey,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth";

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    parentId: uuid("parent_id"),
    name: varchar("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
    createdBy: varchar("created_by").notNull(),
    updatedBy: varchar("updated_by"),
    path: varchar("path").notNull(),
    isFavourite: boolean("is_favourite").default(false).notNull(),
    isDeleted: boolean("is_deleted").default(false).notNull(),
  },
  (table) => {
    return {
      parentReference: foreignKey({
        columns: [table.parentId],
        foreignColumns: [table.id],
        name: "folders_parent_id_fkey",
      }),
    };
  }
);
