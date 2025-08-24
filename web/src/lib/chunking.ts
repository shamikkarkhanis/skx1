// Text chunking utilities for notes
// Splits text into ~token-sized chunks with configurable overlap.
// We approximate tokens ~4 chars as a rule of thumb; adjust if needed.

export type Chunk = {
  ord: number;        // 0-based order
  text: string;       // chunk text
  startIndex: number; // char offset in original
  endIndex: number;   // char offset in original (exclusive)
};

export type ChunkingOptions = {
  targetTokens?: number;  // default 350
  overlapTokens?: number; // default 80
  maxCharsPerChunk?: number; // hard guard (default 4000)
};

// Rough tokens->chars conversion factor
const CHARS_PER_TOKEN = 4;

export function chunkText(
  input: string,
  opts: ChunkingOptions = {}
): Chunk[] {
  const targetTokens = Math.max(50, Math.floor(opts.targetTokens ?? 350));
  const overlapTokens = Math.max(0, Math.floor(opts.overlapTokens ?? 80));
  const maxCharsPerChunk = Math.max(500, Math.floor(opts.maxCharsPerChunk ?? 4000));

  const targetChars = Math.min(targetTokens * CHARS_PER_TOKEN, maxCharsPerChunk);
  const overlapChars = Math.min(overlapTokens * CHARS_PER_TOKEN, Math.floor(targetChars * 0.8));

  const text = (input || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let ord = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + targetChars);

    // Try to break on a natural boundary (sentence boundary, then word)
    if (end < text.length) {
      const period = text.lastIndexOf('. ', end);
      const newline = text.lastIndexOf('\n', end);
      const boundary = Math.max(period, newline);
      if (boundary > start + Math.floor(targetChars * 0.6)) {
        end = boundary + 1; // include the period/newline
      } else {
        const space = text.lastIndexOf(' ', end);
        if (space > start + Math.floor(targetChars * 0.6)) {
          end = space;
        }
      }
    }

    const slice = text.slice(start, end).trim();
    if (slice) {
      chunks.push({ ord, text: slice, startIndex: start, endIndex: end });
      ord++;
    }

    if (end >= text.length) break;

    const step = Math.max(1, end - Math.max(0, overlapChars));
    start = step;
  }

  return chunks;
}

export function approxTokenCount(s: string): number {
  if (!s) return 0;
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}
