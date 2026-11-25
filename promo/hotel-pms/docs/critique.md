# Critique log: Hotel PMS

## Round 1
| hook | read | motion | variety | brand | sync | min |
|  5   |  6   |   7    |    8    |   8   |  7   |  5  |

Looked at: contact_p1..3 (every beat), phone_p1..3, strips across the whip to the calendar, hotel to phone, desktop to split screen, and the end card; sync.py printout (41 of 58 hits within 20 ms of an onset, median 3.5 ms).

Worst three (most damaging first):
1. [beat 0-1, 16x9] Frame 0 is only the violet block; the first word of the headline arrives 0.4 beats later -> the first frames of the film say nothing, and the voice hasn't started either -> start "Meet" at beat -0.15 so it is already mid-rise on frame 0, and put an impact on beat 0.05 (EV.hookMeet, HITS).
2. [beat 24-37, 16x9] The dashboard window stays at the left edge behind the calendar captions ("Every room, one calendar." sits on top of UI) -> clutter exactly where the viewer must read -> push the calendar further away (GAP 1560 -> 2080 css px) so the dashboard is fully off screen when the whip lands, and make the left-column shade full strength as soon as the window is zoomed (z > 1.08).
3. [beat 81, 16x9] The frame on the end-card hit is blank: the phone has already shrunk away and the tile has not started -> the cut's first frame must show the new image -> the tile springs from beat 80.55 while the phone folds into the tile's centre.

Also fixed in the same pass: captions swapping on top of each other (each caption now finishes leaving before the next starts), the split-screen desktop spilling over the phone (clipped to its own frame), the banner zoom now fills the frame so its words are readable, the airport chip sits beside the phone instead of on it, the end card has the hotel's desktop and the guest's phone arriving with each half of the line, and the phone gets push-ins on the sign-up form, the dates and the airport pickup card (it was a small static phone for 12 beats).

Checks failed: hook frame 0 (fixed above); end-card cut frame (fixed above).
Verdict: ANOTHER ROUND

## Round 2
| hook | read | motion | variety | brand | sync | min |
|  6   |  7   |   7    |    8    |   8   |  7   |  6  |

Looked at: contact_p1..3 (every beat) and phone_p1..3 after the round 1 fixes; strips across the hook and the move into the end card.

Worst three (most damaging first):
1. [beat 0-2, 16x9] Frame 0 is now filled ("Mee" mid-rise) but the next 1.5 beats show only "Meet" and a still block -> a dead second at the start of the film while the voice is still waiting for its beat -> move the first voice line to beat 0.5 (build_vo.mjs), time the words to the voice (Hotel at 1.0, PMS at 1.8), and give the violet block a small squash on each word.
2. [beat 80-81, 16x9] The "+ Airport pickup" chip stays on screen, alone, while the phone folds into the end-card tile -> reads as a leftover -> draw the chip inside the phone's shrink transform so it leaves with it.
3. [beat 71, 16x9] The desktop's page change in the split screen is a 0.3-beat cross-dissolve that shows two screens of text on top of each other (reply dialog over the answered inquiry list) -> unreadable ghost -> shorten it to 0.2 beats.

Checks failed: dead time at the start (fixed above).
Verdict: ANOTHER ROUND

## Round 3
| hook | read | motion | variety | brand | sync | min |
|  8   |  8   |   8    |    8    |   8   |  8   |  8  |

Looked at: contact_p1..3 and phone_p1..3 (every beat), strips across the hook, the whip to the calendar, hotel to phone, desktop to split screen and into the end card, full-size stills at 14 moments; sync.py: 41 of 58 hits within 20 ms of an onset, median offset 4.8 ms (the rest are whooshes, which peak later than they start, and long-tail bells). Mix measured -14.0 LUFS, -1.2 dBTP.
Evidence: hook, beat 0: "Mee" already mid-rise beside the violet block, one word per beat in step with the voice. Read: every caption is legible on the half-size pages, key UI numbers are zoomed (occupancy, banner, total, summary). Motion: whip is a real pan with both windows on screen (whip_cal strip), the phone rises with a tilt and settles, taps press and ripple. Variety: a new event at least every 2.5 s (longest gap beat 11.5 to 15.4, a slow push with a caption in it). Brand: only real captures, one accent, Plus Jakarta Sans plus Inter, no typed peso signs (they come from the screenshots).

Worst three still on the list (not blockers):
1. [beat 67-76] The desktop in the split screen shows two or three rows on a mostly empty page (the seeded data only had two pending bookings), so the left half is light on content -> more seeded bookings and requests in the capture would fill it.
2. [beat 11.5-15.4] The wide dashboard hold is a push-in and one caption for 2.5 s -> a count-up or bar growth on the forecast would add an event, but it would mean animating the real chart, so it was left as is.
3. [beat 5.4-11] Captions in the hotel half top out at about 70 px because the window takes the right three quarters -> a narrower window would allow bigger type, at the cost of the UI.

Checks: no banned defaults; longest gap 2.5 s outside the end card; no cut opens on a blank frame (the end-card hit has the tile arriving as the phone folds into it); captions readable; one accent; end card holds 3 s with both lines on screen; deviations from the shot list are listed in the delivery note (hook says "Meet Hotel PMS." to match the voice; the forecast-bars shot became the occupancy/arrivals/departures/replies tour; the theme switch carries the dark-to-light change; the guest flow is one continuous phone scene).
Verdict: READY (rounds 1-3 done, every score at least 8)
