import chalk from 'chalk'

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

function getSequenceForChannel(channelName) {
    const key = `AUTO_MESSAGES_${channelName.toUpperCase()}`
    const raw = String(process.env[key] || process.env.AUTO_MESSAGES || '').trim()
    return parseSequence(raw)
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
 * Returns a stop() function.
 */
export function startAutoMessages(client, channelName) {
    const sequence = getSequenceForChannel(channelName)

    if (sequence.length === 0) return () => {}

    log(channelName, chalk.green(`${sequence.length} message(s) automatique(s) configuré(s)`))
    sequence.forEach((entry, i) => {
        log(channelName, chalk.gray(`  [${i + 1}] "${entry.message}" → attente ${entry.delaySeconds}s`))
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

    // Start after the delay of the first entry so it doesn't fire immediately on boot
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
