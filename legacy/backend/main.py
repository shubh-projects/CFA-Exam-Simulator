"""FastAPI routes for persisting extracted CFA exam questions."""

from __future__ import annotations

import asyncio
import json
import math
import os
import random
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, AsyncIterator, Literal
from uuid import UUID, uuid4

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from extractor import ExtractedQuestion, ExtractionError, extract_pdf_questions

load_dotenv()
UploadType = Literal["mock", "practice"]
MAX_PRACTICE_SHIFT_SIZE = 100


@dataclass(frozen=True, slots=True)
class SourcedQuestion:
    source_file: str
    question: ExtractedQuestion


class ProcessExamResponse(BaseModel):
    shift_ids: list[UUID]


class ShiftQuestionResponse(BaseModel):
    id: UUID
    source_file: str
    topic: str
    session_number: int | None
    question_number: int
    stem: str
    table_data: dict[str, Any] | None
    stem_after: str | None
    option_a: str
    option_b: str
    option_c: str
    correct_option: str
    explanation: str | None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required to start the API.")
    app.state.db_pool = await asyncpg.create_pool(database_url, min_size=1, max_size=10, command_timeout=60)
    try:
        yield
    finally:
        await app.state.db_pool.close()


app = FastAPI(title="CFA Exam Processor", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _practice_chunks(questions: list[SourcedQuestion]) -> list[list[SourcedQuestion]]:
    """Split questions into near-equal chunks, never exceeding 100 per shift."""
    if not questions:
        return []
    chunk_count = math.ceil(len(questions) / MAX_PRACTICE_SHIFT_SIZE)
    base_size, remainder = divmod(len(questions), chunk_count)
    chunks: list[list[SourcedQuestion]] = []
    offset = 0
    for chunk_index in range(chunk_count):
        size = base_size + (1 if chunk_index < remainder else 0)
        chunks.append(questions[offset:offset + size])
        offset += size
    return chunks


async def _save_shift(
    connection: asyncpg.Connection,
    *,
    title: str,
    shift_type: UploadType,
    questions: list[SourcedQuestion],
) -> UUID:
    """Write a shift, question rows, and their ordering in one transaction."""
    shift_id = uuid4()
    await connection.execute(
        "INSERT INTO exam_shifts (id, title, type, created_at) VALUES ($1, $2, $3, NOW())",
        shift_id, title, "mock" if shift_type == "mock" else "practice_pack",
    )
    for order_index, sourced in enumerate(questions, start=1):
        record, question_id = sourced.question, uuid4()
        await connection.execute(
            """
            INSERT INTO questions (id, source_file, topic, session_number, question_number, stem,
                table_data, stem_after, option_a, option_b, option_c, correct_option, explanation)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
            """,
            question_id, sourced.source_file, record.topic, record.session, record.n, record.stem,
            None if not record.table_data else json.dumps({row.key: row.value for row in record.table_data}), record.stem_after,
            record.option_a, record.option_b, record.option_c, record.correct_option, record.explanation,
        )
        await connection.execute(
            "INSERT INTO shift_questions (shift_id, question_id, order_index) VALUES ($1, $2, $3)",
            shift_id, question_id, order_index,
        )
    return shift_id


@app.get("/api/shifts/{shift_id}", response_model=list[ShiftQuestionResponse])
async def get_shift_questions(request: Request, shift_id: UUID) -> list[ShiftQuestionResponse]:
    """Return a shift's questions in the exact sequence assigned to that shift."""
    pool: asyncpg.Pool = request.app.state.db_pool

    try:
        async with pool.acquire() as connection:
            shift_exists = await connection.fetchval(
                "SELECT EXISTS(SELECT 1 FROM exam_shifts WHERE id = $1)",
                shift_id,
            )
            if not shift_exists:
                raise HTTPException(status_code=404, detail="Exam shift not found.")

            rows = await connection.fetch(
                """
                SELECT
                    q.id,
                    q.source_file,
                    q.topic,
                    q.session_number,
                    q.question_number,
                    q.stem,
                    q.table_data,
                    q.stem_after,
                    q.option_a,
                    q.option_b,
                    q.option_c,
                    q.correct_option,
                    q.explanation
                FROM shift_questions AS sq
                INNER JOIN questions AS q ON q.id = sq.question_id
                WHERE sq.shift_id = $1
                ORDER BY sq.order_index ASC, q.question_number ASC
                """,
                shift_id,
            )
    except HTTPException:
        raise
    except asyncpg.PostgresError as exc:
        raise HTTPException(status_code=503, detail="Unable to load exam shift questions.") from exc

    return [ShiftQuestionResponse.model_validate(dict(row)) for row in rows]


@app.post("/api/process-exam", response_model=ProcessExamResponse, status_code=status.HTTP_201_CREATED)
async def process_exam(
    request: Request,
    files: Annotated[list[UploadFile], File(...)],
    upload_type: Annotated[UploadType, Form(...)],
) -> ProcessExamResponse:
    """Extract PDF questions and create mock or randomized practice shifts."""
    import traceback  # <--- This will force Python to reveal the crash

    if not files:
        raise HTTPException(status_code=422, detail="At least one PDF is required.")
    if upload_type == "mock" and len(files) != 1:
        raise HTTPException(status_code=422, detail="A mock upload must contain exactly one PDF.")
    if any(file.content_type not in {"application/pdf", "application/x-pdf"} for file in files):
        raise HTTPException(status_code=415, detail="Every upload must be a PDF.")
    try:
        payloads = await asyncio.gather(*(file.read() for file in files))
        extracted = await asyncio.gather(*(extract_pdf_questions(payload) for payload in payloads))
    except ExtractionError as exc:
        print("\n=== AI EXTRACTION ERROR ===")
        traceback.print_exc()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        print("\n=== UNEXPECTED ERROR ===")
        traceback.print_exc()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        await asyncio.gather(*(file.close() for file in files))
        
    sourced_questions = [
        SourcedQuestion(file.filename or "uploaded.pdf", question)
        for file, questions in zip(files, extracted, strict=True)
        for question in questions
    ]
    
    if not sourced_questions:
        raise HTTPException(status_code=422, detail="No exam questions were detected in the uploaded PDFs.")
        
    if upload_type == "mock":
        shifts = [(f"Mock Exam – {Path(files[0].filename or 'uploaded').stem}", sourced_questions)]
    else:
        random.SystemRandom().shuffle(sourced_questions)
        shifts = [(f"Practice Pack {index}", chunk) for index, chunk in enumerate(_practice_chunks(sourced_questions), 1)]
        
    pool: asyncpg.Pool = request.app.state.db_pool
    try:
        async with pool.acquire() as connection:
            async with connection.transaction():
                shift_ids = [
                    await _save_shift(connection, title=title, shift_type=upload_type, questions=questions)
                    for title, questions in shifts
                ]
    except asyncpg.PostgresError as exc:
        print("\n=== DATABASE ERROR ===")
        traceback.print_exc()
        raise HTTPException(status_code=503, detail="Unable to save extracted exam shifts.") from exc
        
    return ProcessExamResponse(shift_ids=shift_ids)

