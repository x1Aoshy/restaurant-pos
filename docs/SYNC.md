# Syncing between terminals — design

All four phases are built and **off by default**. This document exists so it is
clear what each piece does and why it sits where it does.

## What has to be solved

Syncing is not "uploading the database". With two terminals, five separate
problems appear and each one has a different answer.

### 1. Row identity

Already solved, luckily. Every identifier is a UUID generated on the machine
(`crypto.randomUUID`), so two terminals cannot invent the same one without
coordinating. The exceptions are handled separately:

| Table | Problem | Answer |
|---|---|---|
| `settings` | a single row, `id = 1` | not synced row by row; the last explicit change wins |
| `tables` | `number` is unique | the floor plan is configured in one place and replicated; it is not edited in two at once |
| `product_recipe` | composite key | the sync identifier is `product_id/item_id` |

### 2. Capturing the changes

An **outbox** (`sync_outbox`) that triggers keep filling: which table, which
row, whether it is an insert/update or a delete, and a JSON copy. It is the only
way not to depend on every screen remembering to record what it touched.

### 3. Not echoing changes back

When applying a change that came from another terminal, the triggers would write
it straight back into the outbox and the change would bounce between machines
forever.

A flag in `sync_context` solves it: the Rust command raises it, applies the
changes and lowers it, **all inside the same transaction and the same
connection**. This is only reliable from Rust; from JavaScript it is not,
because the plugin spreads each call across the connections in its pool.

### 4. Who wins when two machines change the same thing

**Clocks are never compared.** Two PCs in a restaurant keep whatever time they
keep, and a two-minute drift would be enough for the good change to lose against
an older one. The server sets the order: every change gets a number as it
arrives, and each terminal asks for "whatever came after the number I already
have".

Within that order, **the last to arrive wins**, per row. That is enough for
almost everything: the menu, expenses, inventory and settings are rarely touched
in two places at the same time.

### 5. The one that really collides: two tickets on one table

The case that happens daily. Two waiters open table 5 from two terminals without
seeing each other. Locally the `one_live_order_per_table` index prevents it, but
each machine believes it is the only one.

Here "last one wins" would be a disaster: one of the two tickets would disappear
along with food the customer has already eaten. The correct answer is to
**merge**: the older ticket stays and the other one's lines move onto it. No
order is ever lost; at worst they end up together.

This has to be enforced on the server, because it is the only party that sees
both.

### 6. Computed values are not synced

Ticket totals, table status and stock levels are computed by triggers from other
rows. If they travelled as well they would be counted twice: the receiving
terminal would get the other machine's inventory movement **and** generate its
own when inserting the order line.

So they stay out of the outbox:

- `orders.subtotal_cents`, `tax_cents`, `total_cents`
- `tables.status`
- `inventory_items.stock_milli`
- `inventory_movements` entries carrying an `order_item_id` — the ones born from
  a sale. Manual ones (purchase, waste, adjustment, initial load) do travel.

Each terminal recomputes them and arrives at the same number on its own.

## Phases

### Phase 1 — the outbox

`004_sync_outbox.sql`: machine identity, the applying flag, the outbox and the
triggers for the nine tables. **Off by default**: while `sync_context.enabled`
is 0 the triggers write nothing, so anyone running a single machine pays not one
byte for this.

Covered by `scripts/check-schema.mjs`: that it queues nothing while off, that it
queues while on, that applying does not echo back, and that computed values do
not travel.

### Phase 2 — the server

`supabase/sync-server.sql`. A `changes` table that stores changes in order, and
two functions, `sync_push` and `sync_pull`. The server **does not replicate the
POS schema**, so when the POS changes there is no migration to coordinate across
machines.

Access does not use Supabase Auth. Each venue has a secret key — only its hash
is stored — and the anonymous role cannot touch any table, only call those two
functions. The Supabase publishable key travels inside the binary, as always,
and on its own it is worth nothing.

### Phase 3 — push and pull

`src/features/sync/` and `src/providers/sync-provider.tsx`. Every 30 seconds:
push the outbox, ask for everything after the last sequence number received, and
apply it.

Three details that matter:

- **The outbox is emptied after the server confirms**, never before. If the
  connection drops halfway, the changes go out again. Repeating a change is
  harmless — they all say "make this row look like this". Losing one is not.
- **`last_seq` is saved in the same transaction as the changes.** Kept separate,
  a failure in between would leave the terminal repeating work or, worse,
  skipping changes it never applied.
