import { expect } from 'chai'
import { shapeAccount, shapeTransaction, shapePendingTransaction } from '../src/shape.js'

const fullAccount = {
  _id: 'acc_bnz',
  name: 'VISA',
  type: 'CREDITCARD',
  status: 'ACTIVE',
  connection: { _id: 'conn_bnz', name: 'BNZ' },
  balance: { current: -1200, available: 3800, limit: 5000, overdrawn: false, currency: 'NZD' },
  formatted_account: '02-1234-5678900-00',
  attributes: ['TRANSACTIONS'],
  refreshed: { balance: '2026-08-10T09:00:00.000Z', transactions: '2026-08-10T09:00:05.000Z' },
  meta: { holder: 'A Parker' }
}

const fullTransaction = {
  _id: 'trans_1',
  _account: 'acc_westpac',
  date: '2026-08-06T11:59:59.000Z',
  posted_date: '2026-08-06T11:59:59.000Z',
  description: 'ARENA FITNESS CE 791395826',
  amount: -32,
  balance: 250,
  type: 'DIRECT DEBIT',
  merchant: { _id: 'merchant_1', name: 'Ezidebit' },
  category: {
    _id: 'nzfcc_1',
    name: 'General retail stores',
    groups: { personal_finance: { _id: 'group_1', name: 'Household' } }
  },
  meta: {
    particulars: 'GYM',
    code: 'MEMBER',
    reference: '791395826',
    other_account: '02-0386-0091282-27',
    card_suffix: '0926',
    logo: 'https://cdn.akahu.nz/logos/merchants/merchant_1'
  }
}

describe('shape', () => {
  describe('shapeAccount', () => {
    it('shapes every field of a fully populated account', () => {
      expect(shapeAccount(fullAccount)).to.deep.equal({
        id: 'acc_bnz',
        bank: 'BNZ',
        connection: 'conn_bnz',
        name: 'VISA',
        type: 'CREDITCARD',
        status: 'ACTIVE',
        balance: { current: -1200, available: 3800, limit: 5000, overdrawn: false, currency: 'NZD' },
        formattedAccount: '02-1234-5678900-00',
        attributes: ['TRANSACTIONS'],
        refreshed: { balance: '2026-08-10T09:00:00.000Z', transactions: '2026-08-10T09:00:05.000Z' },
        meta: { holder: 'A Parker' }
      })
    })

    it('tolerates an account with no connection, balance or meta', () => {
      const result = shapeAccount({ _id: 'acc_bare', name: 'Bare', type: 'CHECKING' })
      expect(result.bank).to.equal(undefined)
      expect(result.connection).to.equal(undefined)
      expect(result.balance).to.deep.equal({
        current: undefined,
        available: undefined,
        limit: undefined,
        overdrawn: undefined,
        currency: undefined
      })
      expect(result.meta).to.equal(undefined)
    })

    it('drops an empty meta object rather than serialising {}', () => {
      expect(shapeAccount({ ...fullAccount, meta: {} }).meta).to.equal(undefined)
    })
  })

  describe('shapeTransaction', () => {
    it('shapes every field of a fully enriched transaction', () => {
      expect(shapeTransaction(fullTransaction)).to.deep.equal({
        id: 'trans_1',
        account: 'acc_westpac',
        date: '2026-08-06T11:59:59.000Z',
        postedDate: '2026-08-06T11:59:59.000Z',
        description: 'ARENA FITNESS CE 791395826',
        amount: -32,
        balance: 250,
        type: 'DIRECT DEBIT',
        merchant: 'Ezidebit',
        category: { name: 'General retail stores', group: 'Household' },
        meta: {
          particulars: 'GYM',
          code: 'MEMBER',
          reference: '791395826',
          otherAccount: '02-0386-0091282-27',
          cardSuffix: '0926'
        }
      })
    })

    it('drops the logo and any meta field the bank did not supply', () => {
      const result = shapeTransaction({ ...fullTransaction, meta: { reference: 'REF', logo: 'https://x' } })
      expect(result.meta).to.deep.equal({ reference: 'REF' })
    })

    it('drops a meta block that carries nothing useful', () => {
      expect(shapeTransaction({ ...fullTransaction, meta: {} }).meta).to.equal(undefined)
    })

    it('tolerates an unenriched transaction with no merchant, category or meta', () => {
      const result = shapeTransaction({ _id: 't', _account: 'acc_x', date: 'd', description: 'x', amount: 1 })
      expect(result.merchant).to.equal(undefined)
      expect(result.category).to.equal(undefined)
      expect(result.meta).to.equal(undefined)
    })

    it('keeps the category name when Akahu supplies no personal finance group', () => {
      const result = shapeTransaction({ ...fullTransaction, category: { name: 'Insurance', groups: {} } })
      expect(result.category).to.deep.equal({ name: 'Insurance' })
    })

    it('tolerates a category with no groups object at all', () => {
      const result = shapeTransaction({ ...fullTransaction, category: { name: 'Insurance' } })
      expect(result.category).to.deep.equal({ name: 'Insurance' })
    })
  })

  describe('shapePendingTransaction', () => {
    it('shapes a pending transaction, which has no id and no running balance', () => {
      expect(shapePendingTransaction({
        _account: 'acc_bnz',
        date: '2026-08-10T07:01:16.000Z',
        updated_at: '2026-08-10T09:08:39.972Z',
        description: 'Alternaleaf Nz Pty L',
        amount: -49,
        type: 'DEBIT',
        meta: {}
      })).to.deep.equal({
        account: 'acc_bnz',
        date: '2026-08-10T07:01:16.000Z',
        updatedAt: '2026-08-10T09:08:39.972Z',
        description: 'Alternaleaf Nz Pty L',
        amount: -49,
        type: 'DEBIT',
        merchant: undefined,
        category: undefined,
        meta: undefined
      })
    })

    it('carries merchant and category through when Akahu has enriched it', () => {
      const result = shapePendingTransaction({
        _account: 'acc_bnz',
        date: 'd',
        description: 'x',
        amount: -1,
        merchant: { name: 'Ezidebit' },
        category: { name: 'Insurance', groups: { personal_finance: { name: 'Household' } } }
      })
      expect(result.merchant).to.equal('Ezidebit')
      expect(result.category).to.deep.equal({ name: 'Insurance', group: 'Household' })
    })
  })
})
