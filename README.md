# InternRadar — Your Personal Internship OS

AI-powered internship finder for MS Business Analytics students at BU Questrom.
Runs on GitHub Pages — free, no backend, all data stored in your browser.

## Features

| Feature | Status |
|---------|--------|
| 🔍 AI job search with live web search | ✅ |
| 📄 Resume tailoring per job description | ✅ |
| 📊 Application tracker with status updates | ✅ |
| 🧠 Learning engine (learns from your choices) | ✅ |
| ✅ F1/CPT/OPT visa filter (always on) | ✅ |
| 🔗 LinkedIn connection checker | 🔜 Coming next |

## Setup (5 minutes)

### 1. Create your GitHub repo
1. Go to [github.com](https://github.com) → New repository
2. Name it `internradar` (or anything you like)
3. Set it to **Public**
4. Click "Create repository"

### 2. Upload files
Upload all files maintaining this exact structure:
```
internradar/
├── index.html
├── README.md
├── css/
│   └── app.css
├── js/
│   ├── storage.js
│   └── app.js
└── pages/
    ├── search.html
    ├── tracker.html
    ├── resume.html
    ├── profile.html
    └── settings.html
```

### 3. Enable GitHub Pages
1. Go to your repo → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: **main** / **(root)**
4. Click Save
5. Wait ~60 seconds → your app is live at `https://yourusername.github.io/internradar`

### 4. Add your API key
1. Open your live app URL
2. Go to **Settings** page
3. Paste your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com))
4. Click Save — it's stored only in your browser

### 5. Fill in your profile
1. Go to **My Profile**
2. Fill in your skills, courses, goals
3. This feeds into every search automatically

---

## Daily Workflow

1. Open your GitHub Pages URL each morning (bookmark it)
2. Go to **Job Search** → click **Search Now**
3. Review matches — click **✦ Tailor Resume** on any role you like
4. **Save** or **Apply** to roles (this trains the AI)
5. Track everything in **Application Tracker**

## How the Learning Engine Works

Every time you:
- **Save** a role → +1 weight for that role/industry/skills
- **Apply** to a role → +3 weight
- **Mark as rejected** → -2 weight

The AI uses these weights to boost or filter results in future searches.
After ~10 interactions, results become noticeably more personalized.

## How to Modify the App

Each file has a clear purpose:

| File | What to change |
|------|---------------|
| `js/storage.js` | Data schema, learning algorithm |
| `js/app.js` | Shared logic, Claude API prompts, job card HTML |
| `pages/search.html` | Search filters, search prompt, results display |
| `pages/resume.html` | Resume tailoring UI and prompt |
| `pages/tracker.html` | Application status columns/fields |
| `pages/settings.html` | Configuration options |
| `css/app.css` | All visual styling |

**To change the search prompt:** Edit the `prompt` variable inside `runSearch()` in `pages/search.html`

**To add a new filter:** Add an HTML input in `search.html` and include its value in the prompt string

**To add a new application status:** Add to `STATUS_LABELS` and `STATUS_CLASSES` in `tracker.html`

## Coming Next (LinkedIn Checker)
The LinkedIn connection checker will be added as a new panel on job cards.
Options being evaluated:
- Upload your LinkedIn connections CSV export (Settings → Data Privacy → Get a copy of your data)
- Manual company search

## API Cost Estimate

Each search uses ~2,000-4,000 tokens (with web search).
At Claude Sonnet rates: roughly $0.01–0.03 per search.
Running daily for 3 months ≈ $1–3 total.

---

Built with Claude AI · BU Questrom MSBA · Summer 2026
