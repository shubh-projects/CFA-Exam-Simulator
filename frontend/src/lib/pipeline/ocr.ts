"use client";

import { createWorker, PSM, type Worker } from "tesseract.js";
import { localDb } from "../db/local";
import type { OcrProgress } from "./types";

type Word = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; line?: { baseline?: { y0: number } } };
type OcrData = { text: string; words?: Word[]; lines?: Array<{ words?: Word[]; bbox?: { y0: number } }> };

function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; }

/** Removes adjacent-page bleed using the exact marker-edge heuristic from ocr_all.py. */
export function filterColumn(data: OcrData, width: number): string {
  const words = data.words ?? [];
  const groups = new Map<number, Word[]>();
  words.forEach((word, index) => { const y = Math.round(word.line?.baseline?.y0 ?? word.bbox.y0); groups.set(y, [...(groups.get(y) ?? []), word]); if (!word.line && !groups.has(index)) groups.set(index, [word]); });
  const lines = [...groups.values()].map((line) => line.sort((a, b) => a.bbox.x0 - b.bbox.x0));
  const starts = lines.map((line) => line[0]).filter(Boolean).filter((word) => /^(question|answer|a|b|c)$/i.test(word.text.replace(/[.)]+$/, "")) && word.bbox.x0 > width * 0.03).map((word) => word.bbox.x0);
  const left = starts.length >= 2 ? median(starts) - 25 : 0; const right = width * 0.935;
  return lines.map((line) => line.filter((word) => word.bbox.x0 >= left && word.bbox.x1 <= right).map((word) => word.text).join(" ")).filter(Boolean).join("\n");
}

export async function ocrImages(jobId: string, images: Array<{ page: number; image: Blob | HTMLCanvasElement }>, onProgress: (progress: OcrProgress) => void, pass: "a" | "b" = "a"): Promise<Record<string, string>> {
  const total = images.length; const poolSize = Math.min(navigator.hardwareConcurrency || 2, 4); let cursor = 0; let done = 0;
  const workers: Worker[] = await Promise.all(Array.from({ length: Math.min(poolSize, total) }, async () => {
    const worker = await createWorker("eng", 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tesseract/lang",
      gzip: true,
    });
    await worker.setParameters({ tessedit_pageseg_mode: pass === "a" ? PSM.SINGLE_COLUMN : PSM.SINGLE_BLOCK });
    return worker;
  }));
  const result: Record<string, string> = {};
  await Promise.all(workers.map(async (worker) => {
    while (cursor < images.length) {
      const item = images[cursor++]; const recognized = await worker.recognize(item.image, {}, { text: true, hocr: false, tsv: false, blocks: false });
      const data = recognized.data as unknown as OcrData;
      const width = item.image instanceof HTMLCanvasElement ? item.image.width : Math.max(1, ...(data.words ?? []).map((word) => word.bbox.x1 / 0.935));
      const text = filterColumn(data, width) || data.text; result[String(item.page)] = text;
      await localDb.pageText.put({ id: `${jobId}:${pass}:${item.page}`, jobId, page: item.page, text, words: data.words, pass });
      done += 1; onProgress({ done, total, stage: `Recognising text (page ${done} of ${total})` });
    }
  }));
  await Promise.all(workers.map((worker) => worker.terminate()));
  return result;
}
