"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import NotesShell from "@/components/NotesShell";

export default function SpacePage() {
  const params = useParams();
  const id = (params?.id as string) || "";
  if (!id) return <div className="p-6 text-sm">Invalid space</div>;
  return (
    <div className="min-h-screen">
      <header className="px-6 py-3 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
        <nav className="flex items-baseline gap-2 text-sm">
          <Link href="/" className="underline">Home</Link>
          <span className="opacity-50">/</span>
          <Link href="/spaces" className="underline">Spaces</Link>
          <span className="opacity-50">/</span>
          <span className="opacity-80">{id.slice(0, 8)}…</span>
        </nav>
      </header>
      <NotesShell spaceId={id} />
    </div>
  );
}
