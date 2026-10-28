import { withTopic } from "./topics";
import type { AnswerOption, OcrPages, ParseResult, ParsedQuestion } from "./types";

export const HEADER = /Session\s*([12])\s*[-–—]\s*(Questions?|Answers?)/i;
export const NOISE = /Mahakali\s+Book\s+Centre/i;
export const marker = (word: "Question" | "Answer") => new RegExp(`^\\W*(?:\\w{1,4}\\s+)?${word}\\s+(\\d{1,2})\\b[\\s:;.,|'’]*[A-Za-z]?\\W*$`, "i");
const optionPattern: Record<AnswerOption, RegExp> = {
  A: /(?:^|[\s_|])([Aa])[\.,\)]\s*/m,
  B: /(?:^|[\s_|])([Bbg8])[\.,\)]\s*/m,
  C: /(?:^|[\s_|])([Cc¢]c?)(?:[\.,\)]\s*|(?=\d))/m,
};

type Section = { session: 1 | 2; kind: "q" | "a" };
type Item = { lines: string[]; page: number };

function cleanLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => NOISE.test(line) ? line.replace(NOISE, "").trim() : line.trim())
    .filter((line) => line && !HEADER.test(line) && !/^\d{1,2}$/.test(line) && !/^(?:\S{0,8}\s+)?Mock\s+Exa/i.test(line));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[−–]/g, "-").replace(/[^a-z0-9%$.\-]+/g, " ").replace(/^\s*[. ]+|[. ]+\s*$/g, "").trim();
}

/** Ratcliff/Obershelp matching-runs ratio; equivalent to SequenceMatcher's score for short OCR strings. */
export function similarity(left: string, right: string): number {
  const a = normalize(left); const b = normalize(right);
  const longest = (x: string, y: string): [number, number, number] => {
    let length = 0; let endX = 0; let endY = 0;
    const row = Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i += 1) for (let j = y.length; j >= 1; j -= 1) {
      row[j] = x[i - 1] === y[j - 1] ? row[j - 1] + 1 : 0;
      if (row[j] > length) { length = row[j]; endX = i; endY = j; }
    }
    return [length, endX - length, endY - length];
  };
  const matches = (x: string, y: string): number => {
    const [length, xi, yi] = longest(x, y);
    return length === 0 ? 0 : length + matches(x.slice(0, xi), y.slice(0, yi)) + matches(x.slice(xi + length), y.slice(yi + length));
  };
  return a.length + b.length === 0 ? 1 : (2 * matches(a, b)) / (a.length + b.length);
}

const looseA = /(?:^|[\s_|])([Aa])(?:[\.,\)]\s*|\s+(?=[\d$£€(−-]))/m; // "| A 1,102." (dot lost by OCR) - used only as a fallback

export function parseQuestion(lines: string[]): { stem: string; options: Partial<Record<AnswerOption, string>> } {
  const strict = parseQuestionWith(lines, optionPattern);
  if (strict.options.A && strict.options.B && strict.options.C) return strict;
  const loose = parseQuestionWith(lines, { ...optionPattern, A: looseA });
  return loose.options.A && loose.options.B && loose.options.C ? loose : strict;
}

function parseQuestionWith(lines: string[], patterns: Record<AnswerOption, RegExp>): { stem: string; options: Partial<Record<AnswerOption, string>> } {
  const text = lines.join("\n"); let position = 0;
  const spans: Partial<Record<AnswerOption, [number, number]>> = {};
  for (const option of ["A", "B", "C"] as AnswerOption[]) {
    const match = patterns[option].exec(text.slice(position));
    if (!match) break;
    const start = position + match.index + match[0].indexOf(match[1]);
    spans[option] = [start, position + match.index + match[0].length];
    position += match.index + match[0].length;
  }
  if (!spans.A) return { stem: lines.join(" ").replace(/\s+/g, " ").trim(), options: {} };
  const options: Partial<Record<AnswerOption, string>> = {};
  const keys = Object.keys(spans) as AnswerOption[];
  keys.forEach((key, index) => {
    const end = index + 1 < keys.length ? spans[keys[index + 1]]![0] : text.length;
    options[key] = text.slice(spans[key]![1], end).replace(/\s+/g, " ").trim();
  });
  return { stem: text.slice(0, spans.A[0]).replace(/\s+/g, " ").trim(), options };
}

export function parseAnswer(lines: string[]): [AnswerOption | null, string] {
  const text = lines.join(" "); const found = /^(?:[^\s]{1,3}\s*)?(?:([ABCabc])[\.\)]\s*|([ABC])(?=\d))(.*)/.exec(text);
  return found ? [(found[1] ?? found[2]).toUpperCase() as AnswerOption, found[3].trim()] : [null, text];
}

/** Option text vs printed answer text; also compares against the answer's prefix so stray text after it (page bleed) does not hurt. */
function keySimilarity(option: string, keyText: string): number {
  return Math.max(similarity(option, keyText), similarity(option, keyText.slice(0, option.length + 3)));
}

/**
 * Last-resort key lookup for blocks whose options came out merged or unlabelled (e.g. "negative. Bg, zero. C. positive.").
 * Finds the printed key text anywhere in the whole question block, then reads the letter from the option label in front of it.
 */
