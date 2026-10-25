"use client";
/**
 * Keeps the uploaded document in memory (browser only, never uploaded) so the review
 * screen can show the ORIGINAL page next to an extracted question.
 */
type Renderer = (pageIndex: number) => Promise<HTMLCanvasElement>;

let renderer: Renderer | null = null;
let pageCount = 0;
const cache = new Map<number, string>();

export function setPageSource(render: Renderer | null, pages: number) {
  renderer = render; pageCount = pages; cache.clear();
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
