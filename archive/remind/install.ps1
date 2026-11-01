<#
  install.ps1 —— 把「到期提醒」注册成 Windows 计划任务（当前用户，**不需要管理员**）

  做什么：
    ① 在 %LOCALAPPDATA%\dsh-gacha-calendar\ 下生成一个零窗口启动器（remind-run.vbs）
    ② 注册计划任务 dsh-gacha-calendar-remind：每 N 分钟跑一次 remind.mjs --limit=3
    ③ 可选：把仓库里的 remind-config.json 复制成用户配置（已存在则不覆盖）
    ④ 在开始菜单建快捷方式「二游日历.lnk」并写入 AppUserModelID（AUMID）——
       Windows 靠「开始菜单快捷方式 + AUMID」识别一个非打包应用的身份；
       没有它，通知横幅顶部只能显示「Windows PowerShell」。

  AUMID：DshGachaCalendar.Reminder（toast.ps1 里是同一个常量，两处必须一致）

  为什么用 VBS 当启动器：计划任务的 action 直接写 node.exe / powershell.exe 时，
  在「用户已登录」的会话里启动控制台程序往往会闪一下黑窗。WScript.Shell.Run(cmd, 0, False)
  的第二个参数 0 = SW_HIDE，是唯一能**保证**不闪窗的方式；node 自己的输出只会进 remind.log。
  （已知限制：部分企业策略会禁用 Windows Script Host；见 README「排错」。）

  参数：
    -IntervalMinutes N   重复间隔（分钟），默认 30（范围 5~1440）
    -Status              打印安装状态 / 下次运行时间 / 路径漂移检查 / 快捷方式里的 AUMID
    -Uninstall           删除计划任务、启动器与开始菜单快捷方式
                         （保留 state.json / remind.log / remind-config.json）

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

# ── 应用身份（AUMID）──────────────────────────────────────────────────────────
# Windows 只认「开始菜单快捷方式里写的 AppUserModelID」= 非打包应用的身份。
# 通知横幅顶部的应用名与图标都取自这条快捷方式；没有它就只能退回 PowerShell 的身份。
# toast.ps1 里硬编码了同一个 AUMID —— 改这里必须同步改那里（README 有记录）。
$Aumid = 'DshGachaCalendar.Reminder'
$ShortcutName = '二游日历.lnk'
$ShortcutDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$ShortcutPath = Join-Path $ShortcutDir $ShortcutName
# 图标：仓库 assets/ 下只有截图、没有 ico/png，所以用系统「日期和时间」的日历图标
# （%SystemRoot%\System32\timedate.cpl 的 0 号 = 日历 + 时钟，Win10/11 都有）。
# 将来有 .ico 就把它拷到固定路径、把这里改成 '<路径>,0' 即可。
$IconLocation = (Join-Path $env:SystemRoot 'System32\timedate.cpl') + ',0'

$AumidInteropSource = @'
using System;
using System.Runtime.InteropServices;

// 只为读写 .lnk 的 System.AppUserModel.ID（PKEY_AppUserModel_ID）——
// 这个 shell 属性没有命令行 / PowerShell 原生写法，必须走 IPropertyStore。Set/Get 共 ~45 行。
public static class ShortcutAumid {
    [StructLayout(LayoutKind.Sequential, Pack = 4)] struct PropertyKey { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVariant {   // 24 = PROPVARIANT 的实际大小
        [FieldOffset(0)] public ushort vt;                               // （x64；显式给足，否则 GetValue
        [FieldOffset(8)] public IntPtr pointer;                          //   写 24 字节会踩坏托管内存）
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        int GetCount(out uint count); int GetAt(uint i, out PropertyKey key);
        int GetValue(ref PropertyKey key, out PropVariant value);
        int SetValue(ref PropertyKey key, ref PropVariant value); int Commit();
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr ctx, uint flags, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);

    static PropertyKey Key() {   // {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, pid 5 = PKEY_AppUserModel_ID
        return new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    }
    static IPropertyStore Open(string lnk, uint flags) {
        Guid iid = typeof(IPropertyStore).GUID; IPropertyStore store;
        int hr = SHGetPropertyStoreFromParsingName(lnk, IntPtr.Zero, flags, ref iid, out store);
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        return store;
    }
    public static void Set(string lnk, string aumid) {
        IPropertyStore store = Open(lnk, 2);                          // 2 = GPS_READWRITE
        try {
            PropertyKey key = Key(); PropVariant v = new PropVariant();
            v.vt = 31; v.pointer = Marshal.StringToCoTaskMemUni(aumid);   // 31 = VT_LPWSTR
            try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref v)); Marshal.ThrowExceptionForHR(store.Commit()); }
            finally { Marshal.FreeCoTaskMem(v.pointer); }
        } finally { Marshal.ReleaseComObject(store); }
    }
    public static string Get(string lnk) {
        IPropertyStore store = Open(lnk, 0);                          // 0 = GPS_DEFAULT（只读）
        try {
            PropertyKey key = Key(); PropVariant v;
            Marshal.ThrowExceptionForHR(store.GetValue(ref key, out v));
            try { return v.vt == 31 && v.pointer != IntPtr.Zero ? Marshal.PtrToStringUni(v.pointer) : null; }
            finally { PropVariantClear(ref v); }
        } finally { Marshal.ReleaseComObject(store); }
    }
}
'@

