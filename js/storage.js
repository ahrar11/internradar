/* =============================================
   storage.js — All persistent state management
   Uses localStorage as the database.
   ============================================= */

const Store = (() => {

  const KEY = {
    JOBS:        'ir_jobs',
    APPLICATIONS:'ir_applications',
    PREFERENCES: 'ir_preferences',
    RESUME:      'ir_resume',
    LEARN:       'ir_learn',
    API_KEY:     'ir_api_key',
    LAST_SEARCH: 'ir_last_search',
    LINKEDIN:    'ir_linkedin_connections',
  };

  const get = (key, fallback = null) => {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch { return fallback; }
  };
  const set = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { console.error('Store.set error', e); } };
  const del = (key) => localStorage.removeItem(key);

  // ---- API Key ----
  const getApiKey = () => localStorage.getItem(KEY.API_KEY) || '';
  const setApiKey = (k) => localStorage.setItem(KEY.API_KEY, k);

  // ---- Jobs ----
  const getJobs = () => get(KEY.JOBS, []);
  const setJobs = (jobs) => {
    set(KEY.JOBS, jobs);
    set(KEY.LAST_SEARCH, new Date().toISOString());
  };
  const getLastSearch = () => get(KEY.LAST_SEARCH);

  // ---- Applications ----
  const getApplications = () => get(KEY.APPLICATIONS, []);
  const saveApplication = (job, status = 'saved') => {
    const apps = getApplications();
    const existing = apps.findIndex(a => a.id === job.id);
    if (existing >= 0) {
      apps[existing].status = status;
      apps[existing].updatedAt = new Date().toISOString();
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
  const removeApplication = (jobId) => {
    const apps = getApplications().filter(a => a.id !== jobId);
    set(KEY.APPLICATIONS, apps);
  };

  // ---- Preferences ----
  const defaultPrefs = {
    roles: ['data analyst', 'business analyst', 'data science'],
    location: 'any', industry: 'any', keywords: '', visaFilter: true, onlyRemote: false,
  };
  const getPrefs = () => ({ ...defaultPrefs, ...get(KEY.PREFERENCES, {}) });
  const setPrefs = (prefs) => set(KEY.PREFERENCES, prefs);

  // ---- Resume ----
  const getResume = () => get(KEY.RESUME);
  const setResume = (resumeObj) => set(KEY.RESUME, resumeObj);
  const clearResume = () => del(KEY.RESUME);

  // ---- LinkedIn Connections ----
  // LinkedIn exports CSV with columns:
  // First Name, Last Name, Email Address, Company, Position, Connected On
  // (Settings & Privacy → Data Privacy → Get a copy of your data → Connections)

  const getConnections = () => get(KEY.LINKEDIN, []);
  const setConnections = (connections) => set(KEY.LINKEDIN, connections);
  const clearConnections = () => del(KEY.LINKEDIN);

  // Parse a single CSV row handling quoted fields with commas inside
  const parseCSVRow = (row) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  };

  const parseLinkedInCSV = (csvText) => {
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    // LinkedIn CSVs have metadata rows before the real header — find it
    let dataStartIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      if (lower.includes('first name') && lower.includes('company')) {
        dataStartIdx = i + 1;
        break;
      }
    }
    if (dataStartIdx === 0) {
      // Fallback: assume first row is header
      dataStartIdx = 1;
    }
    const connections = [];
    for (let i = dataStartIdx; i < lines.length; i++) {
      const row = parseCSVRow(lines[i]);
      if (row.length >= 4 && row[3]) {
        connections.push({
          firstName:   row[0] || '',
          lastName:    row[1] || '',
          email:       row[2] || '',
          company:     row[3] || '',
          position:    row[4] || '',
          connectedOn: row[5] || '',
        });
      }
    }
    return connections.filter(c => c.company && c.company.length > 1);
  };

  // Normalize company name for fuzzy matching
  const normalizeCompany = (s) => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|corp|llc|ltd|co|the|technologies|technology|solutions|group|services|global|systems|labs|studio|studios|ai|io)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Returns { count, people } — 1st degree connections at a company
  const getConnectionsAtCompany = (companyName) => {
    if (!companyName) return { count: 0, people: [] };
    const connections = getConnections();
    if (!connections.length) return { count: 0, people: [] };

    const targetNorm = normalizeCompany(companyName);
    const targetWords = targetNorm.split(' ').filter(w => w.length > 2);

    const matches = connections.filter(c => {
      const connNorm = normalizeCompany(c.company);
      if (!connNorm) return false;
      if (connNorm === targetNorm) return true;
      if (connNorm.includes(targetNorm) || targetNorm.includes(connNorm)) return true;
      // Significant word overlap
      const connWords = connNorm.split(' ').filter(w => w.length > 2);
      const overlap = targetWords.filter(w => connWords.includes(w));
      return overlap.length >= Math.min(1, targetWords.length);
    });

    return {
      count: matches.length,
      people: matches.slice(0, 6).map(c => ({
        name: `${c.firstName} ${c.lastName}`.trim(),
        position: c.position,
        company: c.company,
      })),
    };
  };

  const getConnectionStats = () => {
    const connections = getConnections();
    const companies = [...new Set(connections.map(c => c.company).filter(Boolean))];
    return { total: connections.length, companies: companies.length };
  };

  // ---- Learning engine ----
  const defaultLearn = {
    interactions: [], roleWeights: {}, industryWeights: {}, skillWeights: {},
  };
  const getLearning = () => ({ ...defaultLearn, ...get(KEY.LEARN, {}) });

  const recordInteraction = (job, action) => {
    const data = getLearning();
    data.interactions.push({ jobId: job.id, action, role: job.title, industry: job.industry || '', skills: job.skills || [], ts: new Date().toISOString() });
    if (data.interactions.length > 200) data.interactions = data.interactions.slice(-200);

    const weight = action === 'applied' ? 3 : action === 'saved' ? 1 : action === 'rejected' ? -2 : 0;
    if (job.title) {
      const norm = job.title.toLowerCase().replace(/intern(ship)?/g,'').trim();
      data.roleWeights[norm] = (data.roleWeights[norm] || 0) + weight;
    }
    if (job.industry) data.industryWeights[job.industry] = (data.industryWeights[job.industry] || 0) + weight;
    (job.skills || []).forEach(s => { data.skillWeights[s] = (data.skillWeights[s] || 0) + weight; });
    set(KEY.LEARN, data);
  };

  const getTopPreferences = () => {
    const data = getLearning();
    const sort = (obj) => Object.entries(obj).sort((a,b) => b[1]-a[1]).slice(0,5).map(([k,v]) => ({ label: k, score: Math.max(0,v) }));
    return { roles: sort(data.roleWeights), industries: sort(data.industryWeights), skills: sort(data.skillWeights), total: data.interactions.length };
  };

  const getLearningPromptContext = () => {
    const prefs = getTopPreferences();
    if (prefs.total === 0) return '';
    return `\n\nLEARNED PREFERENCES (from user's past apply/save actions):
- Preferred role types: ${prefs.roles.map(r=>r.label).join(', ') || 'none yet'}
- Preferred industries: ${prefs.industries.map(i=>i.label).join(', ') || 'none yet'}
- Preferred skills: ${prefs.skills.map(s=>s.label).join(', ') || 'none yet'}
Boost matches in these areas. Total interactions: ${prefs.total}.`;
  };

  // ---- Stats ----
  const getStats = () => {
    const apps = getApplications();
    return {
      applied:   apps.filter(a => a.status === 'applied').length,
      saved:     apps.filter(a => a.status === 'saved').length,
      pending:   apps.filter(a => ['applied','interview'].includes(a.status)).length,
      interview: apps.filter(a => a.status === 'interview').length,
      offer:     apps.filter(a => a.status === 'offer').length,
    };
  };

  return {
    getApiKey, setApiKey,
    getJobs, setJobs, getLastSearch,
    getApplications, saveApplication, updateApplicationStatus, removeApplication,
    getPrefs, setPrefs,
    getResume, setResume, clearResume,
    getConnections, setConnections, clearConnections, parseLinkedInCSV,
    getConnectionsAtCompany, getConnectionStats,
    getLearning, recordInteraction, getTopPreferences, getLearningPromptContext,
    getStats,
  };
})();

window.Store = Store;
