// Rebuilds src/lib/pipeline/topicIndex.json from a corpus file made from your study notes.
// Usage: npx tsx tools/build-topic-index.mts path/to/corpus.json
// corpus.json = { "<Subject>": { modules: [{ name, text }], extra: "<other notes for the subject>" } }
import { readFileSync, writeFileSync } from "node:fs";
import { tokenize } from "../src/lib/pipeline/topics.ts";

const hints = JSON.parse(readFileSync(new URL("./topic-hints.json", import.meta.url), "utf8")) as Record<string, string>;
const corpus = JSON.parse(readFileSync(process.argv[2], "utf8")) as Record<string, { modules: Array<{ name: string; text: string }>; extra: string }>;
type Doc = { subject: string; name: string; tf: Map<string, number> };
const count = (tokens: string[]) => { const m = new Map<string, number>(); for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1); return m; };
const merge = (a: Map<string, number>, b: Map<string, number>) => { for (const [t, c] of b) a.set(t, (a.get(t) ?? 0) + c); };

const modules: Doc[] = []; const subjects: Doc[] = [];
for (const [subject, data] of Object.entries(corpus)) {
  const subjectTf = new Map<string, number>();
  for (const mod of data.modules) {
    const title = tokenize(mod.name); const hint = tokenize(hints[mod.name] ?? "");
    const tf = count([...tokenize(mod.text), ...Array(6).fill(title).flat(), ...Array(4).fill(hint).flat()]);
    modules.push({ subject, name: mod.name, tf }); merge(subjectTf, tf);
  }
  if (data.extra) merge(subjectTf, count(tokenize(data.extra)));
  subjects.push({ subject, name: subject, tf: subjectTf });
}
const df = (docs: Doc[]) => { const m = new Map<string, number>(); for (const d of docs) for (const t of d.tf.keys()) m.set(t, (m.get(t) ?? 0) + 1); return m; };
const dfModules = df(modules); const dfSubjects = df(subjects);
const idfOf = (term: string) => Math.log((modules.length + 1) / ((dfModules.get(term) ?? 0) + 1)) + 1;
const idfSubj = (term: string) => Math.log((subjects.length + 1) / ((dfSubjects.get(term) ?? 0) + 1)) + 1;

function vector(doc: Doc, idf: (t: string) => number, keep: number) {
  const entries = [...doc.tf].filter(([t, c]) => (c >= 2 || t.length > 5) && !/^[a-z]{1,3}$/.test(t)).map(([t, c]) => [t, (1 + Math.log(c)) * idf(t)] as const);
  const norm = Math.sqrt(entries.reduce((s, [, w]) => s + w * w, 0)) || 1;
  return Object.fromEntries(entries.map(([t, w]) => [t, w / norm] as const).sort((a, b) => b[1] - a[1]).slice(0, keep).map(([t, w]) => [t, Math.round(w * 1000) / 1000]));
}
const outModules = modules.map((d) => ({ subject: d.subject, name: d.name, terms: vector(d, idfOf, 160) }));
const outSubjects = subjects.map((d) => ({ name: d.name, terms: vector(d, idfSubj, 700) }));
// the classifier uses one idf for the question vector: module-level idf (terms only in subject vectors fall back to subject idf)
const idf: Record<string, number> = {};
for (const v of [...outModules, ...outSubjects]) for (const t of Object.keys(v.terms)) idf[t] = Math.round((dfModules.has(t) ? idfOf(t) : idfSubj(t)) * 100) / 100;
writeFileSync(new URL("../src/lib/pipeline/topicIndex.json", import.meta.url), JSON.stringify({ idf, subjects: outSubjects, modules: outModules }));
console.log(`modules ${outModules.length}, subjects ${outSubjects.length}, terms ${Object.keys(idf).length}`);
