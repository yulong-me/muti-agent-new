import { Router } from 'express'
import { spawn } from 'child_process'
import { Transform, type Readable } from 'stream'
import {
  getAllProviders,
  getProvider,
  upsertProvider,
  deleteProvider,
  updateTestResult,
  type ProviderConfig,
} from '../config/providerConfig.js'
import { debug } from '../lib/logger.js'

/**
 * Normalize subprocess stdout to UTF-8 text stream.
 * Uses TextDecoder with auto-detection to handle:
 * - UTF-16LE BOM from Windows CLI tools (opencode)
 * - UTF-8 from Unix CLI tools
 * The decoder is created with fatal:false so partial/invalid sequences are replaced
 * with the replacement character rather than throwing.
 */
function toUtf8(input: Readable): Readable {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  return input.pipe(new Transform({
    transform(chunk, _encoding, callback) {
      const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk)
      // TextDecoder auto-detects UTF-16LE BOM (FF FE) and handles it transparently
      const utf8 = decoder.decode(buf, { stream: true })
      callback(null, utf8)
    },
  }))
}

const router = Router()

// GET /api/providers
router.get('/', (_req, res) => {
  res.json(getAllProviders())
})

// GET /api/providers/:name
router.get('/:name', (req, res) => {
  const p = getProvider(req.params.name)
  if (!p) return res.status(404).json({ error: 'Provider not found' })
  res.json(p)
})

// POST /api/providers — create or update
router.post('/', (req, res) => {
  const { name, label, cliPath, defaultModel, apiKey, baseUrl, timeout, thinking } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const config = upsertProvider(name, {
    label: label || name,
    cliPath: cliPath || 'claude',
    defaultModel: defaultModel || '',
    apiKey: apiKey || '',
    baseUrl: baseUrl || '',
    timeout: Number(timeout) || 90,
    thinking: thinking !== false,
  })
  res.json(config[name])
})

// DELETE /api/providers/:name
router.delete('/:name', (req, res) => {
  const name = req.params.name
  if (name === 'claude-code') return res.status(400).json({ error: 'Cannot delete claude-code provider' })
  deleteProvider(name)
  res.json({ ok: true })
})

// GET /api/providers/:name/preview — show the resolved command that will be executed
router.get('/:name/preview', (req, res) => {
  const p = getProvider(req.params.name)
  if (!p) return res.status(404).json({ error: 'Provider not found' })

  const cliPath = p.cliPath.replace(/^~/, process.env.HOME || '/root')
  const defaultModel = p.defaultModel.trim()
  if (p.name === 'claude-code') {
    const args = ['-p', '<prompt>', '--verbose', '--output-format=stream-json', '--include-partial-messages']
    args.push('--dangerously-skip-permissions')
    if (defaultModel) args.push('--model', defaultModel)
    res.json({
      provider: 'claude-code',
      cli: cliPath,
      args,
      env: {
        ...(p.apiKey ? { ANTHROPIC_API_KEY: p.apiKey ? '(已设置)' : '(未设置)' } : {}),
        ...(p.baseUrl ? { ANTHROPIC_BASE_URL: p.baseUrl } : {}),
      },
      timeout: p.timeout,
      note: defaultModel
        ? `Agent 调用时会拼接: claude -p "<角色定义>\\n\\n<用户消息>" --verbose --model ${defaultModel} ...`
        : 'Agent 调用时会拼接: claude -p "<角色定义>\\n\\n<用户消息>" --verbose ...',
    })
  } else if (p.name === 'opencode') {
    const args = ['run', ...(defaultModel ? ['-m', defaultModel] : []), ...(p.thinking ? ['--thinking'] : []), '--dangerously-skip-permissions', '--format', 'json', '--', '<prompt>']
    res.json({
      provider: 'opencode',
      cli: cliPath,
      args,
      env: {
        ...(p.apiKey ? { ANTHROPIC_API_KEY: '(已设置)' } : {}),
        ...(p.baseUrl ? { ANTHROPIC_BASE_URL: p.baseUrl } : {}),
      },
      timeout: p.timeout,
      note: defaultModel
        ? `Agent 调用时: opencode run -m ${defaultModel}${p.thinking ? ' --thinking' : ''} --format json -- "<prompt>"`
        : `Agent 调用时: opencode run${p.thinking ? ' --thinking' : ''} --format json -- "<prompt>"`,
    })
  } else {
    res.json({ provider: p.name, cli: cliPath, note: '未知 Provider 类型' })
  }
})

