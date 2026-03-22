import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useMailStore = defineStore('mail', () => {
  // State
  const token = ref(localStorage.getItem('tm_token') || null)
  const email = ref(localStorage.getItem('tm_email') || null)
  const emailId = ref(localStorage.getItem('tm_emailId') || null)
  const expiresAt = ref(localStorage.getItem('tm_expiresAt') || null)
  const authMode = ref(localStorage.getItem('tm_authMode') || 'full')
  const resumeCode = ref(localStorage.getItem('tm_resumeCode') || null)
  const resumeUrl = ref(localStorage.getItem('tm_resumeUrl') || null)
  const domains = ref([])
  const mails = ref([])
  const currentMail = ref(null)
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
  }

  function clearSession() {
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
  }

  function setMails(data) {
    mails.value = data
  }

  function setCurrentMail(mail) {
    currentMail.value = mail
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
  }
})
