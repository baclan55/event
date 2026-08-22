/** Клиент-безопасные константы и форматтеры журнала (без server-only / db). */

export const DEFAULT_CLOSED_MESSAGE =
  'Набор закрыт — следите за новостями о новом наборе.';

export const AUDIT_LABELS: Record<string, string> = {
  'user.create': 'Создан пользователь',
  'user.update': 'Изменён пользователь',
  'user.delete': 'Удалён пользователь',
  'roles.update': 'Изменены роли пользователя',
  'roles.reorder': 'Изменён порядок ролей',
  'role.create': 'Создана роль',
  'role.update': 'Изменена роль',
  'role.delete': 'Удалена роль',
  'reprimand.create': 'Выдан выговор',
  'reprimand.delete': 'Удалён выговор',
  'reprimand.unblock': 'Снята блокировка',
  'vacation.create': 'Подана заявка на отпуск',
  'vacation.approved': 'Отпуск одобрен',
  'vacation.rejected': 'Отпуск отклонён',
  'vacation.cancelled': 'Отпуск отменён',
  'vacation.delete': 'Удалена заявка на отпуск',
  'content.update': 'Изменён контент',
  'content.image.update': 'Обновлена картинка раздела',
  'rule.create': 'Создано правило',
  'rule.update': 'Изменено правило',
  'rule.delete': 'Удалено правило',
  'application.approved': 'Заявка на набор одобрена',
  'application.rejected': 'Заявка на набор отклонена',
  'application.delete': 'Заявка на набор удалена',
  'application.call_passed': 'Обзвон пройден',
  'application.call_failed': 'Обзвон не пройден',
  'applications.open': 'Набор открыт',
  'applications.close': 'Набор закрыт',
  'applications.message': 'Изменено сообщение о закрытии набора',
  'gmp.create': 'Создано ГМП',
  'gmp.update': 'Изменено ГМП',
  'gmp.delete': 'Удалено ГМП',
  'gmp.close': 'Закрыто ГМП',
  'gmp.mark': 'Отметка на ГМП',
  'gmp.staff': 'Изменён состав staff ГМП',
  'blacklist.add': 'Добавлен в чёрный список',
  'blacklist.remove': 'Удалён из чёрного списка',
  'blacklist.update': 'Изменена запись чёрного списка',
  'achievement.grant': 'Выдано достижение',
  'achievement.revoke': 'Снято достижение',
  'prop.create': 'Добавлен проп',
  'prop.update': 'Изменён проп',
  'prop.delete': 'Удалён проп',
  'prop.image.update': 'Обновлена картинка пропа',
  'prop.image.delete': 'Удалена картинка пропа',
  'event.delete': 'Удалено мероприятие',
  'event.update': 'Изменено мероприятие',
  'week.create': 'Создана неделя выплат',
  'week.rebuild': 'Пересобрана ведомость выплат',
  'week.lock': 'Неделя выплат заблокирована',
  'week.unlock': 'Неделя выплат разблокирована',
  'row.add': 'Сотрудник добавлен в ведомость',
  'row.update': 'Изменена строка выплаты',
  'row.delete': 'Сотрудник удалён из ведомости',
  'row.recompute': 'Пересчитана строка выплаты',
  'row.manual_counts': 'МП/ГМП изменены вручную',
  'reprimand.type_toggle': 'Учёт выговоров в выплате',
  'reprimand.toggle': 'Учёт выговора в выплате',
};

