"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  FlagOff,
  ListChecks,
  X,
} from "lucide-react";

import { FinishDialog } from "./FinishDialog";
import { QuestionImage } from "./QuestionImage";
import { hasPageSource } from "../lib/pipeline/pageSource";
import type { QuestionCrop } from "../lib/pipeline/types";
import {
  type AnswerOption,
  type ExamQuestion,
  useExamStore,
} from "../store/useExamStore";

type QuestionContent = ExamQuestion & {
  session?: number;
  session_number?: number;
  stem?: string;
  table_data?: Record<string, unknown> | null;
  stem_after?: string | null;
  option_a?: string;
  option_b?: string;
  option_c?: string;
};

type TableView = {
  headers: string[];
  rows: string[][];
};

const optionLabels: AnswerOption[] = ["A", "B", "C"];

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getTableView(tableData: Record<string, unknown> | null | undefined): TableView | null {
  if (!tableData) return null;

  const headers = Array.isArray(tableData.headers)
    ? tableData.headers.map(String)
    : Array.isArray(tableData.columns)
      ? tableData.columns.map(String)
      : [];
  const rawRows = Array.isArray(tableData.rows) ? tableData.rows : [];

  if (headers.length > 0 && rawRows.length > 0) {
    return {
      headers,
      rows: rawRows.map((row) =>
        Array.isArray(row)
          ? row.map(String)
          : headers.map((header) => String((row as Record<string, unknown>)[header] ?? "")),
      ),
    };
  }

  const entries = Object.entries(tableData);
  return entries.length > 0
    ? { headers: ["Item", "Value"], rows: entries.map(([key, value]) => [key, String(value)]) }
    : null;
}

