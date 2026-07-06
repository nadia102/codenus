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
  const isEncryptEnabled = import.meta.env.VITE_APP_ENCRYPT === 'true';

  if (isEncryptEnabled) {
    this.$r.store.user = { login: false, info: {} };
    this.$r.store.user_loaded = false;

    this.$axios.update_key()
      .then(() => {
        this.userInfo();
      })
      .catch(() => {
        this.userInfo();
      })
      .finally(() => {
        this.loaded = true;
      });
  } else {
    this.loaded = true;
    this.userInfo();
  }

  this.setDefault();
  this.getDefault();

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    this.$r.store.deferredPrompt = e;
  });
}

};
</script>