const FIELD_LABELS: Record<string, string> = {
  nickname: 'Ник',
  static_id: 'Static ID',
  staticId: 'Static ID',
  first_name: 'Имя',
  firstName: 'Имя',
  last_name: 'Фамилия',
  lastName: 'Фамилия',
  reason: 'Причина',
  type: 'Тип',
  status: 'Статус',
  title: 'Название',
  body: 'Текст',
  name: 'Название',
  spawnId: 'ID для спавна',
  color: 'Цвет',
  priority: 'Вес',
  events_mc: 'За мероприятия (MC)',
  events_dollars: 'За мероприятия ($)',
  fixed_mc: 'Фикс (MC)',
  fixed_dollars: 'Фикс ($)',
  bonus_mc: 'Доп. бонус (MC)',
  bonus_dollars: 'Доп. бонус ($)',
  bonus_note: 'Заметка к бонусу',
  comp_static_id: 'Static компенсации',
  comp_dollars: 'Компенсация ($)',
  include_in_payout: 'Участие в выплате',
  count_verbal: 'Учитывать устные выговоры',
  count_strict: 'Учитывать строгие выговоры',
  mp_count: 'МП',
  gmp_count: 'ГМП',
  role_name: 'Роль',
  is_blocked: 'Блокировка',
  isOpen: 'Набор',
  message: 'Сообщение',
  discord_id: 'Discord ID',
  discord_username: 'Discord',
};

const TYPE_LABELS: Record<string, string> = {
  verbal: 'устный',
  strict: 'строгий',
  auto: 'авто',
  pending: 'на рассмотрении',
  approved: 'одобрено',
  rejected: 'отклонено',
  cancelled: 'отменено',
  staff: 'staff',
  organizer: 'организатор',
};

export type LogChange = {
  label?: string;
  field?: string;
  before?: unknown;
  after?: unknown;
};

export type LogEntryLike = {
  action?: unknown;
  details?: unknown;
  target_nickname?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  actor_nickname?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function humanValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return '—';
    return value.map((item) => humanValue(item)).join(', ');
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if ('name' in rec) return humanValue(rec.name);
    if ('nickname' in rec) return humanValue(rec.nickname);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  const text = String(value).trim();
  if (!text) return '—';
  return TYPE_LABELS[text] || text;
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] || key;
}

export function auditActionLabel(action: unknown): string {
  const key = String(action || '');
  return AUDIT_LABELS[key] || key || 'Действие';
}

function pushChangeLines(lines: string[], changes: unknown) {
  if (!Array.isArray(changes)) return;
  for (const raw of changes) {
    const item = asRecord(raw);
    const label = String(item.label || fieldLabel(String(item.field || 'поле')));
    const before = humanValue(item.before);
    const after = humanValue(item.after);
    if (before === after) continue;
    lines.push(`${label}: было «${before}» → стало «${after}»`);
  }
}

function pushBeforeAfterObject(lines: string[], before: unknown, after: unknown) {
  const a = asRecord(after);
  const b = asRecord(before);
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]))
    .filter((key) => !['permissions', 'dashboardBlocks', 'dashboard_blocks'].includes(key));
  for (const key of keys) {
    if (!(key in a) && !(key in b)) continue;
    const left = humanValue(b[key]);
    const right = humanValue(a[key]);
    if (left === right) continue;
    lines.push(`${fieldLabel(key)}: было «${left}» → стало «${right}»`);
  }
}

