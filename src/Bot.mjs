import 'dotenv/config'
import chalk from 'chalk'
import express from 'express'

import { RumbleChatClient } from './rumble/RumbleChatClient.mjs'
import Database from './Utils/Database.mjs'
import Functions from './Utils/Functions.mjs'
import Handler from './Utils/Handler.mjs'
import { executeDbCommandIfEligible, normalizeChannelKey } from './Utils/DbCommands.mjs'
import { siteApi } from './services/siteApi.mjs'

// ─── Watchtime tracking ───────────────────────────────────────────────────────

const WATCHTIME_CHANNELS = new Set(['vitapvpey', 'glockaucarre'])
const MAX_WINDOW_SECONDS = 600
const SITE_RELAY_ENABLED = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.RUMBLE_SITE_RELAY_ENABLED || process.env.SITE_CHAT_RELAY_ENABLED || 'true')
        .trim()
        .toLowerCase()
)

const normalizeWtRows = (result) => {
    if (Array.isArray(result) && Array.isArray(result[0])) return result[0]
    return Array.isArray(result) ? result : []
}

async function trackRumbleWatchtime(db, sender, channelName) {
    if (!WATCHTIME_CHANNELS.has(channelName)) return
    if (!sender?.id && !sender?.username) return

    // Trouver l'utilisateur lié via rumble_id ou rumble_username
    let linkedUser = null
    if (sender?.id) {
        const rows = normalizeWtRows(await db.query(
            `SELECT user_id FROM balances WHERE rumble_id = ? LIMIT 1`, [sender.id]
        ).catch(() => []))
        if (rows[0]) linkedUser = rows[0]
    }
    if (!linkedUser && sender?.username) {
        const rows = normalizeWtRows(await db.query(
            `SELECT user_id FROM balances WHERE LOWER(rumble_username) = LOWER(?) LIMIT 1`, [sender.username]
        ).catch(() => []))
        if (rows[0]) linkedUser = rows[0]
    }
    if (!linkedUser) return

    const userId = String(linkedUser.user_id || '').trim()
    if (!userId) return

    const now = new Date()

    // Upsert watchtime
    const rows = normalizeWtRows(await db.query(
        `SELECT id, total_seconds, last_activity_at, last_counted_at FROM dlive_watchtime WHERE user_id = ? AND channel_name = ? LIMIT 1`,
        [userId, channelName]
    ))

    if (!rows[0]) {
        await db.query(
            `INSERT INTO dlive_watchtime (user_id, dlive_username, channel_name, total_seconds, last_activity_at, last_counted_at) VALUES (?, ?, ?, 0, ?, ?)`,
            [userId, null, channelName, now, now]
        ).catch(() => {})
        return
    }

    const row = rows[0]
    const total = Number(row.total_seconds || 0)
    const lastActivity = row.last_activity_at ? new Date(row.last_activity_at) : null
    const lastCounted = row.last_counted_at ? new Date(row.last_counted_at) : lastActivity

    let added = 0
    if (lastActivity && lastCounted) {
        const maxEligible = new Date(lastActivity.getTime() + MAX_WINDOW_SECONDS * 1000)
        const nextCounted = now < maxEligible ? now : maxEligible
        added = Math.max(0, Math.min(Math.floor((nextCounted - lastCounted) / 1000), MAX_WINDOW_SECONDS))
    }

    await db.query(
        `UPDATE dlive_watchtime SET total_seconds = ?, last_activity_at = ?, last_counted_at = ? WHERE id = ?`,
        [total + added, now, now, row.id]
    ).catch(() => {})
}

function buildRelayMessageId(msg, sender, message) {
    const rawId = String(msg?._raw?.id || '').trim()
    if (rawId) return rawId

    const createdOn = String(msg?._raw?.created_on || msg?._raw?.time || '').trim()
    if (createdOn) {
        return `${createdOn}:${String(sender?.id || sender?.username || 'viewer').trim()}`
    }

    const fallbackContent = String(message || '').trim().slice(0, 80)
    return `${Date.now()}:${String(sender?.id || sender?.username || 'viewer').trim()}:${fallbackContent}`
}

function buildRelayTimestamp(msg) {
    const raw = String(msg?._raw?.created_on || msg?._raw?.time || '').trim()
    if (!raw) return new Date().toISOString()

    const date = new Date(raw)
    if (!Number.isFinite(date.getTime())) return new Date().toISOString()
    return date.toISOString()
}

