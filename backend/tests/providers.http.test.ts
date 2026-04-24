import { EventEmitter } from 'node:events'
import http from 'node:http'
import { PassThrough } from 'node:stream'
import express from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
const providerConfigMocks = vi.hoisted(() => ({
  getAllProviders: vi.fn(),
  getProvider: vi.fn(),
  upsertProvider: vi.fn(),
  deleteProvider: vi.fn(),
  updateTestResult: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('../src/config/providerConfig.js', () => providerConfigMocks)

import providersRouter from '../src/routes/providers.js'

const opencodeProvider = {
  name: 'opencode',
  label: 'OpenCode',
  cliPath: '~/.opencode/bin/opencode',
  defaultModel: 'MiniMax-M2.7',
  contextWindow: 200000,
  apiKey: '',
  baseUrl: '',
  timeout: 1800,
  thinking: true,
  lastTested: null,
  lastTestResult: null,
}

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/providers', providersRouter)
  return app
}

let serverPort = 0
const bound = await new Promise<boolean>((resolve) => {
  const probe = http.createServer(makeApp())
  probe.on('error', (err: NodeJS.ErrnoException) => {
    resolve(err.code === 'EACCES' || err.code === 'EPERM' ? false : (() => { throw err })())
  })
  probe.listen(0, () => {
    const addr = probe.address()
    serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0
    probe.close()
    resolve(true)
  })
})
const runIfPortAvailable = bound ? it : it.skip

let server: http.Server

beforeAll(async () => {
  server = http.createServer(makeApp())
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  providerConfigMocks.getProvider.mockImplementation((name: string) => (name === 'opencode' ? opencodeProvider : undefined))
  providerConfigMocks.getAllProviders.mockReturnValue({ opencode: opencodeProvider })
})

function requestJson(
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : ''
    const req = http.request({
      hostname: '127.0.0.1',
      port: serverPort,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        let data: Record<string, unknown> = {}
        try { data = JSON.parse(raw) } catch { /* ignore */ }
        resolve({ status: res.statusCode ?? 0, data })
      })
    })
    req.on('error', (error) => resolve({ status: 0, data: { error: String(error) } }))
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

function createMockChildProcess() {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
  }
  proc.stdout = stdout
  proc.stderr = stderr
  return proc
}

describe('providersRouter opencode test command', () => {
  runIfPortAvailable('omits model and permissions flags from opencode preview', async () => {
    const res = await requestJson('GET', '/api/providers/opencode/preview')

    expect(res.status).toBe(200)
    expect(res.data.provider).toBe('opencode')
    expect(res.data.args).toEqual(['run', '--thinking', '--format', 'json', '--', '<prompt>'])
    expect(String(res.data.note)).not.toContain('-m')
    expect(String(res.data.note)).not.toContain('--dangerously-skip-permissions')
  })

  runIfPortAvailable('tests opencode connection without forced model and captures text events', async () => {
    spawnMock.mockImplementation(() => {
      const proc = createMockChildProcess()
      queueMicrotask(() => {
        proc.stdout.write(`${JSON.stringify({ type: 'reasoning', part: { text: '先想一下' } })}\n`)
        proc.stdout.write(`${JSON.stringify({ type: 'text', part: { text: '你好' } })}\n`)
        proc.stdout.end()
        proc.emit('close', 0)
      })
      return proc
    })

    const res = await requestJson('POST', '/api/providers/opencode/test')

    expect(res.status).toBe(200)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0]?.[1]).toEqual([
      'run',
      '--thinking',
      '--format',
      'json',
      '--',
      '说一个简单的词，比如"你好"',
    ])
    expect(res.data).toMatchObject({
      success: true,
      output: '你好',
    })
    expect(String(res.data.cli)).not.toContain('-m MiniMax-M2.7')
    expect(String(res.data.cli)).not.toContain('--dangerously-skip-permissions')
    expect(providerConfigMocks.updateTestResult).toHaveBeenCalledWith('opencode', {
      success: true,
      version: '你好',
    })
  })
})
