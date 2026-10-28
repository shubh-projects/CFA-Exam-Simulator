import type { AnswerOption, ParsedQuestion } from "./types";

export type QuestionPatch = Partial<Pick<ParsedQuestion, "stem" | "A" | "B" | "C" | "correct">>;

/** Problems that would make a question unusable in an exam. Empty array = fine. */
export function questionProblems(q: ParsedQuestion): string[] {
  const out: string[] = [];
  if (q.showImage && q.crop) { if (!q.correct) out.push("No correct answer is selected."); return out; } // the picture shows the question, so only the key matters
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

/**
 * Decides what still needs checking, depending on how the question will be shown:
 * as the original picture (only the answer key matters) or as extracted text (options must be readable too).
 */
export function applyDisplayStatus(q: ParsedQuestion): ParsedQuestion {
  if (q.reason === "Checked by you") return q;
  const corrected = q.status === "corrected" && q.reason?.startsWith("Printed answer letter");
  const tidy = (next: ParsedQuestion["status"], reason?: string): ParsedQuestion => ({ ...q, status: next, reason });
  if (q.showImage && q.crop) {
    if (q.keyIssue) return tidy("needs_review", q.keyIssue);
    if (!q.correct) return tidy("needs_review", "No correct answer is selected.");
    return corrected ? tidy("corrected", q.reason) : tidy("ok");
  }
  if (q.optionsUnread) return tidy("needs_review", "One or more answer options could not be read.");
  if (q.keyIssue) return tidy("needs_review", q.keyIssue);
  return corrected ? tidy("corrected", q.reason) : tidy(q.status === "needs_review" && !q.reason ? "needs_review" : "ok");
}
