import { expect } from 'chai'
import sinon from 'sinon'
import axios from 'axios'
import winston from 'winston'
import { TOOLS, callTool, startMcpServer, redirectConsoleLoggingToStderr } from '../src/mcp-server.js'

const westpacAccount = {
  _id: 'acc_westpac',
  name: 'Bill Payments',
  type: 'CHECKING',
  connection: { name: 'Westpac' },
  balance: { current: 250, available: 250 },
  formatted_account: '03-1234-5678900-00'
}

describe('mcp-server', () => {
  let getStub, postStub

  beforeEach(() => {
    process.env.AKAHU_APP_TOKEN = 'app_token_test'
    process.env.AKAHU_USER_TOKEN = 'user_token_test'
    process.env.WESTPAC_ACCOUNT_ID = 'acc_westpac'
    getStub = sinon.stub(axios, 'get')
    postStub = sinon.stub(axios, 'post')
  })

  afterEach(() => {
    sinon.restore()
    delete process.env.WESTPAC_ACCOUNT_ID
  })

  describe('TOOLS', () => {
    it('declares the expected tool names', () => {
      expect(TOOLS.map(t => t.name)).to.deep.equal([
        'list_accounts',
        'bank_list_accounts',
        'bank_get_balance',
        'bank_get_transactions'
      ])
    })
  })

  describe('callTool', () => {
    it('dispatches list_accounts', async () => {
      getStub.resolves({ data: { success: true, items: [westpacAccount] } })
      const result = await callTool('list_accounts', {})
      expect(result[0].bank).to.equal('Westpac')
    })

    it('dispatches bank_list_accounts', async () => {
      getStub.resolves({ data: { success: true, item: westpacAccount } })
      const result = await callTool('bank_list_accounts', {})
      expect(result.map(r => r.alias)).to.have.members(['rabobank', 'westpac'])
    })

    it('dispatches bank_get_balance', async () => {
      getStub.resolves({ data: { success: true, item: westpacAccount } })
      const result = await callTool('bank_get_balance', { account: 'westpac' })
      expect(result.alias).to.equal('westpac')
    })

    it('dispatches bank_get_transactions', async () => {
      getStub.onCall(0).resolves({ data: { success: true, item: westpacAccount } })
      getStub.onCall(1).resolves({ data: { success: true, items: [], cursor: {} } })
      const result = await callTool('bank_get_transactions', { account: 'westpac', start: '2026-01-01' })
      expect(result.alias).to.equal('westpac')
    })

    it('defaults args to {} when omitted', async () => {
      getStub.resolves({ data: { success: true, items: [] } })
      const result = await callTool('list_accounts')
      expect(result).to.deep.equal([])
    })

    it('throws for an unknown tool', async () => {
      try {
        await callTool('nope', {})
        expect.fail('expected error not thrown')
      } catch (error) {
        expect(error.message).to.equal('Unknown tool: nope')
      }
    })
  })

  describe('startMcpServer', () => {
    it('starts a stdio MCP server and handles a tool call end to end', async function () {
      this.timeout(5000)
      getStub.resolves({ data: { success: true, item: westpacAccount } })
      postStub.resolves({ data: { success: true } })

      const server = await startMcpServer()
      try {
        const listHandler = server._requestHandlers.get('tools/list')
        const toolsResult = await listHandler({ method: 'tools/list', params: {} }, {})
        expect(toolsResult.tools.map(t => t.name)).to.include('bank_get_balance')

        const callHandler = server._requestHandlers.get('tools/call')
        const callResult = await callHandler({
          method: 'tools/call',
          params: { name: 'bank_get_balance', arguments: { account: 'westpac' } }
        }, {})
        const payload = JSON.parse(callResult.content[0].text)
        expect(payload.alias).to.equal('westpac')

        const errorResult = await callHandler({
          method: 'tools/call',
          params: { name: 'bank_get_balance', arguments: { account: 'bnz' } }
        }, {})
        expect(errorResult.isError).to.equal(true)
        const errorPayload = JSON.parse(errorResult.content[0].text)
        expect(errorPayload.error).to.match(/Unknown account alias/)

        const noArgsResult = await callHandler({
          method: 'tools/call',
          params: { name: 'list_accounts' }
        }, {})
        expect(JSON.parse(noArgsResult.content[0].text)).to.deep.equal([])
      } finally {
        await server.close()
      }
    })
  })

  describe('redirectConsoleLoggingToStderr', () => {
    it('reuses the existing console transport level', () => {
      const logger = winston.createLogger({
        level: 'debug',
        transports: [new winston.transports.Console({ level: 'warn' })]
      })
      redirectConsoleLoggingToStderr(logger)
      const [consoleTransport] = logger.transports
      expect(consoleTransport.level).to.equal('warn')
      expect(consoleTransport.stderrLevels).to.have.property('warn')
    })

    it('defaults to debug when there is no existing console transport', () => {
      const logger = winston.createLogger({ level: 'debug', transports: [] })
      redirectConsoleLoggingToStderr(logger)
      const [consoleTransport] = logger.transports
      expect(consoleTransport.level).to.equal('debug')
    })
  })
})
