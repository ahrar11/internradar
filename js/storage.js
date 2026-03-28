/* =============================================
   storage.js — All persistent state management
   ============================================= */

const Store = (() => {

  const KEY = {
    JOBS:        'ir_jobs',
    APPLICATIONS:'ir_applications',
    PREFERENCES: 'ir_preferences',
    RESUME:      'ir_resume',
    RESUME_PARSED:'ir_resume_parsed',  // extracted facts JSON - separate from raw text
    LEARN:       'ir_learn',
    API_KEY:     'ir_api_key',
    LAST_SEARCH: 'ir_last_search',
    LINKEDIN:    'ir_linkedin_connections',
    SEEN_JOBS:   'ir_seen_jobs',       // deduplication across sessions
  };

  const get = (key, fallback = null) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  };
  const set = (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch(e) { console.error('Store.set', key, e); }
  };
  const del = (key) => localStorage.removeItem(key);

  // ---- API Key ----
  const getApiKey = () => localStorage.getItem(KEY.API_KEY) || '';
  const setApiKey = (k) => localStorage.setItem(KEY.API_KEY, k);

  // ---- Jobs ----
  const getJobs = () => get(KEY.JOBS, []);
  const setJobs = (jobs) => {
    set(KEY.JOBS, jobs);
    set(KEY.LAST_SEARCH, new Date().toISOString());
    addSeenJobs(jobs); // Auto-track for deduplication
  };
  const getLastSearch = () => get(KEY.LAST_SEARCH);

  // ---- Seen Jobs (deduplication across sessions) ----
  const getSeenJobs = () => get(KEY.SEEN_JOBS, {});
  const addSeenJobs = (jobs) => {
    const seen = getSeenJobs();
    jobs.forEach(j => {
      const key = makeJobKey(j);
      if (key) seen[key] = new Date().toISOString();
    });
    // Keep last 1000 entries
    const entries = Object.entries(seen);
    if (entries.length > 1000) {
      const trimmed = Object.fromEntries(entries.sort((a,b) => a[1] > b[1] ? 1 : -1).slice(-1000));
      set(KEY.SEEN_JOBS, trimmed);
    } else {
      set(KEY.SEEN_JOBS, seen);
    }
  };
  const makeJobKey = (j) => j.company && j.title
    ? `${j.company}||${j.title}`.toLowerCase().replace(/[^a-z0-9|]/g,'')
    : null;
  const isJobSeen = (job) => {
    const key = makeJobKey(job);
    return key ? !!getSeenJobs()[key] : false;
  };
  const getSeenCompanies = () => {
    const seen = getSeenJobs();
    return [...new Set(Object.keys(seen).map(k => k.split('||')[0]).filter(Boolean))].slice(-30);
  };
  const clearSeenJobs = () => del(KEY.SEEN_JOBS);

  // ---- Applications ----
  const getApplications = () => get(KEY.APPLICATIONS, []);
  const saveApplication = (job, status = 'saved') => {
    const apps = getApplications();
    const idx = apps.findIndex(a => a.id === job.id);
    if (idx >= 0) {
      apps[idx].status = status;
      apps[idx].updatedAt = new Date().toISOString();
    } else {
      apps.unshift({ ...job, status, savedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), notes: '' });
    }
    set(KEY.APPLICATIONS, apps);
    recordInteraction(job, status);
  };
  const updateApplicationStatus = (jobId, status, notes) => {
    const apps = getApplications();
    const idx = apps.findIndex(a => a.id === jobId);
    if (idx >= 0) {
      apps[idx].status = status;
      apps[idx].updatedAt = new Date().toISOString();
      if (notes !== undefined) apps[idx].notes = notes;
      set(KEY.APPLICATIONS, apps);
    }
  };
  const removeApplication = (jobId) => set(KEY.APPLICATIONS, getApplications().filter(a => a.id !== jobId));

  // ---- Preferences ----
  const defaultPrefs = {
    roles: ['data analyst', 'business analyst', 'data science'],
    location: 'any', industry: 'any', keywords: '', visaFilter: true,
  };
  const getPrefs = () => ({ ...defaultPrefs, ...get(KEY.PREFERENCES, {}) });
  const setPrefs = (prefs) => set(KEY.PREFERENCES, prefs);

  // ---- Resume ----
  const getResume = () => get(KEY.RESUME);
  const setResume = (obj) => { set(KEY.RESUME, obj); del(KEY.RESUME_PARSED); }; // Clear parsed cache on new upload
  const clearResume = () => { del(KEY.RESUME); del(KEY.RESUME_PARSED); };
  const getParsedResume = () => get(KEY.RESUME_PARSED); // Cached extracted facts
  const setParsedResume = (data) => set(KEY.RESUME_PARSED, data);

  // ---- LinkedIn Connections ----
  // LinkedIn CSV format (as of 2024-2025):
  // First Name,Last Name,URL,Email Address,Company,Position,Connected On
  // (URL column exists but is always empty for privacy)
  // Older exports may not have URL column:
  // First Name,Last Name,Email Address,Company,Position,Connected On

  const parseCSVRow = (row) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (inQuotes && row[i+1] === '"') { current += '"'; i++; } // escaped quote
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim().replace(/^"|"$/g, ''));
    return result;
  };

  const parseLinkedInCSV = (csvText) => {
    // Normalize: remove BOM, normalize line endings
    const normalized = csvText
      .replace(/^\uFEFF/, '')   // UTF-8 BOM
      .replace(/\r\n/g, '\n')   // Windows CRLF
      .replace(/\r/g, '\n');    // Old Mac CR

    const allLines = normalized.split('\n');

    // Find header row (contains "first name" and "last name")
    let headerIdx = -1;
    let headerRow = [];
    for (let i = 0; i < Math.min(allLines.length, 15); i++) {
      const lower = allLines[i].toLowerCase();
      if (lower.includes('first name') && lower.includes('last name')) {
        headerIdx = i;
        headerRow = parseCSVRow(allLines[i]).map(h => h.toLowerCase().trim());
        break;
      }
    }

    if (headerIdx === -1) {
      console.error('LinkedIn CSV: header row not found');
      return [];
    }

    // Dynamically detect column positions from the header
    // This handles both old format (no URL col) and new format (with URL col)
    const col = {
      firstName:   headerRow.findIndex(h => h === 'first name'),
      lastName:    headerRow.findIndex(h => h === 'last name'),
      email:       headerRow.findIndex(h => h.includes('email')),
      company:     headerRow.findIndex(h => h === 'company'),
      position:    headerRow.findIndex(h => h === 'position'),
      connectedOn: headerRow.findIndex(h => h.includes('connected')),
    };

    // Validate we found the critical columns
    if (col.firstName < 0 || col.company < 0) {
      console.error('LinkedIn CSV: missing required columns. Found:', headerRow);
      return [];
    }

    const get = (row, colIdx) =>
      colIdx >= 0 && colIdx < row.length ? row[colIdx].trim() : '';

    const connections = [];
    for (let i = headerIdx + 1; i < allLines.length; i++) {
      const line = allLines[i].trim();
      if (!line) continue; // Skip empty lines

      const row = parseCSVRow(line);
      const company = get(row, col.company);

      // Only skip rows with truly empty company (not ones with short companies)
      if (!company) continue;

      connections.push({
        firstName:   get(row, col.firstName),
        lastName:    get(row, col.lastName),
        email:       get(row, col.email),
        company,
        position:    get(row, col.position),
        connectedOn: get(row, col.connectedOn),
      });
    }

    return connections;
  };

  const getConnections = () => get(KEY.LINKEDIN, []);
  const setConnections = (c) => set(KEY.LINKEDIN, c);
  const clearConnections = () => del(KEY.LINKEDIN);

  // Normalize company name for fuzzy matching
  const normalizeCompany = (s) => (s||'').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|corp|llc|ltd|co|the|technologies|technology|solutions|group|services|global|systems|labs|studio|studios|ai|io|us|usa)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Returns { count, people } for 1st degree connections at a company
  const getConnectionsAtCompany = (companyName) => {
    if (!companyName) return { count: 0, people: [] };
    const connections = getConnections();
    if (!connections.length) return { count: 0, people: [] };

    const targetNorm = normalizeCompany(companyName);
    const targetWords = targetNorm.split(' ').filter(w => w.length > 2);

    const matches = connections.filter(c => {
      const cn = normalizeCompany(c.company);
      if (!cn) return false;
      if (cn === targetNorm) return true;
      if (cn.includes(targetNorm) || targetNorm.includes(cn)) return true;
      // Require overlap of meaningful words
      const cWords = cn.split(' ').filter(w => w.length > 2);
      return targetWords.length > 0 && targetWords.some(w => cWords.includes(w));
    });

    return {
      count: matches.length,
      degree: '1st', // CSV only contains 1st-degree connections
      people: matches.slice(0, 8).map(c => ({
        name: `${c.firstName} ${c.lastName}`.trim(),
        position: c.position,
        company: c.company,
        connectedOn: c.connectedOn,
      })),
    };
  };

  const getConnectionStats = () => {
    const c = getConnections();
    return {
      total: c.length,
      companies: new Set(c.map(x => normalizeCompany(x.company)).filter(Boolean)).size,
    };
  };

  // ---- Learning engine ----
  const defaultLearn = { interactions: [], roleWeights: {}, industryWeights: {}, skillWeights: {} };
  const getLearning = () => ({ ...defaultLearn, ...get(KEY.LEARN, {}) });

  const recordInteraction = (job, action) => {
    const data = getLearning();
    data.interactions.push({ jobId: job.id, action, role: job.title, industry: job.industry||'', skills: job.skills||[], ts: new Date().toISOString() });
    if (data.interactions.length > 300) data.interactions = data.interactions.slice(-300);
    const w = action==='applied'?3 : action==='saved'?1 : action==='rejected'?-2 : 0;
    if (job.title) { const n = job.title.toLowerCase().replace(/intern(ship)?/g,'').trim(); data.roleWeights[n] = (data.roleWeights[n]||0)+w; }
    if (job.industry) data.industryWeights[job.industry] = (data.industryWeights[job.industry]||0)+w;
    (job.skills||[]).forEach(s => { data.skillWeights[s] = (data.skillWeights[s]||0)+w; });
    set(KEY.LEARN, data);
  };

  const getTopPreferences = () => {
    const data = getLearning();
    const sort = (obj) => Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>({ label:k, score:Math.max(0,v) }));
    return { roles: sort(data.roleWeights), industries: sort(data.industryWeights), skills: sort(data.skillWeights), total: data.interactions.length };
  };

  const getLearningPromptContext = () => {
    const p = getTopPreferences();
    if (p.total === 0) return '';
    return `\nLEARNED PREFERENCES (from ${p.total} past interactions):
- Top roles: ${p.roles.map(r=>r.label).join(', ')||'none yet'}
- Top industries: ${p.industries.map(i=>i.label).join(', ')||'none yet'}
- Top skills: ${p.skills.map(s=>s.label).join(', ')||'none yet'}`;
  };

  // ---- Stats ----
  const getStats = () => {
    const apps = getApplications();
    return {
      applied:   apps.filter(a=>a.status==='applied').length,
      saved:     apps.filter(a=>a.status==='saved').length,
      pending:   apps.filter(a=>['applied','interview'].includes(a.status)).length,
      interview: apps.filter(a=>a.status==='interview').length,
      offer:     apps.filter(a=>a.status==='offer').length,
    };
  };

  return {
    getApiKey, setApiKey,
    getJobs, setJobs, getLastSearch,
    getSeenJobs, addSeenJobs, isJobSeen, getSeenCompanies, clearSeenJobs,
    getApplications, saveApplication, updateApplicationStatus, removeApplication,
    getPrefs, setPrefs,
    getResume, setResume, clearResume, getParsedResume, setParsedResume,
    getConnections, setConnections, clearConnections, parseLinkedInCSV,
    getConnectionsAtCompany, getConnectionStats,
    getLearning, recordInteraction, getTopPreferences, getLearningPromptContext,
    getStats,
  };
})();

window.Store = Store;
