import fetch from 'node-fetch'
import crypto from 'crypto'

const API_BASE_URL = (process.env.BOT_API_BASE_URL || process.env.SITE_BASE_URL || process.env.APP_URL || process.env.BASE_URL || 'https://vitapvpey.com').replace(/\/+$/, '')
const SLOT_CACHE_TTL_MS = 10 * 60 * 1000

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u2060]/g
const MULTI_SPACE_REGEX = /\s+/g

const MESSAGE_NOT_LINKED = 'Tu n\'es pas affilié à la boutique. Pour lier ton compte : https://vitapvpey.com/settings → clique sur “Lier vos comptes”, puis entre le code Rumble dans le chat !'
const MESSAGE_SLOT_NOT_FOUND = '❌ Slot introuvable. Vérifie l\'orthographe et utilise le nom exact (ex: !call "Gates of Olympus").'
const MESSAGE_USAGE = 'ℹ️ Utilisation: !call "Nom exact de la slot"'
const CALL_ALLOWED_CHANNEL = 'vitapvpey'

const slotCache = {
    fetchedAt: 0,
    slotsByName: new Map()
}

let slotsRefreshPromise = null
let cachedSlotIdMaxLength = null

const DEFAULT_SLOT_ID_MAX_LENGTH = 64

const normalizeRows = (result) => {
    if (Array.isArray(result) && Array.isArray(result[0])) return result[0]
    return Array.isArray(result) ? result : []
}

const getSlotIdMaxLength = async (db) => {
    if (cachedSlotIdMaxLength && Number.isInteger(cachedSlotIdMaxLength)) {
        return cachedSlotIdMaxLength
    }

    try {
        const rows = normalizeRows(await db.query(
            `SELECT CHARACTER_MAXIMUM_LENGTH AS maxLen
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'calls'
               AND COLUMN_NAME = 'slotId'
             LIMIT 1`
        ))

        const resolved = Number(rows?.[0]?.maxLen)
        if (Number.isInteger(resolved) && resolved > 0) {
            cachedSlotIdMaxLength = resolved
            return resolved
        }
    } catch {
        // fallback below
    }

    cachedSlotIdMaxLength = DEFAULT_SLOT_ID_MAX_LENGTH
    return cachedSlotIdMaxLength
}

const sanitizeText = (value) => String(value || '')
    .replace(ZERO_WIDTH_REGEX, '')
    .replace(MULTI_SPACE_REGEX, ' ')
    .trim()

const normalizeSlotTitle = (value) => sanitizeText(value).toLowerCase()

const stripSurroundingQuotes = (value) => {
    if (value.length < 2) return value

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1)
    }

    if (value.startsWith('“') && value.endsWith('”')) {
        return value.slice(1, -1)
    }

    return value
}

export const parseSlotName = (message) => {
    const withoutCommand = sanitizeText(String(message || '').replace(/^!\S+/, ''))
    if (!withoutCommand) return null

    const unquoted = sanitizeText(stripSurroundingQuotes(withoutCommand))
    if (!unquoted) return null
    if (unquoted.length > 80) return null

    return unquoted
}

export const isUserLinked = async (client, utils, rumbleUser) => {
    return utils.users.findLinkedByRumble(client.db, rumbleUser?.id, rumbleUser?.username)
}

const extractSlotsFromRow = (row) => {
    if (!row || !row.data) return []

    let parsed
    try {
        parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    } catch {
        return []
    }

    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed?.slots)) return parsed.slots
    if (parsed?.slots && typeof parsed.slots === 'object') return Object.values(parsed.slots)
    return []
}

const fetchSlotsFromDb = async (db) => {
    const rows = normalizeRows(await db.query('SELECT provider, data FROM slots_by_provider'))
    const slots = []

    for (const row of rows) {
        const providerSlots = extractSlotsFromRow(row)
        for (const slot of providerSlots) {
            const name = sanitizeText(slot?.name || slot?.title || slot?.gameName || '')
            if (!name) continue

            slots.push({
                id: String(slot?.id || ''),
                name,
                provider: sanitizeText(row?.provider || slot?.provider || ''),
                slotImage: sanitizeText(slot?.thumbnailUrl || slot?.imageUrl || slot?.image || '')
            })
        }
    }

    return slots
}

