# Backlog

Open items, next first. Remove an item when it's done (log it in `changelogs/`).

Build plan (agreed 16 Nov 2026): M0 scaffold ✅ → M1 first usable cut ✅ → M2 game layer + History ✅ → M3 polish ✅ → M4 ship ✅ (v0.3.0 deployed
on the home server, 16 Nov).

- **Click-through test locally** (`npm run demo` for a populated copy, `npm start` for a clean one,
  phone-width browser): ticks, number pad, weigh-in, History (chart hover), Settings. API/stats are covered by
  tests; the UI was screenshot-checked headless (light + dark, 360–390 px), not clicked through.
- **Real-phone pass** (on the LAN, before or right after M4): tap targets, number pad, Add to Home Screen (iOS goes
  full-screen over HTTP; Android Chrome may only make a browser shortcut without HTTPS), maybe swipe between weeks.
- **Monday check**: first weekly backup run includes the app's data folder and the container comes back up.
- **Parked (16 Nov): per-week goals.** Ideas: edit goals on the week itself (carry forward from the previous week),
  fix a past week's goals in corrections mode, or a one-off week. Today Settings changes apply from this week on and
  past weeks keep theirs. Revisit only if that proves limiting.
- Confirm tickweek.com / tickweek.app availability (registrar search) if a domain is ever wanted.
