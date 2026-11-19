import { create } from "zustand";
import { parseAppleZip, type AppleImportItem } from "./apple/parse.ts";
import {
  b64ToBytes,
  bytesToB64,
  checkVerifier,
  deriveAesKey,
  hashSecret,
  makeVerifier,
  randomBytes,
  randomId,
  safeEqual,
} from "./crypto.ts";
import { journalDb } from "./db.ts";
import { MediaError, prepareFile } from "./media.ts";
import { openAttachment, openEntry, sealAttachment, sealEntry } from "./sealed.ts";
import { SyncError } from "./sync/errors.ts";
import { runSync } from "./sync/engine.ts";
import {
  clearGoogleToken,
  createGoogleDriver,
  ensureBackupFolder,
  listVisibleBackups,
  readGoogleToken,
  uploadVisibleBackup,
} from "./sync/google.ts";
import { resolveKeepLocal, resolveKeepRemote } from "./sync/plan.ts";
import {
  buildBackupZip,
  decryptBackup,
  encryptBackup,
  isEncryptedPackage,
  isJsonBackup,
  jsonBackupToRecords,
  readQuireZip,
  type JsonBackup,
} from "./export/transfer.ts";
import type {
  AppSettings,
  AttachmentMeta,
  AttachmentRecord,
  EncryptionHeader,
  JournalEntry,
  SyncConflict,
  ThemeMode,
} from "./types.ts";
import { defaultSettings } from "./types.ts";
import { entrySignature, isBlankEntry, normalizeTags } from "./text.ts";

export type SyncStatus = "idle" | "syncing" | "error" | "offline" | "conflict";

interface JournalState {
  hydrated: boolean;
  locked: boolean;
  deviceId: string;
  settings: AppSettings;
  entries: JournalEntry[];
  attachments: AttachmentMeta[];
  conflicts: SyncConflict[];
  syncStatus: SyncStatus;
  online: boolean;
  cloudUnlocked: boolean;
  hydrate: () => Promise<void>;
  lock: () => void;
  unlock: (pin: string) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  clearPin: () => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setLanguage: (language: AppSettings["language"]) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  createEntry: (partial?: Partial<JournalEntry>) => Promise<JournalEntry>;
  patchEntry: (id: string, partial: Partial<JournalEntry>) => Promise<void>;
  discardIfEmpty: (id: string) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  addFiles: (entryId: string, files: File[]) => Promise<void>;
  removeAttachment: (entryId: string, attachmentId: string) => Promise<void>;
  setOnline: (online: boolean) => void;
  syncNow: () => Promise<void>;
  resolveConflict: (id: string, choice: "local" | "remote" | "both") => Promise<void>;
  enableCloudEncryption: (passphrase: string, hint: string) => Promise<void>;
  unlockCloud: (passphrase: string) => Promise<void>;
  disableCloudEncryption: () => Promise<void>;
  commitAppleImport: (items: AppleImportItem[]) => Promise<number>;
  importBackup: (backup: JsonBackup) => Promise<{ added: number; updated: number }>;
  loadSampleApple: () => Promise<AppleImportItem[]>;
  listCloudBackups: () => Promise<{ id: string; name: string; modifiedTime?: string }[]>;
}

let dataKey: CryptoKey | null = null;
let cloudKey: CryptoKey | null = null;
let queue: Promise<unknown> = Promise.resolve();
let hydratePromise: Promise<void> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let forceRewrite = false;
let pinFails = 0;
let pinLockedUntil = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && systemDark));
  localStorage.setItem("quire-theme", theme);
}

export async function loadAttachment(id: string): Promise<AttachmentRecord> {
  const settings = useJournal.getState().settings;
  const stored = await journalDb.getAttachment(id);
  if (!stored) throw new Error("MISSING_ATTACHMENT");
  const key = settings.encryptAtRest ? dataKey : null;
  return openAttachment(stored, key, true);
}

function withoutBytes(record: AttachmentRecord): AttachmentMeta {
  const { bytes: _bytes, ...meta } = record;
  return meta;
}

