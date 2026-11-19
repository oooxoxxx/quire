import JSZip from "jszip";
import { randomId, sha256Hex } from "../crypto.ts";
import type { AttachmentKind, AttachmentRecord, JournalEntry, Mood } from "../types.ts";
import { decodeHtmlEntities, escapeHtml, snippet, stripHtml } from "../text.ts";

export interface AppleImportItem {
  appleSourceId: string;
  title: string;
  entryDate: string;
  excerpt: string;
  counts: { image: number; video: number; audio: number; file: number };
  locationName: string | null;
  status: "new" | "duplicate" | "error";
  message?: string;
  entry?: JournalEntry;
  attachments?: AttachmentRecord[];
}

export interface AppleImportPreview {
  items: AppleImportItem[];
  filesScanned: number;
  /** True only when the archive was generated as a fixture, never for a user file. */
  simulated: boolean;
}

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const MOOD_WORDS: Record<string, Mood> = {
  grateful: "grateful",
  thankful: "grateful",
  happy: "joyful",
  joyful: "joyful",
  joy: "joyful",
  calm: "calm",
  peaceful: "calm",
  reflective: "reflective",
  thoughtful: "reflective",
  sad: "sad",
  down: "sad",
  anxious: "anxious",
  stressed: "anxious",
  excited: "excited",
  tired: "tired",
  exhausted: "tired",
  感恩: "grateful",
  感激: "grateful",
  開心: "joyful",
  高兴: "joyful",
  快樂: "joyful",
  平靜: "calm",
  平静: "calm",
  反思: "reflective",
  難過: "sad",
  难过: "sad",
  焦慮: "anxious",
  焦虑: "anxious",
  興奮: "excited",
  兴奋: "excited",
  疲倦: "tired",
  累: "tired",
};

function decodeEntities(value: string): string {
  return decodeHtmlEntities(value);
}

function inner(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  return match?.[1] ? decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
}

function parseLooseDate(value: string): { iso: string; precision: "minute" | "day" } | null {
  const text = value.trim();
  if (!text) return null;
  const iso = Date.parse(text);
  if (!Number.isNaN(iso) && /[T\d]/.test(text) && (text.includes("T") || /\d{1,2}:\d{2}/.test(text))) {
    return { iso: new Date(iso).toISOString(), precision: "minute" };
  }
  const chinese = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/);
  if (chinese) {
    const year = Number(chinese[1]);
    const month = Number(chinese[2]);
    const day = Number(chinese[3]);
    const hour = chinese[4] ? Number(chinese[4]) : 12;
    const minute = chinese[5] ? Number(chinese[5]) : 0;
    return {
      iso: new Date(year, month - 1, day, hour, minute, 0, 0).toISOString(),
      precision: chinese[4] ? "minute" : "day",
    };
  }
  const ymd = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (ymd) {
    const date = new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      ymd[4] ? Number(ymd[4]) : 12,
      ymd[5] ? Number(ymd[5]) : 0,
      0,
      0,
    );
    if (!Number.isNaN(date.getTime())) {
      return { iso: date.toISOString(), precision: ymd[4] ? "minute" : "day" };
    }
  }
  const long = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (long) {
    const month = MONTHS[long[1].toLowerCase()];
    if (month !== undefined) {
      return {
        iso: new Date(Number(long[3]), month, Number(long[2]), 12, 0, 0, 0).toISOString(),
        precision: "day",
      };
    }
  }
  return null;
}

function dateFromFilename(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const match = name.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const parsed = parseLooseDate(match[1]);
  return parsed?.iso ?? null;
}

