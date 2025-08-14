import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  // Stored as a JSON string
  contentJson: text('content_json').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  // JSON stringified embedding vector (number[])
  embedding: text('embedding'),
  // JSON stringified array of tags (string[])
  tags: text('tags'),
});

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
