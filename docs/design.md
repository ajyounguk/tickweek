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
| Monitoring | `/health` endpoint (also the Docker healthcheck; returns the app version, shown at the foot of How it works) | Plugs into whatever uptime monitor is in use |

Defaults: weeks start Monday, dates shown dd/mm, timezone Europe/London (`TZ` env on the container).

## Targets

- **Configurable**: add, rename, reorder, retire. Starting set: intermittent fast 7/7, no snacks 7/7, and Exercise 4/7
  combined from running (miles) and weight training (minutes).
- **Three kinds**:
  - **Tick**: done / not done.
  - **Number**: a value with a unit (e.g. weight training in minutes, running in miles). **Any value > 0 counts as
    done.** Values are kept, so weekly/all-time totals come for free.
  - **Combined** (19 Nov 2026): ticks itself from other targets, e.g. Exercise = Running + Weight training, 4/7. A day
    counts when any of its sources has an entry; a run and weights on the same day = 1 day (counting sessions was
    considered and dropped). Not tappable, no unit, no nesting. Its sources have **no goal** while they count towards
    it: still logged, not scored. Retiring it leaves them with no goal until one is set.
  - A target's kind is **fixed once created** (21 Nov 2026: a Tick ↔ Value switch was considered and dropped to keep
    it simple). To change it, retire the target and add a new one.
- **Days-per-week goal** per target (N/7, default 7), e.g. fast 7/7, no snacks 7/7, running 3/7, weights 2/7. Which
  days doesn't matter. A target can also have **no goal**: logged only, left out of scores, streaks and History dots.
- **Changes apply from the current week on.** Each week keeps a snapshot of the targets and goals it had, so past scores
  never shift. Retiring a target archives it: its history and records stay.
  A retired target can then be **deleted** for good (20 Nov 2026): its entries go from every week, so past scores
  can change; it asks first. Only retired targets can be deleted.

## Weight

- **Strictly weekly, on Monday.** The point is that Monday's scales judge the weekend.
- A forgotten weigh-in can still be entered later that week. It counts as that week's weigh-in, flagged **late**.
- A week with **no** weigh-in breaks the weight-loss streak.
- Shown and entered as **stone and whole lb** (e.g. 14 st 3 lb; whole lb since 20 Nov 2026, changes worked out from the rounded weights), stored in **kg** (so a display switch is possible later).
- **Goal weight** with a progress bar ("1 st 2 lb to go").

## Game layer (core set only: no XP, no badges)

| Term | Rule |
|---|---|
| **Week score %** | Σ min(days done, goal) ÷ Σ goals, over that week's targets with a goal. Going over a goal doesn't add points. Shown on History; This week shows a word instead |
| **Week word** | This week, on pace (done vs goal × finished days ÷ 7): Fresh week / Started (Monday), Catch-up time (< 85%), On track, Great (≥ 120%). Past weeks: Great week (≥ 80%), Good week (≥ 60%), Tough week. Perfect week 🏆 when every goal is met. The bar under it shows the score with no number; amber for Catch-up / Tough (20 Nov 2026) |
| **Perfect week** 🏆 | Every target reached its N/7 goal that week (was "clean sweep") |
| **Above and beyond** 🏆 | Every goal met *and* at least one target past its goal (20 Nov 2026). Replaces "Perfect week" as the week in a word, with "+N bonus days" under it (N = days past each goal, added up). History's 🏆 unchanged |
| **Star day** ★ | Every target with a goal done that day, N/7 and combined targets included (was: every 7/7 target; changed 20 Nov 2026). Shown as a ★ after the date in the day header |
| **Target streak** | 7/7 targets: consecutive days done. N/7 targets: consecutive weeks where the goal was met |
| **Weight-loss streak** | Consecutive weekly weigh-ins, each lower than the one before. Same weight = neither extends nor breaks it; a missing week breaks it |
| **Lowest weight** | Lowest weigh-in so far (all time) |

The current week's score and streaks are "in progress" until the week closes.

## Screens

