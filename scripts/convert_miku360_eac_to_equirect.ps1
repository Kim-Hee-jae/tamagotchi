param(
  [string]$InputPath = "app/main_pwa/assets/miku360_eac_source.mp4",
  [string]$OutputPath = "app/main_pwa/assets/miku360_equirect.mp4"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Error "ffmpeg가 설치되어 있지 않습니다. ffmpeg를 설치하고 PATH에 추가한 뒤 다시 실행하세요."
}

if (-not (Test-Path -LiteralPath $InputPath)) {
  Write-Error "입력 파일을 찾을 수 없습니다: $InputPath"
}

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir -and -not (Test-Path -LiteralPath $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

ffmpeg -y `
  -i $InputPath `
  -vf "v360=input=eac:output=equirect:w=1920:h=960:interp=lanczos" `
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p `
  -c:a copy -movflags +faststart `
  $OutputPath

Write-Host "변환 완료: $OutputPath"
