import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/journal/use-copy";
import { buildSampleAppleZip } from "@/lib/journal/apple/export";
import { buildAppleZip } from "@/lib/journal/apple/export";
import { parseAppleZip, type AppleImportItem } from "@/lib/journal/apple/parse";
import { downloadBytes } from "@/lib/journal/download";
import { buildPdf } from "@/lib/journal/export/pdf";
import {
  buildHtmlDocument,
  buildJsonBackup,
  buildMarkdownZip,
  buildBackupZip,
  readZipKind,
  readQuireZip,
} from "@/lib/journal/export/transfer";
import { loadAttachment, openImportedPayload, useJournal } from "@/lib/journal/store";
import type { AttachmentRecord, JournalEntry } from "@/lib/journal/types";
import { formatLongDate, liveEntries } from "@/lib/journal/text";

export const Route = createFileRoute("/data")({ component: DataPage });

function DataPage() {
  const entries = useJournal((state) => state.entries);
  const commitAppleImport = useJournal((state) => state.commitAppleImport);
  const importBackup = useJournal((state) => state.importBackup);
  const deviceId = useJournal((state) => state.deviceId);
  const language = useJournal((state) => state.settings.language);
  const navigate = useNavigate();
  const { t } = useCopy();
  const [items, setItems] = useState<AppleImportItem[] | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [pendingEncrypted, setPendingEncrypted] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const live = liveEntries(entries);

  async function withAttachments(source: JournalEntry[]): Promise<AttachmentRecord[]> {
    const attachments: AttachmentRecord[] = [];
    for (const entry of source) {
      for (const id of entry.attachmentIds) {
        try {
          attachments.push(await loadAttachment(id));
        } catch {
          /* A missing blob is reported by leaving it out of this export. */
        }
      }
    }
    return attachments;
  }

  async function exportJson() {
    const attachments = await withAttachments(live);
    downloadBytes("quire-journal.json", new TextEncoder().encode(JSON.stringify(buildJsonBackup(live, attachments), null, 2)), "application/json");
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("syncError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="space-y-6 px-4 py-6 md:px-10 md:py-10">
      <header>
        <h1 className="font-serif text-4xl">{t("data")}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">{t("importHint")}</p>
      </header>

      <section className="quire-card space-y-3 p-5">
        <h2 className="font-serif text-2xl">{t("exportTitle")}</h2>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run(exportJson)}>{t("exportJson")}</Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const attachments = await withAttachments(live);
                downloadBytes("quire-markdown.zip", await buildMarkdownZip(live, attachments), "application/zip");
              })
            }
          >
            {t("exportMarkdown")}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const attachments = await withAttachments(live);
                downloadBytes("quire-journal.html", new TextEncoder().encode(buildHtmlDocument(live, attachments)), "text/html");
              })
            }
          >
            {t("exportHtml")}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const attachments = await withAttachments(live);
                downloadBytes("quire-journal.pdf", await buildPdf(live, attachments, language), "application/pdf");
              })
            }
          >
            {t("exportPdf")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              sessionStorage.setItem("quire-print-ids", JSON.stringify(live.map((entry) => entry.id)));
              void navigate({ to: "/print" });
            }}
          >
            {t("printPdf")}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const attachments = await withAttachments(live);
                downloadBytes("quire-backup.zip", await buildBackupZip(live, attachments), "application/zip");
              })
            }
          >
            {t("exportZip")}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const attachments = await withAttachments(live);
                downloadBytes("quire-apple-journal.zip", await buildAppleZip(live, attachments), "application/zip");
              })
            }
          >
            {t("exportApple")}
          </Button>
        </div>
        <p className="text-sm leading-6 text-muted">{t("appleWarning")}</p>
      </section>

      <section className="quire-card space-y-3 p-5">
        <h2 className="font-serif text-2xl">{t("importTitle")}</h2>
        <p className="text-sm text-muted">{t("overwriteHint")}</p>
        <input
          className="block w-full text-sm"
          type="file"
          accept=".zip,.json,application/json,application/zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void run(() => ingest(file));
            event.target.value = "";
          }}
        />
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const bytes = await buildSampleAppleZip();
              const existing = new Set(entries.map((entry) => entry.appleSourceId).filter((id): id is string => !!id));
              const preview = await parseAppleZip(bytes, { deviceId, existingIds: existing, simulated: true });
              setSimulated(true);
              setItems(preview.items);
            })
          }
        >
          {t("sampleApple")}
        </Button>
        {simulated ? <p className="text-sm leading-6 text-danger">{t("sampleWarning")}</p> : null}
        {pendingEncrypted ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const backup = await openImportedPayload(pendingEncrypted, passphrase);
                const result = await importBackup(backup);
                toast.success(`${t("newCount")} ${result.added} · ${t("updatedCount")} ${result.updated}`);
                setPendingEncrypted(null);
                setPassphrase("");
              });
            }}
          >
            <p className="text-sm">{t("encryptedBackup")}</p>
            <input className="field" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} aria-label={t("passphrase")} />
            <Button type="submit">{t("unlockCloud")}</Button>
          </form>
        ) : null}
        {items ? (
          <div className="space-y-3">
            <h3 className="font-serif text-xl">{t("preview")}</h3>
            <p className="text-sm text-muted">
              {t("ready")} {items.filter((item) => item.status === "new").length} · {t("duplicates")} {items.filter((item) => item.status === "duplicate").length} · {t("failures")} {items.filter((item) => item.status === "error").length}
            </p>
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.appleSourceId} className="rounded-control bg-bg px-3 py-2 text-sm">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-muted">
                    {item.entryDate ? formatLongDate(item.entryDate, language) : ""} · {item.status}
                    {item.message ? ` · ${item.message}` : ""}
                    {item.locationName ? ` · ${item.locationName}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <Button
              variant="primary"
              disabled={busy || items.every((item) => item.status !== "new")}
              onClick={() =>
                void run(async () => {
                  const count = await commitAppleImport(items);
                  toast.success(`${t("newCount")} ${count}`);
                  setItems(null);
                  setSimulated(false);
                })
              }
            >
              {t("importAction")}
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  );

  async function ingest(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setSimulated(false);
    if (file.name.toLowerCase().endsWith(".json") || file.type.includes("json")) {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      if (parsed && typeof parsed === "object" && (parsed as { encrypted?: boolean }).encrypted) {
        setPendingEncrypted(parsed);
        return;
      }
      const backup = await openImportedPayload(parsed);
      const result = await importBackup(backup);
      toast.success(`${t("newCount")} ${result.added}`);
      return;
    }
    const kind = await readZipKind(bytes);
    if (kind === "apple") {
      const existing = new Set(entries.map((entry) => entry.appleSourceId).filter((id): id is string => !!id));
      const preview = await parseAppleZip(bytes, { deviceId, existingIds: existing });
      setItems(preview.items);
      return;
    }
    if (kind === "quire") {
      const parsed = await readQuireZip(bytes);
      if (parsed && typeof parsed === "object" && "encrypted" in parsed && parsed.encrypted) {
        setPendingEncrypted(parsed);
        return;
      }
      const backup = await openImportedPayload(parsed);
      const result = await importBackup(backup);
      toast.success(`${t("newCount")} ${result.added} · ${t("updatedCount")} ${result.updated}`);
      return;
    }
    throw new Error(t("importHint"));
  }
}
