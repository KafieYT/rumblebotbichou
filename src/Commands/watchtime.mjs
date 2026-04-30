const WATCHTIME_TARGET_CHANNELS = ['vitapvpey', 'glockaucarre']
const WATCHTIME_SINCE_LABEL = '01/03/26'
const MAX_WINDOW_SECONDS = 600

const normalizeRows = (result) => {
    if (Array.isArray(result) && Array.isArray(result[0])) return result[0]
    return Array.isArray(result) ? result : []
}

const toDate = (value) => {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

const formatWatchtime = (totalSeconds) => {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0)
    const hours = Math.floor(safeSeconds / 3600)
    const minutes = Math.floor((safeSeconds % 3600) / 60)
    if (hours <= 0) return `${minutes}m`
    if (minutes <= 0) return `${hours}h`
    return `${hours}h ${minutes}m`
}

const sanitizeTargetUsername = (value) => {
    const normalized = String(value || '').trim().replace(/^@+/, '')
    return normalized || null
}

const findLinkedByRumbleId = async (db, rumbleId) => {
    if (!rumbleId) return null
    try {
        const rows = normalizeRows(await db.query(
            `SELECT b.*, u.username AS site_username
             FROM balances b
             LEFT JOIN users u ON u.id = b.user_id
             WHERE b.rumble_id = ? LIMIT 1`,
            [rumbleId]
        ))
        return rows[0] || null
    } catch (err) {
        if (err?.code === 'ER_BAD_FIELD_ERROR') return null
        throw err
    }
}

const findLinkedByRumbleUsername = async (db, rumbleUsername) => {
    if (!rumbleUsername) return null
    try {
        const rows = normalizeRows(await db.query(
            `SELECT b.*, u.username AS site_username
             FROM balances b
             LEFT JOIN users u ON u.id = b.user_id
             WHERE LOWER(b.rumble_username) = LOWER(?) LIMIT 1`,
            [rumbleUsername]
        ))
        return rows[0] || null
    } catch (err) {
        if (err?.code === 'ER_BAD_FIELD_ERROR') return null
        throw err
    }
}

const getWatchtimeSeconds = async (db, linkedUser, channelName) => {
    const userId = String(linkedUser?.user_id || '').trim()
    if (!userId) return 0

    const rows = normalizeRows(await db.query(
        `SELECT total_seconds, last_activity_at, last_counted_at
         FROM dlive_watchtime
         WHERE user_id = ? AND channel_name = ? LIMIT 1`,
        [userId, channelName]
    ))

    if (!rows[0]) return 0

    const row = rows[0]
    const total = Number(row.total_seconds || 0)
    const lastActivity = toDate(row.last_activity_at)
    const lastCounted = toDate(row.last_counted_at) || lastActivity

    if (!lastActivity || !lastCounted) return total

    // Crédite le temps non encore comptabilisé
    const now = new Date()
    const maxEligible = new Date(lastActivity.getTime() + MAX_WINDOW_SECONDS * 1000)
    const nextCounted = now < maxEligible ? now : maxEligible
    const added = Math.max(0, Math.min(Math.floor((nextCounted - lastCounted) / 1000), MAX_WINDOW_SECONDS))

    return total + added
}

export default {
    config: {
        name: 'watchtime'
    },
    run: async (client, utils, args, sender) => {
        try {
            const currentChannel = String(client?.username || '').trim().toLowerCase()
            if (!WATCHTIME_TARGET_CHANNELS.includes(currentChannel)) {
                await client.sendMessage('Le watchtime est disponible uniquement sur VitaPvPey et GlockAuCarre.')
                return
            }

            const targetArg = sanitizeTargetUsername(args?.[0])

            // Résolution de l'utilisateur cible
            let targetLinkedUser = null
            let targetDisplayName = null

            if (targetArg) {
                targetLinkedUser = await findLinkedByRumbleUsername(client.db, targetArg)
                targetDisplayName = targetArg
            } else {
                targetLinkedUser = await findLinkedByRumbleId(client.db, sender?.id)
                if (!targetLinkedUser) {
                    targetLinkedUser = await findLinkedByRumbleUsername(client.db, sender?.username)
                }
                targetDisplayName = sender?.displayname || sender?.username || 'viewer'
            }

            if (!targetLinkedUser) {
                const msg = targetArg
                    ? `@${targetArg} n'est pas affilié à la boutique.`
                    : `Tu n'es pas affilié à la boutique. Pour lier ton compte : https://vitapvpey.com/settings → clique sur "Lier vos comptes", puis entre le code Rumble dans le chat !`
                await client.sendMessage(msg)
                return
            }

            const totalSeconds = await getWatchtimeSeconds(client.db, targetLinkedUser, currentChannel)
            const watchtimeLabel = formatWatchtime(totalSeconds)
            const channelLabel = currentChannel === 'glockaucarre' ? 'GlockAuCarre' : 'VitaPvPey'
            const siteSuffix = targetLinkedUser.site_username ? ` (${targetLinkedUser.site_username})` : ''

            await client.sendMessage(
                `Watchtime de @${targetDisplayName}${siteSuffix} depuis le ${WATCHTIME_SINCE_LABEL} sur ${channelLabel}: ${watchtimeLabel}`
            )
        } catch (error) {
            utils.log.error(
                `[${client.username}] Erreur !watchtime pour ${sender?.username || 'unknown'}: ${error?.message || error}`
            )
            await client.sendMessage('Impossible de récupérer ton watchtime pour le moment. Réessaie dans quelques minutes.')
        }
    }
}
