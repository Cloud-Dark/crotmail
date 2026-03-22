<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useToastStore } from '@/stores/toast'
import { useMailStore } from '@/stores/mail'
import { api, ApiError } from '@/services/api'
import { Lock, ArrowRight } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const toast = useToastStore()
const mailStore = useMailStore()

const accessKey = ref('')
const loading = ref(false)

async function handleResumeCode(code) {
  if (!/^[A-Za-z0-9]{8}$/.test(code)) {
    toast.error('Kode resume tidak valid')
    return
  }

  loading.value = true
  try {
    const data = await api.resumeByCode(code)
    mailStore.setSession({ ...data, resumeCode: code })
    sessionStorage.setItem('auth', 'true')
    await router.replace('/app')
  } catch (e) {
    toast.error('Link resume tidak valid atau sudah kedaluwarsa')
    await router.replace('/login')
  } finally {
    loading.value = false
  }
}

// Check URL parameters
if (route.query.key) {
  sessionStorage.setItem('auth', 'true')
  sessionStorage.setItem('accessKey', route.query.key)
  router.replace('/app')
}

if (route.params.code) {
  handleResumeCode(String(route.params.code))
}

async function handleLogin() {
  if (!accessKey.value) {
    toast.error('Masukkan access key')
    return
  }
  
  loading.value = true
  
  // Save key for backend validation
  sessionStorage.setItem('accessKey', accessKey.value)
  
  try {
    // Try loading domain list to validate key
    await api.getDomains()
    sessionStorage.setItem('auth', 'true')
    router.push('/app')
  } catch (e) {
    sessionStorage.removeItem('accessKey')
    if (e instanceof ApiError && e.status === 401) {
      toast.error('Access key tidak valid')
    } else {
      toast.error('Verifikasi gagal, coba lagi')
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-md">
      <!-- Card -->
      <div class="relative">
        <!-- Top glow -->
        <div class="absolute -top-px inset-x-8 h-px bg-gradient-to-r from-transparent via-primary-500/50 to-transparent" />
        
        <div class="card p-10">
          <!-- Icon -->
          <div class="flex justify-center mb-8">
            <div class="relative">
              <div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center glow">
                <Lock class="w-9 h-9 text-white" />
              </div>
              <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 blur-xl opacity-40 animate-pulse-slow" />
            </div>
          </div>
          
          <!-- Title -->
          <div class="text-center mb-8">
            <h1 class="text-3xl font-bold mb-2">
                      <span class="text-gradient">CrotMail</span>
                    </h1>
                    <p class="text-dark-400 text-sm">Email sementara, pakai lalu buang</p>          </div>
          
          <!-- Form -->
          <form @submit.prevent="handleLogin" class="space-y-5">
            <div class="relative">
              <input
                v-model="accessKey"
                type="password"
                class="input pl-12"
                placeholder="Masukkan access key"
                autocomplete="off"
              >
              <div class="absolute left-4 top-1/2 -translate-y-1/2 text-dark-500">
                <Lock class="w-5 h-5" />
              </div>
            </div>
            
            <button
              type="submit"
              class="btn-primary w-full py-3.5 text-base"
              :disabled="loading"
            >
              <template v-if="loading">
                <div class="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <span>Memverifikasi...</span>
              </template>
              <template v-else>
                <span>Masuk ke inbox</span>
                <ArrowRight class="w-5 h-5" />
              </template>
            </button>
          </form>
          
          <!-- Hint -->
          <div class="mt-8 pt-6 border-t border-white/5 text-center">
            <p class="text-dark-500 text-xs leading-relaxed">
              Tambahkan key ke URL untuk login otomatis<br>
              <code class="px-2 py-0.5 rounded bg-dark-800 text-dark-400 font-mono text-xs">?key=access-key-anda</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
