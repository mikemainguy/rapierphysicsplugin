# Release Notes — v1.0.13

## CLI Bug & Feature Reporting Tool

**What it does:** New `@rapierphysicsplugin/cli` package that lets users report bugs, request features, or ask questions directly from the terminal. It auto-detects the local environment (Node version, OS, installed package versions) and opens the user's browser to a prefilled GitHub issue — no tokens, no backend, no accounts beyond GitHub.

**Usage:**

```bash
# Interactive mode — prompts for type, title, description, environment
npx @rapierphysicsplugin/cli

# Non-interactive — provide flags directly
npx @rapierphysicsplugin/cli --type bug --title "Crash on startup" --description "..."

# Print URL without opening browser (useful for SSH, CI, copy-paste)
npx @rapierphysicsplugin/cli --type bug --title "Crash on startup" --no-open

# Skip environment auto-detection
npx @rapierphysicsplugin/cli --type feature --title "Add X" --no-env

# Standard npm way — opens GitHub issues page
npm bugs @rapierphysicsplugin/client
```

**Supported issue types:**
- **Bug Report** — description, steps to reproduce, expected/actual behavior, auto-detected environment
- **Feature Request** — description, use case
- **Question** — description only

**Design decisions:**
- Environment info is collected from Node built-ins and `node_modules/` package.json files — no `envinfo` dependency needed
- Contact info (name/email) is strictly opt-in — the user is prompted and must explicitly agree
- URLs exceeding 7,500 characters automatically truncate the environment section with a note
- Prompts use `@inquirer/prompts`; the dependency is only imported when interactive mode is needed
- Arg parsing uses `node:util` `parseArgs` — no commander/yargs dependency

## GitHub Issue Templates

Added structured issue templates (`.github/ISSUE_TEMPLATE/`) so users filing directly on GitHub see the same fields as the CLI:

- **bug_report.yml** — description, steps to reproduce, expected/actual behavior, environment (optional)
- **feature_request.yml** — description, use case, proposed solution (optional)

## `bugs` Field Added to All Published Packages

All published package.json files (root, shared, client, server, cli) now include:

```json
"bugs": { "url": "https://github.com/mikemainguy/rapierphysicsplugin/issues" }
```

This enables `npm bugs @rapierphysicsplugin/client` (and similar) to open the correct GitHub issues page once the updated packages are published.

## Test Suite

Added 25 new tests for the CLI package covering environment collection, URL construction, label mapping, URL length truncation, and all three markdown template types. Total test count: 512 tests across 28 test files (all passing).

## Files Changed

| Package | File | Summary |
|---------|------|---------|
| cli | `src/index.ts` | Entry point: shebang, arg parsing, interactive/non-interactive orchestration |
| cli | `src/collect-env.ts` | Auto-detect Node version, OS, installed package versions |
| cli | `src/templates.ts` | Markdown body templates for bug/feature/question |
| cli | `src/build-url.ts` | GitHub issue URL construction with label mapping and length truncation |
| cli | `src/prompts.ts` | Interactive CLI prompt flows |
| cli | `src/__tests__/collect-env.test.ts` | Tests for environment detection (5 tests) |
| cli | `src/__tests__/build-url.test.ts` | Tests for URL construction and truncation (6 tests) |
| cli | `src/__tests__/templates.test.ts` | Tests for all template types and options (14 tests) |
| root | `.github/ISSUE_TEMPLATE/bug_report.yml` | Structured bug report form |
| root | `.github/ISSUE_TEMPLATE/feature_request.yml` | Structured feature request form |
| root | `README.md` | Added "Reporting Issues" section |
| root, shared, client, server | `package.json` | Added `bugs` field |
