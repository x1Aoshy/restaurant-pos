# Changelog

## 1.0.2

### Added — data safety

**A backup is taken when the app closes.** The scheduled ones land mid-service
and capture half a shift; this one captures the whole day, closed and
reconciled, which is the state anyone would actually want back.

It never blocks the exit. If the backup disk is not plugged in at eleven at
night the failure is recorded and the app closes anyway, and there is a "Close
without backing up" button from the first second — blocking the exit only
teaches staff to kill the process from Task Manager, which loses the backups
that were working too. Closing again within ten minutes skips the copy rather
than pushing the ones that matter out of the folder, and the skip is recorded so
the history explains itself instead of showing a gap.

**Every attempt is now logged.** `backups` only ever held the last one, which
does not answer the question people ask when something smells wrong: *since
when?* A USB unplugged on Tuesday and plugged back in on Friday left the same
trace as if nothing had happened. Settings › Backups › History lists the last 20
attempts with reason and result, and the pattern names the cause — scheduled
ones landing while close ones do not is somebody switching the machine off at
the wall, not a bad folder.

### Fixed — data safety

**An interrupted backup looked like a good one.** `VACUUM INTO` is not atomic,
so a process killed mid-copy left a `pos-*.db` that the app counted, kept, and
offered for restore — and that was only discovered on the day someone tried to
use it. Backups are now written as `.part` and renamed once complete. The rename
is atomic within a volume: either the whole copy is there or it is not. This
mattered little while copies only happened on a timer; with one on every close,
being interrupted stops being hypothetical.

## 1.0.1

### Fixed — syncing, security

**A table name could walk around the whitelist and kill syncing for the whole
venue.** The receiving side is the only place in the application that builds SQL
out of data that arrived over the network, so every change is checked against a
list of accepted tables. The list is a JavaScript object and it was read with a
plain index — which also finds what the object inherits. `constructor`,
`toString`, `valueOf` and `__proto__` all came back as something other than
null, passed the check, and then blew up two lines later on fields they do not
have.

The damage was not the rejected message. The exception came out of
`statementFor`, which is documented as never throwing precisely because
everything downstream depends on it: it travelled up before anything was
applied, `last_seq` never advanced, and the terminal re-requested the same batch
— with the same message still in it — every thirty seconds. One message was
enough to stop every terminal in the venue from receiving anything, forever,
while the screen said "network error". Pushing it needed nothing but the venue
token, which sits in the local database on any terminal, and it stayed on the
server for the ninety days `sync_prune` takes to sweep it.

The terminal now looks the table up as an own property, and the server refuses
to store those names at all — the second one covers a venue that still has a
machine on an older build. **Anyone running the sync server must re-run
`supabase/sync-server.sql`;** it is written to be re-runnable.

It survived because the check that was supposed to catch it was aimed one step
to the side. `check-sync.mjs` tested `products; DROP TABLE staff;--` and the
obvious invented names, and those were rejected correctly — the filter was never
asked about a name that the language itself supplies an answer for.

**Two more ways to wedge a terminal, same shape, same fix.** A live order
arriving without `id`, `table_id` or `created_at` reached the merge rule, which
reads those straight off the payload before the whitelist runs, and produced an
`INSERT` with a null key; the constraint rejected it, and because the batch is
one transaction it took the good changes next to it down as well — and again
`last_seq` did not move. And a `sync_pull` reply that is not a list — what a
captive wifi portal answers with — failed inside the merge with an error that
looks nothing like its cause. Both are now discarded instead of thrown.

### Fixed — checks

**`npm run verify` depended on a package nobody had asked for.** Four of the
check scripts import `esbuild` to compile the TypeScript they exercise, and it
was never in `package.json` — it worked only because Vite happens to bring it
along. The day Vite stops, or moves it, every check fails at once with an error
about a missing module rather than anything to do with the code. It is declared
now, at the version already in the tree.

### Fixed — syncing

**Turning syncing on uploaded nothing that already existed.** The outbox
triggers only fire while `enabled = 1`, so every row written before the switch
was flipped had never passed through one. A venue that ran a single machine for
a year turned syncing on, set up its second terminal, and that terminal came up
with no menu, no tables and no staff — no error anywhere, because the outbox was
simply empty. Flipping the switch now seeds the outbox from the existing data,
in the same transaction that flips it. The catalogue travels whole; history
travels for 90 days, which is what the server keeps before `sync_prune` deletes
it. `sync_context.seeded_at` makes it happen once.

It survived this long because every test built its database with syncing already
on, and then the triggers do catch everything. The new check starts from a
populated database with syncing off — the way a real venue does.

**The switch in Settings bypassed its own function.** It wrote `enabled` with a
raw `UPDATE` instead of calling `setEnabled`, so any behaviour attached to
turning syncing on was dead code that never ran.

### Added

**Checks run on their own.** More than two hundred and seventy checks existed and
only ran when someone remembered to type `npm run verify`. A GitHub Actions
workflow now runs them, plus the frontend build, on every push and pull request —
including the dependency bumps that nobody reads closely and that are exactly the
ones able to break a rounding rule without saying so.

## 1.0.0

First production release. What follows is not a feature list — it is the set of
defects found while getting there, kept because most of them are the kind that
never raise an error and only show up as a number that does not match.

### Fixed — money

