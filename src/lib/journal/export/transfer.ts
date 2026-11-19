import JSZip from "jszip";
import {
  b64ToBytes,
  bytesToB64,
  checkVerifier,
  decryptJson,
  deriveAesKey,
  encryptJson,
} from "../crypto.ts";
import type { AttachmentRecord, EncryptionHeader, JournalEntry } from "../types.ts";
import { escapeHtml, htmlToMarkdown, sanitizeHtml, stripHtml } from "../text.ts";

export interface JsonBackup {
  app: "quire";
  schemaVersion: 1;
  exportedAt: string;
  entries: JournalEntry[];
  attachments: (Omit<AttachmentRecord, "bytes"> & { dataBase64: string })[];
}

export interface EncryptedPackage {
  app: "quire";
  schemaVersion: 1;
  encrypted: true;
  encryption: EncryptionHeader;
  sealed: { iv: string; data: string };
}

function metaLine(attachment: AttachmentRecord, dataBase64: string) {
  const { bytes: _bytes, ...meta } = attachment;
  return { ...meta, dataBase64 };
}

export function buildJsonBackup(entries: JournalEntry[], attachments: AttachmentRecord[], now = new Date().toISOString()): JsonBackup {
  return {
    app: "quire",
    schemaVersion: 1,
    exportedAt: now,
    entries,
    attachments: attachments.map((attachment) => metaLine(attachment, bytesToB64(attachment.bytes))),
  };
}

export async function encryptBackup(backup: JsonBackup, key: CryptoKey, header: EncryptionHeader): Promise<EncryptedPackage> {
  return {
    app: "quire",
    schemaVersion: 1,
    encrypted: true,
    encryption: header,
    sealed: await encryptJson(key, backup),
  };
}

export async function decryptBackup(pack: EncryptedPackage, passphrase: string): Promise<JsonBackup> {
  const key = await deriveAesKey(passphrase, b64ToBytes(pack.encryption.salt), pack.encryption.iterations);
  const ok = await checkVerifier(key, pack.encryption.verifier);
  if (!ok) throw new Error("BAD_PASSPHRASE");
  return decryptJson<JsonBackup>(key, pack.sealed);
}

export function jsonBackupToRecords(backup: JsonBackup): { entries: JournalEntry[]; attachments: AttachmentRecord[] } {
  return {
    entries: backup.entries,
    attachments: backup.attachments.map((attachment) => {
      const { dataBase64, ...meta } = attachment;
      const bytes = b64ToBytes(dataBase64 || "");
      return { ...meta, bytes, size: bytes.byteLength || meta.size };
    }),
  };
}

export function isEncryptedPackage(value: unknown): value is EncryptedPackage {
  return !!value && typeof value === "object" && (value as EncryptedPackage).encrypted === true && (value as EncryptedPackage).app === "quire";
}

export function isJsonBackup(value: unknown): value is JsonBackup {
  return !!value && typeof value === "object" && (value as JsonBackup).app === "quire" && Array.isArray((value as JsonBackup).entries);
}

export function buildMarkdown(entries: JournalEntry[], attachments: AttachmentRecord[]): string {
  return entries
    .filter((entry) => !entry.deletedAt)
    .map((entry) => {
      const related = attachments.filter((item) => entry.attachmentIds.includes(item.id));
      const images = related
        .map((item) => `- ${item.kind}: ${item.name}`)
        .join("\n");
      return `---
title: ${JSON.stringify(entry.title)}
date: ${entry.entryDate}
timezone: ${entry.timezone}
mood: ${entry.mood ?? ""}
tags: ${JSON.stringify(entry.tags)}
location: ${JSON.stringify(entry.location)}
favorite: ${entry.isFavorite}
---

${htmlToMarkdown(entry.content)}

${images}
`;
    })
    .join("\n\n");
}

