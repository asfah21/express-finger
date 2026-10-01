# AGENTS.md

Fingerprint attendance (ZKTeco/Solution ADMS) listener + web dashboard + face-recognition kiosk. Real app lives in `app/`; root `package.json` only holds test tooling.

## Layout & entrypoints

- `app/server.js` — Express entrypoint (ESM, `"type": "module"`). Run the app from `app/` (`.env`, `node_modules` there).
- `app/` — routes/controllers/middleware/utils. `app/config/index.js` is the central config (all env-driven).
- `face-service/` — Python Flask sidecar for live face recognition.
- `docker-compose.yml` also references an `ai-service` (Python sidecar) whose build context (`./ai-service`) does **not** exist on disk — `docker-compose build` will fail on it. Only `express-finger` + `face-service` are runnable.

## Commands

Vitest is installed only at the **root** (not under `app/`). Run all tests from the repo root:

```
npx vitest run        # full suite (root tests/** + app/tests/**, single-fork)
npx vitest            # watch
```

- `vitest.config.js` uses `pool: 'forks'`, 1 worker, `fileParallelism: false` (tests interfere if parallelized).
- **Repo convention: do NOT `import ... from 'vitest'`.** `globals: true` is on; use global `describe/it/expect` (tests that import from `'vitest'` fail in this environment).
- Tests assert WITA wall-clock (`Asia/Makassar`) — timestamps in fixtures are `.toISOString()` UTC pinned for that zone.
- `tests/security/` is empty; the real security checks are manual `app/tests/security/*.mjs` scripts (not picked up by the `.test.js` glob) — run with `node`.

## Dev / run

- App needs a running PostgreSQL; `ensureSchema()` creates tables on boot (no external migrations).
- Default dashboard login: `admin` / `admin123`.
- Env: `cp app/.env.example app/.env`. All rate-limit thresholds come from `RATE_LIMIT_*` env vars (see `.env.example`); no code change needed to tune them.

## Gotchas

- `node-zklib` is patched in `app/patches/node-zklib+1.3.0.patch`, applied via `patch-package` in `app/` `postinstall`. If you `npm install` in `app/` and ZK device behavior regresses (chunking/time decode), the patch was not applied.
- `/iclock` (ZK device push protocol) is deliberately **unauthenticated**; its dedicated rate limiters were removed (they delayed device pushes). Protection is via optional `ICLOCK_ALLOWED_IPS` allowlist + global limiter. Keep this in mind when touching device routing.
- The `/api/events/stream` SSE endpoint must not be compressed (compression buffers/breaks streaming) — the `compression` filter in `server.js:53` already excludes it.
- `app/config/priority_devices.js` hard-locks specific SNs to an IP/port for PULL — 0.x LAN devices get their IP auto-updated from PUSH, priority SNs override it.
- `.gitignore` ignores `docker-compose.yml` (kept local; contains real secrets). Don't commit secrets; the checked-in compose holds production credentials.
- Business timezone default is `Asia/Makassar` (WITA) — attendance/remark logic assumes this wall-clock.
- `data/` holds push/raw and pull audit files; `app/` has several one-off debug scripts (`check-dev.js`, `debug-*.js`, `check-fp.mjs`, `create-superadmin.js`, etc.) that need a live DB.

## Docs

`README.md` (quickstart), `Documentation.md` (dashboard, security/rate-limit details, **template sync rollout/rollback** — read before touching template sync), `API_DOCUMENTATION.md`, `PRODUCT.md`, `plans/` (design plans).
