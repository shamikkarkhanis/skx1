import { db, notes } from "@/db/client";
import { normalizeEntityName } from "@/lib/entities";
import { normalizeTags } from "@/lib/tags";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseEntities(json: string | null): Array<{ entity: string; weight?: number }> {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr as Array<{ entity: string; weight?: number }>;
  } catch {}
  return [];
}

export default async function TopicsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const tab = (typeof sp?.tab === 'string' ? sp.tab : 'entities') as 'entities' | 'tags';
  const rows = db.select().from(notes).all() as any[];

  // Accumulate entities across notes
  const entityWeights = new Map<string, number>();
  const entityCounts = new Map<string, number>(); // total occurrences across all notes
  const entityNoteCounts = new Map<string, number>();

  for (const n of rows) {
    const list = parseEntities(n.entities ?? null);
    if (!list.length) continue;
    // per-note map to count distinct entity presence for noteCounts
    const seen = new Set<string>();
    for (const item of list) {
      const key = normalizeEntityName(item.entity);
      if (!key) continue;
      const w = Math.max(0, Number(item.weight) || 1);
      entityWeights.set(key, (entityWeights.get(key) ?? 0) + w);
      entityCounts.set(key, (entityCounts.get(key) ?? 0) + 1);
      if (!seen.has(key)) {
        entityNoteCounts.set(key, (entityNoteCounts.get(key) ?? 0) + 1);
        seen.add(key);
      }
    }
  }

  const entityTopics = Array.from(entityWeights.entries()).map(([entity, totalWeight]) => ({
    entity,
    totalWeight,
    count: entityCounts.get(entity) ?? 0,
    noteCount: entityNoteCounts.get(entity) ?? 0,
  }));
  entityTopics.sort((a, b) => b.totalWeight - a.totalWeight || a.entity.localeCompare(b.entity));

  // --- Aggregate Tags ---
  const tagCounts = new Map<string, number>();
  const tagNoteCounts = new Map<string, number>();
  for (const n of rows) {
    let tags: string[] = [];
    try {
      const parsed = n.tags ? JSON.parse(n.tags) : [];
      tags = normalizeTags(parsed);
    } catch {
      // ignore
    }
    const seen = new Set<string>();
    for (const t of tags) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      if (!seen.has(t)) {
        tagNoteCounts.set(t, (tagNoteCounts.get(t) ?? 0) + 1);
        seen.add(t);
      }
    }
  }
  const tagTopics = Array.from(tagCounts.entries()).map(([tag, count]) => ({
    tag,
    count,
    noteCount: tagNoteCounts.get(tag) ?? 0,
  }));
  tagTopics.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  // Totals for tab badges
  const totalEntityCount = Array.from(entityCounts.values()).reduce((a, b) => a + b, 0);
  const totalTagCount = Array.from(tagCounts.values()).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-4">Topics</h1>

      <div className="mb-4 flex items-center gap-2 border-b border-black/10 dark:border-white/10">
        <Link href={{ pathname: "/topics", query: { tab: 'entities' } }} className={`px-3 py-2 text-sm flex items-center gap-2 ${tab === 'entities' ? 'border-b-2 border-blue-500 font-medium' : 'text-gray-500'}`}>
          <span>Entities</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">{totalEntityCount}</span>
        </Link>
        <Link href={{ pathname: "/topics", query: { tab: 'tags' } }} className={`px-3 py-2 text-sm flex items-center gap-2 ${tab === 'tags' ? 'border-b-2 border-blue-500 font-medium' : 'text-gray-500'}`}>
          <span>Tags</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">{totalTagCount}</span>
        </Link>
      </div>

      {tab === 'entities' ? (
        entityTopics.length === 0 ? (
          <div className="text-sm text-gray-500">No entities yet.</div>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {entityTopics.map((t) => (
              <li key={t.entity} className="py-2 flex items-center justify-between gap-4">
                <div className="truncate">
                  <span className="text-sm font-medium">{t.entity}</span>
                  <span className="ml-2 text-xs text-gray-500">{t.noteCount} note{t.noteCount === 1 ? '' : 's'}</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300" title={`total weight: ${t.totalWeight.toFixed(2)}`}>{t.count}</span>
              </li>
            ))}
          </ul>
        )
      ) : (
        tagTopics.length === 0 ? (
          <div className="text-sm text-gray-500">No tags yet.</div>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {tagTopics.map((t) => (
              <li key={t.tag} className="py-2 flex items-center justify-between gap-4">
                <div className="truncate">
                  <span className="text-sm font-medium">{t.tag}</span>
                  <span className="ml-2 text-xs text-gray-500">{t.noteCount} note{t.noteCount === 1 ? '' : 's'}</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300" title={`count across notes: ${t.count}`}>{t.count}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
