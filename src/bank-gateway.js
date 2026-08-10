import { getAccounts, getAccount, getTransactionsForAccount, postRefresh } from './akahu.js'
import { createLogger } from './logger.js'

/**
 * The only accounts this gateway will ever resolve or expose.
 *
 * Each alias resolves to a real Akahu account ID in one of two ways:
 *   1. An explicit env var (fast, unambiguous, recommended) - see the `envVar` below.
 *   2. A fallback lookup by bank/connection name, if the env var isn't set.
 */
const ALLOWED_ALIASES = {
  rabobank: {
    envVar: 'RABOBANK_ACCOUNT_ID',
    matchNames: ['rabobank']
  },
  westpac: {
    envVar: 'WESTPAC_ACCOUNT_ID',
    matchNames: ['westpac']
  }
}

/**
 * @returns {string[]} The list of account aliases this gateway supports.
 */
function supportedAliases () {
  return Object.keys(ALLOWED_ALIASES)
}

/**
 * Resolves an alias (e.g. 'rabobank' or 'westpac') to its Akahu account object.
 * Never returns an account outside ALLOWED_ALIASES, regardless of what Akahu's /accounts
 * endpoint returns.
 * @param {string} alias
 * @returns {Promise<Object>} The Akahu account item.
 */
async function resolveAccount (alias) {
  if (!alias || typeof alias !== 'string') {
    throw new Error(`Account alias is required. Supported aliases: ${supportedAliases().join(', ')}`)
  }
  const key = alias.toLowerCase().trim()
  const config = ALLOWED_ALIASES[key]
  if (!config) {
    throw new Error(`Unknown account alias '${alias}'. Supported aliases: ${supportedAliases().join(', ')}`)
  }

  const configuredId = process.env[config.envVar]
  if (configuredId) {
    const account = await getAccount(configuredId)
    if (!account || !account.item) {
      throw new Error(`${config.envVar} is set to '${configuredId}' but Akahu returned no matching account.`)
    }
    return account.item
  }

  const logger = await createLogger(process.env.NODE_ENV)
  logger.debug(`${config.envVar} not set, resolving '${key}' by bank name instead.`)
  const accounts = await getAccounts()
  const candidates = (accounts.items || []).filter(a =>
    config.matchNames.some(name => ((a.connection && a.connection.name) || '').toLowerCase().includes(name))
  )
  if (candidates.length === 0) {
    throw new Error(`No connected account found matching '${key}'. Set ${config.envVar} in .env, or check the account is connected in Akahu.`)
  }
  if (candidates.length > 1) {
    throw new Error(`Multiple accounts match '${key}' (${candidates.map(a => a._id).join(', ')}). Set ${config.envVar} in .env to disambiguate.`)
  }
  return candidates[0]
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
 * Lists the allowed accounts with their current balance.
 * If an alias fails to resolve, it is included with an `error` field rather than
 * throwing, so one broken alias doesn't prevent seeing the other.
 * @returns {Promise<Array<Object>>}
 */
async function listAllowedAccounts () {
  const results = []
  for (const alias of supportedAliases()) {
    try {
      const account = await resolveAccount(alias)
      results.push({ alias, ...shapeAccount(account) })
    } catch (error) {
      results.push({ alias, error: error.message })
    }
  }
  return results
}

/**
 * Gets the current/available balance for one allowed account.
 * @param {string} alias
 * @param {Object} [options]
 * @param {boolean} [options.refresh] - If true, ask Akahu to refresh from the bank first
 *   and wait ~10s before reading the balance.
 * @returns {Promise<Object>}
 */
async function getBalance (alias, { refresh = false } = {}) {
  if (refresh) {
    const logger = await createLogger(process.env.NODE_ENV)
    logger.debug('Refreshing before reading balance...')
    await postRefresh()
    await new Promise(resolve => setTimeout(resolve, 10000))
  }
  const account = await resolveAccount(alias)
  return { alias, ...shapeAccount(account) }
}

/**
 * Gets settled transactions for one allowed account, paginating through all pages.
 * @param {string} alias
 * @param {Object} [options]
 * @param {string} [options.start] - ISO 8601 date/time, exclusive lower bound.
 * @param {string} [options.end] - ISO 8601 date/time, inclusive upper bound.
 * @returns {Promise<Object>}
 */
async function getTransactions (alias, { start, end } = {}) {
  const logger = await createLogger(process.env.NODE_ENV)
  const account = await resolveAccount(alias)
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
      logger.warn(`Stopped paginating transactions for '${alias}' after ${MAX_PAGES} pages; results may be incomplete.`)
      break
    }
  } while (cursor)
  return {
    alias,
    account: shapeAccount(account),
    start: start || null,
    end: end || null,
    count: items.length,
    transactions: items
  }
}

export { listAllowedAccounts, getBalance, getTransactions, supportedAliases }
