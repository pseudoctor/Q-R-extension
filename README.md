# 问读 · 浏览器伴读

Chrome/Edge Manifest V3 extension companion for the 问读 reading trainer.

## Current scope

This repository contains the extension scaffold only. It does not yet capture page content, call the coaching API, or migrate records from the web application.

The planned shape is:

- Side Panel for capture, recent sessions, favorites, and quick resume.
- Extension tab for the full eight-round training workspace.
- IndexedDB for article sessions and `chrome.storage` for small settings.
- Shared, pure reading/export modules with the existing web application where the boundary is explicit.

## Development

```bash
pnpm install
pnpm dev
pnpm lint
pnpm build
```

Architecture decisions are recorded in `docs/adr/`.
