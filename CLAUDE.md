# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

POS and payroll system for **PCA**, a car wash in the Philippines (~40 customers/day).

Two clients, one Supabase Postgres database:

| Client | Status | Users | Purpose |
| --- | --- | --- | --- |
| `web/` | scaffolded, being built now | Owner / admin | Desktop app (Tauri): POS, payroll, reports, service & price management |
| `mobile/` | not built yet | Cashiers | Expo app: ring up sales only, no reports |

The desktop app is **not deployed to a public host**. It ships as a native
Tauri app: Next.js is statically exported (`output: 'export'`) and the bundle is
loaded from disk by the OS webview, so there is no Node server at runtime — only
`next dev` on localhost:3000 during development.

The database is hosted Supabase, so data is reachable online and the future
mobile app reads the same tables. Both clients are therefore online-only; a
dropped connection stops the POS.

## Commands

All commands run from `web/`:

```bash
npm run dev           # browser dev server at localhost:3000
npm run desktop       # Tauri dev: native window against the dev server
npm run build         # static export to web/out; also runs a full TypeScript check
npm run desktop:build # build + package installers into src-tauri/target/release/bundle
npm run lint          # eslint
npx tsc --noEmit      # typecheck alone, faster than a full build
```

No test framework is installed yet.

## Architecture

### The shared/ boundary

`shared/` holds code that both the web dashboard and the future Expo app import.
`web/` reaches it through the `@shared/*` alias (`web/tsconfig.json` `paths` +
`include`, which points at `../shared/**/*.ts`).

Anything in `shared/` must stay platform-agnostic — no React, no DOM, no Next.js,
no `window`/`document`, no Node built-ins. React Native has none of those. When
adding pricing rules, payroll math, validation, or database types, put them in
`shared/`, not in `web/src/`. This is what keeps the mobile app from being a
rewrite.

Pricing resolution and commission math in particular **must** live in `shared/lib/`,
because the cashier app computes the same totals.

### Money

All money is stored and passed around as **integer centavos**, never floats.
`15000` means PHP 150.00. Convert only at the display boundary via
`shared/lib/currency.ts` (`formatPeso`, `pesosToCentavos`, `centavosToPesos`).
Floats silently corrupt payroll totals; do not introduce them.

Commission is computed with integer math and `Math.round`, never float
multiplication left unrounded.

### Supabase clients

One factory: `web/src/lib/supabase/client.ts`, built on plain
`@supabase/supabase-js` and memoized to a single instance.

There is no server client and no middleware — a static export has neither. The
session lives in local storage and supabase-js refreshes it itself
(`persistSession` + `autoRefreshToken`). `detectSessionInUrl` is off because a
webview has no OAuth redirect to parse. Do not reintroduce `@supabase/ssr`,
Server Actions, or Route Handlers: `output: 'export'` cannot build them, and the
React Native client has no server either.

Access control lives in Postgres row-level security, not in the UI. Cashiers
must be able to insert sales while being unable to read payroll — enforce that
with RLS policies, since both clients ship the same anon key to the device.

### Historical price integrity

When a service price changes, past sales must keep the price charged at the
time of sale. Sale line items store their own price **and their own commission
rate and commission amount**; they do not join to the current service price or
the current rate for historical reporting. Editing a price or a rate in Settings
must never retroactively change a past sale or a finalized payroll slip.

## Domain model

### Vehicle classes and sizes

Two distinct vehicle classes. They do not share a size scale.

**Car** — five sizes:

| Size | Meaning |
| --- | --- |
| S | Sedan, hatchback |
| M | Crossover |
| L | SUV, pick up |
| XL | Modified pick up, van |
| XXL | Large van / truck |

**Motorcycle** — three flat tiers, no packages, no size-priced services:

| Tier | Price |
| --- | --- |
| Small | 120 |
| Medium | 150 |
| Big Bike | 200 |

### Service catalog

Three categories:

- **`basic`** — Basic Carwash. Priced per car size. Commission rate 40%.
- **`package`** — Packages 1–6. Priced per car size. Commission rate 30%.
- **`addon`** — Other Services. Commission rate 40% (same as basic; it is
  non-package work). Some are size-priced, some are open-price.

A package is a named bundle of **inclusions** (Carwash, Basic Interior, Vacuum,
Tire Black, Hand Wax, Machine Wax, Engine Wash, Clay Bar). Inclusions are
descriptive — they print on the receipt and are editable per package — they do
not each carry their own price. The package price is a single size-priced amount.

**Open-price services**: some Other Services have no fixed price on the board
(Graphene coating is blank, Interior/Exterior Detailing are "and up",
Glass Detailing M is ambiguous). These are flagged `is_open_price` and the
cashier types the amount at sale time. Do not invent prices for them.

### Seed data

Seed exactly this, from the shop's price board. All values below are **pesos**;
store them as centavos (multiply by 100).

**Basic Carwash** (`basic`, 40%) — Carwash, Basic Interior, Vacuum, Tire Black

