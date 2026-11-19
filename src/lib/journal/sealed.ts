import { decryptBytes, decryptJson, encryptBytes, encryptJson, toArrayBuffer } from "./crypto.ts";
import type {
  AttachmentMeta,
  AttachmentRecord,
  EntryBody,
  JournalEntry,
  StoredAttachment,
  StoredEntry,
} from "./types.ts";

function bodyOf(entry: JournalEntry): EntryBody {
  return {
    title: entry.title,
    content: entry.content,
    timezone: entry.timezone,
    mood: entry.mood,
    tags: entry.tags,
    location: entry.location,
    attachmentIds: entry.attachmentIds,
    isFavorite: entry.isFavorite,
    metadata: entry.metadata,
  };
}

function assemble(stored: StoredEntry, body: EntryBody): JournalEntry {
  return {
    ...body,
    id: stored.id,
    schemaVersion: 1,
    entryDate: stored.entryDate,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    deletedAt: stored.deletedAt,
    revision: stored.revision,
    syncedRevision: stored.syncedRevision,
    deviceId: stored.deviceId,
    appleSourceId: stored.appleSourceId,
  };
}

export async function sealEntry(entry: JournalEntry, key: CryptoKey | null): Promise<StoredEntry> {
  const shell: StoredEntry = {
    id: entry.id,
    schemaVersion: 1,
    entryDate: entry.entryDate,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    deletedAt: entry.deletedAt,
    revision: entry.revision,
    syncedRevision: entry.syncedRevision,
    deviceId: entry.deviceId,
    appleSourceId: entry.appleSourceId,
    sealed: null,
    body: null,
  };
  if (!key) {
    shell.body = bodyOf(entry);
    return shell;
  }
  shell.sealed = await encryptJson(key, bodyOf(entry));
  return shell;
}

export async function openEntry(stored: StoredEntry, key: CryptoKey | null): Promise<JournalEntry> {
  if (stored.sealed) {
    if (!key) throw new Error("LOCKED");
    const body = await decryptJson<EntryBody>(key, stored.sealed);
    return assemble(stored, body);
  }
  if (!stored.body) throw new Error("CORRUPT_ENTRY");
  return assemble(stored, stored.body);
}

function metaOf(record: AttachmentRecord): AttachmentMeta {
  const { bytes: _bytes, ...meta } = record;
  return meta;
}

export async function sealAttachment(
  record: AttachmentRecord,
  key: CryptoKey | null,
): Promise<StoredAttachment> {
  const base: StoredAttachment = {
    id: record.id,
    entryId: record.entryId,
    revision: record.revision,
    syncedRevision: record.syncedRevision,
    deletedAt: record.deletedAt,
    size: record.size,
    needsDownload: record.needsDownload,
    sealedMeta: null,
    sealedBlob: null,
    meta: null,
    blob: null,
  };
  const meta = {
    kind: record.kind,
    mimeType: record.mimeType,
    name: record.name,
    createdAt: record.createdAt,
    width: record.width,
    height: record.height,
    durationMs: record.durationMs,
    appleResourceId: record.appleResourceId,
  };
  if (!key) {
    base.meta = meta;
    base.blob = record.bytes.byteLength > 0 ? toArrayBuffer(record.bytes) : null;
    return base;
  }
  base.sealedMeta = await encryptJson(key, meta);
  if (record.bytes.byteLength > 0) {
    const sealed = await encryptBytes(key, record.bytes);
    base.sealedBlob = { iv: sealed.iv, byteLength: sealed.bytes.byteLength, data: toArrayBuffer(sealed.bytes) };
  }
  return base;
}

export async function openAttachment(
  stored: StoredAttachment,
  key: CryptoKey | null,
  includeBytes = true,
): Promise<AttachmentRecord> {
  let meta = stored.meta;
  if (stored.sealedMeta) {
    if (!key) throw new Error("LOCKED");
    meta = await decryptJson<NonNullable<StoredAttachment["meta"]>>(key, stored.sealedMeta);
  }
  if (!meta) throw new Error("CORRUPT_ATTACHMENT");
  let bytes = new Uint8Array();
  if (includeBytes && !stored.needsDownload) {
    if (stored.sealedBlob) {
      if (!key) throw new Error("LOCKED");
      const decoded = await decryptBytes(key, stored.sealedBlob.iv, new Uint8Array(stored.sealedBlob.data));
      bytes = new Uint8Array(decoded);
    } else if (stored.blob) {
      bytes = new Uint8Array(stored.blob);
    }
  }
  return {
    id: stored.id,
    entryId: stored.entryId,
    revision: stored.revision,
    syncedRevision: stored.syncedRevision,
    deletedAt: stored.deletedAt,
    size: stored.size,
    needsDownload: stored.needsDownload,
    bytes,
    ...meta,
  };
}

export function attachmentMeta(record: AttachmentRecord): AttachmentMeta {
  return metaOf(record);
}
