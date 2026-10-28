"use client";

import { createWorker, PSM, type Worker } from "tesseract.js";
import { localDb } from "../db/local";
import type { OcrProgress } from "./types";
import { setPageLayout, type LayoutLine } from "./layout";

type Word = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; line?: { baseline?: { y0: number } } };
type Line = { words?: Word[]; bbox: { x0: number; y0: number; x1: number; y1: number } };
type OcrData = { text: string; words?: Word[]; blocks?: Array<{ paragraphs?: Array<{ lines?: Line[] }> }> };

/** tesseract.js v6+/v7 only returns word boxes inside blocks -> paragraphs -> lines -> words. */
export function extractLines(data: OcrData): Word[][] {
  const lines: Word[][] = [];
  for (const block of data.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) if (line.words?.length) lines.push([...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0));
  if (!lines.length && data.words?.length) { // older versions: flat word list, group by baseline
    const groups = new Map<number, Word[]>();
    for (const word of data.words) { const y = Math.round(word.line?.baseline?.y0 ?? word.bbox.y0); groups.set(y, [...(groups.get(y) ?? []), word]); }
    for (const line of groups.values()) lines.push(line.sort((a, b) => a.bbox.x0 - b.bbox.x0));
  }
  return lines.sort((a, b) => a[0].bbox.y0 - b[0].bbox.y0);
}

function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; }

/** Removes adjacent-page bleed using the exact marker-edge heuristic from ocr_all.py. Also returns each kept line's position. */
/** How far left of the typical line start text is still kept. Mock scans: 25 (tuned). Practice packs are tilted and shifted from page to page, so they need more room or the word "Question" gets cut off. */
let columnMargin = 25;
export const setColumnMargin = (pixels: number) => { columnMargin = pixels; };
export function filterColumnLayout(data: OcrData, width: number): { text: string; lines: LayoutLine[] } {
  const lines = extractLines(data);
  // Left edge of the real column, from where "Question", "Answer" and "A." ... lines begin (median, as tuned on the real mock scans).
  // Question numbers ("12.", "Q12") are only used when present, because in practice packs they sit left of the options.
  const isNumber = (w: string) => /^q?\d{1,3}[.)]$/i.test(w);
  const startsOf = (test: (w: string) => boolean) => lines.map((line) => line[0]).filter((word) => test(word.text) && word.bbox.x0 > width * 0.03).map((word) => word.bbox.x0);
  const words = startsOf((w) => /^(question|answer|a|b|c)$/i.test(w.replace(/[.)]+$/, ""))); const numbers = startsOf(isNumber);
  const base = words.length >= 2 ? median(words) : numbers.length >= 2 ? median(numbers) : null;
  const left = base === null ? 0 : (numbers.length >= 2 ? Math.min(base, median(numbers)) : base) - columnMargin; const right = width * 0.935;
  const kept: LayoutLine[] = [];
  for (const line of lines) {
    const words = line.filter((word) => word.bbox.x0 >= left && word.bbox.x1 <= right); if (!words.length) continue;
    kept.push({ text: words.map((word) => word.text).join(" "), x0: Math.min(...words.map((w) => w.bbox.x0)), x1: Math.max(...words.map((w) => w.bbox.x1)), y0: Math.min(...words.map((w) => w.bbox.y0)), y1: Math.max(...words.map((w) => w.bbox.y1)),
      gaps: words.slice(1).map((word, i) => word.bbox.x0 - words[i].bbox.x1), h: median(words.map((w) => w.bbox.y1 - w.bbox.y0)),
      markerX0: words.find((w) => /^(question|answer)$/i.test(w.text.replace(/[^A-Za-z]/g, "")))?.bbox.x0,
      slope: words.length >= 4 && words[words.length - 1].bbox.x1 - words[0].bbox.x0 > width * 0.3 ? ((words[words.length - 1].bbox.y0 + words[words.length - 1].bbox.y1) / 2 - (words[0].bbox.y0 + words[0].bbox.y1) / 2) / ((words[words.length - 1].bbox.x0 + words[words.length - 1].bbox.x1) / 2 - (words[0].bbox.x0 + words[0].bbox.x1) / 2) : undefined });
  }
  return { text: kept.map((line) => line.text).filter(Boolean).join("\n"), lines: kept };
}
export function filterColumn(data: OcrData, width: number): string { return filterColumnLayout(data, width).text; }

async function imageSize(source: Blob | HTMLCanvasElement): Promise<{ width: number; height: number } | null> {
  if (source instanceof HTMLCanvasElement) return { width: source.width, height: source.height };
  try { const bitmap = await createImageBitmap(source); const size = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return size; } catch { return null; }
}

export async function ocrImages(jobId: string, images: Array<{ page: number; image: Blob | HTMLCanvasElement | (() => Promise<HTMLCanvasElement>) }>, onProgress: (progress: OcrProgress) => void, pass: "a" | "b" = "a", onPageDone?: (page: number, text: string, wordCount: number) => void): Promise<Record<string, string>> {
  const total = images.length; const poolSize = Math.min(navigator.hardwareConcurrency || 2, 4); let cursor = 0; let done = 0;
  const workers: Worker[] = await Promise.all(Array.from({ length: Math.min(poolSize, total) }, async () => {
    const worker = await createWorker("eng", 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tesseract/lang",
      gzip: true,
    });
    await worker.setParameters({ tessedit_pageseg_mode: pass === "a" ? PSM.SINGLE_COLUMN : PSM.SINGLE_BLOCK, user_defined_dpi: pass === "a" ? "200" : "300" });
    return worker;
  }));
  const result: Record<string, string> = {};
  await Promise.all(workers.map(async (worker) => {
    while (cursor < images.length) {
      const item = images[cursor++]; const lazy = typeof item.image === "function"; const source = lazy ? await (item.image as () => Promise<HTMLCanvasElement>)() : (item.image as Blob | HTMLCanvasElement); const recognized = await worker.recognize(source, {}, { text: true, hocr: false, tsv: false, blocks: true });
      const data = recognized.data as unknown as OcrData;
      const size = await imageSize(source);
      const width = size?.width ?? Math.max(1, ...extractLines(data).flat().map((word) => word.bbox.x1 / 0.935));
      if (lazy && source instanceof HTMLCanvasElement) { source.width = 0; source.height = 0; } // free the page bitmap right away
      const filtered = filterColumnLayout(data, width); const text = filtered.text || data.text;
      if (size && filtered.lines.length) setPageLayout(item.page, { width: size.width, height: size.height, lines: filtered.lines }); result[String(item.page)] = text;
      await localDb.pageText.put({ id: `${jobId}:${pass}:${item.page}`, jobId, page: item.page, text, pass });
      if (item.page === 3 || item.page === 4 || item.page === 5) console.log(`[OCR page ${item.page}] ${data.text.slice(0, 500)}`, { wordCount: extractLines(data).flat().length });
      onPageDone?.(item.page, text, extractLines(data).flat().length);
      done += 1; onProgress({ done, total, stage: `Recognising text (page ${done} of ${total})` });
    }
  }));
  await Promise.all(workers.map((worker) => worker.terminate()));
  return result;
}
