# Contributing

Thanks for helping out! Pull requests are checked automatically by CI.

## Setup

Requires Node 22+ (24 recommended) and pnpm, which is pinned via `packageManager` in `package.json`.
Use pnpm only, not npm or npx.

```sh
corepack enable
pnpm install
pnpm dev          # Vite dev server
pnpm electron:dev # Electron against the dev server (run pnpm dev first)
```

`pnpm install` also downloads a MediaPipe model into `public/mediapipe` (see `scripts/copy-assets.mjs`).

## Scripts

| Script                              | Purpose                                           |
| ----------------------------------- | ------------------------------------------------- |
| `pnpm typecheck`                    | TypeScript check, no emit                         |
| `pnpm lint`                         | ESLint                                            |
| `pnpm test` / `pnpm test:watch`     | All Vitest tests (unit and integration)           |
| `pnpm test:unit`                    | Unit tests only (`*.test.ts`)                     |
| `pnpm test:integration`             | UI tests only (`*.test.tsx`)                      |
| `pnpm format` / `pnpm format:check` | Prettier                                          |
| `pnpm build`                        | Typecheck and production build                    |
| `pnpm dist`                         | Build the Windows installer with electron-builder |

See the README for the project layout.

## Testing

- Unit tests are `*.test.ts` files next to the code. They run in Node and cover plain modules such as settings, history, scoring, gaze maths and the engine API calls (with `fetch` mocked).
- Integration tests are `*.test.tsx` files. They render the real app with React Testing Library in jsdom and walk through flows such as first launch, recording and results. Only the heavy parts are mocked: transcription, eye-contact tracking, the camera, `MediaRecorder` and audio. Scoring uses the real built-in rules.
- Shared setup and browser stubs live in `src/test/`. The stubs are installed before every integration test.
- Query by role or label (`getByRole`, `getByLabelText`) rather than long copy, so wording changes do not break tests. Use fake timers for countdowns and keep each test fast.
- Use `pnpm`, never `npm` or `npx`. Run `pnpm test` before you push; CI runs it too.

## Pull requests

- Keep PRs focused; describe what and why, and how you tested it. Add screenshots for UI changes.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` must pass (CI jobs `check` and `package`).
- Add or update tests for changes to scoring, gaze, settings or data files.
- CI fails if formatting is off, so run `pnpm format` before you push.

## Dependencies

Supply-chain hardening is configured in `pnpm-workspace.yaml`: versions must be at least 3 days old
(`minimumReleaseAge`), and dependency install scripts are blocked (`strictDepBuilds`).
If a new dependency has a build/install script, the install fails until you add an `allowBuilds` entry
(`true` or `false`) and explain in the PR why it is needed or safe. Prefer few, mainstream dependencies.

## Licence

HireCrack is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). By opening a pull request, you agree that your contribution is licensed under the same terms.
