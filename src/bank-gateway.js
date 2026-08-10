import { getAccount, getTransactionsForAccount, postRefresh } from './akahu.js'
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

function shapeTransaction (t) {
  return {
    id: t._id,
    date: t.date,
    description: t.description,
    amount: t.amount,
    balance: t.balance,
    type: t.type,
    merchant: t.merchant && t.merchant.name
  }
}

/**
 * Gets the current/available balance for one account.
 * @param {string} accountId
 * @param {Object} [options]
 * @param {boolean} [options.refresh] - If true, ask Akahu to refresh from the bank first
 *   and wait ~10s before reading the balance.
 * @returns {Promise<Object>}
 */
async function getBalance (accountId, { refresh = false } = {}) {
  if (refresh) {
    const logger = await createLogger(process.env.NODE_ENV)
    logger.debug('Refreshing before reading balance...')
    await postRefresh()
    await new Promise(resolve => setTimeout(resolve, 10000))
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
  const logger = await createLogger(process.env.NODE_ENV)
  const account = await resolveAccount(accountId)
  const items = []
  let cursor
  let pages = 0
  const MAX_PAGES = 20 // 100 transactions/page; a personal bill account should never need more than this
  do {
    const page = await getTransactionsForAccount(account._id, { start, end, cursor })
    items.push(...(page.items || []).map(shapeTransaction))
    cursor = (page.cursor && page.cursor.next) || null
    pages++
    if (pages >= MAX_PAGES && cursor) {
      logger.warn(`Stopped paginating transactions for '${accountId}' after ${MAX_PAGES} pages; results may be incomplete.`)
      break
    }
  } while (cursor)
  return {
    account: shapeAccount(account),
    start: start || null,
    end: end || null,
    count: items.length,
    transactions: items
  }
}

export { getBalance, getTransactions }
