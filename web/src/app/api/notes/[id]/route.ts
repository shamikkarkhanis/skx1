import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { db, notes, noteChunks } from '@/db/client';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { buildNoteTextForEmbedding, embedTextWithOllama, extractPlainTextFromTiptap } from '@/lib/embeddings';
import { generateTagsFromText } from '@/lib/tags';
import { generateTitleFromText } from '@/lib/title';
import { chunkText } from '@/lib/chunking';
import { generateEntitiesFromText, aggregateEntities } from '@/lib/entities';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const UpdateSchema = z.object({
  title: z.string().optional(),
  contentJson: z.unknown().optional(),
});

function safeParseJSON(input: string | null | undefined) {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function deriveTitleFromPlainText(text: string): string {
  const firstLine = text
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) ?? '';
  return firstLine.slice(0, 120);
}


// Resolve `id` defensively: prefer awaited context.params, fall back to URL parsing
async function resolveId(
  req: Request,
  context: { params?: Promise<{ id?: string }> | { id?: string } }
): Promise<string | null> {
  try {
    const p = await (context as any)?.params;
    if (p?.id) return p.id as string;
  } catch {}
  try {
    const url = new URL(req.url);
    const segs = url.pathname.split('/').filter(Boolean);
    return (segs[segs.length - 1] as string) || null;
  } catch {
    return null;
  }
}

// GET /api/notes/[id]
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  noStore(); // prevent caching/static optimization

  try {
    const id = await resolveId(req, context);
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    const rows = db.select().from(notes).where(eq(notes.id, id)).all(); // sync (better-sqlite3)
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: row.id,
      title: row.title,
      contentJson: safeParseJSON(row.contentJson) ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to fetch note' }, { status: 500 });
  }
}

// PUT /api/notes/[id]
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  noStore(); // prevent caching/static optimization

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      // align with TEXT column type
      updatedAt: new Date().toISOString(),
    };

    const id = await resolveId(req, context);
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    // Enforce ownership here if you have auth:
    // const session = await getServerSession();
    // await assertUserOwnsNote(session.user.id, id);

    // Fetch existing to have a single source of truth for title/content
    const existing = db.select().from(notes).where(eq(notes.id, id)).all()[0];

    // Apply incoming content update (if any)
    if (parsed.data.contentJson !== undefined) {
      updates.contentJson = JSON.stringify(parsed.data.contentJson);
    }

    // Always use AI-generated title from content; on failure, fall back to raw text title
    const contentForTitle: unknown = parsed.data.contentJson !== undefined
      ? parsed.data.contentJson
      : (existing ? safeParseJSON(existing.contentJson) ?? {} : {});
    try {
      const plain = extractPlainTextFromTiptap(contentForTitle);
      if (!plain) {
        updates.title = '';
      } else {
        try {
          const autoTitle = await generateTitleFromText(plain);
          updates.title = autoTitle && autoTitle.trim().length > 0 ? autoTitle.trim() : deriveTitleFromPlainText(plain);
        } catch {
          updates.title = deriveTitleFromPlainText(plain);
        }
      }
    } catch {
      // If even plain extraction fails, leave as empty string
      updates.title = '';
    }

    // Persist minimal updates first (content + title)
    db.update(notes).set(updates).where(eq(notes.id, id)).run(); // sync call

    // Fire-and-forget heavy processing: embeddings, tags, chunk embeddings, entities
  try { console.log(`[bg] scheduling background processing for note ${id}`); } catch {}
  setImmediate(() => {
    try { console.log(`[bg] start processing note ${id}`); } catch {}
    processNoteHeavyWork(id).catch((e) => console.error('Background processing failed', e));
  });

    return NextResponse.json({ ok: true, title: updates.title ?? existing?.title ?? '' });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
  }
}