function relayRumbleMessageToSite({ channelName, sender, message, msg }) {
    if (!SITE_RELAY_ENABLED) return

    void siteApi
        .relayRumbleMessage({
            channelSlug: String(channelName || '').trim().toLowerCase(),
            messageId: buildRelayMessageId(msg, sender, message),
            message,
            rumbleId: sender?.id || null,
            rumbleUsername: sender?.username || null,
            rumbleDisplayName: sender?.displayname || sender?.username || null,
            createdAt: buildRelayTimestamp(msg),
        })
        .catch((error) => {
            console.warn(
                chalk.gray('[') + chalk.yellow('Relay') + chalk.gray(']'),
                chalk.yellow(`Echec du relay site: ${error?.message || error}`)
            )
        })
}

// ─── Base de données et commandes partagées ───────────────────────────────────

const sharedDb = new Database()
const sharedCommands = new Map()
const internalAdminApp = express()
const INTERNAL_ADMIN_PORT = Math.max(1, Number(process.env.RUMBLE_BOT_HTTP_PORT || process.env.BOT_HTTP_PORT || 4010))
const INTERNAL_ADMIN_TOKEN = String(
    process.env.RUMBLE_BOT_CONTROL_TOKEN ||
    process.env.BOT_CONTROL_TOKEN ||
    process.env.BOT_SECRET ||
    ''
).trim()

internalAdminApp.use(express.json())

const parseBearerToken = (authorizationHeader) => {
    const raw = String(authorizationHeader || '').trim()
    if (!raw.toLowerCase().startsWith('bearer ')) return ''
    return raw.slice(7).trim()
}

const assertInternalAdminToken = (req, res) => {
    if (!INTERNAL_ADMIN_TOKEN) {
        res.status(500).json({ ok: false, error: 'BOT_CONTROL_TOKEN missing' })
        return false
    }

    const token = parseBearerToken(req.headers.authorization)
    if (!token || token !== INTERNAL_ADMIN_TOKEN) {
        res.status(401).json({ ok: false, error: 'Unauthorized' })
        return false
    }

    return true
}

const buildInternalSender = () => ({
    id: 'internal-admin',
    username: String(process.env.BOT_CONTROL_SENDER_USERNAME || 'vitabot').trim().toLowerCase() || 'vitabot',
    displayname: 'Admin Control',
})

const normalizeInternalChannelSlug = (value) => String(value || '').trim().toLowerCase()

const buildInternalCommandMessage = (commandName, args) => {
    const normalizedArgs = Array.isArray(args) ? args.map((entry) => String(entry).trim()).filter(Boolean) : []
    return normalizedArgs.length > 0 ? `!${commandName} ${normalizedArgs.join(' ')}` : `!${commandName}`
}

// ─── État indépendant par chaîne ─────────────────────────────────────────────

function createChannelState() {
    return {
        callsEnabled: true,
        recentMessages: [],
        raffleListIds: [],
        raffleList: [],
        raffleRunning: false,
        raffleTimers: [],
        raffleCaissesListIds: [],
        raffleCaissesList: [],
        raffleCaissesRunning: false,
        raffleCaissesTimers: [],
        activeTokenRaffleId: null,
        activeCaseRaffleId: null,
        lastClosedCaseRaffleId: null,
        joinRateLimiter: new Map(),
        claimRateLimiter: new Map(),
        betentires: { first: [], second: [] },
        bets: { first: { running: false }, second: { running: false } },
        dbCommandCooldowns: new Map(),
    }
}

// ─── Setup d'un client Rumble ─────────────────────────────────────────────────

