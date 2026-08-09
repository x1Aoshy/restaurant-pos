# Development environment

Read [LICENSE](LICENSE) first. This code can be read, compiled and studied, but
not used to run a business or redistributed without written permission.

## With Docker

So you do not have to install Rust, WebKit and Node on your machine.

```bash
docker compose run --rm dev npm install
```

```bash
docker compose run --rm dev npm run verify
```

```bash
docker compose run --rm dev cargo test --manifest-path src-tauri/Cargo.toml
```

The first run takes a while: it pulls Debian, compiles the whole Rust tree and
downloads the npm dependencies. After that everything lives in volumes and later
runs are quick.

To work inside it without starting a container per command:

```bash
docker compose up -d && docker compose exec dev bash
```

### What the container does not do

**It does not show the application window.** This is a desktop app and a
container has no screen. Worth stating plainly, because it is the first thing
anyone tries:

- `npm run dev` starts Vite and serves the interface on port 1420, but opening
  it in a browser **does not work**: the app asks for its database over Tauri's
  IPC channel, which does not exist in a browser. You get the database error
  screen, and that is correct.
- `npm run tauri dev` needs a display server. On a **Linux** host you can share
  the X11 socket:

  ```bash
  xhost +local:docker
  ```

  and add this to the `dev` service in `docker-compose.yml`:

  ```yaml
  environment:
    - DISPLAY=${DISPLAY}
  volumes:
    - /tmp/.X11-unix:/tmp/.X11-unix
  ```

  On a Windows or macOS host you need a separate X server and it is not worth
  it. Install the tools locally instead.

**It does not build the Windows installer.** The `.exe` and `.msi` are compiled
on Windows. From Linux you get Linux binaries, which is not what ships.

### What it is for, then

The part that actually costs time when you start: compiling the project and
running the test suite. That is most of the tests, and all of them run without a
screen — the schema, the triggers, discount splitting, the register, syncing,
cash handling and kitchen tickets all execute against a real SQLite.

## Without Docker

```bash
npm install
```

```bash
npm run tauri dev
```

You need Node 22 or newer — the checks use `node:sqlite`, which does not exist
before 22.5 — and stable Rust. On Windows you also need the Visual Studio build
tools and WebView2, which ships with the system on Windows 11.

## Before proposing a change

```bash
npm run verify
```

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

And two rules that are not about style:

**Applied migrations are never edited.** The SQL plugin stores a digest of each
one; if it changes, the app stops opening with an error that explains nothing. A
correction is made by adding the next migration and running
`npm run lock:migrations`.

**Money is not a decimal.** Whole cents and basis points, in the database and in
the interface. If a new calculation returns a `number` with decimals for an
amount of money, it is wrong even when the tests happen to pass.

## Conventions in this codebase

- **Comments say why, not what.** The code already says what it does. Comments
  earn their place when they explain a decision that would otherwise look
  arbitrary, or a trap somebody already fell into.
- **The interface is bilingual.** Every user-facing string lives in
  `src/providers/i18n-provider.tsx` in both Spanish and English.
  `npm run verify` fails if the two dictionaries drift apart or if a key is used
  without being defined.
- **Amounts carry their unit in the name**: `_cents`, `_bp`, `_milli`. It is the
  cheapest way to stop somebody adding a value in cents to one in whole units.
