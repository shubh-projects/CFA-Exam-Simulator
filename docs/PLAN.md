# Browser-only CFA simulator plan

1. Replace API upload with client-only PDF/image/text/paste input, local PDF.js and Tesseract assets, and progress/error UI.
2. Port the supplied OCR column filter, parser tolerances, answer-key reconciliation, merge scoring, validation, and topic classifier into testable TypeScript modules.
3. Add the pre-exam correction screen; uncertain extraction is never silently accepted.
4. Store exams, OCR pages, attempts, and telemetry in IndexedDB; add resume, import/export, and local-data controls.
5. Refactor the exam engine for persisted absolute-time sessions, Prometric navigation/finish flow, and durable telemetry.
6. Extend results with the requested filters, pacing, confidence, fatigue, topic-weight, CSV, and pass-zone analysis.
7. Remove runtime frontend database/API dependencies, move the old backend to `legacy/`, document offline deployment, then run tests and production build.
