'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Extension, type Editor as TipTapEditor } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const emptyDoc: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export default function NoteEditor({ noteId: noteIdProp }: { noteId?: string | null } = {}) {
  const [noteId, setNoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Custom keyboard shortcuts to feel closer to Notion
  const CustomShortcuts = Extension.create({
    name: 'customShortcuts',
    addKeyboardShortcuts() {
      return {
        'Mod-Alt-1': () => this.editor.commands.setHeading({ level: 1 }),
        'Mod-Alt-2': () => this.editor.commands.setHeading({ level: 2 }),
        'Mod-Alt-3': () => this.editor.commands.setHeading({ level: 3 }),
        'Mod-Alt-4': () => this.editor.commands.setHeading({ level: 4 }),
        'Mod-Alt-5': () => this.editor.commands.setHeading({ level: 5 }),
        'Mod-Alt-6': () => this.editor.commands.setHeading({ level: 6 }),
        'Mod-Shift-8': () => this.editor.commands.toggleBulletList(), // • bullets
        'Mod-Shift-7': () => this.editor.commands.toggleOrderedList(), // 1. numbers
        'Mod-Shift-9': () => this.editor.commands.toggleTaskList(), // ☐ tasks
      };
    },
  });

  // Notion-style "/" slash command menu using @tiptap/suggestion
  type SlashItem = {
    title: string;
    subtitle?: string;
    run: (editor: TipTapEditor) => void;
    keywords?: string[];
  };

  const slashItems: SlashItem[] = [
    { title: 'Heading 1', keywords: ['h1', 'heading1'], run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
    { title: 'Heading 2', keywords: ['h2', 'heading2'], run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
    { title: 'Heading 3', keywords: ['h3', 'heading3'], run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
    { title: 'Bulleted list', keywords: ['ul', 'bullet', 'list'], run: (e) => e.chain().focus().toggleBulletList().run() },
    { title: 'Numbered list', keywords: ['ol', 'ordered', 'list'], run: (e) => e.chain().focus().toggleOrderedList().run() },
    { title: 'To‑do list', keywords: ['todo', 'task', 'checklist'], run: (e) => e.chain().focus().toggleTaskList().run() },
    { title: 'Quote', keywords: ['blockquote', 'quote'], run: (e) => e.chain().focus().toggleBlockquote().run() },
    { title: 'Code block', keywords: ['code'], run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { title: 'Divider', keywords: ['hr', 'divider', 'rule'], run: (e) => e.chain().focus().setHorizontalRule().run() },
  ];

  const SlashCommands = Extension.create({
    name: 'slashCommands',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        Suggestion({
          editor,
          char: '/',
          startOfLine: true,
          allowSpaces: false,
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            return slashItems.filter((i) =>
              !q || i.title.toLowerCase().includes(q) || (i.keywords ?? []).some((k) => k.includes(q)),
            );
          },
          command: ({ editor, range, props }: any) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .run();
            (props as { item: SlashItem }).item.run(editor);
          },
          render: () => {
            const root = document.createElement('div');
            root.className = 'border border-black/10 dark:border-white/10 rounded-md bg-white/95 dark:bg-black/85 backdrop-blur shadow-md p-1 min-w-[180px]';
            const list = document.createElement('ul');
            list.className = 'max-h-64 overflow-auto';
            root.appendChild(list);
            let items: SlashItem[] = [];
            let selected = 0;

            const updateList = () => {
              list.innerHTML = '';
              items.forEach((item, idx) => {
                const li = document.createElement('li');
                li.className = 'px-2 py-1 text-sm cursor-pointer rounded ' + (idx === selected ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/10');
                li.textContent = item.title;
                li.addEventListener('mousedown', (e) => {
                  e.preventDefault();
                });
                li.addEventListener('click', () => {
                  (this as any).props.command({ id: idx });
                });
                list.appendChild(li);
              });
            };

            return {
              onStart: ({ items: its, clientRect, props, editor }: any) => {
                items = its as SlashItem[];
                selected = 0;
                updateList();
                document.body.appendChild(root);
                const rect = clientRect?.();
                if (rect) {
                  root.style.position = 'absolute';
                  root.style.left = `${rect.left}px`;
                  root.style.top = `${(rect.bottom ?? rect.top) + 6}px`;
                }
                (this as any).props = { props, editor, command: ({ id }: { id: number }) => props.command({ editor, range: props.range, props: { item: items[id] } }) };
              },
              onUpdate: ({ items: its, clientRect, props, editor }: any) => {
                items = its as SlashItem[];
                selected = Math.min(selected, Math.max(items.length - 1, 0));
                updateList();
                const rect = clientRect?.();
                if (rect) {
                  root.style.left = `${rect.left}px`;
                  root.style.top = `${(rect.bottom ?? rect.top) + 6}px`;
                }
                (this as any).props = { props, editor, command: ({ id }: { id: number }) => props.command({ editor, range: props.range, props: { item: items[id] } }) };
              },
              onKeyDown: ({ event }: any) => {
                if (event.key === 'ArrowDown') {
                  selected = Math.min(selected + 1, Math.max(items.length - 1, 0));
                  updateList();
                  return true;
                }
                if (event.key === 'ArrowUp') {
                  selected = Math.max(selected - 1, 0);
                  updateList();
                  return true;
                }
                if (event.key === 'Enter') {
                  (this as any).props.command({ id: selected });
                  return true;
                }
                return false;
              },
              onExit: () => {
                root.remove();
              },
            };
          },
        }),
      ];
    },
  });

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      CustomShortcuts,
      SlashCommands,
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
        class: 'tiptap focus:outline-none max-w-none min-h-[50vh] p-0',
      },
    },
    // 👇 key line to fix your error
    immediatelyRender: false,
  });
  

  // If a noteId is provided via props, load that note and skip auto-create logic
  useEffect(() => {
    const loadFromProp = async () => {
      if (!editor) return;
      if (!noteIdProp) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/notes/${noteIdProp}`);
        if (!res.ok) throw new Error('Failed to load note');
        const data = await res.json();
        setNoteId(data.id);
        localStorage.setItem('lastNoteId', data.id);
        editor.commands.setContent(data.contentJson ?? emptyDoc, { emitUpdate: false });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    void loadFromProp();
  }, [editor, noteIdProp]);

  // If no prop is provided, keep existing behavior: load last or create new
  useEffect(() => {
    const init = async () => {
      if (!editor) return;
      if (noteIdProp) return; // controlled externally
      try {
        let id = localStorage.getItem('lastNoteId');
        if (id) {
          const res = await fetch(`/api/notes/${id}`);
          if (res.ok) {
            const data = await res.json();
            setNoteId(data.id);
            localStorage.setItem('lastNoteId', data.id);
            editor.commands.setContent(data.contentJson ?? emptyDoc, { emitUpdate: false });
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
          editor.commands.setContent(emptyDoc, { emitUpdate: false });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, [editor, noteIdProp]);

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
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentJson }),
      });
      if (!res.ok) throw new Error('Failed');
      setSaveState('saved');
      try {
        // Notify listeners (e.g., sidebar) to refresh immediately
        window.dispatchEvent(new CustomEvent('note-saved', { detail: { id: noteId } }));
      } catch {}
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
          <>
            {/* Inline selection menu (bold/italic/code and quick list/heading toggles) */}
            <BubbleMenu editor={editor}>
              <div className="flex items-center gap-1 rounded-md border border-black/10 dark:border-white/10 bg-white/90 dark:bg-black/80 backdrop-blur px-2 py-1 shadow-sm">
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('bold') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                >
                  Bold
                </button>
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('italic') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                  Italic
                </button>
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('code') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleCode().run()}
                >
                  Code
                </button>
                <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-1" />
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('bulletList') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                >
                  Bulleted
                </button>
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('orderedList') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                >
                  Numbered
                </button>
              </div>
            </BubbleMenu>

            {/* Block menu shown on empty lines to insert blocks like Notion */}
            <FloatingMenu
              editor={editor}
              shouldShow={({ editor }: { editor: TipTapEditor }) => editor.isActive('paragraph') }
            >
              <div className="flex flex-wrap items-center gap-1 rounded-md border border-black/10 dark:border-white/10 bg-white/90 dark:bg-black/80 backdrop-blur px-2 py-1 shadow-sm">
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('heading', { level: 1 }) ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().setHeading({ level: 1 }).run()}
                >
                  H1
                </button>
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('heading', { level: 2 }) ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().setHeading({ level: 2 }).run()}
                >
                  H2
                </button>
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('heading', { level: 3 }) ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().setHeading({ level: 3 }).run()}
                >
                  H3
                </button>
                <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-1" />
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('bulletList') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                >
                  Bullet List
                </button>
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('orderedList') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                >
                  Numbered List
                </button>
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('taskList') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleTaskList().run()}
                >
                  To‑do List
                </button>
                <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-1" />
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('blockquote') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}
                >
                  Quote
                </button>
                <button
                  className={`px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 ${editor.isActive('codeBlock') ? 'bg-black/10 dark:bg-white/20' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                >
                  Code Block
                </button>
                <button
                  className="px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().setHorizontalRule().run()}
                >
                  Divider
                </button>
              </div>
            </FloatingMenu>

            <EditorContent editor={editor} />
          </>
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