export function locateKeyInBlock(lines: string[], keyText: string): AnswerOption | null {
  const text = lines.join(" ").replace(/\s+/g, " ").trim(); const key = keyText.replace(/\s+/g, " ").trim().slice(0, 80);
  if (normalize(key).length < 3 || text.length < key.length) return null;
  const labels: Array<{ at: number; letter: AnswerOption }> = [];
  const re = /(?:^|[\s_|])(Bg|Ec|[ABC]|[¢©]c?)(?:[\.,\)]|(?=\s))(?=\s|$)/g; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { const raw = m[1]; const letter: AnswerOption = raw[0] === "A" ? "A" : raw[0] === "B" ? "B" : "C"; if (/^[ABC]$/.test(raw) && !/[\.,\)]/.test(m[0])) continue; labels.push({ at: m.index + m[0].indexOf(raw), letter }); }
  if (!labels.length) return null;
  let best = 0; let bestAt = -1;
  for (let i = 0; i + 3 <= text.length; i += 1) {
    if (i > 0 && text[i - 1] !== " ") continue;
    const score = Math.max(similarity(text.slice(i, i + key.length), key), similarity(text.slice(i, i + key.length + 4), key));
    if (score > best) { best = score; bestAt = i; }
  }
  if (best < 0.8 || bestAt < 0) return null;
  const before = labels.filter((l) => l.at < bestAt);
  if (before.length) return before[before.length - 1].letter;
  // No label in front: the "A." label was lost. Only trust that if the text sits after the question sentence and the next label is B.
  const stemEnd = Math.max(text.lastIndexOf("?", labels[0].at), text.lastIndexOf(":", labels[0].at));
  return labels[0].letter === "B" && bestAt > stemEnd ? "A" : null;
}

export function parseOcrPages(pages: OcrPages, opts: { subject?: string } = {}): ParseResult {
  const sections: Array<Section | null> = []; let current: Section | null = null;
  const indexed = Object.entries(pages).sort(([a], [b]) => Number(a) - Number(b));
  indexed.forEach(([, text]) => { const found = HEADER.exec(text.slice(0, 300)) ?? HEADER.exec(text); if (found) current = { session: Number(found[1]) as 1 | 2, kind: found[2][0].toLowerCase() as "q" | "a" }; sections.push(current); });
  const sectionLines = new Map<string, Array<{ line: string; page: number }>>();
  indexed.forEach(([pageKey, text], pageIndex) => {
    const section = sections[pageIndex]; if (!section) return;
    const key = `${section.session}:${section.kind}`;
    sectionLines.set(key, [...(sectionLines.get(key) ?? []), ...cleanLines(text).map((line) => ({ line, page: Number(pageKey) }))]);
  });
  const blocks = new Map<string, Map<number, Item>>();
  for (const [key, lines] of sectionLines) {
    const kind = key.endsWith(":q") ? "q" : "a"; const items = new Map<number, Item>(); let number: number | null = null;
    for (const { line, page } of lines) {
      const found = marker(kind === "q" ? "Question" : "Answer").exec(line);
      if (found) { number = Number(found[1]); items.set(number, { lines: [], page }); continue; }
      if (number !== null) items.get(number)!.lines.push(line);
    }
    blocks.set(key, items);
  }
  const questions: ParsedQuestion[] = [];
  for (const session of [1, 2] as const) {
    const qs = blocks.get(`${session}:q`) ?? new Map(); const keys = blocks.get(`${session}:a`) ?? new Map();
    for (const [n, item] of [...qs.entries()].sort(([a], [b]) => a - b)) {
      const parsed = parseQuestion(item.lines); const [letter, keyText] = keys.has(n) ? parseAnswer(keys.get(n)!.lines) : [null, ""];
      let correct = letter; let status: ParsedQuestion["status"] = "ok"; let reason: string | undefined; let keyIssue: string | undefined;
      const optionsUnread = !parsed.options.A || !parsed.options.B || !parsed.options.C;
      if (optionsUnread) { status = "needs_review"; reason = "One or more answer options could not be read."; }
      if (!keyText) { status = "needs_review"; keyIssue = "Answer key entry is missing or unreadable."; reason = reason ?? keyIssue; }
      else {
        const scored = (Object.keys(parsed.options) as AnswerOption[]).map((key) => [key, keySimilarity(parsed.options[key]!, keyText)] as const).sort((a, b) => b[1] - a[1]);
        const own = letter && parsed.options[letter] ? keySimilarity(parsed.options[letter]!, keyText) : 0;
        const bestScore = scored[0]?.[1] ?? 0;
        const clearlyBeaten = bestScore >= 0.95 && bestScore - own >= 0.25 && scored[0][0] !== letter; // another option matches the printed text almost exactly
        if (letter && own >= 0.6 && !clearlyBeaten) correct = letter;
        else if (scored[0] && bestScore >= 0.85) { correct = scored[0][0]; if (correct !== letter) { status = "corrected"; reason = "Printed answer letter corrected to match answer text."; } }
        else if (letter && optionsUnread) { correct = letter; } // option text unreadable, so the printed letter is all we have
        else if (scored[0] && bestScore >= 0.7 && bestScore - (scored[1]?.[1] ?? 0) >= 0.12) { correct = scored[0][0]; if (correct !== letter) { status = "corrected"; reason = "Printed answer letter corrected to match answer text."; } }
        else {
          const found = locateKeyInBlock(item.lines, keyText);
          if (found) { correct = found; if (found !== letter) { status = "corrected"; reason = "Printed answer letter corrected to match answer text."; } }
          else { status = "needs_review"; keyIssue = "Answer key text does not match any option confidently."; reason = reason ?? keyIssue; }
        }
      }
      questions.push(withTopic({ id: `${session}-${n}`, session, n, stem: parsed.stem, A: parsed.options.A ?? "", B: parsed.options.B ?? "", C: parsed.options.C ?? "", correct, status, reason, sourcePage: item.page, keyPage: keys.get(n)?.page, optionsUnread, keyIssue }, opts.subject));
    }
  }
  return { questions, inferredSessions: !sections.some(Boolean) };
}
