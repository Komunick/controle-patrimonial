' Inicia o servidor estatico em segundo plano, sem janela visivel.
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & "C:\Users\brazil\Downloads\controle-patrimonial-web_2\patrimonio-web\start-server.bat" & Chr(34), 0, False
Set WshShell = Nothing
