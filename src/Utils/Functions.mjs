import chalk from 'chalk'

export default {
    log: {
        error: (message) => {
            console.log(chalk.gray('[') + chalk.red('Error') + chalk.gray(']'), chalk.white(message))
        },
        success: (message) => {
            console.log(chalk.gray('[') + chalk.green('Success') + chalk.gray(']'), chalk.white(message))
        },
        info: (message) => {
            console.log(chalk.gray('[') + chalk.blue('Info') + chalk.gray(']'), chalk.white(message))
        }
    },
    generateRandomId: (length) => {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        let randomId = ''
        for (let i = 0; i < length; i++) {
            const randomIndex = Math.floor(Math.random() * charset.length)
            randomId += charset[randomIndex]
        }
        return randomId
    },
    mapping: {
        numerical: (options) => {
            const result = {}
            let count = 1
            for (const option of options) {
                result[count] = { text: option, percent: 0, total: 0 }
                count++
            }
            return result
        },
        alpha: (options) => {
            const result = {}
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
            for (let i = 0; i < options.length; i++) {
                result[letters[i]] = { text: options[i], percent: 0, total: 0 }
            }
            return result
        }
    },
    users: {
        /**
         * Cherche un utilisateur lié par son compte Rumble (rumble_id ou rumble_username).
         */
        findLinkedByRumble: async (db, rumbleId, rumbleUsername) => {
            const normalizeRows = (result) => {
                if (Array.isArray(result) && Array.isArray(result[0])) return result[0]
                return result
            }

            try {
                if (rumbleId && rumbleUsername) {
                    const rows = normalizeRows(await db.query(
                        `SELECT * FROM balances WHERE rumble_id = ? OR LOWER(rumble_username) = LOWER(?) ORDER BY CASE WHEN rumble_id = ? THEN 0 ELSE 1 END LIMIT 1`,
                        [rumbleId, rumbleUsername, rumbleId]
                    ))
                    return rows?.[0] ?? null
                }

                if (rumbleId) {
                    const rows = normalizeRows(await db.query(
                        `SELECT * FROM balances WHERE rumble_id = ? LIMIT 1`,
                        [rumbleId]
                    ))
                    return rows?.[0] ?? null
                }

                if (rumbleUsername) {
                    const rows = normalizeRows(await db.query(
                        `SELECT * FROM balances WHERE LOWER(rumble_username) = LOWER(?) LIMIT 1`,
                        [rumbleUsername]
                    ))
                    return rows?.[0] ?? null
                }
            } catch (err) {
                if (err?.code === 'ER_BAD_FIELD_ERROR') return null
                throw err
            }

            return null
        },
        /**
         * Fallback DLive (utilisé par certaines commandes mixtes).
         */
        findLinkedByDlive: async (db, dliveId, dliveUsername) => {
            const normalizeRows = (result) => {
                if (Array.isArray(result) && Array.isArray(result[0])) return result[0]
                return result
            }

            const byId = normalizeRows(await db.query(
                `SELECT * FROM balances WHERE dlive_id = ? LIMIT 1`,
                [dliveId]
            ))
            if (byId && byId.length > 0) return byId[0]

            if (!dliveUsername) return null

            const byUsername = normalizeRows(await db.query(
                `SELECT * FROM balances WHERE LOWER(dlive_username) = LOWER(?) LIMIT 1`,
                [dliveUsername]
            ))
            if (byUsername && byUsername.length > 0) return byUsername[0]

            return null
        },
        add: async (db, id, amount) => {
            return new Promise((resolve, reject) => {
                db.query(`UPDATE balances SET balance = balance + ? WHERE dlive_id = ?`, [amount, id], (err) => {
                    if (err) { console.log(err); return reject(err) }
                    resolve(true)
                })
            })
        },
        remove: async (db, id, amount) => {
            return new Promise((resolve, reject) => {
                db.query(`UPDATE balances SET balance = balance - ? WHERE dlive_id = ?`, [amount, id], (err) => {
                    if (err) { console.log(err); return reject(err) }
                    resolve(true)
                })
            })
        },
    }
}
