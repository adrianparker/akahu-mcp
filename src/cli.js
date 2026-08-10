import dotenv from 'dotenv'
import { Command } from 'commander'
import { renderTable } from 'console-table-printer'
import stripAnsi from 'strip-ansi'
import { getConnectionHealth, listAccounts } from './accounts.js'
import { getAllTransactions, getBalance, getPending, getTransactions } from './bank-gateway.js'

function formatMoney (amount) {
  return typeof amount === 'undefined' || amount === null ? 'N/A' : `$${amount.toFixed(2)}`
}

/**
 * Human-readable rendering of listAccounts() - the same data the `list_accounts`
 * MCP tool returns.
 * @param {Array<Object>} accounts
 * @returns {string}
 */
function formatAccounts (accounts) {
  if (accounts.length === 0) {
    return 'No accounts found.'
  }
  const rows = accounts.map(a => ({
    ID: a.id,
    Bank: a.bank,
    Name: a.name,
    Current: formatMoney(a.balance.current),
    Available: formatMoney(a.balance.available)
  }))
  return stripAnsi(renderTable(rows))
}

/**
 * Human-readable rendering of getBalance() - the same data the `bank_get_balance`
 * MCP tool returns.
 * @param {Object} result
 * @returns {string}
 */
function formatBalance (result) {
  return stripAnsi(renderTable([{
    ID: result.id,
    Bank: result.bank,
    Name: result.name,
    Current: formatMoney(result.balance.current),
    Available: formatMoney(result.balance.available)
  }]))
}

/**
 * Human-readable rendering of getTransactions() - the same data the `bank_get_transactions`
 * MCP tool returns.
 * @param {Object} result
 * @returns {string}
 */
function formatTransactions (result) {
  if (result.transactions.length === 0) {
    return `No transactions found for ${result.account.id}.`
  }
  const rows = result.transactions.map(t => ({
    Date: t.date,
    Description: t.description,
    Amount: formatMoney(t.amount),
    Balance: formatMoney(t.balance)
  }))
  return stripAnsi(renderTable(rows))
}

/**
 * Human-readable rendering of getAllTransactions() - the same data the
 * `bank_get_all_transactions` MCP tool returns.
 * @param {Object} result
 * @returns {string}
 */
function formatAllTransactions (result) {
  if (result.transactions.length === 0) {
    return 'No transactions found.'
  }
  const rows = result.transactions.map(t => ({
    Date: t.date,
    Account: describeAccount(result.accounts[t.account]),
    Description: t.description,
    Amount: formatMoney(t.amount)
  }))
  return stripAnsi(renderTable(rows))
}

/**
 * Human-readable rendering of getPending() - the same data the
 * `bank_get_pending_transactions` MCP tool returns.
 * @param {Object} result
 * @returns {string}
 */
function formatPendingTransactions (result) {
  if (result.transactions.length === 0) {
    return 'No pending transactions found.'
  }
  const rows = result.transactions.map(t => ({
    Date: t.date,
    Account: result.account ? result.account.name : describeAccount(result.accounts[t.account]),
    Description: t.description,
    Amount: formatMoney(t.amount)
  }))
  return stripAnsi(renderTable(rows))
}

/**
 * Human-readable rendering of getConnectionHealth() - the same data the
 * `bank_get_connection_health` MCP tool returns.
 * @param {Array<Object>} connections
 * @returns {string}
 */
function formatConnectionHealth (connections) {
  if (connections.length === 0) {
    return 'No connections found.'
  }
  const rows = connections.map(c => ({
    Bank: c.bank,
    Status: c.status,
    Accounts: c.accountCount,
    'Stale (hrs)': c.staleHours === null ? 'N/A' : c.staleHours,
    'Balance refreshed': c.balanceRefreshedAt || 'never',
    'Transactions refreshed': c.transactionsRefreshedAt || 'never'
  }))
  return stripAnsi(renderTable(rows))
}

function describeAccount (account) {
  return account ? `${account.bank} ${account.name}` : 'Unknown'
}

function buildProgram ({ onOutput = console.log } = {}) {
  const program = new Command()
  program
    .name('akahu')
    .description('Human-readable command line access to the Akahu accounts this server can reach.')

  program
    .command('list-accounts')
    .description('List every account Akahu has access to, unrestricted.')
    .option('--refresh', 'Refresh from the bank before listing (adds ~10 seconds).', false)
    .action(async options => {
      const accounts = await listAccounts({ refresh: options.refresh })
      onOutput(formatAccounts(accounts))
    })

  program
    .command('balance')
    .description('Get the current and available balance for one account.')
    .argument('<account-id>', 'Akahu account ID (see `list-accounts`)')
    .option('--refresh', 'Refresh from the bank before reading the balance (adds ~10 seconds).', false)
    .action(async (accountId, options) => {
      const result = await getBalance(accountId, { refresh: options.refresh })
      onOutput(formatBalance(result))
    })

  program
    .command('transactions')
    .description('Get settled transactions for one account.')
    .argument('<account-id>', 'Akahu account ID (see `list-accounts`)')
    .option('--start <date>', 'ISO 8601 date/time, exclusive lower bound.')
    .option('--end <date>', 'ISO 8601 date/time, inclusive upper bound.')
    .action(async (accountId, options) => {
      const result = await getTransactions(accountId, { start: options.start, end: options.end })
      onOutput(formatTransactions(result))
    })

  program
    .command('all-transactions')
    .description('Get settled transactions across every account at once.')
    .option('--start <date>', 'ISO 8601 date/time, exclusive lower bound.')
    .option('--end <date>', 'ISO 8601 date/time, inclusive upper bound.')
    .action(async options => {
      const result = await getAllTransactions({ start: options.start, end: options.end })
      onOutput(formatAllTransactions(result))
    })

  program
    .command('pending')
    .description('Get pending (unsettled) transactions, for one account or across all of them.')
    .argument('[account-id]', 'Akahu account ID (see `list-accounts`). Omit for every account.')
    .action(async accountId => {
      const result = await getPending({ account: accountId })
      onOutput(formatPendingTransactions(result))
    })

  program
    .command('connection-health')
    .description('Show whether each bank connection is active and how stale its data is.')
    .action(async () => {
      onOutput(formatConnectionHealth(await getConnectionHealth()))
    })

  return program
}

async function runCli (argv) {
  dotenv.config({ quiet: true })
  const program = buildProgram()
  await program.parseAsync(argv)
}

/* c8 ignore start - exercised by running the bin, not by unit tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
/* c8 ignore stop */

export {
  buildProgram,
  formatAccounts,
  formatBalance,
  formatTransactions,
  formatAllTransactions,
  formatPendingTransactions,
  formatConnectionHealth,
  runCli
}
