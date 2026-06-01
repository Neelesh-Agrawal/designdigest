# Designdigest — Ship69 Day 63

Live design inspiration feed powered by real RSS feeds + Groq AI. Pulls fresh content from 14 design sources every time you refresh.

## Sources
Awwwards, Design Milk, UX Collective, Smashing Magazine, Creative Bloq, Codrops, CSS-Tricks, Abduzeedo, A List Apart, Nielsen Norman Group, Product Hunt, Sidebar.io, Dribbble Jobs, Design Week Jobs

## How it works
1. Backend fetches RSS feeds from all 14 sources in parallel (via rss2json.com — free, no key needed)
2. Raw items sent to Groq (llama-3.3-70b-versatile) for categorisation, cleaning, and summarising
3. Frontend renders categorised feed — Inspiration, Tools, Articles, Jobs
4. Fallback: if Groq fails, raw RSS items are returned directly

## Stack
- Vanilla HTML/CSS/JS
- Vercel serverless function
- rss2json.com (free RSS-to-JSON API)
- Groq API (llama-3.3-70b-versatile)

## Deploy to Vercel
1. Push to GitHub
2. Import repo in Vercel
3. Add environment variable: `GROQ_API_KEY` = your key
4. Deploy — no other setup needed

## Environment variables
| Key | Value |
|-----|-------|
| `GROQ_API_KEY` | Your Groq API key |

## Project structure
```
designdigest/
├── index.html              # Main UI
├── api/
│   └── designdigest.js     # Serverless API — RSS fetch + Groq processing
├── vercel.json             # Routing config
├── .gitignore
└── README.md
```

## Load time
First load takes 8-15 seconds. RSS feeds are fetched in parallel so it's as fast as the slowest feed.
