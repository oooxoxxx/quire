import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCopy } from "@/components/journal/use-copy";
import { useJournal } from "@/lib/journal/store";
import type { JournalEntry } from "@/lib/journal/types";
import { formatLongDate, stripHtml } from "@/lib/journal/text";

export const Route = createFileRoute("/print")({ component: PrintPage });

function PrintPage() {
  const entries = useJournal((state) => state.entries);
  const { t, language } = useCopy();
  const [chosen, setChosen] = useState<JournalEntry[]>([]);

  useEffect(() => {
    const raw = sessionStorage.getItem("quire-print-ids");
    const ids = raw ? (JSON.parse(raw) as string[]) : null;
    const live = entries.filter((entry) => !entry.deletedAt && (!ids || ids.includes(entry.id)));
    setChosen(live);
  }, [entries]);

  return (
    <main className="mx-auto max-w-2xl bg-card px-6 py-8 text-fg">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link to="/data" className="text-sm text-clay">
          {t("back")}
        </Link>
        <button type="button" className="min-h-11 rounded-control bg-clay px-4 text-sm text-clay-fg" onClick={() => window.print()}>
          {t("printPdf")}
        </button>
      </div>
      <h1 className="font-serif text-4xl">Quire</h1>
      {chosen.map((entry) => (
        <article key={entry.id} className="mt-8 border-t border-line pt-6">
          <p className="text-sm text-muted">{formatLongDate(entry.entryDate, language)}</p>
          {entry.title ? <h2 className="mt-1 font-serif text-3xl">{entry.title}</h2> : null}
          <p className="mt-4 whitespace-pre-wrap font-serif text-lg leading-8">{stripHtml(entry.content)}</p>
        </article>
      ))}
    </main>
  );
}
