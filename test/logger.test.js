import fs from 'fs'
import { expect } from 'chai'
import sinon from 'sinon'

async function freshLoggerModule () {
  return import(`../src/logger.js?fresh=${Date.now()}-${Math.random()}`)
}

describe('logger', () => {
  afterEach(() => {
    fs.rmSync('logs', { recursive: true, force: true })
  })

  it('returns the same instance on repeated calls (singleton)', async () => {
    const { createLogger } = await freshLoggerModule()
    const first = await createLogger('test')
    const second = await createLogger('test')
    expect(first).to.equal(second)
  })

  it('warns and uses default settings when no environment is given', async () => {
    const { createLogger } = await freshLoggerModule()
    const warnStub = sinon.stub(console, 'warn')
    try {
      const logger = await createLogger()
      expect(logger.level).to.equal('debug')
      expect(warnStub.called).to.equal(true)
    } finally {
      warnStub.restore()
    }
  })

  it('throws when the config file for the given environment does not exist', async () => {
    const { createLogger } = await freshLoggerModule()
    try {
      await createLogger('does-not-exist')
      expect.fail('expected error not thrown')
    } catch (error) {
      expect(error.message).to.include('Logging config file not found')
    }
  })

  it('builds a console-only logger when logToFile is false', async () => {
    const { createLogger } = await freshLoggerModule()
    const logger = await createLogger('test')
    expect(logger.transports.length).to.equal(1)
    expect(logger.level).to.equal('info')
  })

  it('adds a file transport when logToFile is true', async () => {
    const { createLogger } = await freshLoggerModule()
    const logger = await createLogger('app')
    expect(logger.transports.length).to.equal(2)
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const logFile = `logs/app-${year}-${month}.log`
    logger.info('trigger a real write through the file transport format')
    // The file transport's underlying write stream opens asynchronously, so give it a tick
    // before checking the file was written.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fs.existsSync(logFile)).to.equal(true)
    expect(fs.readFileSync(logFile, 'utf8')).to.include('trigger a real write')
  })
})
