# mobile/

The **cashier** app: an Expo (React Native) client whose only job is ringing up
sales. No payroll, no reports, no settings — those belong to the owner's
desktop app in `web/`.

## Running it

```bash
cd mobile
npm install
npm start            # Expo dev server; scan the QR with Expo Go
npm run android      # or open straight on a connected device / emulator
npm run typecheck    # tsc --noEmit
```

The Supabase URL and anon key live in `app.json` under `expo.extra`. They are
browser/device-exposed by design — row-level security is what protects the
data, not the key. (The account-wide `sbp_…` access token is a different thing
entirely and must never appear here.)

## Signing in

| Account | Password | Sees |
| --- | --- | --- |
| `cashier@pca.com` | `PCA2026!` | POS only |

The role is read off the JWT (`app_metadata.role`), the same claim RLS checks.
Anyone who is not `owner` is treated as a cashier.

## What a cashier can and cannot do

The restriction is enforced in Postgres, not in this bundle — both clients ship
the same anon key to the device, so the UI is not a security boundary:

- **May** read the catalog, sizes, and employee roster; insert sales through
  `create_sale`; read back **only today's** sales.
- **May not** read payroll at all, edit any service or price, or finalize a
  week. Those policies are `is_owner()`.

This app simply has no payroll or settings screen to reach.

## How it relates to the other two folders

```
shared/   pricing, commission split, currency, payroll dates, DB types
  ├── web/     owner dashboard (Next.js + Tauri)
  └── mobile/  cashier POS (this folder)
```

Every peso figure shown here comes from `shared/lib/` — the same functions the
dashboard uses and the same math `create_sale` mirrors in SQL. That is the
point of the `shared/` boundary: the cashier app must compute the totals the
dashboard would, or a sale and its payroll stop agreeing.

Nothing in `shared/` may import React, the DOM, or Node built-ins, because this
app has none of them.

### Metro needs `shared/` spelled out

`shared/` sits outside this folder, so `metro.config.js` adds it as a watch
folder and aliases `@shared` to it. The `tsconfig.json` `paths` entry only
satisfies the type checker — without the Metro config the app typechecks and
then fails to bundle.

## Notes

- **Session storage is AsyncStorage**, not local storage — React Native has no
  `window.localStorage`. Auto-refresh is also bound to `AppState`: a
  backgrounded native app is frozen, so without that the first sale after a
  break would fail on an expired token.
- **Dependency versions are pinned to Expo SDK 54.** `babel-preset-expo` in
  particular must stay `~54.0.x`; a newer major does not transpile the private
  class fields in React Native's own modules, and the Hermes compiler then
  fails the bytecode step with "private properties are not supported". Run
  `npx expo install --check` after touching dependencies.
- The app is portrait-only and dark: it inherits the shop's price-board palette
  from `src/theme.ts`, which mirrors the dashboard's `globals.css` tokens.
  React Native cannot fake a condensed face, so the italic board headers carry
  their look through weight and tracking instead.
- Touch targets are at least 48px (`TAP` in the theme). The cashier works
  one-handed, often with wet hands, beside a running wash bay.
- The PCA logo is a placeholder block on the login screen; drop the real mark
  in when the owner supplies it.
