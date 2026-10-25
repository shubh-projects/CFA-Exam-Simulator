"use client";

import { useEffect, useMemo, useState } from "react";
import { useExamStore } from "../store/useExamStore";
import { validateExam } from "../lib/pipeline/validate";
import { applyEdit, markChecked, questionProblems, type QuestionPatch } from "../lib/pipeline/edit";
import { getPageCount, getPageImage, hasPageSource } from "../lib/pipeline/pageSource";
import type { AnswerOption, ParsedQuestion } from "../lib/pipeline/types";

type Filter = "attention" | "s1" | "s2";
const PAGE_SIZE = 15;

function OriginalPage({ q }: { q: ParsedQuestion }) {
  const tabs = [
    { label: "Question page", page: q.sourcePage },
    { label: "Next page", page: q.sourcePage + 1 },
    ...(q.keyPage !== undefined ? [{ label: "Answer key page", page: q.keyPage }] : []),
  ].filter((t) => t.page >= 0 && t.page < getPageCount());
  const [active, setActive] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [zoom, setZoom] = useState(false);
  const page = tabs[active]?.page;

  useEffect(() => {
    let alive = true; setBusy(true);
    if (page === undefined) { setBusy(false); return; }
    getPageImage(page).then((url) => { if (alive) { setSrc(url); setBusy(false); } }).catch(() => { if (alive) { setSrc(null); setBusy(false); } });
    return () => { alive = false; };
  }, [page]);

  return (
    <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
      <div className="mb-2 flex flex-wrap gap-2">
        {tabs.map((t, i) => (
          <button key={t.label} type="button" onClick={() => setActive(i)} className={`rounded px-3 py-1 text-xs font-semibold ${i === active ? "bg-blue-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"}`}>
            {t.label} (p.{t.page + 1})
          </button>
        ))}
      </div>
      {!busy && src && <p className="mb-1 text-xs text-slate-500">Click the page to zoom in or out.</p>}
      {busy ? <p className="p-6 text-center text-sm text-slate-500">Loading page…</p>
        : src ? (
          <div className="max-h-[75vh] overflow-auto rounded border bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Original page ${(page ?? 0) + 1}`} onClick={() => setZoom((z) => !z)} title="Click to zoom" className={zoom ? "max-w-none w-[220%] cursor-zoom-out" : "w-full cursor-zoom-in"} />
          </div>
        )
        : <p className="p-6 text-center text-sm text-slate-500">Could not display this page.</p>}
    </div>
  );
}

function QuestionCard({ q, onChange, onChecked }: { q: ParsedQuestion; onChange: (patch: QuestionPatch) => void; onChecked: () => void }) {
  const [showPage, setShowPage] = useState(false);
  const problems = questionProblems(q);
  const tone = q.status === "ok" ? "border-slate-200" : "border-amber-300 bg-amber-50/40";
  const field = "w-full rounded border border-slate-300 bg-white p-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <article className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b>Session {q.session}, question {q.n}</b>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${q.status === "ok" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>
          {q.status === "ok" ? (q.reason === "Checked by you" ? "Checked" : "OK") : "Needs review"}
        </span>
      </div>
      {q.status !== "ok" && <p className="mt-1 text-sm text-amber-800">{q.reason ?? q.status}</p>}

      <label className="mt-3 block text-xs font-semibold text-slate-600">Question
        <textarea value={q.stem} onChange={(e) => onChange({ stem: e.target.value })} rows={Math.min(8, Math.max(3, Math.ceil(q.stem.length / 90)))} className={`${field} mt-1`} />
      </label>

      <div className="mt-3 space-y-2">
        {(["A", "B", "C"] as AnswerOption[]).map((k) => (
          <div key={k} className="flex items-start gap-2">
            <label className="mt-2 flex shrink-0 items-center gap-1 text-xs font-bold text-slate-700" title="Mark as the correct answer">
              <input type="radio" name={`correct-${q.id}`} checked={q.correct === k} onChange={() => onChange({ correct: k })} />
              {k}
            </label>
            <textarea value={q[k]} onChange={(e) => onChange({ [k]: e.target.value })} rows={Math.min(4, Math.max(1, Math.ceil(q[k].length / 90)))} className={field} aria-label={`Option ${k}`} />
          </div>
        ))}
        <p className="text-xs text-slate-500">The selected circle is the correct answer used for scoring.</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {hasPageSource() && (
          <button type="button" onClick={() => setShowPage((v) => !v)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-100">
            {showPage ? "Hide original page" : "Show original page"}
          </button>
        )}
        {q.status !== "ok" && (
          <button type="button" disabled={problems.length > 0} onClick={onChecked} title={problems[0]} className="rounded bg-green-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            This looks correct
          </button>
        )}
      </div>
      {showPage && <OriginalPage q={q} />}
    </article>
  );
}

