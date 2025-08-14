"use client";

import { useEffect, useState } from "react";
import NoteEditor from "@/components/NoteEditor";

type NoteListItem = {
  id: string;
  title: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export default function NotesShell() {
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void refreshList();
    setLoading(false);
    // Periodically refresh list to reflect updated timestamps
    const t = setInterval(() => {
      void refreshList();
    }, 10000);
    return () => clearInterval(t);
  }, []);

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
        <div className="overflow-auto">
          {notes.length === 0 ? (
            <div className="text-xs text-gray-500">No notes yet</div>
          ) : (
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
                  </button>
                </li>
              ))}
            </ul>
          )}
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