async function persistEntry(entry: JournalEntry, settings: AppSettings): Promise<void> {
  const key = settings.encryptAtRest ? dataKey : null;
  if (settings.encryptAtRest && !key) throw new Error("LOCKED");
  await journalDb.putEntry(await sealEntry(entry, key));
}

async function persistAttachment(record: AttachmentRecord, settings: AppSettings): Promise<void> {
  const key = settings.encryptAtRest ? dataKey : null;
  if (settings.encryptAtRest && !key) throw new Error("LOCKED");
  await journalDb.putAttachment(await sealAttachment(record, key));
}

async function loadDecrypted(settings: AppSettings): Promise<{ entries: JournalEntry[]; attachments: AttachmentMeta[] }> {
  const key = settings.encryptAtRest ? dataKey : null;
  const entries: JournalEntry[] = [];
  for (const row of await journalDb.allEntries()) entries.push(await openEntry(row, key));
  const attachments: AttachmentMeta[] = [];
  for (const row of await journalDb.allAttachments()) {
    attachments.push(withoutBytes(await openAttachment(row, key, false)));
  }
  return { entries, attachments };
}

function cloudHeader(settings: AppSettings): EncryptionHeader | null {
  if (!settings.cloudEncryption || !settings.backupSalt || !settings.backupVerifier) return null;
  return {
    alg: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: settings.backupIterations,
    salt: settings.backupSalt,
    verifier: settings.backupVerifier,
  };
}

function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const state = useJournal.getState();
    if (!state.settings.autoSync || state.locked || !readGoogleToken()) return;
    void state.syncNow();
  }, 4000);
}

function blankEntry(deviceId: string, partial: Partial<JournalEntry> = {}): JournalEntry {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? randomId(),
    schemaVersion: 1,
    title: partial.title ?? "",
    content: partial.content ?? "",
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
    entryDate: partial.entryDate ?? now,
    timezone: partial.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
    mood: partial.mood ?? null,
    tags: partial.tags ?? [],
    location: partial.location ?? null,
    attachmentIds: partial.attachmentIds ?? [],
    isFavorite: partial.isFavorite ?? false,
    deletedAt: partial.deletedAt ?? null,
    deviceId,
    revision: partial.revision ?? 1,
    syncedRevision: partial.syncedRevision ?? 0,
    appleSourceId: partial.appleSourceId ?? null,
    metadata: partial.metadata ?? {},
  };
}