function kindFor(path: string, hint: string): AttachmentKind {
  const ext = path.split(".").pop()?.toLowerCase().split("?")[0] ?? "";
  const className = hint.toLowerCase();
  if (className.includes("video") || ["mov", "mp4", "m4v", "webm"].includes(ext)) return "video";
  if (className.includes("audio") || ["m4a", "mp3", "aac", "wav", "caf", "ogg"].includes(ext)) return "audio";
  if (
    className.includes("photo") ||
    className.includes("image") ||
    ["jpg", "jpeg", "png", "gif", "heic", "webp", "tif", "tiff"].includes(ext)
  ) {
    return "image";
  }
  return "file";
}

function mimeFor(path: string, kind: AttachmentKind): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    mov: "video/quicktime",
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: kind === "audio" ? "audio/webm" : "video/webm",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    aac: "audio/aac",
    wav: "audio/wav",
    caf: "audio/x-caf",
  };
  return map[ext] ?? (kind === "image" ? "image/jpeg" : kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mp4" : "application/octet-stream");
}

function resolveZipPath(fromFile: string, src: string, paths: string[]): string | null {
  if (!src || src.startsWith("data:") || /^https?:/i.test(src)) return null;
  const clean = decodeURIComponent(src.split("#")[0]?.split("?")[0] ?? src);
  const base = fromFile.split("/").slice(0, -1);
  const parts = [...base];
  for (const bit of clean.split("/")) {
    if (!bit || bit === ".") continue;
    if (bit === "..") parts.pop();
    else parts.push(bit);
  }
  const joined = parts.join("/").toLowerCase();
  const leaf = clean.split("/").pop()?.toLowerCase();
  return (
    paths.find((path) => path.toLowerCase() === joined) ??
    paths.find((path) => leaf && path.toLowerCase().endsWith(`/${leaf}`)) ??
    paths.find((path) => leaf && path.toLowerCase() === leaf) ??
    null
  );
}

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  const lowered = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    if (lowered.has(key.toLowerCase())) return lowered.get(key.toLowerCase());
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

interface MediaRef {
  src: string;
  hint: string;
}

function collectMedia(html: string): MediaRef[] {
  const refs: MediaRef[] = [];
  const tag = /<(img|video|audio|source)\b([^>]*?)>/gi;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    const hint = `${match[1]} ${match[2]}`;
    const src = /(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(match[2])?.[1];
    if (src) refs.push({ src, hint });
  }
  return refs;
}

