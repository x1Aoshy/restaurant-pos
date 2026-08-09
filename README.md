# x1Aoshy POS

Desktop point of sale for a restaurant. Orders, tables across floors and the
bar, cash shifts with a blind count, tips, discounts and voids with a reason,
inventory with recipes, expenses, billing, thermal printing to the kitchen and
the bar, automatic backups, and syncing between terminals.

## How it works

A Windows desktop app with **the database on the machine itself**. No server to
maintain, no account with any service: install it and it runs, including with
the internet down.

```
Terminal (Windows)
  └── x1Aoshy POS ──► pos.db  (SQLite, on the machine)
```

It is built for what a small dining room actually looks like: **one computer**
where somebody types in the orders that arrive on paper. Not a tablet per
waiter. That is why everything fits on one screen and works from the keyboard.

If a second terminal is needed later, syncing is switched on in Settings and
works without comparing clocks: each machine records its changes in an outbox
and the server puts them in order. It ships off. Details in
[docs/SYNC.md](docs/SYNC.md).

### Supabase is not required

Worth saying plainly, because the repository mentions it in several places:
**the whole application works without an account anywhere.** Selling, charging,
printing, closing the register, tracking inventory and making backups never
touch the network.

This is checkable, not a promise:

- There is no Supabase dependency in `package.json`. The sync client is four
  `fetch` calls.
- There is no server address anywhere in the code. Whoever installs the app
  types it in, and it lives in the database — never in the binary or a `.env`.
- `sync_context.enabled` starts at `0`, and the outbox triggers hang off it.
  Switched off, changes are not even recorded.
- The sync indicator does not render while syncing is off.

Supabase is one option for the two-terminal case, and nothing else. It is not a
backup: backups are the local copies, which also upload nothing anywhere.

## Stack

| Layer | Technology |
|---|---|
| Desktop | Tauri 2 (Rust) |
| Interface | React 19 · TypeScript · Vite |
| Styling | Tailwind 4 · Base UI |
| Data | Local SQLite (`tauri-plugin-sql`) |
| Receipts | jsPDF — 80 mm thermal or A4 |
| Printing | ESC/POS over TCP, with a small Rust adapter |

## Design principles

**Money is never a decimal.** Amounts are stored and computed in whole cents,
and tax rates in basis points (1000 = 10%). SQLite has no decimal type, and in
floating point `0.1 + 0.2` is not `0.3`. Across a hundred lines that becomes
one-cent gaps that show up exactly when the register is counted, and that nobody
can explain.

**The database computes the totals.** The interface sends a product and a
quantity; subtotal, tax and total are resolved by SQLite triggers. Tax is
rounded **per line** before summing, the same way the printed receipt does it.
Round only at the end and the paper and the database start quoting different
numbers.

**Prices freeze at the moment of sale.** `order_items` keeps its own copy of the
price and the tax rate. Editing the menu does not rewrite receipts that have
already been issued.

**Inventory is a ledger.** Stock is the sum of its movements, not an editable
field. Every entry is tied to the order line that produced it, so correcting a
quantity, voiding a ticket or deleting one moves exactly what it should. A
mistake is fixed with an adjusting entry, never by erasing history.

**Dates are local, not UTC.** Reports group by local date. Without that, in
Nicaragua (UTC−6) everything charged after 18:00 — the busiest hours — would
count as the following day.

**A tip is not revenue.** It is stored separately and never enters
`total_cents`. Adding it to the total would inflate income and margin with money
that does not belong to the business. What gets charged is the sum of the two
fields, and that is how the receipt prints it.

**Voiding is not deleting.** A voided line stays on the ticket with its reason,
its time and who voided it. Totals stop counting it and inventory returns what
it consumed, both by trigger. What gets deleted cannot be reviewed afterwards,
and reviewing is the whole point.

## Development

```bash
npm install
```

```bash
npm run tauri dev
```

The database is created on first launch and the migrations apply in order with
no intervention. The first screen asks you to create the admin account.

One instance at a time: port 1420 is fixed, and the binary is locked while the
app is running.

Node 22 or newer is required — the checks use `node:sqlite`, which does not
exist before 22.5. There is also a Docker setup that needs none of this
installed; see [CONTRIBUTING.md](CONTRIBUTING.md).

### Checks

```bash
npm run verify
```

This runs types (`tsc`), the lock on migrations that have already been applied,
parity between the Spanish and English dictionaries, and six suites that execute
the schema, the triggers and the queries against a real SQLite: schema, sync,
business logic, discount splitting, the review screen, kitchen tickets and cash
handling.

None of this is ceremony. Nothing here throws when it breaks. A trigger that
deducts too little, a discount that splits one cent wrong, a line that is never
marked as sent — none of them raise an error. They just make the day's count lie,
or make the kitchen cook the same dish twice.

The Rust tests — the ESC/POS adapter and backups — run separately:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Production

```bash
npm run tauri build
```

Produces `.msi` and `.exe` installers under `src-tauri/target/release/bundle/`.

Full steps in [docs/DEPLOY.md](docs/DEPLOY.md). Threat model and the state of
the review in [SECURITY.md](SECURITY.md).

## Layout

```
src/
  components/      sidebar, layout, title bar, sign-in screens
  features/        pos · orders · floor · products · inventory · tickets · dashboard
                   register · printing · backup · audit · sync
  providers/       session · i18n · theme · floor · menu
  routes/          screens, including the admin ones
  lib/             database, money, PIN, formatting, languages
  types/local.ts   SQLite rows, with a unit suffix on every amount
src-tauri/
  migrations/      schema and triggers — applied automatically at startup
  capabilities/    window, SQL, file and dialog permissions
  installer/       installer artwork, generated from the app icon
  src/             transactions, the ESC/POS adapter and backups
scripts/           the checks that `npm run verify` runs
docs/              deployment and sync design
```

Migrations **are not edited once applied**. The SQL plugin stores a digest of
each one, and if it changes the app will not open again. A correction is made by
adding the next migration. `npm run verify` includes the lock that catches this
on a developer's desk instead of in the restaurant.

## Changes

[CHANGELOG.md](CHANGELOG.md) lists what was fixed on the way to 1.0.0. It is
worth reading if you are running an earlier build of the sync server — one of
the entries is a permission fix that applies to a database already in use.

## License

Proprietary — see [LICENSE](LICENSE). The source can be read, compiled and
studied. It cannot be used to run a business, sold, offered as a service or
redistributed without written permission. The license text is kept in both
English and Spanish: it is the one document where the owner's own language
matters if it ever has to be enforced.