function setupClient(client, channelName) {
    const state = createChannelState()

    client.db       = sharedDb
    client.commands = sharedCommands
    client.platform = 'rumble'

    Object.assign(client, {
        raffleListIds:           state.raffleListIds,
        raffleList:              state.raffleList,
        raffleRunning:           state.raffleRunning,
        recentMessages:          state.recentMessages,
        raffleTimers:            state.raffleTimers,
        callsEnabled:            state.callsEnabled,
        raffleCaissesListIds:    state.raffleCaissesListIds,
        raffleCaissesList:       state.raffleCaissesList,
        raffleCaissesRunning:    state.raffleCaissesRunning,
        raffleCaissesTimers:     state.raffleCaissesTimers,
        activeTokenRaffleId:     state.activeTokenRaffleId,
        activeCaseRaffleId:      state.activeCaseRaffleId,
        lastClosedCaseRaffleId:  state.lastClosedCaseRaffleId,
        joinRateLimiter:         state.joinRateLimiter,
        claimRateLimiter:        state.claimRateLimiter,
        betentires:              state.betentires,
        bets:                    state.bets,
        dbCommandCooldowns:      state.dbCommandCooldowns,
        channelName:             String(channelName || '').trim().toLowerCase(),
    })

    client.on('connected', () => {
        console.log(
            chalk.gray('[') + chalk.green(channelName) + chalk.gray(']'),
            chalk.green('✅ Rumble connecté!')
        )
    })

    client.on('error', (err) => {
        console.log(
            chalk.gray('[') + chalk.red(channelName) + chalk.gray(']'),
            chalk.red('❌ Erreur:'), err?.message || err
        )
    })

    client.on('disconnected', () => {
        console.log(
            chalk.gray('[') + chalk.yellow(channelName) + chalk.gray(']'),
            chalk.yellow('⚠️ Déconnecté de Rumble')
        )
    })

    client.on('message', async (msg) => {
        const prefix = '!'
        const channelKey = normalizeChannelKey(channelName || client.username)
        const normalizedChannelName = String(channelName || client.username || '').trim().toLowerCase()

        const sender  = msg.sender
        const message = msg.content

        console.log(
            chalk.gray('[') + chalk.cyan(channelName) + chalk.gray(']'),
            `[rumble] ${sender?.username}: ${message}`
        )

        if (!message || message.length === 0) return

        relayRumbleMessageToSite({
            channelName: normalizedChannelName,
            sender,
            message,
            msg,
        })

        if (!Array.isArray(client.recentMessages)) client.recentMessages = []
        client.recentMessages.push({
            id: sender?.id ?? null,
            username: String(sender?.username || '').trim(),
            content: message,
            createdAt: Date.now(),
        })
        if (client.recentMessages.length > 20) {
            client.recentMessages.splice(0, client.recentMessages.length - 20)
        }

        // Track watchtime pour les chaînes suivies
        if (!message.startsWith(prefix)) {
            try {
                await trackRumbleWatchtime(sharedDb, sender, normalizedChannelName)
            } catch (wtErr) {
                // silencieux
            }
        }

        if (!message.startsWith(prefix)) return

        const messageArray = message.trim().split(/\s+/)
        const command      = messageArray[0].substring(1).toLowerCase()
        const args         = messageArray.slice(1)

        console.log(
            chalk.gray('[') + chalk.cyan(channelName) + chalk.gray(']'),
            `Commande détectée: !${command}`
        )

        const hasHardcodedCommand = Boolean(client.commands.get(command))

        try {
            const executedDbCommand = await executeDbCommandIfEligible({
                client,
                trigger: command,
                sender,
                channelName,
                channelKey,
                hasHardcodedCommand,
            })
            if (executedDbCommand) return
        } catch (dbCommandError) {
            console.error(
                chalk.gray('[') + chalk.red(channelName) + chalk.gray(']'),
                chalk.red('Erreur DB command:'), dbCommandError?.message || dbCommandError
            )
        }

        if (hasHardcodedCommand) {
            const commandFile = client.commands.get(command)
            console.log(
                chalk.gray('[') + chalk.cyan(channelName) + chalk.gray(']'),
                `Execution: !${command}`
            )
            try {
                await commandFile.run(client, Functions, args, sender, message)
            } catch (commandError) {
                console.error(
                    chalk.gray('[') + chalk.red(channelName) + chalk.gray(']'),
                    chalk.red(`Erreur !${command}:`), commandError?.message || commandError
                )
            }
        } else {
            console.log(
                chalk.gray('[') + chalk.cyan(channelName) + chalk.gray(']'),
                chalk.red(`Commande inconnue: !${command}`)
            )
        }
    })

    console.log(
        chalk.gray('[') + chalk.magenta('Bot') + chalk.gray(']'),
        chalk.yellow(`Connexion au chat Rumble: ${channelName}...`)
    )

    return client.connect()
}

// ─── Channels Rumble configurés ───────────────────────────────────────────────

const SESSION_COOKIE = process.env.RUMBLE_SESSION_COOKIE
const CHANNEL_ID     = process.env.RUMBLE_CHANNEL_ID ? parseInt(process.env.RUMBLE_CHANNEL_ID, 10) : null

if (!SESSION_COOKIE) {
    console.error(chalk.red('[Bot] RUMBLE_SESSION_COOKIE manquant dans .env — impossible de démarrer.'))
    process.exit(1)
}

