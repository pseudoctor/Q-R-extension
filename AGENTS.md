# AGENTS.md

## Project profile

- Profile: `dev`.
- Before development work, read `/Users/armewang/.codex/lessons/dev.md` and `/Users/armewang/.codex/standards/dev.md`.
- Read this project's `CONTEXT.md` before changing architecture or storage.
- Read `docs/adr/` when changing the extension target, permissions, or data boundary.

## Scope

- This repository is the browser-extension companion for `toulmin-reader`.
- The first target is Chrome/Edge Manifest V3 with a Side Panel and a full training tab.
- Keep the existing web application and Cloudflare Worker as separate deployable projects.
- Do not add telemetry, analytics, secrets, or provider API keys to source files.

## Verification

- `pnpm install`
- `pnpm lint`
- `pnpm build`
