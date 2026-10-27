<#
  toast.ps1 —— 用 Windows 自带的 WinRT Toast 弹一条系统通知（零安装、无第三方模块）

  WHY（为什么自己写）：BurntToast 之类要先装模块，而本 demo 的硬约束是「零依赖」。
  Windows 10/11 自带 Windows.UI.Notifications（WinRT），PowerShell 直接就能调。

  AppId 兜底（这是本脚本唯一需要"猜"的地方）：
    ToastNotificationManager.CreateToastNotifier(<某个 AppId>) 只接受**已注册的 AUMID**。
    我们没装应用、也不该为了一个 demo 去写注册表，所以：
      ① 先用 Windows PowerShell 自己的 AUMID：{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe
      ② 它失败就回退 CreateToastNotifier() 空参（某些有包标识的环境反而能用）
    两个都失败 → 往 stderr 打原因、非 0 退出。
    副作用（如实说明）：系统横幅顶部的应用名显示的是「Windows PowerShell」而不是本 demo 的名字 ——
    -AppName 只进 toast 底部的 attribution 行与日志。

  调用方式（Node 侧 child_process.execFile 直接调，脚本内不弹任何交互式窗口）：
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File toast.ps1 `
      -Title "即将结束 · 原神" -Body "活动「往冥府的安魂歌」\n11-03 14:59 结束\n还剩 7 天 3 小时"

  参数：
    -Title     通知标题（必填，缺失时直接失败退出，不会弹输入框）
    -Body      正文；多行用字面 \n 或真实换行分隔
    -AppName   来源名，默认「二游日历」
    -ClickUrl  可选，点击通知时打开的地址（协议或 URL；unpackaged 下能否真的打开取决于系统关联）
  退出码：0 = 已提交给通知中心；非 0 = 失败（原因在 stderr），调用方据此记日志，不要因此崩溃。
#>
param(
	[string]$Title = "",
	[string]$Body = "",
	[string]$AppName = "二游日历",
	[string]$ClickUrl = ""
)

$ErrorActionPreference = "Stop"

# 让 Node 侧拿到的 stdout/stderr 是 UTF-8（否则 Windows PowerShell 会按控制台 OEM 代码页写管道，中文变乱码）
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Exit-Fail([string]$Message) {
	try { [Console]::Error.WriteLine("toast.ps1: " + $Message) } catch { }
	exit 1
}

if ([string]::IsNullOrWhiteSpace($Title)) { Exit-Fail "缺少 -Title（本脚本不弹交互式输入）" }

# ── 1) 载入 WinRT 投影（Win10/11 自带；无桌面会话 / 通知服务不可用的机器会在这里就抛）──
try {
	[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
	[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
	[void][Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
} catch {
	Exit-Fail ("无法载入 WinRT 通知组件（当前会话可能没有桌面 / 通知服务不可用）：" + $_.Exception.Message)
}

# ── 2) 组装 toast XML ──────────────────────────────────────────────────────────
# 一律先 XML 转义：卡池/活动名里出现 & < > " 一点都不罕见（如「A&B」），不转义会让 LoadXml 直接抛。
$Esc = { param($s) [System.Security.SecurityElement]::Escape([string]$s) }

$BodyLines = @()
foreach ($line in ($Body -split "\\n|\r?\n")) { if ($line -ne "") { $BodyLines += $line } }

$Texts = "<text>" + (& $Esc $Title) + "</text>"
foreach ($line in $BodyLines) { $Texts += "<text>" + (& $Esc $line) + "</text>" }
# 底部署名：让"这条通知是谁发的"在横幅里可见（系统顶部的应用名由 AppId 决定，改不了）
$Texts += '<text placement="attribution">' + (& $Esc $AppName) + "</text>"

if ([string]::IsNullOrWhiteSpace($ClickUrl)) {
	$Activation = "foreground"
	$LaunchAttr = ""
} else {
	$Activation = "protocol"
	$LaunchAttr = ' launch="' + (& $Esc $ClickUrl) + '"'
}
$XmlText = '<toast activationType="' + $Activation + '"' + $LaunchAttr + '><visual><binding template="ToastGeneric">' + $Texts + '</binding></visual></toast>'

$ToastXml = New-Object Windows.Data.Xml.Dom.XmlDocument
try {
	$ToastXml.LoadXml($XmlText)
} catch {
	Exit-Fail ("toast XML 非法： " + $_.Exception.Message + " / " + $XmlText)
}

try {
	$Toast = New-Object Windows.UI.Notifications.ToastNotification $ToastXml
} catch {
	Exit-Fail ("构造 ToastNotification 失败：" + $_.Exception.Message)
}

# ── 3) 送达：AppId 兜底 ────────────────────────────────────────────────────────
$PrimaryAppId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
$Attempts = @(
	@{ Id = $PrimaryAppId; Label = "Windows PowerShell AUMID" },
	@{ Id = "";             Label = "CreateToastNotifier() 空参" }
)

$Shown = $false
$Errors = @()
foreach ($Attempt in $Attempts) {
	try {
		if ($Attempt.Id -ne "") {
			$Notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Attempt.Id)
		} else {
			$Notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier()
		}
		$Notifier.Show($Toast)
		$Shown = $true
		break
	} catch {
		$Errors += ($Attempt.Label + " → " + $_.Exception.Message)
	}
}

if (-not $Shown) {
	Exit-Fail ("两条 AppId 都失败（通知没送达）：" + ($Errors -join "  ｜  "))
}

# 注意：Show() 不抛异常 ≠ 用户一定看见 —— 专注助手 / 勿扰模式 / 通知总开关关闭时，
# 系统会照收不误但静默吞掉。脚本无法区分这两种情况，只能如实报告"已提交给通知中心"。
Write-Output ("ok: " + $AppName + " / " + $Title)
exit 0
