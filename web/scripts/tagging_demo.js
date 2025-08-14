/*
 LLM Tagging demo with Ollama (Qwen2.5)
 - Uses a local LLM via Ollama (default: qwen2.5:7b-instruct)
 - Extracts concise topic tags for the same example notes used in the embedding demo

 Usage:
   # 1) Ensure Ollama is installed and running (https://ollama.com)
   # 2) Pull an instruct model (defaults below):
   #    ollama pull qwen2.5:7b-instruct
   #    # For a smaller download, you can try: ollama pull qwen2.5:0.5b-instruct
   # 3) Run the script to tag the example notes corpus:
   #    node web/scripts/tagging_demo.js
   # 4) Or pass a custom text to tag:
   #    node web/scripts/tagging_demo.js "Your text to tag here"

 Optional env vars:
   OLLAMA_HOST  (default: http://localhost:11434)
   OLLAMA_MODEL (default: qwen2.5:7b-instruct)
*/

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';

// Same example notes corpus as in embedding_demo.js
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

const BASE_PROMPT = `You are a tagging assistant. Extract 3–7 concise, lowercase topic tags from the given text.\nReturn only JSON: {"tags": ["tag1", "tag2", "tag3"]}.`;

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

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const s = t.toLowerCase().trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(0, 10); // keep it reasonable even if the model returns many
}

function extractJsonObject(text) {
  // Try to find a JSON object in the text if the model included extra tokens
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

async function tagText(text) {
  const prompt = `${BASE_PROMPT}\n\nText to tag:\n"""\n${text}\n"""`;
  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0.2 },
    // Ask Ollama to prefer valid JSON output
    format: 'json'
  };

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Tagging failed: HTTP ${res.status} ${msg}`);
  }

  const json = await res.json();
  const raw = json?.response ?? '';

  // If format:'json' worked perfectly, raw should be a JSON object string
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    parsed = extractJsonObject(raw);
  }

  const tags = normalizeTags(parsed?.tags || []);
  // Soft constraints per instructions (3–7); we'll still show whatever came back
  return tags;
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

  const custom = process.argv.slice(2).join(' ').trim();
  console.log(`Using Ollama host: ${OLLAMA_HOST}`);
  console.log(`LLM model: ${OLLAMA_MODEL}`);

  if (custom) {
    console.log('\nTagging custom text...');
    const tags = await tagText(custom);
    console.log(JSON.stringify({ tags }, null, 2));
    return;
  }

  console.log('\nTagging example notes corpus...');
  for (const note of EXAMPLE_NOTES) {
    const text = `${note.title}\n\n${note.content}`;
    const tags = await tagText(text);
    console.log(`\n- ${note.title} (id=${note.id})`);
    console.log(JSON.stringify({ tags }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
