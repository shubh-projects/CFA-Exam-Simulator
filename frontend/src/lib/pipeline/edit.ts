import type { AnswerOption, ParsedQuestion } from "./types";

export type QuestionPatch = Partial<Pick<ParsedQuestion, "stem" | "A" | "B" | "C" | "correct">>;

/** Problems that would make a question unusable in an exam. Empty array = fine. */
export function questionProblems(q: ParsedQuestion): string[] {
  const out: string[] = [];
  if (q.stem.trim().length < 10) out.push("Question text is missing or very short.");
  (["A", "B", "C"] as AnswerOption[]).forEach((k) => { if (!q[k].trim()) out.push(`Option ${k} is empty.`); });
  if (!q.correct) out.push("No correct answer is selected.");
  return out;
}

/** Applies a user edit. The question is marked as checked only if it is now complete. */
export function applyEdit(q: ParsedQuestion, patch: QuestionPatch): ParsedQuestion {
  const next = { ...q, ...patch } as ParsedQuestion;
  const problems = questionProblems(next);
  return problems.length
    ? { ...next, status: "needs_review", reason: problems[0] }
    : { ...next, status: "ok", reason: "Checked by you" };
}

export function markChecked(q: ParsedQuestion): ParsedQuestion {
  const problems = questionProblems(q);
  return problems.length ? { ...q, status: "needs_review", reason: problems[0] } : { ...q, status: "ok", reason: "Checked by you" };
}
