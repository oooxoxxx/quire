import JSZip from "jszip";
import type { AttachmentRecord, JournalEntry } from "../types.ts";
import { escapeHtml, stripHtml } from "../text.ts";

const COMPATIBILITY = `Quire Apple Journal export — compatibility note
================================================

This ZIP imitates the community-observed layout of an Apple Journal export:

  Entries/*.html
  Resources/<file>

It keeps dates, text, photos, video, audio, location and Quire metadata.
It was produced by Quire, not by Apple.

Apple does not publish a third-party import API. A ZIP made here is NOT
guaranteed to import back into Apple Journal. Quire can import this file,
and can also import an HTML export that came from Apple Journal itself.

本檔案只是依公開觀察到的 Apple Journal 匯出結構整理，不是 Apple 產生的檔案。
Apple 沒有提供第三方匯入 API，不能保證這份 ZIP 可以重新匯入 Apple Journal。
Quire 可以匯入這份檔案，也可以匯入從 Apple Journal 匯出的 HTML ZIP。
此解析器尚未以你的真實 Apple 匯出檔完成官方驗證。
`;

function appleDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function fileSlug(entry: JournalEntry, index: number): string {
  const day = new Date(entry.entryDate);
  const y = Number.isNaN(day.getTime()) ? "undated" : day.toISOString().slice(0, 10);
  const title = (entry.title || `entry-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${y}_${title || "entry"}`;
}

function resourceName(attachment: AttachmentRecord): string {
  const ext = attachment.name.includes(".") ? attachment.name.split(".").pop() : extensionFor(attachment);
  const safe = attachment.id.replace(/[^a-z0-9-]/gi, "");
  return `${safe}.${ext || "bin"}`;
}

function extensionFor(attachment: AttachmentRecord): string {
  if (attachment.mimeType.includes("png")) return "png";
  if (attachment.mimeType.includes("gif")) return "gif";
  if (attachment.mimeType.includes("webp")) return "webp";
  if (attachment.mimeType.includes("jpeg")) return "jpg";
  if (attachment.mimeType.includes("quicktime")) return "mov";
  if (attachment.mimeType.includes("mp4") && attachment.kind === "audio") return "m4a";
  if (attachment.mimeType.includes("mpeg")) return "mp3";
  if (attachment.mimeType.includes("webm") && attachment.kind === "audio") return "webm";
  if (attachment.kind === "video") return "mp4";
  if (attachment.kind === "audio") return "m4a";
  if (attachment.kind === "image") return "jpg";
  return "bin";
}

function entryHtml(entry: JournalEntry, attachments: AttachmentRecord[]): string {
  const media = attachments
    .filter((item) => !item.deletedAt)
    .map((item) => {
      const src = `../Resources/${resourceName(item)}`;
      if (item.kind === "video") {
        return `<div class="gridItem assetType_video"><video class="asset_video" src="${escapeHtml(src)}"></video></div>`;
      }
      if (item.kind === "audio") {
        return `<div class="gridItem assetType_audio"><audio class="asset_audio" src="${escapeHtml(src)}"></audio></div>`;
      }
      if (item.kind === "image") {
        return `<div class="gridItem assetType_photo"><img class="asset_image" src="${escapeHtml(src)}" alt="" /></div>`;
      }
      return `<div class="gridItem assetType_file"><a href="${escapeHtml(src)}">${escapeHtml(item.name)}</a></div>`;
    })
    .join("\n");
  const location = entry.location
    ? `<div class="gridItem assetType_location"><div class="placeName">${escapeHtml(entry.location.name)}</div><div class="coordinates" data-lat="${entry.location.latitude ?? ""}" data-lng="${entry.location.longitude ?? ""}"></div></div>`
    : "";
  const mood = entry.mood
    ? `<div class="gridItem assetType_stateOfMind"><div class="stateLabel">${escapeHtml(entry.mood)}</div></div>`
    : "";
  const paragraphs = stripHtml(entry.content)
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((line) => `<p class="bodyText">${escapeHtml(line)}</p>`)
    .join("\n");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(entry.title || "Entry")}</title></head>
<body>
<div class="pageContainer">
  <div class="pageHeader">${escapeHtml(appleDate(entry.entryDate))}</div>
  <div class="title"><span class="s2">${escapeHtml(entry.title || "")}</span></div>
  <div class="bodyText">
    ${paragraphs}
  </div>
  <div class="assetGrid">
    ${media}
    ${location}
    ${mood}
  </div>
</div>
</body>
</html>`;
}

export async function buildAppleZip(
  entries: JournalEntry[],
  attachments: AttachmentRecord[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  const live = entries.filter((entry) => !entry.deletedAt);
  const metaAttachments: (Omit<AttachmentRecord, "bytes"> & { path: string })[] = [];
  live.forEach((entry, index) => {
    const related = attachments.filter((item) => entry.attachmentIds.includes(item.id) && !item.deletedAt);
    const slug = fileSlug(entry, index);
    zip.file(`AppleJournalEntries/Entries/${slug}.html`, entryHtml(entry, related));
    for (const attachment of related) {
      const name = resourceName(attachment);
      const path = `AppleJournalEntries/Resources/${name}`;
      zip.file(path, attachment.bytes);
      const sidecar = {
        type: attachment.kind,
        identifier: attachment.id,
        filename: attachment.name,
        mimeType: attachment.mimeType,
        creationDate: entry.entryDate,
        latitude: entry.location?.latitude ?? null,
        longitude: entry.location?.longitude ?? null,
        placeName: entry.location?.name ?? null,
      };
      zip.file(`AppleJournalEntries/Resources/${attachment.id}.json`, JSON.stringify(sidecar, null, 2));
      const { bytes: _bytes, ...meta } = attachment;
      metaAttachments.push({ ...meta, path });
    }
  });
  zip.file("AppleJournalEntries/COMPATIBILITY.txt", COMPATIBILITY);
  zip.file(
    "AppleJournalEntries/quire-metadata.json",
    JSON.stringify(
      {
        app: "quire",
        schemaVersion: 1,
        compatibility: "best-effort-apple-journal-html",
        guaranteedAppleReimport: false,
        entries: live,
        attachments: metaAttachments,
      },
      null,
      2,
    ),
  );
  return zip.generateAsync({ type: "uint8array" });
}

export async function buildSampleAppleZip(): Promise<Uint8Array> {
  const png = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
      .split("")
      .map((char) => char.charCodeAt(0)),
  );
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Morning light</title></head>
<body>
<div class="pageContainer">
  <div class="pageHeader">Tuesday, January 14, 2025</div>
  <div class="title"><span class="s2">Morning light</span></div>
  <div class="bodyText"><p class="bodyText">Walked out before the city woke.</p><p class="bodyText">The river was the color of tin.</p></div>
  <div class="assetGrid">
    <div class="gridItem assetType_photo"><img class="asset_image" src="../Resources/photo-1.jpg" alt="" /></div>
    <div class="gridItem assetType_video"><video class="asset_video" src="../Resources/clip-1.mov"></video></div>
    <div class="gridItem assetType_audio"><audio class="asset_audio" src="../Resources/voice-1.m4a"></audio></div>
    <div class="gridItem assetType_location"><div class="placeName">Da'an Park</div><div class="coordinates" data-lat="25.026" data-lng="121.543"></div></div>
    <div class="gridItem assetType_stateOfMind"><div class="stateLabel">Grateful</div></div>
  </div>
</div>
</body></html>`;
  const zip = new JSZip();
  zip.file("AppleJournalEntries/Entries/2025-01-14_Morning-light.html", html);
  zip.file("AppleJournalEntries/Resources/photo-1.jpg", png);
  zip.file("AppleJournalEntries/Resources/clip-1.mov", new Uint8Array([0, 1, 2, 3, 4]));
  zip.file("AppleJournalEntries/Resources/voice-1.m4a", new Uint8Array([5, 6, 7]));
  zip.file(
    "AppleJournalEntries/Resources/photo-1.json",
    JSON.stringify({
      type: "photo",
      identifier: "photo-1",
      latitude: 25.026,
      longitude: 121.543,
      placeName: "Da'an Park",
      creationDate: "2025-01-14T07:30:00+08:00",
    }),
  );
  zip.file(
    "AppleJournalEntries/COMPATIBILITY.txt",
    "Simulated Apple Journal export structure for Quire development. Not an export from Apple.",
  );
  return zip.generateAsync({ type: "uint8array" });
}
