/*
Chunk-to-chunk similarity across notes

Usage:
  # Two-note mode (original):
  node web/scripts/chunk_similarity.js <noteIdA> <noteIdB> [--topk=3]

  # Auto-pick first two notes by created_at (fallback rowid):
  node web/scripts/chunk_similarity.js [--topk=3]

  # All-notes mode: compare every chunk of every note to all other notes' chunks
  node web/scripts/chunk_similarity.js --all [--topk=3] [--min=0.3]

Notes:
- Reads SQLite DB at web/db/dev.sqlite
- Two-note mode prints a compact matrix and top-k matches per chunk
- All-notes mode prints, for each chunk, its top-k matches in other notes with texts
*/

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function dbPath() {
  // __dirname points to web/scripts; DB lives at ../db/dev.sqlite
  return path.join(__dirname, '..', 'db', 'dev.sqlite');
}

function openDb() {
  const p = dbPath();
  if (!fs.existsSync(p)) {
    console.error(`DB not found at ${p}`);
    process.exit(1);
  }
  return new Database(p, { readonly: true });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const [a, b, ...rest] = args;
  let topk = 3;
  let all = false;
  let min = 0;
  for (const token of rest.concat(a || '', b || '')) {
    if (token === '--all') all = true;
    const m1 = token.match(/^--topk=(\d+)$/);
    if (m1) topk = Math.max(1, parseInt(m1[1], 10));
    const m2 = token.match(/^--min=([0-9]*\.?[0-9]+)$/);
    if (m2) min = Math.max(0, Math.min(1, parseFloat(m2[1])));
  }
  // If --all is present, ignore positional a/b ids for safety
  return { aId: all ? undefined : a, bId: all ? undefined : b, topk, all, min };
}

function safeParseEmbedding(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'number');
  } catch (_) {}
  return null;
}

function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  const c = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(1, c));
}

function getNote(db, id) {
  const row = db.prepare('SELECT id, title FROM notes WHERE id = ?').get(id);
  return row || null;
}

function getAllNotes(db) {
  let rows = [];
  try {
    rows = db.prepare('SELECT id, title FROM notes ORDER BY created_at ASC').all();
  } catch (_) {}
  if (!rows || rows.length === 0) {
    rows = db.prepare('SELECT id, title FROM notes ORDER BY rowid ASC').all();
  }
  return rows || [];
}

function getChunks(db, noteId) {
  const rows = db.prepare(
    'SELECT id, ord, text, embedding FROM note_chunks WHERE note_id = ? ORDER BY CAST(ord AS INTEGER), ord'
  ).all(noteId);
  const chunks = [];
  for (const r of rows) {
    const vec = safeParseEmbedding(r.embedding);
    chunks.push({ id: r.id, ord: r.ord, text: r.text, vec });
  }
  return chunks;
}

function topKMatchesForRows(matrix, k) {
  // matrix: rows = A chunks, cols = B chunks
  const out = [];
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    const pairs = row.map((v, j) => ({ j, v }));
    pairs.sort((x, y) => y.v - x.v);
    out.push(pairs.slice(0, k));
  }
  return out;
}