const fetchSlotsFromApi = async () => {
    const allSlots = []
    let page = 1
    const limit = 500
    const maxPages = 20

    while (page <= maxPages) {
        const response = await fetch(`${API_BASE_URL}/api/slots?visible=true&limit=${limit}&page=${page}`)
        if (!response.ok) break

        const data = await response.json()
        const pageSlots = Array.isArray(data?.slots) ? data.slots : []
        if (pageSlots.length === 0) break

        for (const slot of pageSlots) {
            const name = sanitizeText(slot?.name || slot?.title || slot?.gameName || '')
            if (!name) continue

            allSlots.push({
                id: String(slot?.id || ''),
                name,
                provider: sanitizeText(slot?.provider || ''),
                slotImage: sanitizeText(slot?.imageUrl || slot?.thumbnailUrl || slot?.image || '')
            })
        }

        const hasNext = Boolean(data?.pagination?.hasNext)
        if (!hasNext) break
        page += 1
    }

    return allSlots
}

const refreshSlotsCache = async (client, utils) => {
    let slots = []

    try {
        slots = await fetchSlotsFromDb(client.db)
    } catch (error) {
        utils.log.error(`[${client.username}] !call slots DB lookup failed: ${error.message}`)
    }

    if (!slots.length) {
        try {
            slots = await fetchSlotsFromApi()
        } catch (error) {
            utils.log.error(`[${client.username}] !call slots API fetch failed: ${error.message}`)
        }
    }

    const byName = new Map()
    for (const slot of slots) {
        const key = normalizeSlotTitle(slot.name)
        if (!key) continue
        if (!byName.has(key)) byName.set(key, slot)
    }

    slotCache.fetchedAt = Date.now()
    slotCache.slotsByName = byName
}

const getSlotsCache = async (client, utils) => {
    const cacheIsFresh = (Date.now() - slotCache.fetchedAt) < SLOT_CACHE_TTL_MS
    if (cacheIsFresh && slotCache.slotsByName.size > 0) return slotCache.slotsByName

    if (!slotsRefreshPromise) {
        slotsRefreshPromise = refreshSlotsCache(client, utils)
            .finally(() => {
                slotsRefreshPromise = null
            })
    }

    await slotsRefreshPromise
    return slotCache.slotsByName
}

export const slotExists = async (slotName, client, utils) => {
    const normalized = normalizeSlotTitle(slotName)
    if (!normalized) return null

    const slots = await getSlotsCache(client, utils)
    return slots.get(normalized) || null
}

export const createCall = async (client, utils, slot, linkedUser, dliveUser) => {
    const userId = String(linkedUser?.user_id || '').trim()
    if (!userId) throw new Error('linked user_id is missing')

    const callId = crypto.randomUUID()
    const slotIdMaxLength = await getSlotIdMaxLength(client.db)
    const slotId = String(slot.id || `dlive-${normalizeSlotTitle(slot.name).replace(/\s+/g, '-')}`).slice(0, slotIdMaxLength)
    const slotName = String(slot.name || '').trim().slice(0, 255)
    const slotProvider = slot.provider ? String(slot.provider).trim().slice(0, 255) : null
    const slotImage = slot.slotImage ? String(slot.slotImage).trim().slice(0, 65535) : null

    if (!slotName) throw new Error('slotName is empty after normalization')

    await client.db.query(
        `DELETE FROM calls WHERE userId = ? AND status = 'pending'`,
        [userId]
    )

    await client.db.query(
        `INSERT INTO calls (id, userId, slot, slotId, slotProvider, slotImage, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
        [callId, userId, slotName, slotId, slotProvider, slotImage]
    )

    utils.log.success(
        `[${client.username}] !call enregistré pour ${dliveUser?.username || 'unknown'} (user_id=${userId}, slot="${slotName}")`
    )
}

export default {
    config: {
        name: 'call',
    },
    run: async (client, utils, args, sender, message) => {
        const currentChannel = String(client?.username || '').trim().toLowerCase()
        if (currentChannel !== CALL_ALLOWED_CHANNEL) return

        if (client.callsEnabled === false) {
            client.sendMessage('❌ Les calls sont actuellement désactivés.')
            return
        }

        const slotName = parseSlotName(message)
        if (!slotName) {
            client.sendMessage(MESSAGE_USAGE)
            return
        }

        try {
            const [linkedUser, slot] = await Promise.all([
                isUserLinked(client, utils, sender),
                slotExists(slotName, client, utils),
            ])

            if (!linkedUser) {
                client.sendMessage(MESSAGE_NOT_LINKED)
                return
            }

            if (!slot) {
                client.sendMessage(MESSAGE_SLOT_NOT_FOUND)
                return
            }

            await createCall(client, utils, slot, linkedUser, sender)

            const pseudo = sender?.displayname || sender?.username || 'Utilisateur'
            client.sendMessage(`Ton call "${slot.name}" a bien été pris en compte @${pseudo}, visible sur : https://vitapvpey.com/slot-call ✅`)
        } catch (error) {
            utils.log.error(
                `[${client.username}] Erreur !call pour ${sender?.username || 'unknown'} (${sender?.id || 'unknown'}): ${error.message}`
            )
        }
    }
}


