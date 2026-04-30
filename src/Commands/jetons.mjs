export default {     
    config: {
        name: 'jetons',
    }, 
    run: async(client, utils, args, sender, message) => {
        const helpMessage = `Tu n’es pas affilié à la boutique. Pour lier ton compte : https://vitapvpey.com/settings → clique sur “Lier vos comptes”, puis entre le code Rumble dans le chat !`

        try {
            const user = await utils.users.findLinkedByRumble(client.db, sender.id, sender.username)

            if (!user) {
                client.sendMessage(helpMessage)
                return
            }

            const balance = Number(user.balance || 0)
            client.sendMessage(`@${sender.displayname} vous avez ${Math.floor(balance)} jetons, visitez https://vitapvpey.com/ pour les dépenser`)
        } catch (error) {
            utils.log.error(`[${client.username}] Erreur !jetons pour ${sender?.username || 'unknown'} (${sender?.id || 'unknown'}): ${error.message}`)
            client.sendMessage(`Impossible de récupérer tes jetons pour le moment. Réessaie dans quelques minutes.`)
        }
    }
}
