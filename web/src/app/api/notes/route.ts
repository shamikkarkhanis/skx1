import { NextResponse } from 'next/server';
import { db, notes } from '@/db/client';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// BlockNote stores the document as an array of block objects
const emptyDoc: unknown[] = [];

// GET /api/notes -> list notes (no auth yet, returns all)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const spaceId = url.searchParams.get('spaceId')?.trim() || '';
    const base = db
      .select({ id: notes.id, title: notes.title, createdAt: notes.createdAt, updatedAt: notes.updatedAt, tags: notes.tags, folder: (notes as any).folder, spaceId: (notes as any).spaceId })
      .from(notes);
    const rows = (spaceId
      ? (base as any).where(eq((notes as any).spaceId, spaceId)).all()
      : base.all());
    rows.sort((a: any, b: any) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const out = rows.map((r: any) => {
      let tags: string[] | undefined = undefined;
      if (r.tags) {
        try {
          const arr = JSON.parse(r.tags as any);
          if (Array.isArray(arr)) tags = arr.filter((x: any) => typeof x === 'string');
        } catch {}
      }
      return { id: r.id, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, tags, folder: (r as any).folder ?? null, spaceId: (r as any).spaceId ?? null };
    });
    return NextResponse.json(out);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to list notes' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();
    let spaceId: string | null = null;
    try {
      const body = await req.json();
      if (body && typeof body.spaceId === 'string' && body.spaceId.trim()) {
        spaceId = body.spaceId.trim();
      }
    } catch {}

    db.insert(notes)
      .values({
        id,
        title: 'Untitled',
        contentJson: JSON.stringify(emptyDoc),
        createdAt: now,
        updatedAt: now,
        ...(spaceId ? { spaceId } as any : {}),
      })
      .run();

    return NextResponse.json({ id, spaceId });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 });
  }
}
