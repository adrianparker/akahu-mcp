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
 * Asks Akahu to refresh account data from the underlying bank connections.
 * @returns {Promise<Object>} The response data.
 */
async function postRefresh () {
  return doPost('https://api.akahu.io/v1/refresh', {}, 'Refresh')
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
  const headers = {
    accept: 'application/json',
    Authorization: 'Bearer ' + process.env.AKAHU_USER_TOKEN,
    'X-Akahu-Id': process.env.AKAHU_APP_TOKEN
  }
  try {
    const response = await axios.get(url, { headers })
    logger.debug(`${label} successful: ${JSON.stringify(response.data, null, 2)}`)
    if (!response.data.success) {
      throw new Error('API call ' + url + ' failed: ' + response.data.message)
    }
    return response.data
  } catch (error) {
    logger.error(`${label} error: ${error.message}`)
    throw error
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
  const headers = {
    accept: 'application/json',
    Authorization: 'Bearer ' + process.env.AKAHU_USER_TOKEN,
    'X-Akahu-Id': process.env.AKAHU_APP_TOKEN
  }
  try {
    const response = await axios.post(url, params, { headers })
    logger.debug(`${label} successful: ${JSON.stringify(response.data, null, 2)}`)
    if (!response.data.success) {
      throw new Error('API call ' + url + ' failed: ' + response.data.message)
    }
    return response.data
  } catch (error) {
    logger.error(`${label} error: ${error.message}`)
    throw error
  }
}

export { getAccounts, getAccount, getTransactionsForAccount, postRefresh }
