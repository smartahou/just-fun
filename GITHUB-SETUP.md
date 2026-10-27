# Just Fun v7.21 — Git source repository

This Git import deliberately includes the modular application source, scripts, tests, fixtures and engineering documentation, **not** generated `dist/`, `node_modules/`, diagnostic logs, local media, credentials or private Workspace data.

## Reproducing the published build

The build manifest is unchanged. The official v7.21 `index.js` has SHA-256:

`29bea900604b103de493bcfceeb2f4cbea84a71507521b605f966ecf9159de74`

Run with Node.js >=22.13.0:

```bash
npm install --no-save --ignore-scripts pdfjs-dist@6.4.299
node scripts/build.js
sha256sum dist/douyin.js
```

The first step provisions the **pinned third-party PDF.js package**. It requires network or an offline cache on a fresh clone. The previous full-source archival ZIP in ChatGPT Library retains this dependency for fully offline reconstruction. The Git repository intentionally does not commit third-party fonts or dependency distribution assets. Once the dependency is provisioned, the build itself runs offline.

Run the project's documented `tests/run-all.py` test gates in a suitable isolated environment. Do not run these tests against real media libraries.

## Boundaries

- Do not commit personal videos, photos, library indexes, passwords, keys or vault data.
- `dist/douyin.js` is generated and is not the maintenance source.
- Do not enable Workspace v2 production migration from this baseline.
- Preserve the single-file `index.js` user delivery workflow.
- This source import is one initial commit; it does not recreate hundreds of historical Git commits.

## Import the supplied Git bundle into a new private GitHub repository

1. Create an **empty private** GitHub repository named `just-fun` under `smartahou` (do not initialize with a README or license).
2. With Git installed, open a terminal beside `JustFun-v7.21-initial.git.bundle` and run:

```bash
git clone JustFun-v7.21-initial.git.bundle just-fun
cd just-fun
git remote set-url origin https://github.com/smartahou/just-fun.git
git push -u origin main
```

The bundle contains one verified Git initial commit and no generated distribution, third-party dependency files, PDF font files, or user library data. **Do not treat the bundle as a remote push.**
