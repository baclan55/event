// Доступ к некоторым разделам личного кабинета определяется не флагами
// is_admin/is_owner (те по-прежнему решают, кто может РЕДАКТИРОВАТЬ
// контент/состав), а напрямую названием текущей роли сотрудника — см.
// названия ролей в src/db/seed.js. Список ниже задаёт, кому какой раздел
// открыт целиком (и на просмотр, и на управление).

const REPRIMANDS_ROLES = [
  'Chief Event Helper',
  'Dep.Chief Event Helper',
  'Senior Event Helper',
  'Chief Event',
  'Dep.Chief Event',
];

const APPLICATIONS_ROLES = [
  'Chief Event Helper',
  'Dep.Chief Event Helper',
  'Chief Event',
  'Dep.Chief Event',
];

const OWNER_PANEL_ROLES = ['Chief Event', 'Dep.Chief Event'];

module.exports = { REPRIMANDS_ROLES, APPLICATIONS_ROLES, OWNER_PANEL_ROLES };
