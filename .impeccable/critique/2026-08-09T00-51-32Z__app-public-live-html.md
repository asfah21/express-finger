---
target: live.html & cam_live.html live attendance kiosk
total_score: 35
p0_count: 0
p1_count: 0
timestamp: 2026-08-09T00-51-32Z
slug: app-public-live-html
---
# Impeccable Critique (Re-run) — Live Attendance Kiosk (`live.html` + `cam_live.html`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Scanning glow + status text + result overlay now make every capture state visible |
| 2 | Match System / Real World | 4 | Plain Indonesian, concrete actionable copy throughout |
| 3 | User Control and Freedom | 3 | Escape + Kembali + Scan Ulang retry; no undo needed for a stateless kiosk |
| 4 | Consistency and Standards | 3 | Live surface internally consistent (one accent hue, FA-only); still FA-vs-lucide across the wider app |
| 5 | Error Prevention | 3 | 409 duplicate window, constraint fallback chain; no sharpness guard on the frame |
| 6 | Recognition Rather Than Recall | 4 | "Mulai Scan"/"Scan Ulang" + description + status make the scan action obvious |
| 7 | Flexibility and Efficiency of Use | 3 | Auto-scan + auto-reset are accelerators for the shared kiosk; Escape shortcut |
| 8 | Aesthetic and Minimalist Design | 4 | Ghost-card shadows, over-rounding, and sub-floor tracking removed; dead code gone |
| 9 | Error Recovery | 4 | 404/409/5xx/network/permission each get specific, actionable recovery |
| 10 | Help and Documentation | 3 | Contextual description + status guidance at the decision point; no deep fallback path |
| **Total** | | **35/40** | **Good — solid foundation, minor polish remains** |

## Anti-Patterns Verdict

**LLM assessment**: Clean. The codex tells from the first pass are resolved — no ghost-card shadow pairs (`.live-panel` is border-only), radius capped at 16px, clock tracking raised above the -0.04em floor, and the three-green palette unified to a single teal hue with explicit overlay tokens. Reads as hand-tuned kiosk product UI, not a template.

**Deterministic scan**: `[]` (clean, exit 0) on both files. No markup-level findings; CSS-layer checks are Assessment A findings.

**Visual overlays**: Not available — no browser automation in this session; Assessment B is CLI-only.

## Overall Impression

The full pass (harden → clarify → colorize → distill → polish) moved the capture flow from guesswork to obvious: the scan trigger is labeled, the scanning moment is visible, and the palette is coherent. Remaining work is minor and mostly system-level (cross-app icon consistency, help depth, a sharpness guard).

## What's Working

1. **Capture moment is now visible** — a glowing face-guide "scanning" state plus a labelled "Mulai Scan"/"Scan Ulang" control; users know when the scan fires.
2. **Trustworthy recovery throughout** — every error path names the problem and the next action; the 4s success redirect is screen-reader-safe.
3. **Coherent palette + clean structure** — one accent hue, token-driven overlays, dead code removed, JS valid, CSS balanced.

## Priority Issues

**[P3] No fallback when face recognition is unavailable**
- **Why it matters**: If the face service is down (503), the kiosk only retries; there is no alternative path (PIN, fingerprint device) for employees who need to clock in now.
- **Fix**: Add a documented fallback or an explicit "service unavailable" callout on the kiosk page before the user commits to the camera flow.
- **Suggested**: `$impeccable harden` / `$impeccable onboard`

**[P3] Cross-app icon and accent drift**
- **Why it matters**: The kiosk surface uses Font Awesome + the teal accent, while the admin dashboard uses lucide + the olive `--secondary`; the live surface intentionally diverges but the system should acknowledge it.
- **Fix**: Pick one icon family and one accent hue system-wide, or document the kiosk surface as a distinct public theme.
- **Suggested**: `$impeccable colorize` / `$impeccable document`

**[P3] No sharpness/blur guard before capture**
- **Why it matters**: A blurred frame still returns a 404; the 600ms settle reduces it but doesn't guarantee a usable frame.
- **Fix**: Add a lightweight sharpness heuristic (variance of the captured frame) and re-scan when too low.
- **Suggested**: `$impeccable harden`

## Persona Red Flags

- **Jordan (Confused First-Timer)**: Resolved — the scan button is clearly labelled, the description sets expectations, and the scanning glow confirms when capture happens.
- **Sam (Accessibility)**: Scanning feedback is now announced via `aria-live` status text; Escape and keyboard scan work; the 4s redirect is screen-reader-safe. Remaining: no SR-specific "face positioned" cue beyond text.
- **Casey (Distracted/Mobile)**: Resolved — auto-scan with a visible scanning state no longer fires invisibly; interruption is less punishing.

## Minor Observations

- `.live-status[data-tone="ready"]` has no distinct style (falls back to neutral) — cosmetic.
- The `--live-accent` teal deliberately diverges from the dashboard's `--secondary` olive — intentional, but worth a token comment.
- Font Awesome CDN remains a third-party render dependency; self-hosting would tighten the kiosk's load path.

## Questions to Consider

- Should the kiosk offer a non-camera fallback when the face service is down, or is retry acceptable for the current deployment?
- Is the Font Awesome CDN acceptable for a kiosk on potentially constrained network, or should icons be self-hosted?

## Run Notes

- Target slug: `app-public-live-html`
- Ignore list: none (`.impeccable/critique/ignore.md` does not exist)
- Assessment independence: degraded (spawn_agent unavailable in this session)
- CLI detector: ran clean (`[]` on both files)
- Browser visibility / overlay injection: n/a (no browser automation in this session)
- Live-server cleanup / temp-file cleanup: n/a / handled
