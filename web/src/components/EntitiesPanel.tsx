"use client";

type Entity = { entity: string; weight?: number };

export default function EntitiesPanel({ noteId, entities, loading, error }: { noteId: string | null; entities: Entity[] | null | undefined; loading?: boolean; error?: string | null }) {
  const list = Array.isArray(entities) ? [...entities].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)) : [];

  return (
    <aside className="w-72 border-l border-black/10 dark:border-white/10 p-4 overflow-y-auto">
      <div className="text-sm font-medium mb-2">Extracted Entities</div>
      {!noteId ? (
        <div className="text-xs text-gray-500">No note selected</div>
      ) : error ? (
        <div className="text-xs text-red-500">{error}</div>
      ) : loading ? (
        <ul className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="h-4 bg-black/5 dark:bg-white/10 rounded animate-pulse" />
          ))}
        </ul>
      ) : !entities || list.length === 0 ? (
        <div className="text-xs text-gray-500">No entities</div>
      ) : (
        <ul className="space-y-1">
          {list.map((e, i) => (
            <li key={`${e.entity}-${i}`} className="flex items-center justify-between gap-2">
              <span className="truncate text-sm" title={e.entity}>{e.entity}</span>
              {typeof e.weight === 'number' ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300" title={`weight: ${e.weight}`}>
                  {e.weight.toFixed(2)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
