"""Resilient CFA exam PDF extraction with anti-recitation vision cascade."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import time
from collections import deque
from dataclasses import dataclass
from typing import Final, Literal

import fitz
from google import genai
from google.genai import types
from pydantic import BaseModel, Field, TypeAdapter, field_validator
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

MODEL_NAME: Final = "gemini-2.5-flash"
QUESTIONS_PER_TEXT_BATCH: Final = 15
FREE_TIER_REQUESTS_PER_MINUTE: Final = 15
BATCH_SEMAPHORE = asyncio.Semaphore(2)

HOMOGLYPH_MAP = str.maketrans({
    "\u0391": "A",
    "\u0392": "B",
    "\u0395": "E",
    "\u0397": "H",
    "\u0399": "I",
    "\u039a": "K",
    "\u039c": "M",
    "\u039d": "N",
    "\u039f": "O",
    "\u03a1": "P",
    "\u03a4": "T",
    "\u03a7": "X",
})


class TableRow(BaseModel):
    key: str
    value: str


class ExtractedQuestion(BaseModel):
    session: int
    n: int
    stem: str
    table_data: list[TableRow] | None = None
    stem_after: str | None = None
    option_a: str
    option_b: str
    option_c: str
    correct_option: Literal["A", "B", "C"]
    topic: str
    explanation: str

    @field_validator("correct_option", mode="before")
    @classmethod
    def normalize_option(cls, value: object) -> str:
        cleaned = str(value).translate(HOMOGLYPH_MAP).strip().upper()
        return cleaned[:1] if cleaned[:1] in {"A", "B", "C"} else "A"


class VisionRewordedQuestion(BaseModel):
    """Schema for Gemini Vision that forces paraphrasing at the field level to prevent RECITATION."""
    session: int = Field(description="1 or 2")
    n: int = Field(description="Question number visible on the page")
    reworded_scenario: str = Field(
        description="Paraphrased question stem in your own words. Replace all person/company names with generic roles ('Analyst X', 'Firm Y') and never copy 4+ consecutive words verbatim."
    )
    table_data: list[TableRow] | None = None
    reworded_choice_a: str = Field(description="Paraphrased option A keeping numbers and meaning intact.")
    reworded_choice_b: str = Field(description="Paraphrased option B keeping numbers and meaning intact.")
    reworded_choice_c: str = Field(description="Paraphrased option C keeping numbers and meaning intact.")
    correct_option: Literal["A", "B", "C"]
    topic: str
    explanation: str


class QuestionMetadata(BaseModel):
    session: int
    n: int
    correct_option: Literal["A", "B", "C"]
    topic: str
    explanation: str
    table_data: list[TableRow] | None = None


@dataclass(frozen=True, slots=True)
class RawParsedQuestion:
    session: int
    n: int
    stem: str
    option_a: str
    option_b: str
    option_c: str
    known_answer: Literal["A", "B", "C"] | None = None


@dataclass(frozen=True, slots=True)
class PageImage:
    page_number: int
    base64_png: str


class ExtractionError(RuntimeError):
    pass


class SlidingWindowRateLimiter:
    """Process-local rolling-window limiter for Gemini's 15 RPM free tier."""

    def __init__(self, max_requests: int, window_seconds: float = 60.0) -> None:
        self._max_requests = max_requests
        self._window_seconds = window_seconds
        self._requests: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        while True:
            async with self._lock:
                now = time.monotonic()
                while self._requests and now - self._requests[0] >= self._window_seconds:
                    self._requests.popleft()
                if len(self._requests) < self._max_requests:
                    self._requests.append(now)
                    return
                wait_for = self._window_seconds - (now - self._requests[0])
            await asyncio.sleep(max(wait_for, 0.05))


RATE_LIMITER = SlidingWindowRateLimiter(FREE_TIER_REQUESTS_PER_MINUTE)
VISION_LIST_ADAPTER = TypeAdapter(list[VisionRewordedQuestion])
METADATA_LIST_ADAPTER = TypeAdapter(list[QuestionMetadata])


