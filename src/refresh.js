import { getAccounts, postRefresh } from './akahu.js'
import { createLogger } from './logger.js'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30000

/**
 * Returns the most recent balance refresh timestamp across all accounts, or null if Akahu
 * has never refreshed any of them.
 * @returns {Promise<string|null>} ISO 8601 timestamp.
 */
async function latestBalanceRefresh () {
  const accounts = await getAccounts()
  const stamps = (accounts.items || [])
    .map(account => account.refreshed && account.refreshed.balance)
    .filter(Boolean)
  return stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null
}

/**
 * Asks Akahu to refresh from the bank, then waits until it actually lands by watching the
 * `refreshed.balance` timestamp advance. Replaces a flat 10 second sleep, which was both
 * too slow when the bank answered quickly and too optimistic when it did not.
 *
 * Returns rather than throwing if the refresh has not landed within the timeout: stale data
 * is still usable, and the caller asked for a balance, not for a refresh.
 * @param {string} reason - What the refresh is for, for the log line.
 * @returns {Promise<boolean>} True if the refresh landed, false if it timed out.
 */
async function refreshAndWait (reason) {
  const logger = await createLogger(process.env.NODE_ENV)
  logger.debug(`Refreshing before ${reason}...`)
  const before = await latestBalanceRefresh()
  await postRefresh()

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    const after = await latestBalanceRefresh()
    if (after && after !== before) {
      logger.debug(`Refresh landed at ${after}.`)
      return true
    }
  }
  logger.warn(`Refresh did not land within ${POLL_TIMEOUT_MS / 1000}s; continuing with the data Akahu already has.`)
  return false
}

export { refreshAndWait }
