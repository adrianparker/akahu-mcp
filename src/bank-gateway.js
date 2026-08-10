import {
  getAccount,
  getAccounts,
  getPendingTransactions,
  getPendingTransactionsForAccount,
  getTransactionsForAccount,
  getTransactionsForUser
} from './akahu.js'
import { shapeAccount, shapePendingTransaction, shapeTransaction } from './shape.js'
import { refreshAndWait } from './refresh.js'
import { createLogger } from './logger.js'

/**
 * Resolves an Akahu account ID to its account object.
 * @param {string} accountId
 * @returns {Promise<Object>} The Akahu account item.
 */
async function resolveAccount (accountId) {
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('Account ID is required.')
  }
  const account = await getAccount(accountId)
  if (!account || !account.item) {
    throw new Error(`No account found for ID '${accountId}'.`)
  }
  return account.item
}

/**
 * Walks Akahu's transaction cursor until it is exhausted, shaping each page as it goes.
 * Bounded so a wide date range can never page forever.
 * @param {(cursor: string|undefined) => Promise<Object>} fetchPage - Fetches one page.
 * @param {number} maxPages - Page ceiling; Akahu returns up to 100 transactions per page.
 * @param {string} label - Identifies the request in the truncation warning.
 * @returns {Promise<Object>} `{ items, truncated }` - `truncated` is true if the ceiling
 *   was hit with pages still outstanding, so the caller can say so rather than quietly
 *   reporting a total that is missing transactions.
 */
async function collectTransactions (fetchPage, maxPages, label) {
  const logger = await createLogger(process.env.NODE_ENV)
  const items = []
  let cursor
  let pages = 0
  let truncated = false
  do {
    const page = await fetchPage(cursor)
    items.push(...(page.items || []).map(shapeTransaction))
    cursor = (page.cursor && page.cursor.next) || null
    pages++
    if (pages >= maxPages && cursor) {
      logger.warn(`Stopped paginating transactions for ${label} after ${maxPages} pages; results may be incomplete.`)
      truncated = true
      break
    }
  } while (cursor)
  return { items, truncated }
}

/**
 * Builds an id -> { bank, name } lookup so callers can resolve the account ID carried
 * on each transaction without a second round trip.
 * @returns {Promise<Object>}
 */
async function buildAccountLookup () {
  const accounts = await getAccounts()
  return Object.fromEntries((accounts.items || []).map(account => [
    account._id,
    { bank: account.connection && account.connection.name, name: account.name }
  ]))
}

/**
 * Gets the current/available balance for one account.
 * @param {string} accountId
 * @param {Object} [options]
 * @param {boolean} [options.refresh] - If true, ask Akahu to refresh from the bank first
 *   and wait for it to land before reading the balance.
 * @returns {Promise<Object>}
 */
async function getBalance (accountId, { refresh = false } = {}) {
  if (refresh) {
    await refreshAndWait('reading balance')
  }
  const account = await resolveAccount(accountId)
  return shapeAccount(account)
}

/**
 * Gets settled transactions for one account, paginating through all pages.
 * @param {string} accountId
 * @param {Object} [options]
 * @param {string} [options.start] - ISO 8601 date/time, exclusive lower bound.
 * @param {string} [options.end] - ISO 8601 date/time, inclusive upper bound.
 * @returns {Promise<Object>}
 */
async function getTransactions (accountId, { start, end } = {}) {
  const account = await resolveAccount(accountId)
  // 100 transactions/page; a personal bill account should never need more than this
  const MAX_PAGES = 20
  const { items, truncated } = await collectTransactions(
    cursor => getTransactionsForAccount(account._id, { start, end, cursor }),
    MAX_PAGES,
    `account '${accountId}'`
  )
  return {
    account: shapeAccount(account),
    start: start || null,
    end: end || null,
    count: items.length,
    truncated,
    transactions: items
  }
}

/**
 * Gets settled transactions across every account the app can access, in one paginated
 * sweep. Each transaction carries its `account` ID; the returned `accounts` lookup maps
 * those IDs to a bank and account name.
 * @param {Object} [options]
 * @param {string} [options.start] - ISO 8601 date/time, exclusive lower bound.
 * @param {string} [options.end] - ISO 8601 date/time, inclusive upper bound.
 * @returns {Promise<Object>}
 */
async function getAllTransactions ({ start, end } = {}) {
  // A wider ceiling than the single-account path: this cursor aggregates every account.
  const MAX_PAGES = 50
  const { items, truncated } = await collectTransactions(
    cursor => getTransactionsForUser({ start, end, cursor }),
    MAX_PAGES,
    'all accounts'
  )
  return {
    start: start || null,
    end: end || null,
    count: items.length,
    truncated,
    accounts: await buildAccountLookup(),
    transactions: items
  }
}

/**
 * Gets pending (unsettled) transactions, either for one account or across all of them.
 * Pending rows are not stable - date, description and amount can all change before the
 * transaction settles, and it carries no ID to track it by.
 * @param {Object} [options]
 * @param {string} [options.account] - Akahu account ID. Omit for every account.
 * @returns {Promise<Object>}
 */
async function getPending ({ account: accountId } = {}) {
  if (accountId) {
    const account = await resolveAccount(accountId)
    const page = await getPendingTransactionsForAccount(account._id)
    const items = (page.items || []).map(shapePendingTransaction)
    return {
      account: shapeAccount(account),
      count: items.length,
      transactions: items
    }
  }
  const page = await getPendingTransactions()
  const items = (page.items || []).map(shapePendingTransaction)
  return {
    count: items.length,
    accounts: await buildAccountLookup(),
    transactions: items
  }
}

export { getBalance, getTransactions, getAllTransactions, getPending }
