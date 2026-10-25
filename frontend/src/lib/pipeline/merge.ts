import type { ParsedQuestion } from "./types";

export function candidateScore(question: ParsedQuestion): number {
  return [question.A, question.B, question.C].filter(Boolean).length * 2 + (question.correct ? 3 : 0) + (question.stem.length > 15 ? 1 : 0) - [question.A, question.B, question.C].filter((option) => option && option.length < 2).length - (question.status === "needs_review" ? 2 : 0);
}

export function mergePasses(...passes: ParsedQuestion[][]): ParsedQuestion[] {
  const candidates = new Map<string, ParsedQuestion[]>();
  passes.flat().forEach((question) => { const key = `${question.session}:${question.n}`; candidates.set(key, [...(candidates.get(key) ?? []), question]); });
  return [...candidates.values()].map((items) => items.sort((a, b) => candidateScore(b) - candidateScore(a))[0]).sort((a, b) => a.session - b.session || a.n - b.n);
}
