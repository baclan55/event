function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escAttr(str) { return esc(str).replace(/'/g, '&#39;'); }

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase() || '?';
}

function avatarHTML(imageId, nickname, size) {
  const style = size ? ` style="width:${size}px;height:${size}px;"` : '';
  if (imageId) {
    return `<div class="avatar"${style}><img src="/media/${imageId}" alt=""></div>`;
  }
  return `<div class="avatar"${style}>${esc(initials(nickname))}</div>`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status) {
  if (status === 'approved') return `<span class="badge badge-green">Одобрено</span>`;
  if (status === 'rejected') return `<span class="badge badge-red">Отклонено</span>`;
  return `<span class="badge badge-amber">На рассмотрении</span>`;
}
