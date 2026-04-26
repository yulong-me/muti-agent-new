import { Router } from 'express'
import { spawn } from 'child_process'
import { Transform, type Readable } from 'stream'
import {
  getAllProviders,
  getProvider,
  upsertProvider,
  deleteProvider,
  updateTestResult,
} from '../config/providerConfig.js'
import { debug, error as logError, info, warn } from '../lib/logger.js'
import { buildClaudeProviderLaunch } from '../services/providers/claudeCode.js'
import { buildCodexProviderLaunch, parseCodexJsonEvents } from '../services/providers/codex.js'
import { buildOpenCodeProviderLaunch } from '../services/providers/opencode.js'
import { buildProvidersReadiness } from '../services/providerReadiness.js'

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
  const providers = getAllProviders()
  debug('provider:list', { count: Object.keys(providers).length })
  res.json(providers)
})

// GET /api/providers/readiness — lightweight CLI availability, no model call
router.get('/readiness', (_req, res) => {
  const readiness = buildProvidersReadiness(getAllProviders())
  debug('provider:readiness', {
    count: Object.keys(readiness).length,
    blockers: Object.values(readiness).filter(provider => provider.status === 'cli_missing').length,
  })
  res.json(readiness)
})

// GET /api/providers/:name
router.get('/:name', (req, res) => {
  const p = getProvider(req.params.name)
  if (!p) {
    warn('provider:get:not_found', { provider: req.params.name })
    return res.status(404).json({ error: 'Provider not found' })
  }
  debug('provider:get', { provider: p.name, cliPath: p.cliPath, timeout: p.timeout })
  res.json(p)
})

// POST /api/providers — create or update
router.post('/', (req, res) => {
  const { name, label, cliPath, defaultModel, contextWindow, apiKey, baseUrl, timeout, thinking } = req.body
  if (!name) {
    warn('provider:upsert:invalid', { reason: 'missing_name' })
    return res.status(400).json({ error: 'name is required' })
  }
  const config = upsertProvider(name, {
    label: label || name,
    cliPath: cliPath || 'claude',
    defaultModel: defaultModel || '',
    contextWindow: Math.max(Number(contextWindow) || 200000, 1),
    apiKey: apiKey || '',
    baseUrl: baseUrl || '',
    timeout: Number(timeout) || 90,
    thinking: thinking !== false,
  })
  info('provider:upsert', {
    provider: name,
    cliPath: config[name]?.cliPath,
    timeout: config[name]?.timeout,
    hasDefaultModel: Boolean(config[name]?.defaultModel),
    contextWindow: config[name]?.contextWindow,
    hasBaseUrl: Boolean(config[name]?.baseUrl),
    thinking: config[name]?.thinking,
  })
  res.json(config[name])
})

// DELETE /api/providers/:name
router.delete('/:name', (req, res) => {
  const name = req.params.name
  if (name === 'claude-code') {
    warn('provider:delete:forbidden', { provider: name })
    return res.status(400).json({ error: 'Cannot delete claude-code provider' })
  }
  deleteProvider(name)
  info('provider:delete', { provider: name })
  res.json({ ok: true })
})

// GET /api/providers/:name/preview — show the resolved command that will be executed
router.get('/:name/preview', (req, res) => {
  const p = getProvider(req.params.name)
  if (!p) {
    warn('provider:preview:not_found', { provider: req.params.name })
    return res.status(404).json({ error: 'Provider not found' })
  }

  const cliPath = p.cliPath.replace(/^~/, process.env.HOME || '/root')
  if (p.name === 'claude-code') {
    const launch = buildClaudeProviderLaunch('<prompt>', {}, p)
    debug('provider:preview', {
      provider: p.name,
      cliPath,
      timeout: p.timeout,
      hasDefaultModel: Boolean(p.defaultModel.trim()),
    })
    res.json({
      provider: 'claude-code',
      cli: cliPath,
      args: launch.args,
      env: {
        ...(p.apiKey ? { ANTHROPIC_API_KEY: p.apiKey ? '(已设置)' : '(未设置)' } : {}),
        ...(p.baseUrl ? { ANTHROPIC_BASE_URL: p.baseUrl } : {}),
      },
      timeout: p.timeout,
      note: p.defaultModel.trim()
        ? `Agent 调用时会拼接: claude -p "<角色定义>\\n\\n<用户消息>" --verbose --dangerously-skip-permissions --model ${p.defaultModel.trim()} ...`
        : 'Agent 调用时会拼接: claude -p "<角色定义>\\n\\n<用户消息>" --verbose --dangerously-skip-permissions ...',
    })
  } else if (p.name === 'opencode') {
    const launch = buildOpenCodeProviderLaunch('<prompt>', {}, p)
    debug('provider:preview', {
      provider: p.name,
      cliPath,
      timeout: p.timeout,
      hasDefaultModel: Boolean(p.defaultModel.trim()),
      thinking: p.thinking,
    })
    res.json({
      provider: 'opencode',
      cli: cliPath,
      args: launch.args,
      env: {
        ...(p.apiKey ? { ANTHROPIC_API_KEY: '(已设置)' } : {}),
        ...(p.baseUrl ? { ANTHROPIC_BASE_URL: p.baseUrl } : {}),
      },
      timeout: p.timeout,
      note: `Agent 调用时: ${cliPath} ${launch.args.join(' ')}`,
    })
  } else if (p.name === 'codex') {
    const launch = buildCodexProviderLaunch('<prompt>', {}, p)
    debug('provider:preview', {
      provider: p.name,
      cliPath,
      timeout: p.timeout,
      hasDefaultModel: Boolean(p.defaultModel.trim()),
      thinking: p.thinking,
    })
    res.json({
      provider: 'codex',
      cli: cliPath,
      args: launch.args,
      env: {
        ...(p.apiKey ? { OPENAI_API_KEY: '(已设置)' } : {}),
        ...(p.baseUrl ? { OPENAI_BASE_URL: p.baseUrl } : {}),
      },
      timeout: p.timeout,
      note: `Agent 调用时: ${cliPath} ${launch.args.join(' ')}`,
    })
  } else {
    warn('provider:preview:unknown', { provider: p.name })
    res.json({ provider: p.name, cli: cliPath, note: '未知 Provider 类型' })
  }
})

