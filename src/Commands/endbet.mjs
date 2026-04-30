let numberic = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
let alpha = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

export default {     
    config: {
        name: 'endbet',
        users: ['vitabot', 'vitapvpey', 'kafieledictateurduj', 'kafie', 'kafieyt', 'curdz', 'curdzou', 'glockaucarre', 'groyeux', 'glockzer', 'blvezjm', 'axeimir'],
    },
    async run(client, utils, args, sender, message) {
        if (!this.config.users.includes(String(sender.username || '').toLowerCase())) return;
        let option = args[0]

        if(numberic.includes(option)) {
            // If the option is 1,2,3,4,5,etc
            if(!client.bets.first.running) return;
            client.bets.first.running = false
            
            client.io.emit('bet:finish', {
                id: 1,
                option: option
            })
            
            let winners = client.betentires.first.filter(entry => entry.option == option)
            winners.forEach(winner => {
                console.log(winner)
                utils.users.add(client.db, winner.id, winner.amount * 2)
            }) 

            setTimeout(async() => {
                client.betentires.first = []
                client.bets.first = {
                    running: false
                }
            }, 30 * 1000)
        } else if(alpha.includes(option)) {
            // If the option is A,B,C,D,E,etc
            if(!client.bets.second.running) return
            client.bets.second.running = false

            client.io.emit('bet:finish', {
                id: 2,
                option: option
            })

            let winners = client.betentires.second.filter(entry => entry.option == option)
            winners.forEach(winner => {
                utils.users.add(client.db, winner.id, winner.amount * 2)
            })

            setTimeout(async() => {
                client.betentires.seconsd = []
                client.bets.second = {
                    running: false
                }
            }, 30 * 1000)
        }
    }
}
