import { marker, parseAnswer, parseQuestion } from "./parser";
import { withTopic } from "./topics";
import type { AnswerOption, OcrPages, ParsedQuestion } from "./types";

/** Ways a question can be numbered. Group 1 is the number, group 2 is any text on the same line. */
export const NUMBER_STYLES: Array<{ name: string; re: RegExp; strict: boolean }> = [
  { name: "Question N", re: /^\W*(?:\w{1,4}\s+)?(?:Question\s+(?=\d)|(?=\d{1,3}\s+of\s+\d))(\d{1,3})\b[\s:;.,|'’)\-–]*(.*)$/i, strict: false }, // also a bare "19 of 106" when the OCR lost the word Question on a tilted page
  { name: "Q N", re: /^\W*Q\.?\s*(\d{1,3})\s*[.):\-–]\s*(.*)$/i, strict: false },
  { name: "N.", re: /^\W{0,2}(\d{1,3})\s*[.)]\s+(\S.*)$/, strict: true },
];
const KEY_HEAD = /^\W*(?:answer\s*key|answers?(?:\s*(?:&|and)\s*(?:explanations?|solutions?))?|solutions?|answer\s*sheet)\W*$/i;
const INLINE_ANSWER = /^\W*(?:correct\s+)?(?:answer|ans)\s*[:\-–=]?\s*\(?([ABCabc])\)?(?:[\s.,)\]:-]|$)\s*(.*)$/i;
/** "Answer 12 of 106" heading that starts every solution block in premium packs. */
export const ANSWER_HEAD = /^\W*(?:\w{1,4}\s+)?Answer\s+(\d{1,3})\s+of\s+\d{1,3}\b/i;
/** Solutions print "A. Incorrect because ... B. Correct because ...": the correct letter is the one NOT marked incorrect. */
export function solutionLetter(lines: string[]): AnswerOption | null {
  const text = lines.join(" ");
  // Most reliable: every option block opens with "Incorrect because ..." or "Correct because ...", in the order A, B, C. OCR often garbles the labels
  // ("Cc.", "B:", "Gs") and the word "Incorrect" ("Incurrect"), so read the markers in order and ignore the labels.
  const markers = [...text.matchAll(/(?<![A-Za-z])([il1I]?[nu]?c[o0u][nrm]{1,2}[ec]{1,2}[ct1l]?)(?=\s+because\b|[.,]\s)/gi)].map((m) => !/^[il1nu]/i.test(m[1]));
  if (markers.length === 3 && markers.filter(Boolean).length === 1) return (["A", "B", "C"] as AnswerOption[])[markers.indexOf(true)];
  const parts = text.split(/(?:^|\s)(?=[ABC][.)]\s)/).map((p) => p.trim()).filter((p) => /^[ABC][.)]\s/.test(p));
  const bad = /[il1I]ncor+ec|ncorect|ncorr/i;
  const good = parts.filter((p) => !bad.test(p.slice(0, 40)) && /^[ABC][.)]\s+\W{0,2}(?:Co|C0|Cc)/i.test(p));
  if (good.length === 1) return good[0][0] as AnswerOption;
  const notBad = parts.filter((p) => !bad.test(p.slice(0, 40)));
  const letters = new Set(notBad.map((p) => p[0]));
  if (letters.size === 1 && parts.length >= 2) return [...letters][0] as AnswerOption;
  // OCR sometimes misreads the label of the correct option (C. read as Gs or Cc): with exactly two options marked Incorrect and the words Correct because, the third letter is the answer.
  const wrong = new Set(parts.filter((p) => bad.test(p.slice(0, 40))).map((p) => p[0]));
  if (wrong.size === 2 && /(?:^|[^a-z])Correct\s+bec/i.test(text.replace(/[il1I]ncorrect/gi, ""))) return (["A", "B", "C"] as AnswerOption[]).find((l) => !wrong.has(l)) ?? null;
  return null;
}
const EXPLANATION = /^\W*(?:explanation|solution|rationale|reasoning)\b\s*[:\-–]?\s*(.*)$/i;

