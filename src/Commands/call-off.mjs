import { hasRafflePermission } from '../Utils/permissions.mjs'

export default {
    config: {
        name: 'call-off'
    },
    run: async (client, utils, args, sender) => {
        if (!hasRafflePermission(client, sender)) return

        try {
            client.callsEnabled = false
            await client.db.query(
                `INSERT INTO call_settings (channel_name, enabled)
                 VALUES (?, 0)
                 ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
                [client.username]
            )
            client.sendMessage('⛔ Les calls sont maintenant désactivés.')
            utils.log.success(`[${client.username}] !call-off activé par ${sender?.username || 'unknown'}`)
        } catch (error) {
            utils.log.error(`[${client.username}] Erreur !call-off: ${error.message}`)
            client.sendMessage('❌ Impossible de désactiver les calls pour le moment.')
        }
    }
}
