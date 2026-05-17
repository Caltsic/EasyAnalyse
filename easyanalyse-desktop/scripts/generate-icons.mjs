import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const iconScript = resolve(here, '..', '..', 'scripts', 'generate_app_icons.py')

const candidates =
  process.platform === 'win32'
    ? [
        { command: 'python', args: [] },
        { command: 'py', args: ['-3'] },
        { command: 'python3', args: [] },
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ]

for (const candidate of candidates) {
  const probe = spawnSync(
    candidate.command,
    [...candidate.args, '-c', 'from PIL import Image; import sys; print(sys.executable)'],
    { encoding: 'utf8' },
  )

  if (probe.status !== 0) {
    continue
  }

  const executable = probe.stdout.trim().split(/\r?\n/).at(-1) ?? candidate.command
  console.log(`Using Python for icon generation: ${executable}`)
  const result = spawnSync(candidate.command, [...candidate.args, iconScript], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

console.error('Could not find a Python interpreter with Pillow installed.')
console.error('Install Pillow for python3/python, then run npm run generate:icons again.')
process.exit(1)
