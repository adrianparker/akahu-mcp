import dotenv from 'dotenv'
import { createLogger } from './logger.js'

export function ping () {
  return 'pong'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config()
  const logger = await createLogger(process.env.NODE_ENV)
  logger.debug('Starting akahu-mcp')
  console.log(ping())
}
