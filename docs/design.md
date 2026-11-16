# Tickweek: design

Agreed 16 Nov 2026 in a design interview. This is the v1 spec.

## What it is

A personal health tracker that gamifies daily diet/exercise targets and a weekly weigh-in. It replaces a printed Excel
grid: Mon–Sun columns, one row per week (labelled with the week's Monday date, e.g. 16/10), a tick per target per day,
and the weight written next to the date on Mondays.

## Platform and hosting

| Decision | Choice | Why |
|---|---|---|
| Platform | Docker container with a web UI, on a home server | Lives alongside the other self-hosted services |
| Access | LAN + VPN only, **no port forward** | No new attack surface |
| Transport | Plain HTTP for now | Ticking needs the server anyway; HTTPS (reverse proxy in front) can be added later without a rewrite. Means no service worker: a home-screen icon that opens full-screen, online only |
| Users | Single user, no login | LAN/VPN only; a login adds friction for nothing |
| Stack | Node + Express, SQLite (`better-sqlite3`), plain HTML/JS/CSS frontend, no build step | JS throughout; one small container, easy to hack on |
| Data | One SQLite file in the `/data` volume | Backed up with the host's container data; the app checkpoints the WAL on stop, so a stopped-container copy is consistent |
| Repo | Public GitHub repo | Code only: no personal data and no details of the host network; no registry token needed to pull |
| Image | GitHub Action builds to GHCR on a version tag (`v0.1.0`, …) | Repeatable, versioned, roll back by changing the tag |
| Deploy | Container pulls a **pinned tag**, bumped by hand. Never `:latest` | Updates happen deliberately, with an easy rollback |
| Monitoring | `/health` endpoint (also the Docker healthcheck) | Plugs into whatever uptime monitor is in use |

Defaults: weeks start Monday, dates shown dd/mm, timezone Europe/London (`TZ` env on the container).

## Targets

- **Configurable**: add, rename, reorder, retire. Starting set: intermittent fast, no snacks, exercise (likely split
  into e.g. running and weight training).
- **Two kinds**:
  - **Tick**: done / not done.
  - **Number**: a value with a unit (e.g. weight training in minutes, running in miles). **Any value > 0 counts as
    done.** Values are kept, so weekly/all-time totals come for free.
- **Days-per-week goal** per target (N/7, default 7), e.g. fast 7/7, no snacks 7/7, running 3/7, weights 2/7. Which
  days doesn't matter.
- **Changes apply from the current week on.** Each week keeps a snapshot of the targets and goals it had, so past scores
  never shift. Retiring a target archives it: its history and records stay.

## Weight

- **Strictly weekly, on Monday.** The point is that Monday's scales judge the weekend.
- A forgotten weigh-in can still be entered later that week. It counts as that week's weigh-in, flagged **late**.
- A week with **no** weigh-in breaks the losing streak.
- Shown as **stone/lb** (e.g. 14 st 3.4 lb), stored in **kg** (so a display switch is possible later).
- **Goal weight** with a progress bar ("1 st 2 lb to go").

## Game layer (core set only: no XP, no badges)

| Term | Rule |
|---|---|
| **Week score %** | Σ min(days done, goal) ÷ Σ goals, over that week's targets. Going over a goal doesn't add points |
| **Clean sweep** 🏆 | Every target reached its N/7 goal that week |
| **Star day** ★ | Every 7/7 target ticked on that day (was "full day") |
| **Target streak** | 7/7 targets: consecutive days done. N/7 targets: consecutive weeks where the goal was met |
| **Losing streak** | Consecutive weekly weigh-ins, each lower than the one before. Same weight = neither extends nor breaks it; a missing week breaks it |
| **Personal best** | Lowest weigh-in so far |

The current week's score and streaks are "in progress" until the week closes.

## Screens

1. **This week** (main screen, phone-first): rows = targets, columns = Mon–Sun, big tap cells, today highlighted.
   Tick targets toggle on tap; number targets open a number pad (clear = 0 = not done). Shows the week score, the
   N/7 progress per target, the weigh-in box on Monday, and the active streaks.
   Order: the table first (with a Star day row at the bottom), then the week score, then the weigh-in.
2. **History** (weight first): current weight, change since the first weigh-in and progress to goal, above the
   weight chart. Then **one month at a time** (‹ month › switcher): a one-line month summary (weight change, score,
   star days) and that month's weeks in the paper layout: one row per week (Monday date, weigh-in in bold + change),
   each day's cell showing a mini dot per target (ringed = star day), the week score and a 🏆 for a clean sweep; tap a
   week to open it. Then a **year summary** (per month: weight at month end, change, average score). Records and
   per-target streaks/totals below. *(Revised 16 Nov 2026: month switcher instead of one long list of weeks.)*
3. **Settings**: targets (add/edit/reorder/retire, kind, unit, N/7), goal weight, and the corrections switch.

## Edit window

- **This week**: editable up to today. No future ticks.
- **Last week**: stays editable until this week's weigh-in is entered (room to back-fill a forgotten Sunday).
- **Older weeks**: locked. A settings switch ("corrections mode") unlocks them for genuine fixes.

## Out of scope for v1

- Importing the paper history (starting fresh from launch week).
- Reminders/notifications (none; open it when you remember).
- HTTPS / offline PWA, multiple users, login, XP, badges.

## Data model (sketch)

| Table | Columns (main) |
|---|---|
| `target` | id, name, kind (`tick`/`number`), unit, sort_order, archived_at |
| `week` | monday_date (PK), closed_at |
| `week_target` | monday_date, target_id, goal_days, sort_order (the per-week snapshot) |
| `entry` | date, target_id, value (1 for a tick; the number for number targets), updated_at |
| `weigh_in` | monday_date (PK), kg, entered_on, late (bool) |
| `setting` | key, value (goal_kg, corrections_mode, …) |

Scores, streaks and records are computed from these, not stored.
