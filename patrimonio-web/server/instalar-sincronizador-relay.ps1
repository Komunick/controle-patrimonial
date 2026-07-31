# Instala o sincronizador do relay como Tarefa Agendada no Windows.
# Execute em um PowerShell elevado (Administrador), dentro de patrimonio-web.
[CmdletBinding()]
param(
  [string]$RelayUrl,
  [string]$SistemaUrl = 'http://127.0.0.1:8080'
)

$ErrorActionPreference = 'Stop'

$identidade = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalAtual = New-Object Security.Principal.WindowsPrincipal($identidade)
if (-not $principalAtual.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Abra o PowerShell como Administrador e execute novamente.'
}

if ([string]::IsNullOrWhiteSpace($RelayUrl)) {
  $RelayUrl = Read-Host 'URL do relay (ex.: https://controle-patrimonial-relay-epi.onrender.com)'
}
$RelayUrl = $RelayUrl.Trim().TrimEnd('/')
if ($RelayUrl -notmatch '^https://') {
  throw 'A URL pública do relay deve começar com https://.'
}

$segredoProtegido = Read-Host 'RELAY_SEGREDO configurado no Render' -AsSecureString
$ponte = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segredoProtegido)
try {
  $RelaySegredo = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponte)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponte)
}
if ([string]::IsNullOrWhiteSpace($RelaySegredo)) {
  throw 'O segredo não pode ficar vazio.'
}

# Variáveis de máquina ficam disponíveis à conta SYSTEM usada pela tarefa.
[Environment]::SetEnvironmentVariable('RELAY_URL', $RelayUrl, 'Machine')
[Environment]::SetEnvironmentVariable('RELAY_SEGREDO', $RelaySegredo, 'Machine')
[Environment]::SetEnvironmentVariable('SISTEMA_URL', $SistemaUrl.Trim().TrimEnd('/'), 'Machine')
[Environment]::SetEnvironmentVariable('PAT_LINK_ASSINATURA', $RelayUrl, 'Machine')

$iniciador = Join-Path $PSScriptRoot 'iniciar-sincronizador-relay.cmd'
$pastaWeb = Split-Path $PSScriptRoot -Parent
$acao = New-ScheduledTaskAction -Execute $env:ComSpec -Argument ('/d /c "{0}"' -f $iniciador) -WorkingDirectory $pastaWeb
$gatilho = New-ScheduledTaskTrigger -AtStartup
$conta = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Stop-ScheduledTask -TaskName 'ControlePatrimonialRelayEpi' -ErrorAction SilentlyContinue
Register-ScheduledTask `
  -TaskName 'ControlePatrimonialRelayEpi' `
  -Action $acao `
  -Trigger $gatilho `
  -Principal $conta `
  -Settings $ajustes `
  -Description 'Sincroniza termos e assinaturas de EPI com o relay público.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName 'ControlePatrimonialRelayEpi'
Write-Host ''
Write-Host 'Sincronizador instalado e iniciado.' -ForegroundColor Green
Write-Host "Log: $(Join-Path $pastaWeb 'sincroniza-relay.log')"
Write-Host 'Reinicie o servidor patrimonial para ele ler PAT_LINK_ASSINATURA.' -ForegroundColor Yellow
