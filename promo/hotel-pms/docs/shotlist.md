# Hotel PMS: shot list
62 s · 92 bpm · 96 beats · format: 16x9 (primary)
Music: soft synthesized lo-fi bed, F major, ducked under the voice · VO: `audio/script.json`, female voice `en-PH-RosaNeural` (Philippine English), one clip per line, each line's first word placed on a beat.

Look: deep indigo ink background (`#14102e`), white type, one accent (violet `#7c5cff`). Display face Plus Jakarta Sans ExtraBold, UI face Inter. Every screen is a real capture of the app (`assets/shots/`); nothing is drawn as a fake screen. The hotel's side is shown on a **desktop** screen; **the guest's side is shown on a phone** (a drawn phone showing the real mobile screens of the guest portal).

## Narration (≈115 words, ≈53 s of speech)

| Line | Starts (beat · s) | Text |
|---|---|---|
| v1 | 1 · 0.65 | Meet Hotel PMS. The simple way to run your hotel, and delight every guest. |
| v2 | 11 · 7.18 | Start each day with a clear picture: occupancy, arrivals, departures, and everything waiting for a reply. |
| v3 | 24 · 15.65 | See every room on one calendar. Pick the dates, and only the rooms that are truly free appear, priced in pesos. |
| v4 | 37 · 24.13 | Your guests get their own app, right on their phone. They sign up in a moment. |
| v5 | 47 · 30.65 | They pick their dates, see what's available, and reserve. Every request waits for your approval. |
| v6 | 58 · 37.83 | They can order extras, like airport pickup or breakfast, and ask you anything. |
| v7 | 67 · 43.70 | You confirm the booking, reply, and approve the service. The guest sees it instantly, and extras join their bill. |
| v8 | 81 · 52.83 | Hotel PMS. One system for your hotel. One app for your guests. |

(Spoken as "P M S" so the voice says the letters.)

## Shots

| # | beats | time | shot | on screen (asset) | motion | out (what carries) | sound |
|---|-------|------|------|-------------------|--------|--------------------|-------|
| 1 | 0-4 | 0.00-2.61 | **Hook**: headline "Run your hotel." then "Delight every guest." | type only, left-aligned | words spring up per glyph, bouncy; the phone-shaped violet block is already on the right edge | violet block grows into the dashboard card | impact @0, pop @1, pop @2 |
| 2 | 4-11 | 2.61-7.18 | Dark dashboard rises, slow push | `m11_dashboard_dark.png` | card springs up from below with squash-settle, 6% push in | card slides left and lightens (dark to light) into shot 3 | whoosh @4, thud @5 |
| 3 | 11-19 | 7.18-12.39 | **Day at a glance**: dashboard, camera visits occupancy ring, arrivals/departures, then the "things need your attention" banner | `m01_dashboard.png` crops (stats row, banner) | camera springs between 3 focal points (u13, u15, u19); callout chips "Occupancy tonight", "Arrivals", "Needs your reply" pop in with the narration | camera drops to the forecast | tick @13, tick @15, pop @19 |
| 4 | 19-24 | 12.39-15.65 | 7-night forecast bars grow | `m10_dashboard_after.png` forecast crop | bars rise in sequence (stagger 0.15 beat), counter "32%" | whip left: dashboard slides out as calendar slides in | whoosh @23.5 |
| 5 | 24-30 | 15.65-19.57 | **Calendar**: every room, two weeks, booking bars | `m02_calendar.png` | pan across rows, bars slide in staggered by room; "Pending" bar pulses once | zoom into the empty cells | whoosh @24, tick @27 |
| 6 | 30-37 | 19.57-24.13 | **New booking**: dialog shows only free rooms, price in pesos | `m04_new_booking.png` | dialog springs open over the calendar; camera pushes to the room list; label "Only free rooms" and "₱ priced in pesos" typed in the UI face | the dialog flies off to the left, phone rises from the bottom | pop @31, pop @33, whoosh @36.5 |
| 7 | 37-43 | 24.13-28.05 | **Guest on a phone**: sign-up | phone frame (drawn) with `g01_register_empty.png` then `g02_register_filled.png` | phone springs up and tilts level; empty form dissolves to filled form; tap ripple on "Create account" | page pushes left inside the phone (like the app) | thud @37, tick @41 |
| 8 | 43-47 | 28.05-30.65 | Browse rooms | `g03_stay_browse_full.png` scrolling inside the phone | slow scroll through the room-kind cards | stays in the phone | tick @44 |
| 9 | 47-53 | 30.65-34.57 | **Search and reserve**: dates, results with totals | `g04_stay_dates.png` → `g05_stay_results_full.png` scroll, tap "Search rooms", tap "Reserve" | tap ripples; results scroll to the Deluxe card; callout "₱14,250 for 3 nights" taken from the screen | reserve dialog slides up over the results | tick @48, tick @51, pop @52 |
| 10 | 53-58 | 34.57-37.83 | Reservation request sent | `g06_reserve_dialog.png` → `g07_trips_pending.png` | dialog sheet rises, then the booking card appears "Pending: waiting for the hotel to confirm"; amber badge pulses | the caption "Waits for your approval" slides in | pop @55, bell @57 |
| 11 | 58-64 | 37.83-41.74 | **Extras**: services list, request airport pickup | `g08_services_full.png` scroll, `g09_service_dialog.png`, `g10_services_requested.png` | scroll to Airport pickup, tap Request, dialog, then status "Requested" appears in the list | phone slides left | tick @59, pop @62 |
| 12 | 64-67 | 41.74-43.70 | **Ask anything**: new inquiry | `g11_inquiry_dialog.png` → `g12_messages_waiting.png` | dialog then the message card "Waiting for a reply" | whip: phone slides to the right half, desktop enters from the left | pop @65, whoosh @66.5 |
| 13 | 67-74 | 43.70-48.27 | **Split screen**: the hotel confirms the booking while the phone updates | left: `m03_bookings_pending.png` zoom on the pending row; right: phone `g07_trips_pending.png` → `g13_trips_confirmed.png` | tap "Confirm" ripple on desktop; a pulse travels from the desktop to the phone; phone card flips Pending → Confirmed with a room number | camera pushes to the reply dialog | tick @69, whoosh @70, pop @71 |
| 14 | 74-81 | 48.27-52.83 | **Reply and approve** | left: `m05_reply_dialog.png` → `m08_service_requests.png`; right: phone `g14_messages_reply.png` → `g15_services_confirmed.png` | desktop reply dialog sends, phone shows the green reply box; then service row turns Confirmed, phone shows "Confirmed"; caption "Added to the bill" | everything shrinks to the end-card mark | pop @75, pop @78, bell @80 |
| 15 | 81-95 | 52.83-61.96 | **End card**: mark, name, line | brand mark drawn from the app's logo (bed icon in a violet tile) + "Hotel PMS" + "One system for your hotel. One app for your guests." | tile springs in, name builds per glyph, line fades up; holds 3 s after the last word | none | impact @81, bell @82, soft tail |

Longest gap without a new event: beats 14-19 in shot 3 has a camera move every 2 beats, so the longest is 2.6 s.

## Formats
- 16x9 only (as agreed). A vertical 9:16 version of the guest half would fit naturally later: the phone is already a vertical screen.

## What I need from you
1. OK on the **narration text** (it is sent to Microsoft's speech service to be spoken).
2. OK on showing the guest as a **phone animation** (shots 7-12, and the right half of 13-14) while the hotel stays on desktop.
3. Anything to change, add or cut in the shot list.
