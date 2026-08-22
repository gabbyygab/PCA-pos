# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

POS and payroll system for **PCA**, a car wash in the Philippines (~40 customers/day).

Two clients, one Supabase Postgres database:

| Client | Status | Users | Purpose |
| --- | --- | --- | --- |
| `web/` | scaffolded, being built now | Owner / admin | Desktop app (Tauri): POS, payroll, reports, service & price management |
| `mobile/` | built: POS + service record + expenses | Cashiers | Expo app: ring up sales, mark work done/refunded, record the day's costs; no reports |

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

`mobile/` is ringing up sales, recording the work, and logging the day's costs
— there is no payroll, reports, or settings screen to reach, and the restriction
is structural rather than a UI check. The cashier can edit a line (tap its name
on the Services screen) but never delete one: `delete_sale_items` is owner-only
in Postgres, so the app has nothing to call and offers no button that would
tap into a refusal. RLS is the real boundary: both clients ship the same anon key
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

### Promo discounts

A promo takes a **percentage off what the customer pays and nothing off what the
crew earns**. That asymmetry is the whole feature, and it is why the discount is
never subtracted from the price: `commission_centavos` derives from
`line_total_centavos`, so discounting in place would drag the employee cut down
with it. The crew washed the same car either way — the promo is the shop's
concession to the customer, not theirs.

So a line keeps two numbers where it used to keep one:

| Column | Meaning |
| --- | --- |
| `line_total_centavos` | the **pre-promo** price — the commission base |
| `discount_centavos` | pesos taken off, rounded **down** per line |
| `discount_rate_bp` | the percentage as applied (2000 = 20%), snapshotted |
| `net_total_centavos` | generated: what the customer actually owes |

Everything downstream then follows from which column a reader already used:
`effective_total_centavos` carries the **net**, so gross, net sales, average
ticket, best services, sales-by-size and the payment breakdown all fall to the
discounted figure; `effective_commission_centavos` still derives from the
**undiscounted** total, so payroll and the employee-cut tile never move. No
report had to learn the word "promo".

The discount is stored **per line** even though the cashier types one percentage
for the ticket ("20% off" is said about the car). Reports sum
`effective_total_centavos` off `sale_items` and never read
`sales.total_centavos`, so a header-only discount would be invisible to every
figure on the Reports tab. Per-line also means a promo survives `edit_sale_item`
and per-line refunds with no special handling.

Rounding is the **mirror image** of the commission split: a crew share rounds
**up** so an uneven split never shorts the crew, a discount rounds **down** so
an uneven percentage never hands back more than the promo promised. Each rounds
toward whoever did not choose the arithmetic. `lineDiscount` / `cartDiscount` in
`shared/lib/pricing.ts` mirror `create_sale` exactly.

`create_sale` takes `p_discount_rate_bp` (defaulting to 0) and applies it per
line. **The old 7-argument overload was dropped** — PostgREST resolves an RPC by
the argument names posted, so leaving it would have let a stale client silently
write no discount. Both clients must send the parameter.

`set_sale_discount(sale_id, rate_bp)` applies or removes a promo on an
already-rung ticket, for the case remembered at the counter after the lines are
in. It is separate from `edit_sale_ticket` because that function writes only
`sales` and is documented as never touching a money column. Like every other
correction, cashiers reach today only. The promo **rate** is not editable
through `edit_sale_item`, for the same reason `commission_rate_bp` is not: both
are snapshotted so nothing rewrites history after the fact.

A note on the live Payroll tab: its gross previously summed
`line_total_centavos` with no status filter, while `finalize_payroll_period`
sums `effective_total_centavos` for `done` lines only — so the screen and the
slip it generated disagreed about pending and refunded work. Both now read the
effective column, which also keeps the promo from inflating a payroll gross.

### Service status and refunds

A sale is not one atomic fact — the shop works a car one service at a time. Each
row in `sale_items` carries a **`status`**: `pending` → `done` → `refunded`.

**Only a `done` line is revenue.** Two generated columns,
`effective_total_centavos` and `effective_commission_centavos`, carry the
charged amount when the status is `done` and **0 otherwise** — so a `pending`
line is work in progress, not money, and contributes nothing to gross, net,
commission, or payroll until the crew closes it out. The rule is positive
rather than negative, which is what separates the two non-earning states:
`pending` is "not yet", `refunded` is "not any more". Every report sums those
columns, never `line_total_centavos`, which stays on the row as the record of
what was actually charged. See
`supabase/migrations/20260820_done_is_revenue.sql`.

Because the pending money is invisible in gross, Reports shows it as its own
figure (`pendingCentavos`) under the "In progress" tile — otherwise a busy
afternoon of unfinished work reads as a dead day.

