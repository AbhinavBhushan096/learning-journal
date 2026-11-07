import fs from 'node:fs';
import path from 'node:path';

export function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), ...extra });
  res.end(payload);
}
export function noContent(res, extra = {}) { res.writeHead(204, extra); res.end(); }
export async function readBody(req, maxBytes = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}
export async function readBuffer(req, maxBytes) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Uploaded file is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function cookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('='); if (index < 0) continue;
    result[decodeURIComponent(part.slice(0, index).trim())] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}
export function setCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.json':'application/json; charset=utf-8','.woff2':'font/woff2' };
export function serveFile(res, file, cache = false) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const stat = fs.statSync(file);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res); return true;
}
export function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw Object.assign(new Error('Invalid multipart upload.'), { status: 400 });
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {}; const files = [];
  let start = buffer.indexOf(boundary) + boundary.length;
  while (start >= boundary.length) {
    if (buffer.subarray(start, start + 2).toString() === '--') break;
    start += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start); if (headerEnd < 0) break;
    const headers = buffer.subarray(start, headerEnd).toString('utf8');
    const next = buffer.indexOf(boundary, headerEnd + 4); if (next < 0) break;
    const data = buffer.subarray(headerEnd + 4, next - 2);
    const name = headers.match(/name="([^"]+)"/i)?.[1];
    const filename = headers.match(/filename="([^"]*)"/i)?.[1];
    const type = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();
    if (name && filename !== undefined) files.push({ name, filename, type, data });
    else if (name) fields[name] = data.toString('utf8');
    start = next + boundary.length;
  }
  return { fields, files };
}
