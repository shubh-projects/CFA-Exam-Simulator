import { formatDuration, percent, weakestModules, type Analysis, type QuestionResult } from "./analysis";

export interface ReportMeta { title: string; practice: boolean; subject?: string | null; timeLimitSeconds?: number; }
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const LABEL: Record<string, string> = { correct: "Correct", incorrect: "Incorrect", unanswered: "Not answered", "not-scored": "Not scored" };

function bar(p: number) { return `<div class="bar"><div style="width:${p}%"></div></div>`; }

function questionHtml(r: QuestionResult, img: string | undefined): string {
  const q = r.question; const opts = (["A", "B", "C"] as const).map((k) => {
    const cls = k === r.correctOption ? "opt good" : k === r.selectedOption ? "opt bad" : "opt";
    return `<li class="${cls}"><b>${k}</b> ${esc(q[k])}${k === r.correctOption ? " <span class=tag>correct</span>" : ""}${k === r.selectedOption ? " <span class=tag>your answer</span>" : ""}</li>`;
  }).join("");
  const body = img ? `<img src="${img}" alt="Question ${r.index + 1}">` : `<p class="stem">${esc(q.stem || "Question text unavailable.")}</p><ul class="opts">${opts}</ul>`;
  const verdict = r.status === "correct" ? `Correct — your answer: ${r.selectedOption}` : r.status === "incorrect" ? `Your answer: ${r.selectedOption} · Correct answer: ${r.correctOption}` : r.status === "unanswered" ? `Not answered · Correct answer: ${r.correctOption}` : "This question was not scored.";
  const where = [r.topic, r.subtopic].filter(Boolean).join(" › ");
  return `<article class="q ${r.status}${r.isFlg ? " flagged" : ""}" data-status="${r.status}" data-flag="${r.isFlg ? 1 : 0}" data-session="${r.session}">
  <div class="qh"><b>Question ${r.index + 1}</b><span class="meta">${esc(where)} · ${formatDuration(r.timeSpentMs)}</span><span class="pill ${r.status}">${LABEL[r.status]}</span>${r.isFlg ? '<span class="pill flag">Flagged</span>' : ""}</div>
  ${body}<div class="verdict ${r.status}">${esc(verdict)}</div>${q.explanation ? `<p class="expl">${esc(q.explanation)}</p>` : ""}</article>`;
}

