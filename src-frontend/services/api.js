class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function getApiBase() {
  return localStorage.getItem('tm_api_base') || '/api'
}

function getAccessKey() {
  return localStorage.getItem('tm_access_key') || sessionStorage.getItem('accessKey')
}

function joinUrl(base, path) {
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${cleanBase}${cleanPath}`
}

function resolveApiUrl(path) {
  const base = getApiBase()
  const raw = joinUrl(base, path)
  return new URL(raw, window.location.origin).toString()
}

async function request(path, options = {}) {
  const url = resolveApiUrl(path)
  const accessKey = getAccessKey()
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  }

  if (accessKey) {
    config.headers['X-Access-Key'] = accessKey
  }

  const response = await fetch(url, config)

  if (response.status === 204) {
    return null
  }

  const data = await response.json()

  if (!response.ok) {
    throw new ApiError(data.message || 'Request failed', response.status)
  }

  return data
}

export const api = {
  getApiBase,
  resolveApiUrl,

  async getDomains() {
    const data = await request('/domains')
    return data['hydra:member'] || []
  },

  async createAccount(address, password) {
    return request('/accounts', {
      method: 'POST',
      body: JSON.stringify({ address, password }),
    })
  },

  async generateRandomEmail(domain = null) {
    const body = domain ? { domain } : {}
    return request('/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  async createCustomEmail(address) {
    return request('/custom', {
      method: 'POST',
      body: JSON.stringify({ address }),
    })
  },

  async getToken(address, password) {
    return request('/token', {
      method: 'POST',
      body: JSON.stringify({ address, password }),
    })
  },

  async resumeByCode(code) {
    return request('/resume', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  },

  async getMe(token) {
    return request('/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async deleteAccount(id, token) {
    return request(`/accounts/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async adminDeleteAccountByAddress(address) {
    return request('/admin/delete-account', {
      method: 'POST',
      body: JSON.stringify({ address }),
    })
  },

  async extendExpiry(token, minutes = 30) {
    return request('/me/extend', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ minutes }),
    })
  },

  async getMessages(token, page = 1) {
    const data = await request(`/messages?page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return {
      mails: data['hydra:member'] || [],
      total: data['hydra:totalItems'] || 0,
    }
  },

  async getMessage(id, token) {
    return request(`/messages/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async markAsRead(id, token) {
    return request(`/messages/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async deleteMessage(id, token) {
    return request(`/messages/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async getSource(id, token) {
    return request(`/sources/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  getAttachmentUrl(id) {
    return resolveApiUrl(`/attachments/${id}`)
  },

  getStreamUrl(token) {
    const base = getApiBase()
    const streamBase = base.endsWith('/api') ? base.slice(0, -4) : base
    const url = new URL(joinUrl(streamBase, '/stream_ready_use'), window.location.origin)
    url.searchParams.set('token', token)
    return url.toString()
  },

  async getRuntimeConfig(token) {
    return request('/runtime-config', {
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async updateRuntimeConfig(token, payload) {
    return request('/runtime-config', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
  },

  async d1LoadCache(token) {
    return request('/storage/d1/load', {
      headers: { Authorization: `Bearer ${token}` },
    })
  },

  async d1MigrateCache(token, payload) {
    return request('/storage/d1/migrate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
  },
}

export { ApiError }
