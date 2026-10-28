import { HEADER, NOISE, marker } from "./parser";
import { acceptChain, ANSWER_HEAD } from "./practice";
import type { ParsedQuestion, QuestionCrop } from "./types";

/** One OCR line with its position (pixels of the image that was recognised). */
export interface LayoutLine { text: string; x0: number; y0: number; x1: number; y1: number; gaps?: number[]; h?: number; markerX0?: number; slope?: number; }
export interface PageLayout { width: number; height: number; lines: LayoutLine[]; angle?: number; }

const layouts = new Map<number, PageLayout>();
export function clearLayouts() { layouts.clear(); }
export const getLayouts = () => layouts;

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
const MAX_TILT = (6 * Math.PI) / 180;

/** Straightens a tilted scan: estimates the tilt from the text lines and rotates every line box by the opposite angle. */
export function straighten(layout: PageLayout): PageLayout {
  const slopes = layout.lines.map((l) => l.slope).filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (slopes.length < 3) return { ...layout, angle: 0 };
  const angle = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan(median(slopes))));
  if (Math.abs(angle) < 0.002) return { ...layout, angle: 0 };
  const cx = layout.width / 2; const cy = layout.height / 2; const cos = Math.cos(angle); const sin = Math.sin(angle);
  const rotate = (x: number, y: number): [number, number] => [cx + (x - cx) * cos + (y - cy) * sin, cy - (x - cx) * sin + (y - cy) * cos];
  const lines = layout.lines.map((l) => {
    const corners = [rotate(l.x0, l.y0), rotate(l.x1, l.y0), rotate(l.x0, l.y1), rotate(l.x1, l.y1)];
    const xs = corners.map((c) => c[0]); const ys = corners.map((c) => c[1]);
    return { ...l, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), markerX0: l.markerX0 === undefined ? undefined : rotate(l.markerX0, (l.y0 + l.y1) / 2)[0] };
  });
  return { ...layout, lines, angle };
}
export function setPageLayout(page: number, layout: PageLayout) { layouts.set(page, straighten(layout)); }

const isSkippable = (text: string) => HEADER.test(text) || /^\d{1,2}$/.test(text.trim()) || /^(?:\S{0,8}\s+)?Mock\s+Exa/i.test(text) || (NOISE.test(text) && text.replace(NOISE, "").trim() === "");

interface Entry { page: number; line: LayoutLine; width: number; height: number; angle: number; }
export type CropMode = { kind: "mock" } | { kind: "practice"; start: RegExp; strict: boolean; stop?: RegExp };

/** Cuts the region that follows entries[index] (the heading line) up to the next heading. */
function regionCrop(entries: Entry[], index: number, headings: Set<number>, maxHeight = 1, includeHead = false, padLeft = 0.008): QuestionCrop | null {
  const head = entries[index]; const region: Entry[] = includeHead ? [head] : []; // "12. Which of..." carries the question text on the numbered line itself
  for (let i = index + 1; i < entries.length && !headings.has(i); i += 1) if (!isSkippable(entries[i].line.text)) region.push(entries[i]);
  if (!region.length) return null;
  const left = head.line.markerX0 ?? head.line.x0;
  const body = region.filter((e) => e === head || e.line.x0 >= left - e.width * 0.02); // ignore bleed from the neighbouring page
  if (!body.length) return null;
  const segments: QuestionCrop["segments"] = [];
  body.forEach((e, k) => {
    const h = e.line.h ?? 20; const prev = body[k - 1]; const next = body[k + 1];
    const topGap = prev && prev.page === e.page ? e.line.y0 - prev.line.y1 : k === 0 && head.page === e.page && e !== head ? e.line.y0 - head.line.y1 : h;
    const botGap = next && next.page === e.page ? next.line.y0 - e.line.y1 : h;
    const y0 = Math.max(0, e.line.y0 - Math.max(2, Math.min(h * 0.4, topGap / 2))) / e.height;
    const y1 = Math.min(e.height, e.line.y1 + Math.max(2, Math.min(h * 0.4, botGap / 2))) / e.height;
    const last = segments[segments.length - 1];
    if (last && last.page === e.page) { last.y0 = Math.min(last.y0, y0); last.y1 = Math.max(last.y1, y1); } else segments.push({ page: e.page, y0, y1, angle: e.angle });
  });
  const total = segments.reduce((sum, s) => sum + (s.y1 - s.y0), 0); if (total > maxHeight) return null;
  const w = body[0].width;
  const x0 = Math.max(0, left / w - padLeft); const x1 = Math.min(0.965, Math.max(...body.map((e) => e.line.x1)) / w + 0.045); // table borders are not text, so leave room on the right
  return x1 - x0 < 0.15 ? null : { segments, x0, x1 };
}

