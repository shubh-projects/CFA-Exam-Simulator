import { describe, expect, it } from "vitest";
import { applyEdit, markChecked, questionProblems } from "../pipeline/edit";
import type { ParsedQuestion } from "../pipeline/types";

const base: ParsedQuestion = { id: "1-1", session: 1, n: 1, stem: "What is the period return over six months?", A: "-1.9%", B: "", C: "1.9%", correct: "A", status: "needs_review", reason: "One or more answer options could not be read.", sourcePage: 4, topic: "Quant" };

describe("review edits", () => {
  it("reports an empty option", () => expect(questionProblems(base)).toEqual(["Option B is empty."]));
  it("stays flagged while something is missing", () => expect(applyEdit(base, { stem: "Changed stem that is long enough" }).status).toBe("needs_review"));
  it("becomes ok once complete", () => { const fixed = applyEdit(base, { B: "0.9%" }); expect(fixed.status).toBe("ok"); expect(fixed.B).toBe("0.9%"); });
  it("requires a correct answer", () => expect(applyEdit({ ...base, B: "x" }, { correct: null }).status).toBe("needs_review"));
  it("markChecked refuses incomplete questions", () => expect(markChecked(base).status).toBe("needs_review"));
});
