import {
  bigint,
  bigserial,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { documentSupervisors } from "./document_supervisors";
import { authUsers } from "./auth";

export const approvalComments = pgTable("approval_comments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  documentSupervisorId: uuid("document_supervisor_id")
    .references(() => documentSupervisors.id)
    .notNull(),
  status: varchar("status").notNull(),
  comment: text("comment"),
  createdBy: uuid("created_by")
    .references(() => authUsers.id)
    .notNull(),
});
