import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { db, notes } from '@/db/client';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { buildNoteTextForEmbedding, embedTextWithOllama, extractPlainTextFromTiptap } from '@/lib/embeddings';
import { generateTagsFromText } from '@/lib/tags';
import { generateTitleFromText } from '@/lib/title';

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

    // Compute and store embedding and tags (best-effort)
    try {
      // Get latest values for title/content to embed (prefer updates)
      let titleForEmbed: string | undefined = (updates.title as string | undefined) ?? existing?.title;
      let contentForEmbed: unknown = parsed.data.contentJson !== undefined
        ? parsed.data.contentJson
        : (existing ? safeParseJSON(existing.contentJson) ?? {} : {});

      const text = buildNoteTextForEmbedding(titleForEmbed, contentForEmbed);
      if (text && text.length > 0) {
        const vec = await embedTextWithOllama(text);
        updates.embedding = JSON.stringify(vec);
        try {
          const tags = await generateTagsFromText(text);
          if (Array.isArray(tags)) {
            updates.tags = JSON.stringify(tags);
          }
        } catch (e) {
          console.warn('Tag generation failed; proceeding without updating tags', e);
        }
      }
    } catch (e) {
      // Do not fail the save if embeddings are unavailable
      console.warn('Embedding/tagging computation failed; proceeding without updating embedding/tags', e);
    }

    db.update(notes).set(updates).where(eq(notes.id, id)).run(); // sync call

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
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
