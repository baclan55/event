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
  switch (name) {
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
    case 'reprimands':
      return (
        <svg {...svgProps}>
          <path d="M12 3 2.5 19.5A1 1 0 0 0 3.4 21h17.2a1 1 0 0 0 .9-1.5L12 3Z" />
          <line x1="12" y1="9.5" x2="12" y2="13.5" />
          <line x1="12" y1="16.5" x2="12" y2="16.5" />
        </svg>
      );
    case 'applications':
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
      return (
        <svg {...svgProps}>
          <path d="M3 8.5 6.5 11l3-5.5L12 10l2.5-4.5 3 5.5 3.5-2.5L20 18H4L3 8.5Z" />
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
    default:
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}
