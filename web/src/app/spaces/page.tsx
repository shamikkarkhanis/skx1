"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Space = {
  id: string;
  name: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export default function SpacesPage() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  // Inline edit/delete state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadSpaces() {
    try {
      setError(null);
      const res = await fetch("/api/spaces", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch spaces");
      const data = (await res.json()) as Space[];
      setSpaces(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message || "Failed to fetch spaces");
    } finally {
      setLoading(false);
    }
  }

  async function createSpace(suggest?: { name?: string }) {
    const n = (suggest?.name ?? name).trim();
    if (!n) return;
    try {
      setCreating(true);
      setError(null);
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      if (!res.ok) throw new Error("Failed to create space");
      setName("");
      await loadSpaces();
    } catch (e) {
      setError((e as Error).message || "Failed to create space");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    void loadSpaces();
  }, []);

  const sorted = useMemo(() => {
    return [...spaces].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [spaces]);

  return (
    <div className="min-h-screen px-6 py-8 max-w-3xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <Link href="/" className="text-sm underline">Home</Link>
          <span className="opacity-50">/</span>
          <h1 className="text-2xl font-semibold">Spaces</h1>
        </div>
        <div className="flex gap-2" />
      </header>

      <section className="mb-8">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs mb-1 opacity-70">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. School, Work, Personal"
              className="w-full px-3 py-2 rounded border border-white/15 bg-transparent"
            />
          </div>
          <button
            className="px-3 py-2 rounded border border-white/15 bg-white/5 hover:bg-white/10"
            onClick={() => createSpace()}
            disabled={creating || !name.trim()}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider mb-2 opacity-70">All spaces</h2>
        {loading ? (
          <p className="text-sm opacity-70">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm opacity-70">No spaces yet. Create one above.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((s) => (
              <li key={s.id} className="p-3 rounded border border-white/10 hover:bg-white/5">
                {editingId === s.id ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2 items-end">
                      <div className="flex-1 min-w-40">
                        <label className="block text-[10px] opacity-70">Name</label>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1 text-sm rounded border border-white/15 bg-transparent"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-1.5 text-sm rounded border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-50"
                        disabled={busyId === s.id || !editName.trim()}
                        onClick={async () => {
                          try {
                            setBusyId(s.id);
                            const res = await fetch(`/api/spaces/${s.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ name: editName.trim() }),
                            });
                            if (!res.ok) throw new Error('Failed to update space');
                            setEditingId(null);
                            setEditName("");
                            await loadSpaces();
                          } catch (e) {
                            setError((e as Error).message || 'Failed to update space');
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        {busyId === s.id ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        className="px-3 py-1.5 text-sm rounded border border-white/15 hover:bg-white/5"
                        onClick={() => {
                          setEditingId(null);
                          setEditName("");
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="ml-auto px-3 py-1.5 text-sm rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                        disabled={busyId === s.id}
                        onClick={async () => {
                          if (!confirm('Delete this space? Notes will be detached from this space.')) return;
                          try {
                            setBusyId(s.id);
                            const res = await fetch(`/api/spaces/${s.id}`, { method: 'DELETE' });
                            if (!res.ok) throw new Error('Failed to delete space');
                            setEditingId(null);
                            await loadSpaces();
                          } catch (e) {
                            setError((e as Error).message || 'Failed to delete space');
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <Link href={`/spaces/${s.id}`} className="flex-1 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="text-xs opacity-70">
                          {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : null}
                        </div>
                      </div>
                      <span className="text-xs underline">Open</span>
                    </Link>
                    <button
                      className="px-2 py-1 text-xs rounded border border-white/15 hover:bg-white/5"
                      onClick={() => {
                        setEditingId(s.id);
                        setEditName(s.name);
                      }}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
