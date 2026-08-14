import type { TopStaffMember } from '@/lib/topStaff';

function CrownIcon() {
  return (
    <svg className="top3-crown" viewBox="0 0 24 24" aria-hidden>
      <path d="M3 8.5 7 11l5-6.5L17 11l4-2.5-1.7 9.4a1 1 0 0 1-1 .8H5.7a1 1 0 0 1-1-.8L3 8.5Z" />
      <circle cx="3" cy="7.2" r="1.5" />
      <circle cx="12" cy="3.2" r="1.5" />
      <circle cx="21" cy="7.2" r="1.5" />
    </svg>
  );
}

function PodiumAvatar({ member }: { member: TopStaffMember }) {
  return member.avatarUrl ? (
    <img src={member.avatarUrl} alt="" />
  ) : (
    <span>{member.nickname.slice(0, 1).toUpperCase()}</span>
  );
}

function PodiumItem({ member, place }: { member: TopStaffMember; place: 1 | 2 | 3 }) {
  return (
    <div className={`top3-item top3-item-${place}`}>
      <div className="top3-avatar-wrap">
        {place === 1 ? <CrownIcon /> : null}
        <div className="top3-avatar">
          <PodiumAvatar member={member} />
        </div>
      </div>
      <div className="top3-name">{member.nickname}</div>
      <div className="top3-card">
        <div className="top3-rank">#{place}</div>
        <div className="top3-score">+{member.weeklyEvents}</div>
        <div className="top3-score-label">МП за неделю</div>
      </div>
    </div>
  );
}

/**
 * Публичный подиум «Топ-3 недели» для главной страницы: администраторы и
 * хелперы вместе, без фракций/ролей на карточке — только аватар, имя и
 * количество МП за текущую календарную неделю.
 */
export function TopStaffPodium({ members }: { members: TopStaffMember[] }) {
  if (!members.length) return null;
  const [first, second, third] = members;
  return (
    <section className="site-section top3-section">
      <h2 className="site-h2 top3-title">Топ-3 недели</h2>
      <p className="top3-sub">Администраторы и хелперы с наибольшим числом МП за текущую неделю</p>
      <div className="top3-podium">
        {second ? <PodiumItem member={second} place={2} /> : null}
        {first ? <PodiumItem member={first} place={1} /> : null}
        {third ? <PodiumItem member={third} place={3} /> : null}
      </div>
    </section>
  );
}
