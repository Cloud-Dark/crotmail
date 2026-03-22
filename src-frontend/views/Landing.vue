<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Mail, ShieldCheck, Clock3, Sparkles, ArrowRight, Link2 } from 'lucide-vue-next'

const router = useRouter()

const isAuthenticated = computed(() => sessionStorage.getItem('auth') === 'true')
const currentYear = new Date().getFullYear()

function openApp() {
  router.push(isAuthenticated.value ? '/app' : '/login')
}
</script>

<template>
  <div class="min-h-screen relative overflow-hidden">
    <div class="absolute inset-0 pointer-events-none">
      <div class="absolute -top-24 left-1/2 -translate-x-1/2 w-[760px] h-[760px] rounded-full bg-primary-500/10 blur-3xl" />
      <div class="absolute -bottom-32 right-0 w-[520px] h-[520px] rounded-full bg-accent-500/10 blur-3xl" />
    </div>

    <header class="relative z-10 max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
          <Mail class="w-5 h-5 text-white" />
        </div>
        <span class="text-xl font-bold text-gradient">CrotMail</span>
      </div>
      <button class="btn-secondary" @click="router.push('/login')">
        Login
      </button>
    </header>

    <main class="relative z-10 max-w-6xl mx-auto px-6 pb-12 pt-8 md:pt-14">
      <section class="grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-300 text-xs font-medium mb-5">
            <Sparkles class="w-3.5 h-3.5" />
            Disposable Inbox for Fast Signup
          </div>

          <h1 class="text-4xl md:text-6xl leading-tight font-black tracking-tight text-dark-50">
            Email Sementara
            <span class="text-gradient block mt-1">yang Cepat dan Aman</span>
          </h1>

          <p class="mt-5 text-dark-300 text-base md:text-lg max-w-xl leading-relaxed">
            Buat inbox instan, terima email verifikasi dalam hitungan detik, dan lanjutkan kerja tanpa spam di email utama.
          </p>

          <div class="mt-8 flex flex-wrap gap-3">
            <button class="btn-primary btn-lg" @click="openApp">
              Buka Aplikasi
              <ArrowRight class="w-4 h-4" />
            </button>
            <button class="btn-secondary btn-lg" @click="router.push('/login')">
              Masuk dengan Access Key
            </button>
          </div>

          <div class="mt-8 text-sm text-dark-400 flex items-center gap-2">
            <Link2 class="w-4 h-4" />
            Dukungan resume link unik untuk lanjut akses inbox.
          </div>

          <div class="mt-6 p-4 rounded-xl bg-dark-900/70 border border-white/10 space-y-2">
            <div class="text-sm text-dark-200 font-semibold">Open Source Project</div>
            <div class="text-sm text-dark-300">Maintained by Masanto (imnoob59)</div>
            <div class="text-xs text-dark-500">CrotMail dikembangkan secara terbuka dengan fokus ke privasi, kecepatan, dan workflow developer.</div>
            <a
              href="https://github.com/imnoob59/crotmail"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-2 text-sm text-primary-300 hover:text-primary-200 transition-colors"
            >
              <Link2 class="w-4 h-4" />
              github.com/imnoob59/crotmail
            </a>
          </div>
        </div>

        <div class="card p-6 md:p-8">
          <h2 class="text-xl font-semibold mb-5">Kenapa CrotMail?</h2>
          <div class="space-y-4">
            <div class="flex items-start gap-3 p-4 rounded-xl bg-dark-800/60 border border-white/5">
              <Clock3 class="w-5 h-5 text-amber-400 mt-0.5" />
              <div>
                <div class="font-medium text-dark-100">Masa aktif panjang</div>
                <div class="text-sm text-dark-400 mt-1">Inbox aktif hingga 30 hari dengan hitung mundur real-time.</div>
              </div>
            </div>

            <div class="flex items-start gap-3 p-4 rounded-xl bg-dark-800/60 border border-white/5">
              <ShieldCheck class="w-5 h-5 text-emerald-400 mt-0.5" />
              <div>
                <div class="font-medium text-dark-100">Privasi lebih rapih</div>
                <div class="text-sm text-dark-400 mt-1">Pesan dibersihkan otomatis (default 1 hari) untuk mengurangi jejak data.</div>
              </div>
            </div>

            <div class="flex items-start gap-3 p-4 rounded-xl bg-dark-800/60 border border-white/5">
              <Mail class="w-5 h-5 text-sky-400 mt-0.5" />
              <div>
                <div class="font-medium text-dark-100">Multi-domain siap pakai</div>
                <div class="text-sm text-dark-400 mt-1">Bisa jalankan beberapa domain inbox sekaligus sesuai konfigurasi worker.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer class="mt-12 pt-6 border-t border-white/10 text-sm text-dark-500 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>Copyright © {{ currentYear }} crotmail.app. All rights reserved.</div>
        <div>Open source project by Masanto</div>
      </footer>
    </main>
  </div>
</template>
