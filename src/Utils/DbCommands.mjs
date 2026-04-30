const DB_COMMAND_MAX_LENGTH = 500
const TRIGGER_REGEX = /^[a-z0-9_]{2,24}$/
const ALLOWED_CHANNEL_KEYS = new Set(['kafie', 'vitapvpey', 'glockaucarre'])

const normalizeRows = (result) => {
    if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0])) return result[0]
    return Array.isArray(result) ? result : []
}

const toPositiveInt = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return Math.floor(parsed)
}

export const normalizeChannelKey = (value) => {
    const key = String(value || '').trim().toLowerCase()
    if (ALLOWED_CHANNEL_KEYS.has(key)) return key
    return key || null
}

const sanitizeMessage = (text) => {
    return String(text || '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, DB_COMMAND_MAX_LENGTH)
}

const applyPlaceholders = (template, context) => {
    const placeholders = {
        '{username}': context.username || 'viewer',
        '{channel}': context.channel || '',
        '{url_settings}': 'https://vitapvpey.com/settings',
        '{newline}': '\n',
    }
    return Object.entries(placeholders).reduce((output, [token, value]) => output.split(token).join(value), template)
}

const shouldThrottle = (client, command, now, channelKey) => {
    const cooldownSeconds = toPositiveInt(command.cooldown_seconds)
    if (cooldownSeconds <= 0) return false

    const triggerValue = command.command_trigger || command.trigger
    const key = `${channelKey || client.username}:${triggerValue}`
    const lastExecutionAt = client.dbCommandCooldowns.get(key) || 0

    if (now - lastExecutionAt < cooldownSeconds * 1000) return true
    client.dbCommandCooldowns.set(key, now)
    return false
}

export const findDbCommand = async (client, trigger, channelKey) => {
    if (!TRIGGER_REGEX.test(trigger)) return null

    try {
        const result = await client.db.query(
            `SELECT \`trigger\` AS command_trigger, response_text, is_enabled, cooldown_seconds, allow_placeholders, override_hardcoded, scope, channel_key
             FROM dlive_chat_commands
             WHERE \`trigger\` = ?
               AND is_enabled = 1
               AND (
                 (platform = 'rumble' AND scope = 'CHANNEL' AND channel_key = ?)
                 OR (platform = 'dlive'  AND scope = 'CHANNEL' AND channel_key = ?)
                 OR (platform = 'rumble' AND scope = 'GLOBAL'  AND channel_key IS NULL)
                 OR (platform = 'dlive'  AND scope = 'GLOBAL'  AND channel_key IS NULL)
               )
             ORDER BY
               CASE
                 WHEN platform = 'rumble' AND scope = 'CHANNEL' THEN 1
                 WHEN platform = 'dlive'  AND scope = 'CHANNEL' THEN 2
                 WHEN platform = 'rumble' AND scope = 'GLOBAL'  THEN 3
                 ELSE 4
               END
             LIMIT 1`,
            [trigger, channelKey, channelKey]
        )
        return normalizeRows(result)[0] ?? null
    } catch (error) {
        if (error?.code === 'ER_NO_SUCH_TABLE') return null
        if (error?.code === 'ER_BAD_FIELD_ERROR') return null
        throw error
    }
}

export const executeDbCommandIfEligible = async ({ client, trigger, sender, channelName, channelKey, hasHardcodedCommand }) => {
    const normalizedChannelKey = normalizeChannelKey(channelKey || channelName || client?.username)
    const dbCommand = await findDbCommand(client, trigger, normalizedChannelKey)
    if (!dbCommand) return false

    const overrideHardcoded =
        dbCommand.override_hardcoded === 1 ||
        dbCommand.override_hardcoded === true ||
        dbCommand.override_hardcoded === '1'

    if (hasHardcodedCommand && !overrideHardcoded) return false

    const now = Date.now()
    if (shouldThrottle(client, dbCommand, now, normalizedChannelKey)) return true

    const allowPlaceholders =
        dbCommand.allow_placeholders === 1 ||
        dbCommand.allow_placeholders === true ||
        dbCommand.allow_placeholders === '1'

    let response = sanitizeMessage(dbCommand.response_text)
    if (!response) return true

    if (allowPlaceholders) {
        response = applyPlaceholders(response, {
            username: sender?.username || 'viewer',
            channel: normalizedChannelKey || channelName || client.username,
        })
    }

    if (!response) return true

    await client.sendMessage(response)
    console.log(`[${channelName}] DB command: ${trigger}`)
    return true
}
