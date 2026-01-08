import { boolean, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { authUsers } from "./authSchema";

export const folders = pgTable('folders', {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => authUsers.id,),
    name: varchar('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdBy: varchar('created_by').notNull(),
    updatedBy: varchar('updated_by'),
    path: varchar('path').notNull(),
    isFavourite: boolean('is_favourite').notNull(),
    isDeleted: boolean('is_deleted').notNull(),
})