function flatten(pages: number[], source: Map<number, PageLayout>, keep: (page: number) => boolean): Entry[] {
  const out: Entry[] = [];
  for (const page of pages) { if (!keep(page)) continue; const layout = source.get(page)!; for (const line of layout.lines) out.push({ page, line, width: layout.width, height: layout.height, angle: layout.angle ?? 0 }); }
  return out;
}

/**
 * Finds every question (heading "Question N" down to the next heading) and every answer-key entry on the scanned pages
 * and stores their positions, so the exam can show the question exactly as printed. Needs word positions from the local OCR.
 */
export function computeCrops(questions: ParsedQuestion[], source: Map<number, PageLayout> = layouts, mode: CropMode = { kind: "mock" }): ParsedQuestion[] {
  if (!source.size) return questions;
  const pages = [...source.keys()].sort((a, b) => a - b);
  const found = new Map<string, { crop?: QuestionCrop; keyCrop?: QuestionCrop }>();
  const put = (id: string, patch: { crop?: QuestionCrop; keyCrop?: QuestionCrop }) => found.set(id, { ...found.get(id), ...patch });

  if (mode.kind === "practice") {
    const entries = flatten(pages, source, () => true);
    const stopAt = mode.stop ? entries.findIndex((e) => mode.stop!.test(e.line.text.trim())) : -1;
    let usable = stopAt >= 0 ? entries.slice(0, stopAt) : entries;
    // the first page of the answer section starts with a title line ("... Practice Pack - Answers") that must not be cut into the last question
    if (stopAt >= 0) { const stopPage = entries[stopAt].page; const sharesPage = usable.some((e) => e.page === stopPage && mode.start.test(e.line.text.trim())); if (!sharesPage) while (usable.length && usable[usable.length - 1].page === stopPage) usable = usable.slice(0, -1); }
    const hits = usable.map((e, i) => ({ i, m: mode.start.exec(e.line.text.trim()) })).filter((h) => h.m);
    const ok = acceptChain(hits.map((h) => Number(h.m![1])), mode.strict); const accepted = hits.filter((_, k) => ok[k]);
    const headings = new Set(accepted.map((h) => h.i));
    accepted.forEach((h) => { const crop = regionCrop(usable, h.i, headings, 1, (h.m![2] ?? "").trim().length > 0, 0.03); if (crop) put(`1-${Number(h.m![1])}`, { crop }); });
    // printed answer-key entries ("Answer 12 of 106" down to the next one), so the review screen can show them when the letter could not be read
    if (stopAt >= 0) {
      const keyEntries = entries.slice(stopAt); const keyHeads = keyEntries.map((e, i) => ({ i, m: ANSWER_HEAD.exec(e.line.text.trim()) })).filter((h) => h.m); const keySet = new Set(keyHeads.map((h) => h.i));
      keyHeads.forEach((h) => { const crop = regionCrop(keyEntries, h.i, keySet, 0.9, true, 0.03); if (crop) put(`1-${Number(h.m![1])}`, { keyCrop: crop }); });
    }
  } else {
    const sectionOf = new Map<number, string>(); let current: string | null = null;
    for (const page of pages) {
      const text = source.get(page)!.lines.map((l) => l.text).join("\n"); const hit = HEADER.exec(text.slice(0, 300)) ?? HEADER.exec(text);
      if (hit) current = `${hit[1]}:${hit[2][0].toLowerCase()}`; if (current) sectionOf.set(page, current);
    }
    for (const key of new Set(sectionOf.values())) {
      const session = key[0]; const kind = key.endsWith(":q") ? "q" : "a"; const word = kind === "q" ? "Question" : "Answer";
      const entries = flatten(pages, source, (p) => sectionOf.get(p) === key); const re = marker(word);
      const headings = new Set(entries.map((e, i) => (re.test(e.line.text.trim()) ? i : -1)).filter((i) => i >= 0));
      for (const i of headings) { const m = re.exec(entries[i].line.text.trim())!; const crop = regionCrop(entries, i, headings, kind === "q" ? 1 : 0.2); if (crop) put(`${session}-${Number(m[1])}`, kind === "q" ? { crop } : { keyCrop: crop }); }
    }
  }
  return questions.map((q) => { const hit = found.get(q.id); return hit ? { ...q, ...hit, showImage: q.showImage ?? Boolean(hit.crop) } : q; });
}