const CHANNELS = [
    {
        name:       'vitapvpey',
        streamId:   process.env.RUMBLE_STREAM_ID_VITAPVPEY   || null,
        chatId:     process.env.RUMBLE_CHAT_ID_VITAPVPEY     || null,
        liveApiUrl: process.env.RUMBLE_LIVE_API_URL_VITAPVPEY || null,
    },
    {
        name:       'kafie',
        streamId:   process.env.RUMBLE_STREAM_ID_KAFIE        || null,
        chatId:     process.env.RUMBLE_CHAT_ID_KAFIE          || null,
        liveApiUrl: process.env.RUMBLE_LIVE_API_URL_KAFIE      || null,
    },
    {
        name:       'glockaucarre',
        streamId:   process.env.RUMBLE_STREAM_ID_GLOCKAUCARRE  || null,
        chatId:     process.env.RUMBLE_CHAT_ID_GLOCKAUCARRE    || null,
        liveApiUrl: process.env.RUMBLE_LIVE_API_URL_GLOCKAUCARRE || null,
    },
].filter((ch) => ch.streamId || ch.liveApiUrl) // n'active que les chaînes configurées

if (CHANNELS.length === 0) {
    console.warn(chalk.yellow('[Bot] Aucune chaîne Rumble configurée. Renseigne au moins un RUMBLE_STREAM_ID_* ou RUMBLE_LIVE_API_URL_* dans .env'))
}

// Créer et connecter les clients
const clients = CHANNELS.map((ch) =>
    new RumbleChatClient({
        sessionCookie: SESSION_COOKIE,
        streamId:      ch.streamId,
        chatId:        ch.chatId,
        channelId:     CHANNEL_ID,
        username:      ch.name,
        liveApiUrl:    ch.liveApiUrl,
    })
)

const clientsMap = Object.fromEntries(clients.map((c) => [c.username, c]))

internalAdminApp.get('/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'rumblebot',
        channels: Object.keys(clientsMap),
        commandsLoaded: sharedCommands.size,
        updatedAt: new Date().toISOString(),
    })
})

internalAdminApp.post('/internal/admin/commands/execute', async (req, res) => {
    if (!assertInternalAdminToken(req, res)) return

    try {
        const channelSlug = normalizeInternalChannelSlug(req.body?.channelSlug)
        const commandName = String(req.body?.commandName || '').trim().toLowerCase()
        const args = Array.isArray(req.body?.args) ? req.body.args.map((entry) => String(entry).trim()).filter(Boolean) : []

        if (!channelSlug) {
            return res.status(400).json({ ok: false, error: 'channelSlug is required' })
        }

        if (!commandName) {
            return res.status(400).json({ ok: false, error: 'commandName is required' })
        }

        if (sharedCommands.size === 0) {
            return res.status(503).json({ ok: false, error: 'Commands are still loading' })
        }

        const client = clientsMap[channelSlug]
        if (!client) {
            return res.status(404).json({ ok: false, error: `Unknown channel: ${channelSlug}` })
        }

        const command = sharedCommands.get(commandName)
        if (!command || typeof command.run !== 'function') {
            return res.status(404).json({ ok: false, error: `Unknown command: ${commandName}` })
        }

        const sender = buildInternalSender()
        const rawMessage = buildInternalCommandMessage(commandName, args)

        console.log(
            chalk.gray('[') + chalk.magenta('Admin API') + chalk.gray(']'),
            chalk.white(`Execution ${rawMessage} sur ${channelSlug}`)
        )

        await command.run(client, Functions, args, sender, rawMessage)

        return res.json({
            ok: true,
            platform: 'RUMBLE',
            channelSlug,
            commandName,
            args,
            executedMessage: rawMessage,
            updatedAt: new Date().toISOString(),
        })
    } catch (error) {
        console.error(
            chalk.gray('[') + chalk.red('Admin API') + chalk.gray(']'),
            chalk.red('Erreur commande interne:'), error?.message || error
        )
        return res.status(500).json({
            ok: false,
            error: error?.message || 'Internal command execution failed',
        })
    }
})

// ─── Chargement des commandes puis connexion ──────────────────────────────────

await Handler.command(sharedCommands)

await Promise.all(clients.map((client) => setupClient(client, client.username)))

internalAdminApp
    .listen(INTERNAL_ADMIN_PORT, () => {
        console.log(
            chalk.gray('[') + chalk.magenta('Admin API') + chalk.gray(']'),
            chalk.green(`Rumble admin API disponible sur http://127.0.0.1:${INTERNAL_ADMIN_PORT}`)
        )
    })
    .on('error', (error) => {
        console.error(
            chalk.gray('[') + chalk.red('Admin API') + chalk.gray(']'),
            chalk.red(`Port ${INTERNAL_ADMIN_PORT} indisponible:`), error?.message || error
        )
    })

console.log(
    chalk.gray('[') + chalk.magenta('Bot') + chalk.gray(']'),
    chalk.green(`✅ Rumble Bot démarré — ${clients.length} chaîne(s) active(s)`)
)
