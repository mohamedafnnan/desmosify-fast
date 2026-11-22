const DESMOS_HOSTS = new Set(['desmos.com', 'www.desmos.com']);

export function parseDesmosGraphLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !DESMOS_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.username || url.password || !/^\/calculator(?:\/|$)/i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
