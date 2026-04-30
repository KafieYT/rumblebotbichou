import { EventEmitter } from 'events'
import fetch from 'node-fetch'
import { randomBytes } from 'crypto'
import chalk from 'chalk'

const RUMBLE_CHAT_HOST = 'https://web7.rumble.com'
const POLL_INTERVAL_MS = 500
const SSE_RECONNECT_DELAY_MS = 5_000
const SEND_TIMEOUT_MS = 20_000

function generateRequestId() {
    return randomBytes(16).toString('hex')
}

function toBase10ChatId(value) {
    const raw = String(value || '').trim().toLowerCase()
    if (!raw) return null
    if (!/^[a-z0-9]+$/.test(raw)) return null

    const parsed = parseInt(raw, 36)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return String(parsed)
}

async function fetchLiveApiPayload(liveApiUrl) {
    const res = await fetch(liveApiUrl, {
        headers: { Accept: 'application/json', 'User-Agent': 'DLiveBot/1.0' },
        signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
        throw new Error(`Live API HTTP ${res.status}`)
    }

    return res.json()
}

function getActiveLivestream(payload) {
    const livestreams = Array.isArray(payload?.livestreams) ? payload.livestreams : []
    const active = livestreams.find((item) => item?.is_live === true)
    return active ?? livestreams[0] ?? null
}

async function resolveLiveTarget(liveApiUrl) {
    const payload = await fetchLiveApiPayload(liveApiUrl)
    const livestream = getActiveLivestream(payload)
    const activeStreamId = String(livestream?.id || '').trim()
    const activeChatId = toBase10ChatId(activeStreamId)

    return {
        payload,
        livestream,
        activeStreamId: activeStreamId || null,
        activeChatId,
    }
}

function normalizeRumbleMessage(msg) {
    const username = String(msg?.username || '').trim()
    const content = String(msg?.text || '').trim()
    const createdOn = String(msg?.created_on || '').trim()

    if (!username || !content || !createdOn) return null

    return {
        key: `${createdOn}::${username.toLowerCase()}::${content}`,
        value: {
            type: 'Message',
            sender: {
                id: username,
                username,
                displayname: username,
            },
            content,
            _raw: msg,
        },
    }
}

export class RumbleChatClient extends EventEmitter {
    /**
     * @param {{ sessionCookie: string, streamId?: string|null, chatId?: string|null, channelId?: number|null, username: string, liveApiUrl?: string|null }}
     */
    constructor({ sessionCookie, streamId = null, chatId = null, channelId = null, username, liveApiUrl = null }) {
        super()
        this.sessionCookie = sessionCookie
        this.streamId = streamId ? String(streamId).trim() : null
        this.chatId = chatId ? String(chatId).trim() : null
        this.channelId = channelId
        this.username = username
        this.platform = 'rumble'
        this.liveApiUrl = liveApiUrl || null
        this._connected = false
        this._abortController = null
        this._reconnectTimer = null
        this._pollTimer = null
        this._shouldReconnect = true
        this._activeStreamId = this.streamId
        this._activeChatId = this.chatId || toBase10ChatId(this.streamId)
        this._seenMessageKeys = new Set()
        this._liveApiInitialized = false
    }

    get connected() {
        return this._connected
    }

    async connect() {
        this._shouldReconnect = true

        if (this.liveApiUrl) {
            try {
                const target = await resolveLiveTarget(this.liveApiUrl)
                this._activeStreamId = target.activeStreamId
                this._activeChatId = this.chatId || target.activeChatId

                if (this._activeChatId) {
                    await this._startSSE()
                    return
                }
            } catch (err) {
                this.emit('error', err)
            }

            await this._startLiveApiPolling()
            return
        }

        await this._startSSE()
    }

    disconnect() {
        this._shouldReconnect = false

        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer)
            this._reconnectTimer = null
        }

        if (this._pollTimer) {
            clearTimeout(this._pollTimer)
            this._pollTimer = null
        }

        if (this._abortController) {
            this._abortController.abort()
            this._abortController = null
        }

        if (this._connected) {
            this._connected = false
            this.emit('disconnected')
        }
    }

    async _startLiveApiPolling() {
        const tick = async () => {
            if (!this._shouldReconnect) return

            try {
                const { livestream, activeStreamId, activeChatId } = await resolveLiveTarget(this.liveApiUrl)

                if (!activeStreamId) {
                    this._activeStreamId = null
                    this._activeChatId = this.chatId || null
                    if (this._connected) {
                        this._connected = false
                        this.emit('disconnected')
                    }

                    console.log(
                        chalk.gray('[') + chalk.yellow('Rumble:' + this.username) + chalk.gray(']'),
                        chalk.yellow('Aucun streamId disponible, retry dans 30s...')
                    )

                    this._pollTimer = setTimeout(tick, 30_000)
                    return
                }

                this._activeStreamId = activeStreamId
                this._activeChatId = this.chatId || activeChatId

                if (!this._connected) {
                    this._connected = true
                    this.emit('connected')
                }

                const recentMessages = Array.isArray(livestream?.chat?.recent_messages)
                    ? livestream.chat.recent_messages
                    : []

                if (!this._liveApiInitialized) {
                    for (const rawMessage of recentMessages) {
                        const normalized = normalizeRumbleMessage(rawMessage)
                        if (!normalized) continue
                        this._seenMessageKeys.add(normalized.key)
                    }
                    this._liveApiInitialized = true
                    this._pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
                    return
                }

                for (const rawMessage of recentMessages) {
                    const normalized = normalizeRumbleMessage(rawMessage)
                    if (!normalized) continue
                    if (this._seenMessageKeys.has(normalized.key)) continue

                    this._seenMessageKeys.add(normalized.key)
                    this.emit('message', normalized.value)
                }

                // Keep a bounded dedupe set to avoid unbounded growth.
                if (this._seenMessageKeys.size > 500) {
                    const keys = Array.from(this._seenMessageKeys)
                    this._seenMessageKeys = new Set(keys.slice(-250))
                }

                this._pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
            } catch (err) {
                this.emit('error', err)

                if (this._connected) {
                    this._connected = false
                    this.emit('disconnected')
                }

                this._pollTimer = setTimeout(tick, 15_000)
            }
        }

        await tick()
    }

    async _startSSE() {
        if (!this._activeChatId && this.liveApiUrl) {
            try {
                const target = await resolveLiveTarget(this.liveApiUrl)
                this._activeStreamId = target.activeStreamId
                this._activeChatId = this.chatId || target.activeChatId
            } catch (err) {
                this.emit('error', err)
            }
        }

        const chatId = this.chatId || this._activeChatId || toBase10ChatId(this._activeStreamId || this.streamId)

        if (!chatId) {
            console.log(
                chalk.gray('[') + chalk.yellow('Rumble:' + this.username) + chalk.gray(']'),
                chalk.yellow('Aucun chatId disponible, retry dans 30s...')
            )
            if (this._shouldReconnect) {
                this._reconnectTimer = setTimeout(() => this.connect(), 30_000)
            }
            return
        }

        this._activeChatId = chatId

        if (this._abortController) this._abortController.abort()
        this._abortController = new AbortController()

        const url = `${RUMBLE_CHAT_HOST}/chat/api/chat/${chatId}/stream`

        try {
            const res = await fetch(url, {
                headers: {
                    Accept: 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Origin: 'https://rumble.com',
                    Referer: 'https://rumble.com/',
                    Cookie: this.sessionCookie ? `u_s=${this.sessionCookie}` : '',
                },
                signal: this._abortController.signal,
            })

            if (!res.ok) {
                throw new Error(`SSE HTTP ${res.status}`)
            }

            this._connected = true
            this.emit('connected')

            let buffer = ''
            let pendingEventType = null

            for await (const chunk of res.body) {
                if (!this._shouldReconnect) break
                buffer += chunk.toString('utf8')
                const lines = buffer.split('\n')
                buffer = lines.pop()

                for (const line of lines) {
                    const trimmed = line.trimEnd()
                    if (trimmed.startsWith('event:')) {
                        pendingEventType = trimmed.slice(6).trim()
                    } else if (trimmed.startsWith('data:')) {
                        const dataStr = trimmed.slice(5).trim()
                        try {
                            const parsed = JSON.parse(dataStr)
                            this._handleSseEvent(pendingEventType, parsed)
                        } catch {}
                        pendingEventType = null
                    } else if (trimmed === '') {
                        pendingEventType = null
                    }
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') return
            this.emit('error', err)
        }

        this._connected = false
        if (this._shouldReconnect) {
            this.emit('disconnected')
            this._reconnectTimer = setTimeout(() => this.connect(), SSE_RECONNECT_DELAY_MS)
        }
    }

    _handleSseEvent(eventType, data) {
        const type = data?.type || eventType
        if (type !== 'messages') return

        const messages = data?.data?.messages
        if (!Array.isArray(messages)) return

        const usersArr = data?.data?.users
        const usersById = Array.isArray(usersArr)
            ? Object.fromEntries(usersArr.map((u) => [String(u.id), u]))
            : {}

        for (const msg of messages) {
            if (!msg?.text) continue

            const userInfo = usersById[String(msg.user_id)] ?? {}
            const username = userInfo.username || msg.username || String(msg.user_id || 'unknown')
            const displayname = userInfo.channel_name || userInfo.display_name || username

            this.emit('message', {
                type: 'Message',
                sender: {
                    id: String(msg.user_id || msg.channel_id || username),
                    username,
                    displayname,
                },
                content: String(msg.text),
                _raw: msg,
            })
        }
    }

    async sendMessage(text) {
        const chatId = this.chatId || this._activeChatId || toBase10ChatId(this._activeStreamId)
        if (!chatId) {
            console.warn(
                chalk.gray('[') + chalk.yellow('Rumble:' + this.username) + chalk.gray(']'),
                chalk.yellow('sendMessage ignore: pas de chatId actif')
            )
            return null
        }

        const body = {
            data: {
                request_id: generateRequestId(),
                message: { text },
                rant: null,
                channel_id: this.channelId,
            },
        }

        try {
            const res = await fetch(`${RUMBLE_CHAT_HOST}/chat/api/chat/${chatId}/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'https://rumble.com',
                    Referer: 'https://rumble.com/',
                    Cookie: this.sessionCookie ? `u_s=${this.sessionCookie}` : '',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
            })

            if (res.status === 429) {
                const retryAfter = parseInt(res.headers.get('retry-after') ?? '5', 10)
                console.warn(
                    chalk.gray('[') + chalk.yellow('Rumble:' + this.username) + chalk.gray(']'),
                    chalk.yellow(`Rate-limited, retry dans ${retryAfter}s`)
                )
                return { ok: false, rateLimited: true, retryAfter }
            }

            if (!res.ok) {
                const responseText = await res.text().catch(() => '')
                console.warn(
                    chalk.gray('[') + chalk.yellow('Rumble:' + this.username) + chalk.gray(']'),
                    chalk.yellow(`sendMessage HTTP ${res.status}${responseText ? ` - ${responseText.slice(0, 300)}` : ''}`)
                )
                return { ok: false, status: res.status, body: responseText }
            }

            res.body?.resume()
            return { ok: true }
        } catch (err) {
            console.error(
                chalk.gray('[') + chalk.red('Rumble:' + this.username) + chalk.gray(']'),
                chalk.red('Erreur sendMessage:'),
                err.message
            )
            return { ok: false }
        }
    }
}
