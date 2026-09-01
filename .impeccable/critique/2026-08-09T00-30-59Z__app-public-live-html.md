---
target: live.html & cam_live.html live attendance kiosk
total_score: 29
p0_count: 0
p1_count: 3
timestamp: 2026-08-09T00-30-59Z
slug: app-public-live-html
---
# Impeccable Critique — Live Attendance Kiosk (`live.html` + `cam_live.html`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Auto-capture at 350 ms is invisible; no scan countdown/indicator before snapshot |
| 2 | Match System / Real World | 4 | Plain Indonesian, concrete actionable error copy throughout |
| 3 | User Control and Freedom | 3 | 2.5 s auto-redirect after success has no cancel; only exit is browser back |
| 4 | Consistency and Standards | 2 | Three different "success" greens; mixed icon systems; dead lucide + kiosk JS |
| 5 | Error Prevention | 3 | 409 duplicate explained with window; camera fallback chain; no sharpness guard |
| 6 | Recognition Rather Than Recall | 3 | "Coba lagi" is the only control and reads as retry, not the scan trigger |
| 7 | Flexibility and Efficiency of Use | 2 | Auto-capture + auto-reset help a shared kiosk; no keyboard scan trigger; state.mode unused |
| 8 | Aesthetic and Minimalist Design | 3 | Clean dark panels + confident hero clock, but ghost-card shadow, 24 px radius, -0.055em clock |
| 9 | Error Recovery | 4 | 404/409/permission/connection each get specific, actionable messages |
| 10 | Help and Documentation | 2 | No on-surface guidance beyond one status line; no visible capture indicator |
| **Total** | | **29/40** | **Good — address weak areas, solid foundation** |

## Anti-Patterns Verdict

**Start here.** Does this look AI-generated?

**LLM assessment**: No. This is a considered, product-register kiosk UI with a coherent two-page flow, large touch targets, honest state handling, and real accessibility groundwork. It reads as hand-tuned for a shared attendance kiosk, not a template. That said, the CSS layer carries several classic codex tells that a picky reviewer flags: the ghost-card pairing on `.live-panel` (1px border + `0 25px 50px -12px` shadow), over-rounded 24px panel/camera radius, a sub-floor -0.055em display tracking on the hero clock, and a three-green palette drift that undercuts the "calm, trustworthy" brand.

**Deterministic scan**: The bundled detector returned `[]` (clean, exit 0) for both `live.html` and `cam_live.html`. No markup-level slop. Note: the detector scans markup only, so the CSS-layer defects above are Assessment A findings, not detector misses. No false positives to flag.

**Visual overlays**: Not available — no browser automation is exposed in this session, so no overlay was injected and no live server was started. Assessment B is CLI-only.

## Overall Impression

A genuinely well-built, trustworthy kiosk flow — the two-step choice→camera pattern is right, the status language is excellent, and the accessibility groundwork is above average for this category. The single biggest opportunity is the capture moment: the 350 ms invisible auto-snapshot with "hold until face is read" leaves users guessing when it fires, and the only visible control ("Coba lagi") doesn't read as a scan trigger. Fix the capture affordance and unify the palette and this goes from "good" to "excellent."

## What's Working

1. **Error handling is exceptional** — every failure path (404 face-not-recognized, 409 duplicate with 1-minute window, camera permission-denied/not-found, connection loss) has a plain-language, actionable message with a retry path. This is the trust backbone a public kiosk needs.
2. **Distance-legible kiosk hierarchy** — the huge tabular clock plus two giant labeled CTAs (MASUK/PULANG) make the primary decision obvious from across the room; the flow is one decision, two options.
3. **Real accessibility groundwork** — `aria-live` status regions, `aria-hidden` on the decorative clock, `role="status"`, visible `focus-visible` outlines, `prefers-reduced-motion` handling, semantic single `h1`, and ≥44px touch targets (156px buttons).

## Priority Issues

### [P1] Auto-capture at 350 ms is invisible and can grab a poor frame
- **What**: `initCamLivePage` fires `submitCamAttendance()` 350 ms after the camera resolves, with no on-screen countdown or scanning indicator before the snapshot; the "Memeriksa wajah…" overlay only appears once the fetch starts.
- **Why it matters**: Users are told "Tahan posisi hingga wajah terbaca" but can't tell when it reads. A mid-movement capture → 404 → frustration spike, and the primary action is hidden behind a control that reads as "retry."
- **Fix**: Add a visible capture countdown or an animated "scanning" state on the face guide; or gate the auto-capture behind a clear "Mulai Scan" button and keep auto-capture as the convenience path.
- **Suggested command**: `$impeccable harden` / `$impeccable animate` / `$impeccable clarify`

### [P1] Ambiguous primary control: "Coba lagi" is the only actionable button
- **What**: The actions column has one button labeled "Coba lagi" (retry) that doubles as the manual scan trigger, but it doesn't read as the primary "start scan" affordance.
- **Why it matters**: First-timers won't recognize it as the trigger; it implies something already failed. The actions column lacks hierarchy (no clear primary vs secondary).
- **Fix**: Label it contextually ("Scan Ulang" / "Mulai Scan"), give the actions column a proper primary + secondary hierarchy, and keep "Coba lagi" as the error-state label.
- **Suggested command**: `$impeccable clarify` / `$impeccable layout`

