"use client";

import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function BlockNoteEditor({ noteId }: { noteId?: string | null }) {
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializingRef = useRef(false);
  const editorRef = useRef<any>(null);

  // Debounced autosave on editor changes
  const handleChange = () => {
    if (initializingRef.current) return; // don't autosave while loading
    setSaveState("saving");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void saveNow(); }, 800);
  };

  // Create editor instance (uncontrolled)
  const editor = useCreateBlockNote();
  editorRef.current = editor;

  // Load initial content when noteId changes
  useEffect(() => {
    let aborted = false;
    async function load() {
      if (!noteId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/notes/${noteId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load note");
        const data = await res.json();
        const cj = data.contentJson;
        // Replace the whole document if we received BlockNote block objects
        // We expect cj to be an array of blocks or a TipTap-like doc. If it's not blocks, start empty.
        if (Array.isArray(cj)) {
          initializingRef.current = true;
          // Replace all top-level blocks with incoming ones
          try {
            editorRef.current?.replaceBlocks?.(editorRef.current?.topLevelBlocks, cj);
          } finally {
            // Allow a microtask for the editor to settle
            setTimeout(() => { initializingRef.current = false; }, 0);
          }
        } else {
          // If it's TipTap-like doc or unknown, start empty; the editor will initialize fine.
          initializingRef.current = false;
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    load();
    return () => { aborted = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  async function saveNow() {
    if (!noteId) return;
    try {
      const contentJson = editorRef.current?.document ?? null; // BlockNote block objects
      setSaveState("saving");
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentJson }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaveState("saved");
      try {
        window.dispatchEvent(new CustomEvent("note-saved", { detail: { id: noteId } }));
      } catch {}
      setTimeout(() => setSaveState("idle"), 800);
    } catch (e) {
      console.error(e);
      setSaveState("error");
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="w-full">
      <div className="mb-2 text-sm text-gray-500 flex items-center gap-2">
        <SaveBadge state={saveState} />
      </div>
      <div className="rounded-lg border border-white/10 bg-black text-white p-2 bn-dark">
        <BlockNoteView editor={editor} onChange={handleChange} />
        {loading ? (
          <div className="mt-2 text-xs text-gray-500">Loading…</div>
        ) : null}
      </div>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const map: Record<SaveState, { label: string; color: string }> = {
    idle: { label: "Saved", color: "bg-emerald-500" },
    saving: { label: "Saving…", color: "bg-amber-500" },
    saved: { label: "Saved", color: "bg-emerald-500" },
    error: { label: "Offline · Retry on edit", color: "bg-rose-500" },
  };
  const { label, color } = map[state];
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
