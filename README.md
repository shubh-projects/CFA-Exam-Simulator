# CFA Mock Simulator

This is a browser-local CFA mock simulator. It uses no backend, database, account, or API key. Exams, OCR page text, and attempts are intended to stay in the browser's IndexedDB.

## Local development

`cd frontend && npm install && npm run dev`

Run parser fixtures with `npm test`; create a production bundle with `npm run build`.

## OCR assets

The application expects locally bundled OCR assets under `frontend/public/tesseract/` and a PDF.js worker at `frontend/public/pdf.worker.min.mjs`. Copy the matching assets from installed `tesseract.js`, `tesseract.js-core`, `@tesseract.js-data/eng`, and `pdfjs-dist` during your build/deploy step. This avoids CDN dependencies. The language file is large and is not committed to this repository.

## Deployment

Import the repository into Vercel, choose `frontend` as the root directory, and select Next.js. No environment variables are required. OCR accuracy varies with scan quality; tables are retained as extracted text and should be checked against the original source page.
