const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'nomic-embed-text';

export async function embedTextWithOllama(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text })
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Ollama embeddings failed: HTTP ${res.status} ${msg}`);
  }
  const json = await res.json();
  if (!json || !Array.isArray(json.embedding)) {
    throw new Error('Unexpected embedding response from Ollama');
  }
  return json.embedding as number[];
}

export function extractPlainTextFromTiptap(doc: unknown): string {
  try {
    const acc: string[] = [];
    function walk(node: any) {
      if (!node || typeof node !== 'object') return;
      if (typeof node.text === 'string') acc.push(node.text);
      const content = Array.isArray(node.content) ? node.content : [];
      for (const child of content) walk(child);
    }
    walk(doc);
    return acc.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export function buildNoteTextForEmbedding(title: string | undefined, contentJson: unknown): string {
  const titlePart = title ? `Title: ${title}` : '';
  const bodyText = extractPlainTextFromTiptap(contentJson);
  return [titlePart, bodyText].filter(Boolean).join('\n\n').trim();
}
