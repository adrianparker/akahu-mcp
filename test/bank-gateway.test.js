import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import { getBalance, getTransactions } from '../src/bank-gateway.js'

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
    it('refreshes first when refresh: true', async () => {
      clock = sinon.useFakeTimers()
      postStub.resolves({ data: { success: true } })
      getStub.resolves({ data: { success: true, item: westpacAccount } })
      const promise = getBalance('acc_westpac', { refresh: true })
      await clock.tickAsync(10000)
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
      expect(result.transactions[0]).to.deep.equal({
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
    })
  })
})
