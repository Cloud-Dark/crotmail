<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useMailStore } from '@/stores/mail'
import { useToastStore } from '@/stores/toast'
import { api } from '@/services/api'
import {
  Mail, RefreshCw, Copy, Trash2, Plus, LogOut,
  Timer, Inbox, Paperclip, Download, ChevronRight, Link2,
  Sparkles, Shield, Zap
} from 'lucide-vue-next'

const router = useRouter()
const mailStore = useMailStore()
const toast = useToastStore()

// State
const timerInterval = ref(null)
const refreshInterval = ref(null)
const showMail = ref(null)
const selectedDomain = ref('')
const customUsername = ref('')
const timerTick = ref(0)
const showDomainDropdown = ref(false)
const mailIframe = ref(null)

// Computed properties
const formattedTime = computed(() => {
  timerTick.value
  if (!mailStore.expiresAt) return '30d 00:00:00'
  const now = Date.now()
  const expires = new Date(mailStore.expiresAt).getTime()
  const diff = Math.max(0, expires - now)
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  const secs = Math.floor((diff % 60000) / 1000)
  return `${days}d ${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
})

// Watch email changes and sync username/domain inputs
watch(() => mailStore.email, (email) => {
  if (email) {
    const [username, domain] = email.split('@')
    customUsername.value = username
    selectedDomain.value = domain
  }
}, { immediate: true })

// Watch selected mail changes and render iframe HTML
watch(showMail, async (mail) => {
  if (mail?.html?.length > 0) {
    await nextTick()
    const iframe = mailIframe.value
    if (!iframe) return
    
    // Inject HTML into iframe
    const doc = iframe.contentDocument || iframe.contentWindow.document
    doc.open()
    doc.write(`<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 16px; color: #333; }
            a { color: #8b5cf6; }
            img { max-width: 100%; }
          </style>
        </head>
        <body>${mail.html[0]}</body>
      </html>`)
    doc.close()
    // Auto-adjust iframe height
    iframe.onload = () => {
      try {
        const height = doc.body.scrollHeight
        iframe.style.height = Math.min(height + 32, 500) + 'px'
      } catch (e) {}
    }
  }
})

// Initialization
onMounted(async () => {
  if (!mailStore.isLimitedSession) {
    await loadDomains()
  }
  
  // Close dropdown when clicking outside
  document.addEventListener('click', handleClickOutside)
  
  if (mailStore.isAuthenticated && !mailStore.isExpired) {
    startTimer()
    startAutoRefresh()
    await refreshMails()
  }
})

onUnmounted(() => {
  stopTimer()
  stopAutoRefresh()
  document.removeEventListener('click', handleClickOutside)
})

function handleClickOutside(e) {
  const dropdown = document.querySelector('.domain-dropdown')
  if (dropdown && !dropdown.contains(e.target)) {
    showDomainDropdown.value = false
  }
}

// Methods
async function loadDomains() {
  try {
    const domains = await api.getDomains()
    mailStore.setDomains(domains)
    if (domains.length > 0 && !selectedDomain.value) {
      selectedDomain.value = domains[0].domain
    }
  } catch (e) {
    console.error('Failed to load domains:', e)
  }
}

async function createNewEmail() {
  if (mailStore.isLimitedSession) {
    toast.error('Mode akses terbatas: hanya lihat dan hapus pesan')
    return
  }

  if (mailStore.domains.length === 0) {
    toast.error('Belum ada domain yang tersedia')
    return
  }
  
  try {
    mailStore.setLoading(true)
    
    // If an existing inbox exists, delete it first
    if (mailStore.emailId && mailStore.token) {
      try {
        await api.deleteAccount(mailStore.emailId, mailStore.token)
      } catch (e) {
        // Ignore delete failure
      }
    }
    
    // Clear message list and details
    mailStore.setMails([])
    showMail.value = null
    
    // Check whether username input was modified
    const currentUsername = mailStore.email ? mailStore.email.split('@')[0] : ''
    const isModified = customUsername.value.trim() && customUsername.value.trim() !== currentUsername
    
    // Pick creation method based on input change
    let data
    if (isModified) {
      // Input modified -> create custom mailbox
      const address = `${customUsername.value.trim()}@${selectedDomain.value}`
      data = await api.createCustomEmail(address)
    } else {
      // Input unchanged or empty -> create random mailbox
      data = await api.generateRandomEmail(selectedDomain.value || null)
      // Update username/domain inputs
      const [username, domain] = data.address.split('@')
      customUsername.value = username
      selectedDomain.value = domain
    }
    
    mailStore.setSession(data)
    startTimer()
    startAutoRefresh()
    toast.success('Inbox berhasil dibuat')
  } catch (e) {
    toast.error(e.message || 'Gagal membuat inbox, coba lagi')
  } finally {
    mailStore.setLoading(false)
  }
}

async function refreshMails() {
  if (!mailStore.token) return
  try {
    const { mails } = await api.getMessages(mailStore.token)
    mailStore.setMails(mails)
  } catch (e) {
    console.error('Failed to load mails:', e)
  }
}

async function openMail(mail) {
  try {
    const fullMail = await api.getMessage(mail.id, mailStore.token)
    showMail.value = fullMail
    
    if (!mailStore.isLimitedSession && !mail.seen) {
      await api.markAsRead(mail.id, mailStore.token)
      await refreshMails()
    }
  } catch (e) {
    toast.error('Gagal memuat email')
  }
}

async function deleteMail() {
  if (!showMail.value) return
  
  try {
    await api.deleteMessage(showMail.value.id, mailStore.token)
    showMail.value = null
    await refreshMails()
    toast.success('Email berhasil dihapus')
  } catch (e) {
    toast.error('Gagal menghapus email')
  }
}

async function deleteAccount() {
  if (mailStore.isLimitedSession) {
    toast.error('Mode akses terbatas tidak bisa hapus inbox')
    return
  }

  const typedUsername = (customUsername.value || '').trim().toLowerCase()
  const typedDomain = (selectedDomain.value || '').trim().toLowerCase()
  const typedAddress = typedUsername && typedDomain ? `${typedUsername}@${typedDomain}` : ''
  const currentAddress = (mailStore.email || '').toLowerCase()
  const canUseCurrentSessionDelete = Boolean(mailStore.emailId && mailStore.token && typedAddress === currentAddress)
  const canUseAdminDelete = Boolean(typedAddress)

  if (!canUseCurrentSessionDelete && !canUseAdminDelete) {
    toast.error('Masukkan username dan pilih domain dulu')
    return
  }

  const targetAddress = typedAddress || currentAddress
  if (!confirm(`Yakin ingin menghapus inbox ${targetAddress}?`)) return
  
  try {
    if (canUseCurrentSessionDelete) {
      try {
        await api.deleteAccount(mailStore.emailId, mailStore.token)
      } catch (e) {
        // Fallback to admin delete if mailbox token is already invalid.
        await api.adminDeleteAccountByAddress(targetAddress)
      }
    } else {
      await api.adminDeleteAccountByAddress(targetAddress)
    }

    if (currentAddress && targetAddress === currentAddress) {
      mailStore.clearSession()
      mailStore.setMails([])
      customUsername.value = ''
      stopTimer()
      stopAutoRefresh()
      showMail.value = null
    }

    toast.success(`Inbox ${targetAddress} berhasil dihapus`)
  } catch (e) {
    if (e?.status === 404) {
      toast.error('Inbox tidak ditemukan')
      return
    }
    if (e?.status === 401) {
      toast.error('Access key tidak valid untuk admin delete')
      return
    }
    toast.error(e.message || 'Gagal menghapus inbox')
  }
}

async function extendTime() {
  if (mailStore.isLimitedSession) {
    toast.error('Mode akses terbatas tidak bisa perpanjang waktu')
    return
  }

  if (!mailStore.token) return
  try {
    const data = await api.extendExpiry(mailStore.token, 30)
    mailStore.expiresAt = data.expiresAt
    localStorage.setItem('tm_expiresAt', data.expiresAt)
    toast.success('Berhasil diperpanjang 30 menit')
  } catch (e) {
    toast.error('Gagal memperpanjang waktu')
  }
}

async function copyEmail() {
  if (!customUsername.value || !selectedDomain.value) return
  const email = `${customUsername.value}@${selectedDomain.value}`
  
  try {
    await navigator.clipboard.writeText(email)
    toast.success('Berhasil disalin ke clipboard')
  } catch (e) {
    toast.error('Gagal menyalin')
  }
}

async function copyResumeLink() {
  if (!mailStore.resumeCode) {
    toast.error('Resume link tidak tersedia untuk sesi ini')
    return
  }

  const url = mailStore.resumeUrl || `${window.location.origin}/r/${mailStore.resumeCode}`
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Resume link berhasil disalin')
  } catch {
    toast.error('Gagal menyalin resume link')
  }
}

function logout() {
  mailStore.clearSession()
  mailStore.setMails([])
  customUsername.value = ''
  stopTimer()
  stopAutoRefresh()
  sessionStorage.removeItem('auth')
  router.push('/login')
}

function startTimer() {
  stopTimer()
  timerInterval.value = setInterval(() => {
    timerTick.value++
    
    if (mailStore.isExpired) {
      stopTimer()
      stopAutoRefresh()
      toast.error('Inbox sudah kedaluwarsa')
    }
  }, 1000)
}

function stopTimer() {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
  }
}

function startAutoRefresh() {
  stopAutoRefresh()
  refreshInterval.value = setInterval(refreshMails, 10000)
}

function stopAutoRefresh() {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
    refreshInterval.value = null
  }
}

function formatTime(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now - date
  
  if (diff < 60000) return 'baru saja'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} menit lalu`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} jam lalu`
  return date.toLocaleDateString()
}

function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('id-ID')
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getInitial(name) {
  return (name || '?')[0].toUpperCase()
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Top bar -->
    <header class="sticky top-0 z-40 border-b border-white/5 bg-dark-950/90 backdrop-blur-xl">
      <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <!-- Logo -->
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
            <Mail class="w-4 h-4 text-white" />
          </div>
          <span class="font-bold text-gradient">CrotMail</span>
        </div>
        
        <!-- Remaining time -->
        <div v-if="mailStore.email" class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <Timer class="w-4 h-4 text-amber-500" />
          <span class="text-sm font-mono font-medium text-amber-500">{{ formattedTime }}</span>
        </div>
        
        <!-- Actions -->
        <div class="flex items-center gap-2">
          <button v-if="mailStore.email && !mailStore.isLimitedSession" @click="extendTime" class="btn-ghost btn-sm">
            <Sparkles class="w-4 h-4" />
            <span class="hidden sm:inline">Perpanjang</span>
          </button>
          <button @click="logout" class="btn-ghost btn-icon btn-sm">
            <LogOut class="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
    
    <!-- Main content -->
    <main class="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
      <!-- Mailbox address card -->
      <div class="card p-6 mb-6 relative z-10">
        <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
          <!-- Left side: username input + domain selector -->
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
              <Shield class="w-6 h-6 text-white" />
            </div>
            <div class="flex items-center gap-2">
              <input
                v-model="customUsername"
                type="text"
                class="input text-sm font-mono"
                style="width: 140px;"
                placeholder="Nama inbox"
                maxlength="30"
              />
              <span class="text-dark-400 font-medium">@</span>
              <!-- Custom domain dropdown -->
              <div class="relative domain-dropdown">
                <button
                  @click="showDomainDropdown = !showDomainDropdown"
                  class="input text-sm flex items-center justify-between gap-2 cursor-pointer"
                  style="min-width: 140px;"
                >
                  <span class="truncate">{{ selectedDomain || 'Pilih domain' }}</span>
                  <ChevronRight class="w-4 h-4 text-dark-400 transition-transform" :class="showDomainDropdown ? 'rotate-90' : ''" />
                </button>
                <!-- Dropdown list -->
                <Transition name="dropdown">
                  <div
                    v-if="showDomainDropdown"
                    class="absolute top-full left-0 right-0 mt-1 bg-dark-800 border border-white/10 rounded-xl overflow-hidden shadow-xl z-50"
                  >
                    <button
                      v-for="d in mailStore.domains"
                      :key="d.id"
                      @click="selectedDomain = d.domain; showDomainDropdown = false"
                      class="w-full px-4 py-2.5 text-sm text-left hover:bg-white/5 transition-colors"
                      :class="d.domain === selectedDomain ? 'text-primary-400 bg-primary-500/10' : 'text-dark-200'"
                    >
                      {{ d.domain }}
                    </button>
                  </div>
                </Transition>
              </div>
              <button @click="copyEmail" class="btn-ghost btn-icon btn-sm">
                <Copy class="w-4 h-4" />
              </button>
              <button @click="copyResumeLink" class="btn-ghost btn-icon btn-sm" title="Salin resume link">
                <Link2 class="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <!-- Right-side actions -->
          <div class="flex items-center gap-2" v-if="!mailStore.isLimitedSession">
            <button @click="createNewEmail" class="btn-primary btn-sm">
              <Plus class="w-4 h-4" />
              <span>Buat inbox</span>
            </button>
            <button @click="deleteAccount" class="btn-danger btn-sm">
              <Trash2 class="w-4 h-4" />
              <span>Hapus inbox</span>
            </button>
          </div>
        </div>
        
        <!-- Stats bar -->
        <div class="flex items-center justify-between mt-4 pt-4 border-t border-white/5 text-sm text-dark-400">
          <div class="flex items-center gap-6">
            <div class="flex items-center gap-1.5">
              <Inbox class="w-4 h-4" />
              <span>{{ mailStore.mails.length }} email</span>
            </div>
            <div class="flex items-center gap-1.5">
              <Mail class="w-4 h-4" />
              <span>{{ mailStore.mails.filter(m => !m.seen).length }} belum dibaca</span>
            </div>
            <div v-if="refreshInterval" class="flex items-center gap-1.5">
              <Zap class="w-4 h-4 text-emerald-400" />
              <span class="text-emerald-400">Menyegarkan otomatis</span>
            </div>
          </div>
          <button @click="refreshMails" class="btn-ghost btn-sm">
            <RefreshCw class="w-4 h-4" />
            <span>Segarkan</span>
          </button>
        </div>
      </div>
      
      <!-- Mail area - fills remaining space -->
      <div class="card flex-1 flex flex-col">
        <!-- Message list view -->
        <div v-if="!showMail">
          <div class="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <h2 class="font-semibold flex items-center gap-2">
              <Inbox class="w-4 h-4 text-dark-400" />
              Kotak Masuk
            </h2>
            <span class="text-xs text-dark-500">{{ mailStore.mails.length }} pesan</span>
          </div>
          
          <div class="flex-1 overflow-y-auto">
            <template v-if="mailStore.mails.length > 0">
              <div
                v-for="mail in mailStore.mails"
                :key="mail.id"
                @click="openMail(mail)"
                class="px-4 py-3 border-b border-white/5 cursor-pointer transition-colors flex items-start gap-3 hover:bg-white/[0.02]"
                :class="!mail.seen ? 'bg-white/[0.02]' : ''"
              >
                <!-- Unread dot -->
                <div 
                  class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                  :class="mail.seen ? 'bg-transparent' : 'bg-primary-500'"
                />
                
                <!-- Content -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2 mb-0.5">
                    <span class="text-sm font-medium truncate" :class="mail.seen ? 'text-dark-300' : 'text-dark-100'">
                      {{ mail.from.name || mail.from.address }}
                    </span>
                    <span class="text-xs text-dark-500 flex-shrink-0">{{ formatTime(mail.createdAt) }}</span>
                  </div>
                  <div class="text-sm truncate" :class="mail.seen ? 'text-dark-500' : 'text-dark-300'">
                    {{ mail.subject || '(Tanpa subjek)' }}
                  </div>
                  <div v-if="mail.hasAttachments" class="flex items-center gap-1 mt-1">
                    <Paperclip class="w-3 h-3 text-dark-500" />
                    <span class="text-xs text-dark-500">Ada lampiran</span>
                  </div>
                </div>
                
                <ChevronRight class="w-4 h-4 text-dark-600 flex-shrink-0" />
              </div>
            </template>
            
            <template v-else>
              <div class="flex flex-col items-center justify-center text-dark-500 py-16">
                <Inbox class="w-16 h-16 mb-4 opacity-20" />
                <p class="text-dark-400 mb-1">Belum ada email</p>
                <p class="text-sm">Email baru akan muncul otomatis</p>
              </div>
            </template>
          </div>
        </div>
        
        <!-- Message detail view -->
        <div v-else class="flex flex-col">
          <!-- Back bar -->
          <div class="px-4 py-3 border-b border-white/5 flex items-center gap-3">
            <button @click="showMail = null" class="btn-ghost btn-sm">
              <ChevronRight class="w-4 h-4 rotate-180" />
              <span>Kembali ke daftar</span>
            </button>
            <div class="flex-1" />
            <button @click="deleteMail" class="btn-danger btn-sm">
              <Trash2 class="w-4 h-4" />
              <span>Hapus</span>
            </button>
          </div>
          
          <!-- Message header -->
          <div class="px-4 py-4 border-b border-white/5">
            <h3 class="font-semibold text-lg mb-3">{{ showMail.subject || '(Tanpa subjek)' }}</h3>
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white font-semibold">
                {{ getInitial(showMail.from.name || showMail.from.address) }}
              </div>
              <div>
                <div class="font-medium text-sm">{{ showMail.from.name || 'Pengirim tidak dikenal' }}</div>
                <div class="text-xs text-dark-500">{{ showMail.from.address }}</div>
              </div>
              <div class="ml-auto text-xs text-dark-500">
                {{ formatDateTime(showMail.createdAt) }}
              </div>
            </div>
          </div>
          
          <!-- Message content -->
          <div class="flex-1 overflow-y-auto p-4">
            <iframe
              v-if="showMail.html?.length > 0"
              ref="mailIframe"
              class="w-full bg-white rounded-lg border-0"
              style="min-height: 300px;"
              sandbox="allow-same-origin"
            />
            <div v-else-if="showMail.text" class="text-sm text-dark-300 leading-relaxed whitespace-pre-wrap">
              {{ showMail.text }}
            </div>
            <div v-else class="text-dark-500 text-sm">Tidak ada konten</div>
          </div>
          
          <!-- Attachments -->
          <div v-if="showMail.attachments?.length > 0" class="px-4 py-3 border-t border-white/5">
            <div class="text-xs text-dark-500 mb-2">Lampiran ({{ showMail.attachments.length }})</div>
            <div class="space-y-1.5">
              <a
                v-for="att in showMail.attachments"
                :key="att.id"
                :href="api.getAttachmentUrl(att.id)"
                :download="att.filename"
                target="_blank"
                class="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-800/50 hover:bg-dark-700/50 transition-colors"
              >
                <Download class="w-4 h-4 text-dark-400" />
                <span class="text-sm truncate flex-1">{{ att.filename }}</span>
                <span class="text-xs text-dark-500">{{ formatSize(att.size) }}</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
    
    <!-- Footer -->
    <footer class="border-t border-white/5 py-3">
      <div class="max-w-6xl mx-auto px-4 text-center text-xs text-dark-600">
        Dibangun dengan Cloudflare Workers · Pesan otomatis dihapus setelah 1 hari
      </div>
    </footer>
  </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
