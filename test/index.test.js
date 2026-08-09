import { expect } from 'chai'
import { ping } from '../src/index.js'

describe('ping', () => {
  it('returns pong', () => {
    expect(ping()).to.equal('pong')
  })
})