function Initialize-AumidInterop {
	if (-not ('ShortcutAumid' -as [type])) {
		Add-Type -TypeDefinition $AumidInteropSource -ErrorAction Stop
	}
}

function Set-ShortcutAumid([string]$LnkPath, [string]$Value) {
	Initialize-AumidInterop
	[ShortcutAumid]::Set($LnkPath, $Value)
}

function Get-ShortcutAumid([string]$LnkPath) {
	if (-not (Test-Path -LiteralPath $LnkPath)) { return $null }
	Initialize-AumidInterop
	return [ShortcutAumid]::Get($LnkPath)
}

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

function Show-ShortcutStatus {
	$exists = Test-Path -LiteralPath $ShortcutPath
	Write-Host ('快捷方式：' + $ShortcutPath + '（' + $(if ($exists) { '存在' } else { '缺失' }) + '）')
	if (-not $exists) {
		Write-Host '   ⚠ 没有快捷方式 ⇒ 通知横幅顶部会显示「Windows PowerShell」；重跑 install.ps1 修复'
		return
	}
	$aumidNow = $null
	try { $aumidNow = Get-ShortcutAumid $ShortcutPath } catch { $aumidNow = $null }
	if ($aumidNow -eq $Aumid) {
		Write-Host ('   AUMID：' + $aumidNow + '（横幅顶部应为「二游日历」）')
	} elseif ($aumidNow) {
		Write-Host ('   ⚠ AUMID：' + $aumidNow + '（期望 ' + $Aumid + '，横幅会显示成别的应用）；重跑 install.ps1 修复')
	} else {
		Write-Host '   ⚠ 快捷方式存在但没写进 AUMID ⇒ 横幅会显示「Windows PowerShell」；重跑 install.ps1 修复'
	}
}

function Install-StartMenuShortcut {
	New-Item -ItemType Directory -Force -Path $ShortcutDir | Out-Null
	$linkTarget = Join-Path $env:SystemRoot 'System32\wscript.exe'
	if (-not (Test-Path -LiteralPath $linkTarget)) { $linkTarget = 'wscript.exe' }

	# 同一路径原地重建（覆盖）⇒ 重复安装不会多出第二个快捷方式。动作与计划任务保持一致。
	$shell = New-Object -ComObject WScript.Shell
	try {
		$sc = $shell.CreateShortcut($ShortcutPath)
		$sc.TargetPath = $linkTarget
		$sc.Arguments = '//B //NoLogo "' + $RunnerVbs + '"'
		$sc.WorkingDirectory = $InstallDir
		$sc.Description = '二游日历 · 到期提醒（零窗口启动器）'
		$sc.IconLocation = $IconLocation
		$sc.Save()
	} finally {
		[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
	}

	# 身份：把 AUMID 写进 .lnk 的 System.AppUserModel.ID，然后回读确认 —— 不确认就等于没验证
	Set-ShortcutAumid $ShortcutPath $Aumid
	$readBack = Get-ShortcutAumid $ShortcutPath
	if ($readBack -ne $Aumid) {
		Fail ('快捷方式已建好，但 AUMID 回读不一致（读到「' + $readBack + '」）—— 通知会退回 PowerShell 身份，见 README「排错」')
	}
	Write-Host ('✓ 已创建开始菜单快捷方式：' + $ShortcutPath)
	Write-Host ('   AUMID = ' + $readBack + ' ｜ 图标 = ' + $IconLocation)
}

function Show-Status {
	$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
	if (-not $task) {
		Write-Host ('未安装：找不到计划任务「' + $TaskName + '」')
		Write-Host '  安装：powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1'
		Show-ShortcutStatus
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
	Show-ShortcutStatus

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
	# 快捷方式带着 AUMID（应用身份），卸载后 toast.ps1 会自动退回 PowerShell 身份，仍然能弹
	if (Test-Path -LiteralPath $ShortcutPath) {
		Remove-Item -LiteralPath $ShortcutPath -Force
		Write-Host ('✓ 已删除开始菜单快捷方式：' + $ShortcutPath)
	} else {
		Write-Host ('· 开始菜单快捷方式「' + $ShortcutName + '」本来就不存在')
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

	# 应用身份：没有这一步，通知横幅顶部只能是「Windows PowerShell」
	Install-StartMenuShortcut

	Write-Host ''
	Show-Status
	Write-Host ''
	Write-Host '提示：装完可以先手动验一次：powershell -ExecutionPolicy Bypass -File tools\remind\remind.mjs --dry-run'
	Write-Host '     横幅顶部的应用名/图标由开始菜单快捷方式里的 AUMID 决定（应为「二游日历」）'
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