// POST /api/providers/:name/test — run actual agent CLI command with test prompt
router.post('/:name/test', (req, res) => {
  const p = getProvider(req.params.name)
  if (!p) {
    warn('provider:test:not_found', { provider: req.params.name })
    return res.status(404).json({ error: 'Provider not found' })
  }

  const cliPath = p.cliPath.replace(/^~/, process.env.HOME || '/root')
  const testPrompt = '说一个简单的词，比如"你好"'

  let args: string[]
  let resultCli: string
  let env: Record<string, string>
  let timeout: number
  let cwd: string

  if (p.name === 'claude-code') {
    const launch = buildClaudeProviderLaunch(testPrompt, {}, p)
    args = launch.args
    env = launch.env
    timeout = Math.max(launch.timeout, 30000)
    cwd = launch.cwd
    resultCli = `${cliPath} ${args.join(' ')}`
  } else if (p.name === 'opencode') {
    const launch = buildOpenCodeProviderLaunch(testPrompt, {}, p)
    args = launch.args
    env = launch.env
    timeout = Math.max(launch.timeout, 30000)
    cwd = launch.cwd
    resultCli = `${cliPath} ${args.join(' ')}`
  } else if (p.name === 'codex') {
    const launch = buildCodexProviderLaunch(testPrompt, {}, p)
    args = launch.args
    env = launch.env
    timeout = Math.max(launch.timeout, 30000)
    cwd = launch.cwd
    resultCli = `${cliPath} ${args.join(' ')}`
  } else {
    warn('provider:test:unknown', { provider: p.name })
    return res.status(400).json({ error: 'Unknown provider type' })
  }

  info('provider:test:start', {
    provider: p.name,
    cliPath,
    timeout_ms: timeout,
    hasDefaultModel: Boolean(p.defaultModel.trim()),
    thinking: p.name === 'opencode' || p.name === 'codex' ? p.thinking : undefined,
  })

  const proc = spawn(cliPath, args, { timeout, env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let outputLines: string[] = []
  let capturedOutput = ''
  const codexParseState = { startTime: Date.now(), now: () => Date.now() }

  // Normalize subprocess stdout to UTF-8 via TextDecoder auto-detection (handles UTF-16LE on Windows)
  const stdoutStream = toUtf8(proc.stdout!)

  stdoutStream.on('data', (d: Buffer) => {
    const text = d.toString()
    stdout += text
    if (p.name === 'opencode') {
      // opencode --format json outputs JSON per line; collect text from text/delta events
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          const part = obj.part && typeof obj.part === 'object' ? obj.part as Record<string, unknown> : undefined
          const textPart = typeof obj.text === 'string'
            ? obj.text
            : typeof part?.text === 'string'
            ? part.text
            : undefined
          if ((obj.type === 'delta' || obj.type === 'text') && textPart) {
            capturedOutput += textPart
            outputLines.push(`[text] ${textPart}`)
          }
        } catch { /* skip */ }
      }
    } else if (p.name === 'codex') {
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          for (const event of parseCodexJsonEvents(obj, 'provider-test', codexParseState)) {
            if (event.type === 'delta') {
              capturedOutput += event.text
              outputLines.push(`[text] ${event.text}`)
            } else if (event.type === 'thinking_delta') {
              outputLines.push(`[thinking] ${event.thinking}`)
            } else if (event.type === 'tool_use') {
              outputLines.push(`[tool] ${event.toolName}`)
            } else if (event.type === 'error') {
              outputLines.push(`[error] ${event.message}`)
            }
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
    if (success) {
      info('provider:test:finish', {
        provider: req.params.name,
        success,
        code,
        outputLength: capturedOutput.length,
      })
    } else {
      warn('provider:test:finish', {
        provider: req.params.name,
        success,
        code,
        stderr,
      })
    }
    respond(result)
  })

  proc.on('error', (err) => {
    const result = { success: false, cli: resultCli, output: undefined, rawOutput: undefined, error: err.message }
    updateTestResult(req.params.name, { success: false, error: err.message })
    logError('provider:test:error', {
      provider: req.params.name,
      cli: resultCli,
      error: err,
    })
    respond(result)
  })
})

export default router
