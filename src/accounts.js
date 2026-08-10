import { getAccounts, postRefresh } from './akahu.js'
import { createLogger } from './logger.js'

function shapeAccount (account) {
  return {
    id: account._id,
    bank: account.connection && account.connection.name,
    name: account.name,
    type: account.type,
    balance: {
      current: account.balance && account.balance.current,
      available: account.balance && account.balance.available
    },
    formattedAccount: account.formatted_account
  }
}

/**
 * Lists every account Akahu has access to, unrestricted (not limited to a bank-gateway
 * allowlist). Sorted by bank then account name.
 * @param {Object} [options]
 * @param {boolean} [options.refresh] - If true, ask Akahu to refresh from the bank first
 *   and wait ~10s before listing.
 * @returns {Promise<Array<Object>>}
 */
async function listAccounts ({ refresh = false } = {}) {
  if (refresh) {
    const logger = await createLogger(process.env.NODE_ENV)
    logger.debug('Refreshing before listing accounts...')
    await postRefresh()
    await new Promise(resolve => setTimeout(resolve, 10000))
  }
  const accounts = await getAccounts()
  return (accounts.items || [])
    .map(shapeAccount)
    .sort((a, b) => (a.bank || '').localeCompare(b.bank || '') || (a.name || '').localeCompare(b.name || ''))
}

export { listAccounts }
