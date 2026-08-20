# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

POS and payroll system for **PCA**, a car wash in the Philippines (~40 customers/day).

Two clients, one Supabase Postgres database:

| Client | Status | Users | Purpose |
| --- | --- | --- | --- |
| `web/` | scaffolded, being built now | Owner / admin | Desktop app (Tauri): POS, payroll, reports, service & price management |
| `mobile/` | built: POS + service record | Cashiers | Expo app: ring up sales, mark work done/refunded; no reports |

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

From `mobile/` (the cashier app):

```bash
npm start             # Expo dev server; scan the QR with Expo Go
npm run android       # open on a connected device or emulator
npm run typecheck     # tsc --noEmit
npx expo install --check   # verify dependencies still match Expo SDK 54
```

No test framework is installed yet.

## Architecture

### The shared/ boundary

`shared/` holds code that both the web dashboard and the Expo cashier app
import. Each reaches it through the `@shared/*` alias — `web/tsconfig.json` and
`mobile/tsconfig.json` (`paths` + `include`, pointing at `../shared/**/*.ts`).

Anything in `shared/` must stay platform-agnostic — no React, no DOM, no Next.js,
no `window`/`document`, no Node built-ins. React Native has none of those. When
adding pricing rules, payroll math, validation, or database types, put them in
`shared/`, not in `web/src/`. This is what keeps the mobile app from being a
rewrite.

Pricing resolution and commission math in particular **must** live in `shared/lib/`,
because the cashier app computes the same totals.

### The cashier app

`mobile/` is ringing up sales and recording the work — there is no payroll,
reports, or settings screen to reach, and the restriction is structural rather
than a UI check. RLS is the real boundary: both clients ship the same anon key
to the device, so what stops a cashier reading payroll is their JWT, never this
bundle's lack of a screen.

Two screens means a switch between them, and it is a plain pair of buttons in
`App.tsx`, not a navigation library — with two destinations and no deep linking
or history to model, a navigator is a dependency for a boolean. Both screens
stay mounted behind `display: none`, because unmounting the POS to glance at the
service record would throw an in-progress cart away.

It mirrors `web/src/components/pos/PosTab.tsx` step for step — class, size,
services, crew, confirm — but stacked for one thumb: the grid owns the screen
and the cart is a bottom sheet, because a phone has no room for a permanent
sidebar. Where the dashboard's rules call for a `Combobox` (the crew picker),
mobile uses a searchable bottom sheet, which is the same idea for touch.
Queries under `mobile/src/lib/queries/` are the dashboard's minus every
owner-only mutation.

Two React Native differences that are load-bearing:

- The session is stored in **AsyncStorage**, not local storage, and
  auto-refresh is bound to `AppState`. A backgrounded native app is frozen, so
  without that the first sale after a break fails on an expired token.
- **Metro needs `shared/` spelled out** in `mobile/metro.config.js` (watch
  folder + `@shared` alias), exactly as Turbopack does in `web/next.config.ts`.
  The tsconfig `paths` entry only satisfies the type checker; without the Metro
  config the app typechecks and then fails to bundle.

Dependencies are pinned to **Expo SDK 54**. `babel-preset-expo` must stay
`~54.0.x` — a newer major leaves the private class fields in React Native's own
modules untranspiled, and the Hermes bytecode step then fails with "private
properties are not supported". `npx expo install --check` catches drift.

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

Sizes are **rows in `vehicle_sizes`, not an enum** — the owner adds, renames,
reorders, hides, and deletes them in Settings › Sizes, per class. The scales
below are the seeded defaults, not a fixed set; adding a sixth car size or a
fourth bike tier is a Settings action, not a migration.

Two rules follow from that, and both are load-bearing:

- `service_prices` keys on `size_id`, so renaming a size keeps its prices.
- `sales.size` and `sale_items.size` store the **label as printed at sale
  time** (plain text, no foreign key), so renaming or retiring a size never
  rewrites a past sale or a finalized slip. Reports group by that stored label.
  A size that any sale printed cannot be deleted — a trigger raises
  `SIZE_IN_USE` and the UI offers "hide" instead.

