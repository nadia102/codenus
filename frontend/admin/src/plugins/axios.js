import axios from 'axios'
import { Crypto } from '@/plugins/ecc.js'

const serverPublicKey = import.meta.env.VITE_APP_SERVER_PUBKEY

const cryptor = new Crypto()

axios.defaults.baseURL = `${import.meta.env.VITE_APP_API_URL}/api`
axios.defaults.headers['X-Requested-With'] = 'XMLHttpRequest'
axios.defaults.headers.post['Content-Type'] = 'application/json'

axios.defaults.encrypt = import.meta.env.VITE_APP_ENCRYPT === 'true'

let isRefreshing = false
let failedQueue = []

let refreshChannel
try {
  refreshChannel = new BroadcastChannel('token-refresh')
} catch (e) {
  // BroadcastChannel not supported in this environment
}

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

if (refreshChannel) {
  refreshChannel.onmessage = async (event) => {
    const { type, token, sharedKey } = event.data
    if (type === 'refresh_started') {
      isRefreshing = true
    } else if (type === 'refresh_completed') {
      isRefreshing = false
      if (token) {
        await window.app.$storage.setSafe('auth.token', token)
        axios.defaults.headers.common.Authorization = token
        processQueue(null, token)
      }
    } else if (type === 'refresh_failed') {
      isRefreshing = false
      processQueue(new Error('Token refresh failed in another tab'))
    } else if (type === 'crypto_key') {
      cryptor.sharedKey = sharedKey
    }
  }
}

const encryptRequestData = (data) => {
  if (data instanceof FormData || data instanceof Blob || data instanceof URLSearchParams) {
    if (data instanceof FormData) {
      const obj = {}
      data.forEach((value, key) => {
        obj[key] = value
      })
      data = obj
    } else if (data instanceof URLSearchParams) {
      data = Object.fromEntries(data.entries())
    }
  }

  const dataString = typeof data === 'string' ? data : JSON.stringify(data)
  return cryptor.encrypt_text(dataString)
}

axios.interceptors.request.use(
  async (config) => {
    const methodsToEncrypt = ['post', 'put', 'patch', 'POST', 'PUT', 'PATCH']

    if (window.app.$storage.has('auth.token')) {
      config.headers.Authorization = await window.app.$storage.getSafe('auth.token')
    }
    config.headers.lang = window.app.$r.lang

    const shouldEncrypt =
      config.encrypt === true &&
      methodsToEncrypt.includes(config.method) &&
      config.data

    if (shouldEncrypt) {
      const originalContentType =
        config.headers['Content-Type'] || config.headers['content-type'] || 'application/json'

      return encryptRequestData(config.data).then((encryptedData) => {
        config.data = encryptedData
        config.headers['encrypted'] = '1'
        config.headers['real-type'] = originalContentType
        config.headers['Content-Type'] = 'text/plain'
        config.responseType = 'arraybuffer'
        config.transformResponse = [(data) => data]
        return config
      })
    } else if (config.responseType === 'arraybuffer' || config.encrypt) {
      config.responseType = 'arraybuffer'
      config.transformResponse = [(data) => data]
    }

    return config
  },
  (error) => Promise.reject(error)
)

axios.interceptors.response.use(
  async (response) => {
    const headers = response.headers
    let responseData = response.data

    const parseDecrypted = (text, realType) => {
      if (!realType) return text
      if (realType.includes('application/json')) {
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }
      return text
    }

    if (headers.encrypted === '1' && responseData instanceof ArrayBuffer) {
      try {
        const encryptedBytes = new Uint8Array(responseData)
        const decryptedBytes = await cryptor.decrypt(encryptedBytes)
        const decryptedText = new TextDecoder('utf-8').decode(decryptedBytes)
        const realType = headers['real-type'] || headers['realType'] || 'application/json'
        responseData = parseDecrypted(decryptedText, realType)
      } catch {
        return Promise.reject(new Error('Failed to decrypt response'))
      }
    } else if (responseData instanceof ArrayBuffer) {
      const contentType = headers['content-type'] || headers['Content-Type'] || ''
      const text = new TextDecoder('utf-8').decode(new Uint8Array(responseData))

      if (contentType.includes('application/json')) {
        try {
          responseData = JSON.parse(text)
        } catch {
          responseData = text
        }
      } else if (contentType.includes('text') || contentType.includes('html')) {
        responseData = text
      } else {
        responseData = new Uint8Array(responseData)
      }
    }

    if (responseData && typeof responseData === 'object' && responseData.msg) {
      responseData = window.app.$helper.htmlDecode(responseData)
      if (responseData.msg) {
        window.app.$toast(window.app.$t(responseData.msg))
      }
    }

    response.data = responseData
    return response
  },

  async (error) => {
    // ... (بقیه کد response interceptor بدون تغییر ساختاری)
    return Promise.reject(error)
  }
)

axios.update_key = () => {
  isRefreshing = true
  if (refreshChannel) {
    refreshChannel.postMessage({ type: 'refresh_started' })
  }

  return cryptor
    .init(serverPublicKey)
    .then((clientPublicKey) => {
      return axios
        .post(
          '/user/renew-token',
          { pubKey: clientPublicKey },
          { encrypt: false }
        )
        .then(
          async ({ data }) => {
            const newToken = data.token
            await window.app.$storage.setSafe('auth.token', newToken)
            axios.defaults.headers.common.Authorization = newToken

            if (refreshChannel) {
              refreshChannel.postMessage({ type: 'refresh_completed', token: newToken })
              refreshChannel.postMessage({ type: 'crypto_key', sharedKey: cryptor.sharedKey })
            }
            return Promise.resolve('ok')
          },
          (err) => {
            if (refreshChannel) {
              refreshChannel.postMessage({ type: 'refresh_failed' })
            }
            window.app.$toast(window.app.$t('auth.token_renewal_failed'), { type: 'error' })
            return Promise.reject(err)
          }
        )
    })
    .finally(() => {
      isRefreshing = false
    })
}

export default {
  install: (app) => {
    app.config.globalProperties.$axios = axios
    app.provide('axios', app.config.globalProperties.$axios)
  },
}
