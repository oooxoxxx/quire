import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { AttachmentPreview } from "@/components/journal/attachment-view";
import { useCopy } from "@/components/journal/use-copy";
import { useJournal } from "@/lib/journal/store";
import type { JournalEntry } from "@/lib/journal/types";
import { formatTime, snippet } from "@/lib/journal/text";

export function EntryCard({ entry }: { entry: JournalEntry }) {
  const { t, mood, language } = useCopy();
  const attachmentList = useJournal((state) => state.attachments);
  const attachments = useMemo(
    () => attachmentList.filter((item) => entry.attachmentIds.includes(item.id) && !item.deletedAt),
    [attachmentList, entry.attachmentIds],
  );
  const patchEntry = useJournal((state) => state.patchEntry);
  const images = attachments.filter((item) => item.kind === "image").slice(0, 3);
  const preview = snippet(entry.content);

  return (
    <article className="quire-card relative">
      <Link to="/entry/$id" params={{ id: entry.id }} className="block px-4 py-4 pr-12">
        <p className="text-xs tracking-wide text-muted">{formatTime(entry.entryDate, language)}</p>
        {entry.title ? <h3 className="mt-1 font-serif text-2xl leading-tight">{entry.title}</h3> : null}
        {preview ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{preview}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          {entry.mood ? <span>{mood(entry.mood)}</span> : null}
          {entry.location?.name ? <span>{entry.location.name}</span> : null}
          {entry.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
        {images.length > 0 ? (
          <div className={`mt-3 grid gap-2 ${images.length > 1 ? "grid-cols-3" : "grid-cols-1"}`}>
            {images.map((image) => (
              <AttachmentPreview
                key={image.id}
                id={image.id}
                kind="image"
                className={images.length > 1 ? "aspect-square rounded-control" : "aspect-[16/9] rounded-control"}
              />
            ))}
          </div>
        ) : null}
      </Link>
      <button
        type="button"
        className="absolute top-3 right-3 grid size-11 place-items-center rounded-full text-clay"
        aria-label={entry.isFavorite ? t("unfavorite") : t("favorite")}
        onClick={() => void patchEntry(entry.id, { isFavorite: !entry.isFavorite })}
      >
        <Star size={18} fill={entry.isFavorite ? "currentColor" : "none"} />
      </button>
    </article>
  );
}
