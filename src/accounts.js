import { getAccounts } from './akahu.js'
import { shapeAccount } from './shape.js'
import { refreshAndWait } from './refresh.js'

/**
 * Lists every account Akahu has access to, unrestricted (not limited to a bank-gateway
 * allowlist). Sorted by bank then account name.
 * @param {Object} [options]
 * @param {boolean} [options.refresh] - If true, ask Akahu to refresh from the bank first
 *   and wait for it to land before listing.
 * @returns {Promise<Array<Object>>}
 */
async function listAccounts ({ refresh = false } = {}) {
  if (refresh) {
    await refreshAndWait('listing accounts')
  }
  const accounts = await getAccounts()
  return (accounts.items || [])
    .map(shapeAccount)
    .sort((a, b) => (a.bank || '').localeCompare(b.bank || '') || (a.name || '').localeCompare(b.name || ''))
}

/**
 * Returns the oldest (most stale) of a set of ISO 8601 timestamps, ignoring missing ones.
 * @param {Array<string|undefined>} timestamps
 * @returns {string|null}
 */
function oldest (timestamps) {
  const present = timestamps.filter(Boolean)
  return present.length ? present.reduce((a, b) => (a < b ? a : b)) : null
}

/**
 * Reports the health of each bank connection: whether every account on it is still
 * ACTIVE, and how long ago Akahu last got fresh data from it. A connection that has
 * silently stopped refreshing is the failure mode that makes every balance and
 * transaction answer quietly wrong, so it is worth being able to ask directly.
 * @param {Object} [options]
 * @param {Date} [options.now] - Reference time for the staleness calculation.
 * @returns {Promise<Array<Object>>} One entry per connection, most stale first.
 */
async function getConnectionHealth ({ now = new Date() } = {}) {
  const accounts = await getAccounts()
  const byConnection = new Map()
  for (const account of (accounts.items || [])) {
    const connection = (account.connection && account.connection._id) || 'unknown'
    if (!byConnection.has(connection)) {
      byConnection.set(connection, [])
    }
    byConnection.get(connection).push(account)
  }

  return [...byConnection.entries()]
    .map(([connection, items]) => {
      const refreshed = items.map(account => account.refreshed || {})
      const balanceRefreshedAt = oldest(refreshed.map(r => r.balance))
      const transactionsRefreshedAt = oldest(refreshed.map(r => r.transactions))
      const stalest = oldest([balanceRefreshedAt, transactionsRefreshedAt])
      const inactiveAccounts = items.filter(a => a.status !== 'ACTIVE').map(a => a.name)
      return {
        connection,
        bank: (items[0].connection && items[0].connection.name) || null,
        status: inactiveAccounts.length ? 'INACTIVE' : 'ACTIVE',
        accountCount: items.length,
        inactiveAccounts,
        balanceRefreshedAt,
        transactionsRefreshedAt,
        staleHours: stalest ? Math.round(((now - new Date(stalest)) / 3600000) * 10) / 10 : null
      }
    })
    .sort((a, b) => (b.staleHours || 0) - (a.staleHours || 0))
}

export { listAccounts, getConnectionHealth }
