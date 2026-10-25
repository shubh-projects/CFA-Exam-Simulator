import { create } from "zustand";

export type ExamPhase =
  | "intro"
  | "session1"
  | "break"
  | "session2"
  | "results"
  | "review";

export type AnswerOption = "A" | "B" | "C";

/** A backend question record. Additional backend fields are preserved. */
export interface ExamQuestion {
  id: string;
  session?: 1 | 2;
  n?: number;
  stem?: string;
  A?: string;
  B?: string;
  C?: string;
  correct?: AnswerOption | null;
  topic?: string;
  status?: "ok" | "corrected" | "needs_review";
  reason?: string;
  sourcePage?: number;
  [key: string]: unknown;
}

export interface QuestionTelemetry {
  timeSpentMs: number;
  switchHistory: AnswerOption[];
}

interface ExamState {
  examData: ExamQuestion[];
  phase: ExamPhase;
  currentSession: 1 | 2;
  currentQuestionIndex: number;
  sessionTimeLeft: number;
  breakTimeLeft: number;
  sessionDurationSeconds: number;
  breakDurationSeconds: number;
  sessionEndAt: number | null;
  breakEndAt: number | null;
  answers: Record<string, AnswerOption>;
  flags: Record<string, boolean>;
  telemetry: Record<string, QuestionTelemetry>;

  setExamData: (questions: ExamQuestion[]) => void;
  updateQuestion: (questionId: string, patch: Partial<ExamQuestion>) => void;
  setDurations: (sessionMinutes: number, breakMinutes: number) => void;
  setCurrentQuestionIndex: (index: number) => void;
  startSession: (sessionNumber: 1 | 2) => void;
  finishSession: () => void;
  selectOption: (questionId: string, option: AnswerOption) => void;
  toggleFlag: (questionId: string) => void;
  logTimeSpent: (questionId: string, ms: number) => void;
  tick: () => void;
}

const SESSION_DURATION_SECONDS = 6_000;
const BREAK_DURATION_SECONDS = 1_860;

const emptyTelemetry = (): QuestionTelemetry => ({
  timeSpentMs: 0,
  switchHistory: [],
});

export const useExamStore = create<ExamState>((set) => ({
  examData: [],
  phase: "intro",
  currentSession: 1,
  currentQuestionIndex: 0,
  sessionTimeLeft: SESSION_DURATION_SECONDS,
  breakTimeLeft: BREAK_DURATION_SECONDS,
  sessionDurationSeconds: SESSION_DURATION_SECONDS,
  breakDurationSeconds: BREAK_DURATION_SECONDS,
  sessionEndAt: null,
  breakEndAt: null,
  answers: {},
  flags: {},
  telemetry: {},

  setExamData: (examData) =>
    set({
      examData,
      currentQuestionIndex: 0,
    }),

  updateQuestion: (questionId, patch) => set((state) => ({ examData: state.examData.map((question) => question.id === questionId ? { ...question, ...patch } : question) })),

  setDurations: (sessionMinutes, breakMinutes) => set({
    sessionDurationSeconds: Math.max(60, Math.round(sessionMinutes * 60)),
    breakDurationSeconds: Math.max(0, Math.round(breakMinutes * 60)),
  }),

  setCurrentQuestionIndex: (currentQuestionIndex) =>
    set((state) => ({
      currentQuestionIndex: Math.max(
        0,
        Math.min(currentQuestionIndex, Math.max(state.examData.length - 1, 0)),
      ),
    })),

  startSession: (sessionNumber) =>
    set((state) => ({
      phase: sessionNumber === 1 ? "session1" : "session2",
      currentSession: sessionNumber,
      currentQuestionIndex: 0,
      sessionTimeLeft: state.sessionDurationSeconds,
      sessionEndAt: Date.now() + state.sessionDurationSeconds * 1_000,
      breakEndAt: null,
    })),

  finishSession: () =>
    set((state) => {
      if (state.phase === "session1") {
        return {
          phase: "break",
          currentSession: 1,
          currentQuestionIndex: 0,
          breakTimeLeft: state.breakDurationSeconds,
          sessionEndAt: null,
          breakEndAt: Date.now() + state.breakDurationSeconds * 1_000,
        };
      }

      return {
        phase: "results", sessionEndAt: null,
        currentSession: 2,
      };
    }),

  selectOption: (questionId, option) =>
    set((state) => {
      const existingTelemetry = state.telemetry[questionId] ?? emptyTelemetry();
      const isDeselecting = state.answers[questionId] === option;
      const { [questionId]: _removedAnswer, ...remainingAnswers } = state.answers;

      return {
        // Prometric permits a candidate to clear a selected response by clicking it again.
        answers: isDeselecting
          ? remainingAnswers
          : { ...state.answers, [questionId]: option },
        telemetry: {
          ...state.telemetry,
          [questionId]: {
            ...existingTelemetry,
            switchHistory: [...existingTelemetry.switchHistory, option],
          },
        },
      };
    }),

  toggleFlag: (questionId) =>
    set((state) => ({
      flags: {
        ...state.flags,
        [questionId]: !state.flags[questionId],
      },
    })),

  logTimeSpent: (questionId, ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return;

    set((state) => {
      const existingTelemetry = state.telemetry[questionId] ?? emptyTelemetry();

      return {
        telemetry: {
          ...state.telemetry,
          [questionId]: {
            ...existingTelemetry,
            timeSpentMs: existingTelemetry.timeSpentMs + ms,
          },
        },
      };
    });
  },

  tick: () =>
    set((state) => {
      if (state.phase === "session1" || state.phase === "session2") {
        const remaining = Math.max(0, Math.ceil(((state.sessionEndAt ?? Date.now()) - Date.now()) / 1_000));
        if (remaining === 0) return state.phase === "session1"
          ? { phase: "break", currentSession: 1, breakTimeLeft: state.breakDurationSeconds, sessionEndAt: null, breakEndAt: Date.now() + state.breakDurationSeconds * 1_000 }
          : { phase: "results", currentSession: 2, sessionEndAt: null };
        return {
          sessionTimeLeft: remaining,
        };
      }

      if (state.phase === "break") {
        const remaining = Math.max(0, Math.ceil(((state.breakEndAt ?? Date.now()) - Date.now()) / 1_000));
        if (remaining === 0) return { phase: "session2", currentSession: 2, currentQuestionIndex: 0, sessionTimeLeft: state.sessionDurationSeconds, sessionEndAt: Date.now() + state.sessionDurationSeconds * 1_000, breakEndAt: null };
        return {
          breakTimeLeft: remaining,
        };
      }

      return state;
    }),
}));

