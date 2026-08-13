import axios from 'axios'
import { createLogger } from './logger.js'

/**
 * Fetches user accounts from the Akahu API.
 * @returns {Promise<Object>} The user accounts.
 */
async function getAccounts () {
  return doGet('https://api.akahu.io/v1/accounts', 'Accounts')
}

/**
 * Fetches a single user account from the Akahu API.
 * @param {string} id - The ID of the account to fetch.
 * @returns {Promise<Object>} The user account.
 */
async function getAccount (id) {
  return doGet(`https://api.akahu.io/v1/accounts/${id}`, 'Account')
}

/**
 * Fetches a page of settled transactions for a single account from the Akahu API.
 * Note: `start` is exclusive and `end` is inclusive, per Akahu's semantics. Results are
 * paginated (max 100 per page) - pass the `cursor` from a previous response's
 * `cursor.next` to fetch the next page. See https://developers.akahu.nz/docs/accessing-transactional-data
 * @param {string} accountId - The Akahu account ID to fetch transactions for.
 * @param {Object} [options] - Query options.
 * @param {string} [options.start] - ISO 8601 date/time, exclusive lower bound.
 * @param {string} [options.end] - ISO 8601 date/time, inclusive upper bound.
 * @param {string} [options.cursor] - Pagination cursor from a previous page's `cursor.next`.
 * @returns {Promise<Object>} The response data, including `items` and `cursor.next`.
 * @throws {Error} If the account ID is not provided or if the API call fails.
 */
async function getTransactionsForAccount (accountId, { start, end, cursor } = {}) {
  if (!accountId) {
    throw new Error('Account ID is required.')
  }
  const params = new URLSearchParams()
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  if (cursor) params.set('cursor', cursor)
  const qs = params.toString()
  const url = `https://api.akahu.io/v1/accounts/${accountId}/transactions${qs ? '?' + qs : ''}`
  return doGet(url, 'Transactions')
}

/**
 * Fetches a page of settled transactions across every account the app can access.
 * Same `start`/`end`/`cursor` semantics as {@link getTransactionsForAccount}.
 * @param {Object} [options] - Query options.
 * @param {string} [options.start] - ISO 8601 date/time, exclusive lower bound.
 * @param {string} [options.end] - ISO 8601 date/time, inclusive upper bound.
 * @param {string} [options.cursor] - Pagination cursor from a previous page's `cursor.next`.
 * @returns {Promise<Object>} The response data, including `items` and `cursor.next`.
 */
async function getTransactionsForUser ({ start, end, cursor } = {}) {
  const params = new URLSearchParams()
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  if (cursor) params.set('cursor', cursor)
  const qs = params.toString()
  return doGet(`https://api.akahu.io/v1/transactions${qs ? '?' + qs : ''}`, 'All transactions')
}

/**
 * Fetches pending (unsettled) transactions across every account the app can access.
 * Not paginated - Akahu returns the full set in one response.
 * @returns {Promise<Object>} The response data, including `items`.
 */
async function getPendingTransactions () {
  return doGet('https://api.akahu.io/v1/transactions/pending', 'Pending transactions')
}

/**
 * Fetches pending (unsettled) transactions for a single account. Not paginated.
 * @param {string} accountId - The Akahu account ID to fetch pending transactions for.
 * @returns {Promise<Object>} The response data, including `items`.
 * @throws {Error} If the account ID is not provided or if the API call fails.
 */
async function getPendingTransactionsForAccount (accountId) {
  if (!accountId) {
    throw new Error('Account ID is required.')
  }
  return doGet(`https://api.akahu.io/v1/accounts/${accountId}/transactions/pending`, 'Pending transactions')
}

/**
 * Asks Akahu to refresh account data from the underlying bank connections.
 * @returns {Promise<Object>} The response data.
 */
async function postRefresh () {
  return doPost('https://api.akahu.io/v1/refresh', {}, 'Refresh')
}

// Akahu's slowest normal response is well under 5s; without a ceiling a stalled bank
// connection hangs an MCP tool call indefinitely, with no way for the client to recover.
const TIMEOUT_MS = 30000

/**
 * Builds the auth headers Akahu expects. Read from the environment on every call rather
 * than captured at module load, so a token can be swapped without a restart.
 * @returns {Object}
 */