**The cash drawer expected money that never arrived.** The trigger that records
a cash sale always added `total + tip`, even when the customer paid less than
the bill. The register came up short at closing time, at the hour when nobody
can work out which ticket it came from. It now records what was actually
received.

**Typing `500` meant five córdobas, not five hundred.** The amount fields filled
from the right, the way a physical register does. On a keyboard that is a trap:
to charge five hundred you had to type `50000`, and whoever got it wrong saw
"short C$495" with no idea why. Amounts are now read the way a person writes
them, including thousands separators and either decimal mark.

**Tax was rounded once, at the end.** Rounding per line before summing is what
the printed receipt does; rounding only at the end made the paper and the
database quote different figures on the same ticket.

**Changing a quantity did not move inventory.** The stock ledger was not tied to
the order line that produced it, so correcting a quantity deducted nothing.
Entries are now bound to `order_item_id`, which also makes voids and deletions
return exactly what they consumed.

**A discount split one cent wrong.** Prorating across lines now uses the
largest-remainder method, so the parts always add up to the discount that was
promised on screen.

### Fixed — kitchen

**A dish added from the table sheet never reached the kitchen.** Orders typed in
the POS printed on save, but adding a beer by tapping a table in the floor plan
saved it and printed nothing. That plate existed only on screen. Lines now carry
a `printed_at` mark, a "To kitchen" button sends what is still pending, and only
groups that actually printed get marked.

**Voiding a dish that was already cooking told nobody.** The void was recorded
perfectly in the database and lost in the kitchen: the original ticket was still
clipped to the pass and the plate got made anyway. A cancellation ticket now
prints on the same printer that produced the order.

### Fixed — data safety

**Backups could not be restored.** There was a paragraph of instructions —
close the app, copy the file over, delete the `-wal` files — which is a manual
procedure that gets done wrong on exactly the day it is needed. Restoring is now
a button that validates the file first, swaps it at startup rather than while
SQLite has it open, and keeps the previous database as `pos.db.replaced`.

**The database locked itself.** The transaction helper issued `BEGIN` and
`COMMIT` as separate calls, and the SQL plugin spread them across different
connections in its pool. One connection was left holding the write lock forever.
Transactions now run through a single Rust command on one connection.

**Editing an applied migration bricked the app.** It stopped opening with
`migration 6 was previously applied but has been modified`, an error that
explains nothing. `npm run verify` now carries a checksum lock that catches this
on a developer's desk instead of in the restaurant.

### Security

**The sync server granted more than it meant to.** `sync-server.sql` revoked
`EXECUTE` from `anon` and `authenticated`, which did nothing: Postgres grants
`EXECUTE` on new functions to `PUBLIC` by default, and revoking from a role does
not remove a privilege arriving through `PUBLIC`. `create_venue` and
`sync_prune`, both `security definer`, were callable by anyone who could reach
the API. The revokes now target `public` and each reachable function is granted
back explicitly. **If you ran an earlier version of this script, run the current
one again.**

**The self-hosted compose file ran PostgREST as the superuser.**
`PGRST_DB_ANON_ROLE: postgres` gave every anonymous HTTP request full control of
the database. It now connects as a `NOINHERIT` `authenticator` role and switches
to `anon`, does not publish port 5432, and refuses to start without a password
instead of shipping one in the file.

**The web inspector shipped in the installer.** The release build was compiled
with Tauri's `devtools` feature enabled, so the window installed in a dining
room could be inspected and arbitrary SQL run against the database. It was there
to diagnose an installation problem and it stayed. Removed.

**PINs shorter than six digits.** The minimum is now six. PIN hashes travel in
the sync change log, and four digits is ten thousand combinations — a space that
can be exhausted even at 210,000 PBKDF2 iterations.

### Fixed — interface

**A PIN longer than four digits could not sign in.** The lock screen submitted
automatically at the fourth digit and cleared the field on failure, while the
user was still typing. Confirmation is now explicit.

**Counter sales showed as "table 00".** In the floor plan, on receipts and in
the payment dialog, which said "Charge table 0". Everything now goes through one
label helper that names the counter.

**The discount button was invisible, and disabled when it was needed.** It was a
tiny ghost button, and it was blocked once a ticket reached `billed` — which is
exactly the moment a customer asks for a discount.

**Enter both pressed a button and charged the ticket.** With focus on a quick
amount chip, one keypress would select the amount and complete the sale without
anybody seeing the total. Enter now advances between steps and never charges;
charging is always a deliberate click.

**The close button sat on top of the step counter.** The dialog's X is
absolutely positioned in the top-right corner, which is where the counter had
been placed.

**Voided lines listed in a different order on each load.** Two voids recorded in
the same second had no tiebreak, so the review screen reshuffled them.

**The content security policy blackened the window.** The policy only applies in
a compiled binary and `tauri dev` never exercises it, so it shipped without ever
having been seen to work. It is now tested against the built output before
release.

### Removed

**Thirty-nine explanatory strings.** Field hints, dialog subtitles and keyboard
tips that repeated what the built-in tutorial already shows. Error messages,
empty states and the bodies of destructive confirmations were kept: they say
what breaks, not how to use the screen.

### Documentation

Every document claimed things that had stopped being true: that there were no
automatic backups, that multiple terminals were unsupported, that the app had no
network permission. All rewritten against the code as it stands.
