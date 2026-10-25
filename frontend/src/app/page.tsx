"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { FileUp, LoaderCircle, Play, TimerReset } from "lucide-react";

import { ExamEngine } from "../components/ExamEngine";
import { ResultsDashboard } from "../components/ResultsDashboard";
import { type ExamQuestion, useExamStore } from "../store/useExamStore";
import { parseOcrPages } from "../lib/pipeline/parser";
import { mergePasses } from "../lib/pipeline/merge";
import type { ParseResult } from "../lib/pipeline/types";
import { ocrImages } from "../lib/pipeline/ocr";
import { localDb } from "../lib/db/local";
import { ReviewScreen } from "../components/ReviewScreen";
import { setPageSource } from "../lib/pipeline/pageSource";

type UploadType = "mock" | "practice";

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function HomePage() {
  const {
    phase,
    breakTimeLeft,
    setExamData,
    setDurations,
    startSession,
    tick,
  } = useExamStore();
  const [files, setFiles] = useState<File[]>([]);
  const [uploadType, setUploadType] = useState<UploadType>("mock");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [sessionMinutes, setSessionMinutes] = useState(100);
  const [breakMinutes, setBreakMinutes] = useState(31);

  const openReview = (pages: Record<string, string>) => openParsed(parseOcrPages(pages));
  const openParsed = (parsed: ParseResult) => {
    if (!parsed.questions.length) throw new Error("No questions found. Check the format guide or try clearer source pages.");
    const questions = uploadType === "practice" ? [...parsed.questions].sort(() => Math.random() - 0.5) : parsed.questions;
    setExamData(questions as ExamQuestion[]); setDurations(sessionMinutes, breakMinutes); useExamStore.setState({ phase: "review" });
  };

  async function handleImages(event: ChangeEvent<HTMLInputElement>) {
    const imageFiles = Array.from(event.target.files ?? []); if (!imageFiles.length) return;
    setIsLoading(true); setError(null);
    try { setPageSource(async (page) => { const bitmap = await createImageBitmap(imageFiles[page]); const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext("2d")!.drawImage(bitmap, 0, 0); bitmap.close(); return canvas; }, imageFiles.length); const jobId = crypto.randomUUID(); const pages = await ocrImages(jobId, imageFiles.map((image, page) => ({ page, image })), (progress) => setError(progress.stage)); openReview(pages); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Image OCR failed."); } finally { setIsLoading(false); }
  }

  type PdfLike = { numPages: number; getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>; render(o: unknown): { promise: Promise<void> }; cleanup?: () => void }> };

  async function renderPdfPage(pdf: PdfLike, pageIndex: number, dpi: number): Promise<HTMLCanvasElement> {
    const source = await pdf.getPage(pageIndex + 1); const viewport = source.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement("canvas"); canvas.width = viewport.width; canvas.height = viewport.height;
    await source.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise; source.cleanup?.();
    return canvas;
  }

  async function handlePdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 60 * 1024 * 1024) setError("Large PDF: processing may be slow on this device.");
    setIsLoading(true); setError(null);
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      // wasmUrl: scanned PDFs are usually JBIG2/JPEG2000 compressed; without these decoders pages render blank
      const pdf = (await pdfjs.getDocument({ data: await file.arrayBuffer(), wasmUrl: "/pdfjs/wasm/" }).promise) as unknown as PdfLike;
      if (pdf.numPages > 150) setError("Large PDF: more than 150 pages.");
      setPageSource((page) => renderPdfPage(pdf, page, 110), pdf.numPages); // lets the review screen show the original page
      const direct: Record<string, string> = {}; const needOcr: number[] = []; const jobId = crypto.randomUUID();
      for (let page = 1; page <= pdf.numPages; page += 1) {
        const source = await pdf.getPage(page); const content = await source.getTextContent(); const text = content.items.map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : " ")).join("");
        if (text.length >= 200) { direct[String(page - 1)] = text; await localDb.pageText.put({ id: `${jobId}:text:${page - 1}`, jobId, page: page - 1, text, pass: "a" }); } else needOcr.push(page - 1);
        setError(`Reading PDF (page ${page} of ${pdf.numPages})`);
      }
      // Pass 1: every scanned page at 200 DPI. Pages are rendered one at a time (keeps memory low).
      const first = needOcr.length ? await ocrImages(jobId, needOcr.map((page) => ({ page, image: () => renderPdfPage(pdf, page, 200) })), (progress) => setError(progress.stage)) : {};
      const pagesA = { ...direct, ...first }; let parsed = parseOcrPages(pagesA);
      // Pass 2: automatically re-read ONLY the pages behind flagged questions, at 300 DPI with another layout mode, and keep the better result.
      const flagged = parsed.questions.filter((question) => question.status === "needs_review");
      const redo = new Set<number>();
      flagged.forEach((question) => [question.sourcePage, question.sourcePage + 1, question.keyPage].forEach((page) => { if (page !== undefined && needOcr.includes(page)) redo.add(page); }));
      if (redo.size) {
        const second = await ocrImages(jobId, [...redo].map((page) => ({ page, image: () => renderPdfPage(pdf, page, 300) })), (progress) => setError(`Re-reading ${redo.size} difficult pages: ${progress.done} of ${progress.total}`), "b");
        const parsedB = parseOcrPages({ ...pagesA, ...second });
        parsed = { ...parsedB, questions: mergePasses(parsed.questions, parsedB.questions) };
      }
      openParsed(parsed);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unreadable or password-protected PDF."); } finally { setIsLoading(false); }
  }

  useEffect(() => {
    if (phase !== "session1" && phase !== "session2" && phase !== "break") return;

    const intervalId = window.setInterval(tick, 1_000);
    return () => window.clearInterval(intervalId);
  }, [phase, tick]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0 && !pastedText.trim()) {
      setError("Choose a text file or paste exam text before processing.");
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const fileText = files.length ? (await Promise.all(files.map((file) => file.text()))).join("\n") : "";
      setPageSource(null, 0);
      openReview({ "0": `${fileText}\n${pastedText}` });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "An unexpected upload error occurred.");
    } finally {
      setIsLoading(false);
    }
  }

  if (phase === "session1" || phase === "session2") return <ExamEngine />;
  if (phase === "results") return <ResultsDashboard />;
  if (phase === "review") return <ReviewScreen />;

  if (phase === "break") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <section className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl sm:p-12">
          <TimerReset className="mx-auto text-blue-300" size={42} aria-hidden="true" />
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-blue-300">Scheduled break</p>
          <h1 className="mt-2 text-3xl font-bold">Session 1 Complete</h1>
          <p className="mt-4 text-slate-300">Take a moment away from the screen. Session 2 will use a fresh 100-minute timer.</p>
          <p className="my-8 font-mono text-6xl font-bold tracking-tight tabular-nums text-white">{formatTime(breakTimeLeft)}</p>
          <button
            type="button"
            onClick={() => startSession(2)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-slate-900"
          >
            <Play size={18} fill="currentColor" /> Start Session 2
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-5 sm:p-8">
      <section className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-7 shadow-xl sm:p-10">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
          <FileUp size={25} aria-hidden="true" />
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-blue-700">CFA Exam Simulation</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Prepare your exam shift</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">All processing happens in this browser. Start with text/Markdown or paste; the OCR pipeline is also local.</p>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-800">Exam text / Markdown files</span>
            <input
              type="file"
              accept="text/plain,text/markdown,.txt,.md"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="block w-full cursor-pointer rounded-lg border border-slate-300 bg-slate-50 text-sm text-slate-700 file:mr-4 file:border-0 file:bg-slate-200 file:px-4 file:py-3 file:text-sm file:font-semibold file:text-slate-800 hover:file:bg-slate-300"
            />
            <span className="mt-2 block text-xs text-slate-500">{files.length === 0 ? "Select one or more text files." : `${files.length} file${files.length === 1 ? "" : "s"} selected.`}</span>
          </label>
          <label className="block rounded border border-dashed border-slate-300 p-3 text-sm font-semibold">PDF (text layer first; local OCR for scans)<input type="file" accept="application/pdf" onChange={handlePdf} className="mt-2 block w-full text-xs" /></label>
          <label className="block"><span className="mb-2 block text-sm font-semibold">Or paste exam text</span><textarea value={pastedText} onChange={(event) => setPastedText(event.target.value)} className="h-40 w-full rounded border border-slate-300 p-3 font-mono text-xs" placeholder="Session 1 - Questions..." /></label>
          <label className="block rounded border border-dashed border-slate-300 p-3 text-sm font-semibold">Page images (PNG/JPG, processed locally)<input type="file" accept="image/png,image/jpeg" multiple onChange={handleImages} className="mt-2 block w-full text-xs" /></label>
          <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Session minutes<input type="number" min="1" value={sessionMinutes} onChange={(event) => setSessionMinutes(Number(event.target.value))} className="mt-1 w-full rounded border p-2" /></label><label className="text-sm font-semibold">Break minutes<input type="number" min="0" value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value))} className="mt-1 w-full rounded border p-2" /></label></div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-800">Upload type</span>
            <select value={uploadType} onChange={(event) => setUploadType(event.target.value as UploadType)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">
              <option value="mock">Mock exam — one PDF, preserved order</option>
              <option value="practice">Practice pack — multiple PDFs, shuffled topics</option>
            </select>
          </label>

          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

          <button type="submit" disabled={isLoading} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400">
            {isLoading ? <LoaderCircle className="animate-spin" size={19} /> : <Play size={19} fill="currentColor" />}
            {isLoading ? "Finding questions locally..." : "Check extracted questions"}
          </button>
        </form>
      </section>
    </main>
  );
}

