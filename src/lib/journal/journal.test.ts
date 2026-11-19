import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { buildAppleZip, buildSampleAppleZip } from "./apple/export.ts";
import { parseAppleHtml, parseAppleZip } from "./apple/parse.ts";
import {
  checkVerifier,
  deriveAesKey,
  encryptJson,
  decryptJson,
  makeVerifier,
  randomBytes,
  safeEqual,
} from "./crypto.ts";
import { buildJsonBackup, buildMarkdown, decryptBackup, encryptBackup, jsonBackupToRecords, readQuireZip, buildBackupZip } from "./export/transfer.ts";
import { memoriesOnThisDay, searchEntries } from "./search.ts";
import { openEntry, sealEntry } from "./sealed.ts";
import { memoryDriver, runSync } from "./sync/engine.ts";
import { SyncError } from "./sync/errors.ts";
import { planSync, resolveKeepLocal, resolveKeepRemote } from "./sync/plan.ts";
import { escapeHtml, htmlToMarkdown, sanitizeHtml, stripHtml } from "./text.ts";
import type { AttachmentRecord, EncryptionHeader, JournalEntry } from "./types.ts";

const amp = "&" + "amp;";
const lt = "&" + "lt;";
const gt = "&" + "gt;";
const quot = "&" + "quot;";

function entry(partial: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: partial.id ?? "entry-1",
    schemaVersion: 1,
    title: partial.title ?? "Morning",
    content: partial.content ?? "<p>Hello</p>",
    createdAt: partial.createdAt ?? "2024-01-14T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2024-01-14T00:00:00.000Z",
    entryDate: partial.entryDate ?? "2024-01-14T00:00:00.000Z",
    timezone: "Asia/Taipei",
    mood: partial.mood ?? "calm",
    tags: partial.tags ?? ["river"],
    location: partial.location ?? null,
    attachmentIds: partial.attachmentIds ?? [],
    isFavorite: partial.isFavorite ?? false,
    metadata: partial.metadata ?? {},
    deletedAt: partial.deletedAt ?? null,
    deviceId: partial.deviceId ?? "device-a",
    revision: partial.revision ?? 1,
    syncedRevision: partial.syncedRevision ?? 0,
    appleSourceId: partial.appleSourceId ?? null,
  };
}

function attachment(partial: Partial<AttachmentRecord> = {}): AttachmentRecord {
  const bytes = partial.bytes ?? new Uint8Array([9, 8, 7]);
  return {
    id: partial.id ?? "blob-1",
    entryId: partial.entryId ?? "entry-1",
    kind: partial.kind ?? "image",
    mimeType: "image/png",
    name: partial.name ?? "photo.png",
    size: bytes.byteLength,
    createdAt: "2024-01-14T00:00:00.000Z",
    width: null,
    height: null,
    durationMs: null,
    revision: partial.revision ?? 1,
    syncedRevision: partial.syncedRevision ?? 0,
    deletedAt: partial.deletedAt ?? null,
    appleResourceId: null,
    needsDownload: partial.needsDownload ?? false,
    bytes,
  };
}

describe("text", () => {
  it("escapes and decodes markup", () => {
    const raw = `a<b>&"'`;
    const escaped = escapeHtml(raw);
    assert.equal(escaped, `a${lt}b${gt}${amp}${quot}&#39;`);
    assert.equal(stripHtml(`<p>A ${amp} B</p>`), "A & B");
    assert.equal(htmlToMarkdown("<p>Hello <strong>there</strong></p>").includes("**there**"), true);
    assert.equal(sanitizeHtml("<script>alert(1)</script><p onclick='x'>ok</p>").includes("script"), false);
  });
});

describe("crypto and sealed entries", () => {
  it("round-trips JSON and refuses the wrong passphrase", async () => {
    const salt = randomBytes(16);
    const key = await deriveAesKey("correct horse", salt, 1_000);
    const other = await deriveAesKey("wrong horse", salt, 1_000);
    const box = await encryptJson(key, { title: "私密" });
    assert.deepEqual(await decryptJson(key, box), { title: "私密" });
    await assert.rejects(() => decryptJson(other, box));
    const verifier = await makeVerifier(key);
    assert.equal(await checkVerifier(key, verifier), true);
    assert.equal(await checkVerifier(other, verifier), false);
    assert.equal(safeEqual("abcd", "abcd"), true);
    assert.equal(safeEqual("abcd", "abce"), false);

    const original = entry({ title: "鎖上了" });
    const stored = await sealEntry(original, key);
    assert.equal(stored.body, null);
    assert.equal((await openEntry(stored, key)).title, "鎖上了");
    await assert.rejects(() => openEntry(stored, null), /LOCKED/);
  });
});

