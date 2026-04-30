import chalk from 'chalk'
import pg from 'pg'

const { Pool } = pg

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

let cachedCommands = []
let pool = null

const getPool = () => {
    if (pool) return pool

    const host = process.env.PG_HOST || process.env.DB_HOST || null
    const port = Number(process.env.PG_PORT || process.env.DB_PORT || 5432)
    const user = process.env.PG_USER || process.env.DB_USER || null
    const password = process.env.PG_PASSWORD || process.env.DB_PASSWORD || process.env.DB_PASS || null
    const database = process.env.PG_DATABASE || process.env.DB_DATABASE || process.env.DB_NAME || null

    if (!host || !user || !password || !database) return null

    pool = new Pool({ host, port, user, password, database, max: 3, idleTimeoutMillis: 30000 })
    return pool
}

export const refreshTextCommandsCache = async () => {
    const client = getPool()
    if (!client) {
        console.warn(
            chalk.gray('[') + chalk.yellow('TextCmds') + chalk.gray(']'),
            chalk.yellow('Variables PG manquantes (PG_HOST/DB_HOST, PG_USER/DB_USER, PG_PASSWORD/DB_PASSWORD, PG_DATABASE/DB_DATABASE)')
        )
        return
    }

    try {
        const result = await client.query(
            'SELECT trigger, response_text AS "responseText", channel_key AS "channelKey", cooldown_seconds AS "cooldownSeconds", allow_placeholders AS "allowPlaceholders" FROM bot_text_commands WHERE is_enabled = true ORDER BY trigger ASC'
        )
        cachedCommands = result.rows
        console.log(
            chalk.gray('[') + chalk.blue('TextCmds') + chalk.gray(']'),
            chalk.white(`${cachedCommands.length} commande(s) chargee(s)`)
        )
    } catch (err) {
        console.warn(
            chalk.gray('[') + chalk.yellow('TextCmds') + chalk.gray(']'),
            chalk.yellow(`Echec chargement commandes: ${err?.message || err}`)
        )
    }
}

export const findCachedTextCommand = (trigger, channelKey) => {
    const t = String(trigger || '').trim().toLowerCase()
    const ck = String(channelKey || '').trim().toLowerCase() || null

    const specific = cachedCommands.find((cmd) => cmd.trigger === t && cmd.channelKey === ck)
    if (specific) return specific

    return cachedCommands.find((cmd) => cmd.trigger === t && cmd.channelKey === null) ?? null
}

export const initTextCommandsCache = async () => {
    await refreshTextCommandsCache()
    setInterval(() => { void refreshTextCommandsCache() }, REFRESH_INTERVAL_MS)
}
