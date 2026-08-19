/** Line-иконки сайдбара (из прежнего public/js/icons.js), без внешних шрифтов. */

const svgProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function NavIcon({ name }: { name: string }) {
  const key = name.includes('/') ? name.split('/')[0] : name;
  switch (key) {
    case 'home':
      return (
        <svg {...svgProps}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
        </svg>
      );
    case 'dashboard':
      return (
        <svg {...svgProps}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'profile':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="8" r="3.4" />
          <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
        </svg>
      );
    case 'faq':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1.4 1-1.4 1.9" />
          <line x1="12" y1="17" x2="12" y2="17" />
        </svg>
      );
    case 'roster':
      return (
        <svg {...svgProps}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M15.8 14c2.3.3 3.7 2 3.7 4.6" />
        </svg>
      );
    case 'rules':
      return (
        <svg {...svgProps}>
          <path d="M6 4h11a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.7.46L15 18l-3.3 1.96a.5.5 0 0 1-.5 0L8 18l-3.3 1.96A.5.5 0 0 1 4 19.5V6a2 2 0 0 1 2-2Z" />
          <line x1="7.5" y1="8" x2="16.5" y2="8" />
          <line x1="7.5" y1="11.5" x2="16.5" y2="11.5" />
        </svg>
      );
    case 'regulations':
      return (
        <svg {...svgProps}>
          <path d="M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <line x1="9" y1="7" x2="15" y2="7" />
          <line x1="9" y1="11" x2="15" y2="11" />
          <line x1="9" y1="15" x2="13" y2="15" />
        </svg>
      );
    case 'first-steps':
      return (
        <svg {...svgProps}>
          <path d="M4 20c0-2.5 1.5-4 3.4-4" />
          <circle cx="6.6" cy="12.2" r="2" />
          <path d="M20 14c0 2.5-1.5 4-3.4 4" />
          <circle cx="17.4" cy="6" r="2" />
          <path d="M9 21l2-6M15 9l2-6" />
        </svg>
      );
    case 'vacations':
      return (
        <svg {...svgProps}>
          <rect x="3" y="7.5" width="18" height="12" rx="2" />
          <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
          <line x1="3" y1="13" x2="21" y2="13" />
          <line x1="10.5" y1="13" x2="10.5" y2="15" />
          <line x1="13.5" y1="13" x2="13.5" y2="15" />
        </svg>
      );
    case 'events':
      return (
        <svg {...svgProps}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 11h18" />
          <path d="M8 15h.01M12 15h.01M16 15h.01" />
        </svg>
      );
    case 'reprimands':
      return (
        <svg {...svgProps}>
          <path d="M12 3 2.5 19.5A1 1 0 0 0 3.4 21h17.2a1 1 0 0 0 .9-1.5L12 3Z" />
          <line x1="12" y1="9.5" x2="12" y2="13.5" />
          <line x1="12" y1="16.5" x2="12" y2="16.5" />
        </svg>
      );
    case 'applications':
    case 'application-history':
      return (
        <svg {...svgProps}>
          <path d="M4 13V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7" />
          <path d="M4 13h4.5a1 1 0 0 1 .9.55l.6 1.2a1 1 0 0 0 .9.55h2.2a1 1 0 0 0 .9-.55l.6-1.2a1 1 0 0 1 .9-.55H20" />
          <path d="M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
        </svg>
      );
    case 'candidates':
      return (
        <svg {...svgProps}>
          <path d="M21 16.5v2.7a1.8 1.8 0 0 1-2 1.8 17.8 17.8 0 0 1-7.8-2.8 17.5 17.5 0 0 1-5.4-5.4A17.8 17.8 0 0 1 3 4.9 1.8 1.8 0 0 1 4.8 3h2.7a1.8 1.8 0 0 1 1.8 1.5c.1.9.3 1.7.6 2.5a1.8 1.8 0 0 1-.4 1.9l-1.1 1.1a14.4 14.4 0 0 0 5.4 5.4l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.6.5 2.5.6a1.8 1.8 0 0 1 1.5 1.9Z" />
        </svg>
      );
    case 'owner':
    case 'roles':
      return (
        <svg {...svgProps}>
          <path d="M3 8.5 6.5 11l3-5.5L12 10l2.5-4.5 3 5.5 3.5-2.5L20 18H4L3 8.5Z" />
        </svg>
      );
    case 'blacklist':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" />
          <line x1="6.2" y1="6.2" x2="17.8" y2="17.8" />
        </svg>
      );
    case 'achievements':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="9" r="5.2" />
          <path d="M8.2 13.2 7 21l5-2.4L17 21l-1.2-7.8" />
          <path d="M9.2 8.2h5.6" />
        </svg>
      );
    case 'payouts':
      return (
        <svg {...svgProps}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 5v14" />
        </svg>
      );
    case 'gmp':
      return (
        <svg {...svgProps}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M8 15v-3" />
          <path d="M12 15V8" />
          <path d="M16 15v-5" />
          <path d="M8 7h.01M12 5h.01M16 6h.01" />
        </svg>
      );
    case 'statistics':
      return (
        <svg {...svgProps}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M8 15v-6" />
          <path d="M12 15V9" />
          <path d="M16 15v-3" />
        </svg>
      );
    case 'profile-moderation':
      return (
        <svg {...svgProps}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19c0-3 2.5-5 5.5-5 .7 0 1.4.1 2 .3" />
          <path d="M15 14.5v6" />
          <path d="M12.5 17.5h5" />
          <circle cx="17.5" cy="10" r="2.2" />
        </svg>
      );
    case 'logout':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      );
    case 'edit':
      return <svg {...svgProps}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>;
    case 'history':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
      );
    case 'trash':
      return <svg {...svgProps}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6 7 1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></svg>;
    case 'plus':
      return <svg {...svgProps}><path d="M12 5v14M5 12h14" /></svg>;
    case 'image':
      return <svg {...svgProps}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 15-4-4L5 20" /></svg>;
    case 'menu':
      return <svg {...svgProps}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case 'pip':
      return (
        <svg {...svgProps}>
          <rect x="3" y="4.5" width="18" height="14" rx="2" />
          <rect x="12.5" y="11" width="6.5" height="4.7" rx="1" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}
