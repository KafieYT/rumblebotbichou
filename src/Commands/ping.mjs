export default {     
    config: {
        name: 'ping',
    }, 
    run: async(client, utils, args, sender, message) => {
        console.log(`[PING] Message reçu de ${sender.username}:`, message)
        utils.log.success(`🏓 Pong! (depuis ${sender.username})`)
    }
}