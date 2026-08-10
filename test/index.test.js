import { expect } from 'chai'
import { startMcpServer } from '../src/index.js'

describe('index', () => {
  it('re-exports startMcpServer', () => {
    expect(startMcpServer).to.be.a('function')
  })
})
