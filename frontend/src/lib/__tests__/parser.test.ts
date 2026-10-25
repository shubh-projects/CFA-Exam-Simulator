import { describe, expect, it } from "vitest";
import passA from "./fixtures/ocr_pass_a.json";
import passB from "./fixtures/ocr_pass_b.json";
import golden from "./fixtures/exam_mock2_parsed.json";
import { mergePasses } from "../pipeline/merge";
import { parseOcrPages, similarity } from "../pipeline/parser";

describe("CFA mock parser", () => {
  it("merges the supplied OCR passes into complete questions", () => {
    const merged = mergePasses(parseOcrPages(passA).questions, parseOcrPages(passB).questions);
    expect(merged).toHaveLength(180);
    expect(merged.filter((question) => question.session === 1)).toHaveLength(90);
    expect(merged.filter((question) => question.session === 2)).toHaveLength(90);
    expect(merged.every((question) => question.A && question.B && question.C)).toBe(true);
    const expected = golden as Array<{ session: number; n: number; correct: string }>;
    const mismatches = expected.filter((answer) => merged.find((question) => question.session === answer.session && question.n === answer.n)?.correct !== answer.correct);
    expect(mismatches, JSON.stringify(mismatches)).toEqual([]);
  });

  it("handles marker and option OCR variants without losing minus signs", () => {
    const input = { "0": "Session 1 - Questions\nthe Question 11\nValue?\na, one\ng. -1.\nc.5. three", "1": "Session 1 - Answers\n‘Answer 11\nB. -1." };
    const question = parseOcrPages(input).questions[0];
    expect(question.A).toBe("one"); expect(question.B).toContain("-1."); expect(question.C).toContain("three"); expect(question.correct).toBe("B");
    expect(similarity("-1.", "1.")).toBeLessThan(1);
  });
});
