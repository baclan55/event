// Граница между "тирами" сотрудников — используется системой выговоров
// (см. src/routes/reprimands.js), чтобы применять разные правила к хелперам
// и администраторам.
//
// Иерархия ролей (см. src/db/seed.js), priority 1 — самая высокая:
//   1 Chief Event
//   2 Dep.Chief Event
//   3 Curator Event
//   4 Event Administrator      <- нижняя граница тира "администраторы"
//   5 Chief Event Helper       <- верхняя граница тира "хелперы"
//   6 Dep.Chief Event Helper
//   7 Senior Event Helper
//   8 Event Helper
//   9 Mini Event Helper
const ADMIN_TIER_MAX_PRIORITY = 4;

// priority === null (сотрудник без роли) считаем хелпером — это самый
// мягкий вариант по умолчанию, пока владелец/администратор не назначит роль.
function tierForPriority(priority) {
  if (priority == null) return 'helper';
  return priority <= ADMIN_TIER_MAX_PRIORITY ? 'admin' : 'helper';
}

module.exports = { ADMIN_TIER_MAX_PRIORITY, tierForPriority };
