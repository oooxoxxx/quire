import {
  bytesToB64,
  b64ToBytes,
  checkVerifier,
  decryptJson,
  encryptJson,
  encryptBytes,
  decryptBytes,
} from "../crypto.ts";
import type { AttachmentMeta, AttachmentRecord, EncryptionHeader, JournalEntry, SyncConflict } from "../types.ts";
import { SyncError } from "./errors.ts";
import { planSync, type RemotePointer } from "./plan.ts";

export interface CloudBody {
  schemaVersion: 1;
  updatedAt: string;
  entries: (RemotePointer & { updatedAt: string; deletedAt: string | null })[];
  blobs: (RemotePointer & { size: number; deletedAt: string | null })[];
}

export interface CloudFile {
  app: "quire";
  schemaVersion: 1;
  encryption: EncryptionHeader | null;
  body?: CloudBody;
  sealed?: { iv: string; data: string };
}

export interface EntryDocument {
  entry: JournalEntry;
  attachments: AttachmentMeta[];
}

export interface SyncDriver {
  readManifest(): Promise<CloudFile | null>;
  writeManifest(file: CloudFile): Promise<void>;
  readObject(name: string): Promise<Uint8Array | null>;
  writeObject(name: string, data: Uint8Array): Promise<void>;
}

export interface SyncOutcome {
  entries: JournalEntry[];
  attachments: AttachmentRecord[];
  conflicts: SyncConflict[];
  pushedEntries: number;
  pulledEntries: number;
  pushedBlobs: number;
  pulledBlobs: number;
}

export function entryObjectName(id: string): string {
  return `quire-entry-${id}.json`;
}

export function blobObjectName(id: string): string {
  return `quire-blob-${id}.bin`;
}

export function emptyCloudBody(now: string): CloudBody {
  return { schemaVersion: 1, updatedAt: now, entries: [], blobs: [] };
}

export function memoryDriver(): SyncDriver & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async readManifest() {
      const bytes = files.get("manifest");
      if (!bytes) return null;
      return JSON.parse(new TextDecoder().decode(bytes)) as CloudFile;
    },
    async writeManifest(file) {
      files.set("manifest", new TextEncoder().encode(JSON.stringify(file)));
    },
    async readObject(name) {
      return files.get(name) ?? null;
    },
    async writeObject(name, data) {
      files.set(name, data.slice());
    },
  };
}

async function encodeJson(value: unknown, key: CryptoKey | null): Promise<Uint8Array> {
  if (!key) return new TextEncoder().encode(JSON.stringify(value));
  const sealed = await encryptJson(key, value);
  return new TextEncoder().encode(JSON.stringify({ app: "quire", schemaVersion: 1, sealed }));
}

async function decodeJson<T>(bytes: Uint8Array, key: CryptoKey | null): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SyncError("CORRUPT");
  }
  if (parsed && typeof parsed === "object" && "sealed" in parsed && (parsed as { app?: string }).app === "quire") {
    if (!key) throw new SyncError("PASSPHRASE_REQUIRED");
    return decryptJson<T>(key, (parsed as { sealed: { iv: string; data: string } }).sealed);
  }
  return parsed as T;
}

export async function encodeBlob(bytes: Uint8Array, key: CryptoKey | null): Promise<Uint8Array> {
  if (!key) {
    const out = new Uint8Array(bytes.length + 3);
    out[0] = 0x51;
    out[1] = 0x31;
    out[2] = 0;
    out.set(bytes, 3);
    return out;
  }
  const sealed = await encryptBytes(key, bytes);
  const iv = b64ToBytes(sealed.iv);
  const out = new Uint8Array(3 + iv.length + sealed.bytes.length);
  out[0] = 0x51;
  out[1] = 0x31;
  out[2] = 1;
  out.set(iv, 3);
  out.set(sealed.bytes, 15);
  return out;
}

