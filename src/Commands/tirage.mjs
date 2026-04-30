import fetch from 'node-fetch'
import { hasRafflePermission } from '../Utils/permissions.mjs'

const pickRandom = (items) => items[Math.floor(Math.random() * items.length)]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeUsername = (value) => String(value || '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .trim()
  .toLowerCase()
  .replace(/^@+/, '')
  .replace(/[:;,!?.)\]}>]+$/g, '')
  .replace(/[^a-z0-9_]/g, '')

const extractUsernameFromContent = (content) => {
  const rawContent = String(content || '').trim()
  if (!rawContent) return ''
  const match = rawContent.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/)
  const candidate = match?.[1] || match?.[2] || match?.[3] || ''
  return normalizeUsername(candidate)
}

const checkAffiliate = async (username) => {
  const baseUrl = String(process.env.SITE_BASE_URL || process.env.APP_URL || '').trim().replace(/\/$/, '')
  const secret = String(process.env.BOT_SECRET || '').trim()
  if (!baseUrl || !secret) return null

  const response = await fetch(`${baseUrl}/api/bot/race/check?username=${encodeURIComponent(username)}`, {
    method: 'GET',
    headers: { 'X-BOT-SECRET': secret, Accept: 'application/json' },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload?.affiliate === true
}

const checkAffiliateWithRetry = async (username) => {
  try {
    return await checkAffiliate(username)
  } catch {
    await sleep(250)
    return await checkAffiliate(username)
  }
}

export default {
  config: { name: 'tirage' },

  async run(client, utils, args, sender) {
    if (!hasRafflePermission(client, sender)) return

    const recentMessages = Array.isArray(client.recentMessages) ? client.recentMessages : []
    const eligibleMessages = recentMessages.filter((entry) => {
      const username = String(entry?.username || '').trim()
      const content = String(entry?.content || '').trim()
      return username.length > 0
        && content.length > 0
        && username.toLowerCase() !== String(client.username || '').toLowerCase()
    })

    if (eligibleMessages.length === 0) {
      await client.sendMessage('Aucun message trouvé dans les 20 derniers messages.')
      return
    }

    const winner = pickRandom(eligibleMessages)
    const usernameToCheck = extractUsernameFromContent(winner.content)

    if (!usernameToCheck) {
      await client.sendMessage(`${winner.username} : ${winner.content} : Affiliee inconnue`)
      return
    }

    let isAffiliate = false
    try {
      isAffiliate = await checkAffiliateWithRetry(usernameToCheck)
    } catch (error) {
      utils.log.error(`[${client.username}] Erreur !tirage affiliation pour ${usernameToCheck}: ${error?.message || error}`)
      await client.sendMessage(`${winner.username} : ${winner.content} : Affiliee inconnue`)
      return
    }

    const formattedMessage = `${winner.username} : ${winner.content} : Affiliee ${isAffiliate ? 'Oui' : 'Non'}`
    utils.log.success(`[${client.username}] !tirage -> ${formattedMessage}`)
    await client.sendMessage(formattedMessage)
  },
}
