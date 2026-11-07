import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve({ salt, hash: key.toString('hex') });
    });
  });
}

export async function verifyPassword(password, salt, expected) {
  const { hash } = await hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
export function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
export function cleanText(value, max = 5000) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map(tag => cleanText(tag, 28).toLowerCase()).filter(Boolean))].slice(0, 8);
}
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] >= 224;
  }
  if (net.isIPv6(ip)) {
    const n = ip.toLowerCase();
    return n === '::1' || n === '::' || n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe8') || n.startsWith('fe9') || n.startsWith('fea') || n.startsWith('feb') || n.startsWith('::ffff:127.') || n.startsWith('::ffff:10.') || n.startsWith('::ffff:192.168.');
  }
  return true;
}
export async function assertSafeExternalUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw Object.assign(new Error('Enter a valid URL.'), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error('Only public HTTP(S) URLs are supported.'), { status: 400 });
  if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) throw Object.assign(new Error('Private network URLs are not allowed.'), { status: 400 });
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw Object.assign(new Error('Private network URLs are not allowed.'), { status: 400 });
  return url;
}
export function safeExternalUrl(value) {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
}
