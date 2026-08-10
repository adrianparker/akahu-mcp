import winston from 'winston'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getBalance, getTransactions } from './bank-gateway.js'
import { listAccounts } from './accounts.js'
import { createLogger } from './logger.js'

const TOOLS = [
  {
    name: 'list_accounts',
    description: 'List every bank account this server has access to via Akahu, with their current and available balance. Unrestricted - not limited to a specific allowlist. Takes no arguments.',
    inputSchema: {
      type: 'object',
      properties: {},
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
    { name: 'akahu-mcp', version: '0.1.0' },
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
