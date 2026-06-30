<template>
  <r-app>
    <div
      v-if="!lang_added||!loaded"
      class="d-flex h-center v-center color-one h-full"
    >
      <r-progress-circle size="100" indeterminate width="4"></r-progress-circle>
    </div>
    <router-view v-else />
  </r-app>
</template>
<script>
import { App } from "./mixins/app.js";

export default {
  mixins: [App],
  data() {
    return {
      loaded: false
    }
  },
  created() {
    /**
     * Handle encryption initialization safely
     * Vite always returns env variables as strings,
     * so we need explicit boolean conversion.
     */
    const isEncryptEnabled = 
      import.meta.env.VITE_APP_ENCRYPT === 'true' || 
      import.meta.env.VITE_APP_ENCRYPT === true;

    if (isEncryptEnabled) {
      // Prepare store for authenticated state
      this.$r.store.user = { login: false, info: {} }
      this.$r.store.user_loaded = false

      this.$axios.update_key()
        .then(() => {
          console.log('✅ [App.vue] Crypto key updated successfully')
          this.userInfo()
        })
        .catch(err => {
          console.error('❌ [App.vue] Crypto initialization failed:', err)
          // Graceful fallback: continue loading the app even if encryption fails
          this.userInfo()
        })
        .finally(() => {
          this.loaded = true
        })
    } else {
      console.log('🔓 [App.vue] Encryption disabled - loading in plain mode')
      this.loaded = true
      this.userInfo()
    }

    this.setDefault()
    this.getDefault()

    // PWA - Handle "Add to Home Screen" prompt
    window.addEventListener("beforeinstallprompt", e => {
      console.log("📱 [App.vue] beforeinstallprompt event captured")
      e.preventDefault()
      this.$r.store.deferredPrompt = e
    })
  }
};
</script>
