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

// GET /api/notes/[id]
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  noStore(); // prevent caching/static optimization

  try {
    const id = params.id;
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
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  noStore(); // prevent caching/static optimization

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      // if your column is integer/timestamp, prefer Date.now()
      updatedAt: Date.now(),
    };

    if (typeof parsed.data.title === 'string') {
      updates.title = parsed.data.title;
    }
    if (parsed.data.contentJson !== undefined) {
      updates.contentJson = JSON.stringify(parsed.data.contentJson);
    }

    const id = params.id;

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
