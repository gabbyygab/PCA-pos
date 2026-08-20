# PCA POS — desktop app

Point of sale and payroll for PCA car wash. Next.js is **statically exported**
and packaged as a native desktop app with [Tauri v2](https://tauri.app); the
data lives in hosted Supabase.

There is no Node server at runtime. `output: 'export'` prerenders everything to
`out/`, and the OS webview loads those files from disk — which is why Server
Actions, Route Handlers, and `next/headers` cannot be used here.

## Setup

Copy the env template and fill it in:

```bash
cp .env.local.example .env.local
```

Building installers additionally needs the Rust toolchain (once per machine):

- Windows: install [rustup](https://rustup.rs) and the **Visual Studio Build
  Tools** with the "Desktop development with C++" workload.
- The packaged app itself needs no Rust — only WebView2, which Windows 11 ships.

## Commands

```bash
npm run dev           # browser dev server at localhost:3000
npm run desktop       # native window against the dev server (hot reload)
npm run build         # static export to out/; runs a full TypeScript check
npm run desktop:build # installers into src-tauri/target/release/bundle
npm run lint          # eslint
npx tsc --noEmit      # typecheck alone
```

Use `npm run dev` for ordinary UI work — it is faster and has better devtools.
Reach for `npm run desktop` when you need the real window: sizing, the native
title bar, or anything the CSP affects.

## Layout

| Path | What |
| --- | --- |
| `src/app` | Next.js App Router — a single route rendering the tabbed shell |
| `src/components` | Tabs (POS, payroll, reports, employees, settings) and UI primitives |
| `src/lib/queries` | TanStack Query hooks; all Supabase access goes through these |
| `src/lib/supabase` | The one Supabase client factory |
| `src-tauri` | Rust crate, `tauri.conf.json`, icons, capabilities |
| `../shared` | Platform-agnostic pricing/payroll/types, shared with the mobile app |

## Notes

- `src-tauri/tauri.conf.json` pins the CSP's `connect-src` to this project's
  Supabase host. Change the project ref and you must change the CSP too.
- macOS targets are configured but unbuilt — installers cannot be
  cross-compiled from Windows, so that needs a Mac or a CI runner.
- See the repo root `CLAUDE.md` for the domain model, pricing rules, and
  commission math.
