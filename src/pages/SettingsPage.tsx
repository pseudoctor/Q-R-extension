import { useCallback, useEffect, useState } from 'react'
import type { AiModelOption, AiSettings, AiSettingsView } from '../types'
import {
  AI_PROVIDERS,
  defaultAiSettings,
  isValidCustomEndpoint,
  providerById,
  providerEndpoint,
} from '../ai/providers'
import { requestAiHostPermission } from '../permissions'
import { errorMessage, sendExtensionMessage } from '../extension-messaging'
import { useI18n } from '../i18n/useI18n'

export function SettingsPage() {
  const { t, locale, localeOptions, setLocale } = useI18n()
  const [settings, setSettings] = useState<AiSettings>(defaultAiSettings())
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [modelOptions, setModelOptions] = useState<AiModelOption[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelSource, setModelSource] = useState<'provider' | 'fallback' | null>(null)
  const [modelStatus, setModelStatus] = useState('')
  const [status, setStatus] = useState('')
  const [testMode, setTestMode] = useState(false)
  const [testModeBusy, setTestModeBusy] = useState(false)

  const provider = providerById(settings.provider)

  const saveSettings = async () => {
    if (settings.provider === 'custom' && !isValidCustomEndpoint(settings.endpoint)) {
      setStatus(t('settings.invalidEndpoint'))
      return
    }
    setBusy(true)
    setStatus('')
    const savedSettings = { ...settings, apiKey: settings.apiKey.trim() }
    try {
      if ((savedSettings.apiKey || apiKeyConfigured) && !(await requestAiHostPermission(savedSettings))) {
        setStatus(t('settings.permissionDenied'))
        return
      }
      const response = await sendExtensionMessage<AiSettingsView>({
        type: 'save-ai-settings',
        settings: savedSettings,
        preserveApiKey: !savedSettings.apiKey && apiKeyConfigured,
      })
      setStatus(response.ok ? t('settings.saved') : errorMessage(response.error))
      if (response.ok) {
        setApiKeyConfigured(response.data.apiKeyConfigured)
        setSettings((current) => ({ ...current, apiKey: '' }))
        void refreshModels({ ...savedSettings, apiKey: '' })
      }
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    if (settings.provider === 'custom' && !isValidCustomEndpoint(settings.endpoint)) {
      setStatus(t('settings.invalidEndpoint'))
      return
    }
    setTesting(true)
    setStatus('')
    try {
      if ((settings.apiKey.trim() || apiKeyConfigured) && !(await requestAiHostPermission(settings))) {
        setStatus(t('settings.permissionDenied'))
        return
      }
      const response = await sendExtensionMessage<{ provider: string; model: string }>({
        type: 'test-ai-connection',
        settings,
      })
      if (!response.ok) {
        setStatus(errorMessage(response.error))
        return
      }
      await refreshModels({ ...settings, apiKey: '' })
      setStatus(t('settings.connected', { provider: response.data.provider, model: response.data.model }))
    } finally {
      setTesting(false)
    }
  }

  const clearApiKey = async () => {
    setBusy(true)
    setStatus('')
    try {
      const response = await sendExtensionMessage<AiSettingsView>({
        type: 'save-ai-settings',
        settings: { ...settings, apiKey: '' },
        clearApiKey: true,
      })
      if (!response.ok) {
        setStatus(errorMessage(response.error))
        return
      }
      setApiKeyConfigured(false)
      setSettings((current) => ({ ...current, apiKey: '' }))
      setModelOptions([])
      setModelSource(null)
      setModelStatus('')
      setStatus(t('settings.apiKeyCleared'))
    } finally {
      setBusy(false)
    }
  }

  const openShortcuts = async () => {
    const response = await sendExtensionMessage<{ tabId: number | undefined }>({ type: 'open-shortcuts' })
    if (!response.ok) setStatus(errorMessage(response.error))
  }

  const saveTestMode = async (enabled: boolean) => {
    setTestModeBusy(true)
    setStatus('')
    const response = await sendExtensionMessage<boolean>({ type: 'save-test-mode', enabled })
    setTestModeBusy(false)
    if (!response.ok) {
      setStatus(errorMessage(response.error))
      return
    }
    setTestMode(response.data)
    setStatus(t('settings.testModeSaved'))
  }

  const selectProvider = (providerId: AiSettings['provider']) => {
    const nextProvider = providerById(providerId)
    const nextSettings = { ...settings, provider: providerId, model: nextProvider.defaultModel }
    setSettings(nextSettings)
    setModelOptions([])
    setModelSource(null)
    setModelStatus('')
    setStatus('')
    if (nextSettings.apiKey.trim()) void refreshModels(nextSettings)
  }

  const refreshModels = useCallback(async (settingsOverride: AiSettings) => {
    setModelsLoading(true)
    setStatus('')
    setModelStatus('')
    const response = await sendExtensionMessage<{ models: AiModelOption[]; source: 'provider' | 'fallback'; warning?: string }>({
      type: 'list-ai-models',
      settings: settingsOverride,
    })
    setModelsLoading(false)
    if (!response.ok) {
      setModelStatus(errorMessage(response.error))
      return
    }
    setModelOptions(response.data.models)
    setModelSource(response.data.source)
    setModelStatus(response.data.warning ?? '')
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([
        sendExtensionMessage<AiSettingsView>({ type: 'get-ai-settings' }),
        sendExtensionMessage<boolean>({ type: 'get-test-mode' }),
      ]).then(([response, testModeResponse]) => {
        setLoaded(true)
        if (response.ok) {
          const loadedSettings: AiSettings = { ...response.data, apiKey: '' }
          setSettings(loadedSettings)
          setApiKeyConfigured(response.data.apiKeyConfigured)
          if (response.data.apiKeyConfigured) void refreshModels(loadedSettings)
        } else setStatus(errorMessage(response.error))
        if (testModeResponse.ok) setTestMode(testModeResponse.data)
        else setStatus(errorMessage(testModeResponse.error))
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshModels])

  return (
    <main className="app-shell settings-shell">
      <header className="settings-header">
        <div>
          <span className="eyebrow">{t('settings.eyebrow')}</span>
          <h1>{t('settings.heading')}</h1>
          <p>{t('settings.description')}</p>
        </div>
        <span className="local-pill">{t('common.localOnly')}</span>
      </header>
      {!loaded ? (
        <div className="loading-state">{t('settings.loading')}</div>
      ) : (
        <>
          <section className="settings-card">
          <label>
            {t('settings.language')}
            <select value={locale} onChange={(event) => void setLocale(event.target.value as typeof locale)}>
              {localeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <small>{t('settings.languageHint')}</small>
          </label>
          <div className="settings-shortcut-row">
            <div>
              <strong>{t('settings.shortcutsTitle')}</strong>
              <small>{t('settings.shortcutsHint')}</small>
            </div>
            <button className="secondary-button" type="button" onClick={() => void openShortcuts()}>
              {t('settings.openShortcuts')}
            </button>
          </div>
          <div className="settings-test-mode-row">
            <div>
              <strong>{t('settings.testMode')}</strong>
              <small>{t('settings.testModeHint')}</small>
            </div>
            <label className="settings-checkbox-control">
              <input type="checkbox" checked={testMode} onChange={(event) => void saveTestMode(event.target.checked)} disabled={testModeBusy} />
              <span>{testMode ? t('settings.testModeOn') : t('settings.testModeOff')}</span>
            </label>
          </div>
          <label>
            {t('settings.modelService')}
            <select value={settings.provider} onChange={(event) => selectProvider(event.target.value as AiSettings['provider'])}>
              {AI_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{t(`provider.${item.id}`)}</option>)}
            </select>
          </label>
          <label>
            {t('settings.apiEndpoint')}
            <input
              value={provider.id === 'custom' ? settings.endpoint : providerEndpoint(settings)}
              readOnly={provider.id !== 'custom'}
              onChange={provider.id === 'custom' ? (event) => setSettings((current) => ({ ...current, endpoint: event.target.value })) : undefined}
              placeholder={provider.id === 'custom' ? t('settings.customEndpointPlaceholder') : undefined}
              aria-describedby="endpoint-note"
            />
            <small id="endpoint-note">{provider.id === 'custom' ? t('settings.customEndpointNote') : t('settings.endpointNote')}</small>
          </label>
          <label>
            {t('settings.modelName')}
            <div className="model-input-stack">
              <select className="model-options-select" aria-label={t('settings.modelListAria')} value={modelOptions.some((model) => model.id === settings.model) ? settings.model : ''} onChange={(event) => { if (event.target.value) setSettings((current) => ({ ...current, model: event.target.value })) }}>
                <option value="">{modelOptions.length ? t('settings.selectLoaded', { count: modelOptions.length }) : t('settings.refreshHint')}</option>
                {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label === model.id ? model.id : `${model.label} · ${model.id}`}</option>)}
              </select>
              <div className="model-input-row">
              <input value={settings.model} onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))} placeholder={provider.defaultModel} aria-label={t('settings.manualModelAria')} />
              <button className="secondary-button compact-button" type="button" onClick={() => void refreshModels(settings)} disabled={modelsLoading || !settings.apiKey.trim()}>{modelsLoading ? t('settings.fetchingModels') : t('settings.refreshModels')}</button>
              </div>
            </div>
            <small>{modelSource === 'fallback' ? t('settings.fallbackHint') : modelOptions.length ? t('settings.loadedModels', { count: modelOptions.length }) : t('settings.modelHint')}</small>
            {modelStatus && <small className="model-status" role="status">{modelStatus}</small>}
          </label>
          <label>
            {t('settings.apiKey')}
            <input type="password" autoComplete="off" value={settings.apiKey} onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value }))} placeholder={t('settings.apiKeyPlaceholder')} />
            <small>{apiKeyConfigured ? t('settings.apiKeySaved') : t('settings.apiKeyNote')}</small>
          </label>
          <div className="settings-actions-row">
            <button className="secondary-button" type="button" onClick={() => void testConnection()} disabled={busy || testing || (!settings.apiKey.trim() && !apiKeyConfigured)}>
              {testing ? t('settings.testing') : t('settings.testConnection')}
            </button>
            <button className="secondary-button" type="button" onClick={() => void clearApiKey()} disabled={busy || testing || !apiKeyConfigured}>
              {t('settings.clearApiKey')}
            </button>
            <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={busy || testing}>
              {busy ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
          {status && <p className="status-message" role="status">{status}</p>}
          </section>
          <section className="donation-card" aria-labelledby="donation-title">
          <div>
            <span className="section-kicker">{t('settings.supportEyebrow')}</span>
            <h2 id="donation-title">{t('settings.supportHeading')}</h2>
            <p>{t('settings.supportCopy')}</p>
          </div>
          <div className="donation-grid">
            <figure>
              <img src="/assets/donate-alipay.jpg" alt={t('settings.alipayAlt')} />
              <figcaption>Alipay</figcaption>
            </figure>
            <figure>
              <img src="/assets/donate-paypal.jpg" alt={t('settings.paypalAlt')} />
              <figcaption>PayPal</figcaption>
            </figure>
          </div>
          </section>
        </>
      )}
    </main>
  )
}
