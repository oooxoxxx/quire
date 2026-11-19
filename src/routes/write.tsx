import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCopy } from "@/components/journal/use-copy";
import { useJournal } from "@/lib/journal/store";

export const Route = createFileRoute("/write")({
  validateSearch: (search: Record<string, unknown>) => ({
    date: typeof search.date === "string" ? search.date : undefined,
  }),
  component: WritePage,
});

function WritePage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const createEntry = useJournal((state) => state.createEntry);
  const discardIfEmpty = useJournal((state) => state.discardIfEmpty);
  const hydrated = useJournal((state) => state.hydrated);
  const { t } = useCopy();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void createEntry(search.date ? { entryDate: search.date } : {})
      .then((entry) => {
        if (cancelled) {
          void discardIfEmpty(entry.id);
          return;
        }
        void navigate({ to: "/entry/$id", params: { id: entry.id }, replace: true });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, createEntry, discardIfEmpty, navigate, search.date]);

  return (
    <main className="grid min-h-[50vh] place-items-center px-6 text-center">
      <p className="font-serif text-3xl">{failed ? t("notFound") : t("boot")}</p>
    </main>
  );
}