async function main() {
  const { aId: inA, bId: inB, topk, all, min } = parseArgs();
  const sqlite = openDb();

  if (all) {
    // ALL-NOTES MODE
    const notes = getAllNotes(sqlite);
    if (!notes.length) {
      console.error('No notes found in the DB.');
      process.exit(1);
    }
    console.log(`Scanning ${notes.length} notes...`);

    // Build catalog of all chunks with embeddings
    const catalog = [];
    for (const n of notes) {
      const chunks = getChunks(sqlite, n.id);
      for (let idx = 0; idx < chunks.length; idx++) {
        const c = chunks[idx];
        if (Array.isArray(c.vec) && c.vec.length > 0) {
          catalog.push({
            noteId: n.id,
            noteTitle: n.title,
            chunkIdx: idx,
            chunkId: c.id,
            text: c.text || '',
            vec: c.vec,
          });
        }
      }
    }

    if (catalog.length === 0) {
      console.log('No chunk embeddings found.');
      process.exit(0);
    }

    // Determine embedding dim by first vector
    const dim = catalog.find((x) => Array.isArray(x.vec) && x.vec.length)?.vec.length || 0;
    if (!dim) {
      console.log('Could not determine embedding dimension.');
      process.exit(0);
    }

    // For each source chunk, find top-k matches in other notes
    const trunc = (s, n = 120) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
    for (let i = 0; i < catalog.length; i++) {
      const src = catalog[i];
      const candidates = [];
      for (let j = 0; j < catalog.length; j++) {
        if (i === j) continue; // skip exact same chunk
        const tgt = catalog[j];
        if (tgt.noteId === src.noteId) continue; // only other notes
        if (!Array.isArray(src.vec) || !Array.isArray(tgt.vec) || src.vec.length !== dim || tgt.vec.length !== dim) continue;
        const sim = cosineSim(src.vec, tgt.vec);
        if (sim >= min) {
          candidates.push({ j, sim });
        }
      }
      candidates.sort((a, b) => b.sim - a.sim);
      const top = candidates.slice(0, topk);
      if (top.length === 0) continue;

      console.log(`\nNote: ${src.noteTitle} (${src.noteId})  chunk#${src.chunkIdx}`);
      console.log(`  Src: "${trunc(src.text)}"`);
      for (const { j, sim } of top) {
        const t = catalog[j];
        console.log(`  -> cos=${sim.toFixed(3)}  Note: ${t.noteTitle} (${t.noteId}) chunk#${t.chunkIdx}`);
        console.log(`     "${trunc(t.text)}"`);
      }
    }

    console.log('\nDone.');
    return;
  }

  // TWO-NOTE MODE (original behavior)
  let aId = inA;
  let bId = inB;
  if (!aId || !bId) {
    // Auto-pick first two notes by created_at; fallback to rowid if needed
    let rows = [];
    try {
      rows = sqlite.prepare('SELECT id, title FROM notes ORDER BY created_at ASC LIMIT 2').all();
    } catch (_) {}
    if (!rows || rows.length < 2) {
      rows = sqlite.prepare('SELECT id, title FROM notes ORDER BY rowid ASC LIMIT 2').all();
    }
    if (!rows || rows.length < 2) {
      console.error('Need at least two notes in the DB to compare.');
      process.exit(1);
    }
    aId = rows[0].id;
    bId = rows[1].id;
    console.log(`Auto-selected notes: A=${aId}, B=${bId}`);
  }

  const aNote = getNote(sqlite, aId);
  const bNote = getNote(sqlite, bId);
  if (!aNote) {
    console.error(`Note A not found: ${aId}`);
    process.exit(1);
  }
  if (!bNote) {
    console.error(`Note B not found: ${bId}`);
    process.exit(1);
  }

  const aChunks = getChunks(sqlite, aId);
  const bChunks = getChunks(sqlite, bId);

  console.log(`A: ${aNote.title} (${aId}) chunks=${aChunks.length}`);
  console.log(`B: ${bNote.title} (${bId}) chunks=${bChunks.length}`);

  if (aChunks.length === 0 || bChunks.length === 0) {
    console.log('One of the notes has no chunks. Nothing to compare.');
    process.exit(0);
  }

  // Determine embedding dimension from first comparable pair
  let dim = 0;
  for (const ca of aChunks) {
    if (Array.isArray(ca.vec) && ca.vec.length > 0) { dim = ca.vec.length; break; }
  }
  if (!dim) {
    console.log('No embeddings found for A chunks.');
    process.exit(0);
  }

  // Build similarity matrix
  const matrix = aChunks.map(() => bChunks.map(() => 0));
  for (let i = 0; i < aChunks.length; i++) {
    const va = aChunks[i].vec;
    for (let j = 0; j < bChunks.length; j++) {
      const vb = bChunks[j].vec;
      if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length && va.length === dim) {
        matrix[i][j] = cosineSim(va, vb);
      } else {
        matrix[i][j] = 0;
      }
    }
  }

  // Print compact matrix
  console.log('\nCosine similarity matrix (rows=A chunks, cols=B chunks):');
  const header = ['    '];
  for (let j = 0; j < bChunks.length; j++) header.push(String(j).padStart(5, ' '));
  console.log(header.join(' '));
  for (let i = 0; i < aChunks.length; i++) {
    const row = [String(i).padStart(3, ' ') + ':'];
    for (let j = 0; j < bChunks.length; j++) row.push(matrix[i][j].toFixed(3).padStart(5, ' '));
    console.log(row.join(' '));
  }

  // Top-k per A-chunk and per B-chunk
  const topA = topKMatchesForRows(matrix, topk);
  const matrixT = bChunks.map((_, j) => aChunks.map((_, i) => matrix[i][j]));
  const topB = topKMatchesForRows(matrixT, topk);

  console.log(`\nTop-${topk} matches per A chunk:`);
  for (let i = 0; i < topA.length; i++) {
    const items = topA[i]
      .filter((x) => x.v > 0 && x.v >= min)
      .map(({ j, v }) => `B#${j} (cos=${v.toFixed(3)})`)
      .join(', ');
    console.log(`  A#${i} -> ${items || '(none)'}`);
  }

  console.log(`\nTop-${topk} matches per B chunk:`);
  for (let j = 0; j < topB.length; j++) {
    const items = topB[j]
      .filter((x) => x.v > 0 && x.v >= min)
      .map(({ j: i, v }) => `A#${i} (cos=${v.toFixed(3)})`)
      .join(', ');
    console.log(`  B#${j} -> ${items || '(none)'}`);
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
