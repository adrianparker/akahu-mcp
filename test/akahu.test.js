import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import {
  getAccounts,
  getAccount,
  getTransactionsForAccount,
  getTransactionsForUser,
  getPendingTransactions,
  getPendingTransactionsForAccount,
  postRefresh
} from '../src/akahu.js'

describe('akahu', () => {
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

  describe('getAccounts', () => {
    it('returns the response data on success', async () => {
      getStub.resolves({ data: { success: true, items: [{ _id: 'acc_1' }] } })
      const result = await getAccounts()
      expect(result).to.deep.equal({ success: true, items: [{ _id: 'acc_1' }] })
      expect(getStub.calledWith('https://api.akahu.io/v1/accounts', sinon.match({
        headers: sinon.match({
          Authorization: 'Bearer user_token_test',
          'X-Akahu-Id': 'app_token_test'
        })
      }))).to.equal(true)
    })

    it('throws when the API responds with success: false', async () => {
      getStub.resolves({ data: { success: false, message: 'nope' } })
      try {
        await getAccounts()
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.include('nope')
      }
    })

    it('throws when the request itself fails', async () => {
      getStub.rejects(new Error('network down'))
      try {
        await getAccounts()
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.equal('network down')
      }
    })
  })

  describe('getAccount', () => {
    it('fetches a single account by id', async () => {
      getStub.resolves({ data: { success: true, item: { _id: 'acc_1' } } })
      const result = await getAccount('acc_1')
      expect(result).to.deep.equal({ success: true, item: { _id: 'acc_1' } })
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/accounts/acc_1')
    })
  })

  describe('getTransactionsForAccount', () => {
    it('throws when no account id is provided', async () => {
      try {
        await getTransactionsForAccount()
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.equal('Account ID is required.')
      }
    })

    it('builds a URL with no query string when no options are given', async () => {
      getStub.resolves({ data: { success: true, items: [] } })
      await getTransactionsForAccount('acc_1')
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/accounts/acc_1/transactions')
    })

    it('includes start, end and cursor in the query string when given', async () => {
      getStub.resolves({ data: { success: true, items: [] } })
      await getTransactionsForAccount('acc_1', { start: '2026-01-01', end: '2026-02-01', cursor: 'abc' })
      const url = getStub.firstCall.args[0]
      expect(url).to.include('start=2026-01-01')
      expect(url).to.include('end=2026-02-01')
      expect(url).to.include('cursor=abc')
    })
  })

  describe('getTransactionsForUser', () => {
    it('builds a URL with no query string when no options are given', async () => {
      getStub.resolves({ data: { success: true, items: [] } })
      await getTransactionsForUser()
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/transactions')
    })

    it('includes start, end and cursor in the query string when given', async () => {
      getStub.resolves({ data: { success: true, items: [] } })
      await getTransactionsForUser({ start: '2026-01-01', end: '2026-02-01', cursor: 'abc' })
      const url = getStub.firstCall.args[0]
      expect(url).to.include('start=2026-01-01')
      expect(url).to.include('end=2026-02-01')
      expect(url).to.include('cursor=abc')
    })
  })

  describe('getPendingTransactions', () => {
    it('fetches the pending transactions endpoint', async () => {
      getStub.resolves({ data: { success: true, items: [] } })
      await getPendingTransactions()
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/transactions/pending')
    })
  })

  describe('getPendingTransactionsForAccount', () => {
    it('throws when no account id is provided', async () => {
      try {
        await getPendingTransactionsForAccount()
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.equal('Account ID is required.')
      }
    })

    it('fetches the per-account pending transactions endpoint', async () => {
      getStub.resolves({ data: { success: true, items: [] } })
      await getPendingTransactionsForAccount('acc_1')
      expect(getStub.firstCall.args[0]).to.equal('https://api.akahu.io/v1/accounts/acc_1/transactions/pending')
    })
  })

  describe('postRefresh', () => {
    it('posts to the refresh endpoint', async () => {
      postStub.resolves({ data: { success: true } })
      const result = await postRefresh()
      expect(result).to.deep.equal({ success: true })
      expect(postStub.calledWith('https://api.akahu.io/v1/refresh', {})).to.equal(true)
    })

    it('throws when the API responds with success: false', async () => {
      postStub.resolves({ data: { success: false, message: 'nope' } })
      try {
        await postRefresh()
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.include('nope')
      }
    })

    it('throws when the request itself fails', async () => {
      postStub.rejects(new Error('network down'))
      try {
        await postRefresh()
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.equal('network down')
      }
    })
  })
})
