import dotenv from 'dotenv'
import { Command } from 'commander'
import { renderTable } from 'console-table-printer'
import stripAnsi from 'strip-ansi'
import { listAccounts } from './accounts.js'
import { getBalance, getTransactions, supportedAliases } from './bank-gateway.js'

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
    Alias: result.alias,
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
    return `No transactions found for ${result.alias}.`
  }
  const rows = result.transactions.map(t => ({
    Date: t.date,
    Description: t.description,
    Amount: formatMoney(t.amount),
    Balance: formatMoney(t.balance)
  }))
  return stripAnsi(renderTable(rows))
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
    .description('Get the current and available balance for one allowed account.')
    .argument('<account>', `Account alias (${supportedAliases().join(', ')})`)
    .option('--refresh', 'Refresh from the bank before reading the balance (adds ~10 seconds).', false)
    .action(async (account, options) => {
      const result = await getBalance(account, { refresh: options.refresh })
      onOutput(formatBalance(result))
    })

  program
    .command('transactions')
    .description('Get settled transactions for one allowed account.')
    .argument('<account>', `Account alias (${supportedAliases().join(', ')})`)
    .option('--start <date>', 'ISO 8601 date/time, exclusive lower bound.')
    .option('--end <date>', 'ISO 8601 date/time, inclusive upper bound.')
    .action(async (account, options) => {
      const result = await getTransactions(account, { start: options.start, end: options.end })
      onOutput(formatTransactions(result))
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

export { buildProgram, formatAccounts, formatBalance, formatTransactions, runCli }
