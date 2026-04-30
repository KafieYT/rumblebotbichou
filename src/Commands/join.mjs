import { siteApi } from '../services/siteApi.mjs'

const JOIN_COOLDOWN_MS = 2500

const getJoinCooldown = (client, senderId) => {
  if (!client.joinRateLimiter) client.joinRateLimiter = new Map()
  const now = Date.now()
  const previous = Number(client.joinRateLimiter.get(senderId) || 0)
  if (now - previous < JOIN_COOLDOWN_MS) return false
  client.joinRateLimiter.set(senderId, now)
  return true
}

export default {
  config: {
    name: 'join',
  },

  async run(client, utils, args, sender) {
    if (!getJoinCooldown(client, sender.id)) return

    try {
      const active = await siteApi.getActiveRaffle(client.username).catch(() => null)

      const raffle = active?.raffle

      if (!raffle) return

      if (raffle.type === 'CAISSE') {
        utils.log.info(`[${client.username}] !join ignore: ${sender.username} doit utiliser !claim pour le drop caisse`)
        return
      }

      await siteApi.joinRaffleFromBot(raffle.id, {
        rumbleId: sender.id,
        rumbleUsername: sender.username,
      })

      client.activeTokenRaffleId = raffle.id
      utils.log.success(`[${client.username}] !join OK: ${sender.username} inscrit a la raffle ${raffle.id}`)
    } catch (error) {
      if (error?.status === 409 || error?.code === 'RAFFLE_ALREADY_JOINED') {
        utils.log.info(`[${client.username}] !join ignore: ${sender.username} deja inscrit`)
        return
      }
      if (error?.code === 'DLIVE_NOT_LINKED') {
        utils.log.info(`[${client.username}] !join ignore: ${sender.username} non lie (api)`)
        return
      }
      utils.log.error(`[${client.username}] Erreur !join: ${error.message}`)
    }
  },
}
