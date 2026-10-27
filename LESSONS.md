# Project Lessons

### Inspect adjacent function context after a targeted patch

- Rule: When removing or moving a symbol in a shared code path, inspect the surrounding function and run the type checker before continuing.
- Failure: A context-only patch initially removed `provider` from `testAiConnection`, where it was still used in the localized success response, instead of removing the unused declaration from `requestAiJson`.
- Evidence: The follow-up source inspection showed the missing declaration and the still-unused declaration at separate locations in `src/background.ts`.
- Correction: Restored the provider lookup in `testAiConnection`, removed it from `requestAiJson`, and reran TypeScript and Oxlint checks.
- Verification: `node_modules/.bin/tsc --noEmit` passed and the new warning disappeared.
- Seen: 1× (2026-10-25)
- Status: candidate

### Keep page-capture boundaries separate from provider permissions

- Rule: When changing extension host permissions or provider networking, verify the page-capture selector boundaries independently on a representative news page.
- Failure: Restoring page access fixed capture permissions, but the generic fallback selected the entire People.cn `body` because the page uses `#rm_txt_zw` instead of an `article` or `main` element; navigation, metadata, and footer content were included.
- Evidence: The live People.cn DOM had article content under `#rm_txt_zw`, while the existing candidate list matched only `body`.
- Correction: Added `#rm_txt_zw` as a high-priority candidate, added generic `div/section` candidate scoring, and added build-output regression markers in `scripts/check-extension.mjs`.
- Verification: TypeScript, article-format check, production build, and extension manifest/build-output checks passed; browser source inspection confirmed the isolated container contains the article paragraphs and images only.
- Seen: 1× (2026-10-25)
- Status: candidate
