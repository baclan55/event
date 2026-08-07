// Роли, которым открыт доступ к некоторым разделам личного кабинета —
// зеркало src/utils/access.js на бэкенде. Держать оба списка одинаковыми.
window.ACCESS = {
  REPRIMANDS_ROLES: [
    'Chief Event Helper',
    'Dep.Chief Event Helper',
    'Senior Event Helper',
    'Chief Event',
    'Dep.Chief Event',
  ],
  APPLICATIONS_ROLES: [
    'Chief Event Helper',
    'Dep.Chief Event Helper',
    'Chief Event',
    'Dep.Chief Event',
  ],
  OWNER_PANEL_ROLES: ['Chief Event', 'Dep.Chief Event'],
};
