/* =============================================
   app.js — Shared utilities, API, job cards
   ============================================= */

const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const el  = (id) => document.getElementById(id);
const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';

function generateId() { return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }

function startTicker(elId, messages) {
  let i = 0;
  const t = el(elId);
  if (!t) return null;
  t.textContent = messages[0];
  return setInterval(()=>{ i=(i+1)%messages.length; t.textContent=messages[i]; }, 2200);
}

// ── Claude API ──────────────────────────────────────────────────────────────
async function callClaude({ prompt, systemPrompt='', useSearch=false, maxTokens=3000 }) {
  const apiKey = Store.getApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role:'user', content: prompt }],
  };
  if (systemPrompt) body.system = systemPrompt;
  if (useSearch) body.tools = [{ type:'web_search_20250305', name:'web_search' }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':'application/json',
      'x-api-key': apiKey,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
}

function extractJSON(text) {
  // Try array first, then object
  const arr = text.match(/\[[\s\S]*\]/);
  if (arr) return JSON.parse(arr[0]);
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) return JSON.parse(obj[0]);
  throw new Error('No JSON found in response');
}

// ── Job card rendering ───────────────────────────────────────────────────────
function matchPill(score) {
  const cls   = { high:'match-high', medium:'match-medium', new:'match-new' };
  const label = { high:'Strong match', medium:'Good match', new:'New posting' };
  return `<span class="match-pill ${cls[score]||'match-medium'}">${label[score]||score}</span>`;
}

function connectionBadge(job) {
  const hasConnections = Store.getConnections().length > 0;
  if (!hasConnections) return '';
  const conn = Store.getConnectionsAtCompany(job.company);
  if (!conn.count) return '';
  const label = conn.count === 1
    ? `🔗 ${conn.people[0].name.split(' ')[0]} · 1st`
    : `🔗 ${conn.count} connections · 1st`;
  const safeData = encodeURIComponent(JSON.stringify(conn));
  return `<button class="conn-badge" onclick="showConnectionsPopup('${esc(job.company)}','${safeData}')">${label}</button>`;
}

function seenBadge(job) {
  return Store.isJobSeen(job)
    ? `<span style="font-size:10px;font-family:var(--font-mono);color:var(--text3);padding:3px 8px;border:1px solid var(--border);border-radius:20px">Seen before</span>`
    : '';
}

function renderJobCard(job) {
  const rec      = Store.getApplications().find(a => a.id === job.id);
  const isSaved  = rec?.status === 'saved';
  const isApplied= rec?.status === 'applied';
  const hasResume= !!Store.getResume();
  const jobJSON  = esc(JSON.stringify(job));
  const seen     = Store.isJobSeen(job);

  return `
  <div class="job-card${seen?' job-seen':''}" id="jcard-${esc(job.id)}">
    <div class="job-card-top">
      <div style="flex:1;min-width:0">
        <div class="job-co">${esc(job.company)}</div>
        <div class="job-title-text">${esc(job.title)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
        ${matchPill(job.match_score)}
        ${connectionBadge(job)}
        ${seenBadge(job)}
      </div>
    </div>
    <div class="job-meta-row">
      <span class="meta-chip">📍 ${esc(job.location||'TBD')}</span>
      ${job.visa_friendly ? '<span class="meta-chip visa-ok">✓ F1/CPT/OPT</span>' : ''}
      ${job.posted  ? `<span class="meta-chip">📅 ${esc(job.posted)}</span>` : ''}
      ${job.company_size ? `<span class="meta-chip">🏢 ${esc(job.company_size)}</span>` : ''}
    </div>
    <p class="job-summary">${esc(job.summary||'')}</p>
    ${job.skills?.length ? `<div class="job-skills-row">${job.skills.map(s=>`<span class="skill-tag">${esc(s)}</span>`).join('')}</div>` : ''}
    <div class="job-card-footer">
      <span class="job-source-label">${esc(job.source||'')}</span>
      <div class="job-actions">
        ${hasResume ? `<button class="btn-tailor" onclick="openTailorModal(${jobJSON})">✦ Tailor</button>` : ''}
        <button class="btn-save${isSaved?' saved':''}" onclick="toggleSave(${jobJSON},this)">
          ${isSaved?'★ Saved':'☆ Save'}
        </button>
        <button class="btn-save${isApplied?' saved':''}"
          style="${isApplied?'border-color:var(--green);color:var(--green);background:var(--green-bg)':''}"
          onclick="toggleApplied(${jobJSON},this)">
          ${isApplied?'✓ Applied':'✓ Mark Applied'}
        </button>
        ${job.url ? `<a class="btn-apply" href="${esc(job.url)}" target="_blank" rel="noopener">Open →</a>` : ''}
      </div>
    </div>
  </div>`;
}

