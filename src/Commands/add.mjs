import { hasRafflePermission } from '../Utils/permissions.mjs'

const MAX_ADD_AMOUNT = 1_000_000

const sanitizeUsername = (input) => String(input || '').trim().replace(/^@+/, '')
const isPositiveIntegerString = (value) => /^\d+$/.test(String(value || '').trim())
const normalizeRows = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result)

const getConnection = (db) =>
    new Promise((resolve, reject) => {
        db.getConnection((err, connection) => {
            if (err) return reject(err)
            resolve(connection)
        })
    })

const queryConnection = (connection, sql, params = []) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, rows) => {
            if (err) return reject(err)
            resolve(rows)
        })
    })

const findLinkedByRumbleUsername = async (db, rumbleUsername) => {
    if (!rumbleUsername) return null
    try {
        const rows = normalizeRows(await db.query(
            `SELECT b.user_id, b.rumble_username, b.rumble_id, b.balance, u.username AS site_username, COALESCE(u.isBanned, 0) AS isBanned
             FROM balances b
             LEFT JOIN users u ON u.id = b.user_id
             WHERE LOWER(b.rumble_username) = LOWER(?) LIMIT 1`,
            [rumbleUsername]
        ))
        return rows?.[0] || null
    } catch (err) {
        if (err?.code === 'ER_BAD_FIELD_ERROR') return null
        throw err
    }
}

const generateTransactionId = () => {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let token = ''
    for (let i = 0; i < 32; i++) token += chars.charAt(Math.floor(Math.random() * chars.length))
    return token
}

const insertTransactionLogIfPossible = async (connection, targetUserId, amount, actorUsername) => {
    try {
        await queryConnection(connection,
            `INSERT INTO transactions (id, userId, type, amount, reason, createdAt) VALUES (?, ?, 'credit', ?, ?, NOW())`,
            [generateTransactionId(), targetUserId, amount, `ADMIN_ADD_JETONS:${actorUsername}`]
        )
        return
    } catch (error) {
        if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_PARSE_ERROR'].includes(error?.code)) throw error
    }
    try {
        await queryConnection(connection,
            `INSERT INTO transactions (user_id, type, amount, reason, created_at) VALUES (?, 'credit', ?, ?, NOW())`,
            [targetUserId, amount, `ADMIN_ADD_JETONS:${actorUsername}`]
        )
    } catch (error) {
        if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_PARSE_ERROR'].includes(error?.code)) throw error
    }
}

const creditUserWithTransaction = async (db, targetUserId, amount, actorUsername) => {
    const connection = await getConnection(db)
    try {
        await queryConnection(connection, 'START TRANSACTION')
        const result = await queryConnection(connection,
            `UPDATE balances SET balance = balance + ? WHERE user_id = ?`,
            [amount, targetUserId]
        )
        if (!result || result.affectedRows !== 1) throw new Error('TARGET_BALANCE_NOT_UPDATED')
        await insertTransactionLogIfPossible(connection, targetUserId, amount, actorUsername)
        await queryConnection(connection, 'COMMIT')
    } catch (error) {
        try { await queryConnection(connection, 'ROLLBACK') } catch (_) {}
        throw error
    } finally {
        connection.release()
    }
}

export default {
    config: { name: 'add' },
    run: async (client, utils, args, sender) => {
        if (!hasRafflePermission(client, sender)) {
            client.sendMessage(`❌ Tu n'as pas la permission d'utiliser cette commande.`)
            return
        }

        const targetUsername = sanitizeUsername(args?.[0])
        const amountRaw = args?.[1]

        if (!targetUsername || !isPositiveIntegerString(amountRaw)) {
            client.sendMessage(`❌ Utilisation: !add @pseudoRumble JETONS`)
            return
        }

        const amount = Number(amountRaw)
        if (!Number.isInteger(amount) || amount <= 0) {
            client.sendMessage(`❌ Utilisation: !add @pseudoRumble JETONS`)
            return
        }

        if (amount > MAX_ADD_AMOUNT) {
            client.sendMessage(`❌ Montant trop élevé. Maximum autorisé: ${MAX_ADD_AMOUNT}.`)
            return
        }

        try {
            const target = await findLinkedByRumbleUsername(client.db, targetUsername)

            if (!target) {
                client.sendMessage(`❌ @${targetUsername} n'est pas lié au site. Le joueur doit lier son compte sur https://vitapvpey.com/settings`)
                return
            }

            if (Number(target.isBanned || 0) === 1) {
                client.sendMessage(`❌ @${targetUsername} est banni, impossible d'ajouter des jetons.`)
                return
            }

            await creditUserWithTransaction(client.db, target.user_id, amount, String(sender?.username || 'unknown'))

            const siteUsername = String(target.site_username || target.user_id || '').trim()
            client.sendMessage(`✅ @${targetUsername} (${siteUsername}) a bien reçu ${amount} jetons !`)
            utils.log.success(`[${client.username}] !add ${amount} -> @${targetUsername} par ${sender?.username || 'unknown'}`)
        } catch (error) {
            utils.log.error(`[${client.username}] Erreur !add pour @${targetUsername} (${amount}): ${error?.message || error}`)
            client.sendMessage(`❌ Erreur lors de l'ajout des jetons. Réessaie.`)
        }
    },
}
