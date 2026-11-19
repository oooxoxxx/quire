import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { EntryCard } from "@/components/journal/entry-card";
import { useCopy } from "@/components/journal/use-copy";
import { useJournal } from "@/lib/journal/store";
import { dayKey, formatMonth, liveEntries } from "@/lib/journal/text";

export const Route = createFileRoute("/calendar")({ component: CalendarPage });

function CalendarPage() {
  const entries = useJournal((state) => state.entries);
  const { t, language } = useCopy();
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(() => dayKey(new Date().toISOString()));
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of liveEntries(entries)) map.set(dayKey(entry.entryDate), (map.get(dayKey(entry.entryDate)) ?? 0) + 1);
    return map;
  }, [entries]);
  const weekStartsOn = language === "en" ? 1 : 0;
  const cells = monthCells(cursor.year, cursor.month, weekStartsOn);
  const selectedEntries = liveEntries(entries).filter((entry) => dayKey(entry.entryDate) === selected);
  const labels = weekdayLabels(language, weekStartsOn);

  return (
    <main className="px-4 py-6 md:px-10 md:py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-4xl">{t("calendar")}</h1>
        <div className="flex gap-1">
          <button type="button" className="grid size-11 place-items-center rounded-full" aria-label="Previous" onClick={() => setCursor((current) => shiftMonth(current, -1))}>
            <ChevronLeft />
          </button>
          <button type="button" className="grid size-11 place-items-center rounded-full" aria-label="Next" onClick={() => setCursor((current) => shiftMonth(current, 1))}>
            <ChevronRight />
          </button>
        </div>
      </div>
      <p className="mt-1 text-muted">{formatMonth(`${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`, language)}</p>
      <div className="mt-5 grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {labels.map((label) => (
          <div key={label} className="py-2">
            {label}
          </div>
        ))}
        {cells.map((date) => {
          const key = dayKey(date.toISOString());
          const inMonth = date.getMonth() === cursor.month;
          const count = counts.get(key) ?? 0;
          const active = key === selected;
          return (
            <button
              key={key + date.getMonth()}
              type="button"
              onClick={() => setSelected(key)}
              className={`min-h-12 rounded-control text-sm ${active ? "bg-clay text-clay-fg" : inMonth ? "text-fg" : "text-muted"}`}
            >
              {date.getDate()}
              {count > 0 ? <span className={`mx-auto mt-1 block size-1.5 rounded-full ${active ? "bg-clay-fg" : "bg-clay"}`} /> : <span className="mt-1 block size-1.5" />}
            </button>
          );
        })}
      </div>
      <section className="mt-8 space-y-3">
        {selectedEntries.length === 0 ? (
          <div className="quire-card p-5">
            <p className="font-serif text-2xl">{t("emptyDay")}</p>
            <button
              type="button"
              className="mt-3 text-sm font-medium text-clay"
              onClick={() => {
                const stamp = new Date(`${selected}T12:00:00`);
                void navigate({ to: "/write", search: { date: stamp.toISOString() } });
              }}
            >
              {t("writeThisDay")}
            </button>
          </div>
        ) : (
          selectedEntries.map((entry) => <EntryCard key={entry.id} entry={entry} />)
        )}
      </section>
      <p className="mt-4 text-xs text-muted">
        <Link to="/write" search={{ date: undefined }}>{t("sameDay")}</Link>
      </p>
    </main>
  );
}

function shiftMonth(cursor: { year: number; month: number }, delta: number) {
  const date = new Date(cursor.year, cursor.month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function monthCells(year: number, month: number, weekStartsOn: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function weekdayLabels(language: "zh-Hant" | "en", weekStartsOn: number): string[] {
  const formatter = new Intl.DateTimeFormat(language === "en" ? "en" : "zh-Hant", { weekday: "narrow" });
  const sunday = new Date(2024, 0, 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + ((index + weekStartsOn) % 7));
    return formatter.format(date);
  });
}
