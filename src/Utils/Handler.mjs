import { globSync } from 'glob'
import { fileURLToPath } from 'url'
import chalk from 'chalk'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const commandsRoot = path.resolve(__dirname, '..', 'Commands')

export default {
    command: async (commands) => {
        console.log(chalk.gray('[') + chalk.blue('Bot') + chalk.gray(']'), chalk.white('Loading commands..'))
        const files = globSync(path.join(commandsRoot, '**/*.mjs'))

        if (!files.length) {
            console.log(
                chalk.gray('[') + chalk.red('Bot') + chalk.gray(']'),
                chalk.red(`No command files found in ${commandsRoot}`)
            )
        }

        for (const file of files) {
            const fullPath = path.resolve(file)
            try {
                const { default: command } = await import('file://' + fullPath)
                if (!command?.config?.name || typeof command.run !== 'function') {
                    console.log(chalk.gray('[') + chalk.red('Bot') + chalk.gray(']'), chalk.red(`Invalid command skipped: ${fullPath}`))
                    continue
                }
                commands.set(command.config.name, command)
                console.log(chalk.gray('[') + chalk.blue('Bot') + chalk.gray(']'), chalk.white('Loaded ') + chalk.blue(command.config.name))
            } catch (error) {
                console.log(chalk.gray('[') + chalk.red('Bot') + chalk.gray(']'), chalk.red(`Failed to load ${fullPath}: ${error?.message || error}`))
            }
        }
    }
}