`create_sale` takes the size **label** and validates it against the class's
scale, so a typo cannot invent a size.

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

### Service status and refunds

A sale is not one atomic fact — the shop works a car one service at a time. Each
row in `sale_items` carries a **`status`**: `pending` → `done` → `refunded`.

A refund is **not a delete**. The line stays on the ticket, struck through, so
the receipt still shows what was ordered. What changes is that the money stops
counting: two generated columns, `effective_total_centavos` and
`effective_commission_centavos`, read 0 once the line is refunded, and every
report sums **those**, never `line_total_centavos`. The original price stays on
the row as the record of what was actually charged.

Crew shares in `sale_item_commissions` get no such column — a generated column
cannot reach another table to see its line's status — so the reversal for shares
is applied by the queries that read them, which already join `sale_items`.

`sales.total_centavos` is resummed by `recalc_sale_totals` whenever a line
moves, so a ticket never claims money the shop gave back.

Status is written **only** through the `set_service_status` RPC. `sale_items`
has an owner-only UPDATE policy, so a cashier's direct write would match zero
rows — and a zero-row UPDATE is not an error, so the tap would appear to work
and change nothing. This is the same trap `create_sale` fell into. The RPC is
`security definer` and guards itself: it checks `auth.uid()`, refuses a voided
sale, and limits a cashier to **today's** sales (`PAST_DAY_OWNER_ONLY`),
matching their existing read rule. Cashiers may move a line in any direction
while the car is on the lot, so a mis-tap is fixable without the owner.

**PostgREST exposes every `public` function as an RPC, and Postgres grants
EXECUTE to PUBLIC by default.** Revoking from `anon` alone does nothing — the
privilege resolves through PUBLIC, so PUBLIC is what must be revoked and the
intended role granted back. `recalc_sale_totals` is internal-only;
`create_sale`, `set_service_status`, and `service_sale_counts` are
`authenticated`-only.

### Expenses and net sales

Daily operating costs live in their own `expenses` table — free-text `name`,
optional `description`, positive `amount_centavos`, and a plain `spent_on`
**date** (not a timestamp, so an 11pm bill stays on its own day).

An expense is **not a negative sale**. Folding one into `sales` would move gross
revenue, every service's reported performance, and every crew member's
commission with it, since commission is computed off the line total. So the
ledger stands apart from the sales history and is subtracted only at the
reporting boundary:

```
net sales = gross sales - expenses
```

Commission is deliberately **not** subtracted there. The employee cut is already
carried by the payroll ledger and shown as its own tile, so taking it out of net
as well would count it twice for an owner reading both screens.

Expense names are free text on purpose — the owner types whatever the receipt
says. The add dialog offers previously used names as one-tap fills so
"Electricity" does not become three spellings that report as three lines.

RLS is owner-only in every direction, matching `payroll_adjustments`: a cashier
rings up sales, and what the shop spends is neither theirs to read nor to write.

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
2. **Services** — the record of work done: every car rung up on a day with its
   service lines beneath it, each markable done or refunded in place. Grouped by
   car, not a flat ledger, because the user is standing at a bay looking for a
   specific vehicle. Built responsive — the owner reads the same screen on the
   desktop and on a phone.
3. **Payroll** — Monday–Sunday week view per employee, showing sales worked and
   commission earned; finalize on Sunday and generate slips.
4. **Expenses** — the day's operating costs (soap, water, electricity, a
   repair). Add/edit in a modal, delete with a confirm; name and amount are
   required, description is optional. Grouped by the day spent.
5. **Reports** — a dashboard. Two card rows: money (gross, expenses, net,
   average ticket, employee cut) and shop floor (vehicles / cars / motorcycles
   served, work still in progress, refunds). Then best performing services,
   sales by vehicle size, employee productivity, expense breakdown. Recharts,
   black/red themed.
6. **Employees** — add/edit employees (name is the minimum; keep it simple).
7. **Price Board** (`settings/`) — edit services, prices per size, package
   inclusions, commission rates; add new services and packages. Labelled for
   what it edits, since "Services" is now the record of work done.

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

