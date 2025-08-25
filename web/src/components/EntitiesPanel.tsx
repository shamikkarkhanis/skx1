"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Entity = { entity: string; weight?: number };

type NoteResponse = {
  id: string;
  title: string | null;
  entities?: Entity[];
};

export default function EntitiesPanel({ noteId }: { noteId: string | null }) {
  const [data, setData] = useState<NoteResponse | null>(null);
  const [loading, setLoading] = useState(false); // initial load only
  const [refreshing, setRefreshing] = useState(false); // background refresh without flicker (invisible)
  const [error, setError] = useState<string | null>(null);
  const hasLoaded = useRef(false);
  const lastSignature = useRef<string | null>(null);

  const signatureOf = (entities: Entity[] | undefined) => {
    if (!entities || entities.length === 0) return "";
    // canonical: sort by entity asc, then weight desc, join
    const sorted = [...entities].sort((a, b) => {
      const n = a.entity.localeCompare(b.entity);
      if (n !== 0) return n;
      return (b.weight ?? 0) - (a.weight ?? 0);
    });
    return sorted.map(e => `${e.entity}|${(e.weight ?? 0).toFixed(3)}`).join("\n");
  };

  // Fetch helper
  const fetchEntities = async (currentId: string, signal?: AbortSignal) => {
    const initial = !hasLoaded.current;
    if (initial) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${currentId}`, { cache: "no-store", signal });
      if (!res.ok) throw new Error("Failed to fetch note entities");
      const json: NoteResponse = await res.json();
      const sig = signatureOf(json.entities);
      if (sig !== lastSignature.current) {
        setData(json);
        lastSignature.current = sig;
      }
      hasLoaded.current = true;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Initial load on note change
  useEffect(() => {
    if (!noteId) {
      setData(null);
      hasLoaded.current = false;
      lastSignature.current = null;
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const controller = new AbortController();
    fetchEntities(noteId, controller.signal);
    return () => controller.abort();
  }, [noteId]);

  // Refresh on 'note-saved' event (emitted by the editor after autosave completes)
  useEffect(() => {
    if (!noteId) return;
    const handler = () => fetchEntities(noteId);
    if (typeof window !== 'undefined') {
      window.addEventListener('note-saved', handler as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('note-saved', handler as EventListener);
      }
    };
  }, [noteId]);

  // Periodic polling to pick up background entity generation
  useEffect(() => {
    if (!noteId) return;
    const t = setInterval(() => {
      void fetchEntities(noteId);
    }, 10000); // every 10s, aligned with list refresh
    return () => clearInterval(t);
  }, [noteId]);

  const entities = useMemo(() => {
    const list = data?.entities || [];
    return [...list].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  }, [data]);

  return (
    <aside className="w-72 border-l border-black/10 dark:border-white/10 p-4 overflow-y-auto">
      <div className="text-sm font-medium mb-2">Extracted Entities</div>
      {!noteId ? (
        <div className="text-xs text-gray-500">No note selected</div>
      ) : error ? (
        <div className="text-xs text-red-500">{error}</div>
      ) : loading ? (
        // Initial skeleton to avoid content pop
        <ul className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="h-4 bg-black/5 dark:bg-white/10 rounded animate-pulse" />
          ))}
        </ul>
      ) : entities.length === 0 ? (
        <div className="text-xs text-gray-500">No entities</div>
      ) : (
        <ul className="space-y-1">
          {entities.map((e, i) => (
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
