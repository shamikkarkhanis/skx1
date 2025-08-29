import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { db, notes } from '@/db/client';
import { z } from 'zod';
import { embedTextWithOllama } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).optional().default(20),
});

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function parseEmbedding(s: string | null): number[] | null {
  if (!s) return null;
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr) && arr.every((x) => typeof x === 'number')) return arr as number[];
  } catch {}
  return null;
}

export async function POST(req: Request) {
  noStore();
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = SearchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    const { query, limit } = parsed.data;

    const qvec = await embedTextWithOllama(query);

    const rows = db.select().from(notes).all();

    const scored = [] as Array<{ id: string; title: string; createdAt: string | null; updatedAt: string | null; score: number }>;
    for (const r of rows as any[]) {
      const emb = parseEmbedding(r.embedding ?? null);
      if (!emb) continue;
      const score = cosineSimilarity(qvec, emb);
      scored.push({ id: r.id, title: r.title, createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null, score });
    }
    scored.sort((a, b) => b.score - a.score);

    return NextResponse.json(scored.slice(0, limit));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}