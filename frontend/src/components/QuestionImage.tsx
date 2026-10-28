"use client";

import { useEffect, useState } from "react";
import { getRegionImage } from "../lib/pipeline/pageSource";
import type { QuestionCrop } from "../lib/pipeline/types";

/** Shows the question exactly as printed (tables, figures, layout) by cutting it out of the scanned page. */
export function QuestionImage({ crop, fallback, onFail }: { crop: QuestionCrop; fallback?: React.ReactNode; onFail?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const key = JSON.stringify(crop);

  useEffect(() => {
    let alive = true; setState("loading"); setSrc(null);
    getRegionImage(crop).then((url) => { if (!alive) return; if (url) { setSrc(url); setState("ok"); } else { setState("failed"); onFail?.(); } }).catch(() => { if (alive) { setState("failed"); onFail?.(); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (state === "failed") return <>{fallback ?? null}</>;
  if (state === "loading" || !src) return <div className="rounded border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">Loading question…</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Question as printed in the original exam" className="mx-auto block h-auto max-w-full rounded border border-slate-200 bg-white" />;
}
