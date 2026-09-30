# Blast Party

**Drop bombs, blow up blocks, grab power-ups and be the last one standing.**
Blast Party is a free party game for 2 to 8 players (people and computer-controlled bots) that runs in the web browser on phones, tablets, laptops and TVs. Nobody has to install anything or make an account: one person starts the game, everybody else opens a link or types a 4-letter room code.

It is an original game in the spirit of a Bomberman-style game, made to be easy for a family to jump into.

<!-- SCREENSHOT: add one picture of a match in progress here, e.g. ![A Blast Party match](docs/screenshot.png). No screenshot exists yet, so no image link is set. -->

## In 30 seconds

1. One person (the **host**) starts the game on a computer and makes a **room**. The room has a 4-letter code such as `KQXZ`.
2. Everybody else opens the game's web address on their phone or computer and types the code (or taps the invite link).
3. The host adds computer players if you want more opponents, picks the settings, and presses **Start match**.
4. Steer with your thumb or the arrow keys, drop bombs, dodge the explosions. Win enough rounds to win the match.

## The fastest way to start playing

You need [Node.js](https://nodejs.org) version 22 or newer (check with `node --version`) and this folder on your computer (on GitHub: **Code**, then **Download ZIP**, then unzip it).

Open a terminal (Terminal on Mac, PowerShell on Windows) **in the `bomberman` folder** and run:

```bash
npm install
npm start
```

You will see something like this (your numbers will differ; a few lines of technical logging may appear above it, ignore them):

```
  Blast Party is running

  On this computer:  http://localhost:3000
  Same Wi-Fi:        http://192.168.1.23:3000

  Playing with people who are not on your Wi-Fi? Run `npm run share` for a public link.
```

Open `http://localhost:3000` and press **Practice vs bots** to try the game alone: you get a private lobby with three bots already added, then press **Start match**. Practice runs inside your browser, so no other players are needed. To play with family, pick one of the three ways below. Press `Ctrl-C` in the terminal to stop the game.

## Three ways to play with family

| | Same Wi-Fi | `npm run share` | Deploy to Render or Fly.io |
|---|---|---|---|
| Who can join | Devices on your home Wi-Fi | Anyone with the link, anywhere | Anyone with the link, anywhere |
| Setup | Nothing extra | Install one small free tool | 5 minutes, free account |
| Cost | Free | Free | Render: free. Fly.io: a few dollars a month (needs a card) |
| Your computer must stay on | Yes | Yes | No |
| Address changes | Rarely | Every time you run it | Never |
| Best for | Everyone in the same house | Grandma in another city, tonight | A permanent family game link |

### 1. Same Wi-Fi (easiest)

1. Run `npm start` on one computer (see above). It prints a **Same Wi-Fi** address like `http://192.168.1.23:3000`. If several addresses are listed, use the one starting with `192.168.` or `10.`.
2. **On that computer, open the `192.168.x.x` address too, not `localhost`.** The invite link and QR code are built from the address you used, so `localhost` would give your family a link that only works on your computer.
3. Press **Create room**. The lobby shows the room code, an invite link and a QR code.
4. On the other phones and computers (same Wi-Fi), open the same `http://192.168.x.x:3000` address and enter the code under **Join room**, or scan the QR code / open the invite link.

Things that can go wrong:

- **Firewall prompt.** The first time, Windows or macOS asks whether to let Node.js accept connections. Say **Allow** (on Windows, tick **Private networks**). If you said no, phones cannot connect; allow "node" in your firewall settings.
- **Guest Wi-Fi or "client isolation".** Some networks (guest networks, some routers, hotels, offices) stop devices from talking to each other, so phones cannot reach your computer. Use the main home Wi-Fi, or use way 2 or 3.
- **Type the address exactly**, including `http://` and `:3000`. It is a plain `http` address, not `https`.
- **On a plain `http://` address** the browser switches off some features: there is no copy or share button (select the invite link and copy it by hand), and game controllers do not work. Ways 2 and 3 give you a secure `https` link and do not have this limit.

### 2. `npm run share` (a public link in one command)

```bash
npm run share
```

This starts the game and opens a free, temporary tunnel to the internet. After anywhere from a few seconds to a minute (it waits until the link really works) it prints a box with a **public `https://…` address** and a QR code. Start a room and send the invite link from the lobby (`<that address>/r/XXXX`) to your family, wherever they are.

- It needs one free tool. **`cloudflared`** is recommended (`brew install cloudflared` on macOS, `winget install Cloudflare.cloudflared` on Windows, or the `.deb` from the [cloudflared releases page](https://github.com/cloudflare/cloudflared/releases/latest) on Debian/Ubuntu). An **`ssh`** client also works (it uses the localhost.run service); it is already on macOS, and on Windows it is the optional feature "OpenSSH Client". If neither is found, the command tells you what to install for your system and still shows the Same-Wi-Fi addresses.
- **The address changes every time you run it**, so send the new link each time.
- Keep the terminal window open and the computer awake while you play. If the tunnel drops, it prints "Tunnel closed: the public link is dead. Press Ctrl-C and run again."
- Port 3000 busy? Use another: `PORT=3001 npm run share` (macOS/Linux) or `$env:PORT=3001; npm run share` (PowerShell).

### 3. Deploy it for free (5 minutes, then it is always there)

Put the game on a hosting service and you get a permanent `https://…` link that works even when your computer is off. Two things to know first:

- **Rooms live in the server's memory, so run exactly ONE copy of the game.** Both setups below are already configured this way.
- After a restart or an update, rooms are gone ("The party ended"): just create a new room.

#### Render (free)

The Render "blueprint" is the file **`render.yaml` at the top of the repository** (one level above this folder). It tells Render to build from the `bomberman` folder (`rootDir: bomberman`) and to ignore commits that only touch other folders.

1. Get the code into your own GitHub account (on GitHub: **Fork** this repository).
2. Sign up at [render.com](https://render.com) with your GitHub account.
3. In the dashboard choose **New**, then **Blueprint**, connect your repository and select the branch that contains the game. Render finds `render.yaml` by itself.
4. Check that it lists one web service called **blast-party** on the **Free** plan, and confirm (**Apply** / **Deploy Blueprint**).
5. Wait for the first build (a few minutes) until the service says **Live**, then open its `https://blast-party….onrender.com` address, press **Create room**, and share the invite link.

Render's buttons get renamed now and then, so labels may differ slightly. Limits of the free plan:

- It **goes to sleep after 15 minutes without visitors**. The first visit afterwards takes **up to a minute** (the game shows "Waking up the server…"). Open the link about a minute before playtime.
- The free computer is small: keep to **a few rooms at a time** (the blueprint caps it at 30).
- If you copy only the `bomberman` folder into a repository of its own, move `render.yaml` to that repository's top level and delete its `rootDir` and `buildFilter` lines.

#### Fly.io (a few dollars a month, needs a card)

1. Install the [`fly` command-line tool](https://fly.io/docs/flyctl/install/) and sign up with `fly auth signup` (a payment card is required; already have an account? `fly auth login`).
2. In a terminal, go into this folder: `cd bomberman`. Run every `fly` command from here (the `Dockerfile` and `fly.toml` are here).
3. `fly launch --ha=false --no-deploy` (pick an app name and a region near you; keep the settings from the existing `fly.toml`).
4. `fly scale count 1` (**one machine only**: rooms live in memory, so never more than one).
5. `fly deploy`, then `fly open` to see your `https://<name>.fly.dev` address.

The machine stops by itself when nobody is playing and starts again on the next visit (a few seconds); open connections keep it awake. To update later, run `fly deploy` again.

#### Any other host

The `Dockerfile` here runs the game anywhere that runs containers: `docker build -t blast-party .` then `docker run -p 3000:3000 blast-party`. Run only one container, and set `TRUST_PROXY` if there is a proxy in front (see [Configuration](#configuration)).

## Just want one file?

If installing Node.js is more than you want to do tonight, there is a **single file** that contains the whole game: [`download/blast-party.html`](download/blast-party.html) (about 480 KB). Save it anywhere, **double-click it**, and it opens in your browser. There is no server, no account and no internet needed to play against bots. (The file is rebuilt from the sources with `npm run build:single`; you only need that if you change the game.)

**On your own: Practice vs bots.** Works completely offline, exactly like Practice on the server version.

**With family or friends, no server: Host a game and Join a friend's game.** One player's browser plays the part of the server, and everyone else connects to it directly (a WebRTC connection). The two of you swap short text codes through any chat app:

1. The **host** opens the file, types a name and presses **Host a game**. In the lobby they press **Add a friend**. A long invite code starting with `BP1-` appears; **Copy code** (or **Share**) and send it to a friend. **Each friend needs their own copy of `blast-party.html`**, so send the file along with the code (a chat app, a USB stick, a link to wherever you keep it).
2. The **friend** opens their own copy of the file, presses **Join a friend's game**, pastes the invite code and presses **Continue**. A reply code appears; they send it back to the host.
3. The host pastes the reply code into step 2 of the same window and presses **Connect**. After a second or two the friend is in the lobby. Repeat for each friend: one invite is good for one friend, and codes are only valid for about ten minutes.
4. From there it is the ordinary game: chat, colours, bots, settings, **Start match**.

What to know before you rely on it:

- **The host must keep the page open.** The host's browser runs the game for everybody, so closing or reloading the page ends it for everyone (the friends see "The host ended the game", usually at once; if the browser dies without a goodbye they see "Connection lost" after about ten seconds). Putting the computer or phone to sleep freezes it, and after a while the friends drop. Hosting from a laptop works best; a phone can host if it stays awake with the page in front. Keep the host's tab visible; the game keeps its pace in a background tab in Chrome, Edge and Firefox, but not every browser is that generous.
- **Same Wi-Fi is the reliable case.** Over the internet it works for most ordinary home connections, but there is no relay server in this mode, so some networks simply cannot connect directly: strict or "symmetric" routers, school and work networks, some mobile data plans, some VPNs. The game says so when a connection fails. In that case use the server version (`npm start`, or `npm run share` for a public link).
- **Up to 7 friends** join one host (8 players in total, bots included). Every friend's game is calculated on the host's device, so a big party wants a laptop, not an old phone.
- **A friend whose connection drops needs a fresh code.** Nothing reconnects by itself in this mode. They see "Connection lost", press **Rejoin with a new code**, the host adds them again (**Add a friend** in the lobby, or in the menu during a match), and they get their own character back (the host keeps the seat for about two minutes during a match and five in the lobby). If the host closed or reloaded the page, the game is gone and there is nothing to rejoin.
- **Waiting for the host is fine.** A friend can wait many minutes between making the reply code and the host pasting it. Each invite works for one person only; if two friends use the same invite, only the first reply is accepted, so give each friend their own code (**New code**).
- **A "same Wi-Fi" that does not connect** is usually client isolation (guest networks, some routers, hotels and offices stop devices talking to each other). Use the main Wi-Fi, or the server version. Phones may not be able to open a downloaded `.html` file at all (for example from the iOS Files app or some in-app viewers); if that happens, open the file from a desktop browser, or use the server version. We could not test every phone.
- **Other browsers.** Only Chromium-based browsers were tested with real connections. Firefox and Safari should work (the code checker accepts the usual shapes of their connection details), but that is not verified; if a code is refused as "not valid" there, the server version is the fallback.
- **Codes contain network addresses.** To find each other the two browsers write their (private and public) IP addresses into the code, so only send codes to people you trust. To learn the public address the file asks two free public STUN servers (`stun.l.google.com` and `stun.cloudflare.com`) while it makes a code. That is the only time it touches the internet; without internet the code still works on the same Wi-Fi, it just takes about four seconds longer to appear.
- There are no room codes, invite links or QR codes in this mode (they need a server), and no auto-rejoin after a reload.

## Controls

| | Keyboard | Touch | Game controller |
|---|---|---|---|
| Move | Arrow keys or `W A S D` (French keyboard: `Z Q S D`) | Slide your thumb on the left side of the screen: a joystick appears under it | Left stick or D-pad |
| Drop a bomb | `Space`, `Enter` (also `J`, `Numpad 0`) | Big **BOMB** button | `A` or `B` |
| Special (throw a bomb, needs the glove) | `E` (also `K`, `Shift`) | Extra button that appears when you own the glove | `X` or `Y` |
| Emotes | `1` to `6`, or `T` for the wheel of all 8 | Emote button | none |
| Mute sound | `M` | Speaker button at the top right | none |
| Menu (leave, help, sound) | `Esc` | Menu button | `Start` |

- Steering is in four directions (no diagonals). You slide around corners on your own, so squeezing through gaps is easy.
- **Left-handed?** In the settings, swap the joystick and BOMB sides.
- Controllers only work on `https` links or `localhost` (Chrome and other browsers switch them off on plain `http` addresses such as `http://192.168.x.x:3000`).
- The settings also hold volume, mute and "Reduce effects" (no screen shake or flashes; on by default if your device asks for reduced motion).

## Power-ups and curses

Power-ups hide under the **soft blocks** (the crates). Blow a block up and something may be underneath. Walk over an item to take it. Flames destroy items lying on the floor, so pick them up quickly.

| Item | What it does | Limit |
|---|---|---|
| Extra bomb | You can have one more bomb on the board at once | up to 8 bombs (start with 1) |
| Fire | Your blasts reach one tile further | up to 10 tiles (start with 2) |
| Speed | You run faster | 6 upgrades (from 3.6 to 6.6 tiles per second) |
| Kick | Walk into a bomb to send it sliding until it hits something | kept for the round |
| Glove | Press the special button to throw a bomb (yours or anyone's) about 3 tiles ahead; it lands on the nearest free tile | kept for the round |
| Shield | Flames cannot hurt you | 8 seconds |
| Skull | A random **curse** | 10 seconds |

Every fighter also gets a **2-second shield** when the round starts (the GO moment).

**Curses.** Grabbing a skull curses you with one of these for 10 seconds (never the same one you already have):

| Curse | Effect |
|---|---|
| Slow | You crawl |
| Rush | You run non-stop in the direction you face |
| Reverse | Left is right, up is down |
| No bombs | You cannot drop bombs |
| Bomb spam | A bomb drops by itself every 0.4 seconds |

**Pass it on:** touch another fighter (walk right up to them) and the curse jumps to them, even through their shield. Curses vanish when the round ends.

Items are more common the more players there are. The **Items** setting can turn them off or make them plentiful.

## Rules

**A round**
- A 3-2-1 countdown, then everyone starts at a fixed spot (corners and edges), with 1 bomb, blast range 2 and normal speed.
- A bomb explodes **2.5 seconds** after you drop it, in a plus-shaped blast. Fire is stopped by solid walls, destroys soft blocks, and **sets off other bombs it touches** (chain reactions). Flames stay for about half a second.
- Anyone standing in fire is out for the round. This includes **you and your teammates** (friendly fire is on). Only the tile in the middle of your character counts, so grazing a flame is not fatal. Characters do not bump into each other.
- You can step off a bomb you just dropped, but not back onto it.
- The **last one standing wins the round**. If everyone is out at the same moment, or time runs out without sudden death, the round is a **draw** and nobody scores.

**Time and sudden death**
- The round clock defaults to 2 minutes. When it hits zero with **Sudden death** on, blocks start falling from the outer edge and spiral inward, one every fraction of a second, each shown as a growing shadow first. A falling block **squashes anyone under it, shield or not**. The board is full about 16 to 19 seconds later, so a round always ends.
- Set the time to **Unlimited** and there is no sudden death (a round that reaches 10 minutes is called a draw).
- **Showdown:** if every human is out but two or more bots are still fighting, the clock is cut to 15 seconds so nobody watches for long.

**A match**
- The first player (or team) to win the chosen number of rounds (**1, 2, 3, 5 or 7**) wins the match. If rounds keep ending in draws, the match ends after four times that many rounds and the most wins takes it (ties are broken by most blasts, then fewest times blasted; a tie after that is shared).
- After the podium and **awards** (Demolition Expert, Terminator, Collector, Survivor, Bomb Squad Casualty), the host can press **Play again**. Otherwise the room returns to the lobby by itself after 30 seconds.

**Teams**
- In **Teams** mode there are two teams, **A** (coral, solid ring under the feet) and **B** (teal, dashed ring). A team wins a round when only its members are left. Each team needs at least one member to start. New players and bots join the smaller team; the host can move people.

**Joining and leaving**
- If someone joins during a match, they watch until the next round starts.
- If your connection drops or your phone locks, the game reconnects you automatically. Your character stands still (and can be hit) for up to **30 seconds** in a match, or **2 minutes** in the lobby, before the spot is freed.
- The host is the first person in the room. If the host is gone for a minute, another connected player becomes host.
- A room holds up to **8 players** (people plus bots). If a person joins a full lobby, the most recently added bot steps aside.

## Room settings

The host changes these in the lobby (and again on the results screen); everybody else can see them.

| Setting | Choices | Default |
|---|---|---|
| Rounds (wins needed) | 1, 2, 3, 5, 7 | 3 |
| Round time | Unlimited, 60, 90, 120, 180, 240 seconds | 120 |
| Sudden death | On, Off | On |
| Mode | Free-for-all, Teams | Free-for-all |
| Theme | Random, Meadow, Frost, Lava, Candy, Night | Random (changes every round) |
| Layout | Classic (more pillars), Open (fewer pillars, wide-open brawl) | Classic |
| Blocks | Few, Normal, Many | Normal |
| Items | None, Few, Normal, Many | Normal |
| Lock room | On, Off | Off |

**Lock room** stops anyone new from joining. Turn it on once everyone has arrived (see [Privacy](#privacy-and-safety)).

## Bots

Bots are computer players that follow the same rules as you (they drop bombs, run out of flames, pick up items, get cursed). The host adds them with **Add bot** and picks a level; a person can play alone against bots. The host can also rename, recolour, move to another team, or remove a bot.

| Level | How it plays |
|---|---|
| Easy | Wanders, bombs blocks, grabs items next to it and makes silly mistakes. Never kicks or throws. Great for small children. |
| Normal | Hunts items and rivals, avoids dead ends, and uses kicks. |
| Hard | Tries to trap you, kicks and throws on purpose, prefers shields and speed, avoids skulls and hides safely during sudden death. |

Bots are called Bolt, Fuse, Pixel, Zap, Boomer, Spark, Nova and Kaboom. **Practice vs bots** on the title screen starts a private game against three bots, right in your browser.

## Tips

- **Never bomb yourself into a dead end.** Drop a bomb, then run round a corner. Fire only travels in straight lines and stops at blocks.
- Hide behind soft blocks: they absorb a blast and buy you time.
- Chain reactions work for you: a bomb next to someone else's bomb sets it off early.
- A **kick** lets you escape your own bomb or push a bomb toward a rival. The **glove** can throw a bomb over blocks into a rival's hideout.
- Got a skull? Run to a friend and touch them. Cursed for too long? It wears off after 10 seconds.
- A shield beats flames, but **not** the falling blocks of sudden death. The centre of the board falls last, so head there when the walls start closing in.
- Parents and children can be on the same team in **Teams** mode against bots. Pick **Easy** bots, few blocks and more items for the youngest players.
- Everyone's character has its own colour **and** hat (antenna, propeller, sprout, crown, horns, flame, bow, headphones), so colour-blind players can tell them apart.

## Troubleshooting

| Problem | What to do |
|---|---|
| Phones cannot open the `192.168.x.x` address | Same Wi-Fi network? Not a guest network or "client isolation"? Did you allow Node.js in the firewall prompt? Did you type `http://` and `:3000`? If it still fails, use `npm run share`. |
| The invite link only works on my computer | You opened the game as `localhost`. Reopen it with the `192.168.x.x` address (way 1), or use the public link from way 2 or 3. |
| No copy or share button, controller not working | Plain `http://192.168.x.x` addresses disable those browser features. Copy the invite link by hand, or use an `https` link (`npm run share`, Render, Fly.io). |
| "Waking up the server…" | Render's free plan sleeps when idle; wait up to a minute. Open the link a minute before you play. |
| "That party has ended" | The server restarted or updated, and rooms live in memory. Press **Create new room**. |
| No sound on iPhone | Turn the silent switch off (the side switch). Tap the screen once to start sound. |
| iPhone is not full screen | iPhones cannot go full screen from a web page. Tap **Share**, then **Add to Home Screen**, and open Blast Party from the new icon. |
| The game page misbehaves inside another app (a chat or social app's built-in browser) | Open the invite link in Safari (iPhone) or Chrome (Android) instead. |
| "Blast Party could not start" | The browser is too old. Supported: iPhone/iPad with iOS 16 or newer, Chrome 90+, Firefox 100+, Edge 90+ (Android Chrome too). Add `?debug=1` to the address to show a small technical overlay you can send to whoever maintains the game. |
| `npm run share` says no tunnel tool found | Install `cloudflared` (or use an `ssh` client), see way 2. |
| The `npm run share` link stopped working | Tunnel links die when the command stops and change every run. Run it again and share the new link. |
| "That room does not exist", "That room is locked" or "That room is full" | Check the code (four letters, no vowels), ask the host to switch off **Lock room**, or note the limit of 8 players. |
| "Server is busy, try again in a minute." | The server hit its room limit (30 on Render's blueprint, 100 on Fly.io, 200 by default). Try again in a minute. |
| `Could not start Blast Party: listen EADDRINUSE` | Port 3000 is taken. Start on another port: `PORT=3001 npm start` (macOS/Linux) or `$env:PORT=3001; npm start` (PowerShell). |
| Single file: "We couldn't connect" or a friend never joins | Direct connections need both browsers to reach each other. Try the same Wi-Fi, switch off VPNs, and make a fresh invite (**New code**). On school, work or some mobile networks it cannot work; use the server version instead (`npm start` or `npm run share`). |
| Single file: "That doesn't look like a Blast Party code" | Copy the whole code, from `BP1-` to the end, including the last four characters after the dot. Pasting it inside a sentence or over several lines is fine. |
| Single file: "The host ended the game" or "Connection lost" | The host closed or reloaded the page, or the connection between you dropped. The host adds you again (**Add a friend**) and you rejoin with the new code as the same character. |
| Lag, jerky movement | Move closer to the router or use the main Wi-Fi band. For online play, choose a Fly region near you. On Render's free plan keep the number of simultaneous rooms low; the free computer is small. |

### Privacy and safety

- Nothing is saved on the server's disk: no accounts, no stored names or chat. Your name and sound settings stay in your own browser.
- The server logs hashed (unreadable) network addresses, never real addresses, names or chat text.
- Room codes have only 160,000 possibilities, so a stranger could guess one. Use **Lock room** once everyone has joined, and the host can **kick** anyone. Chat text is cleaned up and shown as plain text only.
- Rooms close by themselves: about 30 seconds after the last person has left, after 30 minutes idle in a lobby, after 5 minutes with nobody pressing buttons during a match, and never later than 6 hours.

## Configuration

Set these as environment variables before `npm start` (on a host such as Render or Fly.io, in its settings or in `render.yaml` / `fly.toml`). All are optional.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on. Hosts like Render set it for you; leave it alone there. |
| `HOST` | `0.0.0.0` | Address to listen on (`0.0.0.0` = reachable from other devices; `127.0.0.1` = this computer only). |
| `MAX_ROOMS` | `200` | Most rooms at once. Above it, new rooms get "Server is busy". |
| `MAX_CONNS` | `400` | Most simultaneous connections. |
| `MAX_CONN_PER_IP` | `24` | Most connections from one address. A household shares one address, so do not set this too low. |
| `TRUST_PROXY` | `0` | How many proxies sit in front of the server (`1` or `true` behind Render, Fly.io or a tunnel). Used to tell players' addresses apart for limits. A wrong value only weakens the per-address limits. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug`. |
| `ALLOWED_ORIGINS` | none | Comma-separated extra web addresses allowed to open connections (for example a custom domain in front of the game). |
| `ORIGIN_CHECK` | on | `0` switches off the check that only lets the game's own web page connect. |
| `WEB_CONCURRENCY` | none | The server refuses to start if this is above 1 (rooms cannot be split across processes). |

The game answers `GET /healthz` (health check, `ok`) and `GET /api/stats` (rooms, players and timing numbers; never room codes).

---

# For developers

## Architecture

```
 browser                                   server (Node 22, one process, one dependency: ws)
 ───────                                   ─────────────────────────────────────────────────
 client/js/main.js  ── WebSocket /ws ────▶ server/ws.js ─▶ server/lobby.js (RoomManager) ─▶ shared/room.js  (Room)
   input ▶ ClientGame (predict) ▶ render                                                       │  lobby + match state machine
   ui.js (DOM screens)  audio.js                                                               ▼
   ▲                                                                       shared/world.js (World: one round) ◀─ shared/bots.js
   └── the same shared/ files are served to the browser at /shared/…       shared/{constants,rng,mapgen,protocol,qr}.js
```

- **Server-authoritative.** Clients send inputs only; the server simulates and broadcasts the result, so a modified client cannot cheat.
- **Zero build step.** Plain ES modules, no bundler, no TypeScript, no framework. The only runtime dependency is [`ws`](https://github.com/websockets/ws). Node 22 or newer.
- **Isomorphic `shared/`.** The rules (`world.js`, `mapgen.js`, `constants.js`, ...), the `Room` state machine and the bots run unchanged in Node and in the browser. The server serves `shared/` to the page at `/shared/…`. A unit test greps the sources for anything that would break that (Node-only or browser-only APIs, features Safari 16 lacks).
- **Deterministic simulation.** A `World` uses only its own seeded random generator (mulberry32), a fixed 60 Hz step and ascending-id ordering, so the server and every client compute identical results. `specs/fixtures/determinism.sha1` pins the result of a scripted match.
- **Injected seams.** Time, randomness and I/O enter `Room` only through injected parameters (`now`, `setTimer`, `seed`, `botFactory`, `timeouts`), which is what makes it testable with a fake clock. The same `Room` powers **Practice vs bots** in the browser through a `LoopbackConnection`, with no server involved.
- **Robust by design.** Every message is validated (`shared/protocol.js`), names and chat are sanitised, everything is size- and rate-limited, a failing room ends its match gracefully instead of crashing the process, and `SIGTERM` triggers a graceful shutdown (clients are told to reconnect).
- The complete contract is in [`docs/SPEC.md`](docs/SPEC.md); [`docs/PROTOCOL.md`](docs/PROTOCOL.md) is the wire protocol extracted from the code (the spec wins if they differ).

## How the netcode works

- **60 Hz simulation, 20 Hz snapshots.** The server runs one fixed 1/60 s tick per step and sends a compact JSON snapshot every 3rd tick (kept small: the average is under 1.2 KB even with 8 fighters).
- **Client-side prediction.** Your own character is moved on your device at once, using the very same `movePlayer` function as the server. Every input has a sequence number; the server acknowledges the last one it applied in each snapshot, and the client replays the still-unacknowledged inputs on top of the server state. Small differences are smoothed away instead of snapping.
- **Interpolation for everyone else.** Other players and moving bombs are drawn about 100 ms in the past, blended between two snapshots, using a render clock that absorbs network jitter and never runs backwards.
- **Server truth for the rest.** Kicks, throws, pick-ups, curses, deaths and explosions are never predicted. Explosions and other events are played the moment a snapshot arrives. A bomb you place shows instantly as a "ghost" until the server confirms it.
- **Fair input handling.** A server-side queue applies about one input per tick per player (with a small catch-up allowance), and holds inputs during the last moments of the countdown, so lag cannot be exploited to speed up and everyone gets an even start.
- **Cheap snapshots.** The map is only sent when it changes (and once a second as a safety net); a client that notices it missed a change asks for a resend.
- **Reconnects.** Each player has a secret token in their browser tab. If the socket drops, the client retries with backoff and re-attaches to the same character; sequence numbers never reset, so inputs stay in order.
- **Liveness.** The server pings every 15 s and drops dead sockets after 35 s; the client shows the connection quality, and pings `/healthz` every few minutes while in a room to keep sleepy free hosts awake.

## Testing

```bash
npm test          # unit + integration tests (Node's built-in runner, real WebSocket clients); takes well under a minute
npm run test:e2e  # end-to-end tests in a headless Chromium browser via Playwright (not part of npm test)
```

- `npm test` runs `specs/unit/**/*.spec.js` and `specs/integration/**/*.spec.js`. `npm install` is all it needs (`esbuild`, a dev dependency, builds the single-file download that `specs/unit/single-file.spec.js` checks; the downloadable file must be rebuilt with `npm run build:single` after changes under `client/` or `shared/`, and that spec fails when it is stale). The same command runs in CI (`.github/workflows/bomberman.yml`) on every change under `bomberman/`.
- The e2e scenario `specs/e2e/single.e2e.mjs` opens the single file over `file://` with the network blocked and plays offline Practice, then a host with two friends (one on a phone) over real WebRTC, a cut link and a re-handshake. It runs its own Chromium with mDNS candidate hiding switched off, so two browsers on one machine can find each other.
- `npm run test:e2e` needs [Playwright](https://playwright.dev) and a Chromium browser installed on your machine (globally, or point `PLAYWRIGHT_MODULE_DIR` and `PLAYWRIGHT_BROWSERS_PATH` at them). Without them it prints `SKIP` and exits successfully.
- Test files must be named `*.spec.js` / `*.e2e.mjs` and never `test.js`, `*.test.js` or live in a `test/` folder, because the repository's other project runs `node --test` with auto-discovery at the repo root and must not pick these up (`specs/unit/naming.spec.js` enforces it).

## Project layout

```
bomberman/
  package.json        scripts: start, dev, test, test:e2e, share, build:single
  Dockerfile  fly.toml  .dockerignore      deployment (Render's render.yaml is in the repository root)
  client/             the web app, plain files served as they are
    index.html  manifest.webmanifest  css/style.css  icons/
    js/main.js        boot and glue between UI, network, game and renderer
    js/ui.js          all DOM screens: title, lobby, HUD, results, dialogs
    js/game.js        ClientGame: snapshots, interpolation, prediction and reconciliation
    js/net.js         WebSocketConnection and LoopbackConnection (Practice mode)
    js/p2p.js         single-file play with friends: codes, HostSession (a Room in the host's page), GuestConnection, WebRTC
    js/input.js       keyboard, touch and gamepad
    js/render.js  sprites.js  particles.js   canvas rendering, procedural art, effects
    js/audio.js       synthesized sound and music (no audio files)
    js/boot.js  legacy.js                    start-up watchdog and "browser too old" message
  server/
    index.js          startServer(), reads the environment, prints the start-up banner, shutdown
    http.js           static files, /healthz, /api/stats, security headers
    ws.js             WebSocket adapter and per-connection limits
    lobby.js          RoomManager: room codes, room limits, rate limits
  shared/             runs in Node AND in the browser
    constants.js      every rule number and table (the single source)
    world.js          one round of the game (movement, bombs, flames, items, sudden death)
    mapgen.js  rng.js seeded, symmetric map generation
    room.js           lobby, settings, teams, rounds, scoring, reconnects
    protocol.js       message validation and text sanitising
    bots.js           the bot brain
    qr.js             QR code generator (lobby and `npm run share`)
  scripts/
    share.js          `npm run share`: server plus a public tunnel
    build-single.mjs  `npm run build:single`: bundles everything into download/blast-party.html
    make-icons.mjs    regenerates client/icons/*.png
    dev/              developer tooling (art sheets, bot and audio checks, the PROTOCOL.md generator)
  download/           blast-party.html, the whole game as one file (generated; commit it after rebuilding)
  specs/              unit/ integration/ e2e/ helpers/ fixtures/
  docs/               SPEC.md (the design contract), PROTOCOL.md (wire protocol)
```

## Licence and credits

Blast Party is released under the **MIT licence** (see [`../LICENSE`](../LICENSE)).

It is an original game. Its name, characters ("blasties"), art and sound are original, drawn and synthesized in code (there are no image or audio files apart from the app icons). It is **not affiliated with, endorsed by, or connected to Konami** or any of its games; "a Bomberman-style game" only describes the kind of game it is.

The only third-party runtime code is [`ws`](https://github.com/websockets/ws) (MIT).
