import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/journal/use-copy";
import { translate } from "@/lib/journal/i18n";
import {
  clearGoogleToken,
  readGoogleToken,
  requestGoogleToken,
} from "@/lib/journal/sync/google";
import { useJournal } from "@/lib/journal/store";
import type { ThemeMode } from "@/lib/journal/types";
import { formatLongDate, liveEntries } from "@/lib/journal/text";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const settings = useJournal((state) => state.settings);
  const entries = useJournal((state) => state.entries);
  const attachments = useJournal((state) => state.attachments);
  const conflicts = useJournal((state) => state.conflicts);
  const syncStatus = useJournal((state) => state.syncStatus);
  const cloudUnlocked = useJournal((state) => state.cloudUnlocked);
  const setTheme = useJournal((state) => state.setTheme);
  const setLanguage = useJournal((state) => state.setLanguage);
  const updateSettings = useJournal((state) => state.updateSettings);
  const setPin = useJournal((state) => state.setPin);
  const clearPin = useJournal((state) => state.clearPin);
  const syncNow = useJournal((state) => state.syncNow);
  const resolveConflict = useJournal((state) => state.resolveConflict);
  const enableCloud = useJournal((state) => state.enableCloudEncryption);
  const unlockCloud = useJournal((state) => state.unlockCloud);
  const disableCloud = useJournal((state) => state.disableCloudEncryption);
  const { t, language } = useCopy();
  const [clientId, setClientId] = useState(settings.googleClientId);
  const [pin, setPinValue] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [pass, setPass] = useState("");
  const [passAgain, setPassAgain] = useState("");
  const [hint, setHint] = useState(settings.backupHint);
  const [installHint, setInstallHint] = useState("");
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    setClientId(settings.googleClientId);
    setHint(settings.backupHint);
    setConnected(readGoogleToken() !== null);
  }, [settings.googleClientId, settings.backupHint, settings.lastSyncAt]);
  const bytes = attachments.reduce((sum, item) => sum + item.size, 0);

  return (
    <main className="space-y-6 px-4 py-6 md:px-10 md:py-10">
      <header>
        <h1 className="font-serif text-4xl">{t("settings")}</h1>
        <p className="mt-2 text-sm text-muted">
          {liveEntries(entries).length} {t("entriesCount")} · {formatBytes(bytes)} {t("storage")}
        </p>
      </header>

      <section className="quire-card space-y-3 p-5">
        <h2 className="font-serif text-2xl">{t("appearance")}</h2>
        <div className="flex flex-wrap gap-2">
          {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
            <Button key={mode} variant={settings.theme === mode ? "primary" : "surface"} onClick={() => void setTheme(mode)}>
              {t(mode)}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant={language === "zh-Hant" ? "primary" : "surface"} onClick={() => void setLanguage("zh-Hant")}>
            繁體中文
          </Button>
          <Button variant={language === "en" ? "primary" : "surface"} onClick={() => void setLanguage("en")}>
            English
          </Button>
        </div>
      </section>

      <section className="quire-card space-y-3 p-5">
        <h2 className="font-serif text-2xl">{t("lockTitle")}</h2>
        <p className="text-sm leading-6 text-muted">{t("pinHint")}</p>
        <p className="text-sm leading-6 text-muted">{t("encryptHelp")}</p>
        <input className="field" inputMode="numeric" value={pin} onChange={(event) => setPinValue(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder={t("setPin")} aria-label={t("setPin")} />
        <input className="field" inputMode="numeric" value={pinAgain} onChange={(event) => setPinAgain(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder={t("confirmPin")} aria-label={t("confirmPin")} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              if (pin !== pinAgain) {
                toast.error(t("pinMismatch"));
                return;
              }
              void setPin(pin)
                .then(() => {
                  setPinValue("");
                  setPinAgain("");
                  toast.success(t("saved"));
                })
                .catch(() => toast.error(t("wrongPin")));
            }}
          >
            {settings.pinHash ? t("changePin") : t("setPin")}
          </Button>
          {settings.pinHash ? (
            <Button
              variant="danger"
              onClick={() =>
                void clearPin().then(() => toast.success(t("removedPin")))
              }
            >
              {t("clearPin")}
            </Button>
          ) : null}
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>{t("autoLock")}</span>
          <select
            className="field w-auto"
            value={settings.autoLockMinutes}
            onChange={(event) => void updateSettings({ autoLockMinutes: Number(event.target.value) })}
          >
            <option value={0}>{t("off")}</option>
            <option value={1}>1 {t("minutes")}</option>
            <option value={5}>5 {t("minutes")}</option>
            <option value={15}>15 {t("minutes")}</option>
          </select>
        </label>
      </section>

      <section className="quire-card space-y-3 p-5">
        <h2 className="font-serif text-2xl">{t("driveTitle")}</h2>
        <p className="text-sm leading-6 text-muted">{t("driveIntro")}</p>
        <p className="text-sm leading-6 text-muted">{t("setupSteps")}</p>
        <label className="block text-sm text-muted" htmlFor="client-id">
          {t("clientId")}
        </label>
        <input
          id="client-id"
          className="field"
          value={clientId}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setClientId(event.target.value.trim())}
          onBlur={() => void updateSettings({ googleClientId: clientId })}
        />
        <p className="text-sm">{connected ? t("connected") : t("notConnected")}</p>
        <p className="text-sm text-muted">
          {t("lastSync")}: {settings.lastSyncAt ? formatLongDate(settings.lastSyncAt, language) : t("neverSynced")}
          {settings.lastSyncError ? ` · ${errorText(settings.lastSyncError, language)}` : ""}
          {syncStatus === "syncing" ? ` · ${t("syncing")}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              void updateSettings({ googleClientId: clientId }).then(() =>
                requestGoogleToken(clientId, "consent")
                  .then(() => {
                    setConnected(true);
                    toast.success(t("connected"));
                  })
                  .catch(() => toast.error(t("authNeeded"))),
              );
            }}
          >
            {connected ? t("reconnect") : t("connect")}
          </Button>
          <Button onClick={() => void syncNow()}>{t("syncNow")}</Button>
          <Button
            variant="quiet"
            onClick={() => {
              clearGoogleToken();
              setConnected(false);
              toast.success(t("disconnect"));
            }}
          >
            {t("disconnect")}
          </Button>
        </div>
        <Toggle
          label={t("autoSync")}
          checked={settings.autoSync}
          onChange={(checked) => void updateSettings({ autoSync: checked })}
        />
        <Toggle
          label={t("visibleFolder")}
          checked={settings.visibleFolderBackup}
          onChange={(checked) => void updateSettings({ visibleFolderBackup: checked })}
        />
        <p className="text-xs leading-5 text-muted">{t("visibleHelp")}</p>
        <Toggle
          label={t("cloudEncrypt")}
          checked={settings.cloudEncryption}
          onChange={(checked) => {
            if (!checked) {
              void disableCloud().catch(() => toast.error(t("passphraseNeeded")));
              return;
            }
            if (pass.length < 8 || pass !== passAgain) {
              toast.error(t("passphraseMismatch"));
              return;
            }
            void enableCloud(pass, hint)
              .then(() => toast.success(t("saved")))
              .catch(() => toast.error(t("passphraseMismatch")));
          }}
        />
        <p className="text-xs leading-5 text-muted">{t("cloudHelp")}</p>
        {settings.backupHint ? <p className="text-sm text-muted">{settings.backupHint}</p> : null}
        <input className="field" type="password" value={pass} onChange={(event) => setPass(event.target.value)} placeholder={t("passphrase")} aria-label={t("passphrase")} />
        {!settings.cloudEncryption ? (
          <input className="field" type="password" value={passAgain} onChange={(event) => setPassAgain(event.target.value)} placeholder={t("passphraseAgain")} aria-label={t("passphraseAgain")} />
        ) : null}
        <input className="field" value={hint} onChange={(event) => setHint(event.target.value)} placeholder={t("passphraseHint")} aria-label={t("passphraseHint")} />
        <div className="flex flex-wrap gap-2">
          {settings.cloudEncryption ? (
            <Button
              onClick={() =>
                void unlockCloud(pass)
                  .then(() => toast.success(t("unlockCloud")))
                  .catch(() => toast.error(t("badPassphrase")))
              }
            >
              {cloudUnlocked ? t("unlockCloud") : t("unlockCloud")}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                if (pass !== passAgain) {
                  toast.error(t("passphraseMismatch"));
                  return;
                }
                void enableCloud(pass, hint)
                  .then(() => {
                    setPass("");
                    setPassAgain("");
                    toast.success(t("saved"));
                  })
                  .catch(() => toast.error(t("passphraseMismatch")));
              }}
            >
              {t("savePassphrase")}
            </Button>
          )}
        </div>
      </section>

      {conflicts.length > 0 ? (
        <section className="quire-card space-y-4 p-5">
          <h2 className="font-serif text-2xl">{t("conflicts")}</h2>
          <p className="text-sm text-muted">{t("conflictHelp")}</p>
          {conflicts.map((conflict) => (
            <article key={conflict.id} className="rounded-control bg-bg p-3">
              <p className="text-sm text-muted">{t("keepLocal")}</p>
              <p className="font-serif text-xl">{conflict.local.title || t("none")}</p>
              <p className="mt-2 text-sm text-muted">{t("keepRemote")}</p>
              <p className="font-serif text-xl">{conflict.remote.title || t("none")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void resolveConflict(conflict.id, "local")}>{t("keepLocal")}</Button>
                <Button onClick={() => void resolveConflict(conflict.id, "remote")}>{t("keepRemote")}</Button>
                <Button onClick={() => void resolveConflict(conflict.id, "both")}>{t("keepBoth")}</Button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <section className="quire-card space-y-3 p-5">
        <h2 className="font-serif text-2xl">{t("data")}</h2>
        <Link to="/data" className="inline-flex min-h-11 items-center text-sm font-medium text-clay">
          {t("importTitle")} / {t("exportTitle")}
        </Link>
        <Button
          onClick={() => {
            const promptEvent = (window as Window & { quireInstall?: { prompt: () => Promise<void> } }).quireInstall;
            if (promptEvent) {
              void promptEvent.prompt();
              return;
            }
            setInstallHint(t("installIos"));
          }}
        >
          {t("install")}
        </Button>
        {installHint ? <p className="text-sm text-muted">{installHint}</p> : null}
      </section>

      <section className="quire-card space-y-2 p-5 text-sm leading-6 text-muted">
        <h2 className="font-serif text-2xl text-fg">{t("about")}</h2>
        <p>{t("privacy1")}</p>
        <p>{t("privacy2")}</p>
        <p>{t("privacy3")}</p>
        <p>{t("compatibility")}</p>
      </section>
    </main>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorText(code: string, language: "zh-Hant" | "en"): string {
  if (code === "NO_CLIENT") return translate(language, "noClient");
  if (code === "AUTH") return translate(language, "authNeeded");
  if (code === "PASSPHRASE_REQUIRED") return translate(language, "passphraseNeeded");
  if (code === "BAD_PASSPHRASE") return translate(language, "badPassphrase");
  if (code === "FOLDER") return translate(language, "folderBackupFailed");
  if (code === "OFFLINE" || code === "NETWORK") return translate(language, "syncOffline");
  return translate(language, "syncError");
}
