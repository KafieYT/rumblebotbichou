import { hasRafflePermission } from '../Utils/permissions.mjs'

export default {
    config: {
        name: 'call-on'
    },
    run: async (client, utils, args, sender) => {
        if (!hasRafflePermission(client, sender)) return

        try {
            client.callsEnabled = true
            await client.db.query(
                `INSERT INTO call_settings (channel_name, enabled)
                 VALUES (?, 1)
                 ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
                [client.username]
            )
            client.sendMessage('✅ Les calls sont maintenant activés.')
            utils.log.success(`[${client.username}] !call-on activé par ${sender?.username || 'unknown'}`)
        } catch (error) {
            utils.log.error(`[${client.username}] Erreur !call-on: ${error.message}`)
            client.sendMessage('❌ Impossible d’activer les calls pour le moment.')
        }
    }
}
