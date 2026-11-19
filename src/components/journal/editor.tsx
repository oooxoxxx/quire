import { useNavigate } from "@tanstack/react-router";
import {
  Bold,
  Camera,
  ChevronLeft,
  ImagePlus,
  Italic,
  List,
  MapPin,
  Mic,
  Quote,
  Star,
  Trash2,
  Underline,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AttachmentPreview } from "@/components/journal/attachment-view";
import { useCopy } from "@/components/journal/use-copy";
import { Button } from "@/components/ui/button";
import { MediaError } from "@/lib/journal/media";
import { useJournal } from "@/lib/journal/store";
import { MOODS } from "@/lib/journal/types";
import { formatLongDate, fromDatetimeLocalValue, isBlankEntry, sanitizeHtml, toDatetimeLocalValue } from "@/lib/journal/text";

export function Editor({ entryId }: { entryId: string }) {
  const navigate = useNavigate();
  const { t, language, mood } = useCopy();
  const entry = useJournal((state) => state.entries.find((item) => item.id === entryId));
  const attachmentList = useJournal((state) => state.attachments);
  const attachments = useMemo(
    () => attachmentList.filter((item) => item.entryId === entryId && !item.deletedAt),
    [attachmentList, entryId],
  );
  const patchEntry = useJournal((state) => state.patchEntry);
  const discardIfEmpty = useJournal((state) => state.discardIfEmpty);
  const deleteEntry = useJournal((state) => state.deleteEntry);
  const addFiles = useJournal((state) => state.addFiles);
  const removeAttachment = useJournal((state) => state.removeAttachment);
  const hydrated = useJournal((state) => state.hydrated);
  const bodyRef = useRef<HTMLDivElement>(null);
  const draft = useRef({ title: "", html: "" });
  const loaded = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const [title, setTitle] = useState("");
  const [bodyEmpty, setBodyEmpty] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [tag, setTag] = useState("");
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!entry || loaded.current === entry.id) return;
    loaded.current = entry.id;
    draft.current = { title: entry.title, html: entry.content };
    setTitle(entry.title);
    setBodyEmpty(isBlankHtml(entry.content));
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.innerHTML = sanitizeHtml(entry.content);
    });
  }, [entry]);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  function schedule() {
    if (timer.current) window.clearTimeout(timer.current);
    setSaving(true);
    timer.current = window.setTimeout(() => {
      void patchEntry(entryId, { title: draft.current.title, content: sanitizeHtml(draft.current.html) }).finally(() =>
        setSaving(false),
      );
    }, 500);
  }

  async function goBack() {
    if (timer.current) {
      window.clearTimeout(timer.current);
      await patchEntry(entryId, { title: draft.current.title, content: sanitizeHtml(draft.current.html) });
    }
    await discardIfEmpty(entryId);
    void navigate({ to: "/" });
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      await addFiles(entryId, [...files]);
    } catch (error) {
      toast.error(error instanceof MediaError && error.code === "TOO_LARGE" ? t("tooLarge") : t("unreadable"));
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
        void onFiles(fileList(file));
        setRecording(false);
      };
      recorder.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
    } catch {
      toast.error(t("micDenied"));
    }
  }

  if (!hydrated) return null;
  if (!entry) {
    return (
      <main className="px-5 py-16 text-center">
        <p className="font-serif text-3xl">{t("notFound")}</p>
        <Button className="mt-6" onClick={() => void navigate({ to: "/" })}>
          {t("back")}
        </Button>
      </main>
    );
  }

  const place = entry.location;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-4 md:px-8">
      <header className="flex items-center gap-2">
        <button type="button" className="grid size-11 place-items-center rounded-full" onClick={() => void goBack()} aria-label={t("back")}>
          <ChevronLeft />
        </button>
        <p className="flex-1 text-center text-sm text-muted">{saving ? t("saving") : t("saved")}</p>
        <button
          type="button"
          className="grid size-11 place-items-center rounded-full text-clay"
          aria-label={entry.isFavorite ? t("unfavorite") : t("favorite")}
          onClick={() => void patchEntry(entry.id, { isFavorite: !entry.isFavorite })}
        >
          <Star size={18} fill={entry.isFavorite ? "currentColor" : "none"} />
        </button>
        <button type="button" className="grid size-11 place-items-center rounded-full text-danger" aria-label={t("delete")} onClick={() => setConfirming(true)}>
          <Trash2 size={18} />
        </button>
      </header>

      <label className="mt-4 block text-sm text-muted" htmlFor="entry-date">
        {t("entryDate")}
      </label>
      <input
        id="entry-date"
        className="field mt-1"
        type="datetime-local"
        value={toDatetimeLocalValue(entry.entryDate)}
        onChange={(event) => {
          const next = fromDatetimeLocalValue(event.target.value);
          if (next) void patchEntry(entry.id, { entryDate: next });
        }}
      />
      <p className="mt-2 text-sm text-muted">{formatLongDate(entry.entryDate, language)}</p>

      <input
        value={title}
        onChange={(event) => {
          draft.current.title = event.target.value;
          setTitle(event.target.value);
          schedule();
        }}
        placeholder={t("titlePlaceholder")}
        className="mt-6 w-full bg-transparent font-serif text-4xl outline-none placeholder:text-muted"
        aria-label={t("titlePlaceholder")}
      />
      <div className="relative mt-4 min-h-48 flex-1">
        {bodyEmpty ? <p className="pointer-events-none absolute text-lg text-muted">{t("bodyPlaceholder")}</p> : null}
        <div
          ref={bodyRef}
          role="textbox"
          aria-multiline="true"
          aria-label={t("bodyPlaceholder")}
          contentEditable
          suppressContentEditableWarning
          className="min-h-48 font-serif text-xl leading-8 outline-none"
          onInput={(event) => {
            draft.current.html = (event.currentTarget as HTMLDivElement).innerHTML;
            setBodyEmpty(isBlankHtml(draft.current.html));
            schedule();
          }}
          onPaste={(event) => {
            event.preventDefault();
            document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
            if (bodyRef.current) draft.current.html = bodyRef.current.innerHTML;
            schedule();
          }}
        />
      </div>

      {attachments.length > 0 ? (
        <div className="mt-4 space-y-3">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="quire-card overflow-hidden">
              <AttachmentPreview id={attachment.id} kind={attachment.kind} className={attachment.kind === "image" ? "aspect-[4/3]" : "p-3"} />
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate text-muted">{attachment.name}</span>
                <button type="button" className="min-h-11 px-2 text-danger" onClick={() => void removeAttachment(entry.id, attachment.id)}>
                  {t("delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <section className="mt-6">
        <p className="text-sm text-muted">{t("mood")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {MOODS.map((item) => (
            <button
              key={item}
              type="button"
              className={`min-h-11 rounded-full px-3 text-sm ${entry.mood === item ? "bg-clay text-clay-fg" : "bg-card text-fg"}`}
              onClick={() => void patchEntry(entry.id, { mood: entry.mood === item ? null : item })}
            >
              {mood(item)}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <p className="text-sm text-muted">{t("tags")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {entry.tags.map((item) => (
            <button key={item} type="button" className="min-h-11 rounded-full bg-bg-elev px-3 text-sm" onClick={() => void patchEntry(entry.id, { tags: entry.tags.filter((tagItem) => tagItem !== item) })}>
              #{item}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = tag.trim();
            if (!next) return;
            void patchEntry(entry.id, { tags: [...entry.tags, next] });
            setTag("");
          }}
        >
          <input className="field" value={tag} onChange={(event) => setTag(event.target.value)} placeholder={t("tagPlaceholder")} aria-label={t("tagPlaceholder")} />
          <Button type="submit">{t("done")}</Button>
        </form>
      </section>

      <section className="mt-5">
        <p className="text-sm text-muted">{t("location")}</p>
        <input
          className="field mt-2"
          value={place?.name ?? ""}
          placeholder={t("placeName")}
          aria-label={t("placeName")}
          onChange={(event) =>
            void patchEntry(entry.id, {
              location: { name: event.target.value, latitude: place?.latitude ?? null, longitude: place?.longitude ?? null },
            })
          }
        />
        <p className="mt-2 text-xs leading-5 text-muted">{t("locationPrivacy")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  void patchEntry(entry.id, {
                    location: {
                      name: place?.name ?? "",
                      latitude: position.coords.latitude,
                      longitude: position.coords.longitude,
                    },
                  });
                },
                () => toast.error(t("locationDenied")),
                { enableHighAccuracy: true, timeout: 10000 },
              );
            }}
          >
            <MapPin size={16} />
            {t("useLocation")}
          </Button>
          <Button
            onClick={() => {
              if (place?.latitude == null || place.longitude == null) return;
              void fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${place.latitude}&lon=${place.longitude}`)
                .then((response) => response.json())
                .then((payload: { display_name?: string }) => {
                  if (!payload.display_name) {
                    toast.error(t("geocodeFail"));
                    return;
                  }
                  void patchEntry(entry.id, { location: { ...place, name: payload.display_name } });
                })
                .catch(() => toast.error(t("geocodeFail")));
            }}
          >
            {t("lookupPlace")}
          </Button>
          {place ? (
            <Button variant="quiet" onClick={() => void patchEntry(entry.id, { location: null })}>
              {t("clearLocation")}
            </Button>
          ) : null}
        </div>
        {place?.latitude != null && place.longitude != null ? (
          <p className="mt-2 text-xs text-muted">
            {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}
          </p>
        ) : null}
      </section>

      <div className="sticky bottom-0 mt-6 flex gap-1 overflow-x-auto border-t border-line bg-bg py-3">
        <ToolButton label="Bold" onClick={() => command("bold")}>
          <Bold size={18} />
        </ToolButton>
        <ToolButton label="Italic" onClick={() => command("italic")}>
          <Italic size={18} />
        </ToolButton>
        <ToolButton label="Underline" onClick={() => command("underline")}>
          <Underline size={18} />
        </ToolButton>
        <ToolButton label="List" onClick={() => command("insertUnorderedList")}>
          <List size={18} />
        </ToolButton>
        <ToolButton label="Quote" onClick={() => command("formatBlock", "blockquote")}>
          <Quote size={18} />
        </ToolButton>
        <ToolButton label={t("addMedia")} onClick={() => libraryRef.current?.click()}>
          <ImagePlus size={18} />
        </ToolButton>
        <ToolButton label={t("camera")} onClick={() => cameraRef.current?.click()}>
          <Camera size={18} />
        </ToolButton>
        <ToolButton label={recording ? t("stopRecord") : t("record")} onClick={() => void toggleRecording()}>
          <Mic size={18} />
        </ToolButton>
        <input ref={libraryRef} hidden type="file" accept="image/*,video/*,audio/*" multiple onChange={(event) => void onFiles(event.target.files)} />
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => void onFiles(event.target.files)} />
      </div>
      {recording ? <p className="pb-2 text-sm text-clay">{t("recording")}</p> : null}
      {isBlankEntry(entry) ? <p className="pb-4 text-xs text-muted">{t("sameDay")}</p> : null}

      {confirming ? (
        <div className="fixed inset-0 z-30 grid place-items-end bg-fg/30 p-4 sm:place-items-center" role="dialog" aria-modal="true">
          <div className="quire-card w-full max-w-sm p-5">
            <h2 className="font-serif text-2xl">{t("deleteConfirm")}</h2>
            <p className="mt-2 text-sm text-muted">{t("deleteBody")}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="quiet" onClick={() => setConfirming(false)}>
                {t("cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  void deleteEntry(entry.id).then(() => navigate({ to: "/" }));
                }}
              >
                {t("delete")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );

  function command(name: string, value?: string) {
    bodyRef.current?.focus();
    document.execCommand(name, false, value);
    if (bodyRef.current) draft.current.html = bodyRef.current.innerHTML;
    schedule();
  }
}

function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

function fileList(file: File): FileList {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  return transfer.files;
}

function ToolButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}
