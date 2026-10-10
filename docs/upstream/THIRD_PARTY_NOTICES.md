# Third-party notices

- **Local white/purple GPT dragon adaptation (2026-10-03)** retains **dsh-whale-widget 0.3.17** from the user's supplied source under `vendor/dsh-whale-widget/`. Its code license, asset exclusions, and provenance remain in that directory. The default dragon sprite was generated for this local adaptation; external reference artwork is not bundled. See `README-CODEX-DRAGON.md`.
- The dragon portable bundle includes the Electron runtime with its original `LICENSE` and `LICENSES.chromium.html`. The upstream installer notes below apply to the original project, not the self-contained dragon bundle.

- **dsh-whale-widget 0.3.0-beta**, Copyright (c) 2026 MeteorNOX, MIT License. The original images, GIFs, audio files and substantial widget UI/host code are retained or adapted. See `LICENSE` and `docs/UPSTREAM-README.md`.
- **smol-toml 1.8.0**, Cynthia Rey and contributors, BSD-3-Clause. An unmodified copy of the published package is included in `vendor/smol-toml/`; see `vendor/smol-toml/LICENSE`. It is loaded directly so the Codex plugin does not require an npm install step.
- **Electron 44.3.0**, Electron contributors, MIT License with bundled Chromium and third-party notices. Electron is downloaded separately by the optional desktop installer; its own license and notices are retained in the installed desktop runtime and are not replaced by this project's license.
