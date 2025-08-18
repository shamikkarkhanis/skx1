const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
// Separate model name for title generation to avoid clashing with other models
export const OLLAMA_TITLE_MODEL = process.env.OLLAMA_TITLE_MODEL || 'qwen2.5:3b-instruct';

import { extractPlainTextFromTiptap } from './embeddings';

const TITLE_PROMPT = `You are a helpful assistant. Generate a concise, descriptive title (max 8 words) for the given text.\nReturn only JSON: {"title": "Your Title"}.`;

function extractJsonObject(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function fallbackTitleFromText(text: string): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled';
  const m = cleaned.match(/^(.*?[.!?])\s/);
  const guess = (m ? m[1] : cleaned.split(' ').slice(0, 8).join(' ')).trim();
  return guess || 'Untitled';
}

export async function generateTitleFromText(text: string): Promise<string> {
  const prompt = `${TITLE_PROMPT}\n\nText:\n"""\n${text}\n"""`;
  const body = {
    model: OLLAMA_TITLE_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0.3 },
    format: 'json' as const,
  };

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Title generation failed: HTTP ${res.status} ${msg}`);
  }

  const json = await res.json().catch(() => ({} as any));
  const raw = json?.response ?? '';

  let parsed: any | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = extractJsonObject(raw);
  }

  let title = '';
  if (parsed && typeof parsed.title === 'string') {
    title = parsed.title.trim();
  }

  if (!title) title = fallbackTitleFromText(text);

  return (title || 'Untitled').slice(0, 80);
}