export async function decodeBlob(bytes: Uint8Array, key: CryptoKey | null): Promise<Uint8Array> {
  if (bytes.length >= 3 && bytes[0] === 0x51 && bytes[1] === 0x31) {
    if (bytes[2] === 0) return bytes.slice(3);
    if (bytes[2] === 1) {
      if (!key) throw new SyncError("PASSPHRASE_REQUIRED");
      const iv = bytesToB64(bytes.slice(3, 15));
      return decryptBytes(key, iv, bytes.slice(15));
    }
  }
  return bytes;
}

async function encodeManifest(body: CloudBody, key: CryptoKey | null, header: EncryptionHeader | null): Promise<CloudFile> {
  if (key && header) {
    return { app: "quire", schemaVersion: 1, encryption: header, sealed: await encryptJson(key, body) };
  }
  return { app: "quire", schemaVersion: 1, encryption: null, body };
}

async function decodeManifest(file: CloudFile, key: CryptoKey | null): Promise<CloudBody> {
  if (file.encryption) {
    if (!key) throw new SyncError("PASSPHRASE_REQUIRED");
    const ok = await checkVerifier(key, file.encryption.verifier);
    if (!ok) throw new SyncError("BAD_PASSPHRASE");
    if (!file.sealed) throw new SyncError("CORRUPT");
    return decryptJson<CloudBody>(key, file.sealed);
  }
  if (!file.body) throw new SyncError("CORRUPT");
  return file.body;
}

function metaFrom(record: AttachmentRecord): AttachmentMeta {
  const { bytes: _bytes, ...meta } = record;
  return meta;
}