## Building the APK

`mobile/` is a managed Expo project: there is no `android/` in git. `npx expo
prebuild --platform android` generates it, and **anything hand-edited there is
overwritten the next time it runs** — changes that must survive belong in a
config plugin under `mobile/plugins/`.

Two things make a local build work, and both are Windows problems:

- **Build from a short path, not from the repo.** The C++ codegen for the new
  architecture writes object paths long enough that
  `C:\Users\...\OneDrive\Documents\Desktop\pcapp\...` overruns Windows'
  260-character limit, and `ninja` fails with "Filename longer than 260
  characters". `LongPathsEnabled` is already 1 in the registry — the NDK
  toolchain does not honour it. Copy `mobile/` and `shared/` to something like
  `C:\pb`, run `npm install` there (do not copy `node_modules`; a robocopy of it
  silently drops files and breaks the Expo CLI), then prebuild and build.
- **`ANDROID_HOME` is not set globally.** The SDK lives at
  `C:\Users\GabrielD\Android\Sdk` (cmdline-tools, platform-tools, API 36,
  build-tools 36.0.0; Gradle fetches the NDK and CMake itself). Export it for
  the build, or set it permanently.

```bash
cd /c/pb/mobile/android && ./gradlew assembleRelease --no-daemon
# -> app/build/outputs/apk/release/app-release.apk
```

### Signing

Expo's template signs *release* builds with the debug keystore. That APK
installs, but Android only accepts an upgrade signed by the same key, so
shipping the shared debug key would strand every cashier's install on the
version they already have. `mobile/plugins/withReleaseSigning.js` replaces it at
prebuild time, reading `android/keystore.properties`.

The master copies live in **`mobile/signing/`**, which prebuild never touches —
copy both into `android/` before building:

```bash
cp mobile/signing/pca-release.keystore <build>/android/app/
cp mobile/signing/keystore.properties  <build>/android/
```

Do not keep the only copy inside `android/`: that directory is regenerated, and
`expo prebuild --clean` would delete the signing key with it.

The keystore and that properties file are **gitignored** — the repo describes
how to sign, never the secret. They are not recoverable if lost: a lost key
means no signed upgrade path for installed apps, only an uninstall and
reinstall. Keep a backup off this machine.

If `keystore.properties` is absent the build falls back to the debug key, so a
fresh clone still compiles; a real release needs the file. Confirm which key
signed an APK with:

```bash
"$ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --print-certs <apk>
# release builds must NOT read "CN=Android Debug"
```

Recreate the keystore (same alias and passwords as the existing one):

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore pca-release.keystore \
  -alias pca-release -keyalg RSA -keysize 2048 -validity 10000
```

## The macOS build

**It cannot be built on the Windows machine.** Two independent blockers, neither
of them a missing package:

- Tauri links against Apple's own frameworks (WebKit, AppKit), which ship only
  inside Xcode. Apple licenses Xcode for use on Apple hardware, so extracting
  the SDK to cross-compile is a licence violation, not a workaround.
- The `.dmg` is assembled by `hdiutil`, an Apple-only tool. Even with a working
  cross-linker the bundling step cannot run here.

So it is built on a real Mac — either a GitHub `macos-latest` runner
(`.github/workflows/desktop-macos.yml`) or a Mac you have in hand.

The workflow builds `universal-apple-darwin`: one binary carrying both the Apple
silicon and Intel slices, so a single `.dmg` runs natively on any Mac and nobody
has to know which chip is inside. Trigger it from the Actions tab
("Desktop (macOS)" → Run workflow) or by pushing a `v*` tag; the `.dmg` and
`.app` come back as a build artifact.

**Set the two repo secrets first** — Settings → Secrets and variables → Actions:
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Next.js inlines
these into the JS **at build time**, so a build without them produces an app
that points at `undefined` and fails every login with no obvious cause. Both are
browser-exposed by design; the `sbp_…` access token is *not* one of these and
must never be added.

On a Mac in hand, the same build is:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
cd web && npm ci
npx tauri build --target universal-apple-darwin --bundles app dmg
# -> src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
```

