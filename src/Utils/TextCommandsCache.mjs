import fetch from 'node-fetch'
import chalk from 'chalk'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 8_000

let cachedCommands = []

const getApiUrl = () => {
    const base = String(process.env.SITE_BASE_URL || process.env.APP_URL || '').replace(/\/$/, '')
    if (!base) return null
    return `${base}/api/v1/integrations/bot/text-commands`
}

const getBotSecret = () => String(process.env.BOT_SECRET || '').trim()

export const refreshTextCommandsCache = async () => {
    const url = getApiUrl()
    const secret = getBotSecret()
    if (!url || !secret) return

    try {
        const response = await fetch(url, {
            headers: { 'X-BOT-SECRET': secret, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })

        if (!response.ok) return

        const json = await response.json().catch(() => null)
        if (Array.isArray(json?.data)) {
            cachedCommands = json.data
            console.log(
                chalk.gray('[') + chalk.blue('TextCmds') + chalk.gray(']'),
                chalk.white(`${cachedCommands.length} commande(s) chargee(s)`)
            )
        }
    } catch {
        // silencieux — le bot fonctionne sans si l'API est injoignable
    }
}

export const findCachedTextCommand = (trigger, channelKey) => {
    const t = String(trigger || '').trim().toLowerCase()
    const ck = String(channelKey || '').trim().toLowerCase() || null

    // Priorité : commande spécifique au channel > commande globale
    const specific = cachedCommands.find((cmd) => cmd.trigger === t && cmd.channelKey === ck)
    if (specific) return specific

    return cachedCommands.find((cmd) => cmd.trigger === t && cmd.channelKey === null) ?? null
}

export const initTextCommandsCache = async () => {
    await refreshTextCommandsCache()
    setInterval(() => { void refreshTextCommandsCache() }, REFRESH_INTERVAL_MS)
}
