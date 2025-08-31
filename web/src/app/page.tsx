import Link from "next/link";
import NotesShell from "@/components/NotesShell";

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="px-6 py-3 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
        <h1 className="text-sm font-medium">Home</h1>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/spaces" className="underline">Spaces</Link>
        </nav>
      </header>
      <NotesShell />
    </div>
  );
}
