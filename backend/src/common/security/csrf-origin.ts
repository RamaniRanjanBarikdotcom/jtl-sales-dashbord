type HeaderValue = string | string[] | undefined;

function firstHeader(value: HeaderValue): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || '').split(',')[0].trim();
}

function normalizedOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function isSameRequestOrigin(
  sourceOrigin: string,
  input: {
    protocol?: string;
    host?: string;
    forwardedProto?: HeaderValue;
    forwardedHost?: HeaderValue;
  },
): boolean {
  const source = normalizedOrigin(sourceOrigin);
  if (!source) return false;

  const protocol = firstHeader(input.forwardedProto) || String(input.protocol || '').trim();
  const forwardedHost = firstHeader(input.forwardedHost);
  const hosts = [forwardedHost, String(input.host || '').trim()].filter(Boolean);
  return hosts.some((host) => normalizedOrigin(`${protocol}://${host}`) === source);
}
