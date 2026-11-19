import { PDFDocument } from "pdf-lib";
import { toArrayBuffer } from "../crypto.ts";
import type { AttachmentRecord, JournalEntry, Language } from "../types.ts";
import { formatLongDate, stripHtml } from "../text.ts";

export async function buildPdf(
  entries: JournalEntry[],
  attachments: AttachmentRecord[],
  language: Language,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const width = 794;
  const height = 1123;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS");
  let y = 72;
  let dirty = false;

  const paintBackground = () => {
    context.fillStyle = "#f7f3eb";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#1c1915";
    context.font = "16px Newsreader, Palatino, 'WenQuanYi Zen Hei', serif";
  };

  const flush = async () => {
    if (!dirty) return;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("PDF"))), "image/jpeg", 0.92);
    });
    const image = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = pdf.addPage([595.28, 841.89]);
    page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
    dirty = false;
    paintBackground();
    y = 72;
  };

  const ensure = async (needed: number) => {
    if (y + needed > height - 64) await flush();
  };

  const writeLine = async (text: string, font: string, color: string, gap: number) => {
    context.font = font;
    context.fillStyle = color;
    const lines = wrap(context, text, width - 144);
    for (const line of lines) {
      await ensure(gap);
      if (line) context.fillText(line, 72, y);
      y += gap;
      dirty = true;
    }
  };

  paintBackground();
  await writeLine("Quire", "600 28px Newsreader, Palatino, 'WenQuanYi Zen Hei', serif", "#1c1915", 40);
  for (const entry of entries.filter((item) => !item.deletedAt)) {
    await writeLine(formatLongDate(entry.entryDate, language), "16px Outfit, 'WenQuanYi Zen Hei', sans-serif", "#6f675c", 28);
    if (entry.title) {
      await writeLine(entry.title, "600 26px Newsreader, Palatino, 'WenQuanYi Zen Hei', serif", "#1c1915", 36);
    }
    const meta = [entry.mood, entry.location?.name, entry.tags.join(" · ")].filter(Boolean).join("  ·  ");
    if (meta) await writeLine(meta, "15px Outfit, 'WenQuanYi Zen Hei', sans-serif", "#6f675c", 26);
    await writeLine(stripHtml(entry.content) || " ", "18px Newsreader, Palatino, 'WenQuanYi Zen Hei', serif", "#1c1915", 28);
    for (const id of entry.attachmentIds) {
      const attachment = attachments.find((item) => item.id === id);
      if (!attachment || attachment.deletedAt) continue;
      if (attachment.kind !== "image" || attachment.bytes.byteLength === 0) {
        await writeLine(`${attachment.kind}: ${attachment.name}`, "15px Outfit, sans-serif", "#6f675c", 24);
        continue;
      }
      try {
        const bitmap = await createImageBitmap(new Blob([toArrayBuffer(attachment.bytes)], { type: attachment.mimeType }));
        const maxW = width - 144;
        const scale = Math.min(1, maxW / bitmap.width, 420 / bitmap.height);
        const w = bitmap.width * scale;
        const h = bitmap.height * scale;
        await ensure(h + 16);
        context.drawImage(bitmap, 72, y, w, h);
        y += h + 18;
        dirty = true;
        bitmap.close();
      } catch {
        await writeLine(attachment.name, "15px Outfit, sans-serif", "#6f675c", 24);
      }
    }
    y += 18;
  }
  await flush();
  if (pdf.getPageCount() === 0) {
    paintBackground();
    dirty = true;
    await writeLine("Quire", "600 28px Newsreader, serif", "#1c1915", 40);
    await flush();
  }
  return pdf.save();
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      const next = line + char;
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}
