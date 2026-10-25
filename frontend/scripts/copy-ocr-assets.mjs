import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageDirectory = (name) => dirname(require.resolve(`${name}/package.json`));
const publicDirectory = join(process.cwd(), "public");
const tessDirectory = join(publicDirectory, "tesseract");
const coreDirectory = join(tessDirectory, "core");
const langDirectory = join(tessDirectory, "lang");
const pdfDirectory = join(publicDirectory, "pdfjs");

await rm(tessDirectory, { recursive: true, force: true });
await rm(pdfDirectory, { recursive: true, force: true });
await Promise.all([mkdir(coreDirectory, { recursive: true }), mkdir(langDirectory, { recursive: true }), mkdir(pdfDirectory, { recursive: true })]);

const tesseractDirectory = packageDirectory("tesseract.js");
const corePackageDirectory = packageDirectory("tesseract.js-core");
const languageDirectory = packageDirectory("@tesseract.js-data/eng");
const pdfDirectorySource = packageDirectory("pdfjs-dist");

await Promise.all([
  cp(join(tesseractDirectory, "dist", "worker.min.js"), join(tessDirectory, "worker.min.js")),
  cp(corePackageDirectory, coreDirectory, { recursive: true, filter: (source) => /tesseract-core.*\.(?:js|wasm)$/.test(source) || source === corePackageDirectory }),
  cp(join(languageDirectory, "4.0.0", "eng.traineddata.gz"), join(langDirectory, "eng.traineddata.gz")),
  cp(join(pdfDirectorySource, "legacy", "build", "pdf.worker.min.mjs"), join(pdfDirectory, "pdf.worker.min.mjs")),
  // JBIG2 / JPEG2000 decoders: scanned PDFs are often JBIG2-compressed and render blank without these
  cp(join(pdfDirectorySource, "wasm"), join(pdfDirectory, "wasm"), { recursive: true }),
]);

console.log("Copied local Tesseract and PDF.js workers into public/.");
