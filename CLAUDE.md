# akahu-mcp

MCP server exposing the Akahu banking API as tools

This file is the standing context for Claude Code sessions in this repo —
keep it current as the project evolves instead of letting a README/context
file drift out of sync.

## Stack

- Node.js (ESM, `"type": "module"`), no bundler/TS build step for app code
- Mocha + Chai + Sinon for tests
- ESLint (`neostandard`) for linting
- npm (not yarn/pnpm)

## Architecture

Data flows one way, and each layer has one job:

- `akahu.js` — HTTP only. Every call goes through `doGet`/`doPost`, which own the
  auth headers, the timeout and the status-code error mapping. No shaping here.
- `bank-gateway.js`, `accounts.js` — domain logic: resolving accounts, paginating,
  grouping. `refresh.js` holds the shared refresh-and-poll used by both.
- `shape.js` — the output contract. Every account and transaction returned by any
  path is shaped here, so one account looks the same whichever endpoint it came
  from. Add fields here, not in a caller.
- `mcp-server.js`, `cli.js` — two front ends over the same domain functions. A new
  capability should land in both: a tool in `TOOLS` + a `callTool` case, and a
  `commander` subcommand + an exported `formatX`.

## Conventions

- Source lives in `src/`; tests live in `test/`, mirroring `src/` structure,
  named `<file>.test.js`
- When a change adds a new module, `git status` for untracked files before
  committing. `git diff` and a local test run both pass with an unstaged new
  file present on disk, so a missing `git add` is invisible until CI fails on
  the pushed commit — which has already happened once here.
- Env config via `dotenv` + `.env` (gitignored) / `.env.example` (committed,
  no real values)
- Logging via the `winston` wrapper, if present
- Keep the scaffold minimal — no database/ORM/web framework unless the
  project actually needs one

## Commands

- `npm start` — run the app
- `npm test` / `npm run test:watch` — run tests
- `npm run coverage` — run tests with `c8` coverage measurement
- `npm run lint` — lint
