import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { EntryCard } from "@/components/journal/entry-card";
import { useCopy } from "@/components/journal/use-copy";
import { searchEntries } from "@/lib/journal/search";
import { useJournal } from "@/lib/journal/store";
import { allTags } from "@/lib/journal/text";
import { MOODS, type Mood } from "@/lib/journal/types";

export const Route = createFileRoute("/search")({ component: SearchPage });

function SearchPage() {
  const entries = useJournal((state) => state.entries);
  const { t, mood } = useCopy();
  const [query, setQuery] = useState("");
  const [moodFilter, setMoodFilter] = useState<Mood | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [favorites, setFavorites] = useState(false);
  const [withMedia, setWithMedia] = useState(false);
  const tags = useMemo(() => allTags(entries), [entries]);
  const results = searchEntries(entries, { query, mood: moodFilter, tag, favorites, withMedia });

  return (
    <main className="px-4 py-6 md:px-10 md:py-10">
      <h1 className="font-serif text-4xl">{t("search")}</h1>
      <input
        className="field mt-5"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchPlaceholder")}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Filter on={favorites} label={t("favoritesOnly")} onClick={() => setFavorites((value) => !value)} />
        <Filter on={withMedia} label={t("withMedia")} onClick={() => setWithMedia((value) => !value)} />
        <Filter on={moodFilter === null} label={t("allMoods")} onClick={() => setMoodFilter(null)} />
        {MOODS.map((item) => (
          <Filter key={item} on={moodFilter === item} label={mood(item)} onClick={() => setMoodFilter(item)} />
        ))}
      </div>
      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((item) => (
            <Filter key={item} on={tag === item} label={`#${item}`} onClick={() => setTag((current) => (current === item ? null : item))} />
          ))}
        </div>
      ) : null}
      <div className="mt-6 space-y-3">
        {results.length === 0 ? <p className="text-sm text-muted">{query || favorites || withMedia || moodFilter || tag ? t("noResults") : t("noEntries")}</p> : null}
        {results.map((entry) => (
          <EntryCard key={entry.id} entry={entry} />
        ))}
      </div>
    </main>
  );
}

function Filter({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`min-h-11 rounded-full px-3 text-sm ${on ? "bg-clay text-clay-fg" : "bg-card text-fg"}`}>
      {label}
    </button>
  );
}