### [P1] Color semantics drift: three greens undermine the calm, trustworthy brand
- **What**: Brand accent green `#77a044` (tokens), success teal `#67d6c1` (hard-coded in the pulse glow, face guide, processing, status tints, and result icon), and the Masuk green `#54d39a` coexist.
- **Why it matters**: Users subconsciously read success color; the inconsistency erodes trust and reads as unpolished, violating consistent component vocabulary.
- **Fix**: Unify on one success/accent hue (OKLCH) and use it everywhere — face guide, pulse, processing, status success tint, result icon.
- **Suggested command**: `$impeccable colorize`

### [P2] Codex-tell styling: ghost-card shadow, 24px over-rounded panels, sub-floor clock tracking
- **What**: `.live-panel` = 1px border + `0 25px 50px -12px` shadow (the banned ghost-card pairing); panels + camera frame use 24px radius (over-rounding); `.live-main-clock` letter-spacing -0.055em (below the -0.04em floor).
- **Why it matters**: These are the classic product-register giveaways — the shadow makes panels feel heavy/dated, the radius softens the crisp kiosk feel, and the tight tracking on a huge clock looks cramped.
- **Fix**: Drop the big shadow (keep border OR a ≤8px-blur shadow), reduce panel radius to ~16px (full-pill only on tags/buttons), raise clock tracking to -0.02/-0.03em.
- **Suggested command**: `$impeccable polish` / `$impeccable quieter`

### [P2] Dead code and duplication across the kiosk path
- **What**: `live.js` retains ~100 lines of unreachable kiosk-camera code (`startCamera`, `captureImage`, `submitAttendance`, `showResult`, `scheduleReset`, `state.mode`); `window.lucide?.createIcons()` runs on both pages but lucide isn't loaded on `live.html` and no lucide icons exist; `cam_live.html` loads the lucide CDN `@latest` unnecessarily; `live.css` has duplicated blocks (`.live-kiosk-heading` ×2, `.live-privacy` ×2, duplicate `justify-content`) and an unused `.live-online`.
- **Why it matters**: Maintenance risk, an extra render-blocking third-party request on a kiosk device, and unpinned `@latest` is a supply-chain smell.
- **Fix**: Delete the dead kiosk-path JS, remove the lucide script + `createIcons` call, pin/remove the CDN, collapse duplicate CSS.
- **Suggested command**: `$impeccable distill`

### [P3] Redundant clocks and commented-out blocks
- **What**: `live.html` shows the time twice (header `#live-clock` and hero `#live-time`); both files carry commented-out markup; the clock script recreates `Intl.DateTimeFormat` 3×/second on one cramped inline line.
- **Why it matters**: The header clock duplicates the hero clock; comments are noise; per-tick formatter churn is a small perf smell.
- **Fix**: Keep one clock, remove comments, cache the Intl formatters.
- **Suggested command**: `$impeccable distill` / `$impeccable optimize`

## Persona Red Flags

**Jordan (Confused First-Timer)**: The cam page's only button says "Coba lagi" before anything has failed — reads as an error state, not the scan trigger. "Tahan posisi hingga wajah terbaca" gives no signal for when "terbaca" happens; Jordan stands still unsure it's working, then the snapshot fires at an unpredictable moment.

**Sam (Accessibility)**: Status is `aria-live="polite"` and the result `aria-live="assertive"` — good. But the camera frame + face guide are visual-only (`aria-hidden`), so a screen-reader user gets no "face positioned correctly" feedback. No keyboard trigger for scanning; the 350 ms auto-capture is a time-critical action with no extension option (WCAG 2.2.1), and the 2.5 s success auto-redirect can fire before the screen reader finishes reading the result.

**Casey (Distracted/Mobile)**: On a phone the actions stack below the camera and "Coba lagi" lands below the fold; the 4:3 frame with a 12% inset face guide leaves a small face target on narrow screens. The unpredictable auto-capture punishes interruption — look away, and the photo grabs mid-look.

## Minor Observations

- `.live-online` CSS class is defined but unused.
- `.live-camera-start` hover shadow `0 8px 18px` is another border + ≥16px-blur pairing (minor ghost-card).
- `.live-camera-hint` declares `font-size` twice (0.82rem then 0.95rem) — dead first declaration.
- `cam-live-header` has duplicate `justify-content: space-between`.
- `state.mode` is assigned but never read.
- The kiosk uses the Font Awesome CDN while the rest of the app uses lucide — one icon system should win.
- `lang="id"` matches all copy; commented-out English "Live Cam @ GSI Corp 2026" is leftover.

## Questions to Consider

- What if the camera page led with a single, obvious "Scan" control and "Coba lagi" became just its error-state label?
- Does the kiosk need two clocks? The hero clock is the moment; the header clock is noise.
- What would the capture moment look like if the face guide lit up / confirmed while scanning — feedback the user can actually see?
