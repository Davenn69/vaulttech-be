import {
  bigserial,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { files } from "./files";
import { authUsers } from "./auth";

export const documentSupervisors = pgTable("document_supervisors", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  fileId: uuid("file_id")
    .references(() => files.id)
    .notNull(),
  supervisorId: uuid("supervisor_id")
    .references(() => authUsers.id)
    .notNull(),
  status: varchar("status"),
  invitedBy: uuid("invited_by").references(() => authUsers.id),
  invitedAt: timestamp("invited_at", { withTimezone: true, mode: "string" }),
  respondedAt: timestamp("responded_at", {
    withTimezone: true,
    mode: "string",
  }),
});