export async function buildMarkdownZip(entries: JournalEntry[], attachments: AttachmentRecord[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const live = entries.filter((entry) => !entry.deletedAt);
  live.forEach((entry, index) => {
    const related = attachments.filter((item) => entry.attachmentIds.includes(item.id) && !item.deletedAt);
    const name = `${String(index + 1).padStart(3, "0")}-${(entry.title || "entry").slice(0, 40).replace(/[^\w\u3400-\u9fff-]+/g, "-")}.md`;
    const links = related
      .map((item) => {
        const path = `media/${item.id}-${item.name.replace(/[^\w.\u3400-\u9fff-]+/g, "_")}`;
        zip.file(path, item.bytes);
        return item.kind === "image" ? `![${item.name}](${path})` : `[${item.kind}: ${item.name}](${path})`;
      })
      .join("\n\n");
    zip.file(
      name,
      `---
title: ${JSON.stringify(entry.title)}
date: ${entry.entryDate}
mood: ${entry.mood ?? ""}
tags: ${JSON.stringify(entry.tags)}
favorite: ${entry.isFavorite}
---

${htmlToMarkdown(entry.content)}

${links}
`,
    );
  });
  zip.file("journal.md", buildMarkdown(live, attachments));
  return zip.generateAsync({ type: "uint8array" });
}

export function buildHtmlDocument(entries: JournalEntry[], attachments: AttachmentRecord[]): string {
  const cards = entries
    .filter((entry) => !entry.deletedAt)
    .map((entry) => {
      const media = attachments
        .filter((item) => entry.attachmentIds.includes(item.id) && !item.deletedAt)
        .map((item) => {
          const src = `data:${item.mimeType};base64,${bytesToB64(item.bytes)}`;
          if (item.kind === "image") return `<figure><img src="${src}" alt="${escapeHtml(item.name)}" /></figure>`;
          if (item.kind === "video") return `<video controls src="${src}"></video>`;
          if (item.kind === "audio") return `<audio controls src="${src}"></audio>`;
          return `<p>${escapeHtml(item.name)}</p>`;
        })
        .join("\n");
      return `<article>
        <p class="date">${escapeHtml(entry.entryDate)}</p>
        <h2>${escapeHtml(entry.title || "Untitled")}</h2>
        ${entry.mood ? `<p class="mood">${escapeHtml(entry.mood)}</p>` : ""}
        ${entry.location ? `<p class="where">${escapeHtml(entry.location.name)}</p>` : ""}
        <div class="body">${sanitizeHtml(entry.content)}</div>
        ${media}
      </article>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<title>Quire</title>
<style>
  body { margin: 0; background: #f3efe6; color: #1c1915; font-family: Georgia, "Songti TC", serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  article { background: #fffdf8; border-radius: 1.25rem; padding: 1.25rem; margin: 0 0 1rem; }
  h2 { font-weight: 500; margin: 0.2rem 0 0.8rem; }
  .date, .mood, .where { color: #6f675c; font-family: "Segoe UI", sans-serif; font-size: 0.9rem; }
  img, video { width: 100%; border-radius: 0.8rem; }
  @media print { body { background: white; } article { break-inside: avoid; box-shadow: none; } }
</style>
</head>
<body><main><h1>Quire</h1>${cards}</main></body></html>`;
}

export async function buildBackupZip(
  entries: JournalEntry[],
  attachments: AttachmentRecord[],
  sealed?: EncryptedPackage,
): Promise<Uint8Array> {
  const zip = new JSZip();
  if (sealed) {
    zip.file("quire-backup.json", JSON.stringify(sealed, null, 2));
    zip.file(
      "README.txt",
      "This Quire backup is encrypted with AES-256-GCM. Restore it in Quire with the backup passphrase. The passphrase is not stored in this file.\n",
    );
  } else {
    const backup = buildJsonBackup(entries, attachments);
    backup.attachments = backup.attachments.map((attachment) => ({ ...attachment, dataBase64: "" }));
    zip.file("quire-backup.json", JSON.stringify(backup, null, 2));
    for (const attachment of attachments) zip.file(`attachments/${attachment.id}`, attachment.bytes);
  }
  return zip.generateAsync({ type: "uint8array" });
}

export async function readZipKind(bytes: Uint8Array): Promise<"quire" | "apple" | "unknown"> {
  const zip = await JSZip.loadAsync(bytes);
  const paths = Object.keys(zip.files).map((path) => path.toLowerCase());
  if (paths.some((path) => path.endsWith("quire-backup.json"))) return "quire";
  if (paths.some((path) => path.includes("/entries/") && (path.endsWith(".html") || path.endsWith(".htm")))) return "apple";
  return "unknown";
}

export async function readQuireZip(bytes: Uint8Array): Promise<JsonBackup | EncryptedPackage> {
  const zip = await JSZip.loadAsync(bytes);
  const path = Object.keys(zip.files).find((item) => item.toLowerCase().endsWith("quire-backup.json"));
  if (!path || !zip.files[path]) throw new Error("NOT_QUIRE_BACKUP");
  const parsed = JSON.parse(await zip.files[path].async("string")) as unknown;
  if (isEncryptedPackage(parsed)) return parsed;
  if (!isJsonBackup(parsed)) throw new Error("NOT_QUIRE_BACKUP");
  for (const attachment of parsed.attachments) {
    if (attachment.dataBase64) continue;
    const file = zip.file(`attachments/${attachment.id}`);
    if (!file) continue;
    attachment.dataBase64 = bytesToB64(await file.async("uint8array"));
  }
  return parsed;
}

export function safeExcerpt(html: string): string {
  return stripHtml(html).slice(0, 180);
}
