import path from 'path'
import dotenv from 'dotenv'
import { startMcpServer } from './mcp-server.js'

// Resolve .env relative to this file (not the launching process's cwd), so this works
// regardless of where an MCP client spawns it from.
dotenv.config({ path: path.resolve(import.meta.dirname, '..', '.env'), quiet: true })

/* c8 ignore start - exercised by running the bin, not by unit tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer().catch(error => {
    console.error('Fatal error starting MCP server:', error)
    process.exit(1)
  })
}
/* c8 ignore stop */

export { startMcpServer }
