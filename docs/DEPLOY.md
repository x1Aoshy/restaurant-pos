# Deploying x1Aoshy POS

## Docker is not part of this

This is a **desktop application**, not a service. Docker packages server
processes, and there is no server here: the database is a SQLite file on the
same machine.

What gets distributed is a **Windows installer**. Putting that in a container
would add nothing and make installation harder.

```
Terminal (Windows)
  └── .msi installer ──► x1Aoshy POS ──► pos.db
```

There *is* a Docker setup in this repository, but it is only a development
environment — see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Building the installer

```bash
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/`:

- `msi/x1Aoshy POS_1.0.0_x64_en-US.msi` — standard Windows installer
- `nsis/x1Aoshy POS_1.0.0_x64-setup.exe` — NSIS installer

Either works. The `.msi` deploys better through group policy; the `.exe` is the
usual choice for installing by hand.

## First launch

There is nothing to set up beforehand. On first open:

1. `pos.db` is created and every migration applies in order.
2. The setup screen asks for the name and PIN of the **admin account**. That
   first account is the only one created this way; the rest are added under
   Users.
3. Before selling anything, go into Settings and set the venue name, currency,
   default tax and receipt format.

## Where the database lives

```
%APPDATA%\com.restaurant.pos\pos.db
```

That file **is** the business: sales, tickets, inventory and staff. If the disk
dies, it dies with it. The installer never touches it — you can uninstall and
reinstall without losing a row.

### Backups

The app makes them on its own: **Settings › Backups**. You pick the destination
folder, how often, and how many to keep; the oldest are deleted as new ones
arrive.

The only decision that matters is the folder, and it is not a small one: **it
must not be on the same disk**. A USB stick, an external drive, or a folder that
syncs to the cloud. Copying to the same disk protects against an accidental
delete and nothing else — which is the case that does not happen.

Do not copy `pos.db` with Windows Explorer. The database runs in WAL mode and
the most recent changes live in `pos.db-wal`. Copying only the `.db` leaves them
out **with no warning and no error**, and the copy looks fine right up until the
day you need it. The app uses `VACUUM INTO`, which produces a consistent file
while the app is open and in the middle of service.

#### On close

Beyond the schedule, the app backs up **when you close it**. That is the copy
worth the most: the scheduled ones land mid-service and capture half a shift,
while this one captures the whole day, closed and reconciled — which is the
state anyone would actually want back.

It never stops you closing. If the backup disk is not plugged in at eleven at
night, the failure is recorded and the app closes anyway; there is also a
**Close without backing up** button from the first second. Blocking the exit
teaches staff to kill the process from Task Manager, which loses the backups
that were working too.

Closing again within ten minutes does not make a second copy — configuring
printers should not push the copies that matter out of the folder. The skip is
recorded, so the history explains itself rather than showing a gap.

#### History

**Settings › Backups › History** lists the last 20 attempts with their reason
(scheduled, manual, on close) and result. `backups` only ever held the last one,
which does not answer the question people actually ask when something smells
wrong: *since when?* A USB unplugged on Tuesday and plugged back in on Friday
left exactly the same trace as if nothing had happened.

The pattern is what names the cause. Scheduled ones landing and close ones
missing is not a folder problem — it is somebody turning the machine off at the
wall. An entry stuck on **Unfinished** means the process died mid-copy.

That last case leaves nothing dangerous behind: the copy is written as `.part`
and renamed only once complete, so an interrupted one is neither counted nor
kept nor mistaken for a good backup.

### Restoring

Same screen, at the bottom: **Restore a backup**. You pick the file, the app
checks it — that it is a healthy database, that it belongs to this application,
and that it is not from a newer version — and asks you to type `RESTORE` before
going ahead. Then it restarts itself.

The file swap happens at startup, not while running: with the database open,
replacing it underneath leaves SQLite reading something that is no longer there.

**The database you had is not deleted.** It stays next to it as
`pos.db.replaced`. If the restored copy turns out to be the wrong one, you go
back by closing the app and swapping the names. Only the most recent one is
kept.

What is lost is everything charged between the backup and now. That is why
restoring asks you to type a word instead of showing a "Are you sure?", which by
the third time gets clicked without reading.

Test it **once, before you need it**: make a backup, restore it, and check the
app opens. A backup nobody has ever restored is an assumption, not a safety net.

## Upgrading

Install over the top. Pending migrations apply themselves at startup and the
data is preserved; the installer does not touch `%APPDATA%`.

**Back up the `.db` before upgrading.** A migration does not undo itself, and
going back to an older version with an already-migrated database is not
supported.

## Code signing

Without a digital signature, Windows SmartScreen shows "Windows protected your
PC" the first time anyone runs the installer, and they have to click through
"More info → Run anyway". For an internal rollout across a few machines that is
acceptable. In front of a customer who has just paid, it is not.

`.github/workflows/release.yml` builds the installer and signs it when a
certificate is configured. **Without the secrets it still builds**, and uploads
the installer unsigned — so the workflow is useful from day one and turning
signing on is setting three secrets, not rewriting anything.

### Getting a certificate

