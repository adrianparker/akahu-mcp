import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import { refreshAndWait } from '../src/refresh.js'

const account = (refreshedBalance) => ({
  _id: 'acc_westpac',
  name: 'Bill Payments',
  connection: { name: 'Westpac' },
  refreshed: refreshedBalance ? { balance: refreshedBalance } : undefined
})

describe('refresh', () => {
  let getStub, postStub, clock

  beforeEach(() => {
    process.env.AKAHU_APP_TOKEN = 'app_token_test'
    process.env.AKAHU_USER_TOKEN = 'user_token_test'
    getStub = sinon.stub(axios, 'get')
    postStub = sinon.stub(axios, 'post')
    clock = sinon.useFakeTimers()
  })

  afterEach(() => {
    clock.restore()
    sinon.restore()
  })

  it('returns as soon as the refreshed timestamp advances', async () => {
    let refreshedAt = '2026-08-10T09:00:00.000Z'
    postStub.callsFake(async () => {
      refreshedAt = '2026-08-10T09:05:00.000Z'
      return { data: { success: true } }
    })
    getStub.callsFake(async () => ({ data: { success: true, items: [account(refreshedAt)] } }))

    const promise = refreshAndWait('a test')
    await clock.tickAsync(2000)
    expect(await promise).to.equal(true)
    expect(postStub.calledWith('https://api.akahu.io/v1/refresh', {})).to.equal(true)
  })

  it('keeps polling until the refresh lands rather than assuming a fixed delay', async () => {
    let refreshedAt = '2026-08-10T09:00:00.000Z'
    postStub.resolves({ data: { success: true } })
    getStub.callsFake(async () => ({ data: { success: true, items: [account(refreshedAt)] } }))

    const promise = refreshAndWait('a slow bank')
    await clock.tickAsync(6000)
    refreshedAt = '2026-08-10T09:05:00.000Z'
    await clock.tickAsync(2000)
    expect(await promise).to.equal(true)
  })

  it('gives up after the timeout and lets the caller continue with stale data', async () => {
    postStub.resolves({ data: { success: true } })
    getStub.resolves({ data: { success: true, items: [account('2026-08-10T09:00:00.000Z')] } })

    const promise = refreshAndWait('a dead connection')
    await clock.tickAsync(30000)
    expect(await promise).to.equal(false)
  })

  it('treats a first ever refresh, with no prior timestamp, as landed', async () => {
    let refreshed = null
    postStub.callsFake(async () => {
      refreshed = '2026-08-10T09:05:00.000Z'
      return { data: { success: true } }
    })
    getStub.callsFake(async () => ({ data: { success: true, items: [account(refreshed)] } }))

    const promise = refreshAndWait('a new connection')
    await clock.tickAsync(2000)
    expect(await promise).to.equal(true)
  })

  it('tolerates Akahu returning no accounts at all', async () => {
    postStub.resolves({ data: { success: true } })
    getStub.resolves({ data: { success: true } })

    const promise = refreshAndWait('an empty app')
    await clock.tickAsync(30000)
    expect(await promise).to.equal(false)
  })
})
