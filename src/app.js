const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { data: null, filter: 'all', search: '', collapsed: new Set(), opened: new Set(), view: 'home', month: '', day: '', keepScroll: false };
const typeInfo = {lecture:{label:'Lecture',icon:'play'},note:{label:'Note',icon:'note'},anki:{label:'Anki',icon:'cards'},project:{label:'Project',icon:'code'},article:{label:'Article',icon:'article'},questions:{label:'Questions',icon:'check'},image:{label:'Image',icon:'image'}};
const subjectColors = ['#9b55ee', '#497cff', '#3fc28c', '#f0a43c', '#eb5d85'];
const artFor = { lecture: '/art/lecture.svg', article: '/art/article.svg', note: '/art/note.svg', project: '/art/project.svg', image: '/art/biology.svg' };
const tiles = [
  { label: 'Learning Journal', icon: 'book', filter: 'all' },
  { label: 'Notes', icon: 'note', filter: 'note' },
  { label: 'Projects', icon: 'project', filter: 'project' },
  { label: 'Bookmarks', icon: 'bookmark', filter: 'article' },
  { label: 'Stats', icon: 'chart', view: 'stats' },
  { label: 'About', icon: 'info', view: 'about' }
];

function icon(name, cls = '') { return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function isCollapsed(day) {
  if (state.collapsed.has(day)) return true;
  if (state.opened.has(day)) return false;
  return day !== state.data.stats.today;
}
function esc(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function attrs(value = '') { return esc(value); }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({ error: 'The server returned an invalid response.' }));
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.field = data.field; error.status = response.status; throw error; }
  return data;
}
function toast(message, type = 'success') { const element = document.createElement('div'); element.className = `toast ${type}`; element.textContent = message; $('#toasts').append(element); setTimeout(() => element.remove(), 4200); }
function localKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function entryDay(iso) { const date = new Date(iso); return Number.isNaN(date.getTime()) ? String(iso).slice(0, 10) : localKey(date); }
function shiftDay(day, delta) { const [y, m, d] = day.split('-').map(Number); const date = new Date(y, m - 1, d); date.setDate(date.getDate() + delta); return localKey(date); }
function viewFromHash() { const raw = location.hash.replace(/^#\/?/, ''); if (raw.startsWith('about')) return 'about'; if (raw.startsWith('stats')) return 'stats'; if (raw.startsWith('now')) return 'now'; return 'home'; }
function prettyDate(day) { return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); }
function formatDay(day) { const today = state.data.stats.today; if (day === today) return { label: 'Today', date: prettyDate(day) }; if (day === shiftDay(today, -1)) return { label: 'Yesterday', date: prettyDate(day) }; return { label: prettyDate(day), date: '' }; }
function time(value) { return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
function clock(minutes) { const value = Number(minutes) || 0; if (!value) return ''; const hours = Math.floor(value / 60); const mins = value % 60; return hours ? `${hours}:${String(mins).padStart(2, '0')}` : `${mins}m`; }
function hours(minutes) { return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ''}` : `${minutes}m`; }
function initials(name) { return name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase(); }
function host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function profileAvatar(profile) { return profile.avatarUrl ? `<img src="${attrs(profile.avatarUrl)}" alt="Portrait of ${attrs(profile.name)}">` : `<span aria-hidden="true">${esc(initials(profile.name || 'A'))}</span>`; }
function go(view, filter) {
  state.view = ['home', 'about', 'stats', 'now'].includes(view) ? view : 'home';
  if (filter !== undefined) state.filter = filter;
  const next = state.view === 'home' ? '#/' : `#/${state.view}`;
  if (location.hash !== next) history.pushState(null, '', next);
  state.keepScroll = false;
  render();
  window.scrollTo(0, 0);
}
function tileOn(tile) { return tile.view ? state.view === tile.view : state.view === 'home' && state.filter === tile.filter; }

function leftSidebar() {
  const { profile, stats } = state.data;
  const skill = profile.skills?.[0];
  return `<aside class="left-sidebar">
    <section class="panel profile-card"><div class="avatar-ring"><div class="avatar">${profileAvatar(profile)}</div><i class="online-dot" aria-label="Learning today"></i></div><h1>${esc(profile.name)}</h1><div class="handle">@${esc(profile.handle)}</div><div class="role">${esc(profile.role)}</div><p class="profile-quote">“${esc(profile.quote)}”</p><div class="profile-meta"><div class="meta-line">${icon('location')}<span>${esc(profile.location)}</span></div>${skill ? `<div class="meta-line">${icon('book')}<span>${esc(skill)}</span></div>` : ''}<div class="meta-line">${icon('book')}<span>Learning in public</span></div><div class="meta-line">${icon('code')}<span>Open to opportunities</span></div></div><div class="mini-stats"><div class="mini-stat"><span class="mini-stat-icon">${icon('calendar')}</span><strong>${stats.days}</strong><small>Days of consistency</small></div><div class="mini-stat"><span class="mini-stat-icon">${icon('clock')}</span><strong>${stats.totalHours}</strong><small>Study hours</small></div><div class="mini-stat"><span class="mini-stat-icon">${icon('tag')}</span><strong>${stats.totalTopics}</strong><small>Topics learned</small></div><div class="mini-stat"><span class="mini-stat-icon">${icon('flame')}</span><strong>${stats.streak}</strong><small>Day streak</small></div></div><button class="button button-primary" data-share>${icon('user')} Follow journey</button></section>
    <nav class="panel side-nav" aria-label="Journal sections">${tiles.map(tile => `<a href="${tile.view === 'about' ? '#/about' : tile.view === 'stats' ? '#/stats' : '#/'}" data-nav="${tile.view || 'home'}" ${tile.filter ? `data-filter="${tile.filter}"` : ''} class="${tileOn(tile) ? 'active' : ''}">${icon(tile.icon)} ${tile.label}</a>`).join('')}</nav>
    <section class="panel connect-card"><h3>Let's connect</h3><div class="social-row">${socialLink(profile.twitterUrl, 'X', 'X')}${socialLink(profile.githubUrl, 'GH', 'GitHub')}${socialLink(profile.linkedinUrl, 'in', 'LinkedIn')}${socialLink(profile.youtubeUrl, '▶', 'YouTube')}<button class="social-link" data-share aria-label="Copy journal link">${icon('link')}</button></div></section>
    <section class="panel quote-art"><p>“Progress,<br>not perfection.”</p></section>
  </aside>`;
}
function socialLink(url, text, label) { return url ? `<a class="social-link" href="${attrs(url)}" target="_blank" rel="noopener noreferrer" aria-label="${label}">${text}</a>` : ''; }
function hero() {
  return `<section class="hero" id="top"><img class="hero-scene" src="/art/scene.svg" alt=""><div class="hero-content"><p class="eyebrow">Learning in public</p><h2>Better Learner <span class="gradient-text">Today</span><br>A Brighter <span class="gradient-text">Tomorrow</span></h2><p class="hero-description">${esc(state.data.profile.bio)} Notes, lectures, projects, experiments, and small wins.</p><div class="hero-actions"><button class="button button-primary" data-share>${icon('user')} Follow journey</button><a class="button" href="#/stats" data-nav="stats">${icon('chart')} View stats</a></div></div><blockquote class="hero-whisper">“A small step every day leads to big things.”</blockquote></section>`;
}
function toolbar() {
  const filters = [['all', 'All'], ['lecture', 'Lectures'], ['note', 'Notes'], ['anki', 'Anki'], ['project', 'Projects'], ['article', 'Articles']];
  const more = [['questions', 'Questions'], ['image', 'Images']];
  const moreOn = more.some(([key]) => key === state.filter);
  return `<div class="journal-toolbar"><div class="filters" role="tablist" aria-label="Filter journal entries">${filters.map(([key, label]) => `<button class="filter-button ${state.filter === key ? 'active' : ''}" role="tab" aria-selected="${state.filter === key}" data-filter="${key}">${label}</button>`).join('')}<div class="more-wrap ${moreOn ? 'open' : ''}"><button class="filter-button ${moreOn ? 'active' : ''}" type="button" data-more aria-expanded="${moreOn}" aria-haspopup="true">More</button><div class="more-menu" role="menu">${more.map(([key, label]) => `<button type="button" role="menuitem" data-filter="${key}" class="${state.filter === key ? 'active' : ''}">${label}</button>`).join('')}</div></div></div><div class="toolbar-actions"><button class="icon-button" data-focus-search aria-label="Search journal">${icon('search')}</button>${state.data.authenticated ? `<button class="icon-button" data-add aria-label="Add journal entry">${icon('plus')}</button>` : ''}</div></div>`;
}
function passesQuery(entry) { const query = state.search.toLowerCase().trim(); return !query || [entry.title, entry.description, entry.subject, ...entry.tags].join(' ').toLowerCase().includes(query); }
function filteredEntries() {
  return state.data.entries.filter(entry => {
    if (!passesQuery(entry)) return false;
    if (state.view === 'now') return entryDay(entry.occurredAt) === state.data.stats.today;
    if (state.day && entryDay(entry.occurredAt) !== state.day) return false;
    return state.filter === 'all' || entry.type === state.filter;
  });
}
function timeline() {
  const entries = filteredEntries();
  const banner = state.view === 'home' && state.day ? `<div class="day-banner">Showing ${esc(prettyDate(state.day))}<button type="button" data-clear-day>Show every day</button></div>` : '';
  if (!entries.length) return `${banner}<div class="empty-state">${icon('book')}<h3>${state.view === 'now' ? 'Nothing logged today' : 'No entries found'}</h3><p>${state.view === 'now' ? 'Today’s lectures, notes, and practice will show up here.' : 'Try another filter or search phrase.'}</p></div>`;
  const groups = new Map();
  for (const entry of entries) { const day = entryDay(entry.occurredAt); if (!groups.has(day)) groups.set(day, []); groups.get(day).push(entry); }
  return `${banner}<div class="timeline">${[...groups].map(([day, items]) => dayGroup(day, items)).join('')}</div>`;
}
function dayGroup(day, entries) {
  const label = formatDay(day); const collapsed = isCollapsed(day);
  return `<section class="day-group ${collapsed ? 'collapsed' : ''}" data-day="${day}"><div class="day-dot"></div><header class="day-header"><h3>${esc(label.label)}</h3>${label.date ? `<time datetime="${day}">${esc(label.date)}</time>` : ''}<span class="entry-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span><button class="collapse-day" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${esc(label.label)}">${icon('chevron')}</button></header><div class="day-entries">${entries.map(entryCard).join('')}</div></section>`;
}
function entryCard(entry) {
  const info = typeInfo[entry.type] || typeInfo.note;
  const progress = entry.metrics.progress || percent(entry.metrics);
  const source = [entry.subject, clock(entry.durationMinutes), host(entry.url)].filter(Boolean).join(' · ');
  const external = entry.url ? `<a href="${attrs(entry.url)}" target="_blank" rel="noopener noreferrer" class="entry-link" aria-label="Open ${attrs(entry.title)}">${icon('external')}</a>` : '';
  return `<article class="entry-card" data-id="${entry.id}"><div class="entry-top"><time class="entry-time" datetime="${attrs(entry.occurredAt)}">${esc(time(entry.occurredAt))}</time><div class="entry-type"><span class="type-icon type-${entry.type}">${icon(info.icon)}</span>${info.label}</div><div class="entry-menu">${external}${state.data.authenticated ? `<button aria-label="Entry actions" data-entry-menu>${icon('more')}</button><div class="entry-menu-pop"><button data-edit="${entry.id}">${icon('edit')} Edit</button><button data-delete="${entry.id}">${icon('trash')} Delete</button></div>` : ''}</div></div><div class="entry-body"><div class="entry-copy"><h4>${esc(entry.title)}</h4><div class="entry-source">${esc(source)}</div><p class="entry-description">${esc(entry.description)}</p></div>${entryVisual(entry, progress)}</div><footer class="entry-footer">${entry.tags.map(tag => `<span class="tag">${esc(tag)}</span>`).join('')}</footer></article>`;
}
function percent(metrics) { const total = (metrics.correct || 0) + (metrics.incorrect || 0); return total ? Math.round((metrics.correct || 0) / total * 100) : 0; }
function entryVisual(entry, progress) {
  if (entry.type === 'anki' || entry.type === 'questions') {
    const main = entry.metrics.reviewed || entry.metrics.solved || (entry.metrics.correct || 0) + (entry.metrics.incorrect || 0);
    const noun = entry.type === 'anki' ? 'Cards reviewed' : 'Questions solved';
    return `<div class="metric-card"><div class="metric-head"><strong>${main || 0}</strong><span>${noun}</span></div><div class="metric-detail"><span>${entry.metrics.correct || 0} correct</span><span>${entry.metrics.incorrect || 0} incorrect</span><b>${progress || 0}%</b></div><div class="progress-track"><div class="progress-fill" data-width="${progress || 0}"></div></div></div>`;
  }
  const image = entry.imageUrl || entry.thumbnailUrl || artFor[entry.type];
  if (!image) return '';
  const badge = entry.type === 'lecture' && entry.durationMinutes ? `<span class="duration-badge">${esc(clock(entry.durationMinutes))}</span>` : '';
  return `<a class="entry-media" href="${attrs(entry.url || image)}" ${entry.url ? 'target="_blank" rel="noopener noreferrer"' : ''}><img src="${attrs(image)}" alt="" loading="lazy">${entry.type === 'lecture' ? `<span class="play-badge">${icon('play')}</span>` : ''}${badge}</a>`;
}
function focusSubject() { return state.data.entries.find(entry => entry.type === 'lecture')?.subject || 'Current focus'; }
function goalsBlock() {
  const { goals, authenticated } = state.data;
  const done = goals.filter(goal => goal.completed).length;
  const goalProgress = goals.length ? Math.round(done / goals.length * 100) : 0;
  return `<div class="progress-layout"><div class="goals-list">${goals.map(goal => `<button class="goal-row ${goal.completed ? 'completed' : ''}" data-goal="${goal.id}" ${authenticated ? '' : 'disabled'}><span class="goal-check">${goal.completed ? icon('check') : ''}</span>${esc(goal.title)}</button>`).join('') || '<p class="streak-caption">No goals for today yet.</p>'}</div><div class="goal-ring" data-progress="${goalProgress}"><div><strong>${done}/${goals.length}</strong><small>Goals completed</small></div></div></div>`;
}
function weekStrip() {
  const today = state.data.stats.today;
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const start = new Date(date);
  start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const counts = new Map(state.data.stats.activity.map(item => [item.date, item.count]));
  return `<div class="week-row">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, index) => { const day = new Date(start); day.setDate(start.getDate() + index); const key = localKey(day); return `<div class="week-day ${counts.get(key) ? 'active' : ''}">${label}<i title="${counts.get(key) || 0} activities"></i></div>`; }).join('')}</div>`;
}
function subjectChart(subjects) {
  if (!subjects.length) return '<p class="streak-caption">Subject analytics appear after your first entry.</p>';
  let cursor = 0;
  const segments = subjects.map((subject, index) => { const start = cursor; cursor += subject.percent; return `${subjectColors[index]} ${start}% ${cursor}%`; });
  if (cursor < 100) segments.push(`#242a3d ${cursor}% 100%`);
  return `<div class="subject-wrap"><div class="subject-donut" data-donut="conic-gradient(${segments.join(',')})" aria-label="Subject distribution"></div><div class="subject-legend">${subjects.map((subject, index) => `<div class="legend-row"><i class="legend-dot" data-color="${subjectColors[index]}"></i><span>${esc(subject.name)}</span><b>${subject.percent}%</b></div>`).join('')}</div></div>`;
}
function activityLevel(count) { return Math.max(0, Math.min(3, count)); }
function monthCells() {
  const [y, m] = (state.month || state.data.stats.today.slice(0, 7)).split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const counts = new Map(state.data.stats.activity.map(item => [item.date, item.count]));
  const cells = Array.from({ length: first.getDay() }, () => null);
  const days = new Date(y, m, 0).getDate();
  for (let day = 1; day <= days; day += 1) {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ date, count: counts.get(date) || 0 });
  }
  return cells;
}
function activityCalendar() {
  const label = new Date(`${state.month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `<div class="calendar-block"><div class="activity-head"><button type="button" class="calendar-nav" data-month="-1" aria-label="Previous month">${icon('chevron')}</button><span class="activity-month">${esc(label)}</span><button type="button" class="calendar-nav next" data-month="1" aria-label="Next month">${icon('chevron')}</button></div><div class="weekday-row">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<span>${day}</span>`).join('')}</div><div class="month-grid">${monthCells().map(cell => cell ? `<button type="button" class="month-cell" data-level="${activityLevel(cell.count)}" data-calendar-day="${cell.date}" ${cell.count ? '' : 'disabled'} title="${cell.date}: ${cell.count} activities"></button>` : '<span class="month-pad"></span>').join('')}</div></div>`;
}
function rightSidebar() {
  const { profile, stats } = state.data;
  return `<aside class="right-sidebar"><section class="panel right-card"><h3 class="card-title">${icon('chart')} Currently learning</h3><div class="current-topic"><span class="topic-icon">${icon('book')}</span><div class="topic-info"><strong>${esc(profile.currentlyLearning)}</strong><small>${esc(focusSubject())}</small><div class="progress-track"><div class="progress-fill" data-width="${profile.currentProgress}"></div></div><div class="progress-labels"><span>Current focus</span><b>${profile.currentProgress}%</b></div></div></div></section><section class="panel right-card progress-card"><h3 class="card-title">${icon('clock')} Today's progress</h3>${goalsBlock()}</section><section class="panel right-card streak-card"><h3 class="card-title">${icon('flame')} Study streak</h3><div class="streak-flame" aria-label="${stats.streak} day streak">${icon('flame')}</div>${weekStrip()}<p class="streak-caption">Keep going! Consistency wins.</p></section><section class="panel right-card"><h3 class="card-title">${icon('note')} Subjects</h3>${subjectChart(stats.subjects)}</section><section class="panel right-card"><h3 class="card-title">${icon('calendar')} Activity calendar</h3>${activityCalendar()}</section><section class="panel right-card right-quote"><p>The expert in anything was once a beginner.</p><small>— Helen Hayes</small></section></aside>`;
}
function aboutView() {
  const profile = state.data.profile;
  const education = (profile.education || []).map(item => `<article><h3>${esc(item.school)}</h3><p>${esc(item.detail)}</p><small>${esc(item.years)}</small></article>`).join('');
  const experience = (profile.experience || []).map(item => `<article><h3>${esc(item.role)}</h3><p>${esc(item.org)} · ${esc(item.dates)}</p><p>${esc(item.summary)}</p></article>`).join('');
  const skills = (profile.skills || []).map(skill => `<span class="tag">${esc(skill)}</span>`).join('');
  return `<section class="about-page"><header class="view-head"><p class="eyebrow">About</p><div class="about-hero"><div class="avatar-ring"><div class="avatar">${profileAvatar(profile)}</div></div><div><h2>${esc(profile.name)}</h2><p>@${esc(profile.handle)} · ${esc(profile.role)}</p><p>${esc(profile.location)} · Currently learning ${esc(profile.currentlyLearning)}</p></div></div>${state.data.authenticated ? `<button class="button button-primary" data-profile>${icon('edit')} Edit about</button>` : ''}</header><div class="panel about-copy"><p>${esc(profile.about || profile.bio)}</p></div>${education ? `<section class="panel about-block"><h3>Education</h3><div class="about-list">${education}</div></section>` : ''}${experience ? `<section class="panel about-block"><h3>Experience</h3><div class="about-list">${experience}</div></section>` : ''}${skills ? `<section class="panel about-block"><h3>Skills</h3><div class="skill-row">${skills}</div></section>` : ''}${profile.resumeUrl ? `<a class="button button-primary" href="${attrs(profile.resumeUrl)}" download>Download resume</a>` : ''}</section>`;
}
function statsView() {
  const stats = state.data.stats;
  const cards = [['calendar', stats.days, 'Days of consistency'], ['clock', stats.totalHours, 'Study hours'], ['tag', stats.totalTopics, 'Topics learned'], ['flame', stats.streak, 'Day streak']];
  return `<section class="stats-page"><header class="view-head"><p class="eyebrow">Stats</p><h2>Learning record</h2><p>Consistency, study time, subjects, and the days you showed up.</p></header><div class="stat-grid">${cards.map(([name, value, label]) => `<article class="panel stat-card"><span class="mini-stat-icon">${icon(name)}</span><strong>${esc(value)}</strong><small>${label}</small></article>`).join('')}</div><div class="stats-layout"><section class="panel right-card"><h3 class="card-title">${icon('note')} Subjects</h3>${subjectChart(stats.subjects)}</section><section class="panel right-card"><h3 class="card-title">${icon('calendar')} Activity calendar</h3>${activityCalendar()}<p class="streak-caption">Choose a day with entries to open it in the journal.</p></section></div></section>`;
}
function nowView() {
  const profile = state.data.profile;
  return `<section class="now-page"><header class="view-head"><p class="eyebrow">Now</p><h2>Today, ${esc(prettyDate(state.data.stats.today))}</h2><p>What is in progress right now.</p></header><section class="panel now-focus"><span class="topic-icon">${icon('book')}</span><div><strong>${esc(profile.currentlyLearning)}</strong><small>${esc(focusSubject())}</small><div class="progress-track"><div class="progress-fill" data-width="${profile.currentProgress}"></div></div></div><b>${profile.currentProgress}%</b></section><section class="panel right-card"><h3 class="card-title">${icon('clock')} Today's goals</h3>${goalsBlock()}</section><h3 class="now-label">Logged today</h3>${timeline()}</section>`;
}
function mainColumn() {
  if (state.view === 'about') return aboutView();
  if (state.view === 'stats') return statsView();
  if (state.view === 'now') return nowView();
  return `${hero()}${toolbar()}${timeline()}`;
}
function adminDock() {
  if (!state.data.authenticated) return `<footer class="site-footer"><button class="button" data-login>${icon('lock')} Owner sign in</button></footer>`;
  return `<footer class="site-footer"><button class="button button-primary" data-add>${icon('plus')} Add entry</button><button class="icon-button" data-profile aria-label="Edit about">${icon('settings')}</button><button class="icon-button" data-logout aria-label="Sign out">${icon('logout')}</button></footer>`;
}
function mobileNav() {
  const items = [['home', 'Home', 'home', ''], ['home', 'Journal', 'book', 'all'], ['now', 'Now', 'flame', ''], ['stats', 'Stats', 'chart', ''], ['about', 'About', 'info', '']];
  return `<nav class="mobile-nav" aria-label="Mobile navigation">${items.map(([view, label, name, filter]) => `<a href="${view === 'home' ? '#/' : `#/${view}`}" data-nav="${view}" ${filter ? `data-filter="${filter}"` : ''} class="${(filter ? state.view === 'home' && state.filter === 'all' : state.view === view) ? 'active' : ''}">${icon(name)}<span>${label}</span></a>`).join('')}</nav>`;
}
function render() {
  const y = state.keepScroll ? window.scrollY : 0;
  const rail = state.view === 'home' || state.view === 'now';
  $('#app').classList.toggle('no-rail', !rail);
  $('#app').innerHTML = `${leftSidebar()}<main class="main-column" id="journal">${mainColumn()}</main>${rail ? rightSidebar() : ''}${adminDock()}${mobileNav()}`;
  $('#brand-name').textContent = `${state.data.profile.name}'s Learning Journal`;
  document.title = `${state.data.profile.name}'s Learning Journal`;
  $$('.topnav a').forEach(link => { const on = link.dataset.nav === state.view; link.classList.toggle('active', on); if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  bind();
  paintDynamic();
  if (y) window.scrollTo(0, y);
  state.keepScroll = true;
}
function paintDynamic() {
  $$('[data-width]').forEach(node => { node.style.width = `${node.dataset.width}%`; });
  $$('[data-progress]').forEach(node => { node.style.setProperty('--p', node.dataset.progress); });
  $$('[data-donut]').forEach(node => { node.style.background = node.dataset.donut; });
  $$('[data-color]').forEach(node => { node.style.background = node.dataset.color; });
}
function bind() {
  $$('[data-filter]').forEach(button => button.addEventListener('click', () => { state.day = ''; state.filter = button.dataset.filter; state.view = 'home'; state.keepScroll = true; const next = '#/'; if (location.hash !== next) history.pushState(null, '', next); render(); }));
  $$('.collapse-day').forEach(button => button.addEventListener('click', () => { const day = button.closest('.day-group').dataset.day; if (isCollapsed(day)) { state.collapsed.delete(day); state.opened.add(day); } else { state.opened.delete(day); state.collapsed.add(day); } state.keepScroll = true; render(); }));
  $$('[data-entry-menu]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); button.parentElement.classList.toggle('open'); }));
  $$('[data-more]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); button.parentElement.classList.toggle('open'); button.setAttribute('aria-expanded', button.parentElement.classList.contains('open')); }));
  $$('[data-share]').forEach(button => button.addEventListener('click', share));
  $$('[data-add]').forEach(button => button.addEventListener('click', () => openEntryModal()));
  $$('[data-login]').forEach(button => button.addEventListener('click', openLogin));
  $$('[data-logout]').forEach(button => button.addEventListener('click', logout));
  $$('[data-profile]').forEach(button => button.addEventListener('click', openProfile));
  $$('[data-edit]').forEach(button => button.addEventListener('click', () => openEntryModal(state.data.entries.find(entry => entry.id === Number(button.dataset.edit)))));
  $$('[data-delete]').forEach(button => button.addEventListener('click', () => confirmDelete(Number(button.dataset.delete))));
  $$('[data-goal]').forEach(button => button.addEventListener('click', () => toggleGoal(Number(button.dataset.goal))));
  $$('[data-focus-search]').forEach(button => button.addEventListener('click', () => { $('#global-search').closest('.search-box').classList.add('open'); $('#global-search').focus(); }));
  $$('[data-month]').forEach(button => button.addEventListener('click', () => shiftMonth(Number(button.dataset.month))));
  $$('[data-calendar-day]').forEach(button => button.addEventListener('click', () => { if (button.disabled) return; state.day = button.dataset.calendarDay; state.filter = 'all'; go('home'); }));
  $$('[data-clear-day]').forEach(button => button.addEventListener('click', () => { state.day = ''; state.keepScroll = true; render(); }));
}
function shiftMonth(delta) {
  const [y, m] = state.month.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  state.month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  state.keepScroll = true;
  render();
}
async function share() {
  const url = location.origin;
  try { if (navigator.share) await navigator.share({ title: document.title, text: 'Follow my learning journey.', url }); else { await navigator.clipboard.writeText(url); toast('Journal link copied to your clipboard.'); } }
  catch (error) { if (error.name !== 'AbortError') toast('Could not share the journal.', 'error'); }
}
function modal(content, className = '') {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal ${className}" role="dialog" aria-modal="true">${content}</section></div>`;
  const backdrop = $('.modal-backdrop', root);
  backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) closeModal(); });
  $$('[data-close]', root).forEach(button => button.addEventListener('click', closeModal));
  document.addEventListener('keydown', escapeModal);
  setTimeout(() => $('.modal input, .modal select, .modal textarea', root)?.focus(), 20);
}
function escapeModal(event) { if (event.key === 'Escape') closeModal(); }
function closeModal() { document.removeEventListener('keydown', escapeModal); $('#modal-root').innerHTML = ''; }
function errorBox(form, message) { const box = $('.form-error', form); box.textContent = message; box.classList.add('show'); }
function openLogin() {
  modal(`<header class="modal-header"><div><h2>Owner sign in</h2><p>Manage entries, uploads and progress securely.</p></div><button class="close-button" data-close aria-label="Close">${icon('x')}</button></header><form id="login-form"><div class="form-grid"><div class="field full"><label for="login-email">Email</label><input id="login-email" name="email" type="email" autocomplete="username" required></div><div class="field full"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" minlength="8" required></div><div class="form-error full"></div></div><div class="modal-actions"><button type="button" class="button" data-close>Cancel</button><button class="button button-primary" type="submit">${icon('lock')} Sign in</button></div></form>`, 'small');
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = $('[type=submit]', form); button.disabled = true;
    try { const values = Object.fromEntries(new FormData(form)); await request('/api/auth/login', { method: 'POST', body: JSON.stringify(values) }); closeModal(); await load(); toast('Signed in. Owner controls are ready.'); }
    catch (error) { errorBox(form, error.message); } finally { button.disabled = false; }
  });
}
async function logout() { try { await request('/api/auth/logout', { method: 'POST', body: '{}' }); await load(); toast('Signed out safely.'); } catch (error) { toast(error.message, 'error'); } }
function openEntryModal(entry = null) {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modal(`<header class="modal-header"><div><h2>${entry ? 'Edit' : 'Add'} learning entry</h2><p>Capture the resource, your reflection, and measurable progress.</p></div><button class="close-button" data-close aria-label="Close">${icon('x')}</button></header><form id="entry-form"><div class="form-grid"><div class="field"><label for="entry-type">Activity type</label><select id="entry-type" name="type">${Object.entries(typeInfo).map(([key, value]) => `<option value="${key}" ${entry?.type === key ? 'selected' : ''}>${value.label}</option>`).join('')}</select></div><div class="field"><label for="entry-date">Date and time</label><input id="entry-date" name="occurredAt" type="datetime-local" max="${now}" value="${entry ? new Date(new Date(entry.occurredAt) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : now}" required></div><div class="field full"><label for="entry-url">Resource link</label><div class="url-composer"><input id="entry-url" name="url" type="url" placeholder="YouTube or article URL" value="${attrs(entry?.url || '')}"><button type="button" class="button" id="fetch-preview">${icon('link')} Fetch preview</button></div><div id="link-preview"></div></div><div class="field full"><label for="entry-title">Title</label><input id="entry-title" name="title" maxlength="160" value="${attrs(entry?.title || '')}" required></div><div class="field full"><label for="entry-description">What did you learn?</label><textarea id="entry-description" name="description" maxlength="5000">${esc(entry?.description || '')}</textarea></div><div class="field"><label for="entry-subject">Subject</label><input id="entry-subject" name="subject" maxlength="60" value="${attrs(entry?.subject || '')}"></div><div class="field"><label for="entry-duration">Duration (minutes)</label><input id="entry-duration" name="durationMinutes" type="number" min="0" max="1440" value="${entry?.durationMinutes || 0}"></div><div class="field full"><label for="entry-tags">Tags</label><input id="entry-tags" name="tags" value="${attrs(entry?.tags.join(', ') || '')}"></div><div class="field full"><label>Image or screenshot</label><label class="upload-zone" id="upload-zone"><input id="entry-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif">${entry?.imageUrl ? `<img src="${attrs(entry.imageUrl)}" alt="Current upload">` : icon('upload')}<span>${entry?.imageUrl ? 'Replace image' : 'Choose a PNG, JPEG, WebP or GIF'}</span></label><input id="image-url" type="hidden" value="${attrs(entry?.imageUrl || '')}"><input id="thumbnail-url" type="hidden" value="${attrs(entry?.thumbnailUrl || '')}"></div><div class="field full"><label>Session metrics</label><div class="metrics-fields"><input name="reviewed" aria-label="Cards reviewed" type="number" min="0" placeholder="Reviewed" value="${entry?.metrics.reviewed || ''}"><input name="correct" aria-label="Correct answers" type="number" min="0" placeholder="Correct" value="${entry?.metrics.correct || ''}"><input name="incorrect" aria-label="Incorrect answers" type="number" min="0" placeholder="Incorrect" value="${entry?.metrics.incorrect || ''}"><input name="progress" aria-label="Progress percent" type="number" min="0" max="100" placeholder="Progress %" value="${entry?.metrics.progress || ''}"></div></div><label class="goal-row"><input name="published" type="checkbox" ${entry?.published === false ? '' : 'checked'}> Publish on the public journal</label><div class="form-error full"></div></div><div class="modal-actions"><button type="button" class="button" data-close>Cancel</button><button class="button button-primary" type="submit">${icon('check')} ${entry ? 'Save changes' : 'Publish entry'}</button></div></form>`);
  const form = $('#entry-form');
  $('#fetch-preview').addEventListener('click', () => previewUrl(form));
  $('#entry-image').addEventListener('change', event => uploadImage(event, form));
  form.addEventListener('submit', event => submitEntry(event, entry));
}
async function previewUrl(form) {
  const url = $('#entry-url', form).value; const button = $('#fetch-preview', form);
  if (!url) return errorBox(form, 'Paste a YouTube or article URL first.');
  button.disabled = true; button.textContent = 'Fetching…';
  try {
    const { preview } = await request('/api/meta/preview', { method: 'POST', body: JSON.stringify({ url }) });
    $('#entry-title', form).value = $('#entry-title', form).value || preview.title;
    $('#entry-description', form).value = $('#entry-description', form).value || preview.description;
    $('#thumbnail-url', form).value = preview.thumbnailUrl || '';
    $('#entry-type', form).value = preview.kind;
    $('#link-preview', form).innerHTML = `<div class="preview-card">${preview.thumbnailUrl ? `<img src="${attrs(preview.thumbnailUrl)}" alt="">` : ''}<div><strong>${esc(preview.title)}</strong><small>${esc(preview.source || 'Preview ready')}</small></div></div>`;
    toast('Preview details added.');
  } catch (error) { errorBox(form, error.message); }
  finally { button.disabled = false; button.innerHTML = `${icon('link')} Fetch preview`; }
}
async function uploadImage(event, form) {
  const file = event.target.files[0]; if (!file) return;
  const zone = $('#upload-zone', form); const old = zone.innerHTML; zone.textContent = 'Uploading and validating image…';
  try {
    const data = new FormData(); data.append('image', file); const result = await request('/api/uploads', { method: 'POST', body: data });
    $('#image-url', form).value = result.url;
    zone.innerHTML = `<input id="entry-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><img src="${attrs(result.url)}" alt="Uploaded preview"><span>Replace image</span>`;
    $('#entry-image', zone).addEventListener('change', next => uploadImage(next, form));
    toast('Image uploaded.');
  } catch (error) { zone.innerHTML = old; $('#entry-image', zone)?.addEventListener('change', next => uploadImage(next, form)); errorBox(form, error.message); }
}
async function submitEntry(event, entry) {
  event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
  const payload = { type: values.type, title: values.title, description: values.description, occurredAt: new Date(values.occurredAt).toISOString(), url: values.url || null, thumbnailUrl: $('#thumbnail-url', form).value || null, imageUrl: $('#image-url', form).value || null, subject: values.subject || 'General', durationMinutes: Number(values.durationMinutes || 0), tags: String(values.tags || '').split(',').map(tag => tag.trim()).filter(Boolean), metrics: { reviewed: Number(values.reviewed || 0), correct: Number(values.correct || 0), incorrect: Number(values.incorrect || 0), solved: Number(values.correct || 0) + Number(values.incorrect || 0), progress: Number(values.progress || 0) }, published: values.published === 'on' };
  const button = $('[type=submit]', form); button.disabled = true;
  try { await request(entry ? `/api/entries/${entry.id}` : '/api/entries', { method: entry ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); closeModal(); await load(); toast(entry ? 'Entry updated.' : 'Entry published to your journal.'); }
  catch (error) { errorBox(form, error.message); } finally { button.disabled = false; }
}
async function confirmDelete(id) {
  const entry = state.data.entries.find(item => item.id === id);
  modal(`<header class="modal-header"><div><h2>Delete entry?</h2><p>This permanently removes “${esc(entry?.title || 'this entry')}”.</p></div><button class="close-button" data-close>${icon('x')}</button></header><div class="modal-actions"><button class="button" data-close>Cancel</button><button class="button button-danger" id="confirm-delete">${icon('trash')} Delete permanently</button></div>`, 'small');
  $('#confirm-delete').addEventListener('click', async () => { try { await request(`/api/entries/${id}`, { method: 'DELETE' }); closeModal(); await load(); toast('Entry deleted.'); } catch (error) { toast(error.message, 'error'); } });
}
function repeatRow(kind, item = {}) {
  if (kind === 'education') return `<div class="repeat-row" data-repeat="education"><input data-key="school" placeholder="School" value="${attrs(item.school || '')}"><input data-key="detail" placeholder="Focus" value="${attrs(item.detail || '')}"><input data-key="years" placeholder="Years" value="${attrs(item.years || '')}"><button type="button" data-remove-row aria-label="Remove education">${icon('x')}</button></div>`;
  return `<div class="repeat-row" data-repeat="experience"><input data-key="role" placeholder="Role" value="${attrs(item.role || '')}"><input data-key="org" placeholder="Organization" value="${attrs(item.org || '')}"><input data-key="dates" placeholder="Dates" value="${attrs(item.dates || '')}"><textarea data-key="summary" placeholder="What you did">${esc(item.summary || '')}</textarea><button type="button" data-remove-row aria-label="Remove experience">${icon('x')}</button></div>`;
}
function openProfile() {
  const profile = state.data.profile;
  const education = (profile.education?.length ? profile.education : [{}]).map(item => repeatRow('education', item)).join('');
  const experience = (profile.experience?.length ? profile.experience : [{}]).map(item => repeatRow('experience', item)).join('');
  modal(`<header class="modal-header"><div><h2>Edit about</h2><p>Update your story, study focus, and resume.</p></div><button class="close-button" data-close aria-label="Close">${icon('x')}</button></header><form id="profile-form"><div class="form-grid"><div class="field"><label>Name</label><input name="name" value="${attrs(profile.name)}" required></div><div class="field"><label>Handle</label><input name="handle" value="${attrs(profile.handle)}" required></div><div class="field full"><label>Short bio</label><textarea name="bio">${esc(profile.bio)}</textarea></div><div class="field full"><label>About</label><textarea name="about">${esc(profile.about || '')}</textarea></div><div class="field"><label>Location</label><input name="location" value="${attrs(profile.location)}"></div><div class="field"><label>Role</label><input name="role" value="${attrs(profile.role)}"></div><div class="field full"><label>Profile quote</label><input name="quote" value="${attrs(profile.quote)}"></div><div class="field"><label>Currently learning</label><input name="currentlyLearning" value="${attrs(profile.currentlyLearning)}"></div><div class="field"><label>Progress %</label><input name="currentProgress" type="number" min="0" max="100" value="${profile.currentProgress}"></div><div class="field"><label>GitHub URL</label><input name="githubUrl" type="url" value="${attrs(profile.githubUrl || '')}"></div><div class="field"><label>LinkedIn URL</label><input name="linkedinUrl" type="url" value="${attrs(profile.linkedinUrl || '')}"></div><div class="field"><label>YouTube URL</label><input name="youtubeUrl" type="url" value="${attrs(profile.youtubeUrl || '')}"></div><div class="field"><label>X URL</label><input name="twitterUrl" type="url" value="${attrs(profile.twitterUrl || '')}"></div><div class="field full"><label>Portrait</label><label class="upload-zone" id="avatar-zone"><input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif">${profile.avatarUrl ? `<img src="${attrs(profile.avatarUrl)}" alt="">` : icon('upload')}<span>${profile.avatarUrl ? 'Replace portrait' : 'Upload a portrait'}</span></label><input id="avatar-url" type="hidden" value="${attrs(profile.avatarUrl || '')}"></div><div class="field full"><label>Resume PDF</label><label class="upload-zone"><input id="resume-file" type="file" accept="application/pdf,.pdf">${icon('upload')}<span id="resume-label">${profile.resumeUrl ? 'Replace resume' : 'Upload a PDF resume'}</span></label><input id="resume-url" type="hidden" value="${attrs(profile.resumeUrl || '')}"></div><div class="field full"><label>Education</label><div id="education-rows">${education}</div><button type="button" class="button" data-add-row="education">Add education</button></div><div class="field full"><label>Experience</label><div id="experience-rows">${experience}</div><button type="button" class="button" data-add-row="experience">Add experience</button></div><div class="field full"><label>Skills</label><input name="skills" value="${attrs((profile.skills || []).join(', '))}"><div class="field-hint">Comma-separated, up to 16.</div></div><div class="form-error full"></div></div><div class="modal-actions"><button type="button" class="button" data-close>Cancel</button><button class="button button-primary" type="submit">Save about</button></div></form>`, 'large');
  const form = $('#profile-form');
  form.addEventListener('click', event => {
    const add = event.target.closest('[data-add-row]');
    if (add) { $(`#${add.dataset.addRow}-rows`).insertAdjacentHTML('beforeend', repeatRow(add.dataset.addRow)); return; }
    const remove = event.target.closest('[data-remove-row]');
    if (remove) remove.closest('.repeat-row')?.remove();
  });
  $('#avatar-file').addEventListener('change', event => uploadProfileFile(event, 'avatar'));
  $('#resume-file').addEventListener('change', event => uploadProfileFile(event, 'resume'));
  form.addEventListener('submit', submitProfile);
}
async function uploadProfileFile(event, kind) {
  const file = event.target.files[0]; if (!file) return;
  const form = $('#profile-form');
  try {
    const data = new FormData(); data.append('image', file); const result = await request('/api/uploads', { method: 'POST', body: data });
    if (kind === 'avatar') { $('#avatar-url').value = result.url; $('#avatar-zone').querySelector('span').textContent = 'Replace portrait'; toast('Portrait uploaded.'); }
    else { $('#resume-url').value = result.url; $('#resume-label').textContent = 'Resume ready to save'; toast('Resume uploaded.'); }
  } catch (error) { errorBox(form, error.message); }
}
function collectRepeat(form, kind) { return [...form.querySelectorAll(`[data-repeat="${kind}"]`)].map(row => { const item = {}; row.querySelectorAll('[data-key]').forEach(input => { item[input.dataset.key] = input.value; }); return item; }); }
async function submitProfile(event) {
  event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
  const payload = { ...values, currentProgress: Number(values.currentProgress || 0), avatarUrl: $('#avatar-url').value || null, resumeUrl: $('#resume-url').value || null, skills: String(values.skills || '').split(',').map(skill => skill.trim()).filter(Boolean), education: collectRepeat(form, 'education'), experience: collectRepeat(form, 'experience') };
  const button = $('[type=submit]', form); button.disabled = true;
  try { await request('/api/profile', { method: 'PATCH', body: JSON.stringify(payload) }); closeModal(); await load(); toast('About page updated.'); }
  catch (error) { errorBox(form, error.message); } finally { button.disabled = false; }
}
async function toggleGoal(id) { try { await request(`/api/goals/${id}/toggle`, { method: 'POST', body: '{}' }); state.keepScroll = true; await load(); } catch (error) { toast(error.message, 'error'); } }
async function load() {
  try {
    state.data = await request('/api/bootstrap');
    if (!state.month) state.month = state.data.stats.today.slice(0, 7);
    state.view = viewFromHash();
    render();
  } catch (error) { $('#app').innerHTML = `<div class="loading-screen"><h2>Could not open the journal</h2><p>${esc(error.message)}</p><button class="button" onclick="location.reload()">Try again</button></div>`; }
}
state.view = viewFromHash();
$('#global-search').addEventListener('input', event => { state.search = event.target.value; state.keepScroll = true; render(); });
$('#theme-button').addEventListener('click', () => { document.documentElement.classList.toggle('contrast'); localStorage.setItem('lj-contrast', document.documentElement.classList.contains('contrast') ? '1' : '0'); });
if (localStorage.getItem('lj-contrast') === '1') document.documentElement.classList.add('contrast');
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#global-search').closest('.search-box').classList.add('open'); $('#global-search').focus(); } });
document.addEventListener('click', event => {
  const nav = event.target.closest('[data-nav]');
  if (nav && !event.target.closest('.modal')) {
    event.preventDefault();
    if (nav.dataset.filter) { state.day = ''; go('home', nav.dataset.filter); }
    else if (nav.dataset.nav === 'home') { state.day = ''; go('home', 'all'); }
    else go(nav.dataset.nav);
  }
  if (!event.target.closest('.entry-menu')) $$('.entry-menu.open').forEach(menu => menu.classList.remove('open'));
  if (!event.target.closest('.more-wrap')) $$('.more-wrap.open').forEach(menu => menu.classList.remove('open'));
});
window.addEventListener('hashchange', () => { const next = viewFromHash(); if (!state.data || next === state.view) return; state.view = next; state.keepScroll = false; render(); });
load();
