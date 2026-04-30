import { siteApi } from '../services/siteApi.mjs'

export default {
  config: {
    name: 'verify',
  },
  run: async (client, utils, args, sender) => {
    if (!args[0]) {
      return utils.log.error(`${sender.username} n'a pas fourni de token de verification.`)
    }

    const token = args[0]
    const result = await verifyRumbleUser(client.db, token, sender.username, sender.id)

    if (result.notFound) {
      client.sendMessage(`@${sender.displayname || sender.username} ce code de verification est invalide.`)
      return utils.log.info(`${sender.username} a utilise !verify avec un token invalide`)
    }

    if (result.error) {
      client.sendMessage(`@${sender.displayname || sender.username} verification impossible pour le moment.`)
      return utils.log.error(`Erreur lors de la verification de ${sender.username}`)
    }

    client.sendMessage(`@${sender.displayname || sender.username} vous avez ete verifie avec succes!`)
    utils.log.success(`[verify] ${sender.username} verifie sur Rumble`)
  },
}

async function verifyRumbleUser(db, token, username, userId) {
  try {
    const response = await siteApi.verifyRumbleAccount({
      token,
      rumbleId: userId,
      rumbleUsername: username,
    })

    return {
      error: false,
      notFound: false,
      remote: true,
      response,
    }
  } catch (err) {
    if (err?.code === 'RUMBLE_TOKEN_INVALID' || err?.status === 404) {
      return { error: false, notFound: true, remote: true }
    }

    if (err?.code !== 'BOT_SECRET_MISSING' && err?.code !== 'BOT_UNAUTHORIZED' && err?.status !== 401) {
      utilsSafeWarn(`[verify] site API indisponible, fallback DB: ${err?.message || err}`)
    } else {
      return { error: true, notFound: false, remote: true }
    }
  }

  if (!db?.query) {
    return { error: true, notFound: false, remote: false }
  }

  try {
    const results = await db.query(
      `UPDATE balances SET rumble_id = ?, rumble_token = ?, rumble_username = ? WHERE rumble_token = ?`,
      [userId, token, username, token]
    )
    const affected = results?.affectedRows ?? 0
    return { error: false, notFound: affected === 0, remote: false }
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      utilsSafeWarn('[verify] Colonnes Rumble absentes - migration requise')
      return { error: true, notFound: false, remote: false }
    }
    utilsSafeWarn(err?.message || err)
    return { error: true, notFound: false, remote: false }
  }
}

function utilsSafeWarn(message) {
  try {
    console.warn(message)
  } catch {}
}
