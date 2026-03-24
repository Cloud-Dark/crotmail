import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useMailStore = defineStore('mail', () => {
  function getMailCacheKey(address = email.value) {
    return address ? `tm_mails_${address}` : null
  }

  function getCurrentMailCacheKey(address = email.value) {
    return address ? `tm_currentMail_${address}` : null
  }

  function loadCachedMails(address = email.value) {
    const key = getMailCacheKey(address)
    if (!key) return []

    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }

  function loadCachedCurrentMail(address = email.value) {
    const key = getCurrentMailCacheKey(address)
    if (!key) return null

    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  function persistMails(address = email.value) {
    const key = getMailCacheKey(address)
    if (!key) return
    localStorage.setItem(key, JSON.stringify(mails.value))
  }

  function persistCurrentMail(address = email.value) {
    const key = getCurrentMailCacheKey(address)
    if (!key) return
    if (currentMail.value) {
      localStorage.setItem(key, JSON.stringify(currentMail.value))
    } else {
      localStorage.removeItem(key)
    }
  }

  // State
  const token = ref(localStorage.getItem('tm_token') || null)
  const email = ref(localStorage.getItem('tm_email') || null)
  const emailId = ref(localStorage.getItem('tm_emailId') || null)
  const expiresAt = ref(localStorage.getItem('tm_expiresAt') || null)
  const authMode = ref(localStorage.getItem('tm_authMode') || 'full')
  const resumeCode = ref(localStorage.getItem('tm_resumeCode') || null)
  const resumeUrl = ref(localStorage.getItem('tm_resumeUrl') || null)
  const domains = ref([])
  const mails = ref(loadCachedMails())
  const currentMail = ref(loadCachedCurrentMail())
  const loading = ref(false)

  // Computed properties
  const isAuthenticated = computed(() => !!token.value && !!email.value)
  
  const remainingTime = computed(() => {
    if (!expiresAt.value) return 0
    const diff = new Date(expiresAt.value) - new Date()
    return Math.max(0, diff)
  })

  const isExpired = computed(() => remainingTime.value <= 0)
  const isLimitedSession = computed(() => authMode.value === 'limited')

  const unreadCount = computed(() => mails.value.filter(m => !m.seen).length)

  // Methods
  function setSession(data) {
    const previousEmail = email.value
    token.value = data.token
    email.value = data.address
    emailId.value = data.id
    expiresAt.value = data.expiresAt
    authMode.value = data.mode || 'full'
    resumeCode.value = data.resumeCode || resumeCode.value
    resumeUrl.value = data.resumeUrl || resumeUrl.value
    
    localStorage.setItem('tm_token', data.token)
    localStorage.setItem('tm_email', data.address)
    localStorage.setItem('tm_emailId', data.id)
    localStorage.setItem('tm_expiresAt', data.expiresAt)
    localStorage.setItem('tm_authMode', authMode.value)
    if (resumeCode.value) localStorage.setItem('tm_resumeCode', resumeCode.value)
    if (resumeUrl.value) localStorage.setItem('tm_resumeUrl', resumeUrl.value)

    if (previousEmail !== data.address) {
      mails.value = loadCachedMails(data.address)
      currentMail.value = loadCachedCurrentMail(data.address)
    }
  }

  function clearSession({ clearCache = false } = {}) {
    const activeEmail = email.value
    token.value = null
    email.value = null
    emailId.value = null
    expiresAt.value = null
    authMode.value = 'full'
    resumeCode.value = null
    resumeUrl.value = null
    mails.value = []
    currentMail.value = null
    
    localStorage.removeItem('tm_token')
    localStorage.removeItem('tm_email')
    localStorage.removeItem('tm_emailId')
    localStorage.removeItem('tm_expiresAt')
    localStorage.removeItem('tm_authMode')
    localStorage.removeItem('tm_resumeCode')
    localStorage.removeItem('tm_resumeUrl')

    if (clearCache && activeEmail) {
      localStorage.removeItem(getMailCacheKey(activeEmail))
      localStorage.removeItem(getCurrentMailCacheKey(activeEmail))
    }
  }

  function setMails(data) {
    mails.value = data
    persistMails()
  }

  function setCurrentMail(mail) {
    currentMail.value = mail
    persistCurrentMail()
  }

  function setDomains(data) {
    domains.value = data
  }

  function setLoading(value) {
    loading.value = value
  }

  function extendExpiry(minutes = 30) {
    const newExpiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString()
    expiresAt.value = newExpiresAt
    localStorage.setItem('tm_expiresAt', newExpiresAt)
  }

  return {
    // State
    token,
    email,
    emailId,
    expiresAt,
    authMode,
    resumeCode,
    resumeUrl,
    domains,
    mails,
    currentMail,
    loading,
    
    // Computed properties
    isAuthenticated,
    remainingTime,
    isExpired,
    isLimitedSession,
    unreadCount,
    
    // Methods
    setSession,
    clearSession,
    setMails,
    setCurrentMail,
    setDomains,
    setLoading,
    extendExpiry,
    loadCachedMails,
    loadCachedCurrentMail,
  }
})
