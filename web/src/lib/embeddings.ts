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
    // Handle BlockNote: document is typically an array of block objects
    if (Array.isArray(doc)) {
      const out: string[] = [];
      const acc: string[] = [];
      const walk = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.text === 'string') acc.push(node.text);
        const content = Array.isArray((node as any).content) ? (node as any).content : [];
        for (const c of content) walk(c);
        const children = Array.isArray((node as any).children) ? (node as any).children : [];
        for (const ch of children) walk(ch);
      };
      for (const block of doc) {
        acc.length = 0;
        walk(block);
        const line = acc.join(' ').replace(/\s+/g, ' ').trim();
        if (line) out.push(line);
      }
      return out.join('\n').trim();
    }

    // Handle Editor.js OutputData
    if (doc && typeof doc === 'object' && Array.isArray((doc as any).blocks)) {
      const blocks = (doc as any).blocks as any[];
      const out: string[] = [];
      for (const b of blocks) {
        const type = b?.type;
        const data = b?.data ?? {};
        switch (type) {
          case 'paragraph':
          case 'header':
          case 'quote': {
            const t = typeof data.text === 'string' ? data.text : '';
            out.push(stripInlineHtml(t));
            break;
          }
          case 'list': {
            const items: any[] = Array.isArray(data.items) ? data.items : [];
            for (const it of items) out.push(stripInlineHtml(String(it ?? '')));
            break;
          }
          case 'checklist': {
            const items: any[] = Array.isArray(data.items) ? data.items : [];
            for (const it of items) out.push(stripInlineHtml(String(it?.text ?? '')));
            break;
          }
          case 'code': {
            const code = typeof data.code === 'string' ? data.code : '';
            out.push(code);
            break;
          }
          default: {
            // ignore unknown blocks
          }
        }
      }
      return out.join('\n').replace(/\s+$/g, '').trim();
    }

    // Fallback: TipTap/ProseMirror-like JSON tree, or BlockNote single-root object
    const acc: string[] = [];
    function walk(node: any) {
      if (!node || typeof node !== 'object') return;
      if (typeof node.text === 'string') acc.push(node.text);
      const content = Array.isArray(node.content) ? node.content : [];
      for (const child of content) walk(child);
      const children = Array.isArray((node as any).children) ? (node as any).children : [];
      for (const ch of children) walk(ch);
    }
    walk(doc);
    return acc.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function stripInlineHtml(html: string): string {
  try {
    // very small, safe strip of tags; Editor.js text is sanitized
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  } catch {
    return html;
  }
}

export function buildNoteTextForEmbedding(title: string | undefined, contentJson: unknown): string {
  const titlePart = title ? `Title: ${title}` : '';
  const bodyText = extractPlainTextFromTiptap(contentJson);
  return [titlePart, bodyText].filter(Boolean).join('\n\n').trim();
}
