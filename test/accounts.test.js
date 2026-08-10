import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import { listAccounts, getConnectionHealth } from '../src/accounts.js'

const bnzAccount = {
  _id: 'acc_bnz',
  name: 'Everyday',
  type: 'CHECKING',
  connection: { name: 'BNZ' },
  balance: { current: 500, available: 500 },
  formatted_account: '02-1234-5678900-00'
}

const westpacAccount = {
  _id: 'acc_westpac',
  name: 'Bill Payments',
  type: 'CHECKING',
  connection: { name: 'Westpac' },
  balance: { current: 250 },
  formatted_account: '03-1234-5678900-00'
}

describe('accounts', () => {
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

  it('lists and shapes every account, sorted by bank then name', async () => {
    getStub.resolves({ data: { success: true, items: [westpacAccount, bnzAccount] } })
    const result = await listAccounts()
    expect(result.map(a => a.bank)).to.deep.equal(['BNZ', 'Westpac'])
    expect(result[0]).to.deep.include({
      id: 'acc_bnz',
      bank: 'BNZ',
      name: 'Everyday',
      type: 'CHECKING',
      formattedAccount: '02-1234-5678900-00'
    })
    expect(result[0].balance).to.deep.include({ current: 500, available: 500 })
  })

  it('handles an account with no available balance', async () => {
    getStub.resolves({ data: { success: true, items: [westpacAccount] } })
    const result = await listAccounts()
    expect(result[0].balance.available).to.equal(undefined)
  })

  it('returns an empty array when there are no accounts', async () => {
    getStub.resolves({ data: { success: true, items: [] } })
    const result = await listAccounts()
    expect(result).to.deep.equal([])
  })

  it('treats a missing items array as empty', async () => {
    getStub.resolves({ data: { success: true } })
    const result = await listAccounts()
    expect(result).to.deep.equal([])
  })

  it('sorts accounts with no bank/name using the empty string fallback', async () => {
    const noConnection = { _id: 'acc_x', type: 'CHECKING', balance: { current: 1 } }
    getStub.resolves({ data: { success: true, items: [westpacAccount, noConnection] } })
    const result = await listAccounts()
    expect(result[0].bank).to.equal(undefined)
    expect(result[1].bank).to.equal('Westpac')
  })

  it('falls through to comparing names when banks are equal, tolerating a missing name', async () => {
    const westpacNoName = { ...westpacAccount, _id: 'acc_no_name', name: undefined }
    getStub.resolves({ data: { success: true, items: [westpacAccount, westpacNoName] } })
    const result = await listAccounts()
    expect(result[0].name).to.equal(undefined)
    expect(result[1].name).to.equal('Bill Payments')
  })

  it('tolerates both accounts having no bank or name', async () => {
    const a = { _id: 'acc_a', type: 'CHECKING', balance: { current: 1 } }
    const b = { _id: 'acc_b', type: 'CHECKING', balance: { current: 2 } }
    getStub.resolves({ data: { success: true, items: [a, b] } })
    const result = await listAccounts()
    expect(result.map(r => r.id)).to.have.members(['acc_a', 'acc_b'])
  })

  it('refreshes first when refresh: true', async () => {
    clock = sinon.useFakeTimers()
    postStub.resolves({ data: { success: true } })
    getStub.resolves({ data: { success: true, items: [] } })
    const promise = listAccounts({ refresh: true })
    await clock.tickAsync(10000)
    await promise
    expect(postStub.calledWith('https://api.akahu.io/v1/refresh', {})).to.equal(true)
  })

  describe('getConnectionHealth', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')

    const bnzChecking = {
      _id: 'acc_bnz_1',
      name: 'Everyday',
      status: 'ACTIVE',
      connection: { _id: 'conn_bnz', name: 'BNZ' },
      refreshed: { balance: '2026-08-10T11:00:00.000Z', transactions: '2026-08-10T10:30:00.000Z' }
    }
    const bnzSavings = {
      _id: 'acc_bnz_2',
      name: 'Savings',
      status: 'ACTIVE',
      connection: { _id: 'conn_bnz', name: 'BNZ' },
      refreshed: { balance: '2026-08-10T11:30:00.000Z', transactions: '2026-08-10T11:30:00.000Z' }
    }
    const westpacBroken = {
      _id: 'acc_westpac',
      name: 'Bill Payments',
      status: 'INACTIVE',
      connection: { _id: 'conn_westpac', name: 'Westpac' },
      refreshed: { balance: '2026-08-08T12:00:00.000Z' }
    }

    it('groups accounts by connection and reports the stalest refresh on each', async () => {
      getStub.resolves({ data: { success: true, items: [bnzChecking, bnzSavings, westpacBroken] } })
      const result = await getConnectionHealth({ now })
      expect(result).to.have.length(2)
      // Most stale first: Westpac is 48 hours behind, BNZ 1.5.
      expect(result[0]).to.deep.equal({
        connection: 'conn_westpac',
        bank: 'Westpac',
        status: 'INACTIVE',
        accountCount: 1,
        inactiveAccounts: ['Bill Payments'],
        balanceRefreshedAt: '2026-08-08T12:00:00.000Z',
        transactionsRefreshedAt: null,
        staleHours: 48
      })
      expect(result[1]).to.deep.equal({
        connection: 'conn_bnz',
        bank: 'BNZ',
        status: 'ACTIVE',
        accountCount: 2,
        inactiveAccounts: [],
        balanceRefreshedAt: '2026-08-10T11:00:00.000Z',
        transactionsRefreshedAt: '2026-08-10T10:30:00.000Z',
        staleHours: 1.5
      })
    })

    it('reports a connection that has never refreshed rather than guessing at staleness', async () => {
      getStub.resolves({
        data: { success: true, items: [{ _id: 'acc_new', name: 'New', status: 'ACTIVE', connection: { _id: 'conn_new', name: 'ANZ' } }] }
      })
      const [result] = await getConnectionHealth({ now })
      expect(result).to.deep.include({
        balanceRefreshedAt: null,
        transactionsRefreshedAt: null,
        staleHours: null
      })
    })

    const neverRefreshed = { _id: 'acc_new', name: 'New', status: 'ACTIVE', connection: { _id: 'conn_new', name: 'ANZ' } }

    it('sorts a never-refreshed connection below one with a known staleness', async () => {
      getStub.resolves({ data: { success: true, items: [neverRefreshed, westpacBroken] } })
      const result = await getConnectionHealth({ now })
      expect(result.map(c => c.bank)).to.deep.equal(['Westpac', 'ANZ'])
    })

    it('sorts the same way regardless of the order Akahu returns the accounts in', async () => {
      getStub.resolves({ data: { success: true, items: [westpacBroken, neverRefreshed] } })
      const result = await getConnectionHealth({ now })
      expect(result.map(c => c.bank)).to.deep.equal(['Westpac', 'ANZ'])
    })

    it('buckets an account with no connection under "unknown"', async () => {
      getStub.resolves({ data: { success: true, items: [{ _id: 'acc_x', name: 'X', status: 'ACTIVE' }] } })
      const [result] = await getConnectionHealth({ now })
      expect(result.connection).to.equal('unknown')
      expect(result.bank).to.equal(null)
    })

    it('returns an empty array when there are no accounts', async () => {
      getStub.resolves({ data: { success: true } })
      expect(await getConnectionHealth({ now })).to.deep.equal([])
    })

    it('defaults the reference time to now', async () => {
      getStub.resolves({ data: { success: true, items: [bnzSavings] } })
      const [result] = await getConnectionHealth()
      expect(result.staleHours).to.be.a('number')
    })
  })
})
