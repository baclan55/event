import 'server-only';
import { query } from '@/lib/db';

export type CallSheetQuestion = {
  id: number;
  position: number;
  category: string;
  question: string;
  answer: string;
};

export type CallSheetScore = {
  applicationId: number;
  sheetQuestionId: number;
  score: number;
};

export type CallSheetNote = {
  applicationId: number;
  index: number;
  note: string;
};

export type CallSheet = {
  questions: CallSheetQuestion[];
  scores: CallSheetScore[];
  notes: CallSheetNote[];
  bankTotal: number;
};

/** Общий лист обзвона: вопросы, поставленные оценки и размер базы. */
export async function loadCallSheet(): Promise<CallSheet> {
  const [questions, scores, notes, bank] = await Promise.all([
    query<CallSheetQuestion>(
      `SELECT id, position, category_name AS category, question, answer
       FROM call_sheet_questions ORDER BY position ASC, id ASC`,
    ),
    query<CallSheetScore>(
      `SELECT s.application_id AS "applicationId", s.sheet_question_id AS "sheetQuestionId",
              s.score::float8 AS score
       FROM call_scores s`,
    ),
    query<CallSheetNote>(
      `SELECT application_id AS "applicationId", question_index AS index, note FROM call_notes`,
    ),
    query<{ n: number }>('SELECT count(*)::int AS n FROM call_questions'),
  ]);
  return {
    questions: questions.rows,
    scores: scores.rows,
    notes: notes.rows,
    bankTotal: bank.rows[0]?.n ?? 0,
  };
}