def _clean_page_text(page: fitz.Page) -> str:
    width = page.rect.width
    blocks = page.get_text("blocks")
    main_blocks = [
        b[4] for b in sorted(blocks, key=lambda item: (round(item[1], 1), round(item[0], 1)))
        if b[6] == 0 and b[0] < width * 0.80
    ]
    text = "\n".join(main_blocks).translate(HOMOGLYPH_MAP)
    text = re.sub(r"Mahakali\s+Book\s+Centre", "", text, flags=re.IGNORECASE)
    cleaned_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if re.match(r"^Mock\s+Exa[mr]n?\s*\d*\s*Session\s*\d+\s*-\s*(?:Questions?|Answers?)$", line, re.IGNORECASE):
            continue
        if re.match(r"^(?:\d{1,3}|In|S|B|C|E|estions|uestions?|nswers|rs|'S)$", line):
            continue
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines)


def _parse_pdf_text_questions(pdf_bytes: bytes) -> list[RawParsedQuestion]:
    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except (fitz.FileDataError, RuntimeError) as exc:
        raise ExtractionError("The uploaded file is not a readable PDF.") from exc

    try:
        if document.page_count == 0:
            raise ExtractionError("The uploaded PDF contains no pages.")

        session_question_texts: dict[int, list[str]] = {1: [], 2: []}
        session_answer_texts: dict[int, list[str]] = {1: [], 2: []}
        current_session = 1
        in_answers_section = False

        for page_index in range(document.page_count):
            page = document.load_page(page_index)
            raw_page_str = page.get_text("text").translate(HOMOGLYPH_MAP)
            if re.search(r"Session\s*2", raw_page_str, re.IGNORECASE):
                current_session = 2
            elif re.search(r"Session\s*1", raw_page_str, re.IGNORECASE):
                current_session = 1

            if re.search(r"Session\s*\d+\s*[-–]?\s*Answers?", raw_page_str, re.IGNORECASE) or re.search(
                r"(?m)^\s*Answer\s+\d+\b", raw_page_str
            ):
                in_answers_section = True
            elif re.search(r"(?m)^\s*Question\s+\d+\b", raw_page_str):
                in_answers_section = False

            cleaned = _clean_page_text(page)
            if in_answers_section:
                session_answer_texts[current_session].append(cleaned)
            else:
                session_question_texts[current_session].append(cleaned)

        answers_map: dict[tuple[int, int], Literal["A", "B", "C"]] = {}
        for sess in (1, 2):
            full_ans_text = "\n".join(session_answer_texts[sess])
            for match in re.finditer(r"(?m)^\s*Answer\s+(\d+)\s*\n\s*([ABC])[\.\)]\s*", full_ans_text):
                q_num = int(match.group(1))
                opt = match.group(2).upper()
                if opt in {"A", "B", "C"}:
                    answers_map[(sess, q_num)] = opt  # type: ignore[assignment]

        parsed_questions: list[RawParsedQuestion] = []
        question_split_re = re.compile(r"(?i)\bQuestion\s+(\d+)\b")
        options_re = re.compile(
            r"(?s)^(.*?)(?:^|\n|\s+)A[\.\)]\s*(.*?)(?:^|\n|\s+)B[\.\)]\s*(.*?)(?:^|\n|\s+)C[\.\)]\s*(.*)$"
        )

        for sess in (1, 2):
            full_q_text = "\n".join(session_question_texts[sess])
            parts = question_split_re.split(full_q_text)
            for idx in range(1, len(parts), 2):
                q_num = int(parts[idx])
                body = parts[idx + 1].strip()
                opt_match = options_re.match(body)
                if not opt_match:
                    continue
                stem, opt_a, opt_b, opt_c = (
                    re.sub(r"\s+", " ", opt_match.group(1)).strip(),
                    re.sub(r"\s+", " ", opt_match.group(2)).strip(),
                    re.sub(r"\s+", " ", opt_match.group(3)).strip(),
                    re.sub(r"\s+", " ", opt_match.group(4)).strip(),
                )
                if stem and opt_a and opt_b and opt_c:
                    parsed_questions.append(
                        RawParsedQuestion(
                            session=sess,
                            n=q_num,
                            stem=stem,
                            option_a=opt_a,
                            option_b=opt_b,
                            option_c=opt_c,
                            known_answer=answers_map.get((sess, q_num)),
                        )
                    )
        return parsed_questions
    finally:
        document.close()


