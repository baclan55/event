// ============================================================================
// Настройка доступа к разделам личного кабинета по названию роли.
//
// Два уровня:
//  1) "Общие" разделы (FAQ, Состав, Правила МП, Регламент, Первые шаги,
//     Моя страница, Главная) — доступны любому сотруднику, у которого ЕСТЬ
//     роль (role_id не пустой). Сотрудники без роли ("Без роли") личный
//     кабинет не видят вообще — см. requireAnyRole в middleware/auth.js.
//  2) Более узкие разделы — доступны только перечисленным ниже ролям.
//
// Названия ролей должны буквально совпадать со значениями из src/db/seed.js
// (таблица roles). Этот же список продублирован на фронтенде в
// public/js/auth.js -> Auth.ROLE_GROUPS — при изменении обновлять оба места.
// ============================================================================

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

// Кандидаты, ожидающие результата обзвона (вкладка/раздел "Кандидаты") —
// более узкий срез "Заявок": Senior Event Helper видит и обзванивает
// кандидатов (может отметить прошёл/не прошёл обзвон), но саму заявку
// (анкету с личными данными, кнопки одобрить/отклонить/удалить) не видит —
// см. GET /api/applications/candidates и POST /api/applications/:id/call
// в src/routes/applications.js. Все роли из APPLICATIONS_ROLES тоже сюда
// входят — им доступно всё, что доступно этому списку, и даже больше.
const CANDIDATES_ROLES = [
  'Chief Event Helper',
  'Dep.Chief Event Helper',
  'Senior Event Helper',
  'Chief Event',
  'Dep.Chief Event',
];

const OWNER_PANEL_ROLES = ['Chief Event', 'Dep.Chief Event'];

// Редактирование контента (FAQ, Регламент, Правила МП, Первые шаги, Состав)
// — только у самых старших ролей. Флаг is_admin для этого больше не
// используется (он остаётся в БД/Панели владельца, но ни на что не влияет
// в проверках доступа ниже — владелец всё равно имеет доступ всегда, см.
// userHasRoleIn).
const EDIT_ROLES = ['Chief Event', 'Dep.Chief Event'];

// Владелец (is_owner) видит всё всегда, независимо от списков выше — это
// подстраховка на случай, если у аккаунта почему-то не проставлена нужная
// роль (например, роль сбросили вручную в «Составе»), чтобы владелец не мог
// случайно закрыть себе доступ к «Панели владельца».
function userHasAnyRole(user) {
  return !!(user && (user.role_id != null || user.is_owner));
}

function userHasRoleIn(user, roles) {
  if (!user) return false;
  if (user.is_owner) return true;
  return !!(user.role_name && roles.includes(user.role_name));
}

module.exports = {
  REPRIMANDS_ROLES,
  APPLICATIONS_ROLES,
  CANDIDATES_ROLES,
  OWNER_PANEL_ROLES,
  EDIT_ROLES,
  userHasAnyRole,
  userHasRoleIn,
};