1. **This week** (main screen, phone-first): rows = targets, columns = Mon–Sun, big tap cells, today highlighted.
   Tick targets toggle on tap; number targets open a number box with the phone keyboard (clear = 0 = not done). Shows the week in a word, the
   N/7 progress per target and the weigh-in box, then a compact **Streaks** card ("15 days in a row"); the full
   streak detail lives on History under Achievements.
   **Stars for met rows**: once a target reaches its goal for the week, every filled box in that row shows ★ instead
   of a tick (number boxes show a tick with the value small underneath, and ★ with the value once met); extra days past the goal go in as ★, and the row goes
   back to ticks if it drops below the goal. Only the tap that crosses the goal animates (a left-to-right cascade of
   ticks spinning into stars with a brief glow; back to ticks right-to-left without the glow; a crossfade under
   reduced motion). Page loads and past weeks show the stars statically. Same green box, no new colours. History
   month dots are unchanged.
   **Fill-up + Chain** (20 Nov 2026, picked from seven rendered tick styles): the box you tick fills with green from
   the bottom, then its tick pops in (only that box; page loads stay still). Done boxes on consecutive days are joined
   by a short green bar, so a run reads as one chain. Reduced motion: no fill or grow, just the end state.
   **Combined targets**: the combined target heads a group, at its own place in the order, with its sources indented
   under it, all in a lightly tinted panel (on This week and in Settings; prototyped as panel vs left rail, panel
   chosen 19 Nov 2026). The panel reaches into the card's padding, so the boxes keep their width and stay lined up
   with the day headers. It has no boxes (20 Nov 2026: its N/goal pill
   already says the progress): just its name, a "combined target" pill (styled like the N/goal pill) and its N/goal pill, heading the group;
   when it's met, its sources' filled boxes show ★ too. Sources show their weekly total and no N/goal pill. In
   Settings the group moves as one block (only the combined target has ↑↓).
   A target with no goal shows a muted "no goal" pill where the N/goal pill would be (sources in a group show none).
   The weigh-in card is kept bare (20 Nov 2026): "Weigh-in · dd/mm" with a small Edit, the weight and its change, then
   "to go" / goal weight over the progress bar. Weight-loss streak and lowest weight live in History's achievements.
   Order: the table first (star days marked ★ in the day headers), then the week score, the weigh-in, then Streaks.
2. **History** (weight first): current weight, change since the first weigh-in and progress to goal, above the
   weight chart. Then **one month at a time** (‹ month › switcher): a one-line month summary (weight change, score,
   star days) and that month's weeks in the paper layout: one row per week (Monday date, weigh-in in bold + change),
   each day's cell showing a mini dot per target (ringed = star day), the week score and a 🏆 for a perfect week; tap a
   week to open it. Then a **year summary** (per month: weight at month end, change, average score). An
   **Achievements** section (record tiles + each target's current/best streak and totals) below. *(Revised 16 Nov 2026: month switcher instead of one long list of weeks.)*
3. **How it works** (`/help`): five short sections (ticking, Monday weigh-in and why, scores and rewards,
   History, Settings). Linked from a ? in the This week header and a
   "New here?" notice until the first weigh-in.
4. **Settings**: targets (add/edit/reorder/retire, kind, unit, N/7), goal weight, the corrections switch, and
   **Export**: CSV (one row per day: date, weigh-in in kg and st/lb, a column per target) and JSON (everything,
   lossless). *(Added 16 Nov 2026.)*
   Order (20 Nov 2026): Goal weight, Targets (with "+ Add target" opening the form in place), Retired, Export,
   Corrections last. **One thing is edited at a time** (21 Nov 2026): a target being edited sits in a light green panel;
   while a target is edited or added, everything else on the page (other targets, Add target, Retired, Export, Corrections, Goal
   weight) fades back and can't be used until Save or Cancel. The edit box is headed by the target's name (following
   the Name field as it's typed) with a green pill beside it: Tick target, Value target or Combined target; a combined target's sources are
   picked under **"Made up of these targets:"**, one per line, ticked ones first. Kinds are named Tick, Value (a number with a unit) and Combined target; a **?** next to Kind opens a three-line explanation with an example each (hover tooltips don't work on phones).

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
| `target` | id, name, kind (`tick`/`number`/`combined`), unit, goal_days (NULL = no goal), sort_order, archived_at, part_of (its combined target) |
| `week` | monday_date (PK), closed_at |
| `week_target` | monday_date, target_id, goal_days, sort_order, part_of (the per-week snapshot) |
| `entry` | date, target_id, value (1 for a tick; the number for number targets; none for combined: derived), updated_at |
| `weigh_in` | monday_date (PK), kg, entered_on, late (bool) |
| `setting` | key, value (goal_kg, corrections_mode, …) |

One schema, created in one go on an empty database (`PRAGMA user_version` = 2). A database from another version is
refused with a message, never changed: start fresh (decided 19 Nov 2026: no data to keep, so no migrations).

Scores, streaks and records are computed from these, not stored.
