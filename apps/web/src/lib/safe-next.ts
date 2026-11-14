/** Resolves a post-auth internal path (`next` query parameter), blocking open redirects. */
export function resolveSafeNextPath(fallback = '/dashboard'): string {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const raw = new URLSearchParams(window.location.search).get('next');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) {
    return fallback;
  }
  return raw;
}

/** Builds an auth route path preserving an optional internal `next` destination. */
export function buildAuthHref(basePath: '/login' | '/register', nextPath: string | null): string {
  if (!nextPath || nextPath === '/dashboard') {
    return basePath;
  }
  return `${basePath}?next=${encodeURIComponent(nextPath)}`;
}
