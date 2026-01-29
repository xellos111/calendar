# Repository Guidelines
This repo is a vanilla single-page generator for Chuseok closure schedules. Keep dependencies at zero so the app ships from any static host.

## Project Structure & Module Organization
- `index.html` bundles markup, styles, and scripts; place UI constants near `CFG` and group DOM queries at the top for quick scans.
- `chuseok.jpg` is the default 768×1077 background; replacements must keep the same aspect ratio to avoid distortion.
- `data/logs/` stores newline-delimited JSON created by the metrics API; do not commit raw logs unless anonymized samples are necessary.

## Build & Local Servers
- `python -m http.server 5173` from the repo root serves the static app with proper file URLs for PNG export.
- `node server/server.js` (or `npm run start:api`) launches the metrics API on port 5174; reverse-proxy `/api/` to it when deploying.
- `npx serve .` is an optional fallback. Opening `index.html` directly works for layout checks but PNG export will warn you.

## Coding Style & Naming
- HTML/CSS use two-space indentation with lowercase, hyphenated selectors (e.g., `.thumb`, `.grid-3`).
- JavaScript sticks to `const`/`let`, camelCase identifiers, and top-level maps (`posMap`, `offsets`) for shared state.
- Run `npx prettier@latest index.html --write` before committing; we rely on Prettier defaults rather than a checked-in config.

## Testing Guidelines
- Browser smoke test at `http://localhost:5173`: toggle every checkbox, drag a tile, and confirm arrow keys move 1px (or 5px with Shift).
- Export PNG after toggling multiple days; ensure filenames follow `추석휴무안내_<days>.png` and the background loads when `chuseok.jpg` is present.
- For regressions, grab a fresh screenshot and keep typography/colors consistent with the latest design spec.

## Metrics & Reporting
- `index.html` triggers `/api/visit` on load and `/api/download` after a successful export; the API stores events in `data/logs/visits.ndjson` and `data/logs/downloads.ndjson` as NDJSON.
- Each browser keeps a persistent `sessionId` in `localStorage`; stats now expose `uniqueSessions`, `uniqueDownloadIps`, and `uniqueDownloadSessions` to show who actually exported files. Top 10 date combinations are listed, and `otherDownloads` enumerates the remaining combos.
- Set `METRICS_TZ=Asia/Seoul` (default) when running `server/server.js` to control how daily buckets are assigned. Change the env var if you need another time zone.
- Fetch per-day stats with `curl 'http://localhost:5174/api/stats?date=2025-10-01'`, `node scripts/daily-report.js --date=2025-10-01`, or open `metrics.html` in a browser for an interactive view. Pass `scope=overall` (예: `curl 'http://localhost:5174/api/stats?scope=overall'`) to retrieve cumulative totals alongside the daily view.
- Run `npm run report:overall` to print the cumulative JSON summary from the CLI.
- Logs may contain IPs; scrub or hash before sharing outside the team.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) so history stays searchable; separate DOM tweaks, canvas logic, and API changes.
- Pull requests should summarize the change, list browsers/devices tested, attach updated canvas screenshots, and mention localization impacts when relevant.
- Reference issue IDs in titles (`feat: add visit logging [#42]`) to streamline release notes and deployment tracking.