/** Accepts a numbered line only when the numbers run 1, 2, 3 ... (small gaps allowed when the style is not strict). */
export function acceptChain(numbers: number[], strict: boolean): boolean[] {
  let last = 0; return numbers.map((n) => {
    const ok = last === 0 ? n >= 1 && n <= 3 : strict ? n === last + 1 : n > last && n <= last + 3;
    if (ok) last = n; return ok;
  });
}

type Line = { line: string; page: number };

/** Removes headers/footers that repeat on many pages and bare page numbers at the top or bottom of a page. */
function cleanPractice(pages: OcrPages): Line[] {
  const entries = Object.entries(pages).sort(([a], [b]) => Number(a) - Number(b));
  const norm = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
  const seen = new Map<string, number>();
  const split = entries.map(([page, text]) => ({ page: Number(page), lines: text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) }));
  const edge = (lines: string[], i: number) => i < 3 || i >= lines.length - 3; // headers and footers sit at the top or bottom of a page
  split.forEach(({ lines }) => new Set(lines.filter((l, i) => edge(lines, i)).map(norm)).forEach((k) => seen.set(k, (seen.get(k) ?? 0) + 1)));
  const repeat = split.length >= 4 ? Math.max(3, Math.ceil(split.length * 0.4)) : Infinity;
  const out: Line[] = [];
  for (const { page, lines } of split) lines.forEach((line, i) => {
    if (edge(lines, i) && (seen.get(norm(line)) ?? 0) >= repeat && line.length < 90 && !NUMBER_STYLES.some((s) => s.re.test(line)) && !ANSWER_HEAD.test(line) && !/^[ABC][.)]\s/.test(line)) return;
    if ((i === 0 || i === lines.length - 1) && /^(?:page\s*)?\d{1,3}$/i.test(line)) return;
    out.push({ line, page });
  });
  return out;
}

export interface PracticeParse { questions: ParsedQuestion[]; style: { re: RegExp; strict: boolean } | null; stop?: RegExp; keyFound: boolean; }

