import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import { listAccounts } from '../src/accounts.js'

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
    expect(result[0]).to.deep.equal({
      id: 'acc_bnz',
      bank: 'BNZ',
      name: 'Everyday',
      type: 'CHECKING',
      balance: { current: 500, available: 500 },
      formattedAccount: '02-1234-5678900-00'
    })
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
})
