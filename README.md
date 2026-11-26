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
  shopping/      groceries and food: spoken orders, baskets with a rhythm, hand-over to the platform
  calendar/      free windows (times only, never other appointments' content)
  calendar/      ICS feeds, free windows, upcomingTimed (next appointments with place, shared by all features)
  travel/        travel preferences (Auto/Öffis/zu Fuß/Rad), voice sentences for them, estimates, navigation links
  reminders/     appointment reminders and leave-by times (route + buffer), what is due now
  rhythms/       personal rhythms (Friseur ~5 Wochen, Anna ~3 Wochen): learned from history or said, suggestion engine
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

## Einkauf & Essen bestellen

Say „Bestell bei gurkerl 2 Liter Milch, 6 Eier und Brot“, „Jeden Freitag Wocheneinkauf bei gurkerl: …“,
„Bestell Pizza Margherita bei Lieferando“ or „Bestell das Übliche“. PA builds the basket on the device (no AI), reads it
back and asks once. „Ja“ copies the list and opens the platform (saved favourite shop/restaurant or start page); the user
orders and pays there and taps „Bestellt“. Recurring baskets show up on Heute a day before their date (semi-automatic).
Spoken edits on an open basket: „noch Butter dazu“, „ohne Eier“, „diesmal nicht“, „bestellt“.

Platforms (status 26 Nov 2026, `src/core/shopping/platforms.ts`): gurkerl, foodora (also BILLA, MPREIS Innsbruck),
Lieferando, Wolt, Alfies. SPAR/INTERSPAR and HOFER no longer deliver groceries, BILLA's own delivery ended in Jan 2026.
None of them has a public customer ordering API (Lieferando, foodora and Wolt only offer merchant/courier APIs).
gurkerl runs an official MCP server (`https://mcp.gurkerl.at/mcp`, OAuth with the user's gurkerl account) with search and
cart, so PA can later fill the gurkerl cart directly; the order is still sent in gurkerl. PA never orders or pays itself.
## Appointment reminders and leave-by times

PA reminds of every timed appointment (own and subscribed calendars). With a place it works out when to leave:
route time for the person's mode (usual, per day or per appointment) plus buffer, a heads-up before and "Jetzt los"
with one action (navigation). Without a place, a reminder a few minutes ahead; with a meeting link, "Beitreten".
The trip starts at the appointment right before, else where the phone is (if allowed), else the home address.

Routes: cloud function `travel-time` asks the Google Routes API (live traffic, Wiener Linien/ÖBB). It needs the function
secret `GOOGLE_MAPS_API_KEY` (Google Cloud project with "Routes API" enabled, key restricted to that API). Without the key,
without sign-in or offline, PA geocodes with OpenStreetMap and estimates from the distance (shown as "geschätzt").
Settings live on the device (Ich › Wege & Erinnerungen) and can be said in a memo: „Heute bin ich mit dem Auto unterwegs“.

Web version: notifications show while PA is open or in the background. Lock-screen reminders with PA closed need the
phone shell's local notifications (or web push) and plug into `src/platform/notify.ts`.

## Integration: one mic, Meine Anbieter, hand-offs, gurkerl cart

- **One mic** (`src/core/intent/route.ts`): every spoken or typed sentence goes to exactly one feature, in this order:
  Meine Anbieter commands → Wege → Nachricht → Einkauf & Essen → Rhythmus → Bei Anbietern prüfen → Memo. Each route ends
  in one confirm (spoken „ja“ or one tap). Reminders („Erinner mich …“, „Wenn … dann …“) always stay memos.
- **Meine Anbieter** (`src/core/anbieter/`, `src/ui/Anbieter.tsx`): lists Lebensmittel, Essen bestellen, Friseur,
  Kosmetik & Nägel, Ärzte (per field), Restaurant, Tickets, Babysitter, each in the person's own order (drag handle,
  arrows, or voice: „gurkerl zuerst“, „Haarwerk auf Platz 2“, „Neuer Friseur Salon Lisa 01 234 56 78“, „Barber Joe löschen“).
  Stored in the `favourite` table: shop entries have `system = 'shop'` and the platform id in `system_ref`; own keywords
  per list are rows with `system = 'keyword'` („Stichwort Spitzen für Friseur“). No new table or column. Keywords and
  names steer the router and are passed to the recogniser as hints where Chrome supports it.
- **Hand-offs** (`src/ui/wiring.ts`, `src/ui/flows.tsx`): rhythm „Friseurtermin buchen?“ → check on Meine Anbieter;
  rhythm „Ben schreiben?“ → message composer; sent messages count for rhythms; babysitter/doctor requests → message
  templates with read-back; booked slots → `core/calendar/appointments.ts` (event + rhythm paused until then);
  regular orders of the same basket → proposal for a recurring basket (`core/shopping/rhythm.ts`).
- **gurkerl cart** (`core/shopping/gurkerl.ts`, `platform/gurkerl.ts`): optional, off by default. One sign-in with the
  person's gurkerl account (OAuth/PKCE against gurkerl's official MCP server); then „gurkerl öffnen“ also puts the items
  into the gurkerl cart. PA never checks out. Tokens stay on the device. Browser fallback: function `mcp-relay`.

Local migrations after the merge: v3 shopping, v4 favourites, v5 event location, v6 rhythms. Cloud: 0004 favourite,
0005 event location (both applied), 0006 shopping and 0007 rhythms (to run).
