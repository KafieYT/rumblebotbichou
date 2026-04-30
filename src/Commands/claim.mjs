import { siteApi } from '../services/siteApi.mjs'

const CLAIM_COOLDOWN_MS = 2500

const getClaimCooldown = (client, senderId) => {
  if (!client.claimRateLimiter) client.claimRateLimiter = new Map()
  const now = Date.now()
  const previous = Number(client.claimRateLimiter.get(senderId) || 0)
  if (now - previous < CLAIM_COOLDOWN_MS) return false
  client.claimRateLimiter.set(senderId, now)
  return true
}

export default {
  config: {
    name: 'claim',
  },

  async run(client, utils, args, sender) {
    if (!getClaimCooldown(client, sender.id)) return

    try {
      const active = await siteApi.getActiveRaffle(client.username).catch(() => null)

      const raffle = active?.raffle

      if (!raffle || raffle.type !== 'CAISSE') return

      await siteApi.joinRaffleFromBot(raffle.id, {
        rumbleId: sender.id,
        rumbleUsername: sender.username,
      })

      client.activeCaseRaffleId = raffle.id
      utils.log.success(`[${client.username}] !claim OK: ${sender.username} inscrit au drop caisse ${raffle.id}`)
    } catch (error) {
      if (error?.code === 'RAFFLE_ALREADY_JOINED') {
        utils.log.info(`[${client.username}] !claim ignore: ${sender.username} deja inscrit`)
        return
      }
      if (error?.code === 'RAFFLE_NOT_ACTIVE') {
        utils.log.info(`[${client.username}] !claim ignore: raffle inactive`)
        return
      }
      if (error?.code === 'DLIVE_NOT_LINKED') {
        utils.log.info(`[${client.username}] !claim ignore: ${sender.username} non lie (api)`)
        return
      }
      utils.log.error(`[${client.username}] Erreur !claim: ${error.message}`)
    }
  },
}