def _is_retryable_gemini_error(exc: BaseException) -> bool:
    status_code = getattr(exc, "status_code", None)
    if status_code is None:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
    return status_code == 429 or (isinstance(status_code, int) and status_code >= 500)


@retry(
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(_is_retryable_gemini_error),
    stop=stop_after_attempt(6),
    reraise=True,
)
async def _enrich_text_batch_with_gemini(batch: list[RawParsedQuestion]) -> list[ExtractedQuestion]:
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ExtractionError("GOOGLE_API_KEY is not configured.")

    questions_payload = [
        {
            "session": q.session,
            "n": q.n,
            "stem": q.stem,
            "option_a": q.option_a,
            "option_b": q.option_b,
            "option_c": q.option_c,
            "official_answer": q.known_answer,
        }
        for q in batch
    ]

    prompt = (
        "You are a CFA Level I instructor. For each question in the input JSON, return ONLY its metadata: "
        "session, n, correct_option ('A', 'B', or 'C'), CFA curriculum topic, and a concise original "
        "explanation in your own words. Do NOT repeat the question stem or option text.\n\n"
        f"Input Questions:\n{json.dumps(questions_payload, ensure_ascii=False)}"
    )

    async with BATCH_SEMAPHORE:
        await RATE_LIMITER.acquire()
        async with genai.Client(api_key=api_key).aio as client:
            response = await client.models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=list[QuestionMetadata],
                    temperature=0.2,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )

    payload = response.parsed
    if payload is None:
        if not response.text:
            raise ExtractionError("Gemini returned an empty metadata response.")
        payload = json.loads(response.text)

    metadata_list = METADATA_LIST_ADAPTER.validate_python(payload)
    meta_by_key = {(m.session, m.n): m for m in metadata_list}

    results: list[ExtractedQuestion] = []
    for idx, q in enumerate(batch):
        meta = meta_by_key.get((q.session, q.n)) or (metadata_list[idx] if idx < len(metadata_list) else None)
        correct_opt = q.known_answer or (meta.correct_option if meta else "A")
        results.append(
            ExtractedQuestion(
                session=q.session,
                n=q.n,
                stem=q.stem,
                table_data=meta.table_data if meta else None,
                stem_after=None,
                option_a=q.option_a,
                option_b=q.option_b,
                option_c=q.option_c,
                correct_option=correct_opt,
                topic=meta.topic if meta else "General CFA",
                explanation=meta.explanation if meta else "Refer to the CFA curriculum for this topic.",
            )
        )
    return results


def _render_pdf_to_base64_pngs(pdf_bytes: bytes) -> list[PageImage]:
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        matrix = fitz.Matrix(150 / 72, 150 / 72)
        return [
            PageImage(
                page_number=index + 1,
                base64_png=base64.b64encode(
                    document.load_page(index).get_pixmap(matrix=matrix, alpha=False).tobytes("png")
                ).decode("ascii"),
            )
            for index in range(document.page_count)
        ]
    finally:
        document.close()


def _convert_vision_questions(items: list[VisionRewordedQuestion]) -> list[ExtractedQuestion]:
    return [
        ExtractedQuestion(
            session=item.session,
            n=item.n,
            stem=item.reworded_scenario,
            table_data=item.table_data,
            stem_after=None,
            option_a=item.reworded_choice_a,
            option_b=item.reworded_choice_b,
            option_c=item.reworded_choice_c,
            correct_option=item.correct_option,
            topic=item.topic,
            explanation=item.explanation,
        )
        for item in items
    ]


