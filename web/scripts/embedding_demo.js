/*
 Embedding demo with Ollama
 - Uses a lightweight local embedding model via Ollama (default: nomic-embed-text)
 - Generates embeddings for example notes and performs semantic search

 Usage:
   # 1) Ensure Ollama is installed and running (https://ollama.com)
   # 2) Pull a small embedding model (default used by this script):
   #    ollama pull nomic-embed-text
   # 3) Run the script with a query:
   #    node web/scripts/embedding_demo.js "how to plan my day"

 Optional env vars:
   OLLAMA_HOST  (default: http://localhost:11434)
   OLLAMA_MODEL (default: nomic-embed-text)
   TOP_K        (default: 5)
*/

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'nomic-embed-text';
const TOP_K = Number(process.env.TOP_K || '5');

// Example notes corpus
const EXAMPLE_NOTES = [
    {
      id: '6',
      title: 'Travel Itinerary: Kyoto',
      content:
        'Book Shinkansen tickets from Tokyo to Kyoto for early morning departure to maximize sightseeing time. Main attractions include Fushimi Inari Taisha with its thousands of vermilion torii gates, the peaceful Arashiyama Bamboo Grove, and Kiyomizu-dera temple with panoramic views of the city. Allocate one day for exploring Gion and possibly attending a traditional tea ceremony. Research matcha dessert cafes in Nishiki Market, and check weather forecasts to pack appropriate layers for spring evenings.'
    },
    {
      id: '7',
      title: 'App Feature Brainstorm: Notes App MVP',
      content:
        'Core features to implement: CRUD API with secure authentication, a rich-text editor that supports markdown and inline images, and an autosave system that minimizes data loss in unstable network conditions. Explore integrating semantic search with local embeddings to improve retrieval accuracy. Add optional tagging with an AI-generated suggestions panel for organizing large note collections. Consider offline mode using IndexedDB for browser storage and syncing to the server when the connection is restored. Investigate end-to-end encryption strategies to ensure user privacy.'
    },
    {
      id: '8',
      title: 'Cooking Notes: Pasta Night Experiment',
      content:
        'Plan a three-course pasta-themed dinner starting with fresh tagliatelle in a spinach and ricotta filling served as ravioli, paired with a light tomato-basil sauce. Main course: creamy mushroom fettuccine with a touch of white wine reduction and fresh parsley. Side dish: garlic bread made with a no-knead artisan dough recipe, prepared the night before for slow fermentation flavor. Dessert will be a simple affogato with locally roasted espresso. Test homemade pasta sheets using both manual and motorized rollers to compare texture and cooking times.'
    },
    {
      id: '9',
      title: 'Book Summary & Reflections: Deep Work by Cal Newport',
      content:
        'The central message emphasizes that deep, focused work produces higher-quality outcomes in less time than shallow, distracted effort. Newport recommends scheduling daily “deep work” blocks, free from notifications, social media, and multitasking. Suggested methods include time-blocking, batching similar tasks together, and maintaining a “shutdown ritual” at the end of the workday to prevent mental overflow. My takeaway: applying these techniques could improve productivity during exam preparation, project sprints, and research tasks by fostering a state of flow and reducing decision fatigue.'
    },
    {
      id: '10',
      title: 'Startup Pitch Outline: Async Team Communication Tool',
      content:
        'Problem: Remote teams often struggle with maintaining context across asynchronous communication channels, leading to misunderstandings and repeated questions. Solution: Develop an AI-powered Slack integration that generates context-rich summaries of active threads, links related discussions, and creates a searchable knowledge base of decisions. Key differentiators: semantic linking between messages, multi-language support for international teams, and optional integrations with project management tools like Trello or Jira. Potential market includes distributed software teams, academic research groups, and online communities that rely on asynchronous workflows.'
    }
  ];
  

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) throw new Error(`Ollama /api/tags HTTP ${res.status}`);
    return true;
  } catch (e) {
    console.error('Could not reach Ollama. Is it running?');
    console.error(`Tried: ${OLLAMA_HOST}/api/tags`);
    console.error(e?.message || e);
    return false;
  }
}

async function embed(text) {
  const body = { model: OLLAMA_MODEL, prompt: text };
  const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Embedding failed: HTTP ${res.status} ${msg}`);
  }
  const json = await res.json();
  if (!json || !Array.isArray(json.embedding)) {
    throw new Error('Unexpected embedding response shape');
  }
  return json.embedding;
}

async function buildIndex(notes) {
  const index = [];
  // Sequential for clarity. Could be parallelized if desired.
  for (const note of notes) {
    const text = `${note.title}\n\n${note.content}`;
    const vec = await embed(text);
    index.push({ id: note.id, title: note.title, content: note.content, vector: vec });
  }
  return index;
}

async function search(index, query, k = TOP_K) {
  const qvec = await embed(query);
  const scored = index.map((item) => ({
    id: item.id,
    title: item.title,
    content: item.content,
    score: cosineSimilarity(qvec, item.vector)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

async function main() {
  const ok = await checkOllama();
  if (!ok) {
    console.error('\nInstructions:');
    console.error('  1) Install Ollama: https://ollama.com');
    console.error('  2) Start it (ollama serve)');
    console.error(`  3) Pull a model: OLLAMA_MODEL=${OLLAMA_MODEL} ollama pull ${OLLAMA_MODEL}`);
    console.error('  4) Re-run this script');
    process.exit(1);
  }

  const query = process.argv.slice(2).join(' ') || 'search with embeddings for notes';
  console.log(`Using Ollama host: ${OLLAMA_HOST}`);
  console.log(`Embedding model: ${OLLAMA_MODEL}`);
  console.log(`Query: ${query}`);

  console.log('\nBuilding example index...');
  const index = await buildIndex(EXAMPLE_NOTES);
  console.log(`Indexed ${index.length} notes.`);

  console.log('\nTop results:');
  const top = await search(index, query, TOP_K);
  for (const r of top) {
    console.log(`- [${r.score.toFixed(4)}] ${r.title} (id=${r.id})`);
    // Show a short preview
    const preview = r.content.length > 120 ? r.content.slice(0, 117) + '...' : r.content;
    console.log(`  ${preview}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