A refund is **not a delete**. The line stays on the ticket, struck through, so
the receipt still shows what was ordered.

A **delete** is the other case: the line should never have been on the ticket
(rung up on the wrong car, double-tapped), so leaving it struck through would
misrepresent what the customer was offered. `delete_sale_items` removes the
rows and their crew shares for good, resums each affected header, and **voids a
ticket left with no lines** — an empty ticket is a sale that did not happen, not
a ₱0 one. It is **owner-only on every day**, deliberately narrower than
`set_service_status` and `edit_sale_item`: a cashier's correction path stays
"refund", which leaves the mistake visible.

Crew shares in `sale_item_commissions` get no such column — a generated column
cannot reach another table to see its line's status — so the reversal for shares
is applied by the queries that read them, which already join `sale_items`.

`sales.total_centavos` is resummed by `recalc_sale_totals` whenever a line
moves, so a ticket never claims money the shop has not earned or has given back.

`finalize_payroll_period` **also** filters on `status = 'done'`. It previously
filtered on nothing at all, so a finalized slip paid commission on refunded
work — invisible because the Payroll tab's live view applies the reversal in
TypeScript, so the screen and the slip it generated disagreed. Finalized slips
are not retroactively recomputed; reopening the week is the deliberate act that
does that.

A line's **quantity, unit price, and crew** are edited through
`edit_sale_item`, which recomputes the line total, its commission, and every
crew share, then resums the header. Null arguments mean "leave it alone"; an
explicit `p_employee_ids` replaces the crew wholesale. It never touches
`commission_rate_bp` — the rate is snapshotted at sale time precisely so that
editing a rate in Settings cannot rewrite history, and letting it be retyped
per line would reopen that hole from the other side. Cashiers may edit today's
sales only, the same reach `set_service_status` grants. See
`supabase/migrations/20260820_edit_sale_item.sql`.

Two fields on that modal are shown but **never editable**, for the same reason
in both cases: they are the record of what happened. The commission rate is one.
The **service name** is the other — it is what the receipt promised and what
every per-service report counts, so renaming it in place would let a ₱1,000
Package 4 quietly become a "Carwash" at the same price with nothing on the
ticket showing the swap. The RPC still accepts `p_service_name`; neither client
sends one. Rung up wrong is a **refund plus a re-ring**, which leaves both facts
visible.

The three fields that belong to the **car rather than the line** — payment
method, vehicle name, plate number — are edited through `edit_sale_ticket`,
a second RPC with the same shape and the same cashier-reaches-today guard.
Payment method is the one that had to be fixable: nothing in either client
could change it after Confirm, so a single mis-tap silently misfiled a whole
ticket's revenue in the Reports payment breakdown and its filter. It is
`security definer` for the same reason everything else here is — `sales` has an
owner-only UPDATE policy, so a cashier's direct write matches zero rows, and a
zero-row UPDATE is not an error. It never touches `vehicle_class`, `size`, or
any money column: the class and size are the scale every line was priced
against, so changing them is a re-ring, not an edit. Because both text columns
are nullable, null cannot mean both "leave it alone" and "clear it" — the
`p_clear_*` flags carry the second meaning, so a plate typed on the wrong car
can actually be taken back off. Both clients open these inside the service-line
modal rather than giving the ticket its own editor, and label them as applying
to the whole car. See `supabase/migrations/20260820_edit_sale_ticket.sql`.

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

RLS is **asymmetric**, and deliberately not the owner-only shape
`payroll_adjustments` uses. The cashier is who is standing at the counter when
the soap is bought, so **insert is open to any signed-in user** — an expense
only the owner can record is one that gets typed in late or not at all, and a
missing cost is what makes net sales wrong. **Reading stops at the Manila day in
progress** (`is_owner() or spent_on = today`), mirroring `sales_read`: enough
for the cashier to see what they just typed and not enter soap twice, not enough
to read the shop's spending history off a phone at the counter. **Update and
delete stay owner-only** — a cashier who mistypes tells the owner, which leaves
the correction visible instead of letting the device that typed a row rewrite
it. See `supabase/migrations/20260820_cashier_expenses.sql`.

The cashier app has an **Expenses screen** (its third tab) that is insert plus
today's sheet only: no history, no edit, no delete, matching what RLS grants.

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
- **`Modal` caps itself at the viewport and scrolls its own body.** The card is
  `max-h-[calc(100dvh-2rem)]` and splits into three bands: title and footer hold
  their place, only the middle scrolls. This lives in the shared component, not
  in each dialog, because the failure it prevents is silent and total — the page
  behind is `overflow-hidden`, so a dialog that grew past the screen put its
  Save button below the bottom edge with nothing left to scroll. Do not remove
  the cap, and do not let a dialog set its own height instead.

