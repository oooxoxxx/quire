import { createFileRoute } from "@tanstack/react-router";
import { EntryCard } from "@/components/journal/entry-card";
import { useCopy } from "@/components/journal/use-copy";
import { memoriesOnThisDay, memoryFallback } from "@/lib/journal/search";
import { useJournal } from "@/lib/journal/store";
import { formatLongDate } from "@/lib/journal/text";

export const Route = createFileRoute("/memories")({ component: MemoriesPage });

function MemoriesPage() {
  const entries = useJournal((state) => state.entries);
  const { t, language } = useCopy();
  const onThisDay = memoriesOnThisDay(entries);
  const fallback = onThisDay.length === 0 ? memoryFallback(entries) : null;

  return (
    <main className="px-4 py-6 md:px-10 md:py-10">
      <h1 className="font-serif text-4xl">{t("memories")}</h1>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted">{t("memoriesIntro")}</p>
      <section className="mt-8">
        <h2 className="font-serif text-2xl">{t("onThisDay")}</h2>
        {onThisDay.length === 0 ? <p className="mt-3 text-sm text-muted">{t("noMemories")}</p> : null}
        <div className="mt-4 space-y-3">
          {onThisDay.map((entry) => (
            <div key={entry.id}>
              <p className="mb-2 text-sm text-muted">{formatLongDate(entry.entryDate, language)}</p>
              <EntryCard entry={entry} />
            </div>
          ))}
        </div>
      </section>
      {fallback ? (
        <section className="mt-10">
          <h2 className="font-serif text-2xl">{t("earlierPage")}</h2>
          <p className="mt-1 text-sm text-muted">{formatLongDate(fallback.entryDate, language)}</p>
          <div className="mt-3">
            <EntryCard entry={fallback} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
