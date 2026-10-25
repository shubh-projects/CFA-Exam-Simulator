// Run after installing OCR packages to copy their worker/core/language files into public/tesseract.
// Kept explicit because package layouts differ by Tesseract release and the language asset is large.
console.log("Copy PDF.js worker and Tesseract worker/core/eng.traineddata into public before deployment.");
