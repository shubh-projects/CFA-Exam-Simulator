"use client";

import { useState, type CSSProperties } from "react";
import {
  Award,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Flag,
  Repeat2,
  Target,
  XCircle,
} from "lucide-react";

import type { AnswerOption, ExamQuestion, QuestionTelemetry } from "../store/useExamStore";
import { useExamStore } from "../store/useExamStore";

type ResultQuestion = ExamQuestion & {
  session?: number;
  session_number?: number;
  topic?: string;
  stem?: string;
  correct_option?: string;
  correct?: string | null;
  explanation?: string | null;
};

type AnswerStatus = "correct" | "incorrect" | "unanswered" | "not-scored";
type ReviewFilter = "all" | AnswerStatus | "flagged";
type SessionFilter = "both" | 1 | 2;

interface QuestionResult {
  question: ResultQuestion;
  session: 1 | 2;
  topic: string;
  selectedOption?: AnswerOption;
  correctOption: AnswerOption | null;
  status: AnswerStatus;
  isFlg: boolean;
  timeSpentMs: number;
  switchHistory: AnswerOption[];
}

interface SessionMetrics {
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  "not-scored": number;
  timeSpentMs: number;
}

interface TopicMetrics extends SessionMetrics {
  topic: string;
}

interface SwitchMetrics {
  wrongToRight: number;
  rightToWrong: number;
  wrongToWrong: number;
}

const EMPTY_TELEMETRY: QuestionTelemetry = { timeSpentMs: 0, switchHistory: [] };

function normalizeOption(value: unknown): AnswerOption | null {
  const option = String(value ?? "").trim().toUpperCase();
  return option === "A" || option === "B" || option === "C" ? option : null;
}

function questionSession(question: ResultQuestion): 1 | 2 {
  return question.session_number === 2 || question.session === 2 ? 2 : 1;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function emptySessionMetrics(): SessionMetrics {
  return { total: 0, correct: 0, incorrect: 0, unanswered: 0, "not-scored": 0, timeSpentMs: 0 };
}

function addQuestionToMetrics(metrics: SessionMetrics, result: QuestionResult): void {
  metrics.total += 1;
  metrics.timeSpentMs += result.timeSpentMs;
  metrics[result.status] += 1;
}

function ScoreRing({ percentage }: { percentage: number }) {
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percentage / 100);
  const isPass = percentage >= 70;

  return (
    <div className="relative grid h-48 w-48 place-items-center">
      <svg viewBox="0 0 144 144" className="h-full w-full -rotate-90" aria-label={`${percentage}% correct`}>
        <circle cx="72" cy="72" r={radius} fill="none" stroke="currentColor" strokeWidth="12" className="text-slate-200" />
        <circle
          cx="72"
          cy="72"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={isPass ? "text-emerald-500" : "text-amber-500"}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-3xl font-bold tracking-tight text-slate-950">{percentage}%</p>
        <p className={`mt-1 text-xs font-bold uppercase tracking-wider ${isPass ? "text-emerald-600" : "text-amber-600"}`}>
          {isPass ? "Pass" : "Needs Work"}
        </p>
      </div>
    </div>
  );
}

function MetricCard({ title, count, description, tone }: {
  title: string;
  count: number;
  description: string;
  tone: string;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className={`text-xs font-bold uppercase tracking-wider ${tone}`}>{title}</p>
      <p className="mt-2 text-3xl font-bold text-slate-950">{count}</p>
      <p className="mt-2 text-sm leading-5 text-slate-500">{description}</p>
    </article>
  );
}