export function ReviewScreen() {
  const examData = useExamStore((s) => s.examData) as unknown as ParsedQuestion[];
  const startSession = useExamStore((s) => s.startSession);
  const summary = useMemo(() => validateExam(examData as never[]), [examData]);
  const attention = useMemo(() => examData.filter((q) => q.status === "needs_review"), [examData]);

  const [filter, setFilter] = useState<Filter>(attention.length ? "attention" : "s1");
  // Cards stay visible after you fix them (otherwise they vanish while you are still typing).
  const [pinned, setPinned] = useState<string[]>(() => attention.map((q) => q.id));
  const [pageNo, setPageNo] = useState(0);

  const list = filter === "attention" ? examData.filter((q) => pinned.includes(q.id) || q.status === "needs_review") : examData.filter((q) => q.session === (filter === "s1" ? 1 : 2));
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const visible = filter === "attention" ? list : list.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE);

  const update = (id: string, fn: (q: ParsedQuestion) => ParsedQuestion) =>
    useExamStore.setState({ examData: examData.map((q) => (q.id === id ? fn(q) : q)) as never });

  const choose = (f: Filter) => { setFilter(f); setPageNo(0); if (f === "attention") setPinned(attention.map((q) => q.id)); };
  const tab = (f: Filter, label: string) => (
    <button type="button" onClick={() => choose(f)} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${filter === f ? "bg-blue-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"}`}>{label}</button>
  );

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <section className="mx-auto max-w-4xl rounded-xl bg-white p-5 shadow sm:p-6">
        <h1 className="text-2xl font-bold">Check your questions</h1>
        <p className="mt-2 text-sm">Session 1: {summary.sessions[0].found}/90 · Session 2: {summary.sessions[1].found}/90 · {attention.length} need review · {summary.corrected} corrected keys</p>
        <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
          Text is read locally from your scan and can contain small mistakes. Use <b>Show original page</b> to compare, fix the text directly in the boxes, and pick the correct answer with the circles. Your edits are used in the exam.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {tab("attention", `Needs review (${attention.length})`)}
          {tab("s1", "All – Session 1")}
          {tab("s2", "All – Session 2")}
        </div>

        <div className="mt-4 space-y-4">
          {visible.length === 0 && <p className="rounded bg-green-50 p-4 text-sm text-green-800">Nothing needs review. Open “All” to spot-check any question against the original page.</p>}
          {visible.map((q) => (
            <QuestionCard key={q.id} q={q} onChange={(patch) => update(q.id, (cur) => applyEdit(cur, patch))} onChecked={() => update(q.id, markChecked)} />
          ))}
        </div>

        {filter !== "attention" && pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <button type="button" disabled={pageNo === 0} onClick={() => setPageNo((p) => p - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">← Previous</button>
            <span>Questions {pageNo * PAGE_SIZE + 1}–{Math.min(list.length, (pageNo + 1) * PAGE_SIZE)} of {list.length}</span>
            <button type="button" disabled={pageNo >= pages - 1} onClick={() => setPageNo((p) => p + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Next →</button>
          </div>
        )}

        <div className="mt-6 border-t pt-4">
          {attention.length > 0 && <p className="mb-2 text-sm text-amber-800">{attention.length} question{attention.length === 1 ? "" : "s"} still need review. You can start anyway, but they may show missing or wrong text.</p>}
          <button type="button" onClick={() => startSession(1)} className="rounded bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800">
            {attention.length ? "Start exam anyway" : "Looks good — start exam"}
          </button>
        </div>
      </section>
    </main>
  );
}
