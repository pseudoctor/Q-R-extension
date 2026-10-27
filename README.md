# Q&R | AI Critical Reading Coach

[English](README.md) · [简体中文](README.zh-CN.md)

Q&R is a Chrome/Edge Manifest V3 browser extension that brings the article you are reading into a guided workspace for pre-reading prediction, structured critical reading, and Toulmin argument analysis. Articles and training records are stored locally in your browser.

AI is optional. Without an AI provider configured, you can still save articles, complete local training, edit answers, and export records. When AI is enabled, the extension sends the article content and answers required for training only to the model service you choose.

## Features

- Extract article titles, metadata, body text, and selected structured content from the current webpage. Pages that cannot be read can be pasted manually.
- Complete a ten-step guided reading flow in a dedicated training page, covering preview, quick browsing, paragraph analysis, summaries, questions, assumptions, and Toulmin argument analysis.
- Use AI for training questions, grading feedback, follow-up questions, and reference answers. Every source quote returned by AI is checked locally against the article.
- Store articles, training history, favorites, and answer versions locally.
- Export records as Markdown, Obsidian URIs, or JSON, or open the print page and save them as PDF.

See the complete training flow in [`docs/reading-training-10-step-workflow.md`](docs/reading-training-10-step-workflow.md).

## Quick start

### Install the development build

```bash
pnpm install
pnpm build
```

Open the extension management page in Chrome or Edge, enable Developer mode, choose **Load unpacked**, and select the generated `dist/` directory.

After code changes, run `pnpm build` again and click **Reload** for the extension.

### Capture an article

Open an article in a regular webpage and use either method:

- Windows/Linux: `Ctrl+Shift+8`
- macOS: `Command+Shift+8`
- Open the extension side panel and click **Capture current article**.

The extension reads the current page only after a user click or keyboard shortcut. Before training, check the title, source, metadata, and body text, and adjust the paragraph structure if needed.

### When automatic extraction is unavailable

Browser-internal pages, extension pages, store pages, and some PDFs cannot be read by the extension. Open **Paste an article manually** in the side panel, then enter the title, source, and body text on the training page.

### Start training

Before reading the full article, record your expected questions, claims, or argument direction using only the title, source, and available metadata. After checking the article, click **Save and start training**.

Training can continue without AI. After configuring AI, the extension generates questions, grades, and feedback for the current step. Once an answer is saved, you can also request a reference answer or field hint.

## AI configuration

Choose a provider in the side panel or settings page, enter the model name and API key, and provide a complete API endpoint when needed. Test the connection before saving the settings.

The current version uses an OpenAI-compatible Chat Completions API. A custom service URL must be a complete `/chat/completions` endpoint. HTTPS services may use public domains. HTTP is limited to `localhost` and `127.0.0.1`.

API keys are stored only in the extension's session storage for the current browser session and must be entered again after the browser closes. Do not use high-privilege keys on shared computers, and never put keys in source files, URLs, logs, or commits.

When saving settings or testing a connection, the extension requests optional network permission for the service URL you confirmed. If permission is denied, the related AI settings are not saved and no AI request is sent.

## Data, permissions, and privacy

- Articles, training records, favorites, and data prepared for export are stored locally in `chrome.storage.local`. There is no built-in cloud sync.
- API keys use `chrome.storage.session` and are not written to article records or ordinary persistent settings.
- Page capture uses Manifest V3 `activeTab` and `scripting`; the extension does not request permanent access to every website at installation time.
- When AI is disabled, articles and answers are not sent to third-party model services. When enabled, they are sent only to the provider endpoint selected by the user.
- The extension includes no telemetry, advertising, or additional analytics requests.
- Remote images in articles are shown as placeholders in the extension preview, print page, and Markdown export by default. They are not fetched automatically.

## Exports and local data

Training records can be exported as:

- Markdown
- Obsidian URI
- JSON
- Print page or PDF

To prevent unbounded browser storage growth, the extension limits the number of articles, training sessions, answer versions, request records, and archived records. When a limit is reached, current records and favorites are kept first. Data that exceeds the per-record limit is not written.

## FAQ

### The keyboard shortcut does nothing

Make sure the current tab is a regular webpage, and check whether another extension uses the same shortcut in the browser's extension shortcut settings. You can also click **Capture current article** in the side panel.

### The extension did not capture the article body

Refresh the article page and try again. If the page still cannot be read, use **Paste an article manually**. Manual input may be required for very short pages, special readers, or content inside a browser-internal page.

### The AI connection failed

Check the endpoint, model name, and API key, then test the connection again in Settings. If the provider cannot return a model list, enter a model name supported by the provider manually.

### AI source quote validation failed

The extension requires the model's `quote` to be a continuous excerpt from an article block. The `paragraph` or `blockId` must also be allowed for the current training step. If the model returns a paraphrase or a discontinuous quote, retry the request. If the problem continues, check that the endpoint supports structured JSON output.

## Development

The project uses Vite, React, TypeScript, and Chrome/Edge Manifest V3.

Start the development server:

```bash
pnpm install
pnpm dev
```

Type checking, linting, and a production build:

```bash
pnpm exec tsc -b
pnpm exec oxlint .
pnpm build
```

Run extension and regression checks:

```bash
pnpm check:extension
pnpm check:store-assets
pnpm check:release
pnpm check:article-format
pnpm check:pre-reading
pnpm check:training-flow
pnpm check:i18n
pnpm check:storage-concurrency
pnpm check:training-audit
pnpm check:ai-storage
pnpm check:message-security
pnpm check:ai-http
pnpm check:provider-settings
pnpm check:browser
```

`pnpm check:browser` uses a local Chrome or the Chrome installed in CI for a headless smoke test. If Chrome cannot start locally, the script reports an explicit skip and does not treat the skip as a real browser acceptance result.

See [`docs/adr/0001-chrome-mv3-side-panel.md`](docs/adr/0001-chrome-mv3-side-panel.md) for the architecture decision record.

## Packaging and release

Store assets are kept in `store-assets/`. `*-source.png` files and `drafts/` are retained as source files and are not included in the extension package.

```bash
pnpm check:store-assets
pnpm package:extension
```

`pnpm package:extension` builds the extension, checks the Manifest, version synchronization, store assets, and the release file allowlist, then creates:

```text
release/toulmin-reader-extension-v<version>.zip
```

Real Chrome/Edge interaction and real model requests still need manual acceptance in a target browser with a configured AI service. Local simulation scripts are not treated as evidence of real service acceptance.

## Contributors

- [pseudoctor](https://github.com/pseudoctor): project maintenance and product decisions
- Codex (OpenAI): implementation assistance, security review fixes, tests, and documentation support

## Support the project

If Q&R is useful to you, voluntary support is welcome. Donations do not provide paid services, priority support, or a technical support commitment.

<div align="center">
  <table>
    <tr>
      <th>Alipay</th>
      <th>PayPal</th>
    </tr>
    <tr>
      <td align="center">
        <a href="public/assets/donate-alipay.jpg">
          <img src="public/assets/donate-alipay.jpg" alt="Alipay donation QR code" width="220">
        </a>
      </td>
      <td align="center">
        <a href="public/assets/donate-paypal.jpg">
          <img src="public/assets/donate-paypal.jpg" alt="PayPal donation QR code" width="220">
        </a>
      </td>
    </tr>
  </table>
</div>
