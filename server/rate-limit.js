const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const now = Date.now(); const current = buckets.get(key);
  if (!current || current.reset <= now) { buckets.set(key, { count: 1, reset: now + windowMs }); return { allowed: true, remaining: limit - 1 }; }
  current.count += 1;
  return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count), retryAfter: Math.ceil((current.reset - now) / 1000) };
}
setInterval(() => { const now = Date.now(); for (const [key, value] of buckets) if (value.reset <= now) buckets.delete(key); }, 60000).unref();
