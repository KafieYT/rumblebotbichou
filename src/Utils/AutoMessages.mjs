import chalk from 'chalk'
import { siteApi } from '../services/siteApi.mjs'

/**
 * Parse env var format: "msg1:30,msg2:45,msg3:60"
 * Returns [{ message, delaySeconds }]
 */
function parseSequence(raw) {
    if (!raw || !raw.trim()) return []

    return raw
        .split(',')
        .map((entry) => {
            const trimmed = entry.trim()
            const lastColon = trimmed.lastIndexOf(':')
            if (lastColon === -1) return null

            const message = trimmed.slice(0, lastColon).trim()
            const delay = parseInt(trimmed.slice(lastColon + 1).trim(), 10)

            if (!message || !Number.isFinite(delay) || delay <= 0) return null
            return { message, delaySeconds: delay }
        })
        .filter(Boolean)
}

function getEnvSequenceForChannel(channelName) {
    const key = `AUTO_MESSAGES_${channelName.toUpperCase()}`
    const raw = String(process.env[key] || process.env.AUTO_MESSAGES || '').trim()
    return parseSequence(raw)
}

export async function fetchRemoteAutoConfig() {
    try {
        const res = await siteApi.getAutoMessagesConfig()
        if (res?.config && typeof res.config === 'object') {
            return res.config
        }
    } catch {
        // silencieux — fallback env vars
    }
    return null
}

function log(channelName, text) {
    console.log(
        chalk.gray('[') + chalk.magenta('AutoMsg') + chalk.gray(']'),
        chalk.gray('[') + chalk.cyan(channelName) + chalk.gray(']'),
        text
    )
}

/**
 * Start the auto-message loop for a single client/channel.
 * remoteConfig: result of fetchRemoteAutoConfig() — null means use env vars.
 * Returns a stop() function.
 */
export function startAutoMessages(client, channelName, remoteConfig = null) {
    let sequence = null

    if (remoteConfig !== null) {
        const entries = remoteConfig[channelName.toLowerCase()]
        if (Array.isArray(entries) && entries.length > 0) {
            sequence = entries.filter(
                (e) => e?.message?.trim() && Number.isFinite(e?.delaySeconds) && e.delaySeconds > 0
            )
        }
    }

    if (!sequence) {
        sequence = getEnvSequenceForChannel(channelName)
    }

    if (sequence.length === 0) return () => {}

    const src = remoteConfig !== null ? 'panel admin' : 'env vars'
    log(channelName, chalk.green(`${sequence.length} message(s) automatique(s) [${src}]`))
    sequence.forEach((entry, i) => {
        log(channelName, chalk.gray(`  [${i + 1}] "${entry.message}" → ${entry.delaySeconds}s`))
    })

    let stopped = false
    let currentTimer = null
    let index = 0

    const tick = async () => {
        if (stopped) return

        const entry = sequence[index]
        index = (index + 1) % sequence.length

        if (client._connected) {
            try {
                await client.sendMessage(entry.message)
                log(channelName, chalk.white(`Envoi: "${entry.message}"`))
            } catch (err) {
                log(channelName, chalk.yellow(`Echec envoi: ${err?.message || err}`))
            }
        } else {
            log(channelName, chalk.yellow(`Client déconnecté, message ignoré: "${entry.message}"`))
        }

        if (!stopped) {
            currentTimer = setTimeout(tick, entry.delaySeconds * 1000)
        }
    }

    currentTimer = setTimeout(tick, sequence[0].delaySeconds * 1000)

    return () => {
        stopped = true
        if (currentTimer) {
            clearTimeout(currentTimer)
            currentTimer = null
        }
        log(channelName, chalk.yellow('Auto-messages arrêtés'))
    }
}
