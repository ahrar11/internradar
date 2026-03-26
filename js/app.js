/* =============================================
   app.js — Shared utilities & dashboard logic
   ============================================= */

const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const el  = (id) => document.getElementById(id);
const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '';

function generateId() {
  return Math.random().toString(36).slice(2,10) + Date.now().toString(36);
}

function startTicker(elId, messages) {
  let i = 0;
  const t = el(elId);
  if (!t) return;
  t.textContent = messages[0];
  return setInterval(() => { i = (i+1) % messages.length; t.textContent = messages[i]; }, 2000);
}

// ---- Anthropic API ----
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
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
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

// ---- Match pill ----
function matchPill(score) {
  const map    = { high: 'match-high', medium: 'match-medium', new: 'match-new' };
  const labels = { high: 'Strong match', medium: 'Good match', new: 'New posting' };
  return `<span class="match-pill ${map[score]||'match-medium'}">${labels[score]||score}</span>`;
}

// ---- LinkedIn connection badge ----
function connectionBadgeHTML(job) {
  const conn = Store.getConnectionsAtCompany(job.company);
  if (!conn.count) return '';
  const label = conn.count === 1
    ? `🔗 ${conn.people[0].name.split(' ')[0]} works here`
    : `🔗 ${conn.count} connections`;
  const peopleData = esc(JSON.stringify(conn.people));
  return `<button class="conn-badge" onclick="showConnectionsPopup('${esc(job.company)}', '${peopleData}')">${label}</button>`;
}

// ---- Job card ----
function renderJobCard(job) {
  const appRecord  = Store.getApplications().find(a => a.id === job.id);
  const isSaved    = appRecord?.status === 'saved';
  const isApplied  = appRecord?.status === 'applied';
  const hasResume  = !!Store.getResume();
  const jobJSON    = esc(JSON.stringify(job));

  return `
  <div class="job-card" id="jcard-${esc(job.id)}">
    <div class="job-card-top">
      <div>
        <div class="job-co">${esc(job.company)}</div>
        <div class="job-title-text">${esc(job.title)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
        ${matchPill(job.match_score)}
        ${connectionBadgeHTML(job)}
      </div>
    </div>
    <div class="job-meta-row">
      <span class="meta-chip">📍 ${esc(job.location||'TBD')}</span>
      ${job.visa_friendly ? '<span class="meta-chip visa-ok">✓ F1/CPT/OPT</span>' : ''}
      ${job.posted ? `<span class="meta-chip">📅 ${esc(job.posted)}</span>` : ''}
      ${job.company_size ? `<span class="meta-chip">🏢 ${esc(job.company_size)}</span>` : ''}
      ${job.deadline ? `<span class="meta-chip">⏰ Deadline: ${esc(job.deadline)}</span>` : ''}
    </div>
    <p class="job-summary">${esc(job.summary||'')}</p>
    ${job.skills?.length ? `<div class="job-skills-row">${job.skills.map(s=>`<span class="skill-tag">${esc(s)}</span>`).join('')}</div>` : ''}
    <div class="job-card-footer">
      <span class="job-source-label">${esc(job.source||'')}</span>
      <div class="job-actions">
        ${hasResume ? `<button class="btn-tailor" onclick="openTailorModal(${jobJSON})">✦ Tailor</button>` : ''}
        <button class="btn-save ${isSaved?'saved':''}" onclick="toggleSave(${jobJSON}, this)">
          ${isSaved ? '★ Saved' : '☆ Save'}
        </button>
        <button class="btn-save ${isApplied?'saved':''}" style="${isApplied?'border-color:var(--green);color:var(--green);background:var(--green-bg)':''}" onclick="toggleApplied(${jobJSON}, this)">
          ${isApplied ? '✓ Applied' : '✓ Mark Applied'}
        </button>
        ${job.url ? `<a class="btn-apply" href="${esc(job.url)}" target="_blank">Open →</a>` : ''}
      </div>
    </div>
  </div>`;
}

