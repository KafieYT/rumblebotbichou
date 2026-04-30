import mysql2 from 'mysql2'
import util from 'util'

class Database {
    constructor() {
        let db = mysql2.createPool({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT || 3306),
            user: process.env.DB_USER,
            database: process.env.DB_NAME,
            password: process.env.DB_PASS || process.env.DB_PASSWORD,
            waitForConnections: true,
            connectionLimit: 500,
            queueLimit: 0
        })
        
        db.query = util.promisify(db.query).bind(db)
        return db
    }
}

export default Database
