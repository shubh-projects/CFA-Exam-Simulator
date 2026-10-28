import { describe, expect, it } from "vitest";
import { acceptChain, parsePracticePages, solutionLetter } from "../pipeline/practice";

const body = (n: number, stem: string, a: string, b: string, c: string) => `Question ${n}\n${stem}\nA. ${a}\nB. ${b}\nC. ${c}`;

describe("acceptChain", () => {
  it("accepts 1,2,3 and rejects stray numbers (strict)", () => expect(acceptChain([1, 2, 7, 3, 4], true)).toEqual([true, true, false, true, true]));
  it("allows a small gap when not strict", () => expect(acceptChain([1, 2, 4, 5], false)).toEqual([true, true, true, true]));
});

describe("practice pack parser", () => {
  it("style 1: 'Question N' with an answer table at the end", () => {
    const pages = { "0": [body(1, "What is X?", "one", "two", "three"), body(2, "What is Y?", "four", "five", "six"), body(3, "What is Z?", "a1", "b1", "c1")].join("\n"), "1": "Answers\n1. B 2. C 3. A" };
    const r = parsePracticePages(pages, "Derivatives");
    expect(r.questions.map((x) => x.correct)).toEqual(["B", "C", "A"]); expect(r.questions[0].A).toBe("one"); expect(r.questions[0].topic).toBe("Derivatives"); expect(r.stop).toBeDefined();
  });
  it("style 3: '1.' numbering with inline 'Answer: B' and an explanation", () => {
    const text = ["1. What is X?", "A. one", "B. two", "C. three", "Answer: B", "Explanation: because two.", "2. What is Y?", "A. four", "B. five", "C. six", "Answer: C", "3. What is Z?", "A. a1", "B. b1", "C. c1", "Answer: A"].join("\n");
    const r = parsePracticePages({ "0": text }, "Economics");
    expect(r.questions.map((x) => x.correct)).toEqual(["B", "C", "A"]); expect(r.questions[0].explanation).toContain("because two"); expect(r.questions[0].C).toBe("three");
  });
  it("style 3 with an answer table at the end keeps the table out of the last option", () => {
    const text = ["1. What is X?", "A. one", "B. two", "C. three", "2. What is Y?", "A. four", "B. five", "C. six", "3. What is Z?", "A. a1", "B. b1", "C. c1", "Answers", "1. B   2. C   3. A"].join("\n");
    const r = parsePracticePages({ "0": text }, "Economics");
    expect(r.questions.map((x) => x.correct)).toEqual(["B", "C", "A"]); expect(r.questions[2].C).toBe("c1");
  });
  it("style 2: 'Q1.' numbering with a key like 'Q1: A'", () => {
    const text = ["Q1. What is X?", "A. one", "B. two", "C. three", "Q2. What is Y?", "A. four", "B. five", "C. six", "Q3. What is Z?", "A. a1", "B. b1", "C. c1", "Answer Key", "Q1: A", "Q2: B", "Q3: C"].join("\n");
    const r = parsePracticePages({ "0": text }, "Fixed Income");
    expect(r.questions.map((x) => x.correct)).toEqual(["A", "B", "C"]);
  });
  it("flags questions without any answer", () => {
    const r = parsePracticePages({ "0": [body(1, "What is X?", "o", "t", "h"), body(2, "Y?", "o", "t", "h"), body(3, "Z?", "o", "t", "h")].join("\n") }, "Economics");
    expect(r.questions.every((x) => x.status === "needs_review" && x.correct === null)).toBe(true);
  });
  it("drops repeated page headers and finds nothing in random text", () => {
    const pages: Record<string, string> = {}; for (let i = 0; i < 5; i += 1) pages[String(i)] = `Acme Prep Pack\n${body(i * 2 + 1, "S?", "a", "b", "c")}\n${body(i * 2 + 2, "S2?", "a", "b", "c")}\n${i + 1}`;
    const r = parsePracticePages(pages, "Economics"); expect(r.questions).toHaveLength(10); expect(r.questions[0].C).toBe("c");
    expect(parsePracticePages({ "0": "just some words\nno questions here" }, "Economics").questions).toHaveLength(0);
  });
});

describe("premium pack with 'Answer N of M' solutions", () => {
  it("reads the correct letter from the solutions", () => {
    const q = (n: number) => `Question ${n} of 4\nQuestion\nWhat is thing ${n}?\nA. one\nB. two\nC. three`;
    const a = (n: number, l: string) => `Answer ${n} of 4\nAnswer\nSolution\n` + ["A", "B", "C"].map((x) => `${x}. ${x === l ? "Correct" : "Incorrect"} because x.`).join("\n");
    const r = parsePracticePages({ "0": `${q(1)}\n${q(2)}`, "1": `${q(3)}\n${q(4)}`, "2": `${a(1, "B")}\n${a(2, "C")}`, "3": `${a(3, "A")}\n${a(4, "B")}` }, "Fixed Income");
    expect(r.questions.map((x) => [x.session, x.correct])).toEqual([[1, "B"], [1, "C"], [1, "A"], [1, "B"]]);
  });
});

describe("scanned premium packs (OCR damage)", () => {
  it("reads the answer from the Incorrect/Correct order even when labels are garbled", () => {
    expect(solutionLetter(["A. Incorrect because a bond is callable.", "B. Incurrect because a step-up note rises.", "Cc. Correct. A sinking fund provision requires retirement."])).toBe("C");
    expect(solutionLetter(["A. Incorrect because the opposite is true.", "B: Incorrect because it ignores convexity.", "Cc. Correct because the change is greater."])).toBe("C");
    expect(solutionLetter(["A. Correct because duration is essential.", "B. Incorrect because a callable bond has no IRR. The correct formula is different.", "C. Incorrect because it measures the curve."])).toBe("A");
  });
  it("accepts a heading where OCR lost the word Question", () => {
    const page = ["Question 1 of 10", "Question", "First stem here", "A. a", "B. b", "C. c", "2 of 10", "Question", "Second stem here", "A. a", "B. b", "C. c", "Question 3 of 10", "Question", "Third stem here", "A. a", "B. b", "C. c"].join("\n");
    expect(parsePracticePages({ "0": page }, "Fixed Income").questions.map((x) => x.n)).toEqual([1, 2, 3]);
  });
});
