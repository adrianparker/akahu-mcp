import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import {
  buildProgram,
  formatAccounts,
  formatBalance,
  formatTransactions,
  formatAllTransactions,
  formatPendingTransactions,
  formatConnectionHealth,
  runCli
} from '../src/cli.js'

const westpacAccount = {
  _id: 'acc_westpac',
  name: 'Bill Payments',
  type: 'CHECKING',
  connection: { name: 'Westpac' },
  balance: { current: 250, available: 250 },
  formatted_account: '03-1234-5678900-00'
}

describe('cli', () => {
  let getStub, postStub

  beforeEach(() => {
    process.env.AKAHU_APP_TOKEN = 'app_token_test'
    process.env.AKAHU_USER_TOKEN = 'user_token_test'
    getStub = sinon.stub(axios, 'get')
    postStub = sinon.stub(axios, 'post')
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('formatAccounts', () => {
    it('renders a table of accounts', () => {
      const output = formatAccounts([{ id: 'acc_westpac', bank: 'Westpac', name: 'Bill Payments', balance: { current: 250, available: 250 } }])
      expect(output).to.include('acc_westpac')
      expect(output).to.include('Westpac')
      expect(output).to.include('$250.00')
    })

    it('reports when there are no accounts', () => {
      expect(formatAccounts([])).to.equal('No accounts found.')
    })

    it('shows N/A for a missing available balance', () => {
      const output = formatAccounts([{ id: 'acc_westpac', bank: 'Westpac', name: 'Bill Payments', balance: { current: 250 } }])
      expect(output).to.include('N/A')
    })
  })

  describe('formatBalance', () => {
    it('renders a single account balance', () => {
      const output = formatBalance({ id: 'acc_westpac', bank: 'Westpac', name: 'Bill Payments', balance: { current: 250, available: 250 } })
      expect(output).to.include('acc_westpac')
      expect(output).to.include('$250.00')
    })
  })

  describe('formatTransactions', () => {
    it('renders a table of transactions', () => {
      const output = formatTransactions({
        account: { id: 'acc_westpac' },
        transactions: [{ date: '2026-01-01', description: 'Coffee', amount: -5, balance: 245 }]
      })
      expect(output).to.include('Coffee')
      expect(output).to.include('$-5.00')
    })

    it('reports when there are no transactions', () => {
      expect(formatTransactions({ account: { id: 'acc_westpac' }, transactions: [] })).to.equal('No transactions found for acc_westpac.')
    })
  })

  describe('formatAllTransactions', () => {
    it('names the account each transaction came from', () => {
      const output = formatAllTransactions({
        accounts: { acc_westpac: { bank: 'Westpac', name: 'Bill Payments' } },
        transactions: [{ account: 'acc_westpac', date: '2026-01-01', description: 'Coffee', amount: -5 }]
      })
      expect(output).to.include('Westpac Bill Payments')
      expect(output).to.include('$-5.00')
    })

    it('falls back to Unknown for an account outside the lookup', () => {
      const output = formatAllTransactions({
        accounts: {},
        transactions: [{ account: 'acc_gone', date: '2026-01-01', description: 'Coffee', amount: -5 }]
      })
      expect(output).to.include('Unknown')
    })

    it('reports when there are no transactions', () => {
      expect(formatAllTransactions({ accounts: {}, transactions: [] })).to.equal('No transactions found.')
    })
  })

  describe('formatPendingTransactions', () => {
    it('renders pending transactions across all accounts', () => {
      const output = formatPendingTransactions({
        accounts: { acc_westpac: { bank: 'Westpac', name: 'Bill Payments' } },
        transactions: [{ account: 'acc_westpac', date: '2026-08-10', description: 'Alternaleaf', amount: -49 }]
      })
      expect(output).to.include('Westpac Bill Payments')
      expect(output).to.include('$-49.00')
    })

    it('uses the resolved account name in the single-account form', () => {
      const output = formatPendingTransactions({
        account: { id: 'acc_westpac', name: 'Bill Payments' },
        transactions: [{ account: 'acc_westpac', date: '2026-08-10', description: 'Alternaleaf', amount: -49 }]
      })
      expect(output).to.include('Bill Payments')
    })

    it('reports when there are no pending transactions', () => {
      expect(formatPendingTransactions({ accounts: {}, transactions: [] })).to.equal('No pending transactions found.')
    })
  })

  describe('formatConnectionHealth', () => {
    it('renders each connection with its staleness', () => {
      const output = formatConnectionHealth([{
        connection: 'conn_westpac',
        bank: 'Westpac',
        status: 'ACTIVE',
        accountCount: 2,
        staleHours: 1.5,
        balanceRefreshedAt: '2026-08-10T11:00:00.000Z',
        transactionsRefreshedAt: '2026-08-10T10:30:00.000Z'
      }])
      expect(output).to.include('Westpac')
      expect(output).to.include('ACTIVE')
      expect(output).to.include('1.5')
    })

    it('shows a connection that has never refreshed', () => {
      const output = formatConnectionHealth([{
        connection: 'conn_new',
        bank: 'ANZ',
        status: 'ACTIVE',
        accountCount: 1,
        staleHours: null,
        balanceRefreshedAt: null,
        transactionsRefreshedAt: null
      }])
      expect(output).to.include('N/A')
      expect(output).to.include('never')
    })

    it('reports when there are no connections', () => {
      expect(formatConnectionHealth([])).to.equal('No connections found.')
    })
  })

  describe('buildProgram', () => {
    it('list-accounts prints a human readable table', async () => {
      getStub.resolves({ data: { success: true, items: [westpacAccount] } })
      const onOutput = sinon.spy()
      const program = buildProgram({ onOutput })
      await program.parseAsync(['node', 'akahu', 'list-accounts'])
      expect(onOutput.calledOnce).to.equal(true)
      expect(onOutput.firstCall.args[0]).to.include('Westpac')
    })

    it('list-accounts --refresh refreshes first', async () => {
      const clock = sinon.useFakeTimers()
      postStub.resolves({ data: { success: true } })
      getStub.resolves({ data: { success: true, items: [westpacAccount] } })
      const onOutput = sinon.spy()
      const program = buildProgram({ onOutput })
      const parsePromise = program.parseAsync(['node', 'akahu', 'list-accounts', '--refresh'])
      await clock.tickAsync(10000)
      await parsePromise
      clock.restore()
      expect(postStub.called).to.equal(true)
      expect(onOutput.calledOnce).to.equal(true)
    })

    it('balance prints the account balance', async () => {
      getStub.resolves({ data: { success: true, item: westpacAccount } })
      const onOutput = sinon.spy()
      const program = buildProgram({ onOutput })
      await program.parseAsync(['node', 'akahu', 'balance', 'acc_westpac'])
      expect(onOutput.firstCall.args[0]).to.include('acc_westpac')
    })

    it('transactions prints the transactions table', async () => {
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).resolves({
        data: { success: true, items: [{ _id: 't1', date: '2026-01-01', description: 'Coffee', amount: -5, balance: 245 }], cursor: {} }
      })
      const onOutput = sinon.spy()
      const program = buildProgram({ onOutput })
      await program.parseAsync(['node', 'akahu', 'transactions', 'acc_westpac', '--start', '2026-01-01', '--end', '2026-02-01'])
      expect(onOutput.firstCall.args[0]).to.include('Coffee')
    })

    it('all-transactions prints transactions from every account', async () => {
      getStub.onCall(0).resolves({
        data: { success: true, items: [{ _id: 't1', _account: 'acc_westpac', date: '2026-01-01', description: 'Coffee', amount: -5 }], cursor: {} }
      })
      getStub.onCall(1).resolves({ data: { success: true, items: [westpacAccount] } })
      const onOutput = sinon.spy()
      const program = buildProgram({ onOutput })
      await program.parseAsync(['node', 'akahu', 'all-transactions', '--start', '2026-01-01', '--end', '2026-02-01'])
      expect(onOutput.firstCall.args[0]).to.include('Westpac Bill Payments')
    })

    it('pending prints pending transactions across every account', async () => {
      getStub.onCall(0).resolves({
        data: { success: true, items: [{ _account: 'acc_westpac', date: '2026-08-10', description: 'Alternaleaf', amount: -49 }] }
      })
      getStub.onCall(1).resolves({ data: { success: true, items: [westpacAccount] } })
      const onOutput = sinon.spy()
      const program = buildProgram({ onOutput })
      await program.parseAsync(['node', 'akahu', 'pending'])
      expect(onOutput.firstCall.args[0]).to.include('Alternaleaf')
    })

    it('pending accepts a single account id', async () => {
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).resolves({
        data: { success: true, items: [{ _account: 'acc_westpac', date: '2026-08-10', description: 'Alternaleaf', amount: -49 }] }
      })
      const onOutput = sinon.spy()
      const program = buildProgram({ onOutput })
      await program.parseAsync(['node', 'akahu', 'pending', 'acc_westpac'])
      expect(onOutput.firstCall.args[0]).to.include('Bill Payments')
    })

    it('connection-health prints the connection table', async () => {
      getStub.resolves({ data: { success: true, items: [westpacAccount] } })
      const onOutput = sinon.spy()
      const program = buildProgram({ onOutput })
      await program.parseAsync(['node', 'akahu', 'connection-health'])
      expect(onOutput.firstCall.args[0]).to.include('Westpac')
    })
  })

  describe('runCli', () => {
    it('parses argv and writes to the console', async () => {
      getStub.resolves({ data: { success: true, item: westpacAccount } })
      const logSpy = sinon.stub(console, 'log')
      try {
        await runCli(['node', 'akahu', 'balance', 'acc_westpac'])
        expect(logSpy.called).to.equal(true)
        expect(logSpy.lastCall.args[0]).to.include('acc_westpac')
      } finally {
        logSpy.restore()
      }
    })
  })
})