// ---- Save / Applied toggles ----
function toggleSave(job, btn) {
  const existing = Store.getApplications().find(a => a.id === job.id);
  if (existing?.status === 'saved') {
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

function toggleApplied(job, btn) {
  const existing = Store.getApplications().find(a => a.id === job.id);
  if (existing?.status === 'applied') {
    // Revert to saved (don't delete entirely)
    Store.saveApplication(job, 'saved');
    btn.textContent = '✓ Mark Applied';
    btn.style.cssText = '';
  } else {
    Store.saveApplication(job, 'applied');
    btn.textContent = '✓ Applied';
    btn.style.cssText = 'border-color:var(--green);color:var(--green);background:var(--green-bg)';
    showAppliedToast(job.company);
  }
  refreshDashboardStats();
}

function showAppliedToast(company) {
  let toast = el('applied-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'applied-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:var(--green-bg);border:1px solid rgba(111,207,151,0.3);color:var(--green);padding:12px 18px;border-radius:var(--radius);font-size:13px;font-family:var(--font-mono);z-index:999;transition:opacity 0.3s';
    document.body.appendChild(toast);
  }
  toast.textContent = `✓ Marked as applied to ${company}`;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ---- LinkedIn connections popup ----
function showConnectionsPopup(company, peopleJSON) {
  let people;
  try { people = JSON.parse(decodeURIComponent(peopleJSON)); } catch { people = []; }

  let modal = el('conn-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'conn-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal" style="max-width:480px">
        <button class="modal-close" onclick="el('conn-modal').classList.remove('show')">✕</button>
        <div class="modal-title" id="conn-modal-title" style="font-size:18px"></div>
        <p style="font-size:13px;color:var(--text2);margin:6px 0 18px">These are your 1st-degree LinkedIn connections at this company. Reach out for a referral before applying.</p>
        <div id="conn-modal-list"></div>
        <div class="modal-footer" style="margin-top:16px">
          <button class="btn-primary" onclick="el('conn-modal').classList.remove('show')">Got it</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  el('conn-modal-title').textContent = `🔗 Connections at ${company}`;
  el('conn-modal-list').innerHTML = people.map(p => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:var(--radius);margin-bottom:8px">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--blue-bg);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;flex-shrink:0">
        ${esc((p.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase())}
      </div>
      <div>
        <div style="font-size:13px;font-weight:500">${esc(p.name)}</div>
        <div style="font-size:11px;font-family:var(--font-mono);color:var(--text3)">${esc(p.position||p.company)}</div>
      </div>
    </div>`).join('');

  modal.classList.add('show');
}

// ---- Resume tailor modal ----
function buildTailorPrompt(resume, job, jdOverride) {
  const jd = jdOverride || `${job.title} at ${job.company}. Required skills: ${(job.skills||[]).join(', ')}. ${job.summary||''}`;
  return `You are a senior recruiter and resume strategist at a top-tier firm. Your task is to tailor a student's resume for a specific role.

═══════════════════════════════════════════
STUDENT'S MASTER RESUME (source of truth):
═══════════════════════════════════════════
${resume.text}

═══════════════════════════════════════════
TARGET ROLE:
═══════════════════════════════════════════
Company: ${job.company || 'Unknown'}
Title: ${job.title || 'Internship'}
Job Description: ${jd}

═══════════════════════════════════════════
STRICT RULES — violating any of these is a failure:
═══════════════════════════════════════════
1. ZERO FABRICATION: You may ONLY use information that exists verbatim in the student's master resume above. Do NOT add any company names, project names, tools, technologies, metrics, achievements, responsibilities, or skills that are not already present in the resume. If a skill is not in the resume, do not add it. If a project is not in the resume, do not add it. If a metric is not in the resume, do not invent one.

2. REWRITING IS ALLOWED: You MAY rephrase existing bullet points using stronger language, reorder bullets within a role, reorder sections, cut irrelevant bullets, and restructure sentences — as long as the underlying facts remain identical.

3. STAR FORMAT: For every work experience and project bullet point, rewrite it in STAR format (Situation/Task → Action → Result). Pattern: "[Strong action verb] + [what you did, be specific] + [quantified result or impact if available in original]". If no result is stated in the original, end with the action — do not invent a result.

4. ATS OPTIMIZATION: Mirror the exact keywords from the job description wherever they are genuinely supported by the student's existing experience. Place the most relevant skills and experience first.

5. PROFESSIONAL SUMMARY: Write a 3-line summary at the top. Line 1: student's degree + university + graduation. Line 2: 2-3 most relevant skills for this specific role (only from their actual skills). Line 3: one sentence on what value they bring to this specific role. Do NOT use generic phrases like "hardworking" or "passionate".

6. LENGTH: Strictly 1 page. If there's too much content, cut the LEAST relevant bullets first. Never cut Education or Skills. Prefer depth (2-3 strong bullets) over breadth (5 weak bullets) per role.

7. SKILLS SECTION: Only list skills that appear in the original resume. Group them: Languages | Tools & Platforms | Methods. Bold or surface the ones that match the JD.

8. SECTION ORDER (optimize for this role): SUMMARY → EDUCATION → most relevant section first (EXPERIENCE or PROJECTS depending on which is stronger for this JD) → SKILLS

═══════════════════════════════════════════
OUTPUT FORMAT — return ONLY a JSON object, no markdown, no preamble:
═══════════════════════════════════════════
{
  "name": "student full name",
  "contact": "email | phone | linkedin | location",
  "summary": ["line1", "line2", "line3"],
  "education": [
    { "school": "", "degree": "", "dates": "", "gpa": "", "coursework": "" }
  ],
  "experience": [
    {
      "company": "",
      "title": "",
      "dates": "",
      "location": "",
      "bullets": ["STAR bullet 1", "STAR bullet 2", "STAR bullet 3"]
    }
  ],
  "projects": [
    {
      "name": "",
      "tech": "",
      "bullets": ["STAR bullet 1", "STAR bullet 2"]
    }
  ],
  "skills": {
    "languages": "",
    "tools": "",
    "methods": ""
  }
}`;
}

function openTailorModal(job, jdOverride) {
  const resume = Store.getResume();
  if (!resume) { alert('Please upload your resume first in the Resume Tailor page.'); return; }

  let modal = el('tailor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'tailor-modal';
    modal.innerHTML = `
      <div class="modal" style="max-width:800px;width:95vw">
        <button class="modal-close" onclick="document.getElementById('tailor-modal').classList.remove('show')">✕</button>
        <div class="modal-title">✦ Tailored Resume</div>
        <div class="modal-sub" id="tailor-modal-sub" style="margin-bottom:12px"></div>
        <div id="tailor-loading" class="loading-wrap show">
          <div class="spinner"></div>
          <div class="loading-msg">Tailoring your resume — strictly using only your existing experience...</div>
          <div class="loading-ticker" id="tailor-ticker"></div>
        </div>
        <div id="tailor-output" style="display:none">
          <div id="resume-preview-render" style="background:#fff;color:#111;padding:36px 40px;border-radius:8px;font-family:'Times New Roman',serif;font-size:11pt;line-height:1.4;max-height:70vh;overflow-y:auto;border:1px solid #ddd"></div>
          <div class="modal-footer" style="margin-top:16px">
            <button class="btn-ghost" onclick="copyTailoredText()">Copy plain text</button>
            <button class="btn-secondary" onclick="downloadTailoredPDF()">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none"><path d="M3 12h10M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Download PDF
            </button>
            <button class="btn-primary" onclick="document.getElementById('tailor-modal').classList.remove('show')">Done</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  el('tailor-modal-sub').textContent = `${job.title || 'Role'} at ${job.company || 'Company'}`;
  el('tailor-loading').classList.add('show');
  el('tailor-output').style.display = 'none';
  modal.classList.add('show');

  const ticker = startTicker('tailor-ticker', [
    'Reading your resume carefully...',
    'Identifying matching experience...',
    'Rewriting bullets in STAR format...',
    'Cutting irrelevant content...',
    'Optimizing ATS keywords...',
    'Final quality check...',
  ]);

  callClaude({ prompt: buildTailorPrompt(resume, job, jdOverride), useSearch: false, maxTokens: 3000 })
    .then(raw => {
      clearInterval(ticker);
      // Parse JSON response
      let data;
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found');
        data = JSON.parse(jsonMatch[0]);
      } catch(e) {
        // Fallback: render as plain text if JSON parse fails
        el('resume-preview-render').innerHTML = `<pre style="font-family:monospace;font-size:10pt;white-space:pre-wrap">${esc(raw)}</pre>`;
        el('tailor-loading').classList.remove('show');
        el('tailor-output').style.display = 'block';
        window._tailorRawText = raw;
        return;
      }
      window._tailorData = data;
      window._tailorRawText = renderResumeText(data);
      el('resume-preview-render').innerHTML = renderResumeHTML(data, job);
      el('tailor-loading').classList.remove('show');
      el('tailor-output').style.display = 'block';
    })
    .catch(err => {
      clearInterval(ticker);
      modal.classList.remove('show');
      alert('Resume tailoring failed: ' + err.message);
    });
}

function renderResumeHTML(d, job) {
  const jdKeywords = (job?.skills || []).map(s => s.toLowerCase());
  const highlightKeyword = (text) => {
    if (!jdKeywords.length) return esc(text);
    let out = esc(text);
    jdKeywords.forEach(kw => {
      const re = new RegExp(`\\b(${kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})\\b`, 'gi');
      out = out.replace(re, '<strong>$1</strong>');
    });
    return out;
  };

  const s = (str) => esc(str||'');

  let html = `<div style="font-family:'Georgia',serif;color:#111;font-size:11pt;line-height:1.45">`;

  // Header
  html += `<div style="text-align:center;margin-bottom:14px;border-bottom:2px solid #222;padding-bottom:10px">
    <div style="font-size:17pt;font-weight:700;letter-spacing:1px;text-transform:uppercase">${s(d.name)}</div>
    <div style="font-size:9pt;color:#444;margin-top:4px;font-family:Arial,sans-serif">${s(d.contact)}</div>
  </div>`;

  // Summary
  if (d.summary?.length) {
    html += `<div style="margin-bottom:12px">
      <div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#222;border-bottom:1px solid #ccc;margin-bottom:6px;padding-bottom:2px">Professional Summary</div>
      <div style="font-size:10pt;color:#333;font-family:Arial,sans-serif;line-height:1.6">${d.summary.map(l => s(l)).join('<br>')}</div>
    </div>`;
  }

  // Education
  if (d.education?.length) {
    html += `<div style="margin-bottom:12px">
      <div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#222;border-bottom:1px solid #ccc;margin-bottom:6px;padding-bottom:2px">Education</div>`;
    d.education.forEach(e => {
      html += `<div style="display:flex;justify-content:space-between;font-family:Arial,sans-serif">
        <div><span style="font-weight:600;font-size:10.5pt">${s(e.school)}</span> <span style="font-size:9.5pt;color:#444">· ${s(e.degree)}</span></div>
        <div style="font-size:9.5pt;color:#555;white-space:nowrap">${s(e.dates)}</div>
      </div>`;
      if (e.gpa) html += `<div style="font-size:9.5pt;color:#444;font-family:Arial,sans-serif">GPA: ${s(e.gpa)}</div>`;
      if (e.coursework) html += `<div style="font-size:9.5pt;color:#444;font-family:Arial,sans-serif;margin-top:2px"><em>Relevant Coursework:</em> ${s(e.coursework)}</div>`;
    });
    html += `</div>`;
  }

  // Experience
  if (d.experience?.length) {
    html += `<div style="margin-bottom:12px">
      <div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#222;border-bottom:1px solid #ccc;margin-bottom:6px;padding-bottom:2px">Experience</div>`;
    d.experience.forEach(exp => {
      html += `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-family:Arial,sans-serif">
          <div><span style="font-weight:600;font-size:10.5pt">${s(exp.company)}</span><span style="font-size:9.5pt;color:#555"> · ${s(exp.title)}</span></div>
          <div style="font-size:9.5pt;color:#555;white-space:nowrap">${s(exp.dates)} ${exp.location ? '· '+s(exp.location) : ''}</div>
        </div>
        <ul style="margin:4px 0 0 16px;padding:0;font-family:Arial,sans-serif;font-size:9.5pt">
          ${(exp.bullets||[]).map(b => `<li style="margin-bottom:3px">${highlightKeyword(b)}</li>`).join('')}
        </ul>
      </div>`;
    });
    html += `</div>`;
  }

  // Projects
  if (d.projects?.length) {
    html += `<div style="margin-bottom:12px">
      <div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#222;border-bottom:1px solid #ccc;margin-bottom:6px;padding-bottom:2px">Projects</div>`;
    d.projects.forEach(proj => {
      html += `<div style="margin-bottom:8px">
        <div style="font-family:Arial,sans-serif"><span style="font-weight:600;font-size:10.5pt">${s(proj.name)}</span>${proj.tech ? ` <span style="font-size:9pt;color:#666">| ${s(proj.tech)}</span>` : ''}</div>
        <ul style="margin:4px 0 0 16px;padding:0;font-family:Arial,sans-serif;font-size:9.5pt">
          ${(proj.bullets||[]).map(b => `<li style="margin-bottom:3px">${highlightKeyword(b)}</li>`).join('')}
        </ul>
      </div>`;
    });
    html += `</div>`;
  }

  // Skills
  if (d.skills) {
    html += `<div>
      <div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#222;border-bottom:1px solid #ccc;margin-bottom:6px;padding-bottom:2px">Skills</div>
      <div style="font-family:Arial,sans-serif;font-size:9.5pt;line-height:1.8">`;
    if (d.skills.languages) html += `<div><span style="font-weight:600">Languages & Querying:</span> ${highlightKeyword(d.skills.languages)}</div>`;
    if (d.skills.tools)     html += `<div><span style="font-weight:600">Tools & Platforms:</span> ${highlightKeyword(d.skills.tools)}</div>`;
    if (d.skills.methods)   html += `<div><span style="font-weight:600">Methods & Techniques:</span> ${highlightKeyword(d.skills.methods)}</div>`;
    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}

function renderResumeText(d) {
  let t = '';
  t += `${d.name||''}\n${d.contact||''}\n\n`;
  if (d.summary?.length) t += `PROFESSIONAL SUMMARY\n${d.summary.join('\n')}\n\n`;
  if (d.education?.length) {
    t += `EDUCATION\n`;
    d.education.forEach(e => { t += `${e.school} — ${e.degree} (${e.dates})${e.gpa?' | GPA: '+e.gpa:''}\n${e.coursework?'Coursework: '+e.coursework+'\n':''}`; });
    t += '\n';
  }
  if (d.experience?.length) {
    t += `EXPERIENCE\n`;
    d.experience.forEach(e => { t += `${e.company} | ${e.title} | ${e.dates}\n${(e.bullets||[]).map(b=>'• '+b).join('\n')}\n\n`; });
  }
  if (d.projects?.length) {
    t += `PROJECTS\n`;
    d.projects.forEach(p => { t += `${p.name}${p.tech?' | '+p.tech:''}\n${(p.bullets||[]).map(b=>'• '+b).join('\n')}\n\n`; });
  }
  if (d.skills) {
    t += `SKILLS\n`;
    if (d.skills.languages) t += `Languages: ${d.skills.languages}\n`;
    if (d.skills.tools)     t += `Tools: ${d.skills.tools}\n`;
    if (d.skills.methods)   t += `Methods: ${d.skills.methods}\n`;
  }
  return t;
}

function copyTailored() { copyTailoredText(); }
function copyTailoredText() {
  const text = window._tailorRawText || '';
  navigator.clipboard.writeText(text).then(() => alert('Plain text copied to clipboard!'));
}

function downloadTailoredPDF() {
  const content = el('resume-preview-render');
  if (!content) return;

  const name = (window._tailorData?.name || 'Resume').replace(/\s+/g,'_');
  const printWin = window.open('', '_blank', 'width=800,height=1000');
  printWin.document.write(`<!DOCTYPE html><html><head><title>${name}_Resume</title>
    <style>
      @page { margin: 0.6in 0.65in; size: letter; }
      body { font-family: Georgia, serif; font-size: 11pt; color: #111; margin: 0; -webkit-print-color-adjust: exact; }
      @media print { body { margin: 0; } }
    </style>
  </head><body>${content.innerHTML}</body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => {
    printWin.print();
    printWin.close();
  }, 400);
}

// ---- Dashboard stats ----
function refreshDashboardStats() {
  const stats = Store.getStats();
  if (el('stat-applied')) el('stat-applied').textContent = stats.applied;
  if (el('stat-pending')) el('stat-pending').textContent = stats.pending;
  if (el('stat-saved'))   el('stat-saved').textContent   = stats.saved;
}

// ---- Learning insight bars ----
function renderLearningInsights() {
  const prefs = Store.getTopPreferences();
  const container = el('learning-content');
  if (!container) return;

  if (prefs.total === 0) {
    container.innerHTML = `<div class="insight-placeholder"><div class="insight-note" style="padding:14px 18px">Save and mark roles as applied to train the AI on your preferences.</div></div>`;
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
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  if (el('greeting-text')) el('greeting-text').textContent = `${greet} — here's your internship pulse.`;

  refreshDashboardStats();
  renderLearningInsights();

  const jobs = Store.getJobs().slice(0, 4);
  const recentEl = el('recent-jobs');
  if (recentEl && jobs.length) {
    const ls = Store.getLastSearch();
    if (el('stat-matches')) el('stat-matches').textContent = Store.getJobs().length;
    recentEl.innerHTML = `
      ${ls ? `<div style="font-size:11px;font-family:var(--font-mono);color:var(--text3);padding:10px 18px 0">Last search: ${fmt(ls)}</div>` : ''}
      <div style="padding:14px;display:flex;flex-direction:column;gap:10px">
        ${jobs.map(j => renderJobCard(j)).join('')}
      </div>`;
  }

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

  // LinkedIn connections widget on dashboard
  const connStats = Store.getConnectionStats();
  const connWidget = el('linkedin-widget');
  if (connWidget) {
    if (connStats.total > 0) {
      connWidget.innerHTML = `
        <div class="resume-uploaded-card" style="margin:14px;background:var(--blue-bg);border-color:rgba(126,184,247,0.2)">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" style="color:var(--blue)"><rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M7 10v7M7 7v.5M12 17v-4c0-1.1.9-2 2-2s2 .9 2 2v4M17 17v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <div>
            <div class="resume-file-name" style="color:var(--blue)">${connStats.total.toLocaleString()} connections loaded</div>
            <div class="resume-file-size">${connStats.companies} companies · connection badges active on job cards</div>
          </div>
        </div>`;
    } else {
      connWidget.innerHTML = `
        <div class="resume-empty">
          <svg viewBox="0 0 40 40" width="32" height="32" fill="none" style="margin-bottom:8px;opacity:0.3;color:var(--blue)"><rect x="4" y="4" width="32" height="32" rx="5" stroke="currentColor" stroke-width="1.5"/><path d="M13 17v11M13 12v1.5M20 28v-7c0-1.7 1.3-3 3-3s3 1.3 3 3v7M26 28v-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <div style="font-size:13px;color:var(--text3)">No LinkedIn connections loaded</div>
          <button class="btn-secondary" style="margin-top:10px;font-size:12px" onclick="window.location='pages/profile.html#linkedin'">Upload CSV</button>
        </div>`;
    }
  }

  const prefs = Store.getPrefs();
  if (el('ftag-roles')) el('ftag-roles').textContent = prefs.roles.length ? prefs.roles[0] + (prefs.roles.length > 1 ? ` +${prefs.roles.length-1}` : '') : 'All Roles';
  if (el('ftag-loc'))   el('ftag-loc').textContent   = prefs.location === 'any' ? 'Any Location' : prefs.location;

  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === 'index.html' || a.getAttribute('href') === './index.html');
  });
}

function checkApiKey(containerId) {
  if (Store.getApiKey()) return true;
  const c = el(containerId);
  if (c) c.innerHTML = `
    <div class="api-setup-banner">
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4M10 14h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      <div><strong>API key required.</strong> Go to <a href="../pages/settings.html" style="color:var(--amber)">Settings</a> to add your Anthropic API key.</div>
    </div>`;
  return false;
}

// Add conn-badge style dynamically
const connStyle = document.createElement('style');
connStyle.textContent = `.conn-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-family:var(--font-mono);padding:3px 8px;border-radius:20px;background:var(--blue-bg);border:1px solid rgba(126,184,247,0.25);color:var(--blue);cursor:pointer;white-space:nowrap;transition:opacity 0.12s}.conn-badge:hover{opacity:0.8}`;
document.head.appendChild(connStyle);

window.Store = Store;
window.esc = esc; window.el = el; window.fmt = fmt;
window.generateId = generateId;
window.startTicker = startTicker;
window.callClaude = callClaude;
window.extractJSON = extractJSON;
window.matchPill = matchPill;
window.renderJobCard = renderJobCard;
window.toggleSave = toggleSave;
window.toggleApplied = toggleApplied;
window.showConnectionsPopup = showConnectionsPopup;
window.openTailorModal = openTailorModal;
window.refreshDashboardStats = refreshDashboardStats;
window.renderLearningInsights = renderLearningInsights;
window.initDashboard = initDashboard;
window.checkApiKey = checkApiKey;
