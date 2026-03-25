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

  // ---- Jobs (search results cache) ----
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
      apps.unshift({
        ...job,
        status,
        savedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        notes: '',
      });
    }
    set(KEY.APPLICATIONS, apps);
    // Record for learning
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

  // ---- Preferences / Filters ----
  const defaultPrefs = {
    roles: ['data analyst', 'business analyst', 'data science'],
    location: 'any',
    industry: 'any',
    keywords: '',
    visaFilter: true,
    onlyRemote: false,
  };
  const getPrefs = () => ({ ...defaultPrefs, ...get(KEY.PREFERENCES, {}) });
  const setPrefs = (prefs) => set(KEY.PREFERENCES, prefs);

  // ---- Resume ----
  const getResume = () => get(KEY.RESUME);
  const setResume = (resumeObj) => set(KEY.RESUME, resumeObj);
  const clearResume = () => del(KEY.RESUME);

  // ---- Learning engine ----
  const defaultLearn = {
    interactions: [],   // {jobId, action, role, industry, skills, ts}
    roleWeights: {},    // {roleName: score}
    industryWeights: {},
    skillWeights: {},
  };
  const getLearning = () => ({ ...defaultLearn, ...get(KEY.LEARN, {}) });

  const recordInteraction = (job, action) => {
    const data = getLearning();
    // Record raw interaction
    data.interactions.push({
      jobId: job.id,
      action, // 'saved','applied','rejected','ignored'
      role: job.title,
      industry: job.industry || '',
      skills: job.skills || [],
      ts: new Date().toISOString(),
    });
    // Keep last 200 interactions
    if (data.interactions.length > 200) data.interactions = data.interactions.slice(-200);

    const weight = action === 'applied' ? 3 : action === 'saved' ? 1 : action === 'rejected' ? -2 : 0;

    // Update role weights
    if (job.title) {
      const norm = job.title.toLowerCase().replace(/intern(ship)?/g,'').trim();
      data.roleWeights[norm] = (data.roleWeights[norm] || 0) + weight;
    }
    // Update industry weights
    if (job.industry) {
      data.industryWeights[job.industry] = (data.industryWeights[job.industry] || 0) + weight;
    }
    // Update skill weights
    (job.skills || []).forEach(s => {
      data.skillWeights[s] = (data.skillWeights[s] || 0) + weight;
    });

    set(KEY.LEARN, data);
  };

  const getTopPreferences = () => {
    const data = getLearning();
    const sort = (obj) =>
      Object.entries(obj)
        .sort((a,b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => ({ label: k, score: Math.max(0, v) }));
    return {
      roles: sort(data.roleWeights),
      industries: sort(data.industryWeights),
      skills: sort(data.skillWeights),
      total: data.interactions.length,
    };
  };

  const getLearningPromptContext = () => {
    const prefs = getTopPreferences();
    if (prefs.total === 0) return '';
    const roles = prefs.roles.map(r => r.label).join(', ');
    const industries = prefs.industries.map(i => i.label).join(', ');
    const skills = prefs.skills.map(s => s.label).join(', ');
    return `\n\nLEARNED PREFERENCES (from user's past apply/save actions):
- Preferred role types: ${roles || 'none yet'}
- Preferred industries: ${industries || 'none yet'}
- Preferred skills: ${skills || 'none yet'}
Boost matches in these areas. Total interactions recorded: ${prefs.total}.`;
  };

  // ---- Stats ----
  const getStats = () => {
    const apps = getApplications();
    return {
      applied:  apps.filter(a => a.status === 'applied').length,
      saved:    apps.filter(a => a.status === 'saved').length,
      pending:  apps.filter(a => ['applied','interview'].includes(a.status)).length,
      interview:apps.filter(a => a.status === 'interview').length,
      offer:    apps.filter(a => a.status === 'offer').length,
    };
  };

  return {
    getApiKey, setApiKey,
    getJobs, setJobs, getLastSearch,
    getApplications, saveApplication, updateApplicationStatus, removeApplication,
    getPrefs, setPrefs,
    getResume, setResume, clearResume,
    getLearning, recordInteraction, getTopPreferences, getLearningPromptContext,
    getStats,
  };
})();

window.Store = Store;
