import { NextResponse } from 'next/server';
import { db, notes } from '@/db/client';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

// GET /api/notes -> list notes (no auth yet, returns all)
export async function GET() {
  try {
    const rows = db
      .select({ id: notes.id, title: notes.title, createdAt: notes.createdAt, updatedAt: notes.updatedAt, tags: notes.tags })
      .from(notes)
      .all();
    rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const out = rows.map((r) => {
      let tags: string[] | undefined = undefined;
      if (r.tags) {
        try {
          const arr = JSON.parse(r.tags as any);
          if (Array.isArray(arr)) tags = arr.filter((x: any) => typeof x === 'string');
        } catch {}
      }
      return { id: r.id, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, tags };
    });
    return NextResponse.json(out);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to list notes' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();

    db.insert(notes)
      .values({
        id,
        title: 'Untitled',
        contentJson: JSON.stringify(emptyDoc),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return NextResponse.json({ id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 });
  }
}
