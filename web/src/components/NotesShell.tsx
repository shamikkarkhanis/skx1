"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
const BlockNoteEditor = dynamic(() => import("@/components/BlockNoteEditor"), { ssr: false });

type NoteListItem = {
  id: string;
  title: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tags?: string[];
  spaceId?: string | null;
};

type SearchResult = {
  id: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  score: number;
};

export default function NotesShell({ spaceId }: { spaceId?: string }) {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [isClient, setIsClient] = useState(false);
  // Entities state
  const [entities, setEntities] = useState<Array<{ entity: string; weight?: number }> | null>(null);
  const [entitiesLoading, setEntitiesLoading] = useState<boolean>(false);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);
  // Spaces map (id -> { name }) for displaying space pill
  const [spacesMap, setSpacesMap] = useState<Record<string, { name: string }>>({});

  // Fetch entities for a note
  async function fetchEntities(noteId: string | null) {
    if (!noteId) {
      setEntities(null);
      setEntitiesLoading(false);
      setEntitiesError(null);
      return;
    }
    setEntitiesLoading(true);
    setEntitiesError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch note entities");
      const data = await res.json();
      const list = Array.isArray(data?.entities) ? data.entities as Array<{ entity: string; weight?: number }> : [];
      setEntities(list);
    } catch (e) {
      console.error(e);
      setEntitiesError((e as Error).message || "Failed to load entities");
    } finally {
      setEntitiesLoading(false);
    }
  }

  // Prevent hydration errors by ensuring client-side rendering
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    void refreshList();
    setLoading(false);
    // load spaces map (once)
    void (async () => {
      try {
        const res = await fetch('/api/spaces', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch spaces');
        const data = (await res.json()) as Array<{ id: string; name: string }>;
        const m: Record<string, { name: string }> = {};
        for (const s of data) m[s.id] = { name: s.name };
        setSpacesMap(m);
      } catch (e) {
        // non-fatal
        console.warn('spaces load failed', e);
      }
    })();
    // Refresh after autosave completes
    const onSaved = () => {
      void refreshList();
      void fetchEntities(selectedId);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('note-saved', onSaved as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('note-saved', onSaved as EventListener);
      }
    };
  }, [selectedId, spaceId]);

  // Subscribe to SSE events for the selected note and refresh list on 'processed'
  useEffect(() => {
    if (!selectedId) return;
    const es = new EventSource(`/api/notes/${selectedId}/events`);
    const onProcessed = () => {
      void refreshList();
      void fetchEntities(selectedId);
    };
    es.addEventListener('processed', onProcessed as EventListener);
    return () => {
      try { es.removeEventListener('processed', onProcessed as EventListener); } catch {}
      try { es.close(); } catch {}
    };
  }, [selectedId]);

  // Debounced semantic search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/notes/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, limit: 20 }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Search failed");
        const data: SearchResult[] = await res.json();
        setSearchResults(data);
      } catch (e) {
        if ((e as any)?.name !== "AbortError") console.error(e);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort("cancel");
    };
  }, [query]);

  async function refreshList() {
    try {
      const url = spaceId ? `/api/notes?spaceId=${encodeURIComponent(spaceId)}` : "/api/notes";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch notes");
      const data: NoteListItem[] = await res.json();
      // Prefer last used note if none selected
      const last = spaceId ? null : localStorage.getItem("lastNoteId");
      setNotes(data);
      if (!selectedId) {
        setSelectedId(last || data[0]?.id || null);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Fetch entities when selection changes
  useEffect(() => {
    void fetchEntities(selectedId);
  }, [selectedId]);

  // no-op

  async function deleteSelectedNote() {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/notes/${selectedId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete note");
      setNotes((prev) => {
        const updated = prev.filter((n) => n.id !== selectedId);
        const next = updated[0]?.id ?? null;
        setSelectedId(next);
        if (next) localStorage.setItem("lastNoteId", next);
        else localStorage.removeItem("lastNoteId");
        return updated;
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function createNewNote() {
    try {
      const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spaceId ? { spaceId } : {}) });
      if (!res.ok) throw new Error("Failed to create note");
      const { id } = await res.json();
      if (!spaceId) localStorage.setItem("lastNoteId", id);
      setSelectedId(id);
      // Optimistically add to top; full refresh will reorder as needed
      setNotes((prev) => [{ id, title: "Untitled", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...prev]);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="flex h-screen bg-white dark:bg-black text-black dark:text-white">
      <aside className="w-80 border-r border-black/10 dark:border-white/10 p-4 overflow-y-auto">
        <div className="mb-4 flex items-center gap-2">
          <input
            type="text"
            placeholder="Search notes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 px-2 py-1 text-sm border border-black/10 dark:border-white/10 rounded bg-white dark:bg-black focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={createNewNote}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            title="Create a new note"
          >
            New
          </button>
          <button
            onClick={deleteSelectedNote}
            disabled={!selectedId}
            className="px-2 py-1 text-xs bg-red-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-600"
          >
            Delete
          </button>
        </div>
        <div className="text-xs text-gray-500 mb-2">
          {loading ? "Loading..." : `${notes.length} notes`}
        </div>
        <div>
          {(() => {
            // search results
            if (searchResults) {
              if (searchResults.length === 0) return <div className="text-xs text-gray-500">No results</div>;
              return (
                <ul className="space-y-1">
                  {searchResults.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => {
                          setSelectedId(r.id);
                          localStorage.setItem("lastNoteId", r.id);
                        }}
                        className={`w-full text-left px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ${
                          selectedId === r.id ? "bg-black/5 dark:bg-white/10" : ""
                        }`}
                      >
                        <div className="truncate text-sm">{r.title || "Untitled"}</div>
                        <div className="text-[10px] text-gray-500">
                          Score: {r.score.toFixed(3)} • {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ""}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              );
            }
            // default list
            if (notes.length === 0) return <div className="text-xs text-gray-500">No notes yet</div>;
            return (
              <ul className="space-y-1">
                {notes.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => {
                        setSelectedId(n.id);
                        localStorage.setItem("lastNoteId", n.id);
                      }}
                      className={`w-full text-left px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ${
                        selectedId === n.id ? "bg-black/5 dark:bg-white/10" : ""
                      }`}
                    >
                      <div className="truncate text-sm">{n.title || "Untitled"}</div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
                        <span>{n.updatedAt ? new Date(n.updatedAt).toLocaleString() : ""}</span>
                        {n.spaceId ? (
                          <span
                            className="px-1.5 py-0.5 rounded-full border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 bg-black/5 dark:bg-white/5"
                            title={spacesMap[n.spaceId]?.name || n.spaceId}
                          >
                            {spacesMap[n.spaceId]?.name || n.spaceId}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      </aside>
      <main className="relative flex-1 p-6 flex">
        <div className="max-w-3xl w-full">
          <BlockNoteEditor noteId={selectedId} />
        </div>
        {/* Entities bubbles overlay (top-right) */}
        <div className="pointer-events-none absolute top-4 right-4 max-w-sm">
          {(() => {
            if (!selectedId) return null;
            if (entitiesError) {
              return (
                <div className="pointer-events-auto text-[10px] px-2 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  {entitiesError}
                </div>
              );
            }
            if (entitiesLoading) {
              return (
                <div className="flex flex-wrap gap-1 justify-end">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i} className="h-5 w-14 rounded-full bg-white/10 animate-pulse" />
                  ))}
                </div>
              );
            }
            const list = Array.isArray(entities) ? [...entities].sort((a,b)=> (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 14) : [];
            if (list.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1 justify-end">
                {list.map((e, i) => (
                  <span
                    key={`${e.entity}-${i}`}
                    title={typeof e.weight === 'number' ? `${e.entity} (${e.weight.toFixed(2)})` : e.entity}
                    className="pointer-events-auto select-none inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-white/8 text-gray-200 border border-white/15 backdrop-blur-sm"
                  >
                    {e.entity}
                    {typeof e.weight === 'number' ? (
                      <span className="opacity-70">{e.weight.toFixed(1)}</span>
                    ) : null}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>
      </main>
    </div>
  );
}
