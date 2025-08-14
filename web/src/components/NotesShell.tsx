"use client";

import { useEffect, useState } from "react";
import NoteEditor from "@/components/NoteEditor";

type NoteListItem = {
  id: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  tags?: string[];
};

type SearchResult = {
  id: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  score: number;
};

export default function NotesShell() {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);

  useEffect(() => {
    void refreshList();
    setLoading(false);
    // Periodically refresh list to reflect updated timestamps
    const t = setInterval(() => {
      void refreshList();
    }, 10000);
    // Refresh immediately after a save completes in the editor
    const onSaved = () => {
      void refreshList();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('note-saved', onSaved as EventListener);
    }
    return () => clearInterval(t);
  }, []);

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
      const res = await fetch("/api/notes", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch notes");
      const data: NoteListItem[] = await res.json();
      // Prefer last used note if none selected
      const last = localStorage.getItem("lastNoteId");
      setNotes(data);
      if (!selectedId) {
        setSelectedId(last || data[0]?.id || null);
      }
    } catch (e) {
      console.error(e);
    }
  }

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
      const res = await fetch("/api/notes", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create note");
      const { id } = await res.json();
      localStorage.setItem("lastNoteId", id);
      setSelectedId(id);
      // Optimistically add to top; full refresh will reorder as needed
      setNotes((prev) => [{ id, title: "Untitled", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...prev]);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-72 border-r border-black/10 dark:border-white/10 p-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Your Notes</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={createNewNote}
              className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"
            >
              New
            </button>
            <button
              onClick={deleteSelectedNote}
              disabled={!selectedId}
              className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
              title={selectedId ? "Delete selected note" : "Select a note to delete"}
            >
              Delete
            </button>
          </div>
        </div>
        <div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full text-sm px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-transparent outline-none"
          />
        </div>
        <div className="overflow-auto">
          {(() => {
            if (query.trim()) {
              if (!searchResults) return <div className="text-xs text-gray-500">Searching…</div>;
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
                          {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ""}
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
                      <div className="text-[10px] text-gray-500">
                        {n.updatedAt ? new Date(n.updatedAt).toLocaleString() : ""}
                      </div>
                      {Array.isArray(n.tags) && n.tags.length > 0 ? (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {n.tags.slice(0, 7).map((t, i) => (
                            <span
                              key={`${n.id}-tag-${i}`}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300"
                              title={t}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      </aside>
      <main className="flex-1 p-6">
        <div className="max-w-3xl">
          <NoteEditor noteId={selectedId} />
        </div>
      </main>
    </div>
  );
}
