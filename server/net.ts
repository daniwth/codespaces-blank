import { isIP } from 'node:net';

/**
 * Rate-limit bucket of an address. One IPv6 customer owns a whole /64, so those share a bucket;
 * IPv4 (also when mapped into IPv6) is counted per address.
 */
export function ipBucket(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...left, ...Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => '0'), ...right] : left;
  return `${full.slice(0, 4).map((h) => h.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
