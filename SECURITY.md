# Security — x1Aoshy POS

State as of migration `012`, version `1.0.1`.

## Where the real boundary is

```
%APPDATA%\com.restaurant.pos\pos.db
```

An **unencrypted** SQLite file. Anyone who can read it can read all of it:
sales, tickets, inventory and staff. Anyone who can write to it can change any
figure without going through the application.

The only thing protecting it is the Windows account permissions. That is the
security boundary, and it is worth spelling out:

- **One Windows account per person who should see the data.** If the machine in
  the dining room has a shared session, everyone has full access to the file, no
  matter what they can see inside the app.
- **Lock the session when you walk away.** The app's PIN does not survive a
  window restart, but the file is still sitting there.
- **Disk encryption (BitLocker)** if the machine can leave the premises or be
  stolen. It is the only measure that protects the data with the machine
  powered off.

There is no remote service in the base configuration, which removes a whole
family of risks — a key baked into the binary, RLS policies, open account
registration, interceptable traffic — because there is no API to call. It also
removes the protection those things provided: **there is no server here to say
no.**

## Roles organise, they do not protect

`admin`, `manager`, `waiter` and `cashier` decide **what appears in the
interface**. They are not access control: anyone with access to the file
bypasses the entire application. The Users screen says so outright rather than
implying a guarantee that does not exist.

This is not an oversight left to fix. Without a server, there is no way to
enforce it. Real access control requires somebody other than you holding the
data.

## What the application does protect

**PINs are not stored in the clear.** `pbkdf2$210000$salt$hash`, PBKDF2-SHA256
with 210,000 iterations (the OWASP recommendation), a random salt per user and a
constant-time comparison. Someone who opens the file does not get the PINs; they
can only try to break them, and at 210,000 iterations that costs.

**The session is not written to disk.** Closing the app forces the PIN again.
There is no "remember me" to copy.

**Amounts are not written by the interface.** Totals are computed by SQLite
triggers from a product and a quantity. That protects against mistakes, not
against an attacker — who would edit the file directly — but it is the
difference between a register that balances and one that does not.

**The inventory ledger is not rewritten.** Movements are appended; correcting
means adding an adjusting entry. Everything leaves a trail.

**Tauri permissions are scoped.** The interface can only write files to
Documents, Downloads and Desktop — just enough to save a receipt — and can only
open paths in those same folders. It has no shell permission.

There *is* network access, and it is worth being exact about how much: the Rust
side opens TCP connections to talk to printers, and the interface can call
`https:` to sync. Neither address is fixed at build time — the printer and the
server are typed in by whoever installs the app and live in the database — so
they cannot be narrowed beforehand. What is narrowed is everything else:
`script-src 'self'` keeps outside code from ever loading, and with no sync
configured nothing leaves the machine.

**The web inspector does not ship in the installer.** Up to `0.1.0` the app was
compiled with the `devtools` feature on, so the window installed in the
restaurant could be inspected and, from there, arbitrary SQL run against the
database. It was there to diagnose the installation and it stayed. It is gone
now.

## Open items

### CSP — RESOLVED

Enabled. An earlier attempt left the window black because the policy only
applies in the compiled binary and `tauri dev` never exercises it: it shipped
without ever having been seen to work.

This time it was tested first: the compiled `dist` served with the real header,
and verified that scripts, stylesheets and fonts load, that inline styles still
apply, and that an https request is not blocked. Zero violations in the console.

Two directives are deliberately permissive, and it is worth knowing why:

- **`style-src 'unsafe-inline'`** — the chart bars and the tutorial highlight
  box are positioned with the `style` attribute. Without this they would all sit
  at zero. What actually protects, `script-src 'self'`, stays strict.
- **`connect-src https:`** — the sync server address is chosen by whoever
  installs the app and lives in the database, not in the build, so it cannot be
  narrowed to a specific host at compile time.

### Backups — RESOLVED

This was the most likely risk in the whole system: not an attacker, but a disk
that fails one night. It is built — Settings › Backups.

It uses `VACUUM INTO`, SQLite's own mechanism, rather than a file copy. In WAL
mode the most recent changes live in `pos.db-wal`, and copying `pos.db` with
Windows Explorer leaves them out **without warning**. The copy looks fine until
the day it is needed.

One decision is left to whoever installs it, and it is not a small one: **the
destination folder must not be on the same disk.** A USB stick or a folder that
syncs to the cloud. Copying to the same disk protects against an accidental
delete and nothing more.

Restoring is built too, and validates the file before touching anything. The
database being replaced is kept as `pos.db.replaced` rather than deleted.

### The whitelist could be walked around by name — FIXED in 1.0.1

