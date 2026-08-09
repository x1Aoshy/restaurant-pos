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

Without a digital signature, Windows SmartScreen warns the first time. For an
internal rollout across a few machines that is acceptable: "More info → Run
anyway".

To distribute more widely you need a code-signing certificate (roughly 200–400
USD a year) and the signing configuration added to `tauri.conf.json`.

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
