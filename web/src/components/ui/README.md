# ui/ — form controls

Field primitives for the PCA dashboard. Everything here is `web/`-only (it uses
DOM events and Tailwind classes); pricing and payroll math lives in `shared/`.

| Component | Use for |
| --- | --- |
| `Field` | Label + control + message wrapper. Wraps every other control. |
| `Input` | Single-line text, money, and rate entry. |
| `Select` | Choosing one option from a short, fixed list. Replaces native `<select>`. |
| `Combobox` | **Searchable** dropdown. Any list of people or catalog entries, and every multi-select. |
| `Button` | Actions. |
| `Panel` / `PanelHeader` / `SlashRule` | Page and section chrome. |
| `Badge` | A count on a nav item. Not a form control; see below. |

## Picking between `Select` and `Combobox`

**Rule: if the list is of employees, services, or anything else the owner can
add to in Settings, use `Combobox`. If the user picks more than one value, use
`Combobox` — `Select` is single-value and must not be overloaded.**

`Select` is for a short list that ships with the app and never grows: payment
method, vehicle class, a commission-rate preset. Six options, known at build
time, arrow keys are enough.

`Combobox` is for a list that grows with the business. The crew picker is the
case that forced it — the roster gets longer every time the shop hires, and the
cashier assigns a crew ~40 times a day. Past roughly a dozen options, `Select`'s
typeahead stops being enough: it only matches the *start* of a label, so an
employee known by surname is unreachable without arrowing the whole list.
`Combobox` matches anywhere in the label and strips accents, so `jose` finds
`José`.

Do not reach for a chip row, a checkbox list, or a native `<select multiple>`
for these. One control, one set of keyboard rules, one look — the cashier
learns it once and the Expo app reuses it.

| | `Select` | `Combobox` |
| --- | --- | --- |
| Values | exactly one | one or many (`multiple`) |
| Filtering | typeahead, prefix-only | full-text input, matches anywhere |
| List size it suits | under ~12, fixed | any, especially data-driven |
| ARIA pattern | listbox (focus on trigger) | combobox (focus in `<input>`) |

## `Combobox`

Focus lives in a real `<input>`, which is the substantive difference from
`Select`: typing is native, so IMEs, mobile keyboards, and dictation all work,
while `aria-activedescendant` points at the highlighted row.

| Key | Behaviour |
| --- | --- |
| type | Filters the list; matches anywhere in the label or `detail` |
| `↓` / `↑` | Open the list, or move to the next/previous enabled option |
| `Enter` | Commit the highlighted option — or the only match, if just one remains |
| `Esc` | Close, clearing the query; focus stays in the input |
| `Tab` | Close without committing and move on |
| `Home` / `End` | First / last enabled option |
| `Backspace` | With an empty query, removes the last chosen chip |

In `multiple` mode the list **stays open** after each pick and the query
clears, so a crew is typed as `ben`↵ `car`↵ `dan`↵ without ever reaching for
the mouse. Chosen values render as removable chips inside the field, in the
order picked. Clicking a chosen row toggles it off.

Single-select closes on commit and shows the chosen label in the input, so it
is a drop-in upgrade from `Select` when a list outgrows typeahead.

### Usage

```tsx
<Field label="Crew" htmlFor="cart-crew" required error={problem}>
  <Combobox
    id="cart-crew"
    multiple
    value={employeeIds}
    onChange={setEmployeeIds}
    options={active.map((e) => ({ value: e.id, label: e.name }))}
    placeholder="Search employees…"
    emptyMessage="No employee by that name."
    aria-label="Employees who worked this car"
  />
</Field>
```

`value` is always an **array**, in both modes — single-select just never holds
more than one. `onChange` gives back the full next array, so it drops straight
into a `useState<string[]>` with no toggle helper at the call site.

`options` is `{ value, label, detail?, disabled? }[]`, the same shape as
`Select`, and `detail` is searched too — so a service can be found by its
category as well as its name.

Filter *out* what should not be chosen rather than passing `disabled`. A
resigned employee is noise in a search list, not a choice worth explaining;
reserve `disabled` for something momentarily unavailable.

## Why a custom `Select`

Native `<select>` draws its popup with the OS, not the page. On Windows that is
a white list in the system font — it ignores every token in `globals.css` and
breaks the black-and-red board surface hard, which is exactly the screen the
cashier stares at 40 times a day. `Select` draws the list itself so it matches
the rest of the app, and so the same visual language carries into the Expo app.

The cost of drawing it ourselves is that keyboard and screen-reader behaviour
have to be rebuilt. `Select` implements the
[WAI-ARIA listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/):

