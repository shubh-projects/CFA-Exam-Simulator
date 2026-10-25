import type { ParsedQuestion } from "./types";

export function validateExam(questions: ParsedQuestion[], expectedPerSession = 90) {
  const summary = ([1, 2] as const).map((session) => { const found = questions.filter((question) => question.session === session); return { session, found: found.length, expected: expectedPerSession, missing: Array.from({ length: expectedPerSession }, (_, index) => index + 1).filter((n) => !found.some((question) => question.n === n)) }; });
  return { sessions: summary, needsReview: questions.filter((question) => question.status === "needs_review").map((question) => question.id), corrected: questions.filter((question) => question.status === "corrected").length };
}