An OV (organisation validated) certificate runs roughly 200–400 USD a year from
Sectigo, DigiCert or SSL.com. Since June 2023 the private key has to live on
certified hardware, so what arrives is either a USB token or a cloud signing
service — **a plain `.pfx` download is no longer issued for new OV certificates.**
That matters here: a USB token cannot be plugged into a GitHub runner, so with
one you sign from your own machine and the workflow is only useful unsigned.
If you want CI to sign, buy a **cloud signing** product (Azure Trusted Signing,
SSL.com eSigner, DigiCert KeyLocker) and adapt the import step, or use an older
`.pfx` you already hold.

An EV certificate clears SmartScreen immediately instead of building reputation
over the first few hundred installs, and costs about twice as much.

### Setting up the secrets

With a `.pfx` in hand, in Settings › Secrets and variables › Actions:

| Secret | What goes in it |
|---|---|
| `WINDOWS_CERTIFICATE` | The `.pfx` in base64 — `base64 -w0 cert.pfx` on Linux, or `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))` in PowerShell |
| `WINDOWS_CERTIFICATE_PASSWORD` | The password protecting the `.pfx` |
| `WINDOWS_TIMESTAMP_URL` | Optional. Defaults to `http://timestamp.digicert.com` |

Then tag a release:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

The installers come out as a workflow artifact. Publishing them is a manual
step on purpose: publishing is irreversible and should not hinge on a
`git push --tags` going well.

### Why the thumbprint is not in `tauri.conf.json`

Tauri signs on Windows by referencing a certificate in the system store by its
thumbprint. The thumbprint changes with every certificate and only means
anything on the machine holding it, so committing one leaves a value in the
repository that works nowhere else. The workflow imports the `.pfx`, reads the
thumbprint the store assigns, and passes it through `--config` at build time.
`tauri.conf.json` stays clean, and `npm run tauri build` on your own machine
behaves exactly as it did before.

### Timestamping

The workflow timestamps every signature. Without it the signature expires with
the certificate and installers already handed out start warning again a year
later; with it they stay valid, because there is a record that they were signed
while the certificate was good.

It also verifies the result with `Get-AuthenticodeSignature` and fails the build
if anything came out unsigned — an unsigned installer that ships anyway is worse
than not signing, because it is discovered on the customer's machine.

## Automatic updates

The current version **does not update itself**: every change means reinstalling.
Tauri ships an updater that downloads and applies new versions on its own, but
it needs a server to publish manifests to and every release must be signed. With
a single terminal it is not worth the machinery.

## Printers

There are two paths and they do not get in each other's way.

**With no printer configured**, the receipt comes out as a PDF: the app
generates it and the system viewer prints it. The default format is an 80 mm
thermal roll (Settings › Receipt › Format); if that machine has no thermal
printer, switch it to A4. This is the normal state of a fresh install and it
raises no warning, deliberately.

**With thermal printers**, the app talks to them directly over the network
(ESC/POS over TCP, port 9100) and does not go through Windows. They are set up
under Admin › Printers:

1. **Zones.** One per floor or room: Floor 1, Terrace, Bar. Tables are assigned
   to a zone, and so is this terminal.
2. **Printers.** Name, IP address and port. The character table matters more
   than it looks: hit **Test** and check that accents and ñ come out right
   before calling the setup done.
3. **Rules.** Which printer each menu group goes to in each zone. The `receipt`
   group is the customer's ticket; the rest you define yourself on the products
   (`hot_food`, `drinks`, …). A rule with no zone applies to all of them.

The cash drawer hangs off the printer on an RJ11 cable and opens only when
charging **in cash**. On card it stays shut: opening it out of habit is the
fastest way for money to go missing with nobody knowing when.

Kitchen tickets print by the zone of **the table**, not the terminal: what
matters is which floor the plate has to go to, not which computer typed it in.
Each line is sent once — adding a beer mid-dinner does not reprint the whole
order.

## Cash shifts

Admin › Register. You open the shift with the opening float — the money already
in the drawer before you start — and close it by counting.

The count is **blind**: you type what is there first, and only then does the app
show what should be there and the difference. The other way round would be
pointless; whoever counts would already know the number to reach.

Each machine has its own shift and cannot have two open at once. Charging with
no shift open **does not fail**: the sale goes through, it simply does not land
in any count.

## Multiple terminals

Supported, and **off out of the box**. With one computer there is nothing to
turn on.

When a second one is needed, it is enabled under Settings › Sync. It does not
compare clocks: each machine records its changes in an outbox and the server
puts them in order, so two terminals whose clocks disagree still arrive at the
same result. If two of them open the same table at once, the two tickets merge
into the older one with nobody deciding anything.

Server setup and the design in detail: [SYNC.md](SYNC.md).

## Before the first service

- [ ] Settings: venue name, address, phone, currency and tax.
- [ ] Settings › Backups: a folder **on another disk**, and a test run with
      "Back up now".
- [ ] Users: one account per person. PINs are six digits minimum.
- [ ] Tables and zones, including the bar and the second floor if they exist.
- [ ] The menu, with prices, per-product tax and print group.
- [ ] Inventory and recipes, if you are going to track stock.
- [ ] Printers and rules, if there are any, with **Test** on each one.
- [ ] Register: open a shift with the real float and close it on the first day
      to see that the count matches what is in the drawer.
