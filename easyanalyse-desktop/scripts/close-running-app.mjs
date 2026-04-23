import { execFileSync } from 'node:child_process'

if (process.platform !== 'win32') {
  process.exit(0)
}

const processNames = ['easyanalyse-desktop', 'EASYAnalyse Desktop']
const quotedNames = processNames.map((name) => `'${name.replaceAll("'", "''")}'`).join(', ')

const command = `
$names = @(${quotedNames})
$processes = foreach ($name in $names) { Get-Process -Name $name -ErrorAction SilentlyContinue }
$processes = $processes | Where-Object { $_.Id -ne $PID } | Sort-Object Id -Unique
foreach ($process in $processes) {
  Write-Host "Closing running EASYAnalyse process $($process.Id)..."
  Stop-Process -Id $process.Id -Force -ErrorAction Stop
}
if ($processes) {
  Start-Sleep -Milliseconds 800
}
`

execFileSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
  { stdio: 'inherit' },
)
