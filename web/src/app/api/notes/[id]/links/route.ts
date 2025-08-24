import { NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { db, notes, noteChunks } from '@/db/client';
import { eq, ne } from 'drizzle-orm';
import { buildNoteTextForEmbedding, embedTextWithOllama, extractPlainTextFromTiptap } from '@/lib/embeddings';
import { generateTagsFromText } from '@/lib/tags';
import { aggregateSemantic, buildExplain, classifyLink, computeFeatureScores, finalLinkScore } from '@/lib/linkScoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function safeParseJSON(input: string | null | undefined) {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
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

function parseTags(raw: string | null | undefined): string[] {
  try {
    const arr = safeParseJSON(raw);
    if (Array.isArray(arr)) return arr.filter((x: any) => typeof x === 'string');
  } catch {}
  return [];
}

function parseEmbedding(raw: string | null | undefined): number[] | null {
  const v = safeParseJSON(raw);
  return Array.isArray(v) ? (v.filter((x: any) => typeof x === 'number') as number[]) : null;
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

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  noStore();
  try {
    const p = await context.params;
    const id = p?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const url = new URL(req.url);
    const min = Math.max(0, Math.min(1, Number(url.searchParams.get('min')) || 0.7));
    const topk = Math.max(1, Math.min(25, Number(url.searchParams.get('topk')) || 3));

    // Load target note
    const target = db.select().from(notes).where(eq(notes.id, id)).all()[0];
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    try { console.log(`[links:${id}] computing links for note "${target.title}" (${id}) min=${min} topk=${topk}`); } catch {}

    // Ensure embedding/tags exist; best-effort compute
    let targetEmbedding = parseEmbedding(target.embedding);
    let targetTags = parseTags(target.tags);

    if (!targetEmbedding || targetTags.length === 0) {
      try {
        const contentJson = safeParseJSON(target.contentJson) ?? {};
        const text = buildNoteTextForEmbedding(target.title, contentJson);
        if (text) {
          if (!targetEmbedding) {
            targetEmbedding = await embedTextWithOllama(text);
            try { console.log(`[links:${id}] computed missing target embedding (len=${(targetEmbedding||[]).length})`); } catch {}
          }
          if (targetTags.length === 0) {
            const tags = await generateTagsFromText(text);
            if (Array.isArray(tags)) targetTags = tags as string[];
            try { console.log(`[links:${id}] computed missing target tags (count=${targetTags.length})`); } catch {}
          }
        }
      } catch (e) {
        // continue without blocking
        console.warn('Failed to compute missing embedding/tags for target note', e);
      }
    }

    // Fetch other notes
    const candidates = db
      .select()
      .from(notes)
      .where(ne(notes.id, id))
      .all();
    try { console.log(`[links:${id}] candidates=${candidates.length}`); } catch {}

    const targetVec = targetEmbedding ?? parseEmbedding(target.embedding) ?? [];

    // Load all target chunks and their embeddings/text
    let targetChunks: Array<{ idx: number; text: string; vec: number[] | null }> = [];
    try {
      const tChunks = db.select().from(noteChunks).where(eq(noteChunks.noteId, id)).all();
      targetChunks = tChunks.map((ch: any, idx: number) => ({
        idx,
        text: String(ch.text || ''),
        vec: parseEmbedding(ch.embedding),
      }));
    } catch {}

    const entitiesTarget = parseEntities((target as any).entities);

    const scored = candidates
      .map((row: any) => {
        // Compute cross-chunk matches between target note and candidate note
        let cos = 0;
        const matches: Array<{
          sim: number;
          targetChunkIdx: number;
          targetText: string;
          candidateChunkIdx: number;
          candidateText: string;
        }> = [];
        try {
          const candChunks = db.select().from(noteChunks).where(eq(noteChunks.noteId, row.id)).all();
          const cand = candChunks.map((ch: any, idx: number) => ({
            idx,
            text: String(ch.text || ''),
            vec: parseEmbedding(ch.embedding),
          }));

          const dim = (() => {
            const tv = targetChunks.find((t: any) => Array.isArray(t.vec) && t.vec.length)?.vec?.length || 0;
            const cv = cand.find((t: any) => Array.isArray(t.vec) && t.vec.length)?.vec?.length || 0;
            return tv && cv && tv === cv ? tv : 0;
          })();

          if (dim > 0 && cand.length > 0 && targetChunks.length > 0) {
            // Consider all pairs targetChunk x candChunk, filter by min, collect topk overall
            for (const t of targetChunks) {
              if (!Array.isArray(t.vec) || t.vec.length !== dim) continue;
              for (const c of cand) {
                if (!Array.isArray(c.vec) || c.vec.length !== dim) continue;
                const s = cosineSim(t.vec!, c.vec!);
                if (s >= min) {
                  matches.push({
                    sim: s,
                    targetChunkIdx: t.idx,
                    targetText: t.text,
                    candidateChunkIdx: c.idx,
                    candidateText: c.text,
                  });
                }
                if (s > cos) cos = s;
              }
            }
            matches.sort((a, b) => b.sim - a.sim);
            if (matches.length > topk) matches.length = topk;
          } else {
            // Fallback to note-level embedding if chunk dims mismatch or missing
            const candVec = parseEmbedding(row.embedding);
            if (candVec && targetVec && candVec.length === targetVec.length) {
              cos = cosineSim(targetVec, candVec);
            }
          }
        } catch {
          const candVec = parseEmbedding(row.embedding);
          if (candVec && targetVec && candVec.length === targetVec.length) {
            cos = cosineSim(targetVec, candVec);
          }
        }
        if (cos === 0) return null;
        try { console.log(`[links:${id}] cosine -> ${row.id} (${row.title}) = ${cos.toFixed(3)} matches=${matches.length}`); } catch {}
        const tagA = targetTags;
        const tagB = parseTags(row.tags);
        const entitiesB = parseEntities((row as any).entities);

        const featureInput = {
          top5_cosines: [cos],
          entitiesA: entitiesTarget,
          entitiesB: entitiesB,
          tagsA: tagA,
          tagsB: tagB,
          structural: { reference_score: 0, temporal_score: 0, session_score: 0 },
          aggregate: 'mean' as const,
        };
        const feats = computeFeatureScores(featureInput);
        const score = finalLinkScore(feats);
        const decision = classifyLink(score);
        if (decision !== 'none') {
          try { console.log(`[links:${id}] add link ${target.title}->${row.title} score=${score.toFixed(3)} decision=${decision}`); } catch {}
        }
        const explain = buildExplain(featureInput);
        // Note-level shared entities (case-insensitive intersection by name)
        const entAset = new Set(entitiesTarget.map((e) => (e.entity || '').toLowerCase()).filter(Boolean));
        const entBset = new Set(entitiesB.map((e) => (e.entity || '').toLowerCase()).filter(Boolean));
        const sharedEntities = Array.from(entAset).filter((x) => entBset.has(x));
        return {
          id: row.id,
          title: row.title,
          score,
          decision,
          explain,
          features: feats,
          sharedEntities,
          matches: matches.map((m) => ({
            sim: Number(m.sim.toFixed(3)),
            targetChunkIdx: m.targetChunkIdx,
            targetText: (m.targetText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
            candidateChunkIdx: m.candidateChunkIdx,
            candidateText: (m.candidateText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
          })),
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        title: string;
        score: number;
        decision: string;
        explain: any;
        features: any;
        sharedEntities: string[];
        matches: Array<{ sim: number; targetChunkIdx: number; targetText: string; candidateChunkIdx: number; candidateText: string }>;
      }>;

    scored.sort((a, b) => b.score - a.score);

    // Keep a small number per decision category
    const top = scored.slice(0, 25);
    try { console.log(`[links:${id}] scored=${scored.length} top=${top.length}`); } catch {}

    return NextResponse.json({ id, suggestions: top });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to compute links' }, { status: 500 });
  }
}
