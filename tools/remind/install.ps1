<#
  install.ps1 —— 把「到期提醒」注册成 Windows 计划任务（当前用户，**不需要管理员**）

  做什么：
    ① 在 %LOCALAPPDATA%\dsh-gacha-calendar\ 下生成一个零窗口启动器（remind-run.vbs）
    ② 注册计划任务 dsh-gacha-calendar-remind：每 N 分钟跑一次 remind.mjs --limit=3
    ③ 可选：把仓库里的 remind-config.json 复制成用户配置（已存在则不覆盖）

  为什么用 VBS 当启动器：计划任务的 action 直接写 node.exe / powershell.exe 时，
  在「用户已登录」的会话里启动控制台程序往往会闪一下黑窗。WScript.Shell.Run(cmd, 0, False)
  的第二个参数 0 = SW_HIDE，是唯一能**保证**不闪窗的方式；node 自己的输出只会进 remind.log。
  （已知限制：部分企业策略会禁用 Windows Script Host；见 README「排错」。）

  参数：
    -IntervalMinutes N   重复间隔（分钟），默认 30（范围 5~1440）
    -Status              打印安装状态 / 下次运行时间 / 路径漂移检查
    -Uninstall           删除计划任务与启动器（保留 state.json / remind.log / remind-config.json）

  用法：
    powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1
    powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Status
    powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -IntervalMinutes 15
    powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Uninstall

  退出码：0 成功（含「未安装」的查询）/ 1 失败。
  装完不会写系统目录：任务在「任务计划程序库」根下，启动器与运行产物都在 %LOCALAPPDATA%。
#>
[CmdletBinding()]
param(
	[ValidateRange(5, 1440)]
	[int]$IntervalMinutes = 30,
	[switch]$Uninstall,
	[switch]$Status
)

$ErrorActionPreference = 'Stop'

$TaskName = 'dsh-gacha-calendar-remind'
$InstallDir = Join-Path $env:LOCALAPPDATA 'dsh-gacha-calendar'
$RunnerVbs = Join-Path $InstallDir 'remind-run.vbs'
$RemindScript = Join-Path $PSScriptRoot 'remind.mjs'
$ExampleConfig = Join-Path $PSScriptRoot 'remind-config.json'
$UserConfig = Join-Path $InstallDir 'remind-config.json'
$LogFile = Join-Path $InstallDir 'remind.log'
$StateFile = Join-Path $InstallDir 'state.json'
# 单次最多弹几条：防止某轮有大量条目同时到期时刷屏（与 remind.mjs 的 --limit 同一含义）
$LimitPerRun = 3

function Fail([string]$Message) {
	Write-Host ('✗ ' + $Message) -ForegroundColor Red
	exit 1
}

function Resolve-NodeExe {
	$cmd = Get-Command node -ErrorAction SilentlyContinue
	if (-not $cmd) { return $null }
	return $cmd.Source
}

function Format-TimeText($Value) {
	if ($null -eq $Value) { return '—' }
	# 没跑过时任务计划程序给的是哨兵时间（常见 1899-12-30 / 1999-11-30），按「—」显示更诚实
	try {
		if ($Value.Year -lt 2000) { return '—' }
		return $Value.ToString('yyyy-MM-dd HH:mm:ss')
	} catch {
		return '—'
	}
}

function Show-Status {
	$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
	if (-not $task) {
		Write-Host ('未安装：找不到计划任务「' + $TaskName + '」')
		Write-Host '  安装：powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1'
		return
	}

	$info = Get-ScheduledTaskInfo -TaskName $TaskName
	$trigger = @($task.Triggers)[0]
	$repeat = '—'
	if ($trigger -and $trigger.Repetition -and $trigger.Repetition.Interval) {
		$repeat = [string]$trigger.Repetition.Interval
	}

	Write-Host ('任务名：' + $TaskName)
	Write-Host ('状态：' + [string]$task.State + '（当前用户，仅在用户登录时运行）')
	Write-Host ('间隔：' + $repeat)
	Write-Host ('下次运行：' + (Format-TimeText $info.NextRunTime))
	Write-Host ('上次运行：' + (Format-TimeText $info.LastRunTime) + ' ｜ 上次结果：' + [string]$info.LastTaskResult)
	Write-Host ('启动器：' + $RunnerVbs + '（' + $(if (Test-Path -LiteralPath $RunnerVbs) { '存在' } else { '缺失' }) + '）')
	Write-Host ('脚本：' + $RemindScript + '（' + $(if (Test-Path -LiteralPath $RemindScript) { '存在' } else { '缺失' }) + '）')
	Write-Host ('日志：' + $LogFile + '（' + $(if (Test-Path -LiteralPath $LogFile) { '存在' } else { '还没跑过' }) + '）')
	Write-Host ('状态：' + $StateFile + '（' + $(if (Test-Path -LiteralPath $StateFile) { '存在' } else { '首次运行后生成' }) + '）')

	# 路径漂移检查：仓库被移动 / node 升级后路径变了，任务会静默跑不起来，这里如实报出来
	$node = Resolve-NodeExe
	if (-not $node) {
		Write-Host '⚠ 当前 PATH 里找不到 node；启动器里的绝对路径可能已失效，重跑 install.ps1 修复'
	} elseif (Test-Path -LiteralPath $RunnerVbs) {
		$vbsText = Get-Content -LiteralPath $RunnerVbs -Raw
		if ($vbsText -notlike ('*' + $node + '*')) {
			Write-Host ('⚠ 启动器里的 node 路径与当前不同（现在：' + $node + '）；重跑 install.ps1 修复')
		}
	}
	if (-not (Test-Path -LiteralPath $RemindScript)) {
		Write-Host '⚠ remind.mjs 不存在（仓库被移动？）；重跑 install.ps1 修复'
	}
}