Reference for palette and layout feel: the price board image the owner supplied.

## App structure — tabbed dashboard

A single tabbed shell, not separate routes-with-reloads. Tabs:

1. **POS** — ring up a sale: pick vehicle class → size → service(s) → assign the
   crew → confirm total → save. Open-price services prompt for an amount.
   Fast and touch-friendly; this is the most-used screen. The cart captures an
   optional **vehicle name** ("Toyota Vios") alongside the plate; both are free
   text and both are optional.
2. **Services** — the record of work done: every car rung up in a **span of
   days** with its service lines beneath it, each markable done or refunded in
   place. Grouped by car, not a flat ledger, because the user is standing at a
   bay looking for a specific vehicle. Built responsive — the owner reads the
   same screen on the desktop and on a phone.

   Tapping a line opens a modal that edits its quantity, unit price, and crew
   (`edit_sale_item`), plus the car's payment method, vehicle name, and plate
   (`edit_sale_ticket`). The service name and the commission rate are shown
   there but never editable. Lines can be **ticked for batch actions** — mark done, or delete —
   with delete owner-only. Filterable by status and by **payment method**, and
   exportable as a PDF that carries whatever filters are on screen. The date
   range is owner-only: a cashier's RLS reaches today, so offering them a
   picker would show an empty yesterday and read as "the shop had no sales".
3. **Payroll** — Monday–Sunday week view per employee, showing sales worked and
   commission earned; finalize on Sunday and generate slips.
4. **Expenses** — the day's operating costs (soap, water, electricity, a
   repair). Add/edit in a modal, delete with a confirm; name and amount are
   required, description is optional. Grouped by the day spent.
5. **Reports** — a dashboard. Two card rows: money (gross, expenses, net,
   average ticket, employee cut) and shop floor (vehicles / cars / motorcycles
   served, work still in progress with what it is worth, refunds). Then best
   performing services, sales by vehicle size, employee productivity, **sales by
   payment method**, expense breakdown. Recharts, black/red themed.

   Filterable by **payment method**, which narrows every figure on the page and
   is carried into the exported PDF (and named on its masthead, so a printed
   sheet cannot be mistaken for an unfiltered one). The payment breakdown panel
   is deliberately *not* narrowed — it is what the filter is chosen from, and
   its rows toggle the filter on click.
6. **Employees** — add/edit employees (name is the minimum; keep it simple).
7. **Price Board** (`settings/`) — edit services, prices per size, package
   inclusions, commission rates; add new services and packages. Labelled for
   what it edits, since "Services" is now the record of work done.
8. **Accounts** (`accounts/`) — **owner-only**, hidden from the sidebar for
   anyone else. The two sign-ins and their passwords: the owner changes their
   own (re-entering the current one first) and sets the cashier's without
   knowing the old one. Kept out of the Price Board because that tab is about
   what the shop charges, not who can sign in.

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

**Bump `versionCode` in `mobile/app.json` on every release build.** Android
refuses to install an APK whose `versionCode` is not higher than the installed
one, so shipping a new `version` string alone produces an APK that every
cashier's phone silently rejects with "app not installed". `version` is the
human-readable name; `versionCode` is the integer Android actually compares.

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
- Passwords are changed in the **Accounts** tab, by two different mechanisms.
  The owner's own password goes through `auth.updateUser`, which acts on the
  caller's own token; the app re-checks the current password first, because the
  desktop sits unattended at the counter all day (the same argument as
  `ownerGate`). The **cashier's** password cannot work that way — changing
  another user's password is an admin operation, and the Admin API needs the
  service-role key, which bypasses RLS and so **can never ship in a client
  bundle**. That privilege lives in Postgres instead:
  `set_account_password` is `security definer`, owner-only, bcrypts the new
  password with `pgcrypto`, and **refuses to touch an owner account** — so it
  can only ever write a subordinate account, never grant its caller anything.
  It also deletes that user's refresh tokens, signing the cashier's phone out
  rather than leaving it running on a password that no longer exists.
  `list_accounts` exists because `auth.users` is not exposed through PostgREST;
  it returns id/email/role only, never password material.
  See `supabase/migrations/20260820_account_passwords.sql`.
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
- **Tauri compiles the static export into the executable**; it does not copy it
  beside one. A bundle's `Resources` therefore holds nothing but the icon --
  `icon.icns` on macOS, `icon.ico` on Windows -- and that is what a *working*
  build looks like, not a broken one. To check that a build really carries the
  app, grep the binary for `_next/static` and for the Supabase host, not the
  Resources directory.
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
