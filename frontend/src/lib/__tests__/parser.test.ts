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

describe("OCR damage tolerance (cases seen on the real scan)", () => {
  const pages = (q: string, a: string) => ({ "0": `Mock Exam 2 Session 2 - Questions\n${q}`, "1": `Mock Exam 2 Session 2 - Answers\n${a}` });

  it("reads options when OCR drops the dot after A (\"| A 1,102.\")", () => {
    const result = parseOcrPages(pages("Question 25\nIndex return table:\nYear Price Return\n1 4% 2%\n| A 1,102.\nB. 1,150.\nC. 1,155.", "Answer 25\nC. 1,155."));
    const q = result.questions[0];
    expect([q.A, q.B, q.C]).toEqual(["1,102.", "1,150.", "1,155."]);
    expect(q.correct).toBe("C"); expect(q.status).toBe("ok");
  });

  it("keeps a table row \"A 16% 60%\" in the stem when options are well formed", () => {
    const q = parseOcrPages(pages("Question 46\nPortfolio table\nA 16% 60%\nB 27% 40%\nA. -1.\nB. 0.\nC. 1.", "Answer 46\nC. 1.")).questions[0];
    expect([q.A, q.B, q.C]).toEqual(["-1.", "0.", "1."]); expect(q.stem).toContain("A 16% 60%");
  });

  it("reads an answer line where the dot after the letter was lost (\"C1.\")", () => {
    const q = parseOcrPages(pages("Question 46\nStem\nA. -1.\nB. 0.\nC. 1.", "Answer 46\nC1.")).questions[0];
    expect(q.correct).toBe("C"); expect(q.status).not.toBe("needs_review");
  });

  it("accepts the printed answer when junk follows the answer text", () => {
    const q = parseOcrPages(pages("Question 90\nStem\nA. -1.9%.\nB. -1.0%.\nC. -0.5%.", "Answer 90\nA. -1.9%. answef Questions")).questions[0];
    expect(q.correct).toBe("A"); expect(q.status).toBe("ok");
  });

  it("corrects a misprinted key letter from the answer text, keeping the minus sign", () => {
    const q = parseOcrPages(pages("Question 7\nStem\nA. -1.\nB. 0.\nC. 1.", "Answer 7\nA. 1.")).questions[0];
    expect(q.correct).toBe("C"); expect(q.status).toBe("corrected");
  });
});
