import { siteApi } from '../services/siteApi.mjs'

const formatVoteError = (error) => {
  const code = String(error?.code || '')
  const byCode = {
    PREDICTION_NONE_ACTIVE: 'Aucune prédiction active actuellement.',
    PREDICTION_EXPIRED: 'La prédiction est terminée, les votes sont fermés.',
    PREDICTION_UNKNOWN_OPTION: 'Option invalide pour cette prédiction.',
    PREDICTION_INVALID_OPTION: 'Format invalide. Utilise : !vote <option> <montant>',
    PREDICTION_INVALID_AMOUNT: 'Montant invalide. Mise autorisée entre 1 et 25 000 jetons.',
    PREDICTION_INSUFFICIENT_BALANCE: error?.message || 'Solde insuffisant.',
    PREDICTION_ALREADY_VOTED: 'Tu as déjà participé à cette prédiction.',
    RUMBLE_ACCOUNT_NOT_LINKED: 'Compte Rumble non lié. Va sur https://vitapvpey.com/settings pour lier ton compte.',
    BOT_SECRET_MISSING: 'Configuration bot incomplète.',
    BOT_UNAUTHORIZED: 'Configuration bot invalide.',
  }
  return byCode[code] || error?.message || 'Impossible de valider ton vote pour le moment.'
}

export default {
  config: {
    name: 'vote',
  },

  run: async (client, utils, args, sender) => {
    const optionNumber = Number(args[0])
    const stakeAmount = Number(args[1])

    if (!Number.isInteger(optionNumber) || !Number.isInteger(stakeAmount)) {
      await client.sendMessage(`@${sender?.displayname || sender?.username || 'viewer'} Format invalide. Utilise : !vote <option> <montant>`)
      return
    }

    try {
      const result = await siteApi.submitPredictionVote({
        optionNumber,
        stakeAmount,
        rumbleId: sender?.id || null,
        rumbleUsername: sender?.username || null,
      })

      await client.sendMessage(result?.message || `@${sender?.displayname || sender?.username || 'viewer'} Vote accepté.`)
      await utils.log.success(`[${client.username}] !vote OK user=${sender?.username} option=${optionNumber} amount=${stakeAmount}`)
    } catch (error) {
      const message = formatVoteError(error)
      await client.sendMessage(`@${sender?.displayname || sender?.username || 'viewer'} ${message}`)
      await utils.log.error(`[${client.username}] !vote KO user=${sender?.username} option=${optionNumber} code=${error?.code}`)
    }
  },
}
