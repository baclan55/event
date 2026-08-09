// Граница между "тирами" сотрудников — используется системой выговоров
// (см. src/routes/reprimands.js), чтобы применять разные правила к хелперам
// и администраторам.
//
// Иерархия ролей (см. src/db/seed.js), priority 1 — самая высокая. Сотрудник
// может иметь несколько ролей одновременно (см. user_roles в схеме БД) —
// тир считается по ЛУЧШЕЙ (наивысшей по приоритету) из его ролей:
//   1 Chief Event
//   2 Dep.Chief Event
//   3 Technical Administrator
//   4 Curator Event
//   5 Event Administrator      <- нижняя граница тира "администраторы"
//   6 Chief Event Helper       <- верхняя граница тира "хелперы"
//   7 Dep.Chief Event Helper
//   8 Senior Event Helper
//   9 Event Helper
//   10 Mini Event Helper
const ADMIN_TIER_MAX_PRIORITY = 5;

// priority === null (сотрудник без роли) считаем хелпером — это самый
// мягкий вариант по умолчанию, пока владелец/администратор не назначит роль.
function tierForPriority(priority) {
  if (priority == null) return 'helper';
  return priority <= ADMIN_TIER_MAX_PRIORITY ? 'admin' : 'helper';
}

module.exports = { ADMIN_TIER_MAX_PRIORITY, tierForPriority };
