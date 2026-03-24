import { api } from './api'

const STORAGE_KEY = 'tm_storage_settings'

const defaultSettings = {
  provider: 'localstorage',
  baseUrl: '',
  apiKey: '',
}

export function getStorageSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveStorageSettings(settings) {
  const normalized = {
    provider: settings.provider || 'localstorage',
    baseUrl: (settings.baseUrl || '').trim(),
    apiKey: (settings.apiKey || '').trim(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

function localKeys(address) {
  return {
    mails: `tm_mails_${address}`,
    current: `tm_currentMail_${address}`,
  }
}

function loadLocal(address) {
  const keys = localKeys(address)
  let mails = []
  let currentMail = null
  try {
    mails = JSON.parse(localStorage.getItem(keys.mails) || '[]')
  } catch {
    mails = []
  }
  try {
    currentMail = JSON.parse(localStorage.getItem(keys.current) || 'null')
  } catch {
    currentMail = null
  }
  return { messages: mails, currentMail, provider: 'localstorage' }
}

function saveLocal(address, payload) {
  const keys = localKeys(address)
  localStorage.setItem(keys.mails, JSON.stringify(payload.messages || []))
  if (payload.currentMail) {
    localStorage.setItem(keys.current, JSON.stringify(payload.currentMail))
  } else {
    localStorage.removeItem(keys.current)
  }
  return { success: true, provider: 'localstorage' }
}

async function loadSupabase(address, settings) {
  if (!settings.baseUrl || !settings.apiKey) {
    throw new Error('Base URL dan API key Supabase wajib diisi')
  }

  const endpoint = `${settings.baseUrl.replace(/\/$/, '')}/rest/v1/crotmail_cache?address=eq.${encodeURIComponent(address)}&select=messages,current_mail,updated_at&limit=1`
  const response = await fetch(endpoint, {
    headers: {
      apikey: settings.apiKey,
      Authorization: `Bearer ${settings.apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error('Gagal load data Supabase')
  }

  const rows = await response.json()
  const row = rows?.[0]
  return {
    provider: 'supabase',
    messages: row?.messages || [],
    currentMail: row?.current_mail || null,
    updatedAt: row?.updated_at || null,
  }
}

async function saveSupabase(address, payload, settings) {
  if (!settings.baseUrl || !settings.apiKey) {
    throw new Error('Base URL dan API key Supabase wajib diisi')
  }

  const endpoint = `${settings.baseUrl.replace(/\/$/, '')}/rest/v1/crotmail_cache`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: settings.apiKey,
      Authorization: `Bearer ${settings.apiKey}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([
      {
        address,
        messages: payload.messages || [],
        current_mail: payload.currentMail || null,
        updated_at: new Date().toISOString(),
      },
    ]),
  })

  if (!response.ok) {
    throw new Error('Gagal simpan data Supabase')
  }
  return { success: true, provider: 'supabase' }
}

export async function loadFromSelectedStorage(address, token) {
  const settings = getStorageSettings()

  if (settings.provider === 'localstorage') {
    return loadLocal(address)
  }

  if (settings.provider === 'supabase') {
    return loadSupabase(address, settings)
  }

  if (settings.provider === 'd1') {
    const result = await api.d1LoadCache(token)
    return {
      provider: 'd1',
      messages: result.messages || [],
      currentMail: result.currentMail || null,
      updatedAt: result.updatedAt || null,
    }
  }

  return loadLocal(address)
}

export async function migrateToSelectedStorage(address, token, payload) {
  const settings = getStorageSettings()

  if (settings.provider === 'localstorage') {
    return saveLocal(address, payload)
  }

  if (settings.provider === 'supabase') {
    return saveSupabase(address, payload, settings)
  }

  if (settings.provider === 'd1') {
    return api.d1MigrateCache(token, payload)
  }

  return saveLocal(address, payload)
}
