import { NextResponse } from 'next/server';
import { db, notes } from '@/db/client';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

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
