"use client";

import { useEffect } from "react";

export interface FinishDialogProps {
  open: boolean;
  session: 1 | 2;
  practice?: boolean;
  answered: number;
  unanswered: number;
  flagged: number;
  secondsLeft: number;
  onReturn: () => void;
  onFinish: () => void;
}

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

export function FinishDialog({ open, session, practice, answered, unanswered, flagged, secondsLeft, onReturn, onFinish }: FinishDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onReturn(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onReturn]);

  if (!open) return null;
  const last = session === 2 || Boolean(practice);
  const name = practice ? "the exam" : `Session ${session}`;
  const box = (value: string | number, label: string, color: string) => (
    <div className="rounded border border-slate-200 text-center">
      <div className={`py-3 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="border-t border-slate-200 py-1 text-[10px] font-semibold tracking-wider text-slate-500">{label}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="finish-title">
      <div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-2xl">
        <h2 id="finish-title" className="text-sm font-bold text-slate-900">Finish {practice ? "exam" : `Session ${session}`}?</h2>
        <p className="mt-4 text-sm font-semibold text-slate-900">Are you sure you want to finish {name}? You will not be able to return to {name} after proceeding.</p>
        <div className="mt-4 grid grid-cols-4 gap-3">
          {box(answered, "ANSWERED", "text-green-700")}
          {box(unanswered, "UNANSWERED", "text-red-700")}
          {box(flagged, "FLAGGED", "text-amber-600")}
          {box(clock(secondsLeft), "TIME LEFT", "text-slate-900")}
        </div>
        {unanswered > 0 && (
          <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            You still have <b>{unanswered}</b> unanswered question{unanswered === 1 ? "" : "s"}. There is no penalty for a wrong answer — consider answering {unanswered === 1 ? "it" : "them"} before you finish.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          {practice
            ? "Finishing ends the practice test. You will move straight to your results and the full question-by-question review."
            : last
            ? "Finishing Session 2 ends the examination. Both sessions will be locked and you will move to your results and the full question-by-question review."
            : "Session 1 will be locked permanently. You will then move to the optional break. No scores or correct answers are shown until the whole exam is complete."}
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" autoFocus onClick={onReturn} className="rounded border border-slate-300 bg-white px-4 py-2 text-xs font-semibold hover:bg-slate-100">Return to {practice ? "exam" : `Session ${session}`}</button>
          <button type="button" onClick={onFinish} className="rounded bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800">{last ? "Finish exam" : "Finish Session 1"}</button>
        </div>
      </div>
    </div>
  );
}
