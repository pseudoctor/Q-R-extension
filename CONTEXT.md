# Context

## Purpose

Build a Chrome/Edge browser-extension companion for Q&R｜AI Critical Reading Coach. The extension captures a selected passage or a user-requested article, stores reading sessions locally, and lets users continue Toulmin reading training without replacing the existing web application.

## Domain Language

| Term | Meaning | Avoid |
|---|---|---|
| Side Panel | Persistent browser UI shown next to the current tab | Treating it as the full-width reading workspace |
| Capture | User-initiated extraction of selected text or article content | Silent collection from every page |
| Session | Article metadata, source text, drafts, turns, and feedback | Splitting one session across unrelated stores |
| Extension API | The existing Worker API called from the extension origin | Assuming `/api/*` is automatically same-origin |

## Module Map

- `src/`: React extension UI scaffold.
- `public/manifest.json`: initial Manifest V3 metadata and Side Panel entry.
- `docs/adr/`: decisions that affect permissions, storage, or deployment boundaries.
- Existing project reference: `/Users/armewang/Downloads/toulmin-reader`.

## Verification Commands

- `pnpm install`
- `pnpm lint`
- `pnpm build`

## Known Ambiguities

- The first release targets Chrome/Edge; Firefox support is not yet part of the contract.
- Full article extraction, AI transport/CORS, storage migration, and cross-device sync are implementation phases, not part of the initial scaffold.
