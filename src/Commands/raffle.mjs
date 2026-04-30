import { siteApi } from '../services/siteApi.mjs'
import { hasRafflePermission } from '../Utils/permissions.mjs'

const parseDurationToSeconds = (raw) => {
  if (!raw) return 60
  const value = String(raw).trim().toLowerCase()
  const match = value.match(/^(\d+)(s|m|h)?$/)
  if (!match) return 60
  const amount = Number(match[1])
  const unit = match[2] || 's'
  if (unit === 'h') return amount * 3600
  if (unit === 'm') return amount * 60
  return amount
}

const scheduleReminderMessages = (client, timers, durationSeconds) => {
  const reminders = [30, 20, 10, 5]
  for (const secondsLeft of reminders) {
    if (durationSeconds <= secondsLeft) continue
    const delay = (durationSeconds - secondsLeft) * 1000
    const timer = setTimeout(() => {
      client.sendMessage(`👛 La pluie de jetons se termine dans ${secondsLeft} secondes`)
    }, delay)
    timers.push(timer)
  }
}

export default {
  config: {
    name: 'raffle',
    users: ['vitabot', 'vitapvpey', 'kafieledictateurduj', 'kafie', 'kafieyt', 'curdz', 'curdzou', 'glockaucarre', 'groyeux', 'glockzer', 'blvezjm', 'axeimir', 'jucysoofe', 'jonathannn27210'],
  },

  async run(client, utils, args, sender) {
    if (!hasRafflePermission(client, sender)) return

    const amount = Number(args[0])
    if (!Number.isFinite(amount) || amount <= 0) {
      client.sendMessage('Usage: !raffle <jetons> [duree ex: 60s, 5m] [winners]')
      return
    }

    const durationSeconds = Math.max(10, parseDurationToSeconds(args[1]))
    const winnersCount = Math.max(1, Number(args[2] || 1))

    try {
      const response = await siteApi.createRaffleFromBot({
        type: 'JETONS',
        title: `Raffle ${amount} jetons`,
        description: `Raffle officielle Rumble sur ${client.username}`,
        winnersCount,
        rewardPoints: amount,
        durationSeconds,
        sourceChannel: client.username,
      })

      const raffleId = response?.raffle?.id
      if (!raffleId) {
        client.sendMessage('Erreur: raffle creee sans ID.')
        return
      }

      client.activeTokenRaffleId = raffleId
      client.raffleRunning = true

      if (Array.isArray(client.raffleTimers)) {
        client.raffleTimers.forEach((timer) => clearTimeout(timer))
      }
      client.raffleTimers = []

      const announceResult = await client.sendMessage(`🔥 Une nouvelle pluie de ${amount} jetons vient d'être lancée. Tu as ${durationSeconds} secondes pour taper !join pour entrer`)
      if (!announceResult?.ok) {
        utils.log.error(`[${client.username}] Envoi annonce raffle impossible: ${JSON.stringify(announceResult)}`)
      }

      scheduleReminderMessages(client, client.raffleTimers, durationSeconds)

      const timer = setTimeout(async () => {
        try {
          await siteApi.closeAndPickRaffle(raffleId)
          const closeResult = await client.sendMessage(`🎟️🔥 Tous les jetons ont été distribués. La raffle est terminée.`)
          if (!closeResult?.ok) {
            utils.log.error(`[${client.username}] Envoi cloture raffle impossible: ${JSON.stringify(closeResult)}`)
          }
        } catch (error) {
          utils.log.error(`[${client.username}] Erreur close-and-pick raffle jetons: ${error.message}`)
          const errorResult = await client.sendMessage('Erreur pendant la cloture de la raffle jetons.')
          if (!errorResult?.ok) {
            utils.log.error(`[${client.username}] Envoi erreur cloture raffle impossible: ${JSON.stringify(errorResult)}`)
          }
        } finally {
          client.activeTokenRaffleId = null
          client.raffleRunning = false
          client.raffleTimers = []
        }
      }, durationSeconds * 1000)
      client.raffleTimers.push(timer)
    } catch (error) {
      utils.log.error(`[${client.username}] Erreur creation raffle jetons: ${error.message}`)
      const failureResult = await client.sendMessage('Impossible de lancer la raffle jetons.')
      if (!failureResult?.ok) {
        utils.log.error(`[${client.username}] Envoi erreur raffle impossible: ${JSON.stringify(failureResult)}`)
      }
    }
  },
}
