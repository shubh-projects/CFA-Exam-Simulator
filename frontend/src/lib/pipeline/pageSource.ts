"use client";
/**
 * Keeps the uploaded document in memory (browser only, never uploaded) so the review
 * screen can show the ORIGINAL page next to an extracted question.
 */
import type { QuestionCrop } from "./types";
type Renderer = (pageIndex: number, dpi?: number) => Promise<HTMLCanvasElement>;

let renderer: Renderer | null = null;
let pageCount = 0;
const cache = new Map<number, string>();
const regionCache = new Map<string, string>();

export function setPageSource(render: Renderer | null, pages: number) {
  renderer = render; pageCount = pages; cache.clear(); regionCache.clear();
}
export const hasPageSource = () => renderer !== null;
export const getPageCount = () => pageCount;

/** Renders one page to a JPEG data URL (cached). pageIndex is 0-based. */
export async function getPageImage(pageIndex: number): Promise<string | null> {
  if (!renderer || pageIndex < 0 || pageIndex >= pageCount) return null;
  const hit = cache.get(pageIndex); if (hit) return hit;
  const canvas = await renderer(pageIndex);
  const url = canvas.toDataURL("image/jpeg", 0.8);
  canvas.width = 0; canvas.height = 0; // free memory
  cache.set(pageIndex, url);
  return url;
}

const CROP_DPI = 170;
const cropKey = (crop: QuestionCrop) => JSON.stringify(crop);

/** Draws one page segment (rotated by the page's tilt) into a new canvas. */
async function cutSegment(page: HTMLCanvasElement, crop: QuestionCrop, segment: QuestionCrop["segments"][number]): Promise<HTMLCanvasElement> {
  const sx = Math.floor(crop.x0 * page.width); const sw = Math.max(1, Math.ceil((crop.x1 - crop.x0) * page.width));
  const sy = Math.floor(segment.y0 * page.height); const sh = Math.max(1, Math.ceil((segment.y1 - segment.y0) * page.height));
  const part = document.createElement("canvas"); part.width = sw; part.height = sh;
  const ctx = part.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, sw, sh);
  ctx.translate(-sx, -sy);
  if (segment.angle) { ctx.translate(page.width / 2, page.height / 2); ctx.rotate(-segment.angle); ctx.translate(-page.width / 2, -page.height / 2); }
  ctx.drawImage(page, 0, 0);
  return part;
}

function stitch(parts: HTMLCanvasElement[]): string {
  const out = document.createElement("canvas"); out.width = Math.max(...parts.map((c) => c.width)); out.height = parts.reduce((sum, c) => sum + c.height, 0);
  const ctx = out.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, out.width, out.height);
  let y = 0; for (const part of parts) { ctx.drawImage(part, 0, y); y += part.height; }
  return out.toDataURL("image/jpeg", 0.85);
}

/** Cuts a question (or answer-key entry) out of the scanned page(s) at a readable resolution. Returns a JPEG data URL. */
export async function getRegionImage(crop: QuestionCrop): Promise<string | null> {
  if (!renderer) return null;
  const key = cropKey(crop); const hit = regionCache.get(key); if (hit) return hit;
  const parts: HTMLCanvasElement[] = [];
  for (const segment of crop.segments) {
    if (segment.page < 0 || segment.page >= pageCount) continue;
    const page = await renderer(segment.page, CROP_DPI);
    parts.push(await cutSegment(page, crop, segment)); page.width = 0; page.height = 0;
  }
  if (!parts.length) return null;
  const url = stitch(parts); regionCache.set(key, url); return url;
}

/**
 * Renders every needed page ONCE and cuts all questions out of it, so the exam never waits.
 * (Calling getRegionImage per question would render each page many times.)
 */
export async function prepareRegions(crops: QuestionCrop[], onProgress?: (done: number, total: number) => void): Promise<void> {
  if (!renderer) return;
  const todo = crops.filter((c) => !regionCache.has(cropKey(c))); if (!todo.length) { onProgress?.(crops.length, crops.length); return; }
  const lastPage = new Map<string, number>(); const parts = new Map<string, HTMLCanvasElement[]>();
  todo.forEach((c) => lastPage.set(cropKey(c), Math.max(...c.segments.map((s) => s.page))));
  const pages = [...new Set(todo.flatMap((c) => c.segments.map((s) => s.page)))].filter((p) => p >= 0 && p < pageCount).sort((a, b) => a - b);
  let done = 0;
  for (const pageIndex of pages) {
    const canvas = await renderer(pageIndex, CROP_DPI);
    for (const crop of todo) {
      const key = cropKey(crop); if (regionCache.has(key)) continue;
      for (const segment of crop.segments) if (segment.page === pageIndex) parts.set(key, [...(parts.get(key) ?? []), await cutSegment(canvas, crop, segment)]);
      if (lastPage.get(key) === pageIndex) { const got = parts.get(key); if (got?.length) regionCache.set(key, stitch(got)); parts.delete(key); done += 1; }
    }
    canvas.width = 0; canvas.height = 0; onProgress?.(Math.min(done, todo.length), todo.length);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the page breathe
  }
}
export const isRegionReady = (crop: QuestionCrop) => regionCache.has(cropKey(crop));
