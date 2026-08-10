import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import { getBalance, getTransactions, getAllTransactions, getPending } from '../src/bank-gateway.js'

const westpacAccount = {
  _id: 'acc_westpac',
  name: 'Bill Payments',
  type: 'CHECKING',
  connection: { name: 'Westpac' },
  balance: { current: 250, available: 250 },
  formatted_account: '03-1234-5678900-00'
}

describe('bank-gateway', () => {
  let getStub, postStub, clock

  beforeEach(() => {
    process.env.AKAHU_APP_TOKEN = 'app_token_test'
    process.env.AKAHU_USER_TOKEN = 'user_token_test'
    getStub = sinon.stub(axios, 'get')
    postStub = sinon.stub(axios, 'post')
  })

  afterEach(() => {
    sinon.restore()
    if (clock) {
      clock.restore()
      clock = undefined
    }
  })

  describe('resolving by account id', () => {
    it('fetches by account id', async () => {
      getStub.resolves({ data: { success: true, item: westpacAccount } })
      const result = await getBalance('acc_westpac')
      expect(result.id).to.equal('acc_westpac')
      expect(result.bank).to.equal('Westpac')
      expect(result.balance.current).to.equal(250)
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/accounts/acc_westpac')
    })

    it('throws when the account id does not resolve to an account', async () => {
      getStub.resolves({ data: { success: true, item: null } })
      try {
        await getBalance('acc_missing')
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.include('acc_missing')
      }
    })
  })

  describe('account id validation', () => {
    it('rejects a missing account id', async () => {
      try {
        await getBalance()
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.match(/Account ID is required/)
      }
    })
  })

  describe('getBalance', () => {
    it('refreshes first when refresh: true, waiting for the refresh to land', async () => {
      clock = sinon.useFakeTimers()
      let refreshedAt = '2026-08-10T09:00:00.000Z'
      postStub.callsFake(async () => {
        refreshedAt = '2026-08-10T09:05:00.000Z'
        return { data: { success: true } }
      })
      getStub.callsFake(async url => {
        if (url === 'https://api.akahu.io/v1/accounts') {
          return { data: { success: true, items: [{ ...westpacAccount, refreshed: { balance: refreshedAt } }] } }
        }
        return { data: { success: true, item: westpacAccount } }
      })
      const promise = getBalance('acc_westpac', { refresh: true })
      await clock.tickAsync(2000)
      const result = await promise
      expect(postStub.calledWith('https://api.akahu.io/v1/refresh', {})).to.equal(true)
      expect(result.id).to.equal('acc_westpac')
    })
  })

  describe('getTransactions', () => {
    it('shapes and paginates transactions until the cursor is exhausted', async () => {
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).resolves({
        data: {
          success: true,
          items: [{ _id: 't1', date: '2026-01-01', description: 'Coffee', amount: -5, balance: 245, type: 'DEBIT', merchant: { name: 'Cafe' } }],
          cursor: { next: 'page2' }
        }
      })
      getStub.onCall(2).resolves({
        data: {
          success: true,
          items: [{ _id: 't2', date: '2026-01-02', description: 'Salary', amount: 1000, balance: 1245, type: 'CREDIT' }],
          cursor: { next: null }
        }
      })
      const result = await getTransactions('acc_westpac')
      expect(result.count).to.equal(2)
      expect(result.transactions[0]).to.deep.include({
        id: 't1', date: '2026-01-01', description: 'Coffee', amount: -5, balance: 245, type: 'DEBIT', merchant: 'Cafe'
      })
      expect(result.transactions[1].merchant).to.equal(undefined)
    })

    it('treats a response with no items or cursor as a single, empty page', async () => {
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).resolves({ data: { success: true } })
      const result = await getTransactions('acc_westpac')
      expect(result.count).to.equal(0)
      expect(result.transactions).to.deep.equal([])
    })

    it('stops after MAX_PAGES and warns if a cursor remains', async () => {
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).callsFake(async () => ({
        data: { success: true, items: [{ _id: 't', date: 'd', description: 'x', amount: 1 }], cursor: { next: 'more' } }
      }))
      for (let i = 2; i <= 20; i++) {
        getStub.onCall(i).callsFake(async () => ({
          data: { success: true, items: [{ _id: 't', date: 'd', description: 'x', amount: 1 }], cursor: { next: 'more' } }
        }))
      }
      const result = await getTransactions('acc_westpac')
      expect(result.count).to.equal(20)
      expect(result.truncated).to.equal(true)
    })

    it('reports truncated: false when every page was read', async () => {
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).resolves({ data: { success: true, items: [], cursor: {} } })
      const result = await getTransactions('acc_westpac')
      expect(result.truncated).to.equal(false)
    })
  })

  describe('getAllTransactions', () => {
    it('paginates across every account and returns an account lookup', async () => {
      getStub.onCall(0).resolves({
        data: {
          success: true,
          items: [{ _id: 't1', _account: 'acc_westpac', date: '2026-01-01', description: 'Coffee', amount: -5 }],
          cursor: { next: 'page2' }
        }
      })
      getStub.onCall(1).resolves({
        data: {
          success: true,
          items: [{ _id: 't2', _account: 'acc_bnz', date: '2026-01-02', description: 'Salary', amount: 1000 }],
          cursor: { next: null }
        }
      })
      getStub.onCall(2).resolves({ data: { success: true, items: [westpacAccount] } })

      const result = await getAllTransactions({ start: '2026-01-01', end: '2026-01-31' })
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/transactions?start=2026-01-01&end=2026-01-31')
      expect(getStub.secondCall.args[0]).to.include('cursor=page2')
      expect(result.count).to.equal(2)
      expect(result.start).to.equal('2026-01-01')
      expect(result.end).to.equal('2026-01-31')
      expect(result.transactions.map(t => t.account)).to.deep.equal(['acc_westpac', 'acc_bnz'])
      expect(result.accounts).to.deep.equal({ acc_westpac: { bank: 'Westpac', name: 'Bill Payments' } })
    })

    it('omits the query string entirely when no date range is given', async () => {
      getStub.onCall(0).resolves({ data: { success: true, items: [] } })
      getStub.onCall(1).resolves({ data: { success: true, items: [] } })
      const result = await getAllTransactions()
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/transactions')
      expect(result.start).to.equal(null)
      expect(result.end).to.equal(null)
      expect(result.accounts).to.deep.equal({})
    })

    it('treats a missing accounts items array as an empty lookup', async () => {
      getStub.onCall(0).resolves({ data: { success: true, items: [] } })
      getStub.onCall(1).resolves({ data: { success: true } })
      const result = await getAllTransactions()
      expect(result.accounts).to.deep.equal({})
    })

    it('builds a lookup entry for an account with no connection', async () => {
      getStub.onCall(0).resolves({ data: { success: true, items: [] } })
      getStub.onCall(1).resolves({ data: { success: true, items: [{ _id: 'acc_bare', name: 'Bare' }] } })
      const result = await getAllTransactions()
      expect(result.accounts).to.deep.equal({ acc_bare: { bank: undefined, name: 'Bare' } })
    })

    it('stops after MAX_PAGES and warns if a cursor remains', async () => {
      getStub.callsFake(async url => {
        if (url === 'https://api.akahu.io/v1/accounts') {
          return { data: { success: true, items: [] } }
        }
        return { data: { success: true, items: [{ _id: 't', _account: 'acc_x', date: 'd', description: 'x', amount: 1 }], cursor: { next: 'more' } } }
      })
      const result = await getAllTransactions()
      expect(result.count).to.equal(50)
      expect(result.truncated).to.equal(true)
    })
  })

  describe('getPending', () => {
    const pendingRow = {
      _account: 'acc_westpac',
      date: '2026-08-10T07:01:16.000Z',
      updated_at: '2026-08-10T09:08:39.972Z',
      description: 'Alternaleaf Nz Pty L',
      amount: -49,
      type: 'DEBIT'
    }

    it('fetches pending transactions across every account', async () => {
      getStub.onCall(0).resolves({ data: { success: true, items: [pendingRow] } })
      getStub.onCall(1).resolves({ data: { success: true, items: [westpacAccount] } })
      const result = await getPending()
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/transactions/pending')
      expect(result.count).to.equal(1)
      expect(result.transactions[0].amount).to.equal(-49)
      expect(result.accounts.acc_westpac.bank).to.equal('Westpac')
      expect(result.account).to.equal(undefined)
    })

    it('fetches pending transactions for a single account', async () => {
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).resolves({ data: { success: true, items: [pendingRow] } })
      const result = await getPending({ account: 'acc_westpac' })
      expect(getStub.secondCall.args[0]).to.equal('https://api.akahu.io/v1/accounts/acc_westpac/transactions/pending')
      expect(result.account.id).to.equal('acc_westpac')
      expect(result.count).to.equal(1)
      expect(result.accounts).to.equal(undefined)
    })

    it('treats a response with no items as no pending transactions', async () => {
      getStub.onCall(0).resolves({ data: { success: true } })
      getStub.onCall(1).resolves({ data: { success: true, items: [] } })
      const result = await getPending()
      expect(result.count).to.equal(0)
      expect(result.transactions).to.deep.equal([])
    })

    it('treats a single-account response with no items as no pending transactions', async () => {
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).resolves({ data: { success: true } })
      const result = await getPending({ account: 'acc_westpac' })
      expect(result.count).to.equal(0)
    })
  })
})
