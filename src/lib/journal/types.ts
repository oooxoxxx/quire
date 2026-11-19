export const SCHEMA_VERSION = 1 as const;

export const MOODS = [
  "joyful",
  "grateful",
  "calm",
  "reflective",
  "sad",
  "anxious",
  "excited",
  "tired",
] as const;

export type Mood = (typeof MOODS)[number];
export type AttachmentKind = "image" | "video" | "audio" | "file";
export type ThemeMode = "light" | "dark" | "system";
export type Language = "zh-Hant" | "en";

export interface JournalLocation {
  name: string;
  latitude: number | null;
  longitude: number | null;
}

export interface EntryBody {
  title: string;
  content: string;
  timezone: string;
  mood: Mood | null;
  tags: string[];
  location: JournalLocation | null;
  attachmentIds: string[];
  isFavorite: boolean;
  metadata: Record<string, unknown>;
}

export interface JournalEntry extends EntryBody {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
  entryDate: string;
  deletedAt: string | null;
  deviceId: string;
  revision: number;
  syncedRevision: number;
  appleSourceId: string | null;
}

export interface AttachmentRecord {
  id: string;
  entryId: string;
  kind: AttachmentKind;
  mimeType: string;
  name: string;
  size: number;
  createdAt: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  revision: number;
  syncedRevision: number;
  deletedAt: string | null;
  appleResourceId: string | null;
  needsDownload: boolean;
  bytes: Uint8Array;
}

export type AttachmentMeta = Omit<AttachmentRecord, "bytes">;

export interface SealedBox {
  iv: string;
  data: string;
}

export interface StoredEntry {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
  syncedRevision: number;
  deviceId: string;
  appleSourceId: string | null;
  sealed: SealedBox | null;
  body: EntryBody | null;
}

export interface StoredAttachmentMeta {
  kind: AttachmentKind;
  mimeType: string;
  name: string;
  createdAt: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  appleResourceId: string | null;
}

export interface StoredAttachment {
  id: string;
  entryId: string;
  revision: number;
  syncedRevision: number;
  deletedAt: string | null;
  size: number;
  needsDownload: boolean;
  sealedMeta: SealedBox | null;
  sealedBlob: { iv: string; byteLength: number; data: ArrayBuffer } | null;
  meta: StoredAttachmentMeta | null;
  blob: ArrayBuffer | null;
}

export interface EncryptionHeader {
  alg: "AES-256-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  verifier: SealedBox;
}

export interface AppSettings {
  theme: ThemeMode;
  language: Language;
  pinHash: string | null;
  pinSalt: string | null;
  pinIterations: number;
  encSalt: string | null;
  encryptAtRest: boolean;
  autoLockMinutes: number;
  googleClientId: string;
  autoSync: boolean;
  visibleFolderBackup: boolean;
  cloudEncryption: boolean;
  backupHint: string;
  backupSalt: string | null;
  backupIterations: number;
  backupVerifier: SealedBox | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  driveManifestFileId: string | null;
  visibleFolderId: string | null;
}

export interface SyncConflict {
  id: string;
  entryId: string;
  local: JournalEntry;
  remote: JournalEntry;
  detectedAt: string;
}

export const PIN_ITERATIONS = 120_000;
export const BACKUP_ITERATIONS = 150_000;

export function defaultSettings(): AppSettings {
  return {
    theme: "system",
    language: "zh-Hant",
    pinHash: null,
    pinSalt: null,
    pinIterations: PIN_ITERATIONS,
    encSalt: null,
    encryptAtRest: false,
    autoLockMinutes: 5,
    googleClientId: "",
    autoSync: true,
    visibleFolderBackup: false,
    cloudEncryption: false,
    backupHint: "",
    backupSalt: null,
    backupIterations: BACKUP_ITERATIONS,
    backupVerifier: null,
    lastSyncAt: null,
    lastSyncError: null,
    driveManifestFileId: null,
    visibleFolderId: null,
  };
}
