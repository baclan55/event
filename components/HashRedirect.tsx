'use client';

import { useEffect } from 'react';

const routes: Record<string, string> = {
  home: '/', apply: '/apply', dashboard: '/app/dashboard', profile: '/app/profile',
  faq: '/app/faq', roster: '/app/roster', rules: '/app/rules', regulations: '/app/regulations',
  firstSteps: '/app/first-steps', vacations: '/app/vacations', reprimands: '/app/reprimands',
  applications: '/app/applications', candidates: '/app/candidates', roles: '/app/roles', owner: '/app/roles',
  blocked: '/app/blocked', pending: '/app/pending',
};

export function HashRedirect() {
  useEffect(() => {
    const hash = window.location.hash.replace(/^#\/?/, '');
    if (routes[hash]) window.location.replace(routes[hash]);
  }, []);
  return null;
}