/** Renders line-separated question copy as paragraphs. Backend content must be sanitized before storage. */
function QuestionText({ content }: { content?: string | null }) {
  if (!content) return null;

  return (
    <div className="space-y-4 text-[17px] leading-7 text-slate-800">
      {content
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={`${index}-${paragraph.slice(0, 24)}`} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
    </div>
  );
}

export function ExamEngine() {
  const [isNavigatorOpen, setIsNavigatorOpen] = useState(false);
  const [isFinishOpen, setIsFinishOpen] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const {
    examData,
    currentSession,
    currentQuestionIndex,
    sessionTimeLeft,
    answers,
    flags,
    setCurrentQuestionIndex,
    selectOption,
    toggleFlag,
    logTimeSpent,
    finishSession,
    mode,
    practiceSubject,
  } = useExamStore();
  const practice = mode === "practice";

  const sessionQuestions = useMemo(() => {
    const matchingQuestions = (examData as QuestionContent[]).filter((question) => {
      const session = question.session_number ?? question.session;
      return session === undefined || session === currentSession;
    });

    return matchingQuestions.length > 0 ? matchingQuestions : (examData as QuestionContent[]);
  }, [currentSession, examData]);

  const currentQuestion = sessionQuestions[currentQuestionIndex];
  const currentQuestionId = currentQuestion?.id;
  const table = getTableView(currentQuestion?.table_data);
  const imageMode = Boolean(currentQuestion && currentQuestion.showImage === true && currentQuestion.crop && hasPageSource() && !failedImages[currentQuestion.id]);
  const isFinalQuestion = currentQuestionIndex === sessionQuestions.length - 1;
  const answeredCount = sessionQuestions.filter((question) => Boolean(answers[question.id])).length;
  const flaggedCount = sessionQuestions.filter((question) => Boolean(flags[question.id])).length;
  const timeClassName =
    sessionTimeLeft < 300
      ? "animate-pulse text-red-400"
      : sessionTimeLeft < 900
        ? "text-yellow-300"
        : "text-white";

  const goToPrevious = useCallback(() => {
    setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1));
  }, [currentQuestionIndex, setCurrentQuestionIndex]);

  const goToNext = useCallback(() => {
    setCurrentQuestionIndex(Math.min(sessionQuestions.length - 1, currentQuestionIndex + 1));
  }, [currentQuestionIndex, sessionQuestions.length, setCurrentQuestionIndex]);

  useEffect(() => {
    if (!currentQuestionId) return;

    const viewingStartedAt = performance.now();
    return () => {
      logTimeSpent(currentQuestionId, Math.round(performance.now() - viewingStartedAt));
    };
  }, [currentQuestionId, currentQuestionIndex, logTimeSpent]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (!currentQuestionId || isFinishOpen) return;

      const key = event.key.toUpperCase();
      if (key === "A" || key === "B" || key === "C") {
        event.preventDefault();
        selectOption(currentQuestionId, key);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNext();
      } else if (key === "F") {
        event.preventDefault();
        toggleFlag(currentQuestionId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentQuestionId, goToNext, goToPrevious, selectOption, toggleFlag, isFinishOpen]);

  if (examData.length === 0 || !currentQuestion) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <div className="rounded-xl border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">No questions available</h1>
          <p className="mt-2 text-sm text-slate-600">Load an exam shift before starting a session.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen min-h-[42rem] flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex min-h-16 items-center justify-between gap-4 bg-slate-900 px-5 text-sm shadow-lg sm:px-7">
        <div className="font-semibold text-slate-100">
          <div>Question {currentQuestionIndex + 1} of {sessionQuestions.length}<span className="mx-3 text-slate-500">|</span>{practice ? (practiceSubject ?? "Practice") : `Session ${currentSession}`}</div>
          <div className="mt-1 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide">
            <span className="text-emerald-300">Answered {answeredCount}/{sessionQuestions.length}</span>
            <span className="inline-flex items-center gap-1 text-yellow-300"><Flag size={12} fill="currentColor" /> Flagged {flaggedCount}</span>
          </div>
        </div>

        <div className={`flex items-center gap-2 font-mono text-xl font-bold tabular-nums ${timeClassName}`}>
          <Clock3 size={19} aria-hidden="true" />
          <span>{formatTime(sessionTimeLeft)}</span>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setIsNavigatorOpen(true)} className="inline-flex items-center gap-1 rounded border border-slate-500 bg-slate-800 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white"><ListChecks size={15} /> Navigator</button>
          <button type="button" onClick={() => setIsFinishOpen(true)} className="rounded border border-slate-500 bg-slate-800 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:border-red-400 hover:bg-red-950 focus:outline-none focus:ring-2 focus:ring-red-400">{practice ? "Finish Exam" : "Finish Section"}</button>
        </div>
      </header>

      {isNavigatorOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="Question navigator">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Question Navigator</h2><p className="text-xs text-slate-500">Green answered · yellow dot flagged</p></div><button type="button" onClick={() => setIsNavigatorOpen(false)} aria-label="Close question navigator" className="rounded p-2 hover:bg-slate-100"><X size={19} /></button></div>
            <div className="mt-5 grid grid-cols-8 gap-2">
              {sessionQuestions.map((question, index) => {
                const isCurrent = index === currentQuestionIndex;
                return <button key={question.id} type="button" onClick={() => { setCurrentQuestionIndex(index); setIsNavigatorOpen(false); }} className={`relative grid aspect-square place-items-center rounded text-xs font-bold ${answers[question.id] ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"} ${isCurrent ? "ring-2 ring-blue-600 ring-offset-2" : ""}`}>{index + 1}{flags[question.id] && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-yellow-400" />}</button>;
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-28 shrink-0 overflow-y-auto border-r border-slate-300 bg-slate-200 p-3 sm:w-36">
          <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-600">Questions</p>
          <div className="grid grid-cols-3 gap-2">
            {sessionQuestions.map((question, index) => {
              const isCurrent = index === currentQuestionIndex;
              const isAnswered = Boolean(answers[question.id]);
              const isFlagged = Boolean(flags[question.id]);

              return (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => setCurrentQuestionIndex(index)}
                  aria-label={`Go to question ${index + 1}${isFlagged ? ", flagged" : ""}`}
                  className={`relative grid aspect-square place-items-center rounded text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isAnswered
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                  } ${isCurrent ? "ring-2 ring-blue-600 ring-offset-2" : ""}`}
                >
                  {index + 1}
                  {isFlagged && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-yellow-400" />}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-7">
          <article className="mx-auto min-h-full max-w-5xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
            <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Question {currentQuestionIndex + 1}</span>
              {flags[currentQuestion.id] && <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-xs font-bold text-yellow-900"><Flag size={13} fill="currentColor" /> Flagged for review</span>}
            </div>
            {imageMode
              ? <QuestionImage key={currentQuestion.id} crop={currentQuestion.crop as QuestionCrop} onFail={() => setFailedImages((f) => ({ ...f, [currentQuestion.id]: true }))} />
              : <QuestionText content={currentQuestion.stem} />}

            {!imageMode && table && (
              <div className="my-7 overflow-x-auto rounded border border-slate-300">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      {table.headers.map((header) => (
                        <th key={header} className="border-b border-slate-300 px-4 py-3 font-semibold">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="even:bg-slate-50">
                        {row.map((cell, cellIndex) => (
                          <td key={`${rowIndex}-${cellIndex}`} className="border-b border-slate-200 px-4 py-3">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!imageMode && <QuestionText content={currentQuestion.stem_after} />}

            <div className={imageMode ? "mt-8 grid grid-cols-3 gap-3" : "mt-10 space-y-3"} role="radiogroup" aria-label="Answer choices">
              {optionLabels.map((option) => {
                const optionText = {
                  A: currentQuestion.option_a ?? currentQuestion.A,
                  B: currentQuestion.option_b ?? currentQuestion.B,
                  C: currentQuestion.option_c ?? currentQuestion.C,
                }[option] ?? "";
                const isSelected = answers[currentQuestion.id] === option;

                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => selectOption(currentQuestion.id, option)}
                    className={`flex w-full gap-4 rounded-md border-2 p-4 text-left text-base transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${imageMode ? "items-center justify-center" : "items-start"} ${
                      isSelected
                        ? "border-blue-700 bg-blue-50 text-blue-950"
                        : "border-slate-300 bg-white hover:border-slate-500"
                    }`}
                  >
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${isSelected ? "bg-blue-700 text-white" : "bg-slate-200 text-slate-700"}`}>
                      {option}
                    </span>
                    {imageMode ? <span className="font-semibold">Option {option}</span> : <span className="pt-0.5 leading-6">{optionText}</span>}
                  </button>
                );
              })}
            </div>
          </article>
        </section>
      </div>

      <footer className="flex min-h-16 items-center justify-between border-t border-slate-300 bg-white px-5 shadow-[0_-2px_8px_rgba(15,23,42,0.06)] sm:px-7">
        <button
          type="button"
          onClick={goToPrevious}
          disabled={currentQuestionIndex === 0}
          className="inline-flex items-center gap-2 rounded border border-slate-400 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={18} /> Previous
        </button>

        <button
          type="button"
          onClick={() => toggleFlag(currentQuestion.id)}
          className={`inline-flex items-center gap-2 rounded border px-4 py-2 text-sm font-semibold ${
            flags[currentQuestion.id]
              ? "border-yellow-500 bg-yellow-100 text-yellow-900"
              : "border-slate-400 text-slate-700"
          }`}
        >
          {flags[currentQuestion.id] ? <FlagOff size={17} /> : <Flag size={17} />}
          {flags[currentQuestion.id] ? "Unflag for review" : "Flag for review"}
        </button>

        <button
          type="button"
          onClick={goToNext}
          disabled={isFinalQuestion}
          className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Next <ChevronRight size={18} />
        </button>
      </footer>
      <FinishDialog
        open={isFinishOpen}
        session={currentSession}
        practice={practice}
        answered={answeredCount}
        unanswered={sessionQuestions.length - answeredCount}
        flagged={flaggedCount}
        secondsLeft={sessionTimeLeft}
        onReturn={() => setIsFinishOpen(false)}
        onFinish={() => { setIsFinishOpen(false); finishSession(); }}
      />
    </main>
  );
}