describe("sync plan", () => {
  it("pushes, pulls, and marks conflicts", () => {
    const actions = planSync(
      [
        { id: "new", revision: 1, syncedRevision: 0 },
        { id: "dirty", revision: 3, syncedRevision: 2 },
        { id: "clean", revision: 2, syncedRevision: 2 },
        { id: "both", revision: 4, syncedRevision: 2 },
      ],
      [
        { id: "dirty", revision: 2 },
        { id: "clean", revision: 2 },
        { id: "both", revision: 5 },
        { id: "remote-only", revision: 1 },
      ],
    );
    assert.deepEqual(
      actions.map((action) => `${action.type}:${action.id}`).sort(),
      ["conflict:both", "pull:remote-only", "push:dirty", "push:new"],
    );
    const kept = resolveKeepLocal(
      { id: "both", revision: 4, syncedRevision: 2, updatedAt: "old" },
      5,
      "now",
    );
    assert.equal(kept.revision, 6);
    assert.equal(kept.syncedRevision, 5);
    assert.equal(resolveKeepRemote({ id: "both", revision: 5, syncedRevision: 1 }).syncedRevision, 5);
  });

  it("syncs two devices, attachments, and a conflict", async () => {
    const cloud = memoryDriver();
    const local = entry({ attachmentIds: ["blob-1"] });
    const file = attachment();
    const first = await runSync({
      entries: [local],
      attachments: [file],
      driver: cloud,
      key: null,
      header: null,
      now: "2024-01-14T01:00:00.000Z",
    });
    assert.equal(first.pushedEntries, 1);
    assert.equal(first.pushedBlobs, 1);
    assert.equal(first.entries[0]?.syncedRevision, 1);

    const second = await runSync({
      entries: [],
      attachments: [],
      driver: cloud,
      key: null,
      header: null,
    });
    assert.equal(second.pulledEntries, 1);
    assert.equal(second.pulledBlobs, 1);
    assert.equal(second.entries[0]?.title, "Morning");
    assert.deepEqual(second.attachments[0]?.bytes, file.bytes);

    const editedHere = { ...first.entries[0]!, title: "From A", revision: 2 };
    const editedThere = { ...second.entries[0]!, title: "From B", revision: 2 };
    await runSync({
      entries: [editedHere],
      attachments: first.attachments,
      driver: cloud,
      key: null,
      header: null,
    });
    const conflicted = await runSync({
      entries: [editedThere],
      attachments: second.attachments,
      driver: cloud,
      key: null,
      header: null,
    });
    assert.equal(conflicted.conflicts.length, 1);
    assert.equal(conflicted.conflicts[0]?.local.title, "From B");
    assert.equal(conflicted.conflicts[0]?.remote.title, "From A");

    const winner = resolveKeepLocal(conflicted.conflicts[0]!.local, conflicted.conflicts[0]!.remote.revision, "2024-02-01T00:00:00.000Z");
    const settled = await runSync({
      entries: [winner],
      attachments: conflicted.attachments,
      driver: cloud,
      key: null,
      header: null,
    });
    assert.equal(settled.conflicts.length, 0);
    const otherSide = await runSync({
      entries: [{ ...editedHere, syncedRevision: editedHere.revision }],
      attachments: first.attachments,
      driver: cloud,
      key: null,
      header: null,
    });
    assert.equal(otherSide.entries.find((item) => item.id === "entry-1")?.title, "From B");
  });

  it("keeps an encrypted cloud copy unreadable without the passphrase", async () => {
    const salt = randomBytes(16);
    const key = await deriveAesKey("cloud-secret", salt, 1_000);
    const header: EncryptionHeader = {
      alg: "AES-256-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: 1_000,
      salt: Buffer.from(salt).toString("base64"),
      verifier: await makeVerifier(key),
    };
    const cloud = memoryDriver();
    await runSync({
      entries: [entry({ title: "Sealed" })],
      attachments: [],
      driver: cloud,
      key,
      header,
    });
    await assert.rejects(
      () =>
        runSync({
          entries: [],
          attachments: [],
          driver: cloud,
          key: null,
          header: null,
        }),
      (error: unknown) => error instanceof SyncError && error.code === "PASSPHRASE_REQUIRED",
    );
    const opened = await runSync({
      entries: [],
      attachments: [],
      driver: cloud,
      key,
      header,
    });
    assert.equal(opened.entries[0]?.title, "Sealed");
  });

  it("reports a network failure instead of inventing a remote journal", async () => {
    await assert.rejects(
      () =>
        runSync({
          entries: [entry()],
          attachments: [],
          driver: {
            async readManifest() {
              throw new Error("offline");
            },
            async writeManifest() {},
            async readObject() {
              return null;
            },
            async writeObject() {},
          },
          key: null,
          header: null,
        }),
      (error: unknown) => error instanceof SyncError && error.code === "NETWORK",
    );
  });
});

