# ADR 0001: Chrome MV3 Side Panel Companion

## Status

Accepted

## Context

The existing 问读 application is a Vinext/Vite web application backed by a Cloudflare Worker. It already owns the reading workflow, coaching API, and export logic, but it is not packaged as a browser extension. A browser extension should add page capture and quick access without forcing the full web application into a narrow browser panel.

## Decision

Build a separate Chrome/Edge Manifest V3 project. Use a Side Panel for capture, recent sessions, and quick resume; use an extension tab for the complete training workspace. Reuse pure domain and export modules from the existing project only after extracting them behind explicit interfaces.

## Consequences

- The web application remains independently deployable and remains the fallback experience.
- Page capture and configured AI endpoints use the declared HTTP/HTTPS host access; no redundant optional host permission is requested for AI providers.
- Extension storage and the existing web app's `localStorage` require an explicit JSON migration path.
- The Worker API needs an explicit extension-origin/CORS policy before AI requests are enabled.
- Firefox support requires a separate UI capability decision because Chrome's Side Panel API is the first target.
