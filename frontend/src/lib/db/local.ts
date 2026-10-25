import Dexie, { type Table } from "dexie";
import type { ParsedQuestion } from "../pipeline/types";

export interface LocalExam { id: string; title: string; createdAt: number; mode: "mock" | "practice"; settings: { sessionMinutes: number; breakMinutes: number }; }
export interface StoredQuestion extends ParsedQuestion { examId: string; }
export interface PageText { id: string; jobId: string; page: number; text: string; words?: unknown; pass: "a" | "b"; }
export interface LocalAttempt { id: string; examId: string; state: string; startedAt: number; finishedAt?: number; sessionEndAt?: number; breakEndAt?: number; }
export interface StoredTelemetry { id: string; attemptId: string; questionKey: string; timeSpentMs: number; visits: number; clickHistory: string[]; selected?: string; flagged: boolean; }

class CfaLocalDb extends Dexie {
  exams!: Table<LocalExam, string>; questions!: Table<StoredQuestion, [string, string]>; pageText!: Table<PageText, string>; attempts!: Table<LocalAttempt, string>; telemetry!: Table<StoredTelemetry, string>;
  constructor() { super("cfa-simulator"); this.version(1).stores({ exams: "id,createdAt", questions: "[examId+id],examId,session,n", pageText: "id,jobId,[jobId+page]", attempts: "id,examId,startedAt", telemetry: "id,attemptId,[attemptId+questionKey]" }); }
}

export const localDb = new CfaLocalDb();

export async function storageUsage(): Promise<number | null> {
  return navigator.storage?.estimate ? (await navigator.storage.estimate()).usage ?? null : null;
}
