import winston from 'winston'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getAllTransactions, getBalance, getPending, getTransactions } from './bank-gateway.js'
import { getConnectionHealth, listAccounts } from './accounts.js'
import { createLogger } from './logger.js'

const TOOLS = [
  {
    name: 'list_accounts',
    description: 'List every bank account this server has access to via Akahu, with their balance, credit limit, status and when Akahu last refreshed each one. Unrestricted - not limited to a specific allowlist.',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          description: 'Ask Akahu to refresh from the bank before listing. Adds ~10 seconds. Defaults to false.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'bank_get_balance',
    description: 'Get the current and available balance for one bank account by its Akahu account ID. Use list_accounts to find the ID.',
    inputSchema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'The Akahu account ID to fetch.'
        },
        refresh: {
          type: 'boolean',
          description: 'Ask Akahu to refresh from the bank before reading the balance. Adds ~10 seconds. Defaults to false.'
        }
      },
      required: ['account'],
      additionalProperties: false
    }
  },
  {
    name: 'bank_get_transactions',
    description: 'Get settled (posted) transactions for one bank account by its Akahu account ID, optionally within a date range. Dates are ISO 8601 (e.g. "2026-06-01"). start is exclusive, end is inclusive, matching Akahu semantics. Omit both to get all transactions the app can access (up to its historical access window).',
    inputSchema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'The Akahu account ID to fetch.'
        },
        start: {
          type: 'string',
          description: 'ISO 8601 date/time, exclusive lower bound. Omit for the earliest available.'
        },
        end: {
          type: 'string',
          description: 'ISO 8601 date/time, inclusive upper bound. Omit for the latest available.'
        }
      },
      required: ['account'],
      additionalProperties: false
    }
  },
  {
    name: 'bank_get_all_transactions',
    description: 'Get settled (posted) transactions across every bank account at once, optionally within a date range. Use this instead of calling bank_get_transactions per account when searching for a payment without knowing which account it went through. Dates are ISO 8601 (e.g. "2026-06-01"). start is exclusive, end is inclusive, matching Akahu semantics. Each transaction carries an account ID, and the response includes an accounts lookup mapping those IDs to a bank and account name.',
    inputSchema: {
      type: 'object',
      properties: {
        start: {
          type: 'string',
          description: 'ISO 8601 date/time, exclusive lower bound. Omit for the earliest available.'
        },
        end: {
          type: 'string',
          description: 'ISO 8601 date/time, inclusive upper bound. Omit for the latest available.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'bank_get_pending_transactions',
    description: 'Get pending (unsettled) transactions - money committed but not yet posted, which no balance reflects yet. Check this before concluding an account has enough to cover an upcoming bill. Pending transactions are not stable: date, description and amount can all change before they settle, and they carry no ID. Payments made through Akahu itself never appear here. Omit account to get pending transactions across every account.',
    inputSchema: {
      type: 'object',
      properties: {
        account: {
          type: 'string',
          description: 'The Akahu account ID to fetch. Omit for every account.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'bank_get_connection_health',
    description: 'Report the health of each bank connection: whether every account on it is still ACTIVE, and how many hours since Akahu last pulled fresh balance and transaction data from it. Use this when a balance or transaction result looks wrong or out of date, to tell a genuinely quiet account apart from a broken or stale connection. Most stale connection first. Takes no arguments.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }
]

async function callTool (name, args = {}) {
  switch (name) {
    case 'list_accounts':
      return listAccounts({ refresh: args.refresh })
    case 'bank_get_balance':
      return getBalance(args.account, { refresh: args.refresh })
    case 'bank_get_transactions':
      return getTransactions(args.account, { start: args.start, end: args.end })
    case 'bank_get_all_transactions':
      return getAllTransactions({ start: args.start, end: args.end })
    case 'bank_get_pending_transactions':
      return getPending({ account: args.account })
    case 'bank_get_connection_health':
      return getConnectionHealth()
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

/**
 * The shared logger's Console transport writes to stdout by default. stdout is also the
 * exact channel the MCP stdio transport uses for its JSON-RPC protocol, so any log line
 * would get interleaved with protocol messages and corrupt them. Swap the Console transport
 * for one that routes every level to stderr instead - the file transport (if enabled) is
 * untouched.
 */
function redirectConsoleLoggingToStderr (logger) {
  const consoleTransports = logger.transports.filter(t => t instanceof winston.transports.Console)
  consoleTransports.forEach(t => logger.remove(t))
  logger.add(new winston.transports.Console({
    level: consoleTransports[0] ? consoleTransports[0].level : 'debug',
    stderrLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message }) => `[${level}]: ${message}`)
    )
  }))
}

async function startMcpServer () {
  const logger = await createLogger(process.env.NODE_ENV)
  redirectConsoleLoggingToStderr(logger)

  const server = new Server(
    { name: 'akahu-mcp', version: '0.3.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params
    logger.debug(`Tool call: ${name} ${JSON.stringify(args || {})}`)
    try {
      const result = await callTool(name, args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      logger.error(`Tool '${name}' failed: ${error.message}`)
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
        isError: true
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info('akahu-mcp server running on stdio.')
  return server
}

export { TOOLS, callTool, startMcpServer, redirectConsoleLoggingToStderr }
