import fetch from 'node-fetch'

const baseUrl = String(process.env.SITE_BASE_URL || process.env.APP_URL || 'https://vitapvpey.com').replace(/\/$/, '')
const botSecret = String(process.env.BOT_SECRET || '')
const FETCH_TIMEOUT_MS = 8_000

const buildUrl = (path) => `${baseUrl}${path}`

const request = async (path, options = {}) => {
  if (!botSecret) {
    const err = new Error('BOT_SECRET is missing')
    err.code = 'BOT_SECRET_MISSING'
    throw err
  }

  const response = await fetch(buildUrl(path), {
    method: 'GET',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-BOT-SECRET': botSecret,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(json?.error || `Request failed (${response.status})`)
    err.status = response.status
    err.code = json?.code
    err.body = json
    throw err
  }

  return json
}

export const siteApi = {
  createRaffleFromBot: (payload) =>
    request('/api/raffles/from-bot', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getActiveRaffle: (channel) => request(`/api/raffles/active?channel=${encodeURIComponent(channel)}`),

  closeAndPickRaffle: (raffleId) =>
    request(`/api/raffles/${encodeURIComponent(raffleId)}/close-and-pick`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  joinRaffleFromBot: (raffleId, payload) =>
    request(`/api/raffles/${encodeURIComponent(raffleId)}/join-from-bot`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  claimRaffleFromBot: (raffleId, payload) =>
    request(`/api/raffles/${encodeURIComponent(raffleId)}/claim-from-bot`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRaffleById: (raffleId) => request(`/api/raffles/${encodeURIComponent(raffleId)}`),

  submitPredictionVote: (payload) =>
    request('/api/dlive-predictions/vote-from-bot', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getCurrentPrediction: () => request('/api/dlive-predictions/current'),

  verifyRumbleAccount: (payload) =>
    request('/api/integrations/rumble/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  relayRumbleMessage: (payload) =>
    request('/api/integrations/rumble/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
