import { pgTable, uuid, timestamp, varchar, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { authUsers } from "./authSchema";
import { folders } from "./folders";

export const files = pgTable('files', {
    id: uuid('id').defaultRandom().primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }),
    userId: uuid('user_id').references(() => authUsers.id).notNull(),
    folderId: uuid('folder_id').references(() => folders.id).notNull(),
    name: varchar('name').notNull(),
    createdBy: varchar('created_by').notNull(),
    updatedBy: varchar('updated_by'),
    extension: varchar('extension').notNull(),
    size: doublePrecision('size').notNull(),
    path: varchar('path').notNull(),
    isFavourite: boolean('is_favourite').default(false).notNull(),
    isDeleted: boolean('is_deleted').default(false).notNull(),
})