/** Человекочитаемое описание записи журнала / лога выплат. */
export function describeLogEntry(entry: LogEntryLike): { title: string; lines: string[] } {
  const action = String(entry.action || '');
  const details = asRecord(entry.details);
  const title = auditActionLabel(action);
  const lines: string[] = [];

  const who = details.nickname || details.targetNickname || entry.target_nickname;
  if (who) lines.push(`Сотрудник: ${humanValue(who)}`);

  if (typeof details.summary === 'string' && details.summary.trim()) {
    lines.push(details.summary.trim());
  }

  pushChangeLines(lines, details.changes);

  if (details.before != null || details.after != null) {
    if (
      details.before != null
      && details.after != null
      && typeof details.before === 'object'
      && typeof details.after === 'object'
      && !Array.isArray(details.before)
      && !Array.isArray(details.after)
    ) {
      pushBeforeAfterObject(lines, details.before, details.after);
    } else if (details.before != null || details.after != null) {
      lines.push(`Было «${humanValue(details.before)}» → стало «${humanValue(details.after)}»`);
    }
  }

  if (details.reason != null && String(details.reason).trim()) {
    lines.push(`Причина: ${humanValue(details.reason)}`);
  }
  if (details.type != null && String(details.type).trim()) {
    lines.push(`Тип: ${humanValue(details.type)}`);
  }
  if (typeof details.isOpen === 'boolean') {
    lines.push(details.isOpen ? 'Набор открыт' : 'Набор закрыт');
  }
  if (details.message != null && String(details.message).trim()) {
    lines.push(`Сообщение: ${humanValue(details.message)}`);
  }
  if (details.title != null && String(details.title).trim() && action.startsWith('gmp.')) {
    lines.push(`ГМП: ${humanValue(details.title)}`);
  }
  if (details.name != null && String(details.name).trim() && action.startsWith('role.')) {
    lines.push(`Роль: ${humanValue(details.name)}`);
  }
  if (details.kind === 'verbal' || details.kind === 'strict') {
    const counted = details.counted;
    lines.push(
      `${details.kind === 'verbal' ? 'Устные' : 'Строгие'} выговоры: ${
        counted === true || counted === 'true' ? 'учитываются' : 'не учитываются'
      }`,
    );
  }
  if (action === 'week.rebuild') {
    const users = Number(details.users);
    const force = details.forceAll === true;
    lines.push(
      force
        ? `Полный сброс правок${Number.isFinite(users) ? `, сотрудников: ${users}` : ''}`
        : `Пересчёт автополей${Number.isFinite(users) ? `, сотрудников: ${users}` : ''}`,
    );
  }
  if (action === 'week.create' && details.weekStart) {
    lines.push(`Неделя с ${humanValue(details.weekStart)}`);
  }
  if (action === 'row.add' && !who && details.userId != null) {
    lines.push(`Добавлен сотрудник #${details.userId}`);
  }
  if (action === 'row.delete' && !who) {
    lines.push('Строка удалена из ведомости');
  }

  // Не дублируем технический мусор, если уже есть нормальные строки.
  if (!lines.length) {
    const skip = new Set([
      'action', 'rowId', 'fields', 'userId', 'onlyUserId', 'forceAll', 'users',
      'permissions', 'payoutRates', 'dashboardBlocks', 'actorId',
    ]);
    for (const [key, value] of Object.entries(details)) {
      if (skip.has(key) || value == null || value === '') continue;
      if (typeof value === 'object') continue;
      lines.push(`${fieldLabel(key)}: ${humanValue(value)}`);
    }
  }

  return { title, lines };
}

export function formatLogDetails(entry: LogEntryLike): string {
  return describeLogEntry(entry).lines.join(' · ');
}

export function auditHref(entry: {
  entity_type?: string;
  entity_id?: string | number | null;
  details?: Record<string, unknown> | null;
}): string | null {
  const details = entry.details || {};
  const entityType = String(entry.entity_type || '');
  const entityId = entry.entity_id != null ? String(entry.entity_id) : '';

  const userId = details.userId ?? details.candidateUserId
    ?? (entityType === 'user' && /^\d+$/.test(entityId) ? entityId : null);
  if (userId != null && String(userId)) {
    return `/app/roster?user=${userId}`;
  }
  if (entityType === 'application' || entityType.startsWith('application')) {
    return entityId ? `/app/application-history#app-${entityId}` : '/app/application-history';
  }
  if (entityType === 'applications_settings') return '/app/applications';
  if (entityType === 'vacation') return '/app/vacations';
  if (entityType === 'role') return '/app/roles';
  if (entityType === 'reprimand') return '/app/reprimands';
  if (entityType === 'rule') return '/app/rules';
  if (entityType === 'prop') return '/app/props';
  if (entityType === 'gmp') {
    return entityId ? `/app/gmp/${entityId}` : '/app/gmp';
  }
  if (entityType === 'content') {
    const section = entityId.split(':')[0];
    if (section === 'faq') return '/app/faq';
    if (section === 'regulations') return '/app/regulations';
    if (section === 'first_steps') return '/app/first-steps';
  }
  return null;
}
