// Drizzle PostgreSQL schema belongs here.
import {
  boolean,
  char,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const examShiftType = pgEnum("exam_shift_type", [
  "mock",
  "practice_pack",
]);

export const questions = pgTable("questions", {
  id: uuid("id").defaultRandom().primaryKey(),

  sourceFile: varchar("source_file").notNull(),
  topic: varchar("topic").notNull(),
  sessionNumber: integer("session_number"),
  questionNumber: integer("question_number").notNull(),

  stem: text("stem").notNull(),
  tableData: jsonb("table_data"),
  stemAfter: text("stem_after"),

  optionA: text("option_a").notNull(),
  optionB: text("option_b").notNull(),
  optionC: text("option_c").notNull(),
  correctOption: char("correct_option", { length: 1 }).notNull(),

  explanation: text("explanation"),
});

export const examShifts = pgTable("exam_shifts", {
  id: uuid("id").defaultRandom().primaryKey(),

  title: varchar("title").notNull(),
  type: examShiftType("type").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const shiftQuestions = pgTable(
  "shift_questions",
  {
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => examShifts.id, { onDelete: "cascade" }),

    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),

    orderIndex: integer("order_index").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.shiftId, table.questionId],
      name: "shift_questions_shift_id_question_id_pk",
    }),
  ],
);

export const examAttempts = pgTable("exam_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),

  shiftId: uuid("shift_id")
    .notNull()
    .references(() => examShifts.id, { onDelete: "cascade" }),

  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export const attemptTelemetry = pgTable(
  "attempt_telemetry",
  {
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => examAttempts.id, { onDelete: "cascade" }),

    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),

    selectedOption: char("selected_option", { length: 1 }),
    isFlagged: boolean("is_flagged").notNull().default(false),
    timeSpentMs: integer("time_spent_ms").notNull().default(0),

    switchHistory: jsonb("switch_history")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (table) => [
    primaryKey({
      columns: [table.attemptId, table.questionId],
      name: "attempt_telemetry_attempt_id_question_id_pk",
    }),
  ],
);

export const questionsRelations = relations(questions, ({ many }) => ({
  shiftQuestions: many(shiftQuestions),
  attemptTelemetry: many(attemptTelemetry),
}));

export const examShiftsRelations = relations(examShifts, ({ many }) => ({
  shiftQuestions: many(shiftQuestions),
  attempts: many(examAttempts),
}));

export const shiftQuestionsRelations = relations(shiftQuestions, ({ one }) => ({
  shift: one(examShifts, {
    fields: [shiftQuestions.shiftId],
    references: [examShifts.id],
  }),
  question: one(questions, {
    fields: [shiftQuestions.questionId],
    references: [questions.id],
  }),
}));

export const examAttemptsRelations = relations(
  examAttempts,
  ({ one, many }) => ({
    shift: one(examShifts, {
      fields: [examAttempts.shiftId],
      references: [examShifts.id],
    }),
    telemetry: many(attemptTelemetry),
  }),
);

export const attemptTelemetryRelations = relations(
  attemptTelemetry,
  ({ one }) => ({
    attempt: one(examAttempts, {
      fields: [attemptTelemetry.attemptId],
      references: [examAttempts.id],
    }),
    question: one(questions, {
      fields: [attemptTelemetry.questionId],
      references: [questions.id],
    }),
  }),
);