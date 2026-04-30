import fetch from 'node-fetch'

const CHECK_COOLDOWN_MS = 3000
const userCooldowns = new Map()

const normalizeUsername = (value) => String(value || '').trim().toLowerCase().replace(/^@+/, '')

const extractUsernameFromMessage = (message, args) => {
  const rawMessage = String(message || '').trim()
  const afterCommand = rawMessage.replace(/^!\w+\s*/i, '').trim()

  if (afterCommand) {
    const quotedMatch = afterCommand.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/)
    const candidate = quotedMatch?.[1] || quotedMatch?.[2] || quotedMatch?.[3] || ''
    const normalized = normalizeUsername(candidate)
    if (normalized) return normalized
  }

  return normalizeUsername(args?.[0])
}

const isOnCooldown = (senderId) => {
  const key = String(senderId || '')
  if (!key) return false

  const now = Date.now()
  const lastRunAt = userCooldowns.get(key) || 0
  if (now - lastRunAt < CHECK_COOLDOWN_MS) {
    return true
  }

  userCooldowns.set(key, now)
  return false
}

const buildCheckUrl = (username) => {
  const baseUrl = String(process.env.VITAPVPEY_API_BASE || process.env.SITE_BASE_URL || process.env.APP_URL || '')
    .trim()
    .replace(/\/$/, '')

  if (!baseUrl) {
    const err = new Error('VITAPVPEY_API_BASE is missing')
    err.code = 'API_BASE_MISSING'
    throw err
  }

  return `${baseUrl}/api/bot/race/check?username=${encodeURIComponent(username)}`
}

const getBotSecret = () => {
  const secret = String(process.env.VITAPVPEY_BOT_SECRET || process.env.BOT_SECRET || '').trim()
  if (!secret) {
    const err = new Error('VITAPVPEY_BOT_SECRET is missing')
    err.code = 'BOT_SECRET_MISSING'
    throw err
  }

  return secret
}

const checkAffiliate = async (username) => {
  const url = buildCheckUrl(username)
  const secret = getBotSecret()

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BOT-SECRET': secret,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(payload?.error || `Request failed (${response.status})`)
    err.status = response.status
    throw err
  }

  return payload?.affiliate === true
}

export default {
  config: {
    name: 'check',
  },

  async run(client, utils, args, sender, message) {
    try {
      if (isOnCooldown(sender?.id)) return

      const username = extractUsernameFromMessage(message, args)
      if (!username) {
        await client.sendMessage('⚠️ erreur')
        return
      }

      const affiliate = await checkAffiliate(username)
      if (affiliate) {
        await client.sendMessage(`✅ @${username} est bien affilié.`)
        return
      }

      await client.sendMessage(`❌ @${username} n'est pas affilié.`)
    } catch (error) {
      utils.log.error(
        `[${client.username}] Erreur !check pour ${sender?.username || 'unknown'}: ${error?.message || error}`,
      )
      await client.sendMessage('⚠️ Impossible de vérifier l’affiliation pour le moment.')
    }
  },
}
