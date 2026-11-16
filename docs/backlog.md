# Backlog

Open items, next first. Remove an item when it's done (log it in `changelogs/`).

Build plan (agreed 16 Nov 2026): M0 scaffold ✅ → M1 first usable cut ✅ → M2 game layer + History ✅ → M3 polish ✅ (bar the real-phone pass) →
**M4 ship**. Shipping held until the app is complete (16 Nov).

- **Click-through test locally** (`npm run demo` for a populated copy, `npm start` for a clean one,
  phone-width browser): ticks, number pad, weigh-in, History (chart hover), Settings. API/stats are covered by
  tests; the UI was screenshot-checked headless (light + dark, 360–390 px), not clicked through.
- **Real-phone pass** (on the LAN, before or right after M4): tap targets, number pad, Add to Home Screen (iOS goes
  full-screen over HTTP; Android Chrome may only make a browser shortcut without HTTPS), maybe swipe between weeks.
- **M4: ship** (each step approved first): public GitHub repo + GHCR Action on `v*` tags → `v0.1.0`; deploy with a
  pinned tag; uptime check on `/health`. Deployment specifics live in the local-only notes, not in this repo.
- Confirm tickweek.com / tickweek.app availability (registrar search) if a domain is ever wanted.
