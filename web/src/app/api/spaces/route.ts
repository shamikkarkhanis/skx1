import { NextResponse } from 'next/server';
import { db, spaces } from '@/db/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

// GET /api/spaces -> list all spaces
export async function GET() {
  try {
    const rows = db
      .select({ id: spaces.id, name: spaces.name, createdAt: spaces.createdAt, updatedAt: spaces.updatedAt })
      .from(spaces)
      .all();
    // Sort newest updated first
    rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return NextResponse.json(rows);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to list spaces' }, { status: 500 });
  }
}

const CreateSpaceSchema = z.object({
  name: z.string().min(1, 'name is required'),
});

// POST /api/spaces -> create a space
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = CreateSpaceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const name = parsed.data.name.trim();

    db.insert(spaces)
      .values({ id, name, createdAt: now, updatedAt: now })
      .run();

    return NextResponse.json({ id, name, createdAt: now, updatedAt: now });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to create space' }, { status: 500 });
  }
}