| Key | Behaviour |
| --- | --- |
| `↓` / `↑` | Open the list, or move to the next/previous enabled option |
| `Enter` / `Space` | Open, or commit the active option |
| `Esc` | Close without committing; focus returns to the trigger |
| `Tab` | Close without committing and move on |
| `Home` / `End` | First / last enabled option |
| letters | Typeahead — jumps to the option starting with what you typed |

Typeahead resets after 700ms of no typing. Repeating one letter (`m`, `m`, `m`)
cycles through the options starting with it rather than searching for `"mmm"` —
this is how native selects behave, and the employee list is long enough that it
matters.

Focus stays on the trigger the whole time; the active option is communicated
with `aria-activedescendant`. The list closes on outside pointer-down, and on
scroll or resize (it is absolutely positioned against the trigger, so it would
otherwise detach). It flips above the trigger when there is not enough room
below.

### Usage

```tsx
<Field label="Employee" htmlFor="cart-employee" required error={problem}>
  <Select
    id="cart-employee"
    value={employeeId}
    onChange={onEmployeeChange}
    invalid={employeeId === ''}
    placeholder="Select who worked this car…"
    options={employees.map((e) => ({ value: e.id, label: e.name }))}
    aria-label="Employee who worked this car"
    aria-describedby="cart-employee-msg"
  />
</Field>
```

`options` is `{ value, label, detail?, disabled? }[]`. `detail` is a dimmer
second string on the same row — used for the commission rate next to a service
category. `onChange` is typed to the option's `value`, so a union like
`PaymentMethod` flows through without a cast.

`placeholder` is not a selectable option. If "none" is a real choice, put it in
`options` with its own value.

## `Input`

`prefix` and `suffix` render inside the field shell, so `₱` and `%` read as part
of the value rather than as floating labels. Use `numeric` for money and rates —
it applies `tnum`, so digits do not jitter in width while typing.

```tsx
<Field label="Commission" className="w-[6.5rem]">
  <Input size="sm" numeric suffix="%" defaultValue="40" inputMode="decimal" />
</Field>
```

Sizes: `sm` (h-9, dense settings grids), `md` (h-10, default), `lg` (h-12, the
one big number in a modal).

Money fields stay **strings** in component state and convert at the boundary
with `pesosToCentavos` from `@shared/lib/currency`. Never bind a peso input to a
float.

## `Field`

Owns the label, the required marker, and the message line. The message renders
*below* the control so the label never moves when validation appears — the field
grows downward into empty space instead of shoving the rest of the form around
while the user is still typing.

Pass `error` to show a red message and pair it with `invalid` on the control;
`error` replaces `hint` when both are set. Wire `htmlFor` so the label targets
the control, and point the control's `aria-describedby` at `{htmlFor}-msg`.

## Shared conventions

- **Focus** is carried by the border going red, not by a ring — the POS grid's
  gutters are too tight for a ring to sit cleanly.
- **Invalid** is `border-red/50`, distinct from focus's solid red.
- **Disabled** is 40% opacity plus `pointer-events-none`, matching `Button`.
- Transitions run 150ms on `--ease-out-strong`. The `globals.css`
  `prefers-reduced-motion` block already neutralises them; do not re-handle it
  per component.
- Every control needs an accessible name — a `Field label` wired with `htmlFor`,
  or an explicit `aria-label` when the visible label is elsewhere.

## Not covered yet

Checkboxes, radios, and textareas are still styled inline at their call sites
(one checkbox in `SettingsTab`). The inclusion "Add…" chip in `SettingsTab` is
intentionally not an `Input` — it is a dashed inline tag entry inside a chip row,
not a bordered field.

`Combobox` covers multi-select and search. Neither control accepts free text
that is not already an option — nothing in the app needs to invent a value at
the point of choosing, and an employee or service is created in its own tab.

## `Badge`

A count riding on a sidebar tab. It is here rather than in `components/` because
it is a shared primitive with no knowledge of what it counts — `Shell.tsx` feeds
it a number.

Two signals, deliberately kept separate:

- **The number** is how much is outstanding. It falls only when the work is
  actually closed out, so it survives a glance at the tab.
- **The dot** (`dot`) means something arrived since this device last looked. It
  clears on visit.

Folding those into one would make the count clear itself when the owner merely
looked, which is wrong: unseen and unfinished are different questions.

Counts above `BADGE_CAP` render as `9+` via `formatBadgeCount` — past two digits
the pill starts shoving the tab label around. Pass `label` for a screen-reader
sentence; the digits alone do not say what they count. A zero count renders
nothing at all: the caller omits the badge, so a red pill always means something
is genuinely open.
