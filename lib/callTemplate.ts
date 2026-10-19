/** Клиент-безопасные константы листа обзвона (без server-only / db). */

/** Сколько случайных вопросов из базы берётся при «Перемешать вопросы». */
export const CALL_QUESTIONS_COUNT = 10;

/** Допустимые оценки за вопрос. */
export const CALL_SCORES = [1, 0.5, 0] as const;
export type CallScore = (typeof CALL_SCORES)[number];

export function isCallScore(value: unknown): value is CallScore {
  return typeof value === 'number' && (CALL_SCORES as readonly number[]).includes(value);
}

/** Приветствие в левом верхнем углу листа. */
export const CALL_GREETING =
  'Приветствую! Вы попали на обзвон на Event Helper\'а. Представьтесь и расскажите немного о себе';

/** Постоянная верхняя часть: вопросы без оценки, одинаковые для каждого обзвона. */
export const CALL_FIXED_QUESTIONS: readonly string[] = [
  'Почему Вы решили стать Event Helper\'ом?',
  'Был ли у Вас опыт проведения или участия в ивентах от администрации?',
  'Есть ли у Вас любимые мероприятия? Какие именно и почему?',
  'Если бы у вас была возможность что-то изменить или улучшить в ивентах, что бы вы предложили?',
  'В какой период времени чаще всего находитесь в игре?',
  'Есть ли возможность видеть теги в дискорде ивентов в течении дня?',
  'Можете ли вы вести запись мероприятий и хранить ее 72 часа?',
];

/** Разделитель между постоянной частью и вопросами из базы. */
export const CALL_MAIN_INTRO =
  'Хорошо, теперь мы перейдём к основным вопросам. Если Вы не знаете ответа, скажите об этом сразу, дабы не затягивать обзвон.';

export const CALL_OUTRO =
  'Хорошо, это был последний вопрос. Если вы нам подойдёте, вы увидите тег в новостном ивент-канале. Спасибо, до свидания.';

/** Баллы и процент правильных ответов: нет оценки = 0 баллов, знаменатель — все вопросы листа. */
export function callTotals(total: number, scores: Array<number | null | undefined>) {
  const points = scores.reduce<number>((sum, s) => sum + (typeof s === 'number' ? s : 0), 0);
  const percent = total > 0 ? Math.round((points / total) * 1000) / 10 : 0;
  return { total, points, percent };
}
