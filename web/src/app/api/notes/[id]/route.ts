import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { db, notes } from '@/db/client';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

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

    if (typeof parsed.data.title === 'string') {
      updates.title = parsed.data.title;
    }
    if (parsed.data.contentJson !== undefined) {
      updates.contentJson = JSON.stringify(parsed.data.contentJson);
    }

    const id = await resolveId(req, context);
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    // Enforce ownership here if you have auth:
    // const session = await getServerSession();
    // await assertUserOwnsNote(session.user.id, id);

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
