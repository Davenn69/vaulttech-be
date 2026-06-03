import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { files } from "./files";
import { authUsers } from "./auth";

export const wordCollaborationDocuments = pgTable(
  "word_collaboration_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileId: uuid("file_id")
      .references(() => files.id)
      .notNull(),
    state: jsonb("state").notNull(),
    versionNumber: integer("version_number").default(1).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedBy: uuid("updated_by").references(() => authUsers.id),
  },
);

export const wordCollaborationSessions = pgTable(
  "word_collaboration_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileId: uuid("file_id")
      .references(() => files.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => authUsers.id)
      .notNull(),
    connectionId: varchar("connection_id").notNull(),
    cursorState: jsonb("cursor_state"),
    selectionState: jsonb("selection_state"),
    isActive: boolean("is_active").default(true).notNull(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
);

export const wordCollaborationEvents = pgTable("word_collaboration_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileId: uuid("file_id")
    .references(() => files.id)
    .notNull(),
  createdBy: uuid("created_by")
    .references(() => authUsers.id)
    .notNull(),
  eventType: varchar("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});
