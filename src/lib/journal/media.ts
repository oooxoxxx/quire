import type { AttachmentKind } from "./types.ts";

const LIMITS: Record<AttachmentKind, number> = {
  image: 25 * 1024 * 1024,
  video: 80 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  file: 20 * 1024 * 1024,
};

export function kindFromFile(file: File): AttachmentKind {
  const mime = file.type.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"].includes(ext)) return "image";
  if (mime.startsWith("video/") || ["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (mime.startsWith("audio/") || ["m4a", "mp3", "aac", "wav", "caf"].includes(ext)) return "audio";
  return "file";
}

export class MediaError extends Error {
  code: "TOO_LARGE" | "UNREADABLE";
  constructor(code: "TOO_LARGE" | "UNREADABLE") {
    super(code);
    this.code = code;
  }
}

async function compressImage(file: File): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxEdge = 2000;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new MediaError("UNREADABLE");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new MediaError("UNREADABLE"))), "image/jpeg", 0.86);
    });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close();
  }
}

async function durationMs(file: File, kind: AttachmentKind): Promise<number | null> {
  if (kind !== "audio" && kind !== "video") return null;
  const url = URL.createObjectURL(file);
  try {
    const element = document.createElement(kind === "audio" ? "audio" : "video");
    const duration = await new Promise<number>((resolve, reject) => {
      element.preload = "metadata";
      element.onloadedmetadata = () => resolve(element.duration);
      element.onerror = () => reject(new Error("metadata"));
      element.src = url;
    });
    return Number.isFinite(duration) ? Math.round(duration * 1000) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareFile(file: File): Promise<{
  bytes: Uint8Array;
  mimeType: string;
  name: string;
  kind: AttachmentKind;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}> {
  const kind = kindFromFile(file);
  if (file.size > LIMITS[kind]) throw new MediaError("TOO_LARGE");
  const duration = await durationMs(file, kind);
  const gif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
  if (kind === "image" && !gif) {
    try {
      const compressed = await compressImage(file);
      const base = file.name.replace(/\.[^.]+$/, "") || "photo";
      return {
        bytes: compressed.bytes,
        mimeType: "image/jpeg",
        name: `${base}.jpg`,
        kind,
        width: compressed.width,
        height: compressed.height,
        durationMs: null,
      };
    } catch {
      /* Keep the original bytes when the browser cannot decode the image. */
    }
  }
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type || "application/octet-stream",
    name: file.name || "attachment",
    kind,
    width: null,
    height: null,
    durationMs: duration,
  };
}
