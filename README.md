# Jeopardy

Multiplayer online Jeopardy! for 2–4 contestants plus a human host. Each game pulls a real, random aired episode (Seasons 1–41) from a Postgres database of ~530k clues sourced from [J! Archive](https://j-archive.com).

## Stack

- **DB:** Postgres 17 in Docker, preloaded from the
  [jwolle1/jeopardy_clue_dataset](https://github.com/jwolle1/jeopardy_clue_dataset)
- **Server:** Node + TypeScript, Fastify + Socket.IO
- **Client:** React + Vite + TypeScript + Socket.IO client
- **Shared:** TypeScript event contract in [shared/protocol.ts](shared/protocol.ts), used by both server and client

## Setup

Requires Docker, Node 20+ (or 22+), and `curl`.

```sh
./scripts/download-dataset.sh   # ~77 MB → ./data/ (gitignored)
docker compose up -d            # Postgres on localhost:5432, auto-loads the dataset
cp .env.example .env            # set AUTH_SECRET (and optionally OPENAI_API_KEY)
npm run install:all             # installs root + server + client deps
npm run dev                     # boots server (3001) + client (5173) together
```

Open <http://localhost:5173> in 3+ tabs (or browsers): one host + 2–4 contestants.

### Accounts

Players now **register / log in** with a username + password before playing
(passwords are hashed with scrypt; sessions use a signed token stored in
`localStorage`). Your account is your stable identity: refresh the page or drop
your connection mid-game and you reconnect to the same seat, score, and host
role (within a grace window — see `PRESENCE_GRACE_MS`). The displayed name is
your account username.

### Sounds

The client plays sound effects for buzzes, correct/wrong rulings, Daily Doubles,
round changes, Final Jeopardy, and game over. Toggle them with the 🔊 button in
the header. Sounds are synthesized in-browser by default; to use real audio,
drop CC0 `.mp3` files into `client/public/sounds/` (`buzz.mp3`, `correct.mp3`,
`wrong.mp3`, `time-up.mp3`, `daily-double.mp3`, `final-think.mp3`,
`round-start.mp3`, `game-over.mp3`, `select.mp3`).

### On a phone

Contestants on a small/touch screen get a focused fullscreen layout during a
clue: the clue text up top and a giant Buzz button (with haptic feedback) filling
the screen.

### Smarter autopilot judging (optional)

In **Autopilot** mode the bot host grades answers. Set `OPENAI_API_KEY` in `.env`
to have an LLM judge each response (lenient about phrasing/typos); without a key
it falls back to the built-in fuzzy string matcher. Configure the model with
`OPENAI_MODEL` (default `gpt-4o-mini`).

## How to play

1. **Host** clicks "Create room", picks a name. They become the judge.
2. **Contestants** open the page, enter the 4-letter room code and a name, click "Join".
3. Once 2–4 contestants are in, the host clicks "Start game" — the server picks a random valid episode.
4. The current **picker** clicks a `$X CATEGORY` cell on the board.
5. Host reads the clue aloud, then clicks "Arm buzzers".
6. Contestants race to buzz (large red button, also bound to spacebar).
7. The first to buzz types their response. The host clicks ✓ or ✗.
   - ✓: that contestant is now the picker; +value to their score.
   - ✗: −value, locked out for the rest of this clue; remaining contestants can buzz.
   - All wrong / 5-second silence: the correct response is shown, host clicks "Next clue".
8. **Daily Doubles** (1 in R1, 2 in R2): only the picker plays. They wager between $5 and `max(score, round_max)`, then answer.
9. After all 30 R1 clues clear, host advances to **Double Jeopardy**.
10. After R2: **Final Jeopardy**. Eligible contestants (score > 0) secretly wager 0..score, then secretly type their response. Host advances reveals in ascending score order, judging each.
11. Game over → host can start another with the same lobby.

## Database

A single table, `clues`, with all 529,939 clues:

| column               | notes                                                |
|----------------------|------------------------------------------------------|
| `id`                 | bigserial PK                                         |
| `round`              | 1=Single, 2=Double, 3=Final                          |
| `clue_value`         | board-position value ($100, $200, … or modern $200…$1000) |
| `daily_double_value` | wager amount; **0 = not a DD, > 0 = DD**             |
| `category`           |                                                      |
| `answer`             | the clue shown to contestants                        |
| `question`           | the response contestants must give                   |
| `air_date`           | episodes are identified by air_date                  |

Quick query: `./scripts/psql.sh -c "SELECT COUNT(*) FROM clues"`.

## Layout

```
PP2/
├── docker-compose.yml          # Postgres service
├── db/                          # schema + load script (run once on first DB boot)
├── data/                        # downloaded TSV (gitignored)
├── scripts/                     # helpers
│   ├── download-dataset.sh
│   └── psql.sh
├── shared/protocol.ts           # socket event contract — single source of truth
├── server/
│   ├── src/
│   │   ├── index.ts             # Fastify + Socket.IO bootstrap
│   │   ├── routes.ts            # GET /health, GET /api/episode
│   │   ├── db.ts                # pg pool
│   │   ├── episode.ts           # loadRandomEpisode()
│   │   ├── rooms.ts             # Room + RoomRegistry (lobby state)
│   │   ├── game/
│   │   │   ├── machine.ts       # the Game FSM (the heart of correctness)
│   │   │   └── scoring.ts       # pure scoring helpers (DD/FJ wager bounds, etc.)
│   │   └── socket/handlers.ts   # one handler per client event
│   └── test/
│       ├── fixtures.ts          # synthetic episode for FSM tests
│       ├── episode.test.ts      # exercises the real DB
│       ├── integration.test.ts  # lobby flow over real sockets
│       └── smoke-game.mjs       # standalone end-to-end script (see below)
└── client/
    └── src/
        ├── App.tsx              # routes by phase
        ├── socket.ts            # singleton socket.io client
        ├── pages/{Home,Lobby,ContestantGame,HostGame}.tsx
        └── components/{Board,ClueCard,Buzzer,ScorePanel,HostJudge,WagerInput,AnswerInput}.tsx
```

## Tests

```sh
npm test                    # all server tests (68: unit + integration + DB)
npm run typecheck            # server + client TypeScript
npm --prefix client run build  # client production build
```

For an end-to-end check that the live wire protocol works (server must be running):

```sh
npm run dev                                  # in one terminal
node server/test/smoke-game.mjs              # in another — drives a full game
```

## Deploy

This app needs a long-running Node web service plus Postgres. It cannot be
deployed as a static-only site because rooms/gameplay use Socket.IO and clues
are loaded from the database.

Recommended production shape:

- one Node web service running the Fastify/Socket.IO server
- one managed Postgres database
- one server instance to start with, because active room state is in memory

Build and start commands from the repo root:

```sh
npm run install:all
npm run build
npm start
```

For Render/Railway-style hosts, use:

```sh
Build command: npm run install:all && npm run build
Start command: npm start
Health check path: /health
```

Set these production environment variables:

```sh
DATABASE_URL=postgresql://...
AUTH_SECRET=<long-random-secret>
CLIENT_ORIGIN=https://your-deployed-domain.example
AUTH_TTL_SECONDS=2592000
PRESENCE_GRACE_MS=45000
OPENAI_API_KEY=<optional>
OPENAI_MODEL=gpt-4o-mini
```

The deployed server binds to the platform-provided `PORT` and serves the built
React app from `client/dist` when `NODE_ENV=production`.

### Load production Postgres

Managed Postgres providers do not run the local Docker init scripts. Load the
schema and dataset once from your machine:

```sh
./scripts/download-dataset.sh
psql "$DATABASE_URL" -f db/01-schema.sql
psql "$DATABASE_URL" -f db/03-users.sql
psql "$DATABASE_URL" -c "\copy clues(round, clue_value, daily_double_value, category, comments, answer, question, air_date, notes) FROM 'data/combined_season1-41.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, QUOTE E'\b')"
```

Then verify:

```sh
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM clues"
```

## Reset the database

The init scripts only run on a fresh volume. To reload from scratch:

```sh
docker compose down -v && docker compose up -d
```

## Connect a SQL client directly

```
postgresql://jeopardy:jeopardy@localhost:5432/jeopardy
```
or `./scripts/psql.sh` (uses the container's own psql).
