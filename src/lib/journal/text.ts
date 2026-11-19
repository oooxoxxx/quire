import type { JournalEntry, Language } from "./types.ts";

export function stripHtml(html: string): string {
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(stripped)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

export function isBlankEntry(entry: Pick<JournalEntry, "title" | "content" | "attachmentIds">): boolean {
  return entry.title.trim().length === 0 && stripHtml(entry.content).length === 0 && entry.attachmentIds.length === 0;
}

export function snippet(html: string, max = 140): string {
  const text = stripHtml(html).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "invalid";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthKey(iso: string): string {
  return dayKey(iso).slice(0, 7);
}

export interface DayGroup {
  dayKey: string;
  entries: JournalEntry[];
}

export interface MonthGroup {
  monthKey: string;
  days: DayGroup[];
}

export function liveEntries(entries: JournalEntry[]): JournalEntry[] {
  return entries
    .filter((entry) => !entry.deletedAt)
    .sort((a, b) => {
      const byDate = +new Date(b.entryDate) - +new Date(a.entryDate);
      if (byDate !== 0) return byDate;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export function groupEntries(entries: JournalEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const entry of liveEntries(entries)) {
    const mk = monthKey(entry.entryDate);
    const dk = dayKey(entry.entryDate);
    let month = groups.find((item) => item.monthKey === mk);
    if (!month) {
      month = { monthKey: mk, days: [] };
      groups.push(month);
    }
    let day = month.days.find((item) => item.dayKey === dk);
    if (!day) {
      day = { dayKey: dk, entries: [] };
      month.days.push(day);
    }
    day.entries.push(entry);
  }
  return groups;
}

export function localeFor(language: Language): string {
  return language === "zh-Hant" ? "zh-Hant" : "en";
}

export function formatLongDate(iso: string, language: Language): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(localeFor(language), {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatMonth(month: string, language: Language): string {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return month;
  return new Intl.DateTimeFormat(localeFor(language), { year: "numeric", month: "long" }).format(
    new Date(year, m - 1, 1),
  );
}

export function formatDayNum(day: string): string {
  return String(Number(day.slice(8, 10)));
}

export function formatWeekday(day: string, language: Language): string {
  const [year, m, d] = day.split("-").map(Number);
  if (!year || !m || !d) return "";
  return new Intl.DateTimeFormat(localeFor(language), { weekday: "short" }).format(new Date(year, m - 1, d));
}

export function formatTime(iso: string, language: Language): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(localeFor(language), { hour: "numeric", minute: "2-digit" }).format(date);
}

export function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= 30) break;
  }
  return out;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function htmlToMarkdown(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/h2>/gi, "\n")
    .replace(/<h2[^>]*>/gi, "## ")
    .replace(/<\/h3>/gi, "\n")
    .replace(/<h3[^>]*>/gi, "### ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(ul|ol)>/gi, "\n")
    .replace(/<blockquote[^>]*>/gi, "\n> ")
    .replace(/<\/blockquote>/gi, "\n")
    .replace(/<(strong|b)[^>]*>/gi, "**")
    .replace(/<\/(strong|b)>/gi, "**")
    .replace(/<(em|i)[^>]*>/gi, "*")
    .replace(/<\/(em|i)>/gi, "*")
    .replace(/<\/(p|div)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return stripHtml(`<p>${withBreaks}</p>`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeHtml(input: string): string {
  const withoutDanger = input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
  if (typeof DOMParser === "undefined") return withoutDanger;
  const allowed = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "DIV"]);
  const doc = new DOMParser().parseFromString(`<div>${withoutDanger}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  const clean = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) return [node.cloneNode()];
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node as HTMLElement;
    const children = [...el.childNodes].flatMap(clean);
    if (!allowed.has(el.tagName)) return children;
    const fresh = doc.createElement(el.tagName.toLowerCase());
    children.forEach((child) => fresh.appendChild(child));
    return [fresh];
  };
  const wrapper = doc.createElement("div");
  [...root.childNodes].flatMap(clean).forEach((node) => wrapper.appendChild(node));
  return wrapper.innerHTML;
}

export function entrySignature(entry: JournalEntry): string {
  return JSON.stringify({
    title: entry.title,
    content: entry.content,
    entryDate: entry.entryDate,
    timezone: entry.timezone,
    mood: entry.mood,
    tags: entry.tags,
    location: entry.location,
    attachmentIds: entry.attachmentIds,
    isFavorite: entry.isFavorite,
    deletedAt: entry.deletedAt,
    metadata: entry.metadata,
  });
}

export function allTags(entries: JournalEntry[]): string[] {
  const tags = new Set<string>();
  for (const entry of entries) {
    if (entry.deletedAt) continue;
    entry.tags.forEach((tag) => tags.add(tag));
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}