| S | M | L | XL | XXL |
| --- | --- | --- | --- | --- |
| 140 | 170 | 200 | 230 | 250 |

**Package 1** (`package`, 30%) — Carwash, Basic Interior, Vacuum, Tire Black, Hand Wax

| S | M | L | XL | XXL |
| --- | --- | --- | --- | --- |
| 400 | 500 | 600 | 700 | 800 |

**Package 2** (`package`, 30%) — Carwash, Basic Interior, Vacuum, Tire Black, Machine Wax

| S | M | L | XL | XXL |
| --- | --- | --- | --- | --- |
| 600 | 700 | 800 | 900 | 1000 |

**Package 3** (`package`, 30%) — Carwash, Basic Interior, Vacuum, Tire Black, Hand Wax, Engine Wash

| S | M | L | XL | XXL |
| --- | --- | --- | --- | --- |
| 750 | 850 | 950 | 1050 | 1100 |

**Package 4** (`package`, 30%) — Carwash, Basic Interior, Vacuum, Tire Black, Machine Wax, Engine Wash

| S | M | L | XL | XXL |
| --- | --- | --- | --- | --- |
| 1000 | 1100 | 1200 | 1300 | 1400 |

**Package 5** (`package`, 30%) — Carwash, Basic Interior, Vacuum, Tire Black, Machine Wax, Clay Bar

| S | M | L | XL | XXL |
| --- | --- | --- | --- | --- |
| 900 | 1050 | 1100 | 1200 | 1300 |

**Package 6** (`package`, 30%) — Carwash, Vacuum, Basic Interior, Tire Black, Engine Wash

| S | M | L | XL | XXL |
| --- | --- | --- | --- | --- |
| 550 | 650 | 750 | 850 | 950 |

**Motorcycle Wash** (`basic`, 40%) — flat, motorcycle class

| Small | Medium | Big Bike |
| --- | --- | --- |
| 120 | 150 | 200 |

**Other Services** (`addon`, 40%)

| Service | S | M | L | XL | XXL | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Back to Zero | 500 | 500 | 500 | 500 | 500 | flat across sizes |
| Headlight Restoration (with Carwash, Basic Interior, Vacuum, Tire Black) | 1000 | 1050 | 1150 | 1180 | — | XXL not on board; leave null |
| Acid Rain Removal | 1000 | 1100 | 1150 | 1300 | — | XXL not on board; leave null |
| Glass Detailing (Acid Removal and Wax) | 1300 | — | 1550 | 1600 | — | **M is unresolved** — board reads "400", likely a typo for 1400. Leave M null until the owner confirms. |
| Interior Detailing | open price | | | | | board says "3500 AND UP" |
| Exterior Detailing | open price | | | | | board says "3K AND UP" |
| Coating — Graphene | open price | | | | | no price on board |
| Coating — Exterior Detailing and Basic Interior | open price | | | | | board says "STARTING 13K" |

Every seeded service, price, and commission rate is **editable in the Settings
tab** — including adding new services, adding or removing package inclusions,
renaming packages, and changing any price or rate. Seeds are a starting point,
not hardcoded constants. Never hardcode a price in a component.

### Commission / employee cut

- Non-package work (`basic`, `addon`): employee earns **40%** of the line total.
- Package work (`package`): employee earns **30%** of the line total.

**A crew of one or more per car.** Each sale is assigned to the employees who
worked it, and the line's cut is **split evenly among them**: a ₱200 line at 40%
is ₱80, so three employees take ₱26.67 each.

Each share is rounded **up** (`Math.ceil`), so an uneven split never shorts the
crew. The shares can therefore total a centavo or two more than the raw rate
(₱80.01 above) — that overage is deliberate, and `sales.commission_centavos`
stores the **summed shares actually paid**, so a sale and its payroll always
reconcile. Never re-derive commission from the rate for reporting; read the
stored shares.

Shares live in `sale_item_commissions`, one row per (line, employee), each
snapshotting its `crew_size`. `sale_items` stays **one row per service** —
fanning it out per employee would multiply gross revenue by the crew size.

Gross credits each crew member the **full line**: it measures work done on the
car, while only commission is split. Two people on a ₱950 package each show
₱950 gross and ₱142.50 commission.

`sales.employee_id` and `sale_items.employee_id` still hold the **first** member
of the crew, so anything reading them keeps working; they mean "who led this
car", not "who is owed".

Rates are stored **per service** (defaulting to 40/30 by category) and copied
onto the sale line at sale time, so changing a rate later does not alter history.

The split math is `shareOfCommission` / `cartShare` in `shared/lib/pricing.ts`,
mirrored exactly by `create_sale` in Postgres — the cashier app must compute
the same numbers.

### Payroll period

**Monday → Sunday.** The week is generated for Monday through Sunday; on Sunday
the payroll is finalized and slips are generated. A finalized slip snapshots its
totals and does not recompute when past data or rates change. Reopening a
finalized week must be explicit and deliberate.

## Design

