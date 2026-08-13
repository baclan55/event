/** Клиент-безопасные константы аудита (без server-only / db). */

export const DEFAULT_CLOSED_MESSAGE =
  'Набор закрыт — следите за новостями о новом наборе.';

export const AUDIT_LABELS: Record<string, string> = {
  'user.create': 'Создан пользователь',
  'user.update': 'Изменён пользователь',
  'user.delete': 'Удалён пользователь',
  'roles.update': 'Изменены роли пользователя',
  'roles.reorder': 'Изменён вес ролей',
  'role.create': 'Создана роль',
  'role.update': 'Изменена роль',
  'role.delete': 'Удалена роль',
  'reprimand.create': 'Выдан выговор',
  'reprimand.delete': 'Удалён выговор',
  'reprimand.unblock': 'Снята блокировка',
  'vacation.create': 'Создан отпуск',
  'vacation.approved': 'Отпуск одобрен',
  'vacation.rejected': 'Отпуск отклонён',
  'vacation.cancelled': 'Отпуск отменён',
  'vacation.delete': 'Удалён отпуск',
  'content.update': 'Изменён контент',
  'content.image.update': 'Обновлена картинка раздела',
  'rule.create': 'Создано правило',
  'rule.update': 'Изменено правило',
  'rule.delete': 'Удалено правило',
  'application.approved': 'Заявка одобрена',
  'application.rejected': 'Заявка отклонена',
  'application.delete': 'Заявка удалена',
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
  'gmp.staff': 'Состав staff ГМП',
};

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
