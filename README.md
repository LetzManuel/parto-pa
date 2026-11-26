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
  messages/      dictated messages: standard templates (Sie/du), clean-up of spoken text, voice commands,
                 mailto / sms: / wa.me links. Public API in messages/index.ts, reused by other features
  calendar/      free windows (times only, never other appointments' content)
  rhythms/       personal rhythms (Friseur ~5 Wochen, Anna ~3 Wochen): learned from history or said, suggestion engine
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
geofence for place reminders, push notifications, confirmation by calendar match and share sheet (Phase 2).

## Voice and messages

The middle tab is the microphone: opening it starts listening (Web Speech API, de-AT, `src/platform/speech.ts`).
"Schreib Studio Nails per WhatsApp, dass ich morgen später komme" becomes a message: PA picks recipient, template and
channel by keywords, reads the draft aloud and listens for "senden", "vorlesen", "ergänze …", "per SMS",
"Vorlage Absage", "per du" or "abbrechen". Anything else becomes a memo as before ("Speichern?" → "ja").
Sending hands the finished text to the mail app (mailto), SMS app (sms:) or WhatsApp (wa.me); the user taps Senden
there. No AI: templates only frame the dictated text. Other features listen for sent messages with `onMessageSent`.

Browser support: Chrome/Edge and Safari (iOS needs Siri & Dictation on). Chrome's recogniser runs on Google servers,
Safari's on Apple's; PA stores no audio. Without speech support the keyboard's own dictation key works in every field.

## Rhythms and suggestions

`src/core/rhythms/`: PA learns how often things happen and proposes the next step. No AI, all on the device.

- **History** (`history.ts`): logged touches ("Hab gestern mit Anna telefoniert", a tap on a suggestion, a sent message,
  a fixed booking), calendar titles (own + subscribed: "Friseur", "Kaffee mit Lisa", "Anna anrufen") and a provider's
  "zuletzt dort". Health appointments never count. **Not read:** the phone's call log, SMS/WhatsApp chats, e-mail.
- **Learning** (`learn.ts`): ≥ 3 times in the last year, regular gaps (median, ≤ 35 % spread), still alive → a proposal
  "Lisa etwa alle 2 Wochen? Ja, merken / Nein". Nothing is used before the user confirms; a "Nein" sticks.
- **Saying it** (`say.ts`): "Friseur alle 5 Wochen", "Mit Anna alle 3 Wochen telefonieren", "Ben jeden Monat schreiben",
  "Friseur lieber alle 6 Wochen", "Anna hat sich gemeldet", "Anna pausieren". Shown as one confirm line.
- **Suggestions** (`engine.ts`): one card on "Heute" ("Friseurtermin buchen?" a week ahead, "Anna anrufen?" when due),
  one tap or one spoken word (ja / später / nein). It counts as one of the three daily hints.
- **Hand-offs** (`src/ui/handoffs.ts`): `registerHandoff('book' | 'contact', handler)`. Defaults: provider sheet,
  `tel:` / `sms:`. Other modules report back with `logTouch(store, …)` from `rhythms/touch.ts`.

## Cloud and sync

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (in `.env.local`, not committed) to sign in with an e-mail code
(Ich › Konto & Sync). Without them the app stays device-only. The Supabase auth mail "Magic Link" template must contain
`{{ .Token }}` so the mail carries the 6-digit code.

Sync (`src/core/sync/engine.ts`): rows changed on the device are pushed, rows the cloud stamped since the last pull
(`synced_at`) are pulled; the newer `updated_at` wins on both sides (`pa_keep_newer` trigger, migration 0002).
On first sign-in the device's rows move into the person's personal space (`ensure_personal_space`).
