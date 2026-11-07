import { cleanText, normalizeTags, safeExternalUrl } from './security.js';

export const ENTRY_TYPES = ['lecture', 'note', 'anki', 'project', 'article', 'questions', 'image'];

function fail(message, field) { throw Object.assign(new Error(message), { status: 400, field }); }
function bool(value, fallback = false) { return value === undefined ? fallback : value === true; }
function number(value, min, max, fallback = 0) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function validateLogin(body) {
  const email = cleanText(body?.email, 254).toLowerCase();
  const password = String(body?.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.', 'email');
  if (password.length < 8 || password.length > 200) fail('Password must be between 8 and 200 characters.', 'password');
  return { email, password };
}

export function validateEntry(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid entry payload.');
  const out = {};
  if (!partial || body.type !== undefined) {
    const type = cleanText(body.type, 20).toLowerCase();
    if (!ENTRY_TYPES.includes(type)) fail('Choose a supported activity type.', 'type');
    out.type = type;
  }
  if (!partial || body.title !== undefined) {
    const title = cleanText(body.title, 160);
    if (title.length < 3) fail('Title must be at least 3 characters.', 'title');
    out.title = title;
  }
  if (!partial || body.description !== undefined) out.description = cleanText(body.description, 5000);
  if (!partial || body.occurredAt !== undefined) {
    const date = new Date(body.occurredAt || Date.now());
    if (Number.isNaN(date.getTime())) fail('Choose a valid date and time.', 'occurredAt');
    if (date.getTime() > Date.now() + 86400000) fail('Journal entries cannot be more than one day in the future.', 'occurredAt');
    out.occurredAt = date.toISOString();
  }
  for (const [input, key] of [['url','url'], ['thumbnailUrl','thumbnailUrl'], ['imageUrl','imageUrl']]) {
    if (!partial || body[input] !== undefined) {
      const value = cleanText(body[input], 2048);
      if (value && input !== 'imageUrl' && !safeExternalUrl(value)) fail(`Enter a valid ${input}.`, input);
      if (input === 'imageUrl' && value && !value.startsWith('/uploads/') && !safeExternalUrl(value)) fail('Choose a valid uploaded image.', input);
      out[key] = value || null;
    }
  }
  if (!partial || body.subject !== undefined) out.subject = cleanText(body.subject, 60) || 'General';
  if (!partial || body.durationMinutes !== undefined) out.durationMinutes = number(body.durationMinutes, 0, 1440);
  if (!partial || body.tags !== undefined) out.tags = normalizeTags(body.tags);
  if (!partial || body.metrics !== undefined) {
    const metrics = body.metrics && typeof body.metrics === 'object' && !Array.isArray(body.metrics) ? body.metrics : {};
    out.metrics = {
      reviewed: number(metrics.reviewed, 0, 10000),
      correct: number(metrics.correct, 0, 10000),
      incorrect: number(metrics.incorrect, 0, 10000),
      solved: number(metrics.solved, 0, 10000),
      progress: number(metrics.progress, 0, 100)
    };
  }
  if (!partial || body.published !== undefined) out.published = bool(body.published, true);
  return out;
}

function mediaUrl(value) {
  const text = cleanText(value, 2048);
  if (!text) return null;
  if (/^\/uploads\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i.test(text)) return text;
  return safeExternalUrl(text);
}
function resumeUrl(value) {
  const text = cleanText(value, 2048);
  if (!text) return null;
  if (/^\/uploads\/[A-Za-z0-9._-]+\.pdf$/i.test(text)) return text;
  fail('Upload a PDF resume.', 'resumeUrl');
}
function cleanItems(list, fields, max) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, max).map(item => {
    const out = {};
    for (const [key, limit] of fields) out[key] = cleanText(item?.[key], limit);
    return out;
  }).filter(item => Object.values(item).some(Boolean));
}

export function validateProfile(body) {
  const name = cleanText(body?.name, 80);
  const handle = cleanText(body?.handle, 40).replace(/[^a-zA-Z0-9_.-]/g, '');
  if (name.length < 2) fail('Name must be at least 2 characters.', 'name');
  if (handle.length < 2) fail('Handle must be at least 2 characters.', 'handle');
  const skills = Array.isArray(body?.skills) ? [...new Set(body.skills.map(skill => cleanText(skill, 28)).filter(Boolean))].slice(0, 16) : [];
  return {
    name, handle,
    bio: cleanText(body.bio, 220), about: cleanText(body.about, 4000), location: cleanText(body.location, 80), role: cleanText(body.role, 100),
    avatarUrl: mediaUrl(body.avatarUrl), quote: cleanText(body.quote, 220),
    currentlyLearning: cleanText(body.currentlyLearning, 120), currentProgress: number(body.currentProgress, 0, 100),
    githubUrl: safeExternalUrl(body.githubUrl), linkedinUrl: safeExternalUrl(body.linkedinUrl), youtubeUrl: safeExternalUrl(body.youtubeUrl),
    twitterUrl: safeExternalUrl(body.twitterUrl), resumeUrl: resumeUrl(body.resumeUrl), skills,
    education: cleanItems(body.education, [['school', 80], ['detail', 120], ['years', 40]], 8),
    experience: cleanItems(body.experience, [['role', 80], ['org', 80], ['dates', 40], ['summary', 300]], 8)
  };
}
