"use client";

import { Fragment, useMemo, useState, type CSSProperties } from "react";
import { Award, CheckCircle2, CircleHelp, Clock3, Download, Flag, Printer, Repeat2, Target, XCircle } from "lucide-react";

import { useExamStore } from "../store/useExamStore";
import { analyze, formatDuration, percent, weakestModules, type AnswerStatus, type QuestionResult, type ResultQuestion } from "../lib/analysis";
import { buildReportHtml, downloadHtml, printHtml } from "../lib/report";
import { getRegionImage, hasPageSource } from "../lib/pipeline/pageSource";
import type { QuestionCrop } from "../lib/pipeline/types";
import { QuestionImage } from "./QuestionImage";

type ReviewFilter = "all" | AnswerStatus | "flagged";
type SessionFilter = "both" | 1 | 2;

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
  const { examData, answers, flags, telemetry, mode, practiceSubject, sessionDurationSeconds } = useExamStore();
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("both");
  const [withImages, setWithImages] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const practice = mode === "practice";
  const a = useMemo(() => analyze(examData as ResultQuestion[], answers, flags, telemetry), [examData, answers, flags, telemetry]);
  const { results, pacing, switches, scorePercentage } = a;
  const weak = weakestModules(a);
  const title = practice ? `Practice test – ${practiceSubject ?? "Subject"}` : "CFA Level I mock exam";
  const filteredResults = results.filter((result) => {
    const matchesSession = practice || sessionFilter === "both" || result.session === sessionFilter;
    const matchesReview = reviewFilter === "all" || (reviewFilter === "flagged" ? result.isFlg : result.status === reviewFilter);
    return matchesSession && matchesReview;
  });
  const canUseImages = hasPageSource() && results.some((r) => r.question.showImage && r.question.crop);

  async function makeReport(): Promise<string> {
    const images = new Map<string, string>();
    if (withImages && canUseImages) {
      let n = 0;
      for (const r of results) {
        const q = r.question; if (q.showImage && q.crop) { const url = await getRegionImage(q.crop as QuestionCrop).catch(() => null); if (url) images.set(q.id, url); }
        n += 1; if (n % 10 === 0) setBusy(`Preparing report… ${n}/${results.length}`);
      }
    }
    return buildReportHtml(a, { title, practice, subject: practiceSubject, timeLimitSeconds: practice ? sessionDurationSeconds : undefined }, images);
  }
  async function onDownload() { setBusy("Preparing report…"); try { downloadHtml(await makeReport(), `${practice ? "practice" : "mock"}-analysis-${new Date().toISOString().slice(0, 10)}.html`); } finally { setBusy(null); } }
  async function onPrint() { setBusy("Preparing report…"); try { printHtml(await makeReport()); } finally { setBusy(null); } }
  const startOver = () => { useExamStore.setState({ phase: "intro", examData: [], answers: {}, flags: {}, telemetry: {}, currentQuestionIndex: 0, mode: "mock", practiceSubject: null }); };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-7 text-slate-900 sm:px-7 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-7">
        <header className="flex flex-col justify-between gap-5 rounded-2xl bg-slate-950 px-6 py-7 text-white shadow-lg sm:flex-row sm:items-center sm:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">{practice ? "Practice results" : "Exam results"}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{practice ? practiceSubject ?? "Performance Dashboard" : "Performance Dashboard"}</h1>
            <p className="mt-2 text-sm text-slate-300">{results.length} questions analyzed · Average pacing {formatDuration(a.averageTimeMs)} per question</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button type="button" onClick={onDownload} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-60"><Download size={16} /> Download analysis (.html)</button>
              <button type="button" onClick={onPrint} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-slate-500 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"><Printer size={16} /> Print / Save as PDF</button>
              <button type="button" onClick={startOver} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">New exam</button>
            </div>
            {canUseImages && <label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} /> Include the question pictures in the file (bigger file, looks exactly like the exam)</label>}
            {busy && <p className="mt-2 text-xs text-blue-200" role="status">{busy}</p>}
            <p className="mt-2 text-xs text-slate-400">The file opens in any browser, works offline and keeps the full question review.</p>
          </div>
          <div className="shrink-0 rounded-full bg-white p-2 shadow-inner"><ScoreRing percentage={scorePercentage} /></div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-2"><Target className="text-blue-700" size={21} /><h2 className="text-lg font-bold">{practice ? "Summary" : "Session Breakdown"}</h2></div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-3 font-bold">{practice ? "Test" : "Session"}</th><th className="px-3 py-3 font-bold">Total Questions</th><th className="px-3 py-3 font-bold">Correct</th><th className="px-3 py-3 font-bold">Incorrect</th><th className="px-3 py-3 font-bold">Unanswered</th><th className="px-3 py-3 font-bold">Total Time Used</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {practice ? (
                  <tr className="text-slate-700">
                    <td className="px-3 py-4 font-semibold text-slate-950">{practiceSubject ?? "Practice"}</td><td className="px-3 py-4">{results.length}</td>
                    <td className="px-3 py-4 font-semibold text-emerald-700">{a.totalCorrect}</td><td className="px-3 py-4 font-semibold text-red-700">{results.filter((r) => r.status === "incorrect").length}</td>
                    <td className="px-3 py-4 text-slate-500">{results.filter((r) => r.status === "unanswered").length}</td><td className="px-3 py-4 font-mono">{formatDuration(a.totalTimeMs)} <span className="text-slate-400">/ {formatDuration(sessionDurationSeconds * 1000)}</span></td>
                  </tr>
                ) : ([1, 2] as const).map((session) => {
                  const metrics = a.sessions.get(session)!;
                  return (
                    <tr key={session} className="text-slate-700">
                      <td className="px-3 py-4 font-semibold text-slate-950">Session {session}</td><td className="px-3 py-4">{metrics.total}</td>
                      <td className="px-3 py-4 font-semibold text-emerald-700">{metrics.correct}</td><td className="px-3 py-4 font-semibold text-red-700">{metrics.incorrect}</td>
                      <td className="px-3 py-4 text-slate-500">{metrics.unanswered}</td><td className="px-3 py-4 font-mono">{formatDuration(metrics.timeSpentMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center gap-2"><Clock3 className="text-blue-700" size={21} /><h2 className="text-lg font-bold">Pacing Matrix</h2></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Fast & Accurate" count={pacing.fastAccurate} description="Correct answers completed in under 65 seconds." tone="text-emerald-600" />
            <MetricCard title="Time Sinks" count={pacing.timeSinks} description="Incorrect answers taking over 110 seconds." tone="text-red-600" />
            <MetricCard title="Rushed Errors" count={pacing.rushedErrors} description="Incorrect answers submitted in under 30 seconds." tone="text-amber-600" />
            <MetricCard title="Grind Wins" count={pacing.grindWins} description="Correct answers earned after over 110 seconds." tone="text-blue-600" />
          </div>
        </section>

        <section className="grid gap-7 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-7">
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <div className="flex items-center gap-2"><Repeat2 className="text-blue-700" size={21} /><h2 className="text-lg font-bold">Answer-Switch Tracker</h2></div>
              <div className="mt-6 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-emerald-50 p-4"><p className="text-2xl font-bold text-emerald-700">{switches.wrongToRight}</p><p className="mt-1 text-xs font-semibold leading-4 text-emerald-800">Wrong → Right</p></div>
                <div className="rounded-lg bg-red-50 p-4"><p className="text-2xl font-bold text-red-700">{switches.rightToWrong}</p><p className="mt-1 text-xs font-semibold leading-4 text-red-800">Right → Wrong</p></div>
                <div className="rounded-lg bg-amber-50 p-4"><p className="text-2xl font-bold text-amber-700">{switches.wrongToWrong}</p><p className="mt-1 text-xs font-semibold leading-4 text-amber-800">Wrong → Wrong</p></div>
              </div>
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
              <h2 className="text-lg font-bold">Weakest learning modules</h2>
              {weak.length === 0 ? <p className="mt-3 text-sm text-slate-500">Not enough questions per module yet.</p> : (
                <ol className="mt-3 space-y-2 text-sm">{weak.map((m) => <li key={`${m.topic}-${m.name}`} className="rounded-lg bg-red-50 px-3 py-2"><b className="text-slate-900">{m.name}</b> <span className="text-slate-500">({m.topic})</span><span className="float-right font-bold text-red-700">{percent(m)}% · {m.correct}/{m.total}</span></li>)}</ol>
              )}
            </article>
          </div>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-center gap-2"><Award className="text-blue-700" size={21} /><h2 className="text-lg font-bold">Topic Performance</h2></div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-3 pr-3">Subject / learning module</th><th className="py-3 pr-3">Score</th><th className="py-3">Progress</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {a.topics.map((topic) => (
                    <Fragment key={topic.topic}>
                      <tr className="bg-slate-50"><td className="py-3 pr-3 pl-2 font-bold text-slate-900">{topic.topic}</td><td className="py-3 pr-3 font-semibold text-slate-700">{percent(topic)}% <span className="font-normal text-slate-400">({topic.correct}/{topic.total})</span></td><td className="py-3"><Progress value={percent(topic)} /></td></tr>
                      {topic.modules.map((m) => (
                        <tr key={`${topic.topic}-${m.name}`}><td className="py-2 pr-3 pl-6 text-slate-700">{m.name}</td><td className="py-2 pr-3 text-slate-600">{percent(m)}% <span className="text-slate-400">({m.correct}/{m.total})</span></td><td className="py-2"><Progress value={percent(m)} thin /></td></tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-2"><CircleHelp className="text-blue-700" size={21} /><h2 className="text-lg font-bold">Question Review</h2></div>
          <div className="mt-5 border-y border-slate-100 py-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Review filter</p>
            <div className="flex flex-wrap gap-2">
              {([["all", "All questions"], ["correct", "Correct"], ["incorrect", "Incorrect"], ["unanswered", "Unanswered"], ["not-scored", "Not scored"], ["flagged", "Flagged"]] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setReviewFilter(value)} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${reviewFilter === value ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"}`}>{label}</button>
              ))}
            </div>
            {!practice && (
              <>
                <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-slate-500">Session</p>
                <div className="flex flex-wrap gap-2">
                  {([["both", "Both sessions"], [1, "Session 1"], [2, "Session 2"]] as const).map(([value, label]) => (
                    <button key={String(value)} type="button" onClick={() => setSessionFilter(value)} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${sessionFilter === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"}`}>{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="mt-5 space-y-4">
            {filteredResults.length === 0 && <p className="rounded-lg bg-slate-50 p-5 text-sm text-slate-600">No questions match the selected review filters.</p>}
            {filteredResults.map((result) => <ReviewCard key={result.question.id} result={result} practice={practice} />)}
          </div>
        </section>
      </div>
    </main>
  );
}

function Progress({ value, thin }: { value: number; thin?: boolean }) {
  const style = { "--progress": `${value}%` } as CSSProperties;
  return <div className={`${thin ? "h-1.5" : "h-2"} w-32 overflow-hidden rounded-full bg-slate-200`}><div style={style} className="h-full w-[var(--progress)] rounded-full bg-blue-600" /></div>;
}

function ReviewCard({ result, practice }: { result: QuestionResult; practice: boolean }) {
  const q = result.question as ResultQuestion; const isCorrect = result.status === "correct"; const isIncorrect = result.status === "incorrect";
  const useImage = Boolean(q.showImage && q.crop && hasPageSource());
  const text = (
    <>
      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-800">{q.stem || "Question text unavailable."}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {(["A", "B", "C"] as const).map((k) => (
          <li key={k} className={`rounded-md border px-3 py-1.5 ${k === result.correctOption ? "border-emerald-300 bg-emerald-50" : k === result.selectedOption ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
            <b>{k}.</b> {q[k]} {k === result.correctOption && <span className="text-xs font-bold text-emerald-700">· correct</span>} {k === result.selectedOption && <span className="text-xs font-bold text-slate-600">· your answer</span>}
          </li>
        ))}
      </ul>
    </>
  );
  return (
    <article className="rounded-lg border border-slate-200 p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Question {result.index + 1}{practice ? "" : ` · Session ${result.session}`} · {formatDuration(result.timeSpentMs)}</p>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{result.topic}{result.subtopic ? ` › ${result.subtopic}` : ""}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isCorrect ? "bg-emerald-100 text-emerald-800" : isIncorrect ? "bg-red-100 text-red-800" : result.status === "unanswered" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>{isCorrect ? "Correct" : isIncorrect ? "Incorrect" : result.status === "unanswered" ? "Not answered" : "Not scored"}</span>
          {result.isFlg && <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-bold text-yellow-900"><Flag size={12} fill="currentColor" /> Flagged</span>}
        </div>
      </div>
      <div className="mt-3">{useImage ? <QuestionImage crop={q.crop as QuestionCrop} fallback={text} /> : text}</div>
      <div className={`mt-4 rounded-md border px-4 py-3 text-sm ${isCorrect ? "border-emerald-200 bg-emerald-50 text-emerald-900" : isIncorrect ? "border-red-200 bg-red-50 text-red-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
        {isCorrect && <span className="inline-flex items-center gap-2 font-semibold"><CheckCircle2 size={17} /> Correct — your answer: {result.selectedOption}</span>}
        {isIncorrect && <span className="inline-flex items-center gap-2 font-semibold"><XCircle size={17} /> Your answer: {result.selectedOption} · Correct answer: {result.correctOption}</span>}
        {result.status === "unanswered" && <span className="font-semibold">Not answered · Correct answer: {result.correctOption}</span>}
        {result.status === "not-scored" && <span className="font-semibold">This question was not scored.</span>}
      </div>
      {q.explanation && <p className="mt-4 border-l-4 border-blue-500 bg-blue-50 px-4 py-3 text-sm leading-6 text-slate-700">{q.explanation}</p>}
    </article>
  );
}
