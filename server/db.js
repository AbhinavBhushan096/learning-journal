import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { hashPassword, tokenHash } from './security.js';

export function createDatabase(filename = config.databasePath) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      name TEXT NOT NULL, handle TEXT NOT NULL, bio TEXT NOT NULL, location TEXT NOT NULL,
      role TEXT NOT NULL, avatar_url TEXT, quote TEXT NOT NULL,
      currently_learning TEXT NOT NULL, current_progress INTEGER NOT NULL DEFAULT 0,
      github_url TEXT, linkedin_url TEXT, youtube_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('lecture','note','anki','project','article','questions','image')),
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL,
      url TEXT, thumbnail_url TEXT, image_url TEXT, subject TEXT NOT NULL DEFAULT 'General',
      duration_minutes INTEGER NOT NULL DEFAULT 0, metrics TEXT NOT NULL DEFAULT '{}',
      published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_entries_occurred ON entries(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type, published);
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );
    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(entry_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS daily_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, goal_date TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_goals_date ON daily_goals(goal_date);
  `);
  return wrapSqlite(db);
}

function wrapSqlite(db) {
  return {
    dialect: 'sqlite',
    exec(sql) { db.exec(sql); },
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
        run: (...params) => statement.run(...params)
      };
    },
    close() { db.close(); }
  };
}

export async function openDatabase(filename = config.databasePath) {
  if (filename === ':memory:' || !config.azureSql) return createDatabase(filename);
  const { createAzureDatabase } = await import('./sqlserver.js');
  return createAzureDatabase(config.azureSql);
}

function mapEntry(row) {
  if (!row) return null;
  return {
    id: row.id, type: row.type, title: row.title, description: row.description,
    occurredAt: row.occurred_at, url: row.url, thumbnailUrl: row.thumbnail_url,
    imageUrl: row.image_url, subject: row.subject, durationMinutes: row.duration_minutes,
    metrics: safeJson(row.metrics), published: Boolean(row.published), tags: row.tags ? row.tags.split('|').filter(Boolean) : [],
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function safeJson(value, fallback = {}) { try { const parsed = JSON.parse(value || ''); return parsed ?? fallback; } catch { return fallback; } }
function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function entryDay(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso || '').slice(0, 10) : localDay(date);
}
function shiftLocalDay(day, delta) {
  const [y, m, d] = String(day).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + delta);
  return localDay(date);
}
function dayOffset(days) { const date = new Date(); date.setDate(date.getDate() + days); return date; }
function at(days, hour, minute = 0) { const date = dayOffset(days); date.setHours(hour, minute, 0, 0); return date.toISOString(); }
async function ensureColumn(db, table, column, type) {
  if (db.dialect === 'azure') {
    const row = await db.prepare('SELECT COL_LENGTH(?, ?) AS len').get(table, column);
    if (!row || row.len == null) await db.exec(`ALTER TABLE ${table} ADD ${column} NVARCHAR(MAX) NULL`);
    return;
  }
  const present = new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).map(columnInfo => columnInfo.name));
  if (!present.has(column)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

const defaultEducation = [{ school: 'Self-directed study', detail: 'Physics, chemistry, and computer science', years: '2024 — present' }];
const defaultExperience = [{ role: 'Learning in public', org: 'Personal journal', dates: '2024 — present', summary: 'Publishing lectures, notes, projects, and revision stats as I learn.' }];
const defaultSkills = ['Computer Science', 'Physics', 'Chemistry', 'Web development', 'Anki'];
const defaultAbout = 'I learn in public and keep a daily record of lectures, notes, projects, and questions. This page is the longer story: what I study, where I have practiced it, and the resume I share with collaborators.';

export async function initializeDatabase(db) {
  for (const [column, type] of [['about', 'TEXT'], ['education', 'TEXT'], ['experience', 'TEXT'], ['skills', 'TEXT'], ['resume_url', 'TEXT'], ['twitter_url', 'TEXT']]) {
    await ensureColumn(db, 'profile', column, type);
  }
  const userSql = db.dialect === 'azure' ? 'SELECT TOP (1) id FROM users' : 'SELECT id FROM users LIMIT 1';
  if (config.adminEmail && config.adminPassword && !(await db.prepare(userSql).get())) {
    const { hash, salt } = await hashPassword(config.adminPassword);
    await db.prepare('INSERT INTO users(email,password_hash,password_salt) VALUES(?,?,?)').run(config.adminEmail.toLowerCase(), hash, salt);
  }
  const profileValues = [
    config.ownerName, config.ownerHandle, 'Documenting my learning journey, one day at a time.', 'India',
    'Student · Builder · Lifelong learner', null, 'Curious today, a better tomorrow.',
    'Rotational Motion', 60, 'https://github.com/', 'https://www.linkedin.com/', 'https://www.youtube.com/'
  ];
  if (db.dialect === 'azure') {
    await db.prepare(`IF NOT EXISTS (SELECT 1 FROM profile WHERE id = 1)
      INSERT INTO profile(id,name,handle,bio,location,role,avatar_url,quote,currently_learning,current_progress,github_url,linkedin_url,youtube_url)
      VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...profileValues);
  } else {
    await db.prepare(`INSERT INTO profile(id,name,handle,bio,location,role,avatar_url,quote,currently_learning,current_progress,github_url,linkedin_url,youtube_url)
      VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).run(...profileValues);
  }
  await db.prepare(`UPDATE profile SET about=? WHERE id=1 AND about IS NULL`).run(defaultAbout);
  await db.prepare(`UPDATE profile SET education=? WHERE id=1 AND education IS NULL`).run(JSON.stringify(defaultEducation));
  await db.prepare(`UPDATE profile SET experience=? WHERE id=1 AND experience IS NULL`).run(JSON.stringify(defaultExperience));
  await db.prepare(`UPDATE profile SET skills=? WHERE id=1 AND skills IS NULL`).run(JSON.stringify(defaultSkills));
  const entrySql = db.dialect === 'azure' ? 'SELECT TOP (1) id FROM entries' : 'SELECT id FROM entries LIMIT 1';
  if (!(await db.prepare(entrySql).get())) await seedJournal(db);
  await refreshSeedArt(db);
  await cleanupSessions(db);
}

async function seedJournal(db) {
  const samples = [
    { type:'lecture', title:'Rotational Motion | Class 11 Physics | Full Lecture', description:'Learned about moment of inertia, rotational kinetic energy, and solved NCERT examples. Need to practice more questions.', occurredAt:at(0,10), url:'https://www.youtube.com/watch?v=i2Y-KYvYLAo', thumbnailUrl:'/art/lecture.svg', subject:'Physics', durationMinutes:78, tags:['physics','rotational motion','class 11'], metrics:{progress:100} },
    { type:'anki', title:'Revised 50 flashcards', description:'Focused on alcohols, phenols and ethers. I will revise again in two days.', occurredAt:at(0,13,30), subject:'Organic Chemistry', durationMinutes:24, tags:['anki','organic chemistry','revision'], metrics:{reviewed:50,correct:42,incorrect:8,progress:84} },
    { type:'article', title:'What is Dopamine? | The Science of Motivation', description:'Read and summarized key points about how dopamine affects learning, habits and productivity.', occurredAt:at(0,16,15), url:'https://en.wikipedia.org/wiki/Dopamine', thumbnailUrl:'/art/article.svg', subject:'Neuroscience', durationMinutes:18, tags:['productivity','neuroscience','mindset'], metrics:{progress:100} },
    { type:'lecture', title:"Electrostatics | Gauss's Law | Full Lecture", description:'Understood the derivation and solved numericals. Will revise again tomorrow.', occurredAt:at(-1,9), url:'https://www.youtube.com/watch?v=F-vQdFMDiKE', thumbnailUrl:'/art/electrostatics.svg', subject:'Physics', durationMinutes:62, tags:['physics','electrostatics',"gauss's law"], metrics:{progress:100} },
    { type:'questions', title:'NCERT Exercise 1.1', description:'Focused on basic concepts and cleared doubts. A few tricky questions remain.', occurredAt:at(-1,12), subject:'Physics', durationMinutes:35, tags:['physics','ncert','practice'], metrics:{solved:15,correct:13,incorrect:2,progress:87} },
    { type:'note', title:'Chemistry — Key Formulas', description:'Created a quick revision note for organic compounds, reaction mechanisms and named reactions.', occurredAt:at(-1,15,30), thumbnailUrl:'/art/note.svg', subject:'Chemistry', durationMinutes:20, tags:['chemistry','notes','revision'], metrics:{progress:100} },
    { type:'project', title:'Personal Study Dashboard (UI)', description:'Worked on the homepage design, timeline cards, responsive layout and add-content workflow.', occurredAt:at(-1,18), thumbnailUrl:'/art/project.svg', subject:'Web Development', durationMinutes:95, tags:['web development','ui/ux','project'], metrics:{progress:68} },
    { type:'image', title:'Mind map: Cell Division', description:'Turned today’s biology lesson into one visual revision sheet.', occurredAt:at(-2,11), thumbnailUrl:'/art/biology.svg', subject:'Biology', durationMinutes:30, tags:['biology','mind map','revision'], metrics:{progress:100} },
    { type:'article', title:'How spaced repetition improves recall', description:'Compared active recall with rereading and updated my revision schedule.', occurredAt:at(-2,17), url:'https://en.wikipedia.org/wiki/Spaced_repetition', thumbnailUrl:'/art/article.svg', subject:'Learning Science', durationMinutes:22, tags:['learning science','anki','memory'], metrics:{progress:100} }
  ];
  for (let i = 3; i <= 11; i++) samples.push({ type: i % 3 === 0 ? 'anki' : i % 3 === 1 ? 'note' : 'questions', title: i % 3 === 0 ? 'Daily flashcard review' : i % 3 === 1 ? 'Revision notes' : 'Practice questions', description:'A focused study block with a short reflection and next step.', occurredAt:at(-i, 17), subject:i % 2 ? 'Physics':'Chemistry', durationMinutes:30 + i, tags:['consistency','daily learning'], metrics:{reviewed:i % 3 === 0 ? 30 + i : 0, solved:i % 3 === 2 ? 10 + i : 0, progress:100} });
  const insert = db.prepare(`INSERT INTO entries(type,title,description,occurred_at,url,thumbnail_url,image_url,subject,duration_minutes,metrics,published) VALUES(?,?,?,?,?,?,?,?,?,?,1)`);
  await db.exec('BEGIN');
  try {
    for (const sample of samples) {
      const result = await insert.run(sample.type, sample.title, sample.description, sample.occurredAt, sample.url || null, sample.thumbnailUrl || null, sample.imageUrl || null, sample.subject, sample.durationMinutes, JSON.stringify(sample.metrics || {}));
      await setTags(db, Number(result.lastInsertRowid), sample.tags || []);
    }
    const goalInsert = db.prepare('INSERT INTO daily_goals(title,goal_date,completed,sort_order) VALUES(?,?,?,?)');
    for (const [index, goal] of ['Watch lecture','Anki revision','Read article','Solve questions'].entries()) {
      await goalInsert.run(goal, localDay(), index < 3 ? 1 : 0, index);
    }
    await db.exec('COMMIT');
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
const seedArt = {
  'Rotational Motion | Class 11 Physics | Full Lecture': '/art/lecture.svg',
  "Electrostatics | Gauss's Law | Full Lecture": '/art/electrostatics.svg',
  'What is Dopamine? | The Science of Motivation': '/art/article.svg',
  'How spaced repetition improves recall': '/art/article.svg',
  'Chemistry — Key Formulas': '/art/note.svg',
  'Personal Study Dashboard (UI)': '/art/project.svg',
  'Mind map: Cell Division': '/art/biology.svg'
};
async function refreshSeedArt(db) {
  const update = db.prepare(`UPDATE entries SET thumbnail_url=? WHERE title=? AND (thumbnail_url IS NULL OR thumbnail_url='' OR thumbnail_url LIKE 'http%') AND (image_url IS NULL OR image_url='')`);
  for (const [title, url] of Object.entries(seedArt)) await update.run(url, title);
}
async function setTags(db, entryId, tags) {
  await db.prepare('DELETE FROM entry_tags WHERE entry_id=?').run(entryId);
  const add = db.dialect === 'azure'
    ? db.prepare('IF NOT EXISTS (SELECT 1 FROM tags WHERE name = ?) INSERT INTO tags(name) VALUES(?)')
    : db.prepare('INSERT INTO tags(name) VALUES(?) ON CONFLICT(name) DO NOTHING');
  const link = db.dialect === 'azure'
    ? db.prepare('IF NOT EXISTS (SELECT 1 FROM entry_tags WHERE entry_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)) INSERT INTO entry_tags(entry_id,tag_id) SELECT ?,id FROM tags WHERE name = ?')
    : db.prepare('INSERT OR IGNORE INTO entry_tags(entry_id,tag_id) SELECT ?,id FROM tags WHERE name=?');
  for (const tag of tags) {
    if (db.dialect === 'azure') {
      await add.run(tag, tag);
      await link.run(entryId, tag, entryId, tag);
    } else {
      await add.run(tag);
      await link.run(entryId, tag);
    }
  }
}
function entryFrom(db) {
  if (db.dialect === 'azure') {
    return `SELECT e.*, agg.tags FROM entries e OUTER APPLY (SELECT STRING_AGG(t.name, '|') AS tags FROM entry_tags et INNER JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id) agg`;
  }
  return `SELECT e.*, group_concat(t.name,'|') tags FROM entries e LEFT JOIN entry_tags et ON et.entry_id=e.id LEFT JOIN tags t ON t.id=et.tag_id`;
}
export async function listEntries(db, { type='all', search='', limit=100, admin=false } = {}) {
  const where = []; const params = [];
  if (!admin) where.push('e.published=1');
  if (type !== 'all') { where.push('e.type=?'); params.push(type); }
  if (search) {
    where.push(db.dialect === 'azure'
      ? `(e.title LIKE ? OR e.description LIKE ? OR e.subject LIKE ? OR EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND t.name LIKE ?))`
      : '(e.title LIKE ? OR e.description LIKE ? OR e.subject LIKE ? OR t.name LIKE ?)');
    const q=`%${search}%`; params.push(q,q,q,q);
  }
  params.push(Math.min(200,Math.max(1,limit)));
  const grouped = db.dialect === 'azure' ? '' : ' GROUP BY e.id';
  const rows = await db.prepare(`${entryFrom(db)} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}${grouped} ORDER BY e.occurred_at DESC LIMIT ?`).all(...params);
  return rows.map(mapEntry);
}
export async function getEntry(db, id, admin=false) {
  const grouped = db.dialect === 'azure' ? '' : ' GROUP BY e.id';
  const row = await db.prepare(`${entryFrom(db)} WHERE e.id=? ${admin?'':'AND e.published=1'}${grouped}`).get(id);
  return mapEntry(row);
}
export async function createEntry(db, input) {
  const result = await db.prepare(`INSERT INTO entries(type,title,description,occurred_at,url,thumbnail_url,image_url,subject,duration_minutes,metrics,published) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(input.type,input.title,input.description,input.occurredAt,input.url,input.thumbnailUrl,input.imageUrl,input.subject,input.durationMinutes,JSON.stringify(input.metrics),input.published?1:0);
  await setTags(db, Number(result.lastInsertRowid), input.tags); return getEntry(db, Number(result.lastInsertRowid), true);
}
export async function updateEntry(db, id, patch) {
  const current = await getEntry(db,id,true); if(!current) return null;
  const value = { ...current, ...patch, metrics: patch.metrics ?? current.metrics, tags: patch.tags ?? current.tags };
  await db.prepare(`UPDATE entries SET type=?,title=?,description=?,occurred_at=?,url=?,thumbnail_url=?,image_url=?,subject=?,duration_minutes=?,metrics=?,published=?,updated_at=datetime('now') WHERE id=?`).run(value.type,value.title,value.description,value.occurredAt,value.url,value.thumbnailUrl,value.imageUrl,value.subject,value.durationMinutes,JSON.stringify(value.metrics),value.published?1:0,id);
  await setTags(db,id,value.tags); return getEntry(db,id,true);
}
export async function deleteEntry(db,id) { return (await db.prepare('DELETE FROM entries WHERE id=?').run(id)).changes > 0; }
function listField(value) { const parsed = safeJson(value, []); return Array.isArray(parsed) ? parsed : []; }
export async function getProfile(db) {
  const row=await db.prepare('SELECT * FROM profile WHERE id=1').get();
  return {name:row.name,handle:row.handle,bio:row.bio,about:row.about||'',location:row.location,role:row.role,avatarUrl:row.avatar_url,quote:row.quote,currentlyLearning:row.currently_learning,currentProgress:row.current_progress,githubUrl:row.github_url,linkedinUrl:row.linkedin_url,youtubeUrl:row.youtube_url,twitterUrl:row.twitter_url,resumeUrl:row.resume_url,education:listField(row.education),experience:listField(row.experience),skills:listField(row.skills)};
}
export async function updateProfile(db,p) {
  await db.prepare(`UPDATE profile SET name=?,handle=?,bio=?,about=?,location=?,role=?,avatar_url=?,quote=?,currently_learning=?,current_progress=?,github_url=?,linkedin_url=?,youtube_url=?,twitter_url=?,resume_url=?,education=?,experience=?,skills=?,updated_at=datetime('now') WHERE id=1`).run(p.name,p.handle,p.bio,p.about,p.location,p.role,p.avatarUrl||null,p.quote,p.currentlyLearning,p.currentProgress,p.githubUrl,p.linkedinUrl,p.youtubeUrl,p.twitterUrl,p.resumeUrl,JSON.stringify(p.education||[]),JSON.stringify(p.experience||[]),JSON.stringify(p.skills||[]));
  return getProfile(db);
}
export async function getUserByEmail(db,email) { return db.prepare('SELECT * FROM users WHERE email=?').get(email); }
export async function createSession(db,userId,rawToken,expiresAt) { await db.prepare('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)').run(userId,tokenHash(rawToken),expiresAt); }
export async function userForSession(db,rawToken) { if(!rawToken) return null; return await db.prepare(`SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>datetime('now')`).get(tokenHash(rawToken)) || null; }
export async function deleteSession(db,rawToken) { if(rawToken) await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(rawToken)); }
export async function cleanupSessions(db) { await db.prepare("DELETE FROM sessions WHERE expires_at<=datetime('now')").run(); }
export async function getGoals(db,date=localDay()) { return (await db.prepare('SELECT id,title,completed FROM daily_goals WHERE goal_date=? ORDER BY sort_order,id').all(date)).map(r=>({...r,completed:Boolean(r.completed)})); }
export async function toggleGoal(db,id) { await db.prepare('UPDATE daily_goals SET completed=CASE completed WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(id); const r=await db.prepare('SELECT id,title,completed FROM daily_goals WHERE id=?').get(id); return r?{...r,completed:Boolean(r.completed)}:null; }
function sharePercents(rows) {
  const total = rows.reduce((sum, row) => sum + row.minutes, 0);
  if (!total) return rows.map(row => ({ ...row, percent: 0 }));
  const scored = rows.map(row => {
    const exact = row.minutes / total * 100;
    return { ...row, percent: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = 100 - scored.reduce((sum, row) => sum + row.percent, 0);
  for (const row of [...scored].sort((a, b) => b.remainder - a.remainder || b.minutes - a.minutes)) {
    if (left <= 0) break;
    row.percent += 1;
    left -= 1;
  }
  return scored.map(({ remainder, ...row }) => row);
}
export async function getStats(db) {
  const entries = await db.prepare('SELECT occurred_at,subject,duration_minutes,type FROM entries WHERE published=1 ORDER BY occurred_at').all();
  const counts = new Map();
  for (const entry of entries) {
    const day = entryDay(entry.occurred_at);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  const daySet = new Set(counts.keys());
  let streak = 0;
  let cursor = localDay();
  if (!daySet.has(cursor)) cursor = shiftLocalDay(cursor, -1);
  while (daySet.has(cursor)) { streak += 1; cursor = shiftLocalDay(cursor, -1); }
  const subjects = {};
  for (const entry of entries) subjects[entry.subject] = (subjects[entry.subject] || 0) + entry.duration_minutes;
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.duration_minutes, 0);
  const ranked = Object.entries(subjects).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, minutes]) => ({ name, minutes }));
  const activity = [...counts.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
  return { days: daySet.size, totalMinutes, totalHours: Math.round(totalMinutes / 6) / 10, totalTopics: new Set(entries.map(entry => entry.subject)).size, streak, subjects: sharePercents(ranked), activity, entryCount: entries.length, today: localDay() };
}
