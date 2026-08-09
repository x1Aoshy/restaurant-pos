# Changelog

## 1.0.1

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
