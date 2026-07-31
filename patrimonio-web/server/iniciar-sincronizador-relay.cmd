@echo off
REM Mantém o sincronizador ativo e registra a saída ao lado do sistema.
REM RELAY_URL, RELAY_SEGREDO e SISTEMA_URL vêm das variáveis do Windows.
cd /d "%~dp0.."
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node.exe"

REM A Tarefa Agendada pode manter uma cópia antiga do ambiente até o reboot.
REM Lemos o registro a cada início para usar imediatamente os valores instalados.
for /f "tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v RELAY_URL 2^>nul') do set "RELAY_URL=%%B"
for /f "tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v RELAY_SEGREDO 2^>nul') do set "RELAY_SEGREDO=%%B"
for /f "tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v SISTEMA_URL 2^>nul') do set "SISTEMA_URL=%%B"

:iniciar
"%NODE_EXE%" "server\sincroniza-relay.js" >> "sincroniza-relay.log" 2>&1
echo [%date% %time%] Sincronizador encerrou; nova tentativa em 10 segundos. >> "sincroniza-relay.log"
timeout /t 10 /nobreak >nul
goto iniciar
