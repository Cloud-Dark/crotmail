import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useToastStore = defineStore('toast', () => {
  const toasts = ref([])
  let id = 0

  function add(message, type = 'info', duration = 3000) {
    const toastId = ++id
    toasts.value.push({ id: toastId, message, type })
    
    setTimeout(() => {
      remove(toastId)
    }, duration)
    
    return toastId
  }

  function remove(id) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index > -1) {
      toasts.value.splice(index, 1)
    }
  }

  function success(message, duration) {
    return add(message, 'success', duration)
  }

  function error(message, duration) {
    return add(message, 'error', duration)
  }

  function info(message, duration) {
    return add(message, 'info', duration)
  }

  function warning(message, duration) {
    return add(message, 'warning', duration)
  }

  return {
    toasts,
    add,
    remove,
    success,
    error,
    info,
    warning,
  }
})
