import type { AnswerOption, ExamQuestion, QuestionTelemetry } from "../store/useExamStore";

export type ResultQuestion = ExamQuestion & {
  session_number?: number; topic?: string; subtopic?: string; stem?: string; correct_option?: string; correct?: string | null; explanation?: string | null;
  A?: string; B?: string; C?: string; crop?: unknown; showImage?: boolean;
};
export type AnswerStatus = "correct" | "incorrect" | "unanswered" | "not-scored";

export interface QuestionResult {
  question: ResultQuestion; index: number; session: 1 | 2; topic: string; subtopic: string;
  selectedOption?: AnswerOption; correctOption: AnswerOption | null; status: AnswerStatus; isFlg: boolean; timeSpentMs: number; switchHistory: AnswerOption[];
}
export interface Metrics { total: number; correct: number; incorrect: number; unanswered: number; "not-scored": number; timeSpentMs: number; }
export interface TopicMetrics extends Metrics { topic: string; modules: Array<Metrics & { name: string }>; }
export interface Analysis {
  results: QuestionResult[]; sessions: Map<1 | 2, Metrics>; topics: TopicMetrics[];
  pacing: { fastAccurate: number; timeSinks: number; rushedErrors: number; grindWins: number };
  switches: { wrongToRight: number; rightToWrong: number; wrongToWrong: number };
  totalCorrect: number; scored: number; scorePercentage: number; averageTimeMs: number; totalTimeMs: number;
}

const EMPTY: QuestionTelemetry = { timeSpentMs: 0, switchHistory: [] };
export const emptyMetrics = (): Metrics => ({ total: 0, correct: 0, incorrect: 0, unanswered: 0, "not-scored": 0, timeSpentMs: 0 });
const add = (m: Metrics, r: QuestionResult) => { m.total += 1; m.timeSpentMs += r.timeSpentMs; m[r.status] += 1; };
export function normalizeOption(value: unknown): AnswerOption | null { const o = String(value ?? "").trim().toUpperCase(); return o === "A" || o === "B" || o === "C" ? o : null; }
export const percent = (m: { correct: number; total: number }) => (m.total === 0 ? 0 : Math.round((m.correct / m.total) * 100));
export function formatDuration(ms: number): string { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

export function analyze(examData: ResultQuestion[], answers: Record<string, AnswerOption>, flags: Record<string, boolean>, telemetry: Record<string, QuestionTelemetry>): Analysis {
  const results = examData.map<QuestionResult>((question, index) => {
    const selectedOption = answers[question.id]; const correctOption = normalizeOption(question.correct_option ?? question.correct); const t = telemetry[question.id] ?? EMPTY;
    const status: AnswerStatus = !correctOption ? "not-scored" : !selectedOption ? "unanswered" : selectedOption === correctOption ? "correct" : "incorrect";
    return { question, index, session: question.session_number === 2 || question.session === 2 ? 2 : 1, topic: question.topic?.trim() || "Uncategorized", subtopic: question.subtopic?.trim() || "", selectedOption, correctOption, status, isFlg: Boolean(flags[question.id]), timeSpentMs: t.timeSpentMs, switchHistory: t.switchHistory };
  });
  const sessions = new Map<1 | 2, Metrics>([[1, emptyMetrics()], [2, emptyMetrics()]]);
  const topicMap = new Map<string, TopicMetrics & { mods: Map<string, Metrics & { name: string }> }>();
  const pacing = { fastAccurate: 0, timeSinks: 0, rushedErrors: 0, grindWins: 0 }; const switches = { wrongToRight: 0, rightToWrong: 0, wrongToWrong: 0 };
  for (const r of results) {
    add(sessions.get(r.session)!, r);
    const topic = topicMap.get(r.topic) ?? { topic: r.topic, ...emptyMetrics(), modules: [], mods: new Map() }; add(topic, r); topicMap.set(r.topic, topic);
    const name = r.subtopic || "(module not identified)"; const mod = topic.mods.get(name) ?? { name, ...emptyMetrics() }; add(mod, r); topic.mods.set(name, mod);
    const sec = r.timeSpentMs / 1000;
    if (r.status === "correct" && sec < 65) pacing.fastAccurate += 1; if (r.status === "incorrect" && sec > 110) pacing.timeSinks += 1;
    if (r.status === "incorrect" && sec < 30) pacing.rushedErrors += 1; if (r.status === "correct" && sec > 110) pacing.grindWins += 1;
    if (!r.correctOption) continue;
    for (let i = 1; i < r.switchHistory.length; i += 1) {
      const prev = r.switchHistory[i - 1]; const cur = r.switchHistory[i]; if (prev === cur) continue;
      const wasRight = prev === r.correctOption; const isRight = cur === r.correctOption;
      if (!wasRight && isRight) switches.wrongToRight += 1; else if (wasRight && !isRight) switches.rightToWrong += 1; else if (!wasRight && !isRight) switches.wrongToWrong += 1;
    }
  }
  const topics = [...topicMap.values()].map(({ mods, ...t }) => ({ ...t, modules: [...mods.values()].sort((a, b) => percent(a) - percent(b) || b.total - a.total) })).sort((a, b) => a.topic.localeCompare(b.topic));
  const totalCorrect = results.filter((r) => r.status === "correct").length; const scored = results.filter((r) => r.status !== "not-scored").length;
  const totalTimeMs = results.reduce((s, r) => s + r.timeSpentMs, 0);
  return { results, sessions, topics, pacing, switches, totalCorrect, scored, scorePercentage: scored === 0 ? 0 : Math.round((totalCorrect / scored) * 100), averageTimeMs: results.length ? totalTimeMs / results.length : 0, totalTimeMs };
}

/** The weakest learning modules (at least `min` questions), lowest score first. */
export function weakestModules(a: Analysis, limit = 5, min = 2) {
  return a.topics.flatMap((t) => t.modules.filter((m) => m.name !== "(module not identified)" && m.total >= min).map((m) => ({ topic: t.topic, ...m }))).sort((x, y) => percent(x) - percent(y) || y.total - x.total).slice(0, limit);
}