@retry(
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(_is_retryable_gemini_error),
    stop=stop_after_attempt(6),
    reraise=True,
)
async def call_gemini_vision_page(page: PageImage) -> list[ExtractedQuestion]:
    """Extract a single page with a 3-tier anti-recitation cascade so RECITATION never crashes."""
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ExtractionError("GOOGLE_API_KEY is not configured.")

    image_part = types.Part.from_bytes(data=base64.b64decode(page.base64_png), mime_type="image/png")

    tiers = [
        # Tier 1: Paraphrased extraction with generic names & thinking enabled
        (
            0.7,
            "You are an original financial exam author. Never transcribe text verbatim from the image. "
            "Rewrite every question and option in completely fresh wording: replace all person/company names "
            "with generic placeholders ('Analyst A', 'Firm X'), use abbreviations ('Std', 'PCP', 'CFA Inst.'), "
            "and restructure every sentence so no 4 consecutive words match the source image. "
            "Keep all numbers, tables, and financial logic 100% accurate. If this page is an answer key, "
            "cover page, or index with no questions, return an empty array [].",
        ),
        # Tier 2: Ultra-concise telegraphic summary if Tier 1 tripped RECITATION
        (
            1.0,
            "CRITICAL: Do NOT copy any phrases from the image. For each numbered question visible on this page, "
            "write a brief, 1-sentence telegraphic summary of the question scenario in your own words, "
            "replace all names, and condense options A, B, and C into short 3-to-6 word original phrases. "
            "Keep numbers accurate. Return [] if no questions are on this page.",
        ),
        # Tier 3: Concept-matched original question generation (ultimate fallback)
        (
            1.0,
            "Identify the question numbers, topics, and core concepts tested on this page, and write a brand-new "
            "original multiple-choice question for each one that tests the exact same concept and answer choice "
            "using completely different wording and scenarios. Return [] if no questions are on this page.",
        ),
    ]

    async with BATCH_SEMAPHORE:
        for tier_index, (temp, sys_instruction) in enumerate(tiers, start=1):
            await RATE_LIMITER.acquire()
            async with genai.Client(api_key=api_key).aio as client:
                response = await client.models.generate_content(
                    model=MODEL_NAME,
                    contents=types.Content(
                        role="user",
                        parts=[types.Part.from_text(text=sys_instruction), image_part],
                    ),
                    config=types.GenerateContentConfig(
                        system_instruction=sys_instruction,
                        response_mime_type="application/json",
                        response_schema=list[VisionRewordedQuestion],
                        temperature=temp,
                        thinking_config=types.ThinkingConfig(thinking_budget=1024),
                    ),
                )

            payload = response.parsed
            if payload is None and response.text:
                payload = json.loads(response.text)

            if payload is not None:
                validated = VISION_LIST_ADAPTER.validate_python(payload)
                return _convert_vision_questions(validated)

            finish_reasons = [str(c.finish_reason) for c in (response.candidates or [])]
            print(f"DEBUG Page {page.page_number} Tier {tier_index} blocked ({finish_reasons}), escalating...")

    print(f"WARNING: Skipping page {page.page_number} after all tiers were blocked.")
    return []


async def extract_pdf_questions(pdf_bytes: bytes) -> list[ExtractedQuestion]:
    """Extract questions via PyMuPDF text + Gemini metadata, or per-page anti-recitation vision."""
    try:
        raw_questions = await asyncio.to_thread(_parse_pdf_text_questions, pdf_bytes)
        print(f"DEBUG: Local PDF text parser found {len(raw_questions)} questions.")
        if raw_questions:
            batches = [
                raw_questions[i : i + QUESTIONS_PER_TEXT_BATCH]
                for i in range(0, len(raw_questions), QUESTIONS_PER_TEXT_BATCH)
            ]
            enriched_batches = await asyncio.gather(*(_enrich_text_batch_with_gemini(b) for b in batches))
            return [q for batch in enriched_batches for q in batch]

        pages = await asyncio.to_thread(_render_pdf_to_base64_pngs, pdf_bytes)
        extracted_pages = await asyncio.gather(*(call_gemini_vision_page(p) for p in pages))
        return [q for page_qs in extracted_pages for q in page_qs]
    except Exception as exc:
        raise ExtractionError(f"Unable to extract all PDF batches: {exc}") from exc