const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
// Separate model name to avoid clashing with embedding model; do not fall back to OLLAMA_MODEL
const OLLAMA_TAGGER_MODEL = process.env.OLLAMA_TAGGER_MODEL || 'qwen2.5:3b-instruct';

const BASE_PROMPT = `You are a tagging assistant. Extract 3–7 concise, lowercase topic tags from the given text.\nReturn only JSON: {"tags": ["tag1", "tag2", "tag3"]}.`;

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const s = t.toLowerCase().trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  // Prefer 3–7, but keep whatever we got, cap to 10 for sanity
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