async function processNoteHeavyWork(id: string) {
  try {
    try { console.log(`[bg] start processing note ${id}`); } catch {}
    const existing = db.select().from(notes).where(eq(notes.id, id)).all()[0];
    if (!existing) {
      console.error('Note not found for heavy processing');
      return;
    }

    // Compute and store embedding, tags, and chunk embeddings (best-effort)
    try {
      // Get latest values for title/content to embed (prefer updates)
      let titleForEmbed: string | undefined = existing.title;
      let contentForEmbed: unknown = safeParseJSON(existing.contentJson) ?? {};

      const text = buildNoteTextForEmbedding(titleForEmbed, contentForEmbed);
      if (text && text.length > 0) {
        const vec = await embedTextWithOllama(text);
        db.update(notes).set({ embedding: JSON.stringify(vec) }).where(eq(notes.id, id)).run();
        try { console.log(`[bg] note ${id} embedding length: ${Array.isArray(vec) ? vec.length : 0}`); } catch {}
        try {
          const tags = await generateTagsFromText(text);
          if (Array.isArray(tags)) {
            db.update(notes).set({ tags: JSON.stringify(tags) }).where(eq(notes.id, id)).run();
            try { console.log(`[bg] note ${id} tags count: ${tags.length}`); } catch {}
          }
        } catch (e) {
          console.warn('Tag generation failed; proceeding without updating tags', e);
        }

        // Chunking over body text (prefer excluding the synthesized title)
        try {
          const plainBody = extractPlainTextFromTiptap(contentForEmbed);
          if (plainBody && plainBody.length > 0) {
            const chunks = chunkText(plainBody, { targetTokens: 350, overlapTokens: 80 });
            try { console.log(`[bg] note ${id} chunk count: ${chunks.length}`); } catch {}
            // Replace existing chunks for this note
            db.delete(noteChunks).where(eq(noteChunks.noteId, id)).run();
            const allEntities: Array<{ entity: string; weight?: number }> = [];
            for (const ch of chunks) {
              try {
                const cvec = await embedTextWithOllama(ch.text);
                db.insert(noteChunks).values({
                  id: randomUUID(),
                  noteId: id,
                  ord: String(ch.ord),
                  text: ch.text,
                  embedding: JSON.stringify(cvec),
                }).run();
                try { console.log(`[bg] note ${id} chunk ${ch.ord} embedding length: ${Array.isArray(cvec) ? cvec.length : 0}`); } catch {}
                try {
                  const ents = await generateEntitiesFromText(ch.text);
                  for (const e of ents) allEntities.push({ entity: e.entity, weight: e.weight });
                } catch (e) {
                  console.warn('Entity extraction failed for chunk; continuing', e);
                }
              } catch (e) {
                console.warn('Failed to embed chunk; skipping chunk', e);
              }
            }
            if (allEntities.length > 0) {
              const agg = aggregateEntities(allEntities);
              db.update(notes).set({ entities: JSON.stringify(agg) }).where(eq(notes.id, id)).run();
              try { console.log(`[bg] note ${id} entities count (aggregated): ${agg.length}`); } catch {}
            } else {
              db.update(notes).set({ entities: JSON.stringify([]) }).where(eq(notes.id, id)).run();
              try { console.log(`[bg] note ${id} entities count (aggregated): 0`); } catch {}
            }
          } else {
            // No body text; remove any existing chunks
            db.delete(noteChunks).where(eq(noteChunks.noteId, id)).run();
            db.update(notes).set({ entities: JSON.stringify([]) }).where(eq(notes.id, id)).run();
            try { console.log(`[bg] note ${id} no body text; cleared chunks and entities`); } catch {}
          }
        } catch (e) {
          console.warn('Chunking/embedding chunks failed; proceeding without chunk storage', e);
        }
      }
    } catch (e) {
      // Do not fail the save if embeddings are unavailable
      console.warn('Embedding/tagging/chunk computation failed; proceeding without updating embedding/tags/chunks', e);
    }
  } catch (e) {
    console.error('Error processing note heavy work', e);
  } finally {
    try { console.log(`[bg] done processing note ${id}`); } catch {}
  }
}

// DELETE /api/notes/[id]
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  noStore();

  try {
    const id = await resolveId(req, context);
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const rows = db.select().from(notes).where(eq(notes.id, id)).all();
    if (!rows[0]) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    db.delete(notes).where(eq(notes.id, id)).run();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
  }
}
