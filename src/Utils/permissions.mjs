export const hasRafflePermission = (client, sender) => {
    const raffleCommand = client.commands?.get('raffle')
    const allowedUsers = Array.isArray(raffleCommand?.config?.users)
        ? raffleCommand.config.users.map((user) => String(user).toLowerCase())
        : []

    const username = String(sender?.username || '').toLowerCase()
    return allowedUsers.includes(username)
}

