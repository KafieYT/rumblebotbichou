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
      client.sendMessage(`👛 La pluie de caisses se termine dans ${secondsLeft} secondes`)
    }, delay)
    timers.push(timer)
  }
}

const getCaseNameById = async (db, caseId) => {
  const numericId = Number(caseId)
  if (!Number.isFinite(numericId) || numericId <= 0) return null
  const rows = await db.query(`SELECT name FROM cases WHERE id = ? LIMIT 1`, [numericId])
  return rows?.[0]?.name ? String(rows[0].name) : null
}

const getWinnerDisplayNames = async (db, winnerUserIds) => {
  if (!Array.isArray(winnerUserIds) || winnerUserIds.length === 0) return []
  const placeholders = winnerUserIds.map(() => '?').join(', ')
  const rows = await db.query(
    `SELECT user_id, rumble_username, dlive_username FROM balances WHERE user_id IN (${placeholders})`,
    winnerUserIds,
  )
  const nameByUserId = new Map(
    (rows || []).map((row) => [
      String(row.user_id),
      String(row.rumble_username || row.dlive_username || '').trim()
    ]),
  )

  return winnerUserIds.map((userId) => {
    const mapped = nameByUserId.get(String(userId))
    return mapped || `user:${String(userId).slice(0, 8)}`
  })
}

const createCaseRaffleWithFallback = async ({
  winnersCount,
  durationSeconds,
  sourceChannel,
}) => {
  const payloads = [
    {
      type: 'CAISSE',
      title: `Drop ${winnersCount} caisses`,
      description: `Drop officiel Rumble sur ${sourceChannel}`,
      winnersCount,
      durationSeconds,
      sourceChannel,
    },
    {
      type: 'CAISSE',
      title: `Drop ${winnersCount} caisses`,
      description: `Drop officiel Rumble sur ${sourceChannel}`,
      winnersCount,
      rewardCases: winnersCount,
      durationSeconds,
      sourceChannel,
    },
    {
      type: 'CASE',
      title: `Drop ${winnersCount} caisses`,
      description: `Drop officiel Rumble sur ${sourceChannel}`,
      winnersCount,
      rewardCases: winnersCount,
      durationSeconds,
      sourceChannel,
    },
  ]

  let lastError
  for (const payload of payloads) {
    try {
      return await siteApi.createRaffleFromBot(payload)
    } catch (error) {
      lastError = error
      if (Number(error?.status || 0) !== 500) throw error
    }
  }
  throw lastError
}

export default {
  config: {
    name: 'drop',
    users: ['vitabot', 'vitapvpey', 'kafieledictateurduj', 'kafie', 'kafieyt', 'curdz', 'curdzou', 'glockaucarre', 'groyeux', 'glockzer', 'blvezjm', 'axeimir'],
  },

  async run(client, utils, args, sender) {
    if (!hasRafflePermission(client, sender)) return

    const winnersCount = Number(args[0])
    const durationSeconds = Math.max(10, parseDurationToSeconds(args[1]))

    if (!Number.isFinite(winnersCount) || winnersCount <= 0) {
      client.sendMessage('Usage: !drop <nombre_gagnants> [duree ex: 60s, 5m]')
      return
    }

    try {
      const response = await createCaseRaffleWithFallback({
        winnersCount,
        durationSeconds,
        sourceChannel: client.username,
      })

      const raffleId = response?.raffle?.id
      if (!raffleId) {
        client.sendMessage('Erreur: drop cree sans ID.')
        return
      }

      client.activeCaseRaffleId = raffleId
      client.raffleCaissesRunning = true

      if (Array.isArray(client.raffleCaissesTimers)) {
        client.raffleCaissesTimers.forEach((timer) => clearTimeout(timer))
      }
      client.raffleCaissesTimers = []

      client.sendMessage(`🔥 Une nouvelle pluie de ${winnersCount} caisses vient d'être lancée. Tu as ${durationSeconds} secondes pour taper !claim pour entrer`)

      scheduleReminderMessages(client, client.raffleCaissesTimers, durationSeconds)

      const timer = setTimeout(async () => {
        try {
          const closeResult = await siteApi.closeAndPickRaffle(raffleId)
          const raffleResult = await siteApi.getRaffleById(raffleId).catch(() => null)
          const rewardCaseId = raffleResult?.raffle?.rewardCaseId
          const caseName = await getCaseNameById(client.db, rewardCaseId).catch(() => null)
          const winnerUserIds = Array.isArray(closeResult?.winnerUserIds) ? closeResult.winnerUserIds : []
          const winnerNames = await getWinnerDisplayNames(client.db, winnerUserIds).catch(() => [])

          const caseLabel = caseName || `Caisse #${rewardCaseId || '?'}`
          if (winnerNames.length === 0) {
            client.sendMessage(`🎟️🔥 Drop termine. Aucun gagnant cette fois.`)
          } else {
            for (const winnerName of winnerNames) {
              client.sendMessage(`🏆 ${winnerName} a gagne: ${caseLabel}`)
            }
          }
        } catch (error) {
          utils.log.error(`[${client.username}] Erreur close-and-pick drop: ${error.message}`)
          client.sendMessage('Erreur pendant la cloture du drop.')
        } finally {
          client.activeCaseRaffleId = null
          client.raffleCaissesRunning = false
          client.raffleCaissesTimers = []
        }
      }, durationSeconds * 1000)

      client.raffleCaissesTimers.push(timer)
    } catch (error) {
      const status = Number(error?.status || 0)
      const errorCode = error?.code ? ` code=${error.code}` : ''
      const body = error?.body ? ` body=${JSON.stringify(error.body)}` : ''
      utils.log.error(
        `[${client.username}] Erreur creation drop: ${error.message} status=${status || 'n/a'}${errorCode}${body}`,
      )

      if (error?.code === 'BOT_SECRET_MISSING' || status === 401 || status === 403) {
        client.sendMessage('Impossible de lancer le drop: BOT_SECRET manquant ou invalide.')
        return
      }

      if (error?.code) {
        client.sendMessage(`Impossible de lancer le drop: ${error.code}`)
        return
      }

      client.sendMessage('Impossible de lancer le drop.')
    }
  },
}
