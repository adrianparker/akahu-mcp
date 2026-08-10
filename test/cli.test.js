import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import { buildProgram, formatAccounts, formatBalance, formatTransactions, runCli } from '../src/cli.js'

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
