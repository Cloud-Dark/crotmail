<script setup>
import { useToastStore } from '@/stores/toast'
import { CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-vue-next'

const toastStore = useToastStore()

const icons = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
}

const colors = {
  success: 'text-emerald-400',
  error: 'text-rose-400',
  info: 'text-primary-400',
  warning: 'text-amber-400',
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toastStore.toasts"
          :key="toast.id"
          class="flex items-center gap-3 px-5 py-4 rounded-2xl bg-dark-900/90 border border-white/10 backdrop-blur-xl shadow-2xl min-w-[280px] max-w-[400px]"
        >
          <component 
            :is="icons[toast.type]" 
            :class="['w-5 h-5 flex-shrink-0', colors[toast.type]]" 
          />
          <span class="text-sm text-dark-100">{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active {
  animation: toast-in 0.3s ease;
}

.toast-leave-active {
  animation: toast-out 0.3s ease;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(20px);
  }
}
</style>
