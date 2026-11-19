import type { JournalEntry, Mood } from "./types.ts";
import { stripHtml } from "./text.ts";

export interface SearchFilters {
  query: string;
  mood: Mood | null;
  tag: string | null;
  favorites: boolean;
  withMedia: boolean;
}

export function searchEntries(entries: JournalEntry[], filters: SearchFilters): JournalEntry[] {
  const query = filters.query.trim().toLowerCase();
  return entries
    .filter((entry) => !entry.deletedAt)
    .filter((entry) => (filters.favorites ? entry.isFavorite : true))
    .filter((entry) => (filters.mood ? entry.mood === filters.mood : true))
    .filter((entry) => (filters.tag ? entry.tags.includes(filters.tag) : true))
    .filter((entry) => (filters.withMedia ? entry.attachmentIds.length > 0 : true))
    .filter((entry) => {
      if (!query) return true;
      const haystack = [
        entry.title,
        stripHtml(entry.content),
        entry.tags.join(" "),
        entry.location?.name ?? "",
        entry.mood ?? "",
      ]
        .join("\n")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => +new Date(b.entryDate) - +new Date(a.entryDate));
}

export function memoriesOnThisDay(entries: JournalEntry[], now = new Date()): JournalEntry[] {
  const month = now.getMonth();
  const day = now.getDate();
  const year = now.getFullYear();
  return entries
    .filter((entry) => {
      if (entry.deletedAt) return false;
      const date = new Date(entry.entryDate);
      return date.getMonth() === month && date.getDate() === day && date.getFullYear() < year;
    })
    .sort((a, b) => +new Date(a.entryDate) - +new Date(b.entryDate));
}

export function memoryFallback(entries: JournalEntry[], now = new Date()): JournalEntry | null {
  const live = entries.filter((entry) => !entry.deletedAt && +new Date(entry.entryDate) < now.getTime() - 86_400_000);
  if (live.length === 0) return null;
  const favorites = live.filter((entry) => entry.isFavorite);
  const pool = favorites.length > 0 ? favorites : live;
  const target = now.getTime() - 365 * 86_400_000;
  return [...pool].sort(
    (a, b) => Math.abs(+new Date(a.entryDate) - target) - Math.abs(+new Date(b.entryDate) - target),
  )[0] ?? null;
}
