"use client";

import { createWorker, PSM, type Worker } from "tesseract.js";
import { localDb } from "../db/local";
import type { OcrProgress } from "./types";

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

/** Removes adjacent-page bleed using the exact marker-edge heuristic from ocr_all.py. */
export function filterColumn(data: OcrData, width: number): string {
  const lines = extractLines(data);
  const starts = lines.map((line) => line[0]).filter((word) => /^(question|answer|a|b|c)$/i.test(word.text.replace(/[.)]+$/, "")) && word.bbox.x0 > width * 0.03).map((word) => word.bbox.x0);
  const left = starts.length >= 2 ? median(starts) - 25 : 0; const right = width * 0.935;
  return lines.map((line) => line.filter((word) => word.bbox.x0 >= left && word.bbox.x1 <= right).map((word) => word.text).join(" ")).filter(Boolean).join("\n");
}

export async function ocrImages(jobId: string, images: Array<{ page: number; image: Blob | HTMLCanvasElement }>, onProgress: (progress: OcrProgress) => void, pass: "a" | "b" = "a", onPageDone?: (page: number, text: string, wordCount: number) => void): Promise<Record<string, string>> {
  const total = images.length; const poolSize = Math.min(navigator.hardwareConcurrency || 2, 4); let cursor = 0; let done = 0;
  const workers: Worker[] = await Promise.all(Array.from({ length: Math.min(poolSize, total) }, async () => {
    const worker = await createWorker("eng", 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tesseract/lang",
      gzip: true,
    });
    await worker.setParameters({ tessedit_pageseg_mode: pass === "a" ? PSM.SINGLE_COLUMN : PSM.SINGLE_BLOCK, user_defined_dpi: "200" });
    return worker;
  }));
  const result: Record<string, string> = {};
  await Promise.all(workers.map(async (worker) => {
    while (cursor < images.length) {
      const item = images[cursor++]; const recognized = await worker.recognize(item.image, {}, { text: true, hocr: false, tsv: false, blocks: true });
      const data = recognized.data as unknown as OcrData;
      const width = item.image instanceof HTMLCanvasElement ? item.image.width : Math.max(1, ...extractLines(data).flat().map((word) => word.bbox.x1 / 0.935));
      const text = filterColumn(data, width) || data.text; result[String(item.page)] = text;
      await localDb.pageText.put({ id: `${jobId}:${pass}:${item.page}`, jobId, page: item.page, text, pass });
      if (item.page === 3 || item.page === 4 || item.page === 5) console.log(`[OCR page ${item.page}] ${data.text.slice(0, 500)}`, { wordCount: extractLines(data).flat().length });
      onPageDone?.(item.page, text, extractLines(data).flat().length);
      done += 1; onProgress({ done, total, stage: `Recognising text (page ${done} of ${total})` });
    }
  }));
  await Promise.all(workers.map((worker) => worker.terminate()));
  return result;
}
