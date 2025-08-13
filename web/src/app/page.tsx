import NoteEditor from "@/components/NoteEditor";

export default function Home() {
  return (
    <main className="min-h-screen p-8 sm:p-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Notes</h1>
        <NoteEditor />
      </div>
    </main>
  );
}
