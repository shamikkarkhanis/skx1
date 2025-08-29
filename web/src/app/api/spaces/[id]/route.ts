import { NextResponse } from 'next/server';
import { db, notes, spaces } from '@/db/client';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = params?.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const row = db
    .select({ id: spaces.id, name: spaces.name, createdAt: spaces.createdAt, updatedAt: spaces.updatedAt })
    .from(spaces)
    .where(eq(spaces.id, id))
    .get();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = params?.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const json = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  }
  const { name } = parsed.data;
  // ensure exists
  const existing = db.select().from(spaces).where(eq(spaces.id, id)).get();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const updateSet: any = { updatedAt: new Date().toISOString() };
  if (typeof name === 'string') updateSet.name = name;
  db.update(spaces).set(updateSet).where(eq(spaces.id, id)).run();
  const row = db
    .select({ id: spaces.id, name: spaces.name, createdAt: spaces.createdAt, updatedAt: spaces.updatedAt })
    .from(spaces)
    .where(eq(spaces.id, id))
    .get();
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = params?.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  // ensure exists
  const existing = db.select().from(spaces).where(eq(spaces.id, id)).get();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Optional: detach notes from this space to avoid orphan references
  try {
    (db.update(notes as any) as any).set({ spaceId: null }).where(eq((notes as any).spaceId, id)).run?.();
  } catch {}
  db.delete(spaces).where(eq(spaces.id, id)).run();
  return NextResponse.json({ ok: true });
}
