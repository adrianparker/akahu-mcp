/**
 * Trims Akahu's raw API objects down to the fields worth handing to a model or
 * printing in a table. Shared by every module so one account looks the same no
 * matter which endpoint it arrived from.
 */

/**
 * Drops undefined values, returning undefined if nothing is left. Keeps empty
 * nested objects (Akahu often sends `meta: {}`) out of the serialised output.
 * @param {Object} object
 * @returns {Object|undefined}
 */
function compact (object) {
  const entries = Object.entries(object).filter(([, value]) => typeof value !== 'undefined')
  return entries.length ? Object.fromEntries(entries) : undefined
}

/**
 * Shapes an Akahu account. See https://developers.akahu.nz/docs/the-account-model
 * @param {Object} account
 * @returns {Object}
 */
function shapeAccount (account) {
  return {
    id: account._id,
    bank: account.connection && account.connection.name,
    connection: account.connection && account.connection._id,
    name: account.name,
    type: account.type,
    status: account.status,
    balance: {
      current: account.balance && account.balance.current,
      available: account.balance && account.balance.available,
      limit: account.balance && account.balance.limit,
      overdrawn: account.balance && account.balance.overdrawn,
      currency: account.balance && account.balance.currency
    },
    formattedAccount: account.formatted_account,
    attributes: account.attributes,
    refreshed: account.refreshed,
    meta: account.meta && compact(account.meta)
  }
}

/**
 * Shapes the `meta` block Akahu attaches to a transaction. `particulars`, `code` and
 * `reference` are the three fields NZ banks carry on a direct debit/credit, so they
 * are what a bill payment can actually be matched on.
 * @param {Object} [meta]
 * @returns {Object|undefined}
 */
function shapeTransactionMeta (meta) {
  if (!meta) {
    return undefined
  }
  return compact({
    particulars: meta.particulars,
    code: meta.code,
    reference: meta.reference,
    otherAccount: meta.other_account,
    cardSuffix: meta.card_suffix
  })
}

/**
 * Shapes the NZFCC category Akahu enriches a transaction with. Akahu nests the
 * higher-level grouping under `groups.personal_finance`; flatten it to `group`.
 * @param {Object} [category]
 * @returns {Object|undefined}
 */
function shapeCategory (category) {
  if (!category) {
    return undefined
  }
  const personalFinance = category.groups && category.groups.personal_finance
  return compact({
    name: category.name,
    group: personalFinance && personalFinance.name
  })
}

/**
 * Shapes a settled (posted) Akahu transaction.
 * See https://developers.akahu.nz/docs/the-transaction-model
 * @param {Object} t
 * @returns {Object}
 */
function shapeTransaction (t) {
  return {
    id: t._id,
    account: t._account,
    date: t.date,
    postedDate: t.posted_date,
    description: t.description,
    amount: t.amount,
    balance: t.balance,
    type: t.type,
    merchant: t.merchant && t.merchant.name,
    category: shapeCategory(t.category),
    meta: shapeTransactionMeta(t.meta)
  }
}

/**
 * Shapes a pending (unsettled) Akahu transaction. Pending rows carry no `_id` and no
 * running `balance`, and their date/description can still change before they settle.
 * @param {Object} t
 * @returns {Object}
 */
function shapePendingTransaction (t) {
  return {
    account: t._account,
    date: t.date,
    updatedAt: t.updated_at,
    description: t.description,
    amount: t.amount,
    type: t.type,
    merchant: t.merchant && t.merchant.name,
    category: shapeCategory(t.category),
    meta: shapeTransactionMeta(t.meta)
  }
}

export { shapeAccount, shapeTransaction, shapePendingTransaction }