export const useJournal = create<JournalState>((set, get) => {
  const saveSettings = async (settings: AppSettings) => {
    await journalDb.setMeta("settings", settings);
    set({ settings });
  };

  const patchUnlocked = async (id: string, partial: Partial<JournalEntry>) => {
    const current = get().entries.find((entry) => entry.id === id);
    if (!current) return;
    const next: JournalEntry = {
      ...current,
      ...partial,
      id: current.id,
      attachmentIds: partial.attachmentIds ?? current.attachmentIds,
      tags: partial.tags ? normalizeTags(partial.tags) : current.tags,
      metadata: partial.metadata ?? current.metadata,
    };
    if (entrySignature(next) === entrySignature(current)) return;
    next.updatedAt = new Date().toISOString();
    next.revision = current.revision + 1;
    await persistEntry(next, get().settings);
    set({ entries: get().entries.map((entry) => (entry.id === id ? next : entry)) });
    scheduleSync();
  };

  return {
    hydrated: false,
    locked: false,
    deviceId: "",
    settings: defaultSettings(),
    entries: [],
    attachments: [],
    conflicts: [],
    syncStatus: "idle",
    online: true,
    cloudUnlocked: false,

    hydrate: () => {
      if (!hydratePromise) {
        hydratePromise = enqueue(async () => {
          let settings = (await journalDb.getMeta<AppSettings>("settings")) ?? defaultSettings();
          settings = { ...defaultSettings(), ...settings };
          if (!settings.googleClientId && import.meta.env.VITE_GOOGLE_CLIENT_ID) {
            settings = { ...settings, googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID };
            await journalDb.setMeta("settings", settings);
          }
          let deviceId = await journalDb.getMeta<string>("deviceId");
          if (!deviceId) {
            deviceId = randomId();
            await journalDb.setMeta("deviceId", deviceId);
          }
          const conflicts = await journalDb.allConflicts<SyncConflict>();
          applyTheme(settings.theme);
          if (settings.pinHash) {
            set({
              hydrated: true,
              locked: true,
              deviceId,
              settings,
              entries: [],
              attachments: [],
              conflicts,
              syncStatus: conflicts.length > 0 ? "conflict" : "idle",
              cloudUnlocked: false,
            });
            return;
          }
          const loaded = await loadDecrypted(settings);
          set({
            hydrated: true,
            locked: false,
            deviceId,
            settings,
            ...loaded,
            conflicts,
            syncStatus: conflicts.length > 0 ? "conflict" : "idle",
            cloudUnlocked: !settings.cloudEncryption,
          });
        }).catch((error) => {
          hydratePromise = null;
          throw error;
        });
      }
      return hydratePromise;
    },

    lock: () => {
      dataKey = null;
      cloudKey = null;
      set({ locked: true, entries: [], attachments: [], cloudUnlocked: false });
    },

    unlock: (pin) =>
      enqueue(async () => {
        if (Date.now() < pinLockedUntil) throw new Error("PIN_WAIT");
        const settings = get().settings;
        if (!settings.pinHash || !settings.pinSalt) throw new Error("NO_PIN");
        const hash = await hashSecret(pin, b64ToBytes(settings.pinSalt), settings.pinIterations);
        if (!safeEqual(hash, settings.pinHash)) {
          pinFails += 1;
          if (pinFails >= 5) {
            pinLockedUntil = Date.now() + 30_000;
            pinFails = 0;
          }
          throw new Error("BAD_PIN");
        }
        pinFails = 0;
        if (settings.encryptAtRest) {
          if (!settings.encSalt) throw new Error("NO_KEY");
          dataKey = await deriveAesKey(pin, b64ToBytes(settings.encSalt), settings.pinIterations);
        }
        const loaded = await loadDecrypted(settings);
        set({
          locked: false,
          ...loaded,
          cloudUnlocked: !settings.cloudEncryption,
          syncStatus: get().conflicts.length > 0 ? "conflict" : "idle",
        });
      }),

    setPin: (pin) =>
      enqueue(async () => {
        if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN_FORMAT");
        const settings = get().settings;
        const files: AttachmentRecord[] = [];
        for (const meta of get().attachments) {
          if (!meta.needsDownload) files.push(await loadAttachment(meta.id));
        }
        const salt = randomBytes(16);
        const encSalt = randomBytes(16);
        const iterations = settings.pinIterations;
        const pinHash = await hashSecret(pin, salt, iterations);
        dataKey = await deriveAesKey(pin, encSalt, iterations);
        const next = {
          ...settings,
          pinHash,
          pinSalt: bytesToB64(salt),
          encSalt: bytesToB64(encSalt),
          encryptAtRest: true,
        };
        await saveSettings(next);
        for (const entry of get().entries) await persistEntry(entry, next);
        for (const file of files) await persistAttachment(file, next);
      }),

    clearPin: () =>
      enqueue(async () => {
        const settings = get().settings;
        const files: AttachmentRecord[] = [];
        for (const meta of get().attachments) {
          if (!meta.needsDownload) files.push(await loadAttachment(meta.id));
        }
        const next = {
          ...settings,
          pinHash: null,
          pinSalt: null,
          encSalt: null,
          encryptAtRest: false,
        };
        await saveSettings(next);
        for (const entry of get().entries) await persistEntry(entry, next);
        for (const file of files) await persistAttachment(file, next);
        dataKey = null;
      }),

    setTheme: (theme) =>
      enqueue(async () => {
        applyTheme(theme);
        await saveSettings({ ...get().settings, theme });
      }),

    setLanguage: (language) =>
      enqueue(async () => {
        await saveSettings({ ...get().settings, language });
        document.documentElement.lang = language === "en" ? "en" : "zh-Hant";
      }),

    updateSettings: (patch) =>
      enqueue(async () => {
        await saveSettings({ ...get().settings, ...patch });
      }),

    createEntry: (partial = {}) =>
      enqueue(async () => {
        const entry = blankEntry(get().deviceId, partial);
        await persistEntry(entry, get().settings);
        set({ entries: [entry, ...get().entries] });
        return entry;
      }),

    patchEntry: (id, partial) => enqueue(() => patchUnlocked(id, partial)),

    discardIfEmpty: (id) =>
      enqueue(async () => {
        const entry = get().entries.find((item) => item.id === id);
        if (!entry || entry.syncedRevision !== 0 || !isBlankEntry(entry)) return;
        await journalDb.deleteEntry(id);
        for (const attachmentId of entry.attachmentIds) await journalDb.deleteAttachment(attachmentId);
        set({
          entries: get().entries.filter((item) => item.id !== id),
          attachments: get().attachments.filter((item) => item.entryId !== id),
        });
      }),

    deleteEntry: (id) =>
      enqueue(async () => {
        const entry = get().entries.find((item) => item.id === id);
        if (!entry) return;
        const now = new Date().toISOString();
        if (entry.syncedRevision === 0) {
          await journalDb.deleteEntry(id);
          for (const attachmentId of entry.attachmentIds) await journalDb.deleteAttachment(attachmentId);
          set({
            entries: get().entries.filter((item) => item.id !== id),
            attachments: get().attachments.filter((item) => item.entryId !== id),
          });
          return;
        }
        await patchUnlocked(id, { deletedAt: now });
        const attachments = get().attachments.map((item) =>
          item.entryId === id ? { ...item, deletedAt: now, revision: item.revision + 1 } : item,
        );
        for (const item of attachments.filter((attachment) => attachment.entryId === id)) {
          const full = item.needsDownload
            ? { ...item, bytes: new Uint8Array() }
            : { ...(await loadAttachment(item.id)), deletedAt: now, revision: item.revision };
          await persistAttachment(full, get().settings);
        }
        set({ attachments });
        scheduleSync();
      }),

    addFiles: (entryId, files) =>
      enqueue(async () => {
        const entry = get().entries.find((item) => item.id === entryId);
        if (!entry) return;
        const ids = [...entry.attachmentIds];
        const metas = [...get().attachments];
        for (const file of files) {
          const prepared = await prepareFile(file);
          const record: AttachmentRecord = {
            id: randomId(),
            entryId,
            kind: prepared.kind,
            mimeType: prepared.mimeType,
            name: prepared.name,
            size: prepared.bytes.byteLength,
            createdAt: new Date().toISOString(),
            width: prepared.width,
            height: prepared.height,
            durationMs: prepared.durationMs,
            revision: 1,
            syncedRevision: 0,
            deletedAt: null,
            appleResourceId: null,
            needsDownload: false,
            bytes: prepared.bytes,
          };
          await persistAttachment(record, get().settings);
          ids.push(record.id);
          metas.push(withoutBytes(record));
        }
        set({ attachments: metas });
        await patchUnlocked(entryId, { attachmentIds: ids });
      }),

    removeAttachment: (entryId, attachmentId) =>
      enqueue(async () => {
        const entry = get().entries.find((item) => item.id === entryId);
        const meta = get().attachments.find((item) => item.id === attachmentId);
        if (!entry || !meta) return;
        const now = new Date().toISOString();
        const next = { ...meta, deletedAt: now, revision: meta.revision + 1 };
        const full = meta.needsDownload
          ? { ...next, bytes: new Uint8Array() }
          : { ...(await loadAttachment(attachmentId)), ...next };
        await persistAttachment(full, get().settings);
        set({
          attachments: get().attachments.map((item) => (item.id === attachmentId ? next : item)),
        });
        await patchUnlocked(entryId, {
          attachmentIds: entry.attachmentIds.filter((id) => id !== attachmentId),
        });
      }),

    setOnline: (online) => {
      set({ online, syncStatus: online ? get().syncStatus : "offline" });
      if (online) scheduleSync();
    },

    syncNow: () =>
      enqueue(async () => {
        const state = get();
        if (state.locked) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          set({ syncStatus: "offline", online: false });
          return;
        }
        if (!state.settings.googleClientId) {
          await saveSettings({ ...get().settings, lastSyncError: "NO_CLIENT" });
          set({ syncStatus: "error" });
          return;
        }
        const token = readGoogleToken();
        if (!token) {
          await saveSettings({ ...get().settings, lastSyncError: "AUTH" });
          set({ syncStatus: "error" });
          return;
        }
        if (state.settings.cloudEncryption && !cloudKey) {
          await saveSettings({ ...get().settings, lastSyncError: "PASSPHRASE_REQUIRED" });
          set({ syncStatus: "error" });
          return;
        }
        set({ syncStatus: "syncing" });
        try {
          const attachments: AttachmentRecord[] = [];
          for (const meta of get().attachments) {
            const dirty = meta.revision > meta.syncedRevision && !meta.needsDownload && !meta.deletedAt;
            if (dirty || forceRewrite) attachments.push(await loadAttachment(meta.id));
            else attachments.push({ ...meta, bytes: new Uint8Array() });
          }
          const header = cloudHeader(get().settings);
          const outcome = await runSync({
            entries: get().entries,
            attachments,
            driver: createGoogleDriver(token.accessToken),
            key: get().settings.cloudEncryption ? cloudKey : null,
            header: get().settings.cloudEncryption ? header : null,
            forceRewrite,
          });
          forceRewrite = false;
          const settingsNow = get().settings;
          for (const entry of outcome.entries) await persistEntry(entry, settingsNow);
          for (const attachment of outcome.attachments) await persistAttachment(attachment, settingsNow);
          const known = new Set(get().conflicts.map((conflict) => conflict.id));
          for (const conflict of outcome.conflicts) {
            if (known.has(conflict.id)) continue;
            await journalDb.putConflict(conflict);
          }
          const conflicts = [...get().conflicts, ...outcome.conflicts.filter((conflict) => !known.has(conflict.id))];
          let folderNote: string | null = null;
          let visibleFolderId = settingsNow.visibleFolderId;
          if (settingsNow.visibleFolderBackup) {
            try {
              visibleFolderId = await ensureBackupFolder(token.accessToken, visibleFolderId);
              const fullAttachments: AttachmentRecord[] = [];
              for (const attachment of outcome.attachments) {
                fullAttachments.push(attachment.bytes.byteLength > 0 ? attachment : await loadAttachment(attachment.id).catch(() => attachment));
              }
              const sealed =
                settingsNow.cloudEncryption && cloudKey && header
                  ? await encryptBackup(
                      {
                        app: "quire",
                        schemaVersion: 1,
                        exportedAt: new Date().toISOString(),
                        entries: outcome.entries,
                        attachments: fullAttachments.map((attachment) => {
                          const { bytes, ...meta } = attachment;
                          return { ...meta, dataBase64: bytesToB64(bytes) };
                        }),
                      },
                      cloudKey,
                      header,
                    )
                  : undefined;
              const zip = await buildBackupZip(outcome.entries, fullAttachments, sealed);
              const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
              await uploadVisibleBackup(token.accessToken, visibleFolderId, `quire-backup-${stamp}.zip`, zip);
            } catch (error) {
              folderNote = error instanceof Error ? error.message : "FOLDER";
            }
          }
          const nextSettings = {
            ...get().settings,
            lastSyncAt: new Date().toISOString(),
            lastSyncError: folderNote ? "FOLDER" : null,
            visibleFolderId,
          };
          await saveSettings(nextSettings);
          set({
            entries: outcome.entries,
            attachments: outcome.attachments.map(withoutBytes),
            conflicts,
            syncStatus: conflicts.length > 0 ? "conflict" : "idle",
          });
        } catch (error) {
          const code = error instanceof SyncError ? error.code : "NETWORK";
          if (code === "AUTH") clearGoogleToken();
          const offline = code === "NETWORK" && typeof navigator !== "undefined" && navigator.onLine === false;
          await saveSettings({ ...get().settings, lastSyncError: code });
          set({ syncStatus: offline ? "offline" : "error", online: offline ? false : get().online });
        }
      }),

    resolveConflict: (id, choice) =>
      enqueue(async () => {
        const conflict = get().conflicts.find((item) => item.id === id);
        if (!conflict) return;
        if (choice === "local") {
          const next = resolveKeepLocal(conflict.local, conflict.remote.revision);
          await persistEntry(next, get().settings);
          set({ entries: get().entries.map((entry) => (entry.id === next.id ? next : entry)) });
        } else if (choice === "remote") {
          const next = resolveKeepRemote(conflict.remote);
          await persistEntry(next, get().settings);
          const missing = next.attachmentIds.filter((attachmentId) => !get().attachments.some((item) => item.id === attachmentId));
          const attachments = [...get().attachments];
          for (const attachmentId of missing) {
            attachments.push({
              id: attachmentId,
              entryId: next.id,
              kind: "file",
              mimeType: "application/octet-stream",
              name: attachmentId,
              size: 0,
              createdAt: next.updatedAt,
              width: null,
              height: null,
              durationMs: null,
              revision: 1,
              syncedRevision: 0,
              deletedAt: null,
              appleResourceId: null,
              needsDownload: true,
            });
          }
          set({
            entries: get().entries.map((entry) => (entry.id === next.id ? next : entry)),
            attachments,
          });
        } else {
          const copy = blankEntry(get().deviceId, {
            ...conflict.remote,
            id: randomId(),
            revision: 1,
            syncedRevision: 0,
            appleSourceId: null,
            metadata: { ...conflict.remote.metadata, duplicatedFrom: conflict.remote.id },
          });
          const local = resolveKeepLocal(conflict.local, conflict.remote.revision);
          await persistEntry(local, get().settings);
          await persistEntry(copy, get().settings);
          set({
            entries: [copy, ...get().entries.map((entry) => (entry.id === local.id ? local : entry))],
          });
        }
        await journalDb.deleteConflict(id);
        set({
          conflicts: get().conflicts.filter((item) => item.id !== id),
          syncStatus: get().conflicts.filter((item) => item.id !== id).length > 0 ? "conflict" : "idle",
        });
        scheduleSync();
      }),

    enableCloudEncryption: (passphrase, hint) =>
      enqueue(async () => {
        if (passphrase.length < 8) throw new Error("PASSPHRASE_SHORT");
        const salt = randomBytes(16);
        const iterations = get().settings.backupIterations;
        cloudKey = await deriveAesKey(passphrase, salt, iterations);
        const verifier = await makeVerifier(cloudKey);
        forceRewrite = true;
        await saveSettings({
          ...get().settings,
          cloudEncryption: true,
          backupHint: hint,
          backupSalt: bytesToB64(salt),
          backupVerifier: verifier,
        });
        set({ cloudUnlocked: true });
      }),

    unlockCloud: (passphrase) =>
      enqueue(async () => {
        const settings = get().settings;
        if (!settings.backupSalt || !settings.backupVerifier) throw new Error("NO_CLOUD");
        const key = await deriveAesKey(passphrase, b64ToBytes(settings.backupSalt), settings.backupIterations);
        if (!(await checkVerifier(key, settings.backupVerifier))) throw new Error("BAD_PASSPHRASE");
        cloudKey = key;
        set({ cloudUnlocked: true });
      }),

    disableCloudEncryption: () =>
      enqueue(async () => {
        if (get().settings.cloudEncryption && !cloudKey) throw new Error("PASSPHRASE_REQUIRED");
        forceRewrite = true;
        cloudKey = null;
        await saveSettings({ ...get().settings, cloudEncryption: false });
        set({ cloudUnlocked: true });
      }),

    commitAppleImport: (items) =>
      enqueue(async () => {
        const existing = new Set(get().entries.map((entry) => entry.appleSourceId).filter((id): id is string => !!id));
        let count = 0;
        const entries = [...get().entries];
        const attachments = [...get().attachments];
        for (const item of items) {
          if (item.status !== "new" || !item.entry || existing.has(item.appleSourceId)) continue;
          await persistEntry(item.entry, get().settings);
          for (const attachment of item.attachments ?? []) await persistAttachment(attachment, get().settings);
          entries.unshift(item.entry);
          attachments.push(...(item.attachments ?? []).map(withoutBytes));
          existing.add(item.appleSourceId);
          count += 1;
        }
        set({ entries, attachments });
        if (count > 0) scheduleSync();
        return count;
      }),

    importBackup: (backup) =>
      enqueue(async () => {
        const records = jsonBackupToRecords(backup);
        let added = 0;
        let updated = 0;
        const entries = [...get().entries];
        const attachments = [...get().attachments];
        for (const incoming of records.entries) {
          const index = entries.findIndex((entry) => entry.id === incoming.id);
          if (index === -1) {
            const entry = { ...incoming, deviceId: get().deviceId, syncedRevision: 0 };
            await persistEntry(entry, get().settings);
            entries.unshift(entry);
            added += 1;
          } else {
            const current = entries[index];
            if (!current) continue;
            const entry = {
              ...incoming,
              deviceId: current.deviceId,
              revision: current.revision + 1,
              syncedRevision: current.syncedRevision,
              createdAt: current.createdAt,
            };
            await persistEntry(entry, get().settings);
            entries[index] = entry;
            updated += 1;
          }
        }
        for (const incoming of records.attachments) {
          const index = attachments.findIndex((item) => item.id === incoming.id);
          const record = { ...incoming, syncedRevision: 0 };
          await persistAttachment(record, get().settings);
          if (index === -1) attachments.push(withoutBytes(record));
          else attachments[index] = withoutBytes(record);
        }
        set({ entries, attachments });
        scheduleSync();
        return { added, updated };
      }),

    loadSampleApple: async () => {
      const { buildSampleAppleZip } = await import("./apple/export.ts");
      const bytes = await buildSampleAppleZip();
      const existing = new Set(get().entries.map((entry) => entry.appleSourceId).filter((id): id is string => !!id));
      const preview = await parseAppleZip(bytes, { deviceId: get().deviceId, existingIds: existing, simulated: true });
      return preview.items;
    },

    listCloudBackups: async () => {
      const token = readGoogleToken();
      const folderId = get().settings.visibleFolderId;
      if (!token || !folderId) return [];
      return listVisibleBackups(token.accessToken, folderId);
    },
  };
});

export async function openImportedPayload(parsed: unknown, passphrase?: string): Promise<JsonBackup> {
  if (isEncryptedPackage(parsed)) {
    if (!passphrase) throw new Error("PASSPHRASE_REQUIRED");
    return decryptBackup(parsed, passphrase);
  }
  if (isJsonBackup(parsed)) return parsed;
  throw new Error("NOT_QUIRE_BACKUP");
}

export async function readImportedZip(bytes: Uint8Array, passphrase?: string): Promise<JsonBackup | "apple"> {
  const kindProbe = await readZipProbe(bytes);
  if (kindProbe === "apple") return "apple";
  const parsed = await readQuireZip(bytes);
  return openImportedPayload(parsed, passphrase);
}

async function readZipProbe(bytes: Uint8Array): Promise<"quire" | "apple" | "unknown"> {
  const { readZipKind } = await import("./export/transfer.ts");
  return readZipKind(bytes);
}

export { MediaError };
