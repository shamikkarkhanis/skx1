'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const emptyDoc: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export default function NoteEditor() {
  const [noteId, setNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start typing your note…' }),
    ],
    content: emptyDoc,
    onUpdate: ({ editor }) => {
      setSaveState('saving');
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void save(editor.getJSON());
      }, 800);
    },
    autofocus: true,
    editorProps: {
      attributes: {
        class: 'focus:outline-none max-w-none min-h-[50vh] p-0',
      },
    },
    // 👇 key line to fix your error
    immediatelyRender: false,
  });
  

  useEffect(() => {
    // Load existing note or create a new one
    const init = async () => {
      try {
        let id = localStorage.getItem('lastNoteId');
        if (id) {
          const res = await fetch(`/api/notes/${id}`);
          if (res.ok) {
            const data = await res.json();
            setNoteId(data.id);
            localStorage.setItem('lastNoteId', data.id);
            editor?.commands.setContent(data.contentJson ?? emptyDoc, { emitUpdate: false });
          } else {
            id = null; // fallback to create
          }
        }
        if (!id) {
          const res = await fetch('/api/notes', { method: 'POST' });
          if (!res.ok) throw new Error('Failed to create note');
          const data = await res.json();
          setNoteId(data.id);
          localStorage.setItem('lastNoteId', data.id);
          editor?.commands.setContent(emptyDoc, { emitUpdate: false });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [editor]);

  // Cleanup pending debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  async function save(contentJson: unknown) {
    if (!noteId) return;
    try {
      const title = deriveTitleFromContent(editor?.getText() ?? '');
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, contentJson }),
      });
      if (!res.ok) throw new Error('Failed');
      setSaveState('saved');
      // Return to idle after a short delay
      setTimeout(() => setSaveState('idle'), 1000);
    } catch (e) {
      console.error(e);
      setSaveState('error');
    }
  }

  if (!editor) return null;

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="mb-2 text-sm text-gray-500 flex items-center gap-2">
        <SaveBadge state={saveState} />
      </div>
      <div className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black p-4">
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const map: Record<SaveState, { label: string; color: string }> = {
    idle: { label: 'Saved', color: 'bg-emerald-500' },
    saving: { label: 'Saving…', color: 'bg-amber-500' },
    saved: { label: 'Saved', color: 'bg-emerald-500' },
    error: { label: 'Offline · Retry on edit', color: 'bg-rose-500' },
  };
  const { label, color } = map[state];
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function deriveTitleFromContent(text: string) {
  const firstLine = text.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
  const title = firstLine || 'Untitled';
  return title.slice(0, 120);
}