export function parsePracticePages(pages: OcrPages, subject: string): PracticeParse {
  const lines = cleanPractice(pages);
  // Question part ends where the answer key begins (a short line that only says "Answers" / "Answer key" / "Solutions").
  let seenQuestions = 0; let keyStart = -1; let headIsAnswer = false;
  const anyStart = (l: string) => NUMBER_STYLES.some((s) => s.re.test(l));
  lines.forEach(({ line }, i) => { if (keyStart >= 0) return; if (anyStart(line)) seenQuestions += 1; if (seenQuestions >= 3 && ANSWER_HEAD.test(line)) { keyStart = i; headIsAnswer = true; } else if (seenQuestions >= 3 && KEY_HEAD.test(line) && line.length < 40) keyStart = i; });
  const qLines = keyStart >= 0 ? lines.slice(0, keyStart) : lines; const kLines = keyStart >= 0 ? lines.slice(keyStart + (headIsAnswer ? 0 : 1)) : [];

  // pick the numbering style that produces the longest 1, 2, 3 ... run
  let best: { style: typeof NUMBER_STYLES[number]; idx: number[]; nums: number[] } | null = null;
  for (const style of NUMBER_STYLES) {
    const hits = qLines.map((l, i) => ({ i, m: style.re.exec(l.line) })).filter((h) => h.m);
    const nums = hits.map((h) => Number(h.m![1])); const ok = acceptChain(nums, style.strict);
    let idx = hits.filter((_, k) => ok[k]).map((h) => h.i);
    if (style.strict) idx = idx.filter((i) => qLines.slice(i, i + 14).some((l, k) => k > 0 && /^[\W_]{0,2}[Aa][.,)]\s/.test(l.line))); // "12." lines only count when options follow
    if (idx.length > (best?.idx.length ?? 0)) best = { style, idx, nums: idx.map((i) => Number(style.re.exec(qLines[i].line)![1])) };
  }
  if (!best || best.idx.length < 3) return { questions: [], style: null, keyFound: false };

  // answer key entries: "Answer 12 / B. text" blocks, or "12. B", "12 B", "Q12: B" on one or several per line
  const keyMap = new Map<number, AnswerOption>(); const keyPages = new Map<number, number>();
  if (kLines.length) {
    let number: number | null = null; const blocks = new Map<number, string[]>(); const blockPage = keyPages; const answerMarker = marker("Answer");
    for (const { line, page } of kLines) { const m = ANSWER_HEAD.exec(line) ?? answerMarker.exec(line); if (m) { number = Number(m[1]); blocks.set(number, []); blockPage.set(number, page); } else if (number !== null) blocks.get(number)!.push(line); }
    for (const [n, ls] of blocks) { const letter = solutionLetter(ls) ?? (headIsAnswer ? null : parseAnswer(ls)[0]); if (letter) keyMap.set(n, letter); }
    const pair = /(?:^|[\s|;,(])(?:Q\.?\s*)?(\d{1,3})\s*[.):\-–=]?\s*\(?([ABCabc])\)?(?=[\s.,;|)]|$)/g;
    if (!headIsAnswer) for (const { line } of kLines) for (const m of line.matchAll(pair)) { const n = Number(m[1]); if (!keyMap.has(n)) keyMap.set(n, m[2].toUpperCase() as AnswerOption); }
  }

  const questions: ParsedQuestion[] = [];
  best.idx.forEach((start, k) => {
    const end = k + 1 < best!.idx.length ? best!.idx[k + 1] : qLines.length; const n = best!.nums[k];
    const first = (best!.style.re.exec(qLines[start].line)![2] ?? "").replace(/^of\s+\d{1,3}\b\W*/i, ""); let body = [...(first ? [first] : []), ...qLines.slice(start + 1, end).map((l) => l.line).filter((l) => !/^\W*Questions?\W*$/i.test(l))];
    let inline: AnswerOption | null = null; const extra: string[] = [];
    const cut = body.findIndex((l) => INLINE_ANSWER.test(l) || EXPLANATION.test(l));
    if (cut >= 0) {
      const tail = body.slice(cut); body = body.slice(0, cut);
      const a = INLINE_ANSWER.exec(tail[0]); if (a) { inline = a[1].toUpperCase() as AnswerOption; if (a[2]) extra.push(a[2]); extra.push(...tail.slice(1)); }
      else { const e = EXPLANATION.exec(tail[0]); extra.push(...(e?.[1] ? [e[1]] : []), ...tail.slice(1)); }
      const inlineInTail = tail.slice(1).map((l) => INLINE_ANSWER.exec(l)).find(Boolean); if (!inline && inlineInTail) inline = inlineInTail[1].toUpperCase() as AnswerOption;
    }
    const parsed = parseQuestion(body); const correct = keyMap.get(n) ?? inline ?? null;
    const optionsUnread = !parsed.options.A || !parsed.options.B || !parsed.options.C;
    const keyIssue = correct ? undefined : "No answer was found for this question.";
    const status: ParsedQuestion["status"] = optionsUnread || keyIssue ? "needs_review" : "ok";
    const explanation = extra.join(" ").replace(/\s+/g, " ").trim() || undefined;
    questions.push(withTopic({ id: `1-${n}`, session: 1, n, stem: parsed.stem, A: parsed.options.A ?? "", B: parsed.options.B ?? "", C: parsed.options.C ?? "", correct, status, reason: optionsUnread ? "One or more answer options could not be read." : keyIssue, sourcePage: qLines[start].page, keyPage: keyPages.get(n), optionsUnread, keyIssue, explanation } as Omit<ParsedQuestion, "topic" | "subtopic"> as never, subject));
  });
  return { questions, style: best.style, stop: kLines.length ? (headIsAnswer ? ANSWER_HEAD : KEY_HEAD) : undefined, keyFound: keyMap.size > 0 || questions.some((q) => q.correct) };
}