The app is styled after the shop's own price board: **black and red, modern,
minimalist**.

- Background: near-black (`#0A0A0A` / `#111`), panels a touch lighter
- Accent: the board's red (`#E11414`-ish); used for the active tab, primary
  buttons, totals, and the angled/slanted header motif from the board
- Text: white and off-white; prices in a heavier weight
- Italic, condensed, uppercase headers echo the board — but keep body text
  plainly legible
- Dense, tappable POS grid — the cashier rings up ~40 cars/day and the mobile
  app will reuse this visual language
- The PCA logo is being provided later; leave a slot for it in the sidebar/header

### Form controls

Everything lives in `web/src/components/ui/` — read its `README.md` before
adding a control. Two rules that are load-bearing:

- **Never use a native `<select>`.** The OS draws its popup and ignores every
  token in `globals.css`, which shatters the board surface on Windows.
- **Any list of employees, services, or anything else the owner adds to in
  Settings uses `Combobox`, not `Select` — as does every multi-select.**
  `Select` is only for short fixed lists (payment method, vehicle class).
  `Combobox` searches anywhere in the label and accepts `multiple`; `Select` is
  single-value and must not be overloaded. Do not hand-roll a chip row or a
  checkbox list where a `Combobox` belongs.

Reference for palette and layout feel: the price board image the owner supplied.

## App structure — tabbed dashboard

A single tabbed shell, not separate routes-with-reloads. Tabs:

1. **POS** — ring up a sale: pick vehicle class → size → service(s) → assign the
   crew → confirm total → save. Open-price services prompt for an amount.
   Fast and touch-friendly; this is the most-used screen.
2. **Payroll** — Monday–Sunday week view per employee, showing sales worked and
   commission earned; finalize on Sunday and generate slips.
3. **Reports** — gross sales (daily/weekly/monthly), best performing services,
   sales by vehicle size, employee productivity. Recharts, black/red themed.
4. **Employees** — add/edit employees (name is the minimum; keep it simple).
5. **Settings / Services** — edit services, prices per size, package inclusions,
   commission rates; add new services and packages.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind v4
· Supabase (`@supabase/supabase-js`) · Tauri v2 · TanStack Query ·
Zustand · Recharts · date-fns · lucide-react

## Environment

`web/.env.local` (gitignored; template at `web/.env.local.example`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Both are browser-exposed by design. The Supabase **access token** (`sbp_…`) is
different — it is account-wide admin credentials, belongs only in the MCP server
config, and must never appear in this repo.

## Notes

- Windows + OneDrive: `npm` prints `EPERM ... rmdir` cleanup warnings on install.
  They are OneDrive file locks during temp cleanup and do not affect the result.
- **The schema is applied** to Supabase project `POS` (ref `uxdomhpxhcvaqqpryloq`,
  ap-southeast-1), across four migrations: `core_schema`, `rls_policies`,
  `sale_and_payroll_rpcs`, `seed_catalog`. The full board is seeded.
- Money is written by RPC, not by client inserts. `create_sale` computes every
  line total and commission in Postgres and writes the sale plus its lines in
  one transaction, so a tampered client cannot post its own totals.
  `finalize_payroll_period` / `reopen_payroll_period` handle the weekly slips.
- Commission rates are stored as **basis points** (`4000` = 40%), keeping the
  rate an integer alongside the centavos.
- RLS reads the role off the JWT: `app_metadata.role = 'owner'` gets everything,
  anyone else is treated as a cashier — may insert sales and read only today's,
  and cannot read payroll at all. **No users exist yet**; create the owner in
  Supabase Auth and set that `app_metadata` role before the app is usable.
- `shared/` is aliased for Turbopack in `web/next.config.ts` (`resolveAlias` +
  `root`), not just in `tsconfig.json` — the tsconfig `paths` entry only
  satisfies the type checker.
- The desktop shell is **Tauri v2** in `web/src-tauri/` (Rust crate `pca-pos`,
  bundle id `ph.pca.pos`). `tauri.conf.json` points `frontendDist` at `../out`
  and `devUrl` at localhost:3000. Building installers needs the Rust toolchain
  installed on the build machine; the packaged app needs only WebView2, which
  Windows 11 already ships.
- The Tauri CSP pins `connect-src` to the project's own Supabase host. **If the
  Supabase project ref ever changes, update the CSP** or every request fails.
- macOS is configured (`dmg`/`app` targets, `icon.icns`) but has never been
  built — installers cannot be cross-compiled from Windows, so a Mac build needs
  a Mac or a `macos-latest` CI runner.
- Icons in `src-tauri/icons/` were generated from a 429×429 logo and are
  upscaled at the larger sizes; regenerate with `npx tauri icon <file>` from a
  1024×1024 source when the real logo arrives.
- The board was confirmed to have no typos, so Glass Detailing **M** is seeded
  as printed (₱400). The blank XXL cells for Headlight Restoration and Acid Rain
  Removal have no price row at all, which the UI reads as "not offered".
