import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import { listAllowedAccounts, getBalance, getTransactions, supportedAliases } from '../src/bank-gateway.js'

const rabobankAccount = {
  _id: 'acc_rabo',
  name: 'Bill Funding',
  type: 'CHECKING',
  connection: { name: 'Rabobank' },
  balance: { current: 100.5, available: 100.5 },
  formatted_account: '01-1234-5678900-00'
}

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
    delete process.env.RABOBANK_ACCOUNT_ID
    delete process.env.WESTPAC_ACCOUNT_ID
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

  describe('supportedAliases', () => {
    it('only supports rabobank and westpac', () => {
      expect(supportedAliases()).to.have.members(['rabobank', 'westpac'])
      expect(supportedAliases().length).to.equal(2)
    })
  })

  describe('resolving via env var', () => {
    it('fetches by account id when the env var is set', async () => {
      process.env.WESTPAC_ACCOUNT_ID = 'acc_westpac'
      getStub.resolves({ data: { success: true, item: westpacAccount } })
      const result = await getBalance('westpac')
      expect(result.alias).to.equal('westpac')
      expect(result.id).to.equal('acc_westpac')
      expect(result.bank).to.equal('Westpac')
      expect(result.balance.current).to.equal(250)
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/accounts/acc_westpac')
    })

    it('throws when the configured id does not resolve to an account', async () => {
      process.env.WESTPAC_ACCOUNT_ID = 'acc_missing'
      getStub.resolves({ data: { success: true, item: null } })
      try {
        await getBalance('westpac')
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.include('acc_missing')
      }
    })
  })

  describe('resolving by bank name', () => {
    it('resolves the single matching account when no env var is set', async () => {
      getStub.resolves({ data: { success: true, items: [rabobankAccount, westpacAccount] } })
      const result = await getBalance('rabobank')
      expect(result.alias).to.equal('rabobank')
      expect(result.id).to.equal('acc_rabo')
    })

    it('skips accounts with no connection info when matching by name', async () => {
      const noConnection = { _id: 'acc_no_conn', name: 'Mystery', type: 'CHECKING', balance: { current: 1 } }
      getStub.resolves({ data: { success: true, items: [noConnection, rabobankAccount] } })
      const result = await getBalance('rabobank')
      expect(result.id).to.equal('acc_rabo')
    })

    it('throws when no account matches', async () => {
      getStub.resolves({ data: { success: true, items: [westpacAccount] } })
      try {
        await getBalance('rabobank')
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.include("No connected account found matching 'rabobank'")
      }
    })

    it('throws when more than one account matches', async () => {
      const duplicate = { ...rabobankAccount, _id: 'acc_rabo_2' }
      getStub.resolves({ data: { success: true, items: [rabobankAccount, duplicate] } })
      try {
        await getBalance('rabobank')
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.include('Multiple accounts match')
      }
    })
  })

  describe('alias validation', () => {
    it('rejects an unknown alias', async () => {
      try {
        await getBalance('bnz')
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.match(/Unknown account alias 'bnz'/)
      }
    })

    it('rejects a missing alias', async () => {
      try {
        await getBalance()
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.match(/Account alias is required/)
      }
    })
  })

  describe('getBalance', () => {
    it('refreshes first when refresh: true', async () => {
      clock = sinon.useFakeTimers()
      process.env.WESTPAC_ACCOUNT_ID = 'acc_westpac'
      postStub.resolves({ data: { success: true } })
      getStub.resolves({ data: { success: true, item: westpacAccount } })
      const promise = getBalance('westpac', { refresh: true })
      await clock.tickAsync(10000)
      const result = await promise
      expect(postStub.calledWith('https://api.akahu.io/v1/refresh', {})).to.equal(true)
      expect(result.alias).to.equal('westpac')
    })
  })

  describe('getTransactions', () => {
    it('shapes and paginates transactions until the cursor is exhausted', async () => {
      process.env.WESTPAC_ACCOUNT_ID = 'acc_westpac'
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
      const result = await getTransactions('westpac')
      expect(result.count).to.equal(2)
      expect(result.transactions[0]).to.deep.equal({
        id: 't1', date: '2026-01-01', description: 'Coffee', amount: -5, balance: 245, type: 'DEBIT', merchant: 'Cafe'
      })
      expect(result.transactions[1].merchant).to.equal(undefined)
    })

    it('treats a response with no items or cursor as a single, empty page', async () => {
      process.env.WESTPAC_ACCOUNT_ID = 'acc_westpac'
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).resolves({ data: { success: true } })
      const result = await getTransactions('westpac')
      expect(result.count).to.equal(0)
      expect(result.transactions).to.deep.equal([])
    })

    it('stops after MAX_PAGES and warns if a cursor remains', async () => {
      process.env.WESTPAC_ACCOUNT_ID = 'acc_westpac'
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).callsFake(async () => ({
        data: { success: true, items: [{ _id: 't', date: 'd', description: 'x', amount: 1 }], cursor: { next: 'more' } }
      }))
      for (let i = 2; i <= 20; i++) {
        getStub.onCall(i).callsFake(async () => ({
          data: { success: true, items: [{ _id: 't', date: 'd', description: 'x', amount: 1 }], cursor: { next: 'more' } }
        }))
      }
      const result = await getTransactions('westpac')
      expect(result.count).to.equal(20)
    })
  })

  describe('listAllowedAccounts', () => {
    it('returns one entry per alias, including errors for unresolved ones', async () => {
      getStub.resolves({ data: { success: true, items: [westpacAccount] } })
      const results = await listAllowedAccounts()
      expect(results.length).to.equal(2)
      const rabo = results.find(r => r.alias === 'rabobank')
      const westpac = results.find(r => r.alias === 'westpac')
      expect(rabo.error).to.include("No connected account found matching 'rabobank'")
      expect(westpac.id).to.equal('acc_westpac')
    })
  })
})
