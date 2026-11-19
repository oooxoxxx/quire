import { useEffect, useRef, useState } from "react";
import { loadAttachment } from "@/lib/journal/store";
import { toArrayBuffer } from "@/lib/journal/crypto";
import { cn } from "@/lib/cn";

export function useAttachmentUrl(id: string | null, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !enabled) return;
    let cancelled = false;
    let objectUrl = "";
    void loadAttachment(id)
      .then((attachment) => {
        if (cancelled || attachment.bytes.byteLength === 0) return;
        objectUrl = URL.createObjectURL(new Blob([toArrayBuffer(attachment.bytes)], { type: attachment.mimeType }));
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, enabled]);
  return url;
}

export function useInView() {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setSeen(true);
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return { ref, seen };
}

export function AttachmentPreview({
  id,
  kind,
  className,
}: {
  id: string;
  kind: "image" | "video" | "audio" | "file";
  className?: string;
}) {
  const { ref, seen } = useInView();
  const url = useAttachmentUrl(id, seen);
  return (
    <div ref={ref} className={cn("overflow-hidden bg-bg-elev", className)}>
      {url && kind === "image" ? <img src={url} alt="" className="h-full w-full object-cover" /> : null}
      {url && kind === "video" ? <video src={url} controls className="h-full w-full bg-bg" /> : null}
      {url && kind === "audio" ? <audio src={url} controls className="w-full" /> : null}
    </div>
  );
}
