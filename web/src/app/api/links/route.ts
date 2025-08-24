import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { db, notes, noteChunks } from '@/db/client';
import { buildNoteTextForEmbedding, embedTextWithOllama } from '@/lib/embeddings';
import { generateTagsFromText } from '@/lib/tags';
import { computeFeatureScores, finalLinkScore, classifyLink } from '@/lib/linkScoring';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function safeParseJSON(input: string | null | undefined) {
  if (!input) return null;
  try { return JSON.parse(input); } catch { return null; }
}

function cosineSim(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb))));
}

function parseEmbedding(raw: string | null | undefined): number[] | null {
  const v = safeParseJSON(raw);
  return Array.isArray(v) ? (v.filter((x: any) => typeof x === 'number') as number[]) : null;
}

function parseTags(raw: string | null | undefined): string[] {
  try {
    const arr = safeParseJSON(raw);
    if (Array.isArray(arr)) return arr.filter((x: any) => typeof x === 'string');
  } catch {}
  return [];
}

function parseEntities(raw: string | null | undefined): Array<{ entity: string; weight?: number }> {
  const arr = safeParseJSON(raw);
  if (!Array.isArray(arr)) return [];
  const out: Array<{ entity: string; weight?: number }> = [];
  for (const it of arr) {
    if (!it) continue;
    const entity = typeof it.entity === 'string' ? it.entity : (typeof it.name === 'string' ? it.name : '');
    if (!entity) continue;
    const weight = Number(it.weight);
    out.push({ entity, weight: Number.isFinite(weight) ? weight : undefined });
  }
  return out;
}

async function ensureNoteVectorAndTags(row: any): Promise<{ vec: number[] | null; tags: string[] }>{
  let vec = parseEmbedding(row.embedding);
  let tags = parseTags(row.tags);
  if (vec && tags.length > 0) return { vec, tags };
  try {
    const contentJson = safeParseJSON(row.contentJson) ?? {};
    const text = buildNoteTextForEmbedding(row.title, contentJson);
    if (text) {
      if (!vec) vec = await embedTextWithOllama(text);
      if (tags.length === 0) {
        const t = await generateTagsFromText(text);
        if (Array.isArray(t)) tags = t as string[];
      }
    }
  } catch {}
  return { vec: vec ?? null, tags };
}

export async function GET() {
  noStore();
  try {
    const all = db.select().from(notes).all();
    if (!all || all.length === 0) {
      return new NextResponse('', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    // Precompute note-level vectors/tags/entities
    const meta: Record<string, { title: string; vec: number[] | null; tags: string[]; entities: Array<{entity: string; weight?: number}> }> = {};
    for (const n of all) {
      const { vec, tags } = await ensureNoteVectorAndTags(n);
      meta[n.id] = {
        title: n.title || n.id,
        vec,
        tags,
        entities: parseEntities((n as any).entities),
      };
    }

    // Compute links for every ordered pair A -> B where A != B
    type Edge = { aId: string; bId: string; score: number; decision: 'hard' | 'soft' | 'none' };
    const edges: Edge[] = [];

    for (const A of all) {
      const aId = A.id;
      const aMeta = meta[aId];
      const aVec = aMeta.vec ?? parseEmbedding(A.embedding) ?? [];
      for (const B of all) {
        if (B.id === aId) continue;
        let cos = 0;
        try {
          const chunks = db.select().from(noteChunks).where(eq(noteChunks.noteId, B.id)).all();
          if (chunks && chunks.length > 0) {
            for (const ch of chunks) {
              const cvec = parseEmbedding((ch as any).embedding);
              if (cvec && cvec.length === aVec.length) {
                const c = cosineSim(aVec, cvec);
                if (c > cos) cos = c;
              }
            }
          } else {
            const bVec = meta[B.id].vec ?? parseEmbedding(B.embedding);
            if (bVec && bVec.length === aVec.length) cos = cosineSim(aVec, bVec);
          }
        } catch {}
        if (cos === 0) continue;

        const featureInput = {
          top5_cosines: [cos],
          entitiesA: meta[aId].entities,
          entitiesB: meta[B.id].entities,
          tagsA: meta[aId].tags,
          tagsB: meta[B.id].tags,
          structural: { reference_score: 0, temporal_score: 0, session_score: 0 },
          aggregate: 'mean' as const,
        };
        const feats = computeFeatureScores(featureInput);
        const score = finalLinkScore(feats);
        const decision = classifyLink(score);
        if (decision !== 'none') {
          edges.push({ aId, bId: B.id, score, decision });
        }
      }
    }

    // Sort edges by score desc for stable output
    edges.sort((x, y) => y.score - x.score);

    // Build text output: "A->B" using titles
    const lines: string[] = [];
    for (const e of edges) {
      const aTitle = meta[e.aId].title || e.aId;
      const bTitle = meta[e.bId].title || e.bId;
      lines.push(`${aTitle}->${bTitle}`);
    }

    const body = lines.join('\n');
    return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (e) {
    console.error(e);
    return new NextResponse('Failed to compute global links', { status: 500, headers: { 'Content-Type': 'text/plain' } });
  }
}
