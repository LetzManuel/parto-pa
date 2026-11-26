# Parto PA

Personal assistant app of the Parto private line: one person, and **nothing slips**. Concept: "Parto PA – Konzept & Plan v2" (22 Nov 2026).

This is the **Phase 1 pilot (no AI)**: memos become orders through fixed templates, PA follows up, keeps deadlines and
recurring appointments in view, and remembers what the user confirms. Pilot providers: beauty and trades.

## Develop

```bash
npm ci
npx tsc -b          # type check
npm run lint
npm test            # unit tests, including RLS checks of the cloud schema in PGlite
npm run dev         # browser preview at http://localhost:5173 (data in localStorage)
```

Preview tricks: `?heute=2026-11-22` pins the date, `?tab=me` opens a tab, "Ich › Beispieldaten laden" fills demo data.

## Layout

```
src/core/        logic without UI, unit-tested
  time/          dates, working days with Austrian holidays
  orders/        order states: open → waiting → done/cancelled, follow-up, recurring, plan B
  templates/     on-device memo → order templates (German date phrases, no AI)
  briefing/      morning briefing, "Wartet auf dich", max. 3 active hints a day
  deadlines/     Pickerl, passport, warranty, notice periods (Austrian defaults)
  memory/        "Was PA über mich weiß", health entries flagged and never shared with AI
  providers/     call cheat sheet, mailto/tel/booking links (PA never sends or calls itself)
  calendar/      free windows (times only, never other appointments' content)
  db/            local SQLite schema (sql.js) and Store
src/ui/          React screens: Heute, Kalender, + (Memo), Aufträge/Fristen, Ich
supabase/        cloud schema draft: personal space (group kind 'personal'), is_group_member, has_app, RLS
```

## Rules that always hold

- Nothing is booked, paid, sent or cancelled without a tap. PA prepares, the user acts.
- Phase 1 has no AI. Morning briefing is built from local data and never counts toward the assistant quota.
- Memory and memos stay in the personal space (RLS), never in a family group.

## Not in this slice yet

Cloud sync and sign-in (Parto ID), phone app shell (Tauri, as in Parto Projects), calendar import (ICS/Google/Outlook),
on-device dictation, geofence for place reminders, push notifications, confirmation by calendar match and share sheet (Phase 2).
