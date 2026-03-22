const API_BASE = '/api'

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function getAccessKey() {
  return sessionStorage.getItem('accessKey')
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`
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
  
  // Handle 204 No Content
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
  // Domains
  async getDomains() {
    const data = await request('/domains')
    return data['hydra:member'] || []
  },

  // Accounts
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

  // Messages
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

  // Attachments
  getAttachmentUrl(id) {
    return `${API_BASE}/attachments/${id}`
  },
}

export { ApiError }
