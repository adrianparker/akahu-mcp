# akahu-mcp

MCP server exposing the Akahu banking API as tools - list accounts, get a balance, get
transactions. Ported from [body-movin](https://github.com/adrianparker/body-movin)'s bank
gateway, minus everything in that app unrelated to reading Akahu data (payments, sweeps,
transfers, the Prisma database).

## Features

- `list_accounts` MCP tool / `akahu list-accounts` CLI command - every account Akahu has
  access to, unrestricted.
- `bank_list_accounts`, `bank_get_balance`, `bank_get_transactions` MCP tools - scoped to an
  allowlist of aliases (`rabobank`, `westpac` out of the box; edit `src/bank-gateway.js` to
  add your own).
- `akahu balance <account>` / `akahu transactions <account>` CLI commands - the same data the
  matching MCP tool returns, rendered as a human-readable table instead of JSON.

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
RABOBANK_ACCOUNT_ID=acc_...
WESTPAC_ACCOUNT_ID=acc_...
```

Get your Akahu tokens from [developers.akahu.nz](https://developers.akahu.nz). The account
IDs are optional - leave them unset and the gateway falls back to matching by bank/connection
name, but that's slower and throws if more than one connected account matches. The fastest way
to find them is `npm run cli -- list-accounts`, which isn't restricted to the allowlist.

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

- `list_accounts` - no arguments. Every account Akahu has access to, unrestricted.
- `bank_list_accounts` - no arguments. Just the allowlisted accounts (`rabobank`, `westpac`).
- `bank_get_balance` - `{ account: "rabobank" | "westpac", refresh?: boolean }`. `refresh: true`
  asks Akahu to refresh from the bank first and waits ~10s.
- `bank_get_transactions` - `{ account: "rabobank" | "westpac", start?: string, end?: string }`.
  Dates are ISO 8601; `start` is exclusive, `end` is inclusive (Akahu's own semantics). Omit
  both for everything the app can access. Paginates internally, so you always get the full
  result in one call.

### From the command line

For a human, not an MCP client - same data, rendered as a table:

```
npm run cli -- list-accounts
npm run cli -- balance westpac
npm run cli -- balance westpac --refresh
npm run cli -- transactions westpac --start 2026-01-01 --end 2026-02-01
```

Or use the `akahu` bin directly once installed globally / linked:

```
akahu balance westpac
```

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