function blockText(html: string, className: string): string {
  const pattern = new RegExp(`<div\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "i");
  return inner(html, pattern);
}

export interface ParsedAppleHtml {
  title: string;
  text: string;
  html: string;
  date: { iso: string; precision: "minute" | "day" } | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  stateOfMind: string | null;
  media: MediaRef[];
}

export function parseAppleHtml(html: string, filePath: string): ParsedAppleHtml {
  const title =
    inner(html, /<div\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\bs2\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
    inner(html, /<div\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    inner(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    inner(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const header = inner(html, /<div\b[^>]*class=["'][^"']*\bpageHeader\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const filenameTitle = (filePath.split("/").pop() ?? "")
    .replace(/\.html?$/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}[_ -]?/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const withoutAssets = html.replace(/<div\b[^>]*class=["'][^"']*\bassetGrid\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*(?=<div|<\/div>|$)/i, " ");
  const paragraphs = [...withoutAssets.matchAll(/<(p|div)\b[^>]*class=["'][^"']*\bbodyText\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi)].map(
    (match) => decodeEntities(match[2].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim(),
  );
  const looseParagraphs =
    paragraphs.length > 0
      ? paragraphs
      : [...withoutAssets.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
          .map((match) => decodeEntities(match[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim())
          .filter((line) => line && line !== header && line !== title);
  const text = looseParagraphs.filter(Boolean).join("\n\n").trim();
  const locationBlock = blockText(html, "assetType_location") || blockText(html, "placeName");
  const placeName =
    inner(html, /<div\b[^>]*class=["'][^"']*\bplaceName\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    locationBlock;
  const latRaw = /data-lat(?:itude)?=["'](-?\d+(?:\.\d+)?)["']/i.exec(html)?.[1];
  const lngRaw = /data-(?:lng|lon|longitude)=["'](-?\d+(?:\.\d+)?)["']/i.exec(html)?.[1];
  const state = blockText(html, "assetType_stateOfMind") || inner(html, /<div\b[^>]*class=["'][^"']*\bstateLabel\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  return {
    title: title || filenameTitle,
    text,
    html: looseParagraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
    date: parseLooseDate(header) ?? (dateFromFilename(filePath) ? { iso: dateFromFilename(filePath)!, precision: "day" } : null),
    locationName: placeName || null,
    latitude: latRaw ? Number(latRaw) : null,
    longitude: lngRaw ? Number(lngRaw) : null,
    stateOfMind: state || null,
    media: collectMedia(html),
  };
}

function moodFrom(label: string | null): Mood | null {
  if (!label) return null;
  const key = label.trim().toLowerCase();
  if (MOOD_WORDS[key]) return MOOD_WORDS[key];
  for (const [word, mood] of Object.entries(MOOD_WORDS)) {
    if (key.includes(word)) return mood;
  }
  return null;
}

function countsOf(attachments: AttachmentRecord[]): AppleImportItem["counts"] {
  return {
    image: attachments.filter((item) => item.kind === "image" && !item.deletedAt).length,
    video: attachments.filter((item) => item.kind === "video" && !item.deletedAt).length,
    audio: attachments.filter((item) => item.kind === "audio" && !item.deletedAt).length,
    file: attachments.filter((item) => item.kind === "file" && !item.deletedAt).length,
  };
}

export async function parseAppleZip(
  bytes: Uint8Array,
  options: { deviceId: string; existingIds: Set<string>; now?: string; simulated?: boolean },
): Promise<AppleImportPreview> {
  const zip = await JSZip.loadAsync(bytes);
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path]?.dir);
  const fileMap = new Map<string, Uint8Array>();
  for (const path of paths) {
    const entry = zip.files[path];
    if (!entry) continue;
    fileMap.set(path, await entry.async("uint8array"));
  }
  const metadataPath = paths.find((path) => path.toLowerCase().endsWith("quire-metadata.json"));
  if (metadataPath) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(fileMap.get(metadataPath) ?? new Uint8Array())) as {
        app?: string;
        entries?: JournalEntry[];
        attachments?: (Omit<AttachmentRecord, "bytes"> & { path?: string })[];
      };
      if (parsed.app === "quire" && Array.isArray(parsed.entries)) {
        const items = await itemsFromQuireMetadata(parsed, fileMap, options);
        if (items.length > 0) {
          return { items, filesScanned: paths.length, simulated: options.simulated === true };
        }
      }
    } catch {
      /* Fall through to the HTML export structure. */
    }
  }
  const htmlPaths = paths.filter((path) => {
    const lower = path.toLowerCase();
    if (!lower.endsWith(".html") && !lower.endsWith(".htm")) return false;
    if (lower.endsWith("/index.html") || lower === "index.html") return false;
    return lower.includes("/entries/") || lower.startsWith("entries/");
  });
  const now = options.now ?? new Date().toISOString();
  const items: AppleImportItem[] = [];
  for (const path of htmlPaths) {
    const html = new TextDecoder().decode(fileMap.get(path) ?? new Uint8Array());
    try {
      const parsed = parseAppleHtml(html, path);
      if (!parsed.title && !parsed.text && !parsed.date && parsed.media.length === 0) {
        items.push(errorItem(path, "Could not find a date, title, or body in this entry."));
        continue;
      }
      const appleSourceId = `apple:${(await sha256Hex(path.toLowerCase())).slice(0, 24)}`;
      const resources = resourceSidecars(parsed.media, path, paths, fileMap);
      const dated = resources.creationDate ? parseLooseDate(resources.creationDate) : null;
      const when = dated ?? parsed.date;
      if (!when) {
        items.push(errorItem(path, "No date was found in the entry or its file name."));
        continue;
      }
      const attachments: AttachmentRecord[] = [];
      for (const media of parsed.media) {
        const resolved = resolveZipPath(path, media.src, paths);
        if (!resolved) continue;
        const bytesForFile = fileMap.get(resolved);
        if (!bytesForFile) continue;
        const kind = kindFor(resolved, media.hint);
        const id = randomId();
        attachments.push({
          id,
          entryId: "",
          kind,
          mimeType: mimeFor(resolved, kind),
          name: resolved.split("/").pop() ?? "attachment",
          size: bytesForFile.byteLength,
          createdAt: when.iso,
          width: null,
          height: null,
          durationMs: null,
          revision: 1,
          syncedRevision: 0,
          deletedAt: null,
          appleResourceId: resolved,
          needsDownload: false,
          bytes: bytesForFile,
        });
      }
      const locationName = parsed.locationName || resources.placeName;
      const latitude = parsed.latitude ?? resources.latitude;
      const longitude = parsed.longitude ?? resources.longitude;
      const entryId = randomId();
      attachments.forEach((attachment) => {
        attachment.entryId = entryId;
      });
      const entry: JournalEntry = {
        id: entryId,
        schemaVersion: 1,
        title: parsed.title,
        content: parsed.html || (parsed.text ? `<p>${escapeHtml(parsed.text)}</p>` : ""),
        createdAt: when.iso,
        updatedAt: now,
        entryDate: when.iso,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        mood: moodFrom(parsed.stateOfMind),
        tags: [],
        location:
          locationName || latitude !== null || longitude !== null
            ? { name: locationName ?? "", latitude, longitude }
            : null,
        attachmentIds: attachments.map((attachment) => attachment.id),
        isFavorite: false,
        deletedAt: null,
        deviceId: options.deviceId,
        revision: 1,
        syncedRevision: 0,
        appleSourceId,
        metadata: {
          source: "apple-journal",
          sourcePath: path,
          timePrecision: when.precision,
          stateOfMind: parsed.stateOfMind,
          compatibility: "html-export",
          testedWithRealAppleExport: false,
        },
      };
      const duplicate = options.existingIds.has(appleSourceId);
      items.push({
        appleSourceId,
        title: entry.title || "(untitled)",
        entryDate: entry.entryDate,
        excerpt: snippet(entry.content, 160),
        counts: countsOf(attachments),
        locationName: entry.location?.name || null,
        status: duplicate ? "duplicate" : "new",
        entry: duplicate ? undefined : entry,
        attachments: duplicate ? undefined : attachments,
      });
    } catch (error) {
      items.push(errorItem(path, error instanceof Error ? error.message : "Parse failed"));
    }
  }
  if (htmlPaths.length === 0) {
    items.push(errorItem("(archive)", "No Entries/*.html files were found. This does not look like an Apple Journal export."));
  }
  return { items, filesScanned: paths.length, simulated: options.simulated === true };
}

function errorItem(path: string, message: string): AppleImportItem {
  return {
    appleSourceId: `error:${path}`,
    title: path.split("/").pop() ?? path,
    entryDate: "",
    excerpt: "",
    counts: { image: 0, video: 0, audio: 0, file: 0 },
    locationName: null,
    status: "error",
    message,
  };
}

function resourceSidecars(
  media: MediaRef[],
  htmlPath: string,
  paths: string[],
  fileMap: Map<string, Uint8Array>,
): { latitude: number | null; longitude: number | null; placeName: string | null; creationDate: string | null } {
  const result = { latitude: null as number | null, longitude: null as number | null, placeName: null as string | null, creationDate: null as string | null };
  const candidates = new Set<string>();
  for (const item of media) {
    const resolved = resolveZipPath(htmlPath, item.src, paths);
    if (!resolved) continue;
    const leaf = `${(resolved.split("/").pop() ?? "").replace(/\.[^.]+$/, "")}.json`.toLowerCase();
    const found = paths.find((path) => path.toLowerCase() === resolved.replace(/\.[^.]+$/, ".json").toLowerCase())
      ?? paths.find((path) => path.toLowerCase().endsWith(`/${leaf}`));
    if (found) candidates.add(found);
  }
  for (const path of candidates) {
    const bytes = fileMap.get(path);
    if (!bytes) continue;
    try {
      const json = asRecord(JSON.parse(new TextDecoder().decode(bytes)));
      if (!json) continue;
      const lat = pick(json, ["latitude", "lat"]);
      const lng = pick(json, ["longitude", "lng", "lon"]);
      const place = pick(json, ["placeName", "name", "address", "locality"]);
      const created = pick(json, ["creationDate", "date", "timestamp"]);
      if (typeof lat === "number") result.latitude = lat;
      if (typeof lng === "number") result.longitude = lng;
      if (typeof place === "string" && place.trim()) result.placeName = place.trim();
      if (typeof created === "string") result.creationDate = created;
    } catch {
      /* Ignore sidecar files that are not JSON. */
    }
  }
  return result;
}

async function itemsFromQuireMetadata(
  parsed: {
    entries?: JournalEntry[];
    attachments?: (Omit<AttachmentRecord, "bytes"> & { path?: string })[];
  },
  fileMap: Map<string, Uint8Array>,
  options: { deviceId: string; existingIds: Set<string> },
): Promise<AppleImportItem[]> {
  const attachments = parsed.attachments ?? [];
  const items: AppleImportItem[] = [];
  for (const source of parsed.entries ?? []) {
    const appleSourceId = source.appleSourceId || `apple:${(await sha256Hex(source.id)).slice(0, 24)}`;
    if (options.existingIds.has(appleSourceId)) {
      items.push({
        appleSourceId,
        title: source.title || "(untitled)",
        entryDate: source.entryDate,
        excerpt: snippet(source.content, 160),
        counts: { image: 0, video: 0, audio: 0, file: 0 },
        locationName: source.location?.name ?? null,
        status: "duplicate",
      });
      continue;
    }
    const entryId = randomId();
    const copied: AttachmentRecord[] = [];
    for (const meta of attachments.filter((item) => source.attachmentIds.includes(item.id))) {
      const path = meta.path;
      const bytes = path ? fileMap.get(path) ?? findBySuffix(fileMap, path) : new Uint8Array();
      const id = randomId();
      copied.push({ ...meta, id, entryId, bytes: bytes ?? new Uint8Array(), revision: 1, syncedRevision: 0, needsDownload: false });
    }
    const entry: JournalEntry = {
      ...source,
      id: entryId,
      deviceId: options.deviceId,
      revision: 1,
      syncedRevision: 0,
      deletedAt: null,
      appleSourceId,
      attachmentIds: copied.map((item) => item.id),
      metadata: { ...source.metadata, source: "apple-journal", compatibility: "quire-roundtrip", testedWithRealAppleExport: false },
    };
    items.push({
      appleSourceId,
      title: entry.title || "(untitled)",
      entryDate: entry.entryDate,
      excerpt: snippet(entry.content, 160),
      counts: countsOf(copied),
      locationName: entry.location?.name ?? null,
      status: "new",
      entry,
      attachments: copied,
    });
  }
  return items;
}

function findBySuffix(fileMap: Map<string, Uint8Array>, path: string): Uint8Array | null {
  const leaf = path.split("/").pop()?.toLowerCase();
  if (!leaf) return null;
  for (const [key, value] of fileMap) {
    if (key.toLowerCase().endsWith(`/${leaf}`) || key.toLowerCase() === leaf) return value;
  }
  return null;
}

export function plainTextFromHtml(html: string): string {
  return stripHtml(html);
}