- **Incoming data is filtered against an allowlist**
  (`features/sync/tables.ts`). Table and column names cannot be query
  parameters, so they end up concatenated into the SQL. Without that filter,
  anyone who could talk to the server could write whatever they liked into this
  machine's database. It is the only surface in the app that runs SQL derived
  from network data, and it has its own tests in `scripts/check-sync.mjs`.

### Phase 4 — merging tickets

`006_order_merge.sql` and `features/sync/merge-orders.ts`.

What happened before this was worse than expected. The one-live-order-per-table
index **rejected** the second ticket, and since changes apply inside a
transaction, that rejection took down the whole batch. `last_seq` never advanced
and the terminal retried the same batch every thirty seconds forever: syncing did
not degrade, it died.

The rule, in one line: **the ticket with the lower `(created_at, id)` wins**,
takes the other's lines, and the absorbed one is marked with `merged_into`.

What makes this work without coordinating anything is that the rule is
deterministic. Both terminals hold both rows, run the same comparison and reach
the same result independently — which is why the merge **is not recorded in the
outbox**: nobody has to announce it.

Four details that were expensive to find and are not obvious:

- **`merged_into` has no foreign key.** To absorb a ticket, the local one has to
  stop being live *before* the winning one is inserted, but a foreign key would
  demand the opposite. Both conditions cannot hold at once.
- **The merge is applied at two moments.** Taking the absorbed ticket out of the
  live set happens before the batch; moving its lines happens after, once the
  destination ticket exists.
- **Late lines redirect themselves**, inside the SQL. A terminal that was off
  for days keeps sending lines for a ticket that has already been merged here.
- **Chains are flattened.** If an even older ticket shows up, the one that was
  winning starts losing and whatever pointed at it is repointed.

Covered in `scripts/check-sync.mjs` with two independent databases each
receiving the other's change: both pick the same winner, no line is lost, and
the two totals match. Also the case of a terminal catching up from zero and
receiving both tickets at once.

## Setting it up

1. Create a Supabase project and run `supabase/sync-server.sql` in its SQL
   editor.
2. Register the venue and **save the key**, which is shown only once:
   ```sql
   select * from public.create_venue('My restaurant');
   ```
3. On each terminal: Settings › Sync. Paste the project URL, its publishable key
   (Project Settings › API › anon) and the venue key from step 2. Save and flip
   the switch.

The first terminal uploads everything in its outbox; the others receive it at
startup. Before switching this on, make sure **every** PIN is six digits: their
hashes travel in the change log.

### Without Supabase

`supabase/docker-compose.yml` runs the same thing on your own machine: Postgres
plus PostgREST, with the same schema and the same grants.

```bash
POSTGRES_PASSWORD=... AUTHENTICATOR_PASSWORD=... docker compose up -d
```

```bash
docker compose exec db psql -U postgres -d restaurant_pos \
  -c "select * from public.create_venue('My restaurant');"
```

The server URL is then that machine on port 3000. The publishable-key field can
hold any non-empty string — PostgREST does not check it; the venue key is what
grants access.

Two things this setup gets right that are easy to get wrong:

- PostgREST connects as `authenticator`, a role that owns nothing and is
  `NOINHERIT`, and switches to `anon` for unauthenticated requests. Pointing it
  at `postgres` instead would give every anonymous HTTP request full control of
  the database and turn every grant in `sync-server.sql` into decoration.
- Postgres does not publish port 5432. Only the API container reaches it.

Verified end to end against a clean database: a venue is created, `sync_push`
returns a sequence number, another device pulls the change back, and both
`create_venue` and the `venues` table answer HTTP 401 to an anonymous caller.

### A note on `EXECUTE` and `PUBLIC`

`sync-server.sql` used to revoke execute from `anon` and `authenticated`. That
did nothing. Postgres grants `EXECUTE` on new functions to `PUBLIC` by default,
and revoking from a role does not remove a privilege that arrives through
`PUBLIC` — so `create_venue` and `sync_prune`, both `security definer`, were
callable by anyone who could reach the API.

The revokes now target `public`, and each function that should be reachable is
granted back explicitly. This applied to Supabase as well, not only to the
self-hosted setup: if you ran an earlier version of the script, run the current
one again.

## What has not been proven

All four phases are written and verified piece by piece, including that the
merge converges between two independent databases. What has **not** happened is
running it against two real machines, with their network, their outages and
their clocks. That is still pending and no simulated test replaces it.

A couple of things that will only show up there:

- What happens when a terminal loses connection in the middle of a payment.
- Whether thirty seconds between syncs is too long or too short for the real
  rhythm of a dining room.
