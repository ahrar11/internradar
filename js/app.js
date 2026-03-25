/* =============================================
   app.js — Shared utilities & dashboard logic
   ============================================= */

// ---- Helpers ----
const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const el  = (id) => document.getElementById(id);
const fmt  = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '';

function generateId() {
  return Math.random().toString(36).slice(2,10) + Date.now().toString(36);
}

// ---- Ticker animation ----
function startTicker(elId, messages) {
  let i = 0;
  const t = el(elId);
  if (!t) return;
  t.textContent = messages[0];
  return setInterval(() => {
    i = (i+1) % messages.length;
    t.textContent = messages[i];
  }, 2000);
}

// ---- Anthropic API call ----
async function callClaude({ prompt, systemPrompt = '', useSearch = true, maxTokens = 4000 }) {
  const apiKey = Store.getApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (systemPrompt) body.system = systemPrompt;
  if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

function extractJSON(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found in response');
  return JSON.parse(match[0]);
}

// ---- Match pill HTML ----
function matchPill(score) {
  const map = { high: 'match-high', medium: 'match-medium', new: 'match-new' };
  const labels = { high: 'Strong match', medium: 'Good match', new: 'New this week' };
  const cls = map[score] || 'match-medium';
  return `<span class="match-pill ${cls}">${labels[score] || score}</span>`;
}

// ---- Job card HTML ----
function renderJobCard(job, opts = {}) {
  const isSaved = (Store.getApplications().find(a => a.id === job.id)?.status === 'saved');
  const isApplied = (Store.getApplications().find(a => a.id === job.id)?.status === 'applied');
  const hasResume = !!Store.getResume();

  return `
  <div class="job-card" id="jcard-${esc(job.id)}">
    <div class="job-card-top">
      <div>
        <div class="job-co">${esc(job.company)}</div>
        <div class="job-title-text">${esc(job.title)}</div>
      </div>
      ${matchPill(job.match_score)}
    </div>
    <div class="job-meta-row">
      <span class="meta-chip">📍 ${esc(job.location||'TBD')}</span>
      ${job.visa_friendly ? '<span class="meta-chip visa-ok">✓ F1/CPT/OPT</span>' : ''}
      ${job.posted ? `<span class="meta-chip">📅 ${esc(job.posted)}</span>` : ''}
      ${job.deadline ? `<span class="meta-chip">⏰ ${esc(job.deadline)}</span>` : ''}
    </div>
    <p class="job-summary">${esc(job.summary||'')}</p>
    ${job.skills?.length ? `<div class="job-skills-row">${job.skills.map(s=>`<span class="skill-tag">${esc(s)}</span>`).join('')}</div>` : ''}
    <div class="job-card-footer">
      <span class="job-source-label">${esc(job.source||'')}</span>
      <div class="job-actions">
        ${hasResume ? `<button class="btn-tailor" onclick="openTailorModal(${JSON.stringify(job).replace(/"/g,'&quot;')})">✦ Tailor Resume</button>` : ''}
        <button class="btn-save ${isSaved?'saved':''}" onclick="toggleSave(${JSON.stringify(job).replace(/"/g,'&quot;')}, this)">
          ${isSaved ? '★ Saved' : '☆ Save'}
        </button>
        ${job.url ? `<a class="btn-apply" href="${esc(job.url)}" target="_blank" onclick="markApplied(${JSON.stringify(job).replace(/"/g,'&quot;')})">Apply →</a>` : ''}
      </div>
    </div>
  </div>`;
}

function toggleSave(job, btn) {
  const apps = Store.getApplications();
  const existing = apps.find(a => a.id === job.id);
  if (existing && existing.status === 'saved') {
    Store.removeApplication(job.id);
    btn.textContent = '☆ Save';
    btn.classList.remove('saved');
  } else {
    Store.saveApplication(job, 'saved');
    btn.textContent = '★ Saved';
    btn.classList.add('saved');
  }
  refreshDashboardStats();
}

function markApplied(job) {
  Store.saveApplication(job, 'applied');
  refreshDashboardStats();
}

// ---- Tailor Resume Modal ----
function openTailorModal(job) {
  const resume = Store.getResume();
  if (!resume) { alert('Please upload your resume first in the Resume Tailor page.'); return; }

  let modal = el('tailor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'tailor-modal';
    modal.innerHTML = `
      <div class="modal">
        <button class="modal-close" onclick="document.getElementById('tailor-modal').classList.remove('show')">✕</button>
        <div class="modal-title">✦ Tailored Resume</div>
        <div class="modal-sub" id="tailor-modal-sub"></div>
        <div id="tailor-loading" class="loading-wrap show">
          <div class="spinner"></div>
          <div class="loading-msg">Tailoring your resume to this role...</div>
          <div class="loading-ticker" id="tailor-ticker"></div>
        </div>
        <div id="tailor-output" style="display:none">
          <pre class="tailored-resume-output" id="tailor-text"></pre>
          <div class="modal-footer">
            <button class="btn-ghost" onclick="copyTailored()">Copy to clipboard</button>
            <button class="btn-primary" onclick="document.getElementById('tailor-modal').classList.remove('show')">Done</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  el('tailor-modal-sub').textContent = `${job.title} at ${job.company}`;
  el('tailor-loading').classList.add('show');
  el('tailor-output').style.display = 'none';
  modal.classList.add('show');

  const ticker = startTicker('tailor-ticker', ['Analyzing job description...', 'Extracting relevant skills...', 'Rewriting bullet points...', 'Optimizing for ATS...', 'Finalizing...']);

  const prompt = `You are an expert resume consultant for a graduate student.

STUDENT RESUME:
${resume.text}

TARGET JOB:
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}
Description: ${job.summary}
Required Skills: ${(job.skills||[]).join(', ')}

Task: Rewrite and tailor the student's resume specifically for this role. 
- Keep it to 1 page (no page break markers needed)
- Lead with a tailored professional summary (2-3 lines)
- Reorder and rephrase bullet points to highlight the most relevant experience
- Bold or call out skills that match the job requirements
- Use action verbs and quantify achievements where possible
- Include all relevant coursework, projects, or skills from the resume that match
- Do NOT invent experience — only rephrase what exists
- Output clean plain text formatted as a resume (name, contact, sections)
- Mark sections clearly: SUMMARY, EDUCATION, EXPERIENCE, SKILLS, PROJECTS`;

  callClaude({ prompt, useSearch: false, maxTokens: 2000 })
    .then(text => {
      clearInterval(ticker);
      el('tailor-loading').classList.remove('show');
      el('tailor-text').textContent = text;
      el('tailor-output').style.display = 'block';
    })
    .catch(err => {
      clearInterval(ticker);
      modal.classList.remove('show');
      alert('Resume tailoring failed: ' + err.message);
    });
}

