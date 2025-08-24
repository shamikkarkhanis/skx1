const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
// Separate model name to avoid clashing with embedding model; do not fall back to OLLAMA_MODEL
const OLLAMA_TAGGER_MODEL = process.env.OLLAMA_TAGGER_MODEL || 'qwen2.5:3b-instruct';

const BASE_PROMPT = `You are a tagging assistant for personal notes.
Goal: output 3–7 specific, reusable topic tags that help retrieval across a large corpus.

Rules:
1) Prefer domain-specific noun phrases and named entities (e.g., "editorjs", "nodejs-streams", "p21-cdk-inhibitor").
2) Include at least one of: {entity, framework/library, course/topic, action/intent (todo, decision)} if present.
3) Avoid generic words (e.g., "hello", "question", "example", "simple_code", "greeting", "purpose").
4) Collapse synonyms to a canonical form you’d search for (e.g., "js"→"javascript", "power rangers"→"power‑rangers").
5) Use kebab-case; no punctuation except hyphens; 1–3 words per tag.
6) Do not restate the title verbatim as tags unless it’s a known term.
7) If music/links/quotes are present, prefer the **topic** over the artifact (e.g., "key-change", "4-bar-loop").
Return only JSON:
{"tags":[ "...", "...", ... ]}
`;

// --- Tag normalization helpers ---
const STOPLIST = new Set([
  'hello','question','example','examples','simple','simple_code','greeting','purpose','note','notes','misc','general','random','test','todo'
]);

const CANON_MAP: Record<string, string> = {
  js: 'javascript',
  'node': 'nodejs',
  'node-js': 'nodejs',
  'nodejs-stream': 'nodejs-streams',
  ts: 'typescript',
  'reactjs': 'react',
  'nextjs': 'next.js', // keep common query form if you prefer 'nextjs' swap here
  'power rangers': 'power-rangers',
};

function kebabize(s: string): string {
  // Lowercase, replace non-alphanum with space (keep hyphen), collapse, then join with '-'
  const lowered = s.toLowerCase().normalize('NFKD');
  const replaced = lowered.replace(/[^a-z0-9\-\s]+/g, ' ');
  const spaced = replaced.replace(/[_]+/g, ' ');
  const words = spaced.trim().split(/\s+/).filter(Boolean);
  let out = words.join('-');
  out = out.replace(/-{2,}/g, '-');
  out = out.replace(/^-+|-+$/g, '');
  return out;
}

function canonicalize(tag: string): string {
  if (CANON_MAP[tag]) return CANON_MAP[tag];
  return tag;
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    let s = kebabize(t);
    if (!s) continue;
    // limit words to 1–3 per rules
    const wc = s.split('-').filter(Boolean).length;
    if (wc > 3) continue;
    // canonicalize synonyms
    s = canonicalize(s);
    // drop stop words
    if (STOPLIST.has(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  // Prefer 3–7, cap to 10 for sanity
  return out.slice(0, 10);
}

function extractJsonObject(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function generateTagsFromText(text: string): Promise<string[]> {
  // Construct prompt
  const prompt = `${BASE_PROMPT}\n\nText to tag:\n"""\n${text}\n"""`;
  const body = {
    model: OLLAMA_TAGGER_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0.2 },
    format: 'json',
  } as const;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Ollama tagging failed: HTTP ${res.status} ${msg}`);
  }
  const json = await res.json().catch(() => ({} as any));
  const raw = json?.response ?? '';

  let parsed: any | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = extractJsonObject(raw);
  }
  const tags = normalizeTags(parsed?.tags);
  return tags;
}

// --- Tag similarity scoring (Section 4C) ---
export function computeTagJaccard(a: string[] = [], b: string[] = []): number {
  const A = new Set(a.map(kebabize));
  const B = new Set(b.map(kebabize));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Minimal BM25 for tag sets. Without a corpus, treat idf=1 for matched tags, length-normalized.
export function computeTagBM25(query: string[] = [], doc: string[] = [], opts?: { idf?: Record<string, number>; k1?: number; b?: number }): number {
  const k1 = opts?.k1 ?? 1.2;
  const b = opts?.b ?? 0.75;
  const idf = opts?.idf;
  const q = Array.from(new Set(query.map(kebabize)));
  const d = Array.from(new Set(doc.map(kebabize)));
  const dl = d.length || 1; // document length in tags
  const avgdl = 6; // heuristic average tag count per note
  let score = 0;
  for (const t of q) {
    const tf = d.includes(t) ? 1 : 0; // tags are sets, so 0/1
    if (!tf) continue;
    const idf_t = idf?.[t] ?? 1; // fallback
    const denom = tf + k1 * (1 - b + b * (dl / avgdl));
    score += idf_t * ((tf * (k1 + 1)) / denom);
  }
  return score; // unbounded small value; we'll squash below
}

export function computeTagScore(a: string[] = [], b: string[] = [], opts?: { idf?: Record<string, number> }): number {
  const j = computeTagJaccard(a, b);
  const bm25 = computeTagBM25(a, b, { idf: opts?.idf });
  // Squash BM25 to 0..1 for mixing; hyperparameter 3 keeps curve gentle
  const bm25n = bm25 / (bm25 + 3);
  const score = 0.7 * j + 0.3 * bm25n;
  return Math.max(0, Math.min(1, score));
}
