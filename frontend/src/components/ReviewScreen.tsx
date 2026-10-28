"use client";

import { useEffect, useMemo, useState } from "react";
import { useExamStore } from "../store/useExamStore";
import { validateExam } from "../lib/pipeline/validate";
import { applyDisplayStatus, applyEdit, markChecked, questionProblems, type QuestionPatch } from "../lib/pipeline/edit";
import { getPageCount, getPageImage, hasPageSource, prepareRegions } from "../lib/pipeline/pageSource";
import { CFA_TOPICS, LEARNING_MODULES } from "../lib/pipeline/topics";
import type { AnswerOption, ParsedQuestion, QuestionCrop } from "../lib/pipeline/types";
import { QuestionImage } from "./QuestionImage";

type Filter = "attention" | "s1" | "s2" | "topics";
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

/** Subject › learning module chooser (names come from the Juice notes). */
function TopicSelect({ q, onPick, onlySubject, compact }: { q: ParsedQuestion; onPick: (topic: string, subtopic: string) => void; onlySubject?: string | null; compact?: boolean }) {
  const subjects = onlySubject ? [onlySubject] : [...CFA_TOPICS];
  const value = `${q.topic}|||${q.subtopic ?? ""}`;
  return (
    <select aria-label="Topic" value={value} onChange={(e) => { const [t, s] = e.target.value.split("|||"); onPick(t, s); }} className={`rounded border border-slate-300 bg-white p-1.5 text-xs ${compact ? "w-full" : "max-w-full"}`}>
      {!subjects.includes(q.topic) && <option value={value}>{q.topic}{q.subtopic ? ` › ${q.subtopic}` : ""}</option>}
      {subjects.map((subject) => (
        <optgroup key={subject} label={subject}>
          <option value={`${subject}|||`}>{subject} (module not set)</option>
          {(LEARNING_MODULES[subject] ?? []).map((m) => <option key={m} value={`${subject}|||${m}`}>{m}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function QuestionCard({ q, onChange, onChecked, onFormat, onTopic, onlySubject }: { q: ParsedQuestion; onChange: (patch: QuestionPatch) => void; onChecked: () => void; onFormat: (on: boolean) => void; onTopic: (topic: string, subtopic: string) => void; onlySubject?: string | null }) {
  const [showPage, setShowPage] = useState(false);
  const [editText, setEditText] = useState(false);
  const problems = questionProblems(q);
  const tone = q.status === "ok" || q.status === "corrected" ? "border-slate-200" : "border-amber-300 bg-amber-50/40";
  const field = "w-full rounded border border-slate-300 bg-white p-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const imageMode = Boolean(q.showImage && q.crop && hasPageSource());
  const showText = !imageMode || editText;

  return (
    <article className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b>{q.session === 1 && onlySubject ? `Question ${q.n}` : `Session ${q.session}, question ${q.n}`}</b>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${q.status === "ok" ? "bg-green-100 text-green-800" : q.status === "corrected" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900"}`}>
          {q.status === "ok" ? (q.reason === "Checked by you" ? "Checked" : "OK") : q.status === "corrected" ? "Key corrected" : "Needs review"}
        </span>
      </div>
      {q.status !== "ok" && <p className="mt-1 text-sm text-amber-800">{q.reason ?? q.status}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="font-semibold">Topic</span><TopicSelect q={q} onPick={onTopic} onlySubject={onlySubject} />
      </div>

      {q.crop && hasPageSource() && (
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <input type="checkbox" checked={q.showImage === true} onChange={(e) => onFormat(e.target.checked)} />
          Show this question as printed (original picture) in the exam
        </label>
      )}

      {imageMode && (
        <div className="mt-3 rounded border border-blue-200 bg-blue-50/50 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-600">This is exactly what you will see in the exam:</p>
          <QuestionImage crop={q.crop as QuestionCrop} fallback={<p className="text-xs text-slate-500">Picture not available.</p>} />
        </div>
      )}

      {showText && (
        <label className="mt-3 block text-xs font-semibold text-slate-600">Question text
          <textarea value={q.stem} onChange={(e) => onChange({ stem: e.target.value })} rows={Math.min(8, Math.max(3, Math.ceil(q.stem.length / 90)))} className={`${field} mt-1`} />
        </label>
      )}

      <div className={`mt-3 ${showText ? "space-y-2" : ""}`}>
        {!showText && (
          <div className="flex flex-wrap items-center gap-4 rounded border border-slate-200 bg-white p-3">
            <span className="text-sm font-bold text-slate-800">Correct answer</span>
            {(["A", "B", "C"] as AnswerOption[]).map((k) => (
              <label key={k} className="flex items-center gap-1 text-sm font-bold text-slate-700"><input type="radio" name={`correct-${q.id}`} checked={q.correct === k} onChange={() => onChange({ correct: k })} /> {k}</label>
            ))}
            {q.keyCrop && hasPageSource() && (
              <div className={q.correct ? "ml-auto max-w-xs" : "w-full max-w-3xl"}><p className="mb-1 text-[11px] font-semibold text-slate-500">{q.correct ? "Printed answer key says:" : "No answer was read automatically. The printed answer key for this question is below. Choose A, B or C above."}</p><QuestionImage crop={q.keyCrop} fallback={<span className="text-xs text-slate-400">–</span>} /></div>
            )}
          </div>
        )}
        {showText && (["A", "B", "C"] as AnswerOption[]).map((k) => (
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
        {imageMode && (
          <button type="button" onClick={() => setEditText((v) => !v)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-100">{editText ? "Hide extracted text" : "Edit extracted text"}</button>
        )}
        {q.status === "needs_review" && (
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
  const mode = useExamStore((s) => s.mode);
  const subject = useExamStore((s) => s.practiceSubject);
  const durationSeconds = useExamStore((s) => s.sessionDurationSeconds);
  const practice = mode === "practice";
  const summary = useMemo(() => validateExam(examData as never[]), [examData]);
  const attention = useMemo(() => examData.filter((q) => q.status === "needs_review"), [examData]);
  const withPictures = examData.filter((q) => q.crop).length;
  const usingPictures = examData.filter((q) => q.showImage && q.crop).length;

  const [filter, setFilter] = useState<Filter>(attention.length ? "attention" : practice ? "s1" : "s1");
  // Cards stay visible after you fix them (otherwise they vanish while you are still typing).
  const [pinned, setPinned] = useState<string[]>(() => attention.map((q) => q.id));
  const [pageNo, setPageNo] = useState(0);
  const [prep, setPrep] = useState<{ done: number; total: number } | null>(null);

  // Cut every question out of the scan once, so the exam shows them instantly.
  useEffect(() => {
    if (!hasPageSource()) return;
    const crops = (useExamStore.getState().examData as unknown as ParsedQuestion[]).filter((q) => q.showImage && q.crop).map((q) => q.crop as QuestionCrop);
    if (!crops.length) return;
    let alive = true; setPrep({ done: 0, total: crops.length });
    prepareRegions(crops, (done, total) => { if (alive) setPrep({ done, total }); }).catch(() => undefined).finally(() => { if (alive) setPrep(null); });
    return () => { alive = false; };
  }, []);

  const list = filter === "attention" ? examData.filter((q) => pinned.includes(q.id) || q.status === "needs_review") : filter === "topics" ? examData : examData.filter((q) => practice || q.session === (filter === "s1" ? 1 : 2));
  const size = filter === "topics" ? 30 : PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(list.length / size));
  const visible = filter === "attention" ? list : list.slice(pageNo * size, (pageNo + 1) * size);

  const update = (id: string, fn: (q: ParsedQuestion) => ParsedQuestion) =>
    useExamStore.setState({ examData: examData.map((q) => (q.id === id ? fn(q) : q)) as never });

  const choose = (f: Filter) => { setFilter(f); setPageNo(0); if (f === "attention") setPinned(attention.map((q) => q.id)); };
  const tab = (f: Filter, label: string) => (
    <button type="button" onClick={() => choose(f)} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${filter === f ? "bg-blue-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"}`}>{label}</button>
  );
  const minutes = Math.round(durationSeconds / 60); const suggested = Math.max(1, Math.round(examData.length * 1.5));

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <section className="mx-auto max-w-4xl rounded-xl bg-white p-5 shadow sm:p-6">
        <h1 className="text-2xl font-bold">{attention.length ? `${attention.length} question${attention.length === 1 ? "" : "s"} need your help` : "Everything looks good"}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {practice ? <>{subject} · {examData.length} questions</> : <>Session 1: {summary.sessions[0].found}/90 · Session 2: {summary.sessions[1].found}/90</>} · all other questions were read fine and need nothing from you.
        </p>

        {withPictures > 0 ? (
          <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
            <p><b>How this works:</b> the exam shows each question as the picture cut from your PDF (options included), with Option A / B / C buttons below. Broken option text does not matter. For each question below, look at the picture and the printed answer key next to it, then tap the correct letter. Then press Start.</p>
            <p className="mt-1 text-xs text-slate-600">{usingPictures}/{withPictures} questions use the picture{prep ? ` · preparing pictures ${prep.done}/${prep.total}…` : ""}. You will see the key for these few questions before the exam.</p>
          </div>
        ) : (
          <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">Text is read locally from your file and can contain small mistakes. Use <b>Show original page</b> to compare, fix the text in the boxes, and pick the correct answer with the circles. Your edits are used in the exam.</p>
        )}

        {practice && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-slate-200 p-3 text-sm">
            <label className="font-semibold">Time limit (minutes)
              <input type="number" min={1} value={minutes} onChange={(e) => useExamStore.getState().setDurations(Math.max(1, Number(e.target.value) || 1), 0)} className="ml-2 w-24 rounded border border-slate-300 p-1.5" />
            </label>
            <button type="button" onClick={() => useExamStore.getState().setDurations(suggested, 0)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-100">Use exam pace: {suggested} min (1.5 min per question)</button>
            <span className="text-xs text-slate-500">One session, no break.</span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {tab("attention", `Needs review (${attention.length})`)}
          {practice ? tab("s1", "All questions") : <>{tab("s1", "All – Session 1")}{tab("s2", "All – Session 2")}</>}
          {tab("topics", "Check topics")}
        </div>

        <div className="mt-4 space-y-4">
          {visible.length === 0 && <p className="rounded bg-green-50 p-4 text-sm text-green-800">Nothing needs review. Open “All” to spot-check any question.</p>}
          {filter === "topics" ? (
            <div className="overflow-x-auto rounded border border-slate-200">
              <p className="border-b bg-slate-50 p-3 text-xs text-slate-600">Topics were matched with the Juice notes. If one looks wrong, pick the right subject and learning module here.</p>
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Q</th><th className="px-3 py-2">Question starts with…</th><th className="px-3 py-2">Subject › learning module</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(visible as ParsedQuestion[]).map((q) => (
                    <tr key={q.id}><td className="px-3 py-2 font-bold">{practice ? q.n : `S${q.session}·${q.n}`}</td><td className="max-w-xs px-3 py-2 text-slate-600">{(q.stem || "(picture only)").slice(0, 90)}</td>
                      <td className="px-3 py-2"><TopicSelect compact q={q} onlySubject={practice ? subject : null} onPick={(topic, subtopic) => update(q.id, (cur) => ({ ...cur, topic, subtopic }))} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : visible.map((q) => (
            <QuestionCard key={q.id} q={q} onlySubject={practice ? subject : null}
              onChange={(patch) => update(q.id, (cur) => applyEdit(cur, patch))} onChecked={() => update(q.id, markChecked)}
              onFormat={(on) => update(q.id, (cur) => applyDisplayStatus({ ...cur, showImage: on }))} onTopic={(topic, subtopic) => update(q.id, (cur) => ({ ...cur, topic, subtopic }))} />
          ))}
        </div>

        {filter !== "attention" && pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <button type="button" disabled={pageNo === 0} onClick={() => setPageNo((p) => p - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">← Previous</button>
            <span>Questions {pageNo * size + 1}–{Math.min(list.length, (pageNo + 1) * size)} of {list.length}</span>
            <button type="button" disabled={pageNo >= pages - 1} onClick={() => setPageNo((p) => p + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Next →</button>
          </div>
        )}

        <div className="mt-6 border-t pt-4">
          {attention.length > 0 && <p className="mb-2 text-sm text-amber-800">{attention.length} question{attention.length === 1 ? "" : "s"} still need review. You can start anyway; unanswered keys are shown as “Not scored”.</p>}
          <button type="button" onClick={() => startSession(1)} className="rounded bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800">
            {attention.length ? "Start exam anyway" : "Start exam"}
          </button>
        </div>
      </section>
    </main>
  );
}
