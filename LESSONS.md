# Project Lessons

### Inspect adjacent function context after a targeted patch

- Rule: When removing or moving a symbol in a shared code path, inspect the surrounding function and run the type checker before continuing.
- Failure: A context-only patch initially removed `provider` from `testAiConnection`, where it was still used in the localized success response, instead of removing the unused declaration from `requestAiJson`.
- Evidence: The follow-up source inspection showed the missing declaration and the still-unused declaration at separate locations in `src/background.ts`.
- Correction: Restored the provider lookup in `testAiConnection`, removed it from `requestAiJson`, and reran TypeScript and Oxlint checks.
- Verification: `node_modules/.bin/tsc --noEmit` passed and the new warning disappeared.
- Seen: 1× (2026-10-25)
- Status: candidate
