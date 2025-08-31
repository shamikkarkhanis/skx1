"use client";

import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

type Space = { id: string; name: string };

export default function BlockNoteEditor({ noteId }: { noteId?: string | null }) {
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializingRef = useRef(false);
  const editorRef = useRef<any>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [showSpacePicker, setShowSpacePicker] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');

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

  // Load initial content + metadata when noteId changes
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
        // metadata: spaceId
        setSpaceId(typeof data?.spaceId === 'string' ? data.spaceId as string : null);
        // metadata: tags for "create space from tag"
        try {
          const arr = Array.isArray(data?.tags) ? (data.tags as string[]) : [];
          setTags(arr.filter((x) => typeof x === 'string' && x.trim().length > 0));
        } catch {}
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

  // Load spaces once (for picker)
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await fetch('/api/spaces', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as Space[];
        if (!stop) setSpaces(data);
      } catch {}
    })();
    return () => { stop = true; };
  }, []);

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

  async function assignSpace(next: string | null) {
    if (!noteId) return;
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId: next }),
      });
      if (!res.ok) throw new Error('Failed to update space');
      setSpaceId(next);
      setShowSpacePicker(false);
      try { window.dispatchEvent(new CustomEvent('note-saved', { detail: { id: noteId } })); } catch {}
    } catch (e) {
      console.error(e);
    }
  }

  async function createSpaceFromTag(name: string) {
    const name_processed = (name || '').trim();
    if (!name_processed) return;
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name_processed }),
      });
      if (!res.ok) throw new Error('Failed to create space');
      const created = (await res.json()) as { id: string; name: string };
      setSpaces((prev) => [{ id: created.id, name: created.name }, ...prev]);
      await assignSpace(created.id);
    } catch (e) {
      console.error(e);
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="w-full relative">
      <div className="mb-2 text-sm text-gray-500 flex items-center gap-2 flex-wrap">
        <SaveBadge state={saveState} />
        {/* Space pill or + bubble */}
        {spaceId ? (
          <button
            type="button"
            onClick={() => assignSpace(null)}
            title="Remove from space"
            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/30 hover:bg-blue-500/25"
          >
            {(() => {
              const sp = spaces.find((s) => s.id === spaceId);
              return sp?.name || spaceId?.slice(0, 8);
            })()} ✕
          </button>
        ) : (
          <div className="relative inline-block">
            <button
              type="button"
              onClick={() => setShowSpacePicker((v) => !v)}
              className="text-[10px] px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-gray-700 dark:text-gray-300 border border-black/10 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/15"
              title="Add to a space"
            >
              + Space
            </button>
            {showSpacePicker ? (
              <div className="absolute z-10 mt-1 w-56 rounded border border-black/10 dark:border-white/10 bg-white dark:bg-black shadow-lg">
                <div className="max-h-72 overflow-auto text-sm">
                  <ul>
                    {spaces.length === 0 ? (
                      <li className="px-2 py-2 text-xs text-gray-500">No spaces</li>
                    ) : (
                      spaces.map((s) => (
                        <li key={s.id}>
                          <button
                            className="w-full text-left px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                            onClick={() => assignSpace(s.id)}
                          >
                            {s.name}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                  {tags.length > 0 ? (
                    <>
                      <div className="my-1 mx-2 h-px bg-black/10 dark:bg-white/10" />
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wider opacity-60">Create space</div>
                      <div className="px-2 py-1 flex gap-2">
                        <input
                          type="text"
                          placeholder="New Space"
                          className="w-full px-2 py-1 border border-black/10 dark:border-white/10 rounded"
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <button
                          type="button"
                          className="w-full px-2 py-1 border border-black/10 dark:border-white/10 rounded"
                          onClick={() => createSpaceFromTag(search)}
                        >
                          Create
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
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
