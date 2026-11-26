const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google.com',
]);

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return parts;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ipv4Parts(ip);
  if (!parts) return true;
  const [a, b] = parts;
  // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('fe80')) return true;
  return false;
}

export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported URL scheme');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Blocked host');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIpv4(host)) {
    throw new Error('Private IP blocked');
  }
  if (host.includes(':') && isPrivateIpv6(host)) {
    throw new Error('Private IP blocked');
  }
  return url;
}

export async function fetchSafeMetadata(rawUrl: string, opts?: { timeoutMs?: number; maxBytes?: number }) {
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const maxBytes = opts?.maxBytes ?? 512_000;
  const url = assertSafeUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'PersonalVaultBot/1.0 (+metadata)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    // Follow one redirect manually with re-validation
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Invalid redirect');
      const next = assertSafeUrl(new URL(loc, url).toString());
      const res2 = await fetch(next.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'User-Agent': 'PersonalVaultBot/1.0 (+metadata)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      return readLimited(res2, maxBytes, next);
    }

    return readLimited(res, maxBytes, url);
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(res: Response, maxBytes: number, finalUrl: URL) {
  if (!res.ok) {
    return { url: finalUrl.toString(), html: '', status: res.status };
  }
  const reader = res.body?.getReader();
  if (!reader) return { url: finalUrl.toString(), html: '', status: res.status };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total > maxBytes ? maxBytes : total);
  let offset = 0;
  for (const c of chunks) {
    const slice = c.byteLength + offset > merged.length ? c.subarray(0, merged.length - offset) : c;
    merged.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= merged.length) break;
  }
  return {
    url: finalUrl.toString(),
    html: new TextDecoder('utf-8').decode(merged),
    status: res.status,
  };
}

export function parseHtmlMetadata(html: string, pageUrl: string) {
  const getMeta = (names: string[]) => {
    for (const name of names) {
      const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`,
        'i',
      );
      const m = html.match(re);
      if (m) return (m[1] || m[2] || '').trim();
    }
    return '';
  };

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = getMeta(['og:title', 'twitter:title']) || titleMatch?.[1]?.trim() || '';
  const description =
    getMeta(['og:description', 'description', 'twitter:description']) || '';
  const image = getMeta(['og:image', 'twitter:image']) || '';
  const siteName = getMeta(['og:site_name']) || '';

  let favicon = '';
  const iconMatch = html.match(
    /<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]+href=["']([^"']+)["'][^>]*>/i,
  );
  if (iconMatch?.[1]) favicon = iconMatch[1];

  const abs = (u: string) => {
    if (!u) return '';
    try {
      return new URL(u, pageUrl).toString();
    } catch {
      return '';
    }
  };

  let domain = '';
  try {
    domain = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    domain = '';
  }

  return {
    title: decodeEntities(title).slice(0, 500),
    description: decodeEntities(description).slice(0, 2000),
    image: abs(image),
    favicon: abs(favicon) || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : ''),
    siteName: decodeEntities(siteName).slice(0, 200),
    domain,
  };
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}