The receiving side checks every incoming change against a list of tables it
accepts, because table and column names cannot travel as query parameters and so
end up concatenated into the SQL. That list is a JavaScript object, and it was
being read with a plain index.

A plain index also finds what the object inherits. `constructor`, `toString`,
`valueOf` and `__proto__` all return something that is not null, so they passed
the "is this table on the list?" check and fell through to code that read fields
those values do not have. The result was a thrown `TypeError`, in the one
function whose contract is that it never throws.

What that cost was not the rejected message. The exception travelled up before
anything was applied, so `last_seq` never moved, and the terminal asked for the
same batch — poisoned message still in it — every thirty seconds, forever.
**One message was enough to kill inbound syncing on every terminal in the
venue**, with nothing on screen but "network error", which points somewhere
else entirely. It needed no more privilege than the venue token, which sits in
the local database on any terminal; and the message sat on the server for the
ninety days `sync_prune` takes to sweep it.

Fixed in two places:

- **The terminal** looks the table up as an *own* property and ignores anything
  it did not declare itself. This is the real fix: the terminal is where the SQL
  is built, so it is where the boundary is.
- **The server** refuses to store a change whose table name is one of those
  inherited names. This is the second turn of the key, and it covers what the
  terminal fix cannot: a venue with one machine still on an older build. It does
  not tie the server to the POS schema — it is not a list of valid tables, which
  would mean migrating the server every time the POS adds one. It is a list of
  names no table will ever have.

**Existing servers must re-run `supabase/sync-server.sql`.** It is written to be
re-runnable; without it the terminals are still fixed, but the poisoned message
can still be stored for older ones to choke on.

Two neighbouring cases were closed the same way, both of which ended in a wedged
terminal rather than a wrong number: a live order arriving without `id`,
`table_id` or `created_at` — the merge rule reads those from the raw payload,
before the whitelist — and a `sync_pull` response that is not a list, which is
what a captive wifi portal answers with.

### The sync outbox carries PIN hashes — WORTH KNOWING

`sync_outbox` includes `staff.pin_hash`, because without it nobody could sign in
on a new terminal. Today it does not leave the machine while syncing is off,
which is how it ships.

Turning it on means PIN hashes exist on a third party's system. They are PBKDF2
with 210,000 iterations, not PINs in the clear. The minimum is already **six
digits** precisely because of this: with four there are ten thousand
combinations and the whole space can be tried in a while even at that cost.

### Syncing makes one compromised terminal everybody's problem — WORTH KNOWING

Off, the boundary is the one at the top of this file: the machine. On, it is the
machine **and** the venue token, which lives in that same unencrypted file on
every terminal. Whoever reads one terminal's `pos.db` can push changes to all of
them, and three of the whitelisted columns are worth naming:

- **`staff.pin_hash` and `staff.role`.** A pushed row can set an existing
  account's PIN to one the pusher chose, or raise their own account to `admin`.
  It arrives on every terminal as an ordinary change. `role` is constrained to
  the four valid values, so this is not an escape from the schema — but `admin`
  is one of the four.
- **`printers.address`.** The address is not fixed at build time; it is a row,
  and the Rust side connects wherever it says. Rewrite it and receipts print
  somewhere else — which means the order data on them goes somewhere else.

None of this is new in kind: the Users screen already says roles organise rather
than protect, and one machine with a shared Windows session was always enough to
read everything on that machine. What syncing changes is the *reach* — from one
terminal to the whole venue. The mitigations are the ordinary ones and they are
worth doing before turning the switch on: one Windows account per person,
BitLocker on any machine that can leave, and a venue token that is rotated (via
`create_venue`) when somebody leaves who had access to a terminal.

### Backups are written outside the sandbox — DELIBERATE

The interface can only write files to Documents, Downloads and Desktop. Backups
do not go through that: `db_backup` is a Rust command and writes wherever it is
pointed, so it can reach the destination this document asks for — a USB stick,
or a folder on another disk. Narrowing it to the three sandboxed folders would
forbid exactly the destination that makes a backup worth having. The path comes
from the native folder picker, and the command refuses to overwrite an existing
file, but it is worth knowing the allowlist above does not cover this.

### PIN attempts are not throttled — ACCEPTED

Nothing counts failures or slows down after a run of them. On its own that would
matter; here it does not change much, because the 210,000 iterations are the
cost either way and anybody who can run attempts against the file can skip the
app entirely and read the hashes directly. Six digits and PBKDF2 are what stand
between a stolen file and the PINs. A lockout would protect against someone
standing at the keyboard guessing, which is the case the Windows session lock
already covers better.

### The file is not encrypted — ACCEPTED

SQLCipher exists, but the key would have to live on the same machine for the app
to start unattended, so it only stops someone who walks off with the disk and
nobody else. BitLocker covers that case better and without touching the
application.
