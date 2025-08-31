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
  // JSON stringified array of entities with weights: [{entity, weight}]
  entities: text('entities'),
  // Optional manual folder name (UI grouping)
  folder: text('folder'),
  // Optional foreign key to a space
  spaceId: text('space_id'),
});

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

// Chunks table: stores per-note text chunks and their embeddings
export const noteChunks = sqliteTable('note_chunks', {
  id: text('id').primaryKey(),
  noteId: text('note_id').notNull(),
  ord: text('ord').notNull(), // store as TEXT to keep schema simple; parsed as integer in code
  text: text('text').notNull(),
  embedding: text('embedding'), // JSON stringified number[]
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type NoteChunk = typeof noteChunks.$inferSelect;
export type NewNoteChunk = typeof noteChunks.$inferInsert;

// Spaces table: groups of notes
export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type Space = typeof spaces.$inferSelect;
export type NewSpace = typeof spaces.$inferInsert;

