import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { EntryCard } from "@/components/journal/entry-card";
import { useCopy } from "@/components/journal/use-copy";
import { useJournal } from "@/lib/journal/store";
import { dayKey, formatDayNum, formatLongDate, formatMonth, formatWeekday, groupEntries } from "@/lib/journal/text";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const entries = useJournal((state) => state.entries);
  const { t, hello, language } = useCopy();
  const groups = groupEntries(entries);
  const today = dayKey(new Date().toISOString());
  const hasToday = groups.some((month) => month.days.some((day) => day.dayKey === today));

  return (
    <main className="px-4 py-6 md:px-10 md:py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted md:hidden">Quire</p>
          <h1 className="font-serif text-4xl md:text-5xl">{hello}</h1>
          <p className="mt-1 text-sm text-muted">{formatLongDate(new Date().toISOString(), language)}</p>
        </div>
        <Link to="/settings" className="grid size-11 place-items-center rounded-full md:hidden" aria-label={t("settings")}>
          <Settings size={20} />
        </Link>
      </div>
      {hasToday ? null : (
        <Link to="/write" search={{ date: undefined }} className="quire-card mt-6 block p-5">
          <p className="font-serif text-3xl">{t("todayEmpty")}</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">{t("todayHint")}</p>
          <p className="mt-4 text-sm font-medium text-clay">{t("writeToday")}</p>
        </Link>
      )}
      {groups.length === 0 ? <p className="mt-6 max-w-md text-sm leading-6 text-muted">{t("privacyNote")}</p> : null}
      <div className="mt-10 space-y-12">
        {groups.map((month) => (
          <section key={month.monthKey}>
            <h2 className="font-serif text-2xl">{formatMonth(month.monthKey, language)}</h2>
            <div className="mt-5 space-y-6">
              {month.days.map((day) => (
                <div key={day.dayKey} className="flex gap-3">
                  <div className="w-12 shrink-0 pt-4 text-right">
                    <p className="font-serif text-3xl leading-none">{formatDayNum(day.dayKey)}</p>
                    <p className="mt-1 text-xs text-muted">{formatWeekday(day.dayKey, language)}</p>
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    {day.entries.map((entry) => (
                      <EntryCard key={entry.id} entry={entry} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