// POST /api/providers/:name/test — run actual agent CLI command with test prompt
router.post('/:name/test', (req, res) => {
  const p = getProvider(req.params.name)
  if (!p) return res.status(404).json({ error: 'Provider not found' })

  const cliPath = p.cliPath.replace(/^~/, process.env.HOME || '/root')
  const timeout = Math.max((p.timeout ?? 1800) * 1000, 30000)
  const testPrompt = '说一个简单的词，比如"你好"'
  const defaultModel = p.defaultModel.trim()

  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  if (p.apiKey) env.ANTHROPIC_API_KEY = p.apiKey
  if (p.baseUrl) env.ANTHROPIC_BASE_URL = p.baseUrl

  let args: string[]
  let resultCli: string

  if (p.name === 'claude-code') {
    args = ['-p', testPrompt, '--verbose', '--output-format=stream-json', '--include-partial-messages']
    args.push('--dangerously-skip-permissions')
    if (defaultModel) args.push('--model', defaultModel)
    resultCli = `${cliPath} ${args.join(' ')}`
  } else if (p.name === 'opencode') {
    args = ['run']
    if (defaultModel) args.push('-m', defaultModel)
    if (p.thinking) args.push('--thinking')
    args.push('--dangerously-skip-permissions')
    args.push('--format', 'json', '--', testPrompt)
    resultCli = `${cliPath} ${args.join(' ')}`
  } else {
    return res.status(400).json({ error: 'Unknown provider type' })
  }

  const proc = spawn(cliPath, args, { timeout, env, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let outputLines: string[] = []
  let capturedOutput = ''

  // Normalize subprocess stdout to UTF-8 via TextDecoder auto-detection (handles UTF-16LE on Windows)
  const stdoutStream = toUtf8(proc.stdout!)

  stdoutStream.on('data', (d: Buffer) => {
    const text = d.toString()
    stdout += text
    if (p.name === 'opencode') {
      // opencode --format json outputs JSON per line; collect text from delta events
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'delta' && obj.text) {
            capturedOutput += obj.text
            outputLines.push(`[delta] ${obj.text}`)
          }
        } catch { /* skip */ }
      }
    } else {
      // claude stream-json format
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'content_block_delta' && obj.delta?.type === 'thinking_delta' && obj.delta.thinking) {
            outputLines.push(`[thinking] ${obj.delta.thinking}`)
          } else if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta' && obj.delta.text) {
            capturedOutput += obj.delta.text
            outputLines.push(`[text] ${obj.delta.text}`)
          } else if (obj.type === 'message_delta' && obj.usage) {
            outputLines.push(`[usage] input=${obj.usage.input_tokens} output=${obj.usage.output_tokens}`)
          }
        } catch { /* skip */ }
      }
    }
  })

  proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

  let responded = false
  function respond(data: Record<string, unknown>) {
    if (responded) return
    responded = true
    res.json(data)
  }

  proc.on('close', (code) => {
    const success = code === 0
    const result = {
      success,
      cli: resultCli,
      output: capturedOutput || (outputLines.length > 0 ? outputLines.join('\n') : (stdout.trim() || undefined)),
      rawOutput: stdout.slice(0, 500),
      error: success ? undefined : stderr.trim().slice(0, 300),
    }
    updateTestResult(req.params.name, { success, version: capturedOutput.slice(0, 50) || `exit ${code}` })
    respond(result)
  })

  proc.on('error', (err) => {
    const result = { success: false, cli: resultCli, output: undefined, rawOutput: undefined, error: err.message }
    updateTestResult(req.params.name, { success: false, error: err.message })
    respond(result)
  })
})

export default router