describe("backups", () => {
  it("round-trips JSON, markdown, and a zip with separate attachment bytes", async () => {
    const note = entry({ title: "河", content: "<p>Today <em>was</em> quiet.</p>" });
    const file = attachment({ bytes: new Uint8Array([1, 2, 3, 4]) });
    const json = buildJsonBackup([note], [file], "2024-05-01T00:00:00.000Z");
    const records = jsonBackupToRecords(json);
    assert.equal(records.entries[0]?.title, "河");
    assert.deepEqual(records.attachments[0]?.bytes, file.bytes);
    assert.match(buildMarkdown([note], [file]), /河/);

    const zip = await buildBackupZip([note], [file]);
    const restored = await readQuireZip(zip);
    assert.equal("entries" in restored && restored.entries[0]?.title, "河");
    if (!("entries" in restored)) throw new Error("expected json backup");
    const again = jsonBackupToRecords(restored);
    assert.deepEqual(again.attachments[0]?.bytes, file.bytes);

    const salt = randomBytes(16);
    const key = await deriveAesKey("backup-pass", salt, 1_000);
    const header: EncryptionHeader = {
      alg: "AES-256-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: 1_000,
      salt: Buffer.from(salt).toString("base64"),
      verifier: await makeVerifier(key),
    };
    const sealed = await encryptBackup(json, key, header);
    assert.equal(sealed.encrypted, true);
    assert.equal((await decryptBackup(sealed, "backup-pass")).entries[0]?.title, "河");
    await assert.rejects(() => decryptBackup(sealed, "nope"), /BAD_PASSPHRASE/);
  });
});

describe("Apple Journal", () => {
  it("reads the simulated export, including media, place, and mood", async () => {
    const bytes = await buildSampleAppleZip();
    const preview = await parseAppleZip(bytes, { deviceId: "device-a", existingIds: new Set() });
    assert.equal(preview.simulated, false);
    assert.equal(preview.items.length, 1);
    const item = preview.items[0];
    assert.equal(item?.status, "new");
    assert.equal(item?.title, "Morning light");
    assert.equal(item?.locationName, "Da'an Park");
    assert.equal(item?.counts.image, 1);
    assert.equal(item?.counts.video, 1);
    assert.equal(item?.counts.audio, 1);
    assert.equal(item?.entry?.mood, "grateful");
    assert.equal(item?.entry?.location?.latitude, 25.026);

    const again = await parseAppleZip(bytes, {
      deviceId: "device-a",
      existingIds: new Set(item?.appleSourceId ? [item.appleSourceId] : []),
    });
    assert.equal(again.items[0]?.status, "duplicate");
  });

  it("decodes entities and imports a large HTML archive once", async () => {
    const parsed = parseAppleHtml(
      `<div class="pageHeader">2024年3月2日</div><div class="title"><span class="s2">A ${amp} B</span></div><p class="bodyText">Tom ${amp} Jerry</p>`,
      "Entries/2024-03-02-note.html",
    );
    assert.equal(parsed.title, "A & B");
    assert.equal(parsed.text.includes("Tom & Jerry"), true);
    assert.equal(parsed.html.includes(amp), true);

    const zip = new JSZip();
    for (let index = 0; index < 40; index += 1) {
      const day = new Date(2020, 0, 1 + index);
      const stamp = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      zip.file(
        `AppleJournalEntries/Entries/${stamp}-page-${index}.html`,
        `<div class="pageHeader">${stamp}</div><div class="title"><span class="s2">Page ${index}</span></div><p class="bodyText">Line ${index}</p>`,
      );
    }
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const preview = await parseAppleZip(bytes, { deviceId: "device-a", existingIds: new Set() });
    assert.equal(preview.items.filter((item) => item.status === "new").length, 40);
    const ids = new Set(preview.items.map((item) => item.appleSourceId));
    const duplicate = await parseAppleZip(bytes, { deviceId: "device-a", existingIds: ids });
    assert.equal(duplicate.items.every((item) => item.status === "duplicate"), true);
  });

  it("round-trips a Quire Apple-compatible zip", async () => {
    const note = entry({
      title: "Exported",
      content: "<p>Kept.</p>",
      location: { name: "Home", latitude: 25.03, longitude: 121.56 },
      mood: "calm",
    });
    const file = attachment();
    note.attachmentIds = [file.id];
    const bytes = await buildAppleZip([note], [file]);
    const preview = await parseAppleZip(bytes, { deviceId: "device-b", existingIds: new Set() });
    assert.equal(preview.items[0]?.title, "Exported");
    assert.equal(preview.items[0]?.entry?.location?.name, "Home");
    assert.equal(preview.items[0]?.attachments?.[0]?.bytes.byteLength, file.bytes.byteLength);
  });
});

describe("search and memories", () => {
  it("filters entries and finds an earlier year", () => {
    const today = new Date(2026, 10, 16, 12);
    const older = entry({
      id: "old",
      title: "Same day",
      entryDate: "2024-11-16T08:00:00.000Z",
      content: "<p>park bench</p>",
      tags: ["park"],
      isFavorite: true,
    });
    const other = entry({ id: "other", title: "Elsewhere", entryDate: "2024-02-02T00:00:00.000Z", tags: [] });
    assert.equal(searchEntries([older, other], { query: "bench", mood: null, tag: "park", favorites: true, withMedia: false }).length, 1);
    assert.equal(memoriesOnThisDay([older, other], today).some((item) => item.id === "old"), true);
  });
});
