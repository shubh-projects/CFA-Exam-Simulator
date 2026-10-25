export type QuestionStatus = "ok" | "corrected" | "needs_review";
export type AnswerOption = "A" | "B" | "C";

export interface ParsedQuestion {
  id: string;
  session: 1 | 2;
  n: number;
  stem: string;
  A: string;
  B: string;
  C: string;
  correct: AnswerOption | null;
  status: QuestionStatus;
  reason?: string;
  sourcePage: number;
  topic: string;
  explanation?: string;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  inferredSessions: boolean;
}

export type OcrPages = Record<string, string>;
export interface OcrProgress { done: number; total: number; stage: string; }
