# Ground Control: Project Instructions

Read `CONTINUE_HERE.md`, `ROADMAP.md`, and `README.md` before changing the project. These files provide continuity when the original conversation or account is unavailable.

## Product Constraints

- Browser-only, no runtime backend or API keys. Preserve both the static site and standalone offline HTML.
- Use real airport geometry and connected taxi routes. Edinburgh is currently the sole airport, runway 24 active.
- Preserve endless play, dark default theme, full-screen map, full-height floating right panel, grouped compact cards, gentle request pulses, compact aircraft action menus and keyboard shortcuts.
- Successful actions close the menu. Requests sort before routine traffic; reduced-motion preferences are respected.
- Preserve saves across normal reloads. Save-schema or routing changes require a deliberate compatibility/migration decision, not silent loss of progress.

## Source and Verification

- `src/` is application source; `web/index.html` and `web/style.css` are authored UI source.
- `data/airports/egph/geometry.json` is checked-in airport data. `dist/` is entirely generated and ignored; every build cleans/recreates it. `Ground Control.html` is generated and tracked for convenient offline use. Never edit generated artifacts manually.
- Use `npm ci` with the checked-in lockfile, then `npm run verify` for a clean build, output checks, type checks, unit/fixture tests and all browser suites.
- `npm run test:browser` owns its temporary server and browsers. Installed Google Chrome is required by default; `BROWSER_CHANNEL`, `BASE_URL` and `ARTIFACT_DIR` are configurable. Output defaults to ignored `test-results/`. Run `npm run build` first when invoking browser suites alone.
- `npm run format:check` checks source formatting. `npm run benchmark` records diagnostic performance, not a pass/fail timing threshold.
- Type checking currently covers domain contracts, traffic geometry and compile-time contract tests, not the entire JavaScript engine/UI. Extend coverage as modules migrate; do not replace runtime save validation with casts.
- Preserve archived `tests/fixtures/v1/` and `tests/baselines/` references. Tests must not regenerate their own expectations. Airport data byte/hash changes need an explicit compatibility decision.
- Keep simulation/traffic logic independent of the DOM and storage. Prefer existing ngraph routing and Lucide icons over new dependencies.
- Do not revert unrelated changes. Update the roadmap/handoff when project assumptions or completed work change.

## Account and Hosting Boundary

- Local development requires only the project files, Node.js and npm, not the original Codex account, Sites plugin, remote Git credentials or chat history.
- `.openai/hosting.json` identifies an existing owner-private Sites deployment. Its ID is metadata, not an access credential.
- Do not assume a different account can edit/publish that site. For a publishing request, verify access through the supported Sites tools and preserve the existing audience. Do not change the existing site identity, expose it publicly, reuse old tokens, or provision replacement hosting just to continue local development.
- No remote Git is configured locally; prior Sites pushes used temporary per-command credentials. Do not store credentials in Git configuration or project files.
- `portability/` contains generated, ignored backups, not source. Refresh them after relevant changes if the user needs a new transfer snapshot.