function buildHeaders () {
  return {
    accept: 'application/json',
    Authorization: 'Bearer ' + process.env.AKAHU_USER_TOKEN,
    'X-Akahu-Id': process.env.AKAHU_APP_TOKEN
  }
}

/**
 * Turns an axios failure into something a caller can act on. Raw axios messages read as
 * "Request failed with status code 404", which tells whoever is reading the tool output
 * nothing about what to do next. Anything unrecognised is passed through untouched.
 * @param {Error} error - The error thrown by axios, or by the `success: false` check.
 * @param {string} url - The URL that was being requested.
 * @returns {Error}
 */
function describeError (error, url) {
  const status = error.response && error.response.status
  if (status === 401 || status === 403) {
    return new Error(`Akahu rejected the credentials for ${url} (HTTP ${status}). Check AKAHU_APP_TOKEN and AKAHU_USER_TOKEN.`)
  }
  if (status === 404) {
    return new Error(`Akahu has no record of ${url} (HTTP 404). The ID may be wrong, or the account may no longer be connected.`)
  }
  if (status === 429) {
    return new Error(`Akahu rate limited ${url} (HTTP 429). Refreshes are limited to one per connection every 5 minutes, and roughly one an hour for a personal app. Wait and retry.`)
  }
  if (status >= 500) {
    return new Error(`Akahu returned a server error for ${url} (HTTP ${status}). This is Akahu's end, not the request - retry shortly.`)
  }
  if (error.code === 'ECONNABORTED') {
    return new Error(`Akahu did not respond to ${url} within ${TIMEOUT_MS / 1000}s.`)
  }
  return error
}

/**
 * Summarises a response body for the debug log. The bodies here are balances and transaction
 * history, so serialising one verbatim writes a full bank statement into `logs/` the moment
 * the log level drops to debug. Log the shape instead - a count, or the top-level key names,
 * is enough to tell whether a call returned what was expected.
 * @param {Object} data - The response body from Akahu.
 * @returns {string} A summary with no account or transaction content in it.
 */
function describeBody (data) {
  if (!data || typeof data !== 'object') return ''
  if (Array.isArray(data.items)) {
    const more = data.cursor && data.cursor.next ? ', more pages follow' : ''
    return ` ${data.items.length} item(s)${more}`
  }
  return ` keys: ${Object.keys(data).join(', ')}`
}

/**
 * Makes a GET request to the specified URL with the provided label for logging.
 * @param {string} url - The URL to send the GET request to.
 * @param {string} label - A label for logging purposes.
 * @returns {Promise<Object>} The response data from the API.
 * @throws {Error} If the API call fails or if the response indicates an error.
 */
async function doGet (url, label) {
  const logger = await createLogger(process.env.NODE_ENV)
  try {
    const response = await axios.get(url, { headers: buildHeaders(), timeout: TIMEOUT_MS })
    logger.debug(`${label} successful:${describeBody(response.data)}`)
    if (!response.data.success) {
      throw new Error('API call ' + url + ' failed: ' + response.data.message)
    }
    return response.data
  } catch (error) {
    const described = describeError(error, url)
    logger.error(`${label} error: ${described.message}`)
    throw described
  }
}

/**
 * Makes a POST request to the specified URL with the provided parameters and label for logging.
 * @param {string} url - The URL to send the POST request to.
 * @param {Object} params - The parameters to include in the POST request.
 * @param {string} label - A label for logging purposes.
 * @returns {Promise<Object>} The response data from the API.
 * @throws {Error} If the API call fails or if the response indicates an error.
 */
async function doPost (url, params, label) {
  const logger = await createLogger(process.env.NODE_ENV)
  try {
    const response = await axios.post(url, params, { headers: buildHeaders(), timeout: TIMEOUT_MS })
    logger.debug(`${label} successful:${describeBody(response.data)}`)
    if (!response.data.success) {
      throw new Error('API call ' + url + ' failed: ' + response.data.message)
    }
    return response.data
  } catch (error) {
    const described = describeError(error, url)
    logger.error(`${label} error: ${described.message}`)
    throw described
  }
}

export {
  getAccounts,
  getAccount,
  getTransactionsForAccount,
  getTransactionsForUser,
  getPendingTransactions,
  getPendingTransactionsForAccount,
  postRefresh
}
