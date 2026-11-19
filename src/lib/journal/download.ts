import { toArrayBuffer } from "./crypto.ts";

export function downloadBytes(filename: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([toArrayBuffer(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