### Testing it

The build is **unsigned** — there is no Apple Developer account behind it — so
Gatekeeper blocks it on first open. This is expected, not a broken build.

macOS attaches a `com.apple.quarantine` flag to anything downloaded, and for an
unsigned app that means "damaged and can't be opened" (misleading — it is not
damaged) or "unidentified developer". The fix, run once by whoever tests it:

```bash
xattr -dr com.apple.quarantine "/Applications/PCA POS.app"
open "/Applications/PCA POS.app"
```

Right-click → Open works on some macOS versions, and System Settings → Privacy &
Security → "Open Anyway" works on others; the `xattr` line works on all of them.

Where to test, cheapest first:

1. **A Mac you or the shop already own** — the only way to confirm the real
   thing. Needs macOS 10.15+, which matches `minimumSystemVersion`.
2. **A borrowed Mac** — the app is self-contained; nothing is installed beyond
   dragging it to Applications, and WebView2 has no macOS equivalent to set up.
3. **A rented cloud Mac** (MacStadium, Scaleway, AWS EC2 mac instances) — hourly
   and remote-desktop capable. Overkill unless macOS becomes a supported target.

A macOS VM on the Windows machine is **not** a route: Apple's licence permits
macOS virtualisation only on Apple hardware, and the app needs a real GPU-backed
WKWebView to be worth testing anyway.

What to check once it opens, in order — each depends on the last:

| Step | Confirms |
| --- | --- |
| Window opens, dark, titled "PCA — Car Wash POS" | The bundle and static export are intact |
| Login screen renders and accepts the owner account | The CSP reaches Supabase over https **and** wss, and the secrets were baked in |
| POS tab rings up a sale end to end | `create_sale` works from WKWebView, not just Chromium |
| Sidebar badge counts today's open work | Local storage persists in the Mac webview |
| Reports tab draws its charts | Recharts renders under WKWebView |

The webview is the real difference: Windows runs Chromium (WebView2), macOS runs
Safari's WKWebView. A CSS or JS feature that works on one can fail on the other,
which is exactly what this pass is looking for.

## Notes

- Windows + OneDrive: `npm` prints `EPERM ... rmdir` cleanup warnings on install.
  They are OneDrive file locks during temp cleanup and do not affect the result.
- **The schema is applied** to Supabase project `POS` (ref `uxdomhpxhcvaqqpryloq`,
  ap-southeast-1). The full board is seeded. `custom_vehicle_sizes` is the
  migration that replaced the `vehicle_size` enum with the `vehicle_sizes`
  table; it also cleared the handful of test sales made before the cutover, so
  the sales history starts empty.
- Money is written by RPC, not by client inserts. `create_sale` computes every
  line total and commission in Postgres and writes the sale plus its lines in
  one transaction, so a tampered client cannot post its own totals.
  `finalize_payroll_period` / `reopen_payroll_period` handle the weekly slips.
- Commission rates are stored as **basis points** (`4000` = 40%), keeping the
  rate an integer alongside the centavos.
- RLS reads the role off the JWT: `app_metadata.role = 'owner'` gets everything,
  anyone else is treated as a cashier — may insert sales and read only today's,
  and cannot read payroll at all. Two accounts exist: the owner
  (`pca.payroll.pos@gmail.com`, `role: owner`) and the cashier
  (`cashier@pca.com` / `PCA2026!`, `role: cashier`), both email-confirmed.
  A new user gets its role by setting `app_metadata.role` in Supabase Auth.
- `create_sale` is **`security definer`**. It has to be: the function ends by
  writing the summed totals back onto the `sales` row, and `sales` has an
  owner-only UPDATE policy, so as the caller that write silently matched no
  row for a cashier. A zero-row UPDATE is not an error, so the sale succeeded
  with correct line items and a **₱0 header** — invisible until a non-owner
  account existed. Running as the definer, the function guards itself with an
  `auth.uid()` check and validates every crew id against active employees,
  since RLS is no longer doing that for it. See
  `supabase/migrations/20260819_cashier_sale_totals.sql`.
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
