import {
  bigserial,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth";

export const approvalComments = pgTable("approval_comments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  documentSupervisorId: uuid("document_supervisor_id").notNull(),
  comment: text("comment"),
  createdBy: uuid("created_by")
    .references(() => authUsers.id)
    .notNull(),
});