function copyTailored() {
  const text = el('tailor-text')?.textContent || '';
  navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard!'));
}

// ---- Dashboard stats ----
function refreshDashboardStats() {
  const stats = Store.getStats();
  if (el('stat-applied'))  el('stat-applied').textContent  = stats.applied;
  if (el('stat-pending'))  el('stat-pending').textContent  = stats.pending;
  if (el('stat-saved'))    el('stat-saved').textContent    = stats.saved;
}

// ---- Learning insight bars ----
function renderLearningInsights() {
  const prefs = Store.getTopPreferences();
  const container = el('learning-content');
  if (!container) return;

  if (prefs.total === 0) {
    container.innerHTML = `<div class="insight-placeholder"><div class="insight-note" style="padding:14px 18px">Apply and save roles to train the AI on your preferences. It learns from every action.</div></div>`;
    return;
  }

  const maxScore = Math.max(...prefs.roles.map(r => r.score), 1);
  const bars = prefs.roles.slice(0,4).map(r => {
    const pct = Math.round((r.score / maxScore) * 100);
    return `<div class="insight-bar" style="width:100%">
      <span>${esc(r.label)}</span><span>${pct}%</span>
      <div class="insight-bar-track"></div>
      <div class="insight-bar-fill" style="width:${pct}%"></div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="insight-placeholder">${bars}<div class="insight-note">Based on ${prefs.total} interaction${prefs.total!==1?'s':''}.</div></div>`;
}

// ---- Dashboard init ----
function initDashboard() {
  // Greeting
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  if (el('greeting-text')) el('greeting-text').textContent = `${greet} — here's your internship pulse.`;

  refreshDashboardStats();
  renderLearningInsights();

  // Recent jobs
  const jobs = Store.getJobs().slice(0, 4);
  const recentEl = el('recent-jobs');
  if (recentEl && jobs.length) {
    const ls = Store.getLastSearch();
    if (el('stat-matches')) el('stat-matches').textContent = jobs.length;
    recentEl.innerHTML = `
      ${ls ? `<div style="font-size:11px;font-family:var(--font-mono);color:var(--text3);padding:10px 18px 0">Last search: ${fmt(ls)}</div>` : ''}
      <div style="padding:14px;display:flex;flex-direction:column;gap:10px">
        ${jobs.map(j => renderJobCard(j)).join('')}
      </div>`;
  }

  // Resume status
  const resume = Store.getResume();
  const resumeWidget = el('resume-status-widget');
  if (resumeWidget && resume) {
    resumeWidget.innerHTML = `
      <div class="resume-uploaded-card" style="margin:14px">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none"><rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <div>
          <div class="resume-file-name">${esc(resume.name)}</div>
          <div class="resume-file-size">Uploaded ${fmt(resume.uploadedAt)} · ${resume.wordCount||0} words</div>
        </div>
      </div>`;
  }

  // Filter summary
  const prefs = Store.getPrefs();
  if (el('ftag-roles')) el('ftag-roles').textContent = prefs.roles.length ? prefs.roles[0] + (prefs.roles.length > 1 ? ` +${prefs.roles.length-1}` : '') : 'All Roles';
  if (el('ftag-loc')) el('ftag-loc').textContent = prefs.location === 'any' ? 'Any Location' : prefs.location;

  // Active nav
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === 'index.html' || a.getAttribute('href') === './index.html');
  });
}

// ---- API Key guard (show banner on pages that need it) ----
function checkApiKey(containerId) {
  if (Store.getApiKey()) return true;
  const c = el(containerId);
  if (c) c.innerHTML = `
    <div class="api-setup-banner">
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4M10 14h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      <div>
        <strong>API key required.</strong> Go to <a href="../pages/settings.html" style="color:var(--amber)">Settings</a> to add your Anthropic API key. It's stored only in your browser — never sent anywhere except Anthropic's API.
      </div>
    </div>`;
  return false;
}

window.Store = Store;
window.esc = esc;
window.el = el;
window.fmt = fmt;
window.generateId = generateId;
window.startTicker = startTicker;
window.callClaude = callClaude;
window.extractJSON = extractJSON;
window.matchPill = matchPill;
window.renderJobCard = renderJobCard;
window.toggleSave = toggleSave;
window.markApplied = markApplied;
window.openTailorModal = openTailorModal;
window.refreshDashboardStats = refreshDashboardStats;
window.renderLearningInsights = renderLearningInsights;
window.initDashboard = initDashboard;
window.checkApiKey = checkApiKey;
