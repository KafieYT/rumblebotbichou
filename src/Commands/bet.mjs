let numeric = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
let alpha = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

export default {     
    config: {
        name: 'bet',
        users: ['vitabot', 'vitapvpey', 'kafieledictateurduj', 'kafie', 'kafieyt', 'curdz', 'curdzou', 'glockaucarre', 'groyeux', 'glockzer', 'blvezjm', 'axeimir'],
    },
    async run(client, utils, args, sender, message) {
        if (!this.config.users.includes(String(sender.username || '').toLowerCase())) return;
        let option = args[0]
        let amount = Number(args[1])
        option = option.toUpperCase()

        if(numeric.includes(option)) {
            // If the option is 1,2,3,4,5,etc
            if(!client.bets.first.running) return
            if(client.bets.first.finished) return
            if(amount > client.bets.first.maxbet) return

            if(!client.bets.first.options.hasOwnProperty(option)) return

            let checkBalance = await utils.users.remove(client.db, sender.id, amount)
            if(checkBalance.error) return

            const check = await addOrUpdateBet(sender.id, option, amount, client.bets.first.maxbet, client.betentires.first)
            if(check == false) return

            client.bets.first.points += amount
            client.bets.first.bets++
            client.io.emit('bet:total', { id: 1, total: client.bets.first.points })
            client.io.emit('bet:bets', { id: 1, total: client.bets.first.bets })

            client.bets.first.options[`${option}`].total += amount

            Object.keys(client.bets.first.options).forEach(key => {
                const bet = client.bets.first.options[key]
                const percent = ((bet.total / client.bets.first.points) * 100).toFixed(2)
                client.bets.first.options[key].percent = percent
                client.io.emit('bet:progress', { option: key, percent: percent })
            })
            
            console.log(`${sender.username} bet ${amount} on ${option}`)
        } else if(alpha.includes(option)) {
            // If the option is A,B,C,D,E,etc
            if(!client.bets.second.running) return
            if(client.bets.second.finished) return
            if(amount > client.bets.second.maxbet) return

            if(!client.bets.second.options.hasOwnProperty(option)) return

            let checkBalance = await utils.users.remove(client.db, sender.id, amount)
            if(checkBalance.error) return
            
            const check = await addOrUpdateBet(sender.id, option, amount, client.bets.second.maxbet, client.betentires.second)
            if(check == false) return

            client.bets.second.points += amount
            client.bets.second.bets++
            client.io.emit('bet:total', { id: 2, total: client.bets.second.points })
            client.io.emit('bet:bets', { id: 2, total: client.bets.second.bets })

            client.bets.second.options[`${option}`].total += amount

            Object.keys(client.bets.second.options).forEach(key => {
                const bet = client.bets.second.options[key]
                const percent = ((bet.total / client.bets.second.points) * 100).toFixed(2)
                client.bets.second.options[key].percent = percent
                client.io.emit('bet:progress', { option: key, percent: percent })
            })
            
            console.log(`${sender.username} bet ${amount} on ${option}`)
        }
    }
}

function addOrUpdateBet(userId, option, additionalAmount, maxBet, betEntries) {
    const existingBet = betEntries.find(bet => bet.id === userId && bet.option === option);

    if (existingBet) {
        const newTotalAmount = existingBet.amount + additionalAmount;

        if (newTotalAmount > maxBet + 1) {
            console.log(`Cannot place bet. The total amount exceeds the max bet limit of ${maxBet}.`)
            return false
        } else {
            existingBet.amount = newTotalAmount
            console.log(`Bet updated. New amount for option ${option}: ${newTotalAmount}`)
            return true
        }
    } else {
        if (additionalAmount > maxBet + 1) {
            console.log(`Cannot place bet. The amount exceeds the max bet limit of ${maxBet}.`)
            return false
        } else {
            betEntries.push({ id: userId, option: option, amount: additionalAmount })
            console.log(`New bet placed for option ${option} with amount ${additionalAmount}.`)
            return true
        }
    }
}