function toggleSave(job, btn) {
  const rec = Store.getApplications().find(a=>a.id===job.id);
  if (rec?.status==='saved') {
    Store.removeApplication(job.id);
    btn.textContent='☆ Save'; btn.classList.remove('saved');
  } else {
    Store.saveApplication(job,'saved');
    btn.textContent='★ Saved'; btn.classList.add('saved');
  }
  refreshDashboardStats();
}

function toggleApplied(job, btn) {
  const rec = Store.getApplications().find(a=>a.id===job.id);
  if (rec?.status==='applied') {
    Store.saveApplication(job,'saved');
    btn.textContent='✓ Mark Applied'; btn.style.cssText='';
  } else {
    Store.saveApplication(job,'applied');
    btn.textContent='✓ Applied';
    btn.style.cssText='border-color:var(--green);color:var(--green);background:var(--green-bg)';
    showToast(`Marked as applied to ${job.company}`,'green');
  }
  refreshDashboardStats();
}

function showToast(msg, color='green') {
  let t = el('app-toast');
  if (!t) {
    t = document.createElement('div');
    t.id='app-toast';
    t.style.cssText='position:fixed;bottom:24px;right:24px;padding:12px 18px;border-radius:var(--radius);font-size:13px;font-family:var(--font-mono);z-index:9999;transition:opacity 0.4s';
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.style.background=`var(--${color}-bg)`;
  t.style.border=`1px solid rgba(${color==='green'?'111,207,151':'126,184,247'},0.3)`;
  t.style.color=`var(--${color})`;
  t.style.opacity='1';
  setTimeout(()=>{ t.style.opacity='0'; }, 2800);
}

// ── LinkedIn connections popup ───────────────────────────────────────────────
function showConnectionsPopup(company, encoded) {
  let conn;
  try { conn = JSON.parse(decodeURIComponent(encoded)); } catch { conn = {count:0,people:[]}; }

  let modal = el('conn-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id='conn-modal'; modal.className='modal-backdrop';
    modal.innerHTML=`
      <div class="modal" style="max-width:500px">
        <button class="modal-close" onclick="el('conn-modal').classList.remove('show')">✕</button>
        <div class="modal-title" id="conn-modal-title" style="font-size:18px"></div>
        <p style="font-size:13px;color:var(--text2);margin:6px 0 16px;line-height:1.6">
          These are your <strong style="color:var(--blue)">1st-degree</strong> LinkedIn connections at this company (from your exported Connections.csv).
          Message them directly to ask for a referral — this dramatically increases your chances.
        </p>
        <div id="conn-modal-list"></div>
        <div class="modal-footer"><button class="btn-primary" onclick="el('conn-modal').classList.remove('show')">Got it</button></div>
      </div>`;
    document.body.appendChild(modal);
  }
  el('conn-modal-title').textContent=`🔗 Your connections at ${company}`;
  el('conn-modal-list').innerHTML=(conn.people||[]).map(p=>`
    <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:var(--radius);margin-bottom:8px;border:1px solid var(--border)">
      <div style="width:38px;height:38px;border-radius:50%;background:var(--blue-bg);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;flex-shrink:0">
        ${esc((p.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase())}
      </div>
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:500">${esc(p.name)}</div>
        <div style="font-size:11px;font-family:var(--font-mono);color:var(--text3)">${esc(p.position||p.company)}</div>
        ${p.connectedOn?`<div style="font-size:10px;font-family:var(--font-mono);color:var(--text3)">Connected ${esc(p.connectedOn)}</div>`:''}
      </div>
    </div>`).join('');
  modal.classList.add('show');
}

// ── Resume tailor — TRUE 2-STEP to prevent fabrication ──────────────────────
//
// Step 1: Extract every fact verbatim from the resume (no generation)
// Step 2: Tailor using ONLY the extracted JSON — original text is NOT sent in step 2
//
// This structurally prevents fabrication because step 2 has no access to free text.

const EXTRACT_PROMPT = (resumeText) => `You are a fact extractor. Your ONLY job is to copy information from a resume into JSON.

RULES:
- Copy every piece of information VERBATIM. Do not rephrase, improve, summarize, or add anything.
- Every company name, job title, date, bullet point, skill, tool, metric, and number must come directly from the text below.
- If something is not in the text, it does not go in the JSON.
- For bullet points: copy them word-for-word. Do not rewrite.

RESUME TEXT:
${resumeText}

Return ONLY valid JSON, no markdown, no preamble:
{
  "name": "full name from resume",
  "contact": "email | phone | linkedin | location — exactly as written",
  "education": [
    {
      "school": "exact school name",
      "degree": "exact degree",
      "dates": "exact dates",
      "gpa": "GPA if stated or null",
      "coursework": "coursework if listed or null"
    }
  ],
  "experience": [
    {
      "company": "exact company name",
      "title": "exact job title",
      "dates": "exact dates",
      "location": "location if stated",
      "bullets": ["exact bullet point 1", "exact bullet point 2"]
    }
  ],
  "projects": [
    {
      "name": "exact project name",
      "tech": "exact technologies listed",
      "bullets": ["exact bullet point 1", "exact bullet point 2"]
    }
  ],
  "skills": {
    "raw": "all skills exactly as listed in the resume"
  },
  "certifications": ["any certifications listed"]
}`;

const TAILOR_PROMPT = (extractedFacts, job, jd) => `You are a senior resume writer. You will write a tailored resume using ONLY the facts provided below.

TARGET JOB:
Company: ${job.company||'Unknown'}
Title: ${job.title||'Internship'}
Job Description: ${jd}

STUDENT'S VERIFIED FACTS (this is the ONLY source you may use):
${JSON.stringify(extractedFacts, null, 2)}

RULES — violating any rule is a failure:
1. FACTS ONLY: Every company name, job title, date, metric, tool, technology, and skill in your output must exist in the VERIFIED FACTS above. If it is not in the facts, do not include it.
2. STAR FORMAT: Rewrite each bullet as: [Action verb] + [specific task/what you did] + [result/impact if stated in the original facts]. If no result exists in the facts, end at the action. Do not invent results or metrics.
3. SELECTION: Choose the most relevant experience and projects for this specific role. Cut bullets that are not relevant to free up space.
4. KEYWORDS: Mirror keywords from the job description only where the student's facts genuinely support them.
5. SUMMARY: Write 3 lines — (1) degree + school + graduation, (2) top 2-3 relevant skills from their actual skill list, (3) one value-add sentence for this specific role. No generic phrases.
6. LENGTH: 1 page maximum. Cut least-relevant content first.
7. SKILLS: Only include skills from the "raw" skills field in the facts. Do not add new ones.

Return ONLY valid JSON, no markdown:
{
  "name": "student name",
  "contact": "contact line",
  "summary": ["line1", "line2", "line3"],
  "education": [{ "school":"", "degree":"", "dates":"", "gpa":"", "coursework":"" }],
  "experience": [{ "company":"", "title":"", "dates":"", "location":"", "bullets":[""] }],
  "projects": [{ "name":"", "tech":"", "bullets":[""] }],
  "skills": { "languages":"", "tools":"", "methods":"" }
}`;

async function runTailor(resume, job, jdText, onDone, onError) {
  // Step 1: Extract facts (no web search, no generation)
  let facts = Store.getParsedResume();

  if (!facts) {
    const raw1 = await callClaude({
      prompt: EXTRACT_PROMPT(resume.text),
      useSearch: false,
      maxTokens: 2000,
    });
    try {
      facts = JSON.parse(raw1.match(/\{[\s\S]*\}/)?.[0] || '{}');
      Store.setParsedResume(facts); // Cache for reuse
    } catch(e) {
      throw new Error('Could not parse resume. Please re-upload your resume as plain text.');
    }
  }

  // Step 2: Tailor using ONLY the extracted JSON
  const jd = jdText || `${job.title||'Internship'} at ${job.company||'Company'}. Required skills: ${(job.skills||[]).join(', ')}. ${job.summary||''}`;
  const raw2 = await callClaude({
    prompt: TAILOR_PROMPT(facts, job, jd),
    useSearch: false,
    maxTokens: 2500,
  });

  let tailored;
  try {
    tailored = JSON.parse(raw2.match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch(e) {
    throw new Error('Resume generation failed. Try again.');
  }

  onDone(tailored, job);
}

// ── Render tailored resume as HTML ──────────────────────────────────────────
function renderResumeHTML(d, job) {
  const keywords = (job?.skills||[]).map(s=>s.toLowerCase());
  const highlight = (text) => {
    let out = esc(text);
    keywords.forEach(kw => {
      const re = new RegExp(`\\b(${kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})\\b`,'gi');
      out = out.replace(re,'<strong>$1</strong>');
    });
    return out;
  };
  const s = (v) => esc(v||'');

  let h = `<div style="font-family:Arial,sans-serif;color:#111;font-size:10.5pt;line-height:1.45;max-width:680px">`;

  // Header
  h += `<div style="text-align:center;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1a1a1a">
    <div style="font-size:16pt;font-weight:700;letter-spacing:.5px">${s(d.name)}</div>
    <div style="font-size:9pt;color:#444;margin-top:4px">${s(d.contact)}</div>
  </div>`;

  // Summary
  if (d.summary?.length) {
    h += `<div style="margin-bottom:11px">
      <div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-bottom:1px solid #bbb;margin-bottom:5px;padding-bottom:2px">Professional Summary</div>
      <div style="font-size:9.5pt;color:#222;line-height:1.55">${d.summary.map(l=>s(l)).join('<br>')}</div>
    </div>`;
  }

  // Education
  if (d.education?.length) {
    h += `<div style="margin-bottom:11px"><div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-bottom:1px solid #bbb;margin-bottom:5px;padding-bottom:2px">Education</div>`;
    d.education.forEach(e => {
      h += `<div style="display:flex;justify-content:space-between">
        <div><span style="font-weight:600">${s(e.school)}</span> <span style="font-size:9.5pt;color:#444">· ${s(e.degree)}</span></div>
        <div style="font-size:9.5pt;color:#555;white-space:nowrap">${s(e.dates)}</div>
      </div>`;
      if (e.gpa) h += `<div style="font-size:9pt;color:#444">GPA: ${s(e.gpa)}</div>`;
      if (e.coursework) h += `<div style="font-size:9pt;color:#444"><em>Coursework:</em> ${s(e.coursework)}</div>`;
    });
    h += `</div>`;
  }

  // Experience
  if (d.experience?.length) {
    h += `<div style="margin-bottom:11px"><div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-bottom:1px solid #bbb;margin-bottom:5px;padding-bottom:2px">Experience</div>`;
    d.experience.forEach(exp => {
      h += `<div style="margin-bottom:9px">
        <div style="display:flex;justify-content:space-between">
          <div><span style="font-weight:600">${s(exp.company)}</span> <span style="font-size:9.5pt;color:#555">· ${s(exp.title)}</span></div>
          <div style="font-size:9.5pt;color:#555;white-space:nowrap">${s(exp.dates)}${exp.location?' · '+s(exp.location):''}</div>
        </div>
        <ul style="margin:3px 0 0 15px;padding:0">
          ${(exp.bullets||[]).map(b=>`<li style="margin-bottom:2px;font-size:9.5pt">${highlight(b)}</li>`).join('')}
        </ul>
      </div>`;
    });
    h += `</div>`;
  }

  // Projects
  if (d.projects?.length) {
    h += `<div style="margin-bottom:11px"><div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-bottom:1px solid #bbb;margin-bottom:5px;padding-bottom:2px">Projects</div>`;
    d.projects.forEach(p => {
      h += `<div style="margin-bottom:7px">
        <div><span style="font-weight:600">${s(p.name)}</span>${p.tech?` <span style="font-size:9pt;color:#666">| ${s(p.tech)}</span>`:''}  </div>
        <ul style="margin:3px 0 0 15px;padding:0">
          ${(p.bullets||[]).map(b=>`<li style="margin-bottom:2px;font-size:9.5pt">${highlight(b)}</li>`).join('')}
        </ul>
      </div>`;
    });
    h += `</div>`;
  }

  // Skills
  if (d.skills) {
    h += `<div><div style="font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-bottom:1px solid #bbb;margin-bottom:5px;padding-bottom:2px">Skills</div>
      <div style="font-size:9.5pt;line-height:1.8">`;
    if (d.skills.languages) h += `<div><span style="font-weight:600">Languages & Querying:</span> ${highlight(d.skills.languages)}</div>`;
    if (d.skills.tools)     h += `<div><span style="font-weight:600">Tools & Platforms:</span> ${highlight(d.skills.tools)}</div>`;
    if (d.skills.methods)   h += `<div><span style="font-weight:600">Methods:</span> ${highlight(d.skills.methods)}</div>`;
    h += `</div></div>`;
  }
  h += `</div>`;
  return h;
}

function renderResumeText(d) {
  let t = `${d.name||''}\n${d.contact||''}\n\n`;
  if (d.summary?.length) t += `PROFESSIONAL SUMMARY\n${d.summary.join('\n')}\n\n`;
  if (d.education?.length) {
    t += `EDUCATION\n`;
    d.education.forEach(e => { t += `${e.school} — ${e.degree} (${e.dates})${e.gpa?' | GPA '+e.gpa:''}\n${e.coursework?'Coursework: '+e.coursework+'\n':''}`; });
    t += '\n';
  }
  if (d.experience?.length) {
    t += `EXPERIENCE\n`;
    d.experience.forEach(e => { t += `${e.company} | ${e.title} | ${e.dates}${e.location?' | '+e.location:''}\n${(e.bullets||[]).map(b=>'• '+b).join('\n')}\n\n`; });
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

// ── Tailor modal (from job card) ────────────────────────────────────────────
function openTailorModal(job, jdOverride) {
  const resume = Store.getResume();
  if (!resume) { alert('Please upload your resume in the Resume Tailor page first.'); return; }

  let modal = el('tailor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className='modal-backdrop'; modal.id='tailor-modal';
    modal.innerHTML=`
      <div class="modal" style="max-width:820px;width:96vw">
        <button class="modal-close" onclick="el('tailor-modal').classList.remove('show')">✕</button>
        <div class="modal-title">✦ Tailored Resume</div>
        <div class="modal-sub" id="tailor-sub" style="margin-bottom:12px"></div>
        <div id="tailor-loading" class="loading-wrap show">
          <div class="spinner"></div>
          <div class="loading-msg" id="tailor-step-label">Step 1 of 2 — Extracting your resume facts...</div>
          <div class="loading-ticker" id="tailor-ticker"></div>
        </div>
        <div id="tailor-output" style="display:none">
          <div id="tailor-render" style="background:#fff;color:#111;padding:32px 36px;border-radius:8px;border:1px solid #ddd;max-height:68vh;overflow-y:auto"></div>
          <div class="modal-footer" style="margin-top:14px">
            <button class="btn-ghost" onclick="copyTailoredText()">Copy plain text</button>
            <button class="btn-secondary" onclick="downloadTailoredPDF()">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none"><path d="M3 12h10M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Download PDF
            </button>
            <button class="btn-primary" onclick="el('tailor-modal').classList.remove('show')">Close</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  el('tailor-sub').textContent = `${job.title||'Role'} at ${job.company||'Company'}`;
  el('tailor-loading').classList.add('show');
  el('tailor-output').style.display='none';
  modal.classList.add('show');

  if (el('tailor-step-label')) el('tailor-step-label').textContent='Step 1 of 2 — Extracting your resume facts...';
  const ticker = startTicker('tailor-ticker',[
    'Reading every line of your resume...',
    'Copying facts verbatim — no invention...',
    'Step 2 — Matching facts to job requirements...',
    'Selecting strongest relevant bullets...',
    'Rewriting in STAR format...',
    'Removing irrelevant content...',
    'Final check...',
  ]);

  runTailor(resume, job, jdOverride,
    (data) => {
      clearInterval(ticker);
      window._tailorData = data; window._tailorJob = job;
      window._tailorText = renderResumeText(data);
      el('tailor-render').innerHTML = renderResumeHTML(data, job);
      el('tailor-loading').classList.remove('show');
      el('tailor-output').style.display='block';
    },
    (err) => {
      clearInterval(ticker);
      modal.classList.remove('show');
      alert('Resume tailoring failed: ' + err.message);
    }
  ).catch(err => {
    clearInterval(ticker);
    modal.classList.remove('show');
    alert('Resume tailoring failed: ' + err.message);
  });
}

function copyTailoredText() {
  navigator.clipboard.writeText(window._tailorText||'').then(()=>showToast('Copied to clipboard','blue'));
}

function downloadTailoredPDF() {
  const content = el('tailor-render');
  if (!content) return;
  const job = window._tailorJob||{};
  const name = ((window._tailorData?.name||'Resume')+'_'+(job.company||'Role')).replace(/\s+/g,'_');
  const win = window.open('','_blank','width=860,height=1100');
  win.document.write(`<!DOCTYPE html><html><head><title>${name}</title>
    <style>
      @page { margin:0.65in 0.7in; size:letter; }
      body { font-family:Arial,sans-serif; font-size:10.5pt; color:#111; margin:0; }
      strong { font-weight:700; }
    </style>
  </head><body>${content.innerHTML}</body></html>`);
  win.document.close(); win.focus();
  setTimeout(()=>{ win.print(); }, 500);
}

// ── Dashboard stats & init ───────────────────────────────────────────────────
function refreshDashboardStats() {
  const stats = Store.getStats();
  if (el('stat-applied')) el('stat-applied').textContent = stats.applied;
  if (el('stat-pending')) el('stat-pending').textContent = stats.pending;
  if (el('stat-saved'))   el('stat-saved').textContent   = stats.saved;
}

function renderLearningInsights() {
  const prefs = Store.getTopPreferences();
  const container = el('learning-content');
  if (!container) return;
  if (prefs.total===0) {
    container.innerHTML=`<div style="padding:14px 18px;font-size:12px;color:var(--text3);font-family:var(--font-mono)">Save and apply to roles to train the AI.</div>`;
    return;
  }
  const max = Math.max(...prefs.roles.map(r=>r.score),1);
  const bars = prefs.roles.slice(0,4).map(r=>{
    const pct = Math.round((r.score/max)*100);
    return `<div class="insight-bar"><span>${esc(r.label)}</span><span>${pct}%</span>
      <div class="insight-bar-track"></div><div class="insight-bar-fill" style="width:${pct}%"></div></div>`;
  }).join('');
  container.innerHTML=`<div class="insight-placeholder">${bars}<div class="insight-note">Based on ${prefs.total} interaction${prefs.total!==1?'s':''}.</div></div>`;
}

function initDashboard() {
  const h = new Date().getHours();
  const greet = h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  if (el('greeting-text')) el('greeting-text').textContent=`${greet} — here's your internship pulse.`;
  refreshDashboardStats();
  renderLearningInsights();

  const jobs = Store.getJobs().slice(0,4);
  const recentEl = el('recent-jobs');
  if (recentEl && jobs.length) {
    if (el('stat-matches')) el('stat-matches').textContent=Store.getJobs().length;
    const ls = Store.getLastSearch();
    recentEl.innerHTML=`
      ${ls?`<div style="font-size:11px;font-family:var(--font-mono);color:var(--text3);padding:10px 18px 0">Last search: ${fmt(ls)}</div>`:''}
      <div style="padding:14px;display:flex;flex-direction:column;gap:10px">${jobs.map(j=>renderJobCard(j)).join('')}</div>`;
  }

  const resume=Store.getResume();
  const rw=el('resume-status-widget');
  if (rw&&resume) rw.innerHTML=`
    <div class="resume-uploaded-card" style="margin:14px">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none"><rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <div><div class="resume-file-name">${esc(resume.name)}</div><div class="resume-file-size">Uploaded ${fmt(resume.uploadedAt)} · ${resume.wordCount||0} words</div></div>
    </div>`;

  // LinkedIn widget
  const cs=Store.getConnectionStats();
  const lw=el('linkedin-widget');
  if (lw) {
    if (cs.total>0) {
      lw.innerHTML=`<div class="resume-uploaded-card" style="margin:14px;background:var(--blue-bg);border-color:rgba(126,184,247,0.2)">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" style="color:var(--blue)"><rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M7 10v7M7 7v.5M12 17v-4c0-1.1.9-2 2-2s2 .9 2 2v4M17 17v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <div><div class="resume-file-name" style="color:var(--blue)">${cs.total.toLocaleString()} connections</div><div class="resume-file-size">${cs.companies.toLocaleString()} companies · badges live on job cards</div></div>
      </div>`;
    } else {
      lw.innerHTML=`<div class="resume-empty">
        <div style="font-size:13px;color:var(--text3)">No LinkedIn connections loaded</div>
        <button class="btn-secondary" style="margin-top:10px" onclick="window.location='pages/profile.html#linkedin'">Upload CSV</button>
      </div>`;
    }
  }

  const prefs=Store.getPrefs();
  if (el('ftag-roles')) el('ftag-roles').textContent=prefs.roles.length?prefs.roles[0]+(prefs.roles.length>1?` +${prefs.roles.length-1}`:''):'All Roles';
  if (el('ftag-loc'))   el('ftag-loc').textContent=prefs.location==='any'?'Any Location':prefs.location;
  document.querySelectorAll('.nav-item').forEach(a=>a.classList.toggle('active',['index.html','./index.html'].includes(a.getAttribute('href'))));
}

// Inject conn-badge style
const _s=document.createElement('style');
_s.textContent=`
.conn-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-family:var(--font-mono);padding:3px 8px;border-radius:20px;background:var(--blue-bg);border:1px solid rgba(126,184,247,0.25);color:var(--blue);cursor:pointer;white-space:nowrap;transition:opacity .12s}
.conn-badge:hover{opacity:.8}
.job-seen{opacity:.65}
.job-seen::after{content:'';position:absolute;inset:0;pointer-events:none}
`;
document.head.appendChild(_s);

// Expose globals
window.Store=Store; window.esc=esc; window.el=el; window.fmt=fmt;
window.generateId=generateId; window.startTicker=startTicker;
window.callClaude=callClaude; window.extractJSON=extractJSON;
window.renderJobCard=renderJobCard;
window.toggleSave=toggleSave; window.toggleApplied=toggleApplied;
window.showConnectionsPopup=showConnectionsPopup;
window.openTailorModal=openTailorModal;
window.copyTailoredText=copyTailoredText;
window.downloadTailoredPDF=downloadTailoredPDF;
window.renderResumeHTML=renderResumeHTML;
window.renderResumeText=renderResumeText;
window.runTailor=runTailor;
window.refreshDashboardStats=refreshDashboardStats;
window.renderLearningInsights=renderLearningInsights;
window.initDashboard=initDashboard;
window.showToast=showToast;
