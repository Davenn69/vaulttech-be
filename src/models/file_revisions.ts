import {
  doublePrecision,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { files } from "./files";

export const fileRevisions = pgTable("file_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileId: uuid("file_id")
    .references(() => files.id)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  versionNumber: doublePrecision("version_number").notNull(),
  storageKey: varchar("storage_key").notNull(),
  fileHash: varchar("file_hash").notNull(),
  size: doublePrecision("size").notNull(),
});
