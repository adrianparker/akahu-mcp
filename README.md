# akahu-mcp

MCP server exposing the Akahu banking API as tools - list accounts, get a balance, get
settled and pending transactions, check connection health. 

Every tool is read-only. This server backs an Akahu **personal app**, which by definition
cannot make payments or subscribe to webhooks - the only side effect it can produce is asking
Akahu to refresh from the bank, behind an explicit `refresh` flag.

## Features

### MCP Tools

- `list_accounts` list every account Akahu has
  access to, with balance, credit limit, status and last-refreshed timestamps.
- `bank_get_balance`, `bank_get_transactions` look up a specific account by its
  Akahu account ID.
- `bank_get_all_transactions` - settled transactions across every account at once, for finding
  a payment without knowing which account it went through.
- `bank_get_pending_transactions` - money committed but not yet posted, which no balance
  reflects yet.
- `bank_get_connection_health` - whether each bank connection is still active, and how stale
  its data is.

## Installation

```
git clone git@github.com:adrianparker/akahu-mcp.git
cd akahu-mcp
npm install
cp .env.example .env
```

Fill in `.env`:

```
NODE_ENV=app
AKAHU_APP_TOKEN=app_token_...
AKAHU_USER_TOKEN=user_token_...
```

Get your Akahu tokens from [developers.akahu.nz](https://developers.akahu.nz). Use
`npm run cli -- list-accounts` to find the account IDs to pass to `balance`/`transactions`.

## Usage

### As an MCP server

```
npm start
```

Runs `src/index.js` on stdio and waits for JSON-RPC input - that's normal, Ctrl+C to stop. For
an interactive check of the tool calls before wiring it into Claude, use the official
inspector:

```
npx @modelcontextprotocol/inspector npm start
```

Wire it into Claude by adding an entry to your MCP client config (e.g.
`claude_desktop_config.json`, or a project `.mcp.json`):

```json
{
  "mcpServers": {
    "akahu-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/akahu-mcp/src/index.js"]
    }
  }
}
```

`src/index.js` loads `.env` itself (resolved relative to its own file, not the launching
process's cwd), so you don't need to pass tokens through the MCP client config.

#### Tools

- `list_accounts` - `{ refresh?: boolean }`. Every account Akahu has access to, including
  balance (current, available, limit, overdrawn, currency), status, attributes and when Akahu
  last refreshed each one.
- `bank_get_balance` - `{ account: string, refresh?: boolean }`. `account` is the Akahu
  account ID (see `list_accounts`). `refresh: true` asks Akahu to refresh from the bank
  first and waits ~10s.
- `bank_get_transactions` - `{ account: string, start?: string, end?: string }`. `account` is
  the Akahu account ID. Dates are ISO 8601; `start` is exclusive, `end` is inclusive (Akahu's
  own semantics). Omit both for everything the app can access. Paginates internally, so you
  always get the full result in one call.
- `bank_get_all_transactions` - `{ start?: string, end?: string }`. The same settled
  transactions, across every account in one sweep. Each row carries its `account` ID, and the
  response includes an `accounts` lookup mapping those IDs to a bank and account name.
- `bank_get_pending_transactions` - `{ account?: string }`. Pending (unsettled) transactions;
  omit `account` for every account. Pending rows are not stable - date, description and amount
  can all change before they settle, and they carry no ID. Payments made through Akahu itself
  never appear here.
- `bank_get_connection_health` - no arguments. Per bank connection: whether every account on it
  is still `ACTIVE`, and how many hours since Akahu last pulled fresh balance and transaction
  data. Most stale first.

Transactions are returned enriched where Akahu has the data: `merchant`, `category`
(NZFCC name plus its higher-level group), and `meta` with the `particulars`, `code`,
`reference`, `otherAccount` and `cardSuffix` a NZ bank carries on a direct debit or credit.

### From the command line

For a human, not an MCP client - same data, rendered as a table:

```
npm run cli -- list-accounts
npm run cli -- balance acc_...
npm run cli -- balance acc_... --refresh
npm run cli -- transactions acc_... --start 2026-01-01 --end 2026-02-01
npm run cli -- all-transactions --start 2026-01-01 --end 2026-02-01
npm run cli -- pending
npm run cli -- pending acc_...
npm run cli -- connection-health
```

Or use the `akahu` bin directly once installed globally / linked, so you don't need the
`npm run cli --` prefix:

```
akahu balance acc_...
```

To install globally from this checkout (picks up `package.json`'s `bin` entry):

```
npm install -g .
```

For development, `npm link` instead - it symlinks the global `akahu` bin back to this
checkout, so edits to `src/cli.js` take effect immediately without reinstalling:

```
npm link
```

Either way, `.env` is resolved relative to the current working directory (via `dotenv.config()`
in `src/cli.js`), not the checkout - so run `akahu` from a directory containing a filled-in
`.env`, or export `AKAHU_APP_TOKEN`/`AKAHU_USER_TOKEN` in your shell. To remove a global
install or link later: `npm uninstall -g akahu-mcp` (works for both).

## Development

### Run Tests

```
npm test
npm run test:watch
```

### Coverage

```
npm run coverage
```

100% coverage is the bar for this project - `src/index.js` and `src/cli.js` carry a `c8 ignore`
around their `if (import.meta.url === ...)` entrypoint guard, since that only runs when the bin
is actually executed, not under unit tests.

### Lint

```
npm run lint
```

## License

AGPL-3.0-only — see [LICENSE](LICENSE).
