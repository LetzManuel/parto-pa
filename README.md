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

## Favourites check ("Friseur morgen 14 bis 17 Uhr")

Say or type a request (big mic on *Heute*, home-screen shortcut *Finden* = `?finden=1`, or "+" memo). PA parses it on the
device (`src/core/favourites/request.ts`), checks the favourites of that list in order (up to 3 each: Friseur & Beauty,
Restaurant, Tickets, Ärzte per field, Babysitter), stops at the first free slot, reads the result aloud and offers one
button to finish in the other app. PA never books, buys or sends.

Adapters (`src/core/favourites/adapters.ts`): resmio (restaurants), Salonized (salons), Ticketmaster Discovery
(needs `VITE_TICKETMASTER_KEY`), `demo`. Everything else (Treatwell, Shore, Fresha, Planity, Timify, OpenTable, TheFork,
Quandoo, oeticket/Eventim, Doctolib, Latido, DocFinder, private babysitters) gets the handoff: booking page, call,
WhatsApp/SMS with a prepared text, "Anruf einplanen" or "Angefragt, warte". In the browser, blocked requests go through
the function `slot-relay` (signed in only, fixed hosts). Cloud table: `supabase/migrations/0004_pa_favourite.sql`.

## Rules that always hold

- Nothing is booked, paid, sent or cancelled without a tap. PA prepares, the user acts.
- Phase 1 has no AI. Morning briefing is built from local data and never counts toward the assistant quota.
- Memory and memos stay in the personal space (RLS), never in a family group.

## Not in this slice yet

Cloud sync and sign-in (Parto ID), phone app shell (Tauri, as in Parto Projects), calendar import (ICS/Google/Outlook),
on-device dictation, geofence for place reminders, push notifications, confirmation by calendar match and share sheet (Phase 2).

## Cloud and sync

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (in `.env.local`, not committed) to sign in with an e-mail code
(Ich › Konto & Sync). Without them the app stays device-only. The Supabase auth mail "Magic Link" template must contain
`{{ .Token }}` so the mail carries the 6-digit code.

Sync (`src/core/sync/engine.ts`): rows changed on the device are pushed, rows the cloud stamped since the last pull
(`synced_at`) are pulled; the newer `updated_at` wins on both sides (`pa_keep_newer` trigger, migration 0002).
On first sign-in the device's rows move into the person's personal space (`ensure_personal_space`).
