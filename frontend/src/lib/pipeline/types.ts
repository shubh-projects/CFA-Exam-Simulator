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
  keyPage?: number;
  topic: string;
  explanation?: string;
  /** Learning module (reading) inside the subject, taken from the Juice notes. */
  subtopic?: string;
  /** Where the whole question (text, table, options) sits on the scanned page(s). */
  crop?: QuestionCrop;
  /** Where the printed answer-key entry sits (used to double-check the key). */
  keyCrop?: QuestionCrop;
  /** Show the cropped scan instead of the extracted text in the exam. */
  showImage?: boolean;
  /** Set by the parser so the review screen can ignore unreadable option text when the image is used. */
  optionsUnread?: boolean;
  keyIssue?: string;
}

/** All numbers are fractions (0-1) of the page width/height, so they work at any render resolution. */
export interface QuestionCrop { segments: Array<{ page: number; y0: number; y1: number; angle?: number }>; x0: number; x1: number; }

export interface ParseResult {
  questions: ParsedQuestion[];
  inferredSessions: boolean;
}

export type OcrPages = Record<string, string>;
export interface OcrProgress { done: number; total: number; stage: string; }