export async function runSync(options: {
  entries: JournalEntry[];
  attachments: AttachmentRecord[];
  driver: SyncDriver;
  key: CryptoKey | null;
  header: EncryptionHeader | null;
  now?: string;
  forceRewrite?: boolean;
}): Promise<SyncOutcome> {
  const now = options.now ?? new Date().toISOString();
  const remoteFile = await options.driver.readManifest().catch((error: unknown) => {
    if (error instanceof SyncError) throw error;
    throw new SyncError("NETWORK", error instanceof Error ? error.message : "NETWORK");
  });
  const remoteBody = remoteFile ? await decodeManifest(remoteFile, options.key) : emptyCloudBody(now);

  const entryMap = new Map(options.entries.map((entry) => [entry.id, { ...entry }]));
  const attMap = new Map(options.attachments.map((attachment) => [attachment.id, { ...attachment, bytes: attachment.bytes }]));
  const conflicts: SyncConflict[] = [];
  let pushedEntries = 0;
  let pulledEntries = 0;
  let pushedBlobs = 0;
  let pulledBlobs = 0;

  const entryActions = planSync(
    [...entryMap.values()],
    remoteBody.entries.map((entry) => ({ id: entry.id, revision: entry.revision })),
  );

  for (const action of entryActions) {
    if (action.type === "pull") {
      const raw = await options.driver.readObject(entryObjectName(action.id));
      if (!raw) continue;
      const doc = await decodeJson<EntryDocument>(raw, options.key);
      entryMap.set(doc.entry.id, { ...doc.entry, syncedRevision: doc.entry.revision });
      for (const meta of doc.attachments) {
        const existing = attMap.get(meta.id);
        const haveBytes = !!existing && !existing.needsDownload && existing.syncedRevision >= meta.revision && existing.bytes.byteLength > 0;
        attMap.set(meta.id, {
          ...(existing ?? { bytes: new Uint8Array() }),
          ...meta,
          bytes: haveBytes ? existing!.bytes : new Uint8Array(),
          needsDownload: !meta.deletedAt && meta.size > 0 && !haveBytes,
          syncedRevision: haveBytes ? meta.revision : 0,
          revision: meta.revision,
        });
      }
      pulledEntries += 1;
      continue;
    }
    if (action.type === "conflict") {
      const raw = await options.driver.readObject(entryObjectName(action.id));
      const local = entryMap.get(action.id);
      if (!raw || !local) continue;
      const doc = await decodeJson<EntryDocument>(raw, options.key);
      conflicts.push({
        id: `conflict-${action.id}-${doc.entry.revision}-${local.revision}`,
        entryId: action.id,
        local,
        remote: doc.entry,
        detectedAt: now,
      });
      continue;
    }
    const entry = entryMap.get(action.id);
    if (!entry) continue;
    if (!options.forceRewrite && action.type === "push" && entry.revision <= entry.syncedRevision && remoteBody.entries.some((item) => item.id === entry.id)) {
      continue;
    }
    const attachments = entry.attachmentIds
      .map((id) => attMap.get(id))
      .filter((item): item is AttachmentRecord => !!item)
      .map(metaFrom);
    const deleted = [...attMap.values()].filter((item) => item.entryId === entry.id && item.deletedAt);
    const doc: EntryDocument = { entry, attachments: [...attachments, ...deleted.map(metaFrom)] };
    await options.driver.writeObject(entryObjectName(entry.id), await encodeJson(doc, options.key));
    entry.syncedRevision = entry.revision;
    pushedEntries += 1;
  }

  if (options.forceRewrite) {
    for (const entry of entryMap.values()) {
      if (entry.syncedRevision === entry.revision && remoteBody.entries.some((item) => item.id === entry.id && item.revision === entry.revision)) {
        const attachments = [...attMap.values()].filter((item) => item.entryId === entry.id).map(metaFrom);
        const doc: EntryDocument = { entry, attachments };
        await options.driver.writeObject(entryObjectName(entry.id), await encodeJson(doc, options.key));
        pushedEntries += 1;
      }
    }
  }

  const blobActions = planSync(
    [...attMap.values()].filter((item) => !item.needsDownload),
    remoteBody.blobs.map((blob) => ({ id: blob.id, revision: blob.revision })),
  );

  for (const action of blobActions) {
    if (conflicts.some((conflict) => conflict.entryId === attMap.get(action.id)?.entryId && action.type !== "pull")) {
      continue;
    }
    if (action.type === "pull") {
      const attachment = attMap.get(action.id);
      const raw = await options.driver.readObject(blobObjectName(action.id));
      if (!raw || !attachment) continue;
      const bytes = await decodeBlob(raw, options.key);
      attachment.bytes = bytes;
      attachment.size = bytes.byteLength;
      attachment.needsDownload = false;
      attachment.syncedRevision = attachment.revision;
      pulledBlobs += 1;
      continue;
    }
    if (action.type === "conflict") continue;
    const attachment = attMap.get(action.id);
    if (!attachment || attachment.needsDownload) continue;
    if (!attachment.deletedAt) {
      if (attachment.bytes.byteLength === 0 && attachment.size > 0) continue;
      await options.driver.writeObject(blobObjectName(attachment.id), await encodeBlob(attachment.bytes, options.key));
      pushedBlobs += 1;
    }
    attachment.syncedRevision = attachment.revision;
  }

  const conflictIds = new Set(conflicts.map((conflict) => conflict.entryId));
  const entryPointers = new Map(remoteBody.entries.map((entry) => [entry.id, entry]));
  for (const entry of entryMap.values()) {
    if (conflictIds.has(entry.id)) continue;
    entryPointers.set(entry.id, {
      id: entry.id,
      revision: entry.revision,
      updatedAt: entry.updatedAt,
      deletedAt: entry.deletedAt,
    });
  }
  const blobPointers = new Map(remoteBody.blobs.map((blob) => [blob.id, blob]));
  for (const attachment of attMap.values()) {
    if (conflictIds.has(attachment.entryId) && attachment.revision !== attachment.syncedRevision) continue;
    blobPointers.set(attachment.id, {
      id: attachment.id,
      revision: attachment.revision,
      size: attachment.size,
      deletedAt: attachment.deletedAt,
    });
  }
  const body: CloudBody = {
    schemaVersion: 1,
    updatedAt: now,
    entries: [...entryPointers.values()],
    blobs: [...blobPointers.values()],
  };
  await options.driver.writeManifest(await encodeManifest(body, options.key, options.header));

  return {
    entries: [...entryMap.values()],
    attachments: [...attMap.values()],
    conflicts,
    pushedEntries,
    pulledEntries,
    pushedBlobs,
    pulledBlobs,
  };
}