function Invoke-Uninstall {
	$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
	if ($task) {
		Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
		Write-Host ('✓ 已删除计划任务「' + $TaskName + '」')
	} else {
		Write-Host ('· 计划任务「' + $TaskName + '」本来就不存在')
	}
	if (Test-Path -LiteralPath $RunnerVbs) {
		Remove-Item -LiteralPath $RunnerVbs -Force
		Write-Host ('✓ 已删除启动器：' + $RunnerVbs)
	}
	Write-Host '· 保留用户数据（不影响下次安装）：'
	foreach ($file in @($StateFile, $LogFile, (Join-Path $InstallDir 'cache.json'), $UserConfig)) {
		if (Test-Path -LiteralPath $file) { Write-Host ('    ' + $file) }
	}
}

function Invoke-Install {
	if (-not (Test-Path -LiteralPath $RemindScript)) {
		Fail ('找不到 remind.mjs：' + $RemindScript + '（install.ps1 必须和它放在同一目录）')
	}
	$node = Resolve-NodeExe
	if (-not $node) {
		Fail 'PATH 里找不到 node.exe —— 先装 Node.js（>=20），再重跑本脚本'
	}

	New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

	# 用户配置：只在缺失时复制，绝不覆盖用户改过的版本
	if (-not (Test-Path -LiteralPath $UserConfig)) {
		if (Test-Path -LiteralPath $ExampleConfig) {
			Copy-Item -LiteralPath $ExampleConfig -Destination $UserConfig
			Write-Host ('✓ 已生成用户配置：' + $UserConfig)
		} else {
			Write-Host '· 仓库里没有 remind-config.json，运行时将使用内置默认节点'
		}
	} else {
		Write-Host ('· 已有用户配置，保持不动：' + $UserConfig)
	}

	# 零窗口启动器。内容全 ASCII（路径单独拼进去），用 Unicode(UTF-16LE + BOM) 写盘：
	# WScript 能正确读 UTF-16，且路径里有中文用户名也不会乱码。
	$vbsTemplate = @'
' generated by tools/remind/install.ps1 - launches the reminder with no console window
Option Explicit
Dim sh, cmd
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "{0}"
cmd = Chr(34) & "{1}" & Chr(34) & " " & Chr(34) & "{2}" & Chr(34) & " --limit={3}"
sh.Run cmd, 0, False
'@
	$vbsBody = $vbsTemplate -f $InstallDir, $node, $RemindScript, $LimitPerRun
	$vbsBody = $vbsBody -replace "`r?`n", "`r`n"
	[System.IO.File]::WriteAllText($RunnerVbs, $vbsBody, [System.Text.Encoding]::Unicode)
	Write-Host ('✓ 已生成启动器：' + $RunnerVbs)

	$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
	if (-not (Test-Path -LiteralPath $wscript)) { $wscript = 'wscript.exe' }

	$action = New-ScheduledTaskAction -Execute $wscript -Argument ('//B //NoLogo "' + $RunnerVbs + '"') -WorkingDirectory $InstallDir
	# 现在起 2 分钟后第一次跑，之后每 N 分钟重复。
	# ⚠ 重复时长不能用 [TimeSpan]::MaxValue（会生成 P99999999D…，任务计划程序的 XML 校验直接拒绝），
	#   用 10 年 —— 对"常驻提醒"来说等价于永久，且重装 / 改间隔都会重写这个触发器。
	$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) `
		-RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
		-RepetitionDuration (New-TimeSpan -Days 3650)
	$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
		-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
		-MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
	$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
		-LogonType Interactive -RunLevel Limited

	Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
	Write-Host ('✓ 已注册计划任务「' + $TaskName + '」：每 ' + $IntervalMinutes + ' 分钟，错过时尽快启动（StartWhenAvailable），无窗口')

	Write-Host ''
	Show-Status
	Write-Host ''
	Write-Host '提示：装完可以先手动验一次：powershell -ExecutionPolicy Bypass -File tools\remind\remind.mjs --dry-run'
	Write-Host '     卸载：powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Uninstall'
}

try {
	if ($Uninstall) { Invoke-Uninstall }
	elseif ($Status) { Show-Status }
	else { Invoke-Install }
	exit 0
} catch {
	Fail ('操作失败：' + $_.Exception.Message)
}
