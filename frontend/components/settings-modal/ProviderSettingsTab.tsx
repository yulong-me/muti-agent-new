'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Edit2, Loader2, Play, Save, X, XCircle } from 'lucide-react'

import { API_URL } from '@/lib/api'
import { debug, info, warn } from '@/lib/logger'

import {
  PROVIDER_DOTS,
  PROVIDER_SWATCHES,
  type ProviderConfig,
} from './types'

const API = API_URL

function ProviderDetail({
  provider,
  onUpdate,
}: {
  provider: ProviderConfig
  onUpdate?: (provider: ProviderConfig) => void
}) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(provider.lastTestResult)
  const [editing, setEditing] = useState(false)
  const [editCliPath, setEditCliPath] = useState(provider.cliPath)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setResult(provider.lastTestResult)
  }, [provider])

  useEffect(() => {
    setEditCliPath(provider.cliPath)
  }, [provider])

  function handleTest() {
    setTesting(true)
    info('ui:settings:provider_test', { provider: provider.name })
    fetch(`${API}/api/providers/${provider.name}/test`, { method: 'POST' })
      .then(response => response.json())
      .then((nextResult: ProviderConfig['lastTestResult']) => {
        debug('ui:settings:provider_test_result', {
          provider: provider.name,
          success: Boolean(nextResult?.success),
        })
        setResult(nextResult)
        setTesting(false)
      })
      .catch(error => {
        warn('ui:settings:provider_test_failed', { provider: provider.name, error })
        setResult({ success: false, error: error.message })
        setTesting(false)
      })
  }

  async function handleSave() {
    setSaveError('')
    setSaving(true)
    try {
      const response = await fetch(`${API}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: provider.name,
          label: provider.label,
          cliPath: editCliPath,
          defaultModel: provider.defaultModel,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          timeout: provider.timeout,
          thinking: provider.thinking,
        }),
      })
      const updated = await response.json() as ProviderConfig
      if (!response.ok) throw new Error(updated.lastTestResult?.error || '保存失败')
      onUpdate?.(updated)
      setResult(null)
      setEditing(false)
      info('ui:settings:provider_saved', { provider: provider.name })
    } catch (error) {
      warn('ui:settings:provider_save_failed', { provider: provider.name, error })
      setSaveError((error as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setEditing(false)
    setEditCliPath(provider.cliPath)
    setSaveError('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center text-[14px] font-bold ${PROVIDER_SWATCHES[provider.name as keyof typeof PROVIDER_SWATCHES]}`}
        >
          {provider.label.slice(0, 1)}
        </div>
        <div>
          <p className="text-[14px] font-bold text-ink">{provider.label}</p>
          <p className="text-[11px] text-ink-soft font-mono">{provider.name}</p>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[11px] font-bold text-ink-soft uppercase">CLI 路径</p>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] text-accent hover:text-accent transition-colors"
            >
              <Edit2 className="w-3 h-3" aria-hidden />
              {' '}
              编辑
            </button>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editCliPath}
              onChange={event => setEditCliPath(event.target.value)}
              placeholder="claude"
              className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            {saveError && <p className="tone-danger-text text-[11px]">{saveError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="flex-1 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-surface-muted rounded-xl transition-colors flex items-center justify-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" aria-hidden />
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || editCliPath === provider.cliPath}
                className="flex-1 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center justify-center gap-1"
              >
                <Save className="w-3.5 h-3.5" aria-hidden />
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-ink font-mono settings-input rounded-xl px-3 py-2">{provider.cliPath}</p>
        )}
      </div>
      <button
        type="button"
        onClick={handleTest}
        disabled={testing}
        className="w-full py-2.5 text-[13px] bg-ink text-bg rounded-xl hover:opacity-90 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-2"
      >
        {testing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            测试中…
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-current" aria-hidden />
            {result ? '重新测试' : '测试连接'}
          </>
        )}
      </button>
      {result && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface-muted">
          <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 font-mono text-[11px] text-ink-soft">
            {result.success ? (
              <CheckCircle2 className="tone-success-text w-3 h-3" />
            ) : (
              <X className="tone-danger-text w-3 h-3" />
            )}
            命令
          </div>
          {result.cli && (
            <div className="bg-surface-muted px-4 py-2.5 font-mono text-[12px] text-ink whitespace-pre-wrap break-all" aria-label="执行的命令">
              {result.cli}
            </div>
          )}
          {result.error && (
            <div className="tone-danger-text bg-surface-muted px-4 py-2.5 font-mono text-[12px] whitespace-pre-wrap break-all" aria-label="错误信息">
              {result.error}
            </div>
          )}
          {result.output && (
            <div className="max-h-48 overflow-y-auto border-t border-line bg-surface px-4 py-2.5 font-mono text-[12px] text-ink-soft whitespace-pre-wrap break-all" aria-label="命令输出">
              {result.output}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ProviderSettingsTab({
  providers,
  selectedProvider,
  onSelectProvider,
  onUpdateProvider,
}: {
  providers: Record<string, ProviderConfig>
  selectedProvider: string | null
  onSelectProvider: (providerName: string) => void
  onUpdateProvider: (provider: ProviderConfig) => void
}) {
  const currentProvider = selectedProvider ? providers[selectedProvider] : null

  return (
    <>
      <div className="flex flex-col gap-2">
        {Object.values(providers).map(provider => (
          <button
            type="button"
            key={provider.name}
            onClick={() => onSelectProvider(provider.name)}
            className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${selectedProvider === provider.name ? 'settings-surface border-2 border-accent shadow-sm' : 'settings-surface border-2 border-transparent hover:border-line'}`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${PROVIDER_DOTS[provider.name as keyof typeof PROVIDER_DOTS]}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-ink truncate">{provider.label}</p>
              <p className="text-[11px] text-ink-soft font-mono truncate">{provider.name}</p>
            </div>
            {provider.lastTestResult && (provider.lastTestResult.success ? (
              <CheckCircle2 className="tone-success-text w-4 h-4 flex-shrink-0" aria-hidden />
            ) : (
              <X className="tone-danger-text w-4 h-4 flex-shrink-0" aria-hidden />
            ))}
          </button>
        ))}
      </div>
      {currentProvider && (
        <div className="settings-surface rounded-xl p-5">
          <ProviderDetail provider={currentProvider} onUpdate={onUpdateProvider} />
        </div>
      )}
    </>
  )
}
