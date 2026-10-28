import type { ParsedQuestion } from "./types";
import index from "./topicIndex.json";

/** The ten CFA Level I subjects (same names as the Juice / Secret Sauce notes). */
export const CFA_TOPICS = [
  "Ethical and Professional Standards", "Quantitative Methods", "Economics",
  "Financial Statement Analysis", "Corporate Issuers", "Equity Investments",
  "Fixed Income", "Derivatives", "Alternative Investments", "Portfolio Management",
] as const;
export type Subject = typeof CFA_TOPICS[number];

type ModuleIndex = { subject: string; name: string; terms: Record<string, number> };
type TopicIndex = { idf: Record<string, number>; subjects: Array<{ name: string; terms: Record<string, number> }>; modules: ModuleIndex[] };
const data = index as unknown as TopicIndex;

/** Learning modules (readings) per subject, in curriculum order, as listed in the Juice notes. */
export const LEARNING_MODULES: Record<string, string[]> = {};
for (const m of data.modules) (LEARNING_MODULES[m.subject] ??= []).push(m.name);

const STOP = new Set("a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your following most likely closest correct statement true false analyst analysts company companys".split(" "));

/** Same tokenizer is used when the index is built and when questions are classified. */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/ies$/, "y").replace(/(?<=[^s])s$/, "").replace(/ing$/, "").replace(/ed$/, ""));
  const tokens: string[] = [...words];
  for (let i = 1; i < words.length; i += 1) tokens.push(`${words[i - 1]}_${words[i]}`);
  return tokens;
}

function vectorize(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>(); for (const t of tokens) if (data.idf[t] !== undefined) counts.set(t, (counts.get(t) ?? 0) + 1);
  const vec = new Map<string, number>(); let norm = 0;
  for (const [t, c] of counts) { const w = (1 + Math.log(c)) * data.idf[t]; vec.set(t, w); norm += w * w; }
  norm = Math.sqrt(norm) || 1; for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
}
const dot = (q: Map<string, number>, terms: Record<string, number>) => { let s = 0; for (const [t, w] of q) { const v = terms[t]; if (v) s += w * v; } return s; };

export interface TopicGuess { topic: string; subtopic: string; confidence: number; }

/** Picks the subject, then the learning module inside it, by comparing the question's wording with the notes. */
export function classifyQuestion(text: string, onlySubject?: string): TopicGuess {
  const q = vectorize(tokenize(text));
  if (!q.size) return { topic: onlySubject ?? "Unclassified", subtopic: "", confidence: 0 };
  const subjectScore = new Map(data.subjects.map((s) => [s.name, dot(q, s.terms)] as const));
  // Every learning module is scored on its own wording AND on how well its whole subject fits the question.
  const ranked = data.modules.filter((m) => !onlySubject || m.subject === onlySubject)
    .map((m) => ({ m, score: 0.6 * dot(q, m.terms) + 0.4 * (subjectScore.get(m.subject) ?? 0) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score <= 0) return { topic: onlySubject ?? "Unclassified", subtopic: "", confidence: 0 };
  const runnerUp = ranked.find((r) => r.m.subject !== best.m.subject) ?? ranked[1];
  return { topic: best.m.subject, subtopic: best.m.name, confidence: best.score / (best.score + (runnerUp?.score ?? 0) || 1) };
}

export function classifyTopic(text: string): string { return classifyQuestion(text).topic; }

export function withTopic(question: Omit<ParsedQuestion, "topic" | "subtopic">, onlySubject?: string): ParsedQuestion {
  const guess = classifyQuestion(`${question.stem} ${question.A} ${question.B} ${question.C}`, onlySubject);
  return { ...question, topic: guess.topic, subtopic: guess.subtopic };
}
