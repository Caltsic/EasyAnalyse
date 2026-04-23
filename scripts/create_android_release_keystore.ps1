param(
    [string]$ModuleDir = "easyanalyse-mobile-android",
    [string]$KeystoreRelativePath = "signing\easyanalyse-release.jks",
    [string]$PropertiesFileName = "keystore.properties",
    [string]$Alias = "easyanalyse_release",
    [string]$DistinguishedName = "CN=EASYAnalyse, OU=Engineering, O=EASYAnalyse, L=Shanghai, ST=Shanghai, C=CN",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function New-Password {
    $chars = @()
    $chars += 48..57
    $chars += 65..90
    $chars += 97..122
    -join ((1..32) | ForEach-Object { [char]($chars | Get-Random) })
}

$keytool = (Get-Command keytool).Source
$moduleRoot = (Resolve-Path $ModuleDir).Path
$keystorePath = Join-Path $moduleRoot $KeystoreRelativePath
$propertiesPath = Join-Path $moduleRoot $PropertiesFileName
$keystoreDir = Split-Path -Parent $keystorePath

if (((Test-Path $keystorePath) -or (Test-Path $propertiesPath)) -and -not $Force) {
    throw "Keystore or keystore.properties already exists. Rerun with -Force to replace them."
}

New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null

if (Test-Path $keystorePath) {
    Remove-Item -LiteralPath $keystorePath -Force
}
if (Test-Path $propertiesPath) {
    Remove-Item -LiteralPath $propertiesPath -Force
}

$password = New-Password

& $keytool `
    -genkeypair `
    -noprompt `
    -storetype PKCS12 `
    -keystore $keystorePath `
    -storepass $password `
    -alias $Alias `
    -keypass $password `
    -keyalg RSA `
    -keysize 4096 `
    -validity 36500 `
    -dname $DistinguishedName

if ($LASTEXITCODE -ne 0) {
    throw "keytool failed with exit code $LASTEXITCODE"
}

$storeFile = ($KeystoreRelativePath -replace "\\", "/") -replace "/+", "/"
@(
    "storeFile=$storeFile"
    "storePassword=$password"
    "keyAlias=$Alias"
    "keyPassword=$password"
) | Set-Content -LiteralPath $propertiesPath -Encoding ascii

Write-Output "Created Android release signing files:"
Write-Output "  Keystore: $keystorePath"
Write-Output "  Properties: $propertiesPath"
Write-Output "  Alias: $Alias"
