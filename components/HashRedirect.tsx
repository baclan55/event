'use client';

import { useEffect } from 'react';

const routes: Record<string, string> = {
  home: '/', apply: '/apply', dashboard: '/app/dashboard', profile: '/app/profile',
  faq: '/app/faq', roster: '/app/roster', rules: '/app/rules', regulations: '/app/regulations',
  firstSteps: '/app/first-steps', vacations: '/app/vacations', reprimands: '/app/reprimands',
  applications: '/app/applications', 'application-history': '/app/application-history', candidates: '/app/candidates', roles: '/app/roles', owner: '/app/roles',
  blacklist: '/app/blacklist', achievements: '/app/achievements', gmp: '/app/gmp',
  'profile-moderation': '/app/profile-moderation',
  blocked: '/app/blocked', pending: '/app/pending',
};

export function HashRedirect() {
  useEffect(() => {
    const hash = window.location.hash.replace(/^#\/?/, '');
    if (routes[hash]) window.location.replace(routes[hash]);
  }, []);
  return null;
}