export function ResultsDashboard() {
  const { examData, answers, flags, telemetry } = useExamStore();
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("both");

  const results = (examData as ResultQuestion[]).map<QuestionResult>((question) => {
    const selectedOption = answers[question.id];
    const correctOption = normalizeOption(question.correct_option ?? question.correct);
    const questionTelemetry = telemetry[question.id] ?? EMPTY_TELEMETRY;
    const status: AnswerStatus = !correctOption
      ? "not-scored"
      : !selectedOption
      ? "unanswered"
      : selectedOption === correctOption
        ? "correct"
        : "incorrect";

    return {
      question,
      session: questionSession(question),
      topic: question.topic?.trim() || "Uncategorized",
      selectedOption,
      correctOption,
      status,
      isFlg: Boolean(flags[question.id]),
      timeSpentMs: questionTelemetry.timeSpentMs,
      switchHistory: questionTelemetry.switchHistory,
    };
  });

  const sessionMetrics = new Map<1 | 2, SessionMetrics>([
    [1, emptySessionMetrics()],
    [2, emptySessionMetrics()],
  ]);
  const topicMetrics = new Map<string, TopicMetrics>();
  const pacing = { fastAccurate: 0, timeSinks: 0, rushedErrors: 0, grindWins: 0 };
  const switches: SwitchMetrics = { wrongToRight: 0, rightToWrong: 0, wrongToWrong: 0 };

  for (const result of results) {
    addQuestionToMetrics(sessionMetrics.get(result.session)!, result);

    const topic = topicMetrics.get(result.topic) ?? {
      topic: result.topic,
      ...emptySessionMetrics(),
    };
    addQuestionToMetrics(topic, result);
    topicMetrics.set(result.topic, topic);

    const seconds = result.timeSpentMs / 1_000;
    if (result.status === "correct" && seconds < 65) pacing.fastAccurate += 1;
    if (result.status === "incorrect" && seconds > 110) pacing.timeSinks += 1;
    if (result.status === "incorrect" && seconds < 30) pacing.rushedErrors += 1;
    if (result.status === "correct" && seconds > 110) pacing.grindWins += 1;

    if (!result.correctOption) continue;
    for (let index = 1; index < result.switchHistory.length; index += 1) {
      const previous = result.switchHistory[index - 1];
      const current = result.switchHistory[index];
      if (previous === current) continue;

      const wasCorrect = previous === result.correctOption;
      const isCorrect = current === result.correctOption;
      if (!wasCorrect && isCorrect) switches.wrongToRight += 1;
      else if (wasCorrect && !isCorrect) switches.rightToWrong += 1;
      else if (!wasCorrect && !isCorrect) switches.wrongToWrong += 1;
    }
  }

  const totalCorrect = results.filter((result) => result.status === "correct").length;
  const scoredQuestionCount = results.filter((result) => result.status !== "not-scored").length;
  const scorePercentage = scoredQuestionCount === 0 ? 0 : Math.round((totalCorrect / scoredQuestionCount) * 100);
  const averageTimeMs = results.length === 0
    ? 0
    : results.reduce((sum, result) => sum + result.timeSpentMs, 0) / results.length;
  const sortedTopics = [...topicMetrics.values()].sort((left, right) => left.topic.localeCompare(right.topic));
  const filteredResults = results.filter((result) => {
    const matchesSession = sessionFilter === "both" || result.session === sessionFilter;
    const matchesReview = reviewFilter === "all" || (reviewFilter === "flagged" ? result.isFlg : result.status === reviewFilter);
    return matchesSession && matchesReview;
  });

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-7 text-slate-900 sm:px-7 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-7">
        <header className="flex flex-col justify-between gap-5 rounded-2xl bg-slate-950 px-6 py-7 text-white shadow-lg sm:flex-row sm:items-center sm:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Exam results</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Performance Dashboard</h1>
            <p className="mt-2 text-sm text-slate-300">{results.length} questions analyzed · Average pacing {formatDuration(averageTimeMs)} per question</p>
          </div>
          <ScoreRing percentage={scorePercentage} />
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-2">
            <Target className="text-blue-700" size={21} />
            <h2 className="text-lg font-bold">Session Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-bold">Session</th>
                  <th className="px-3 py-3 font-bold">Total Questions</th>
                  <th className="px-3 py-3 font-bold">Correct</th>
                  <th className="px-3 py-3 font-bold">Incorrect</th>
                  <th className="px-3 py-3 font-bold">Unanswered</th>
                  <th className="px-3 py-3 font-bold">Total Time Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {([1, 2] as const).map((session) => {
                  const metrics = sessionMetrics.get(session)!;
                  return (
                    <tr key={session} className="text-slate-700">
                      <td className="px-3 py-4 font-semibold text-slate-950">Session {session}</td>
                      <td className="px-3 py-4">{metrics.total}</td>
                      <td className="px-3 py-4 font-semibold text-emerald-700">{metrics.correct}</td>
                      <td className="px-3 py-4 font-semibold text-red-700">{metrics.incorrect}</td>
                      <td className="px-3 py-4 text-slate-500">{metrics.unanswered}</td>
                      <td className="px-3 py-4 font-mono">{formatDuration(metrics.timeSpentMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <Clock3 className="text-blue-700" size={21} />
            <h2 className="text-lg font-bold">Pacing Matrix</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Fast & Accurate" count={pacing.fastAccurate} description="Correct answers completed in under 65 seconds." tone="text-emerald-600" />
            <MetricCard title="Time Sinks" count={pacing.timeSinks} description="Incorrect answers taking over 110 seconds." tone="text-red-600" />
            <MetricCard title="Rushed Errors" count={pacing.rushedErrors} description="Incorrect answers submitted in under 30 seconds." tone="text-amber-600" />
            <MetricCard title="Grind Wins" count={pacing.grindWins} description="Correct answers earned after over 110 seconds." tone="text-blue-600" />
          </div>
        </section>

        <section className="grid gap-7 lg:grid-cols-[0.9fr_1.1fr]">
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-center gap-2">
              <Repeat2 className="text-blue-700" size={21} />
              <h2 className="text-lg font-bold">Answer-Switch Tracker</h2>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-emerald-50 p-4">
                <p className="text-2xl font-bold text-emerald-700">{switches.wrongToRight}</p>
                <p className="mt-1 text-xs font-semibold leading-4 text-emerald-800">Wrong → Right</p>
              </div>
              <div className="rounded-lg bg-red-50 p-4">
                <p className="text-2xl font-bold text-red-700">{switches.rightToWrong}</p>
                <p className="mt-1 text-xs font-semibold leading-4 text-red-800">Right → Wrong</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-4">
                <p className="text-2xl font-bold text-amber-700">{switches.wrongToWrong}</p>
                <p className="mt-1 text-xs font-semibold leading-4 text-amber-800">Wrong → Wrong</p>
              </div>
            </div>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-center gap-2">
              <Award className="text-blue-700" size={21} />
              <h2 className="text-lg font-bold">Topic Performance</h2>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="py-3 pr-3">Topic</th><th className="py-3 pr-3">Score</th><th className="py-3">Progress</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedTopics.map((topic) => {
                    const percentage = topic.total === 0 ? 0 : Math.round((topic.correct / topic.total) * 100);
                    const progressStyle = { "--progress": `${percentage}%` } as CSSProperties;
                    return (
                      <tr key={topic.topic}>
                        <td className="py-3 pr-3 font-medium text-slate-800">{topic.topic}</td>
                        <td className="py-3 pr-3 font-semibold text-slate-700">{percentage}% <span className="font-normal text-slate-400">({topic.correct}/{topic.total})</span></td>
                        <td className="py-3"><div className="h-2 w-32 overflow-hidden rounded-full bg-slate-200"><div style={progressStyle} className="h-full w-[var(--progress)] rounded-full bg-blue-600" /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-2">
            <CircleHelp className="text-blue-700" size={21} />
            <h2 className="text-lg font-bold">Question Review</h2>
          </div>
          <div className="mt-5 border-y border-slate-100 py-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Review filter</p>
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "All questions"],
                ["correct", "Correct"],
                ["incorrect", "Incorrect"],
                ["unanswered", "Unanswered"],
                ["not-scored", "Not scored"],
                ["flagged", "Flagged"],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setReviewFilter(value)} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${reviewFilter === value ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"}`}>{label}</button>
              ))}
            </div>
            <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-slate-500">Session</p>
            <div className="flex flex-wrap gap-2">
              {([
                ["both", "Both sessions"],
                [1, "Session 1"],
                [2, "Session 2"],
              ] as const).map(([value, label]) => (
                <button key={String(value)} type="button" onClick={() => setSessionFilter(value)} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${sessionFilter === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="mt-5 space-y-4">
            {filteredResults.length === 0 && <p className="rounded-lg bg-slate-50 p-5 text-sm text-slate-600">No questions match the selected review filters.</p>}
            {filteredResults.map((result) => {
              const originalIndex = results.indexOf(result);
              const isCorrect = result.status === "correct";
              const isIncorrect = result.status === "incorrect";
              return (
                <article key={result.question.id} className="rounded-lg border border-slate-200 p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Question {originalIndex + 1} · Session {result.session}</p>
                      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-800">{result.question.stem || "Question text unavailable."}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{result.topic}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isCorrect ? "bg-emerald-100 text-emerald-800" : isIncorrect ? "bg-red-100 text-red-800" : result.status === "unanswered" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>{isCorrect ? "Correct" : isIncorrect ? "Incorrect" : result.status === "unanswered" ? "Not answered" : "Not scored"}</span>
                      {result.isFlg && <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-bold text-yellow-900"><Flag size={12} fill="currentColor" /> Flagged</span>}
                    </div>
                  </div>
                  <div className={`mt-4 rounded-md border px-4 py-3 text-sm ${isCorrect ? "border-emerald-200 bg-emerald-50 text-emerald-900" : isIncorrect ? "border-red-200 bg-red-50 text-red-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                    {isCorrect && <span className="inline-flex items-center gap-2 font-semibold"><CheckCircle2 size={17} /> Correct — your answer: {result.selectedOption}</span>}
                    {isIncorrect && <span className="inline-flex items-center gap-2 font-semibold"><XCircle size={17} /> Your answer: {result.selectedOption} · Correct answer: {result.correctOption}</span>}
                    {result.status === "unanswered" && <span className="font-semibold">Not answered · Correct answer: {result.correctOption}</span>}
                    {result.status === "not-scored" && <span className="font-semibold">This question was not scored.</span>}
                  </div>
                  {result.question.explanation && <p className="mt-4 border-l-4 border-blue-500 bg-blue-50 px-4 py-3 text-sm leading-6 text-slate-700">{result.question.explanation}</p>}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

