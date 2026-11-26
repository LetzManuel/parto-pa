// Addresses a server function must never fetch from on a user's behalf (SSRF): private networks, loopback, link-local.

/** A private, loopback, link-local or otherwise internal address (IPv4 or IPv6). */
export function internalIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const h = ip.toLowerCase();
  if (h.startsWith('::ffff:')) return internalIp(h.slice(7));
  return h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb') || h.startsWith('ff');
}
