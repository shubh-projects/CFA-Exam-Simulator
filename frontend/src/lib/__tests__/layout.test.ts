import { describe, expect, it } from "vitest";
import { computeCrops, straighten, type LayoutLine, type PageLayout } from "../pipeline/layout";
import type { ParsedQuestion } from "../pipeline/types";

const line = (text: string, y0: number, o: Partial<LayoutLine> = {}): LayoutLine => ({ text, x0: 100, x1: 900, y0, y1: y0 + 30, h: 30, gaps: [], ...o });
const q = (n: number, session: 1 | 2 = 1): ParsedQuestion => ({ id: `${session}-${n}`, session, n, stem: "s", A: "a", B: "b", C: "c", correct: "A", status: "ok", sourcePage: 0, topic: "x" });

describe("question crops", () => {
  const page: PageLayout = { width: 1000, height: 2000, lines: [
    line("Session 1 - Questions", 50),
    line("Question 1", 100, { markerX0: 100 }), line("What is the return?", 140), line("A. 1%", 180), line("B. 2%", 220), line("C. 3%", 260),
    line("Question 2", 400, { markerX0: 100 }), line("An analyst gathers:", 440), line("Original cost 12", 480, { gaps: [400] }), line("A. one", 620), line("B. two", 660), line("C. three", 700),
  ] };
  const out = computeCrops([q(1), q(2)], new Map([[0, page]]));
  it("covers the text and all options, but not the heading or the next question", () => {
    const s = out[0].crop!.segments[0];
    expect(s.y0).toBeGreaterThan(130 / 2000); expect(s.y0).toBeLessThan(141 / 2000);
    expect(s.y1).toBeGreaterThan(290 / 2000); expect(s.y1).toBeLessThan(400 / 2000);
  });
  it("shows the image by default when a crop exists", () => { expect(out[0].showImage).toBe(true); expect(out[1].crop!.segments[0].y1).toBeGreaterThan(730 / 2000); });
  it("ignores the page header line and joins a question across two pages", () => {
    const p1: PageLayout = { width: 1000, height: 2000, lines: [line("Session 1 - Questions", 50), line("Question 5", 1800, { markerX0: 100 }), line("Table follows:", 1840)] };
    const p2: PageLayout = { width: 1000, height: 2000, lines: [line("Session 1 - Questions", 50), line("Row 1 12", 100), line("A. x", 200), line("B. y", 240), line("C. z", 280)] };
    const c = computeCrops([q(5)], new Map([[0, p1], [1, p2]]))[0].crop!;
    expect(c.segments.map((s) => s.page)).toEqual([0, 1]); expect(c.segments[1].y0).toBeGreaterThan(82 / 2000);
  });
  it("crops the answer-key entry too", () => {
    const keyPage: PageLayout = { width: 1000, height: 2000, lines: [line("Session 1 - Answers", 50), line("Answer 1", 100, { markerX0: 100 }), line("B. 2%", 140), line("Answer 2", 200, { markerX0: 100 }), line("C. 3", 240)] };
    const r = computeCrops([q(1), q(2)], new Map([[0, page], [1, keyPage]]));
    expect(r[0].keyCrop!.segments[0].page).toBe(1); expect(r[1].keyCrop).toBeDefined();
  });
  it("ignores words that bleed in from the neighbouring page on the left", () => {
    const bleed: PageLayout = { width: 1000, height: 2000, lines: [line("Session 1 - Questions", 50), line("Question 7", 100, { markerX0: 300, x0: 300 }), line("Stem text", 140, { x0: 300 }), line("ng", 180, { x0: 20, x1: 60 }), line("A. a", 220, { x0: 300 }), line("B. b", 260, { x0: 300 }), line("C. c", 300, { x0: 300 })] };
    expect(computeCrops([q(7)], new Map([[0, bleed]]))[0].crop!.x0).toBeGreaterThan(0.28);
  });
  it("leaves questions alone when no layout exists", () => expect(computeCrops([q(1)], new Map())[0].crop).toBeUndefined());
});

describe("tilted scans", () => {
  it("estimates the tilt from the text lines and levels them", () => {
    const tilt = 0.02; // 1.1 degrees: right end of each line sits lower
    const lines = [0, 1, 2, 3].map((i) => line(`line ${i}`, 200 + i * 100, { x0: 100, x1: 900, y0: 200 + i * 100, y1: 230 + i * 100, slope: tilt }));
    const out = straighten({ width: 1000, height: 2000, lines });
    expect(out.angle).toBeCloseTo(Math.atan(tilt), 3);
  });
  it("does nothing when the page is already straight", () => expect(straighten({ width: 1000, height: 2000, lines: [line("a", 10, { slope: 0 }), line("b", 60, { slope: 0 }), line("c", 110, { slope: 0 })] }).angle).toBe(0));
});

describe("practice numbering", () => {
  const page: PageLayout = { width: 1000, height: 2000, lines: [
    line("1. What is the return?", 100, { markerX0: undefined }), line("A. 1%", 140), line("B. 2%", 180), line("C. 3%", 220),
    line("2. Which is true?", 300), line("A. x", 340), line("B. y", 380), line("C. z", 420),
    line("Answers", 600), line("1. B 2. C", 640),
  ] };
  it("uses the numbered lines as headings and stops at the answer key", () => {
    const r = computeCrops([{ ...q(1) }, { ...q(2) }], new Map([[0, page]]), { kind: "practice", start: /^\W{0,2}(\d{1,3})\s*[.)]\s+(\S.*)$/, strict: true, stop: /^\W*answers?\W*$/i });
    expect(r[0].crop!.segments[0].y0).toBeLessThan(100 / 2000); // includes the numbered line that holds the question text
    expect(r[0].crop!.segments[0].y1).toBeLessThan(300 / 2000); expect(r[1].crop!.segments[0].y1).toBeLessThan(600 / 2000);
  });
});