/** One self-contained HTML file (works offline, prints to PDF). Question images are embedded when given. */
export function buildReportHtml(a: Analysis, meta: ReportMeta, images: Map<string, string> = new Map(), when = new Date()): string {
  const pass = a.scorePercentage >= 70; const weak = weakestModules(a);
  const sessionRows = meta.practice ? "" : ([1, 2] as const).map((s) => { const m = a.sessions.get(s)!; return `<tr><td>Session ${s}</td><td>${m.total}</td><td class=g>${m.correct}</td><td class=r>${m.incorrect}</td><td>${m.unanswered}</td><td>${formatDuration(m.timeSpentMs)}</td></tr>`; }).join("");
  const summary = meta.practice
    ? `<tr><td>${esc(meta.subject || "Practice test")}</td><td>${a.results.length}</td><td class=g>${a.totalCorrect}</td><td class=r>${a.results.filter((r) => r.status === "incorrect").length}</td><td>${a.results.filter((r) => r.status === "unanswered").length}</td><td>${formatDuration(a.totalTimeMs)}${meta.timeLimitSeconds ? ` of ${formatDuration(meta.timeLimitSeconds * 1000)}` : ""}</td></tr>` : sessionRows;
  const topicRows = a.topics.map((t) => `<tr class="subj"><td>${esc(t.topic)}</td><td>${percent(t)}% <small>(${t.correct}/${t.total})</small></td><td>${bar(percent(t))}</td></tr>` + t.modules.map((m) => `<tr class="mod"><td>${esc(m.name)}</td><td>${percent(m)}% <small>(${m.correct}/${m.total})</small></td><td>${bar(percent(m))}</td></tr>`).join("")).join("");
  const weakRows = weak.length ? `<ol>${weak.map((m) => `<li><b>${esc(m.name)}</b> <small>(${esc(m.topic)})</small> — ${percent(m)}% (${m.correct}/${m.total})</li>`).join("")}</ol>` : "<p class=muted>Not enough questions per module yet.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(meta.title)}</title>
<style>
*{box-sizing:border-box}body{font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;margin:0;background:#f1f5f9;color:#0f172a}main{max-width:980px;margin:0 auto;padding:24px 16px 60px}
header.top{background:#0f172a;color:#fff;border-radius:16px;padding:24px 28px;display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}
header.top h1{margin:4px 0;font-size:26px}header.top small{color:#cbd5e1}.score{text-align:center;background:#fff;color:#0f172a;border-radius:14px;padding:12px 26px}.score b{font-size:36px;display:block}.score span{font-weight:700;font-size:12px;letter-spacing:.08em;color:${pass ? "#059669" : "#d97706"}}
section{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px 22px;margin-top:18px}h2{margin:0 0 12px;font-size:18px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle}th{font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:.05em}
.g{color:#047857;font-weight:700}.r{color:#b91c1c;font-weight:700}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.card{border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}.card b{font-size:26px;display:block}.card span{font-size:12px;color:#64748b}
.bar{height:8px;width:140px;background:#e2e8f0;border-radius:99px;overflow:hidden}.bar div{height:100%;background:#2563eb}tr.subj td{font-weight:700;background:#f8fafc}tr.mod td:first-child{padding-left:28px;font-weight:400}small,.muted{color:#64748b}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px}.filters button{border:1px solid #cbd5e1;background:#fff;border-radius:99px;padding:5px 12px;font-weight:700;font-size:12px;cursor:pointer}.filters button.on{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
.q{border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-top:12px;break-inside:avoid}.qh{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}.qh .meta{color:#64748b;font-size:12px;flex:1}
.pill{border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700;background:#e2e8f0}.pill.correct{background:#d1fae5;color:#065f46}.pill.incorrect{background:#fee2e2;color:#991b1b}.pill.unanswered{background:#fef3c7;color:#92400e}.pill.flag{background:#fef9c3;color:#854d0e}
.q img{max-width:100%;height:auto;border:1px solid #e2e8f0;border-radius:8px;display:block}.stem{white-space:pre-line;margin:6px 0}.opts{list-style:none;padding:0;margin:6px 0}.opt{padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;margin:4px 0}.opt.good{background:#ecfdf5;border-color:#6ee7b7}.opt.bad{background:#fef2f2;border-color:#fca5a5}.tag{font-size:11px;font-weight:700;color:#475569}
.verdict{margin-top:10px;border-radius:8px;padding:8px 12px;font-weight:600;background:#f8fafc;border:1px solid #e2e8f0}.verdict.correct{background:#ecfdf5;border-color:#a7f3d0;color:#065f46}.verdict.incorrect{background:#fef2f2;border-color:#fecaca;color:#991b1b}.expl{border-left:4px solid #3b82f6;background:#eff6ff;padding:8px 12px;margin:10px 0 0}
.toolbar{margin-top:16px;display:flex;gap:8px}.toolbar button{border:0;background:#1d4ed8;color:#fff;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}
@media print{body{background:#fff}.filters,.toolbar{display:none}section,.q{border-color:#cbd5e1}.q{break-inside:avoid}}
</style></head><body><main>
<header class="top"><div><small>${meta.practice ? "PRACTICE TEST" : "MOCK EXAM"} · ${esc(when.toLocaleString())}</small><h1>${esc(meta.title)}</h1><small>${a.results.length} questions · average ${formatDuration(a.averageTimeMs)} per question · total time ${formatDuration(a.totalTimeMs)}</small></div>
<div class="score"><b>${a.scorePercentage}%</b><span>${pass ? "PASS" : "NEEDS WORK"}</span></div></header>
<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
<section><h2>${meta.practice ? "Summary" : "Session breakdown"}</h2><table><thead><tr><th>${meta.practice ? "Test" : "Session"}</th><th>Questions</th><th>Correct</th><th>Incorrect</th><th>Unanswered</th><th>Time used</th></tr></thead><tbody>${summary}</tbody></table></section>
<section><h2>Pacing matrix</h2><div class="grid"><div class="card"><b>${a.pacing.fastAccurate}</b><span>Fast &amp; accurate (correct in under 65 s)</span></div><div class="card"><b>${a.pacing.timeSinks}</b><span>Time sinks (wrong after 110 s+)</span></div><div class="card"><b>${a.pacing.rushedErrors}</b><span>Rushed errors (wrong in under 30 s)</span></div><div class="card"><b>${a.pacing.grindWins}</b><span>Grind wins (correct after 110 s+)</span></div></div></section>
<section><h2>Answer-switch tracker</h2><div class="grid"><div class="card"><b class=g>${a.switches.wrongToRight}</b><span>Wrong → Right</span></div><div class="card"><b class=r>${a.switches.rightToWrong}</b><span>Right → Wrong</span></div><div class="card"><b>${a.switches.wrongToWrong}</b><span>Wrong → Wrong</span></div></div></section>
<section><h2>Weakest learning modules</h2>${weakRows}</section>
<section><h2>Topic performance</h2><table><thead><tr><th>Subject / learning module</th><th>Score</th><th>Progress</th></tr></thead><tbody>${topicRows}</tbody></table></section>
<section><h2>Question review</h2><div class="filters" id="f">${([["all", "All"], ["correct", "Correct"], ["incorrect", "Incorrect"], ["unanswered", "Not answered"], ["not-scored", "Not scored"], ["flag", "Flagged"]] as const).map(([v, l], i) => `<button data-f="${v}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div>
${a.results.map((r) => questionHtml(r, images.get(r.question.id))).join("\n")}</section>
</main><script>
document.getElementById("f").addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var v=b.dataset.f;document.querySelectorAll("#f button").forEach(function(x){x.classList.toggle("on",x===b)});
document.querySelectorAll(".q").forEach(function(q){q.style.display=(v==="all"||(v==="flag"?q.dataset.flag==="1":q.dataset.status===v))?"":"none"})});
</script></body></html>`;
}

export function downloadHtml(html: string, filename: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Opens the browser's print dialog (choose "Save as PDF") for the same report. */
export function printHtml(html: string) {
  const frame = document.createElement("iframe"); frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"; document.body.appendChild(frame);
  frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 60000); }; frame.srcdoc = html;
}
