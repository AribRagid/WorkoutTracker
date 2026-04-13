# Gym Tracker (Vanilla HTML/CSS/JS)

A mobile-first, iPhone-friendly workout tracker web app with local persistence and offline-ready PWA files.

## Features

- Home screen with `List`, `History`, and `Log`
- Exercises include:
  - `id`, `name`, `type`, `sets`, `reps`, `weight`, `perCycle`
- Exercise type grouping on List and Log pages:
  - Legs, Arms, Torso, Other
- Add + Edit exercise support (including type dropdown)
- Cycle length setting in days
- Per-cycle limit enforcement for each exercise
- Auto cycle rollover when a new cycle starts
- Log entries store:
  - `id`, `exerciseId`, `date`, `reps`, `weight`, `sets`
- History week navigation (Mon-Sun) with selected-day logs
- History order is oldest to newest for each day
- IndexedDB persistence (localStorage fallback)
- Smooth SPA-style view switching (no page reload)
- PWA support via `manifest.json` + `service-worker.js`
- GitHub Pages friendly (`.nojekyll` included)

## File Structure

- `index.html`
- `style.css`
- `script.js`
- `manifest.json`
- `service-worker.js`
- `.nojekyll`
- `icons/`
- `README.md`

## Local Testing

1. Open `index.html` directly in a browser.
2. Use the app immediately; all data is saved locally in your browser.

Note: service worker registration requires HTTPS or localhost, so opening via `file://` skips SW registration. The app logic still works locally; full offline PWA caching works on GitHub Pages after first load.

## GitHub Pages

1. Push this folder to a GitHub repository.
2. Enable GitHub Pages on the repo root.
3. Open your Pages URL once online to populate cache.
4. Add to iPhone Home Screen from Safari.
