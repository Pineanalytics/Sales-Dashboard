' Runs a command completely hidden, invoked as:
'   wscript.exe run-hidden.vbs "<exe>" "<arg1>" "<arg2>" ...
'
' powershell.exe's own -WindowStyle Hidden switch does not reliably suppress
' the console window on Task Scheduler: conhost.exe allocates a window for
' the process before PowerShell's own argument parser ever reads the
' -WindowStyle flag, so a brief flash (or, on some machines, a fully visible
' window) can still appear on every scheduled run - confirmed live on the
' Nyeri Centegy PC's five-minute Sales & Returns sync task. WScript.Shell's
' Run method with windowStyle=0 goes through the Windows shell API directly
' instead, which never allocates a window at all.
'
' Each wrapped argument must be passed as its own separate argument to this
' script (not pre-joined into one command-line string) so this file never
' has to guess at nested-quote escaping; it quotes each one itself. The
' wrapped process's exit code is passed straight through so Task Scheduler's
' own success/failure tracking and this project's retry settings keep
' working unchanged.
Dim objShell, args, i, cmd
Set objShell = CreateObject("WScript.Shell")
Set args = WScript.Arguments
If args.Count = 0 Then
  WScript.Quit 1
End If
cmd = """" & args(0) & """"
For i = 1 To args.Count - 1
  cmd = cmd & " """ & args(i) & """"
Next
WScript.Quit objShell.Run(cmd, 0, True)
