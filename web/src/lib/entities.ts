// Entity utilities: normalization, weighted Jaccard, intersections, extraction
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_TAGGER_MODEL = process.env.OLLAMA_TAGGER_MODEL || 'qwen2.5:3b-instruct';

export type Entity = {
  entity: string; // canonical name
  weight: number; // importance weight (>=0)
  source?: 'ner' | 'regex' | string;
};

export function normalizeEntityName(s: string): string {
  const lowered = (s || '').toLowerCase().trim();
  // collapse whitespace, convert underscores to hyphens, remove surrounding punctuation
  let out = lowered
    .normalize('NFKD')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '-');
  out = out.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return out;
}

export function toEntityMap(list: Array<{ entity: string; weight?: number }> = []) {
  const map = new Map<string, number>();
  for (const e of list) {
    const key = normalizeEntityName(e.entity);
    if (!key) continue;
    const w = Math.max(0, Number.isFinite(e.weight as number) ? (e.weight as number) : 1);
    map.set(key, (map.get(key) ?? 0) + w);
  }
  return map; // canonical entity -> accumulated weight
}

// Weighted Jaccard over entity maps
export function weightedJaccard(A: Map<string, number>, B: Map<string, number>): number {
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  let uni = 0;
  const keys = new Set([...A.keys(), ...B.keys()]);
  for (const k of keys) {
    const a = A.get(k) ?? 0;
    const b = B.get(k) ?? 0;
    inter += Math.min(a, b);
    uni += Math.max(a, b);
  }
  if (uni === 0) return 0;
  return inter / uni;
}

export function topIntersect(A: Map<string, number>, B: Map<string, number>, limit = 5): string[] {
  const out: Array<{ k: string; s: number }> = [];
  const keys = new Set([...A.keys(), ...B.keys()]);
  for (const k of keys) {
    const s = Math.min(A.get(k) ?? 0, B.get(k) ?? 0);
    if (s > 0) out.push({ k, s });
  }
  out.sort((x, y) => y.s - x.s);
  return out.slice(0, limit).map((x) => x.k);
}

function extractJsonObject(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// Extract entities with rough weights from text using an instruction-tuned model
export async function generateEntitiesFromText(text: string): Promise<Entity[]> {
  const prompt = `Extract named entities, key concepts, and proper nouns with a small importance weight (1-3).
  Return JSON only in the format: {"entities":[{"entity":"...","weight":1}, ...]}
  Rules:
  - lowercase, hyphenate spaces/underscores, no punctuation except hyphens
  - DO NOT include dates, times, plain numbers, or generic headings (e.g., "key-concepts", "note-title", "date")`;  
  const body = {
    model: OLLAMA_TAGGER_MODEL,
    prompt: `${prompt}\n\nText:\n"""\n${text}\n"""`,
    stream: false,
    options: { temperature: 0.2 },
    format: 'json',
  } as const;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Ollama entity extraction failed: HTTP ${res.status} ${msg}`);
  }
  const json = await res.json().catch(() => ({} as any));
  const raw = json?.response ?? '';
  let parsed: any | null = null;
  try { parsed = JSON.parse(raw); } catch { parsed = extractJsonObject(raw); }
  const items = Array.isArray(parsed?.entities) ? parsed.entities : [];
  const out: Entity[] = [];
  for (const it of items) {
    if (!it) continue;
    const name = typeof it.entity === 'string' ? it.entity : (typeof it.name === 'string' ? it.name : '');
    const key = normalizeEntityName(name);
    if (!key) continue;
    const w = Math.max(0, Math.min(10, Number(it.weight) || 1));
    out.push({ entity: key, weight: w, source: 'ner' });
  }
  return out;
}

// Aggregate a list of entities into a deduped weighted list
export function aggregateEntities(list: Array<{ entity: string; weight?: number }>): Entity[] {
  const m = toEntityMap(list);
  const out: Entity[] = [];
  for (const [entity, weight] of m.entries()) {
    if (weight > 0) out.push({ entity, weight });
  }
  out.sort((a, b) => (b.weight - a.weight));
  return out;
}
