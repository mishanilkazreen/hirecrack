<p align="center"><img src="build/icon.png" alt="HireCrack logo" width="96" height="96"></p>

# HireCrack

[![CI](https://github.com/mishanilkazreen/hirecrack/actions/workflows/ci.yml/badge.svg)](https://github.com/mishanilkazreen/hirecrack/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue.svg)](LICENSE)

Free, source-available practice for one-way video interviews (HireVue-style) that runs locally and connects to cloud APIs.

You see a question, get some thinking time, and record a 1–2 minute answer. You can retake it up to 3 times. When you submit, the app:

1. **Transcribes** your answer with Whisper, locally.
2. **Scores** what you said from negative to positive, based on how assessments work. It quotes your answer back with direct feedback and flags anything an employer would see as a red flag.
3. **Tracks eye contact** with MediaPipe face and iris landmarks. This is a _practice-only presence metric_.

## Download

Get the latest `HireCrack Setup 1.0.0.exe` (installer) or `HireCrack-1.0.0-portable.exe` from the [Releases](../../releases) page.

> The exe is not code-signed, so Windows SmartScreen may warn you. Click **More info → Run anyway**.

## Requirements

|                | Minimum                                               | Recommended                                                            |
| -------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| OS             | Windows 10 or 11 (64-bit), macOS 12+, or 64-bit Linux | Windows 11                                                             |
| Memory         | 4 GB RAM with built-in rules or a cloud engine        | 8 GB RAM or more for Local AI scoring                                  |
| Disk space     | About 450 MB for the app                              | 4 GB free to also hold the models                                      |
| Graphics       | Not required                                          | A GPU with WebGPU support and 4 GB+ video memory (needed for Local AI) |
| Camera and mic | Any webcam and microphone                             | Webcam at eye level, headset mic                                       |
| Internet       | Only for the first-time model downloads               | Needed for Claude or OpenAI engines                                    |

Model download sizes:

- Speech model (Whisper): about 100–250 MB.
- Local AI scoring model (Phi-3.5-mini): about 2.3 GB.

Local AI runs on your graphics card through WebGPU. The model takes about 2.3 GB of video memory, so 4 GB or more is recommended. It has been tested on Windows 11 with an NVIDIA RTX 5060 Ti (16 GB), where scoring took about 10 seconds per answer. Without WebGPU, use Built-in rules or a cloud engine. Built-in rules need no download and score instantly, but can only judge keywords, with no meaning.

## Run from source

Requires Node.js 22+ (24 recommended) and pnpm (`corepack enable`; the version is pinned in `package.json`).

```bash
git clone https://github.com/mishanilkazreen/hirecrack.git
cd hirecrack
pnpm install       # also copies MediaPipe assets and downloads the face model
pnpm dev           # open http://localhost:5173 in Chrome or Edge
```

Or run it as a desktop app:

```bash
pnpm electron
```

## Build the exe

```bash
pnpm dist          # Windows: NSIS installer + portable exe in ./release
pnpm dist:all      # the current OS's default targets (dmg on macOS, AppImage on Linux)
```

### Publishing a version

1. Bump `"version"` in `package.json`.
2. Commit, then tag and push:

   ```bash
   git tag v0.2.0
   git push --tags
   ```

3. The GitHub Actions workflow (`.github/workflows/release.yml`) builds Windows, macOS and Linux packages and attaches them to a GitHub Release.

## Settings

| Setting       | Options                                                              |
| ------------- | -------------------------------------------------------------------- |
| Transcription | Local Whisper (free, offline) · OpenAI Whisper API                   |
| Whisper model | tiny.en (fastest) · base.en (default) · small.en (most accurate)     |
| Scoring       | Local AI (free, offline) · Built-in rules · Claude · OpenAI · Ollama |
| Timing        | Prep time 0–60s · answer time 60–120s · attempts 1–3                 |
| Eye contact   | On / off                                                             |

API keys are stored only in this app's local storage on your device.

To use Ollama, run `ollama serve` and allow the app's origin, for example by setting `OLLAMA_ORIGINS=*`.

## Project layout

```
hirecrack/
├── electron/
│   └── main.cjs             Desktop shell: serves the app on 127.0.0.1, camera and mic permissions
├── src/
│   ├── App.tsx              Screens and navigation
│   ├── types.ts             Shared types every module codes against
│   ├── pages/               Home, setup check, interview, analysing, results, history, settings, onboarding
│   ├── components/          Topbar, device pickers, engine setup, timer, score bars
│   ├── lib/
│   │   ├── transcribe/      Whisper in a web worker, or the OpenAI API
│   │   ├── scoring/         Built-in rules, Local AI (Phi-3.5-mini in a worker), Claude, OpenAI, Ollama
│   │   ├── gaze/            Eye contact tracking with MediaPipe face and iris landmarks
│   │   ├── media.ts         Camera, mic and speaker helpers, recording
│   │   ├── history.ts       Saved results (local storage)
│   │   ├── videoStore.ts    Saved recordings (IndexedDB, newest 20)
│   │   └── settings.ts      Settings, defaults and migrations
│   ├── data/                Question bank and scoring lexicons
│   └── test/                Shared test setup and helpers
├── scripts/
│   └── copy-assets.mjs      Copies MediaPipe files and downloads the face model on install
├── build/                   App icons and the installer script
├── docs/                    Research notes on how HireVue scores answers
└── .github/                 CI, release workflow, Dependabot, issue and PR templates
```

Tests sit next to the code they cover (`*.test.ts` for unit tests, `*.test.tsx` for integration tests).

## Contributors

<a href="https://github.com/mishanilkazreen/hirecrack/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mishanilkazreen/hirecrack" alt="Contributors" />
</a>

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## Disclaimer

Developed by [Mishanil Kazreen](https://github.com/mishanilkazreen). HireCrack is an independent project and is not affiliated with or endorsed by HireVue.

## License

HireCrack is free for personal, educational, research and other non-commercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use is not permitted.

The software is provided as is, without any warranty. As far as the law allows, the author is not liable for any damages arising from its use. HireCrack is a practice tool: its scores are not HireVue's and do not predict the outcome of a real interview.

The models it downloads (Whisper, Phi-3.5-mini, MediaPipe) are covered by their own licences.
