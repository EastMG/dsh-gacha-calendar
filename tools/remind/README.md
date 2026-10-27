# 到期提醒（送达）

把「某个卡池 / 活动还有多久结束 / 开始」做成**真的会响的系统通知**：

```
缓存数据（core 直连）→ 派生提醒条目 → tick 判定多档节点 → 去重 → toast.ps1 弹通知 → 日志 + 状态
```

这是 `demo.mjs` / `demo-simple.mjs` 的**产品版**：判定逻辑抽成了平台无关的纯函数
（`lib/tick.mjs`），多档节点、去重状态、日志、计划任务安装都在这里；两个 demo 原样保留
（只作历史对比，**新代码不要再复制它们**，公共逻辑都在 `lib/`）。

## 目录

```
tools/remind/
├── remind.mjs          # 主程序：CLI + 配置 + 数据 + tick + 通知 + 日志（唯一入口）
├── remind-config.json  # 默认节点配置（示例；可复制到 %LOCALAPPDATA% 覆盖）
├── install.ps1         # 注册 / 查看 / 卸载 Windows 计划任务 + 开始菜单快捷方式（AUMID）
├── lib/
│   ├── derive.mjs      # 缓存 → 条目列表 { gameId, side, kind, title, T }（时区 / 墙钟换算）
│   ├── tick.mjs        # **纯函数** tick(now, items, config, state, options) → { toNotify, stateNext, stats }
│   ├── state.mjs       # state.json 读写（原子写：tmp + rename）
│   ├── data.mjs        # 缓存优先 / 过期或 --refresh 才让 core 抓一轮；所有路径都出自这里
│   ├── notify.mjs      # 调 toast.ps1（execFile；Windows only）
│   ├── config.mjs      # 节点配置：用户配置 → 仓库示例 → 内置默认 → CLI 覆盖
│   └── format.mjs      # 时间 / 时长 / 节点的显示格式（纯函数）
├── toast.ps1           # WinRT 系统通知（**不要改**：UTF-8 带 BOM，已验证能跑）
├── demo.mjs            # 历史 demo（每轮现场抓数据），保留不动
├── demo-simple.mjs     # 历史 demo（缓存优先），保留不动
└── README.md           # 本文件
```

运行产物都在 `%LOCALAPPDATA%\dsh-gacha-calendar\`（不写系统目录）：

| 文件 | 用途 |
|---|---|
| `cache.json` | 数据缓存 `{ at, source, data }`（`at` = 写盘毫秒时间戳） |
| `state.json` | 去重状态（平表，键 = `gameId\|side\|kind\|T`） |
| `remind.log` | 运行日志（追加；超过 1MB 轮转为 `remind.log.1`） |
| `remind-config.json` | 节点配置（安装时自动生成；用户可改） |
| `remind-run.vbs` | 计划任务用的零窗口启动器（安装时生成，卸载时删除） |

## 快速开始

```powershell
# 1) 干跑：只看它判成什么，不弹、不写状态
node tools/remind/remind.mjs --dry-run

# 2) 真弹一条（--limit=1 避免一次刷屏）
node tools/remind/remind.mjs --limit=1

# 3) 再跑一次：上一次发过的档位会被「去重跳过」
node tools/remind/remind.mjs --dry-run

# 4) 忽略去重、强制重发（调试用；同一轮里仍只发最紧急的那一档）
node tools/remind/remind.mjs --all --dry-run

# 5) 注册成计划任务（每 30 分钟，当前用户，无窗口）
powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1

# 6) 查看 / 卸载
powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Status
powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Uninstall
```

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--hours=N` | — | **单节点模式**（调试用）：结束与开始都只留 `T-Nh`；与 `--nodes` 互斥 |
| `--nodes=a,b,c` | 配置 / 内置 | 结束方向的节点（小时），如 `--nodes=72,24,6,2` |
| `--start-nodes=a,b` | 配置 / 内置 | 开始方向的节点（小时），如 `--start-nodes=24,2` |
| `--ttl-hours=N` | `6` | 缓存有效期（小时）；超过就重抓 |
| `--refresh` | 关 | 忽略缓存，强制让 core 抓一轮并写回 |
| `--dry-run` | 关 | 只打印：**不弹通知、不写状态**（缓存仍会写） |
| `--limit=N` | `3` | 本轮最多产生几条通知；`0` = 只统计不弹。**被截断的条目不记已发**（下一轮补） |
| `--all` | 关 | 忽略状态强制重发；同一轮内仍只发最紧急的一档 |
| `--json` | 关 | stdout 只输出机器可读 JSON（完整计划 / 统计 / 结果）；日志照常写文件 |
| `--help` | — | 帮助 |

退出码：`0` 正常 ｜ `1` 失败（抓取异常 / 送达失败 / 状态写失败 / 非 Windows 真弹） ｜ `2` 参数错误。

## 提醒规则（tick）

**节点**（每个「到期时刻 T」配多档提醒，两套都保留配置入口）：

- 结束：`T-72h`、`T-24h`、`T-6h`、`T-2h`
- 开始：`T-24h`、`T-2h`

对每个条目、每个该方向的节点 `n`：`dueAt = T - n 小时`，`now >= dueAt` 且没发过 ⇒ 候选。

**同一件事**（同一 `gameId|side|kind|T`）若多个节点同时到期（机器休眠 / 首次运行 / 节点配得很宽
都会这样）⇒ **只发最紧急的**（`n` 最小的那一档），其余到期节点一并标记为已发 —— 不补发风暴、不刷屏。

**T 已过**（条目已结束 / 已开始）⇒ 整条记录作废，不发，状态里的键一并清掉。

```
tick(now, items, config, state):
  for 每个条目、每个该方向的节点 n:
      dueAt = T - n 小时
      if now >= dueAt && 该节点未发过:  候选
  同一件事多个节点同时到期 ⇒ 只发 n 最小的，其余一并记为已发
  T 已过 ⇒ 整条作废，不发
```

### 为什么"跟 tick 频率无关"

`lib/tick.mjs` 是**纯函数**：不读时钟、不读文件、不发通知、不看进程环境。
判定只取决于 `now` + 数据，所以同一时刻无论跑多少次、由谁跑（计划任务 / 扩展 alarms /
打开 App 时补跑），结果都一样；差别只在"谁来送达"。

```js
import { tick } from "./tools/remind/lib/tick.mjs";

const { toNotify, stateNext, stats } = tick(now, items, config, state, { limit: 3 });
// toNotify: 这一轮要发的（每条已合并成"只发最紧急"）
// stateNext: 落盘用的下一份状态（含清理）
// stats: 候选 / 合并 / 去重 / 清理 计数（只用于日志）
```

`items` 的每一条只需：

```js
{ gameId, side, kind: "end" | "start", title, T, startTs, endTs, key? }
```

`state` 就是 `state.json` 的内容，`config` 是 `{ endNodes, startNodes }`。
宿主可以完全不 import `remind.mjs`（它带 CLI 与 Windows 送达），只接 tick + 自己的送达。

### 状态里为什么要存"节点小时数"

`fired: [72, 24]` 表示这一期已经打扰过 T-72h 和 T-24h 两档。下一轮补跑时才能判断
"哪几档已经发过"；如果存时间戳，"节点改配置"后就无法解释历史。键里带 T ⇒ 新一期（时间戳变）
天然是新键，会重新提醒。

## 配置

三层，后者覆盖前者：

1. **内置默认**（`lib/tick.mjs` 的 `DEFAULT_CONFIG`）：结束 `[72,24,6,2]`，开始 `[24,2]`
2. **配置文件**，按顺序找：
   - `%LOCALAPPDATA%\dsh-gacha-calendar\remind-config.json`（用户可改；`install.ps1` 首次安装时复制一份）
   - `tools/remind/remind-config.json`（仓库自带示例）
   - 读不到 / 读坏了 ⇒ **回落到默认**（坏文件会在日志里 warning，不会让提醒停摆）
3. **CLI 覆盖**：`--hours=N` / `--nodes=…` / `--start-nodes=…`

配置文件形状（就这两个键）：

```json
{
  "endNodes": [72, 24, 6, 2],
  "startNodes": [24, 2]
}
```

节点是**小时数**，必须 `> 0`；重复项会去重、内部按"宽松 → 紧急"排序（`72,24,6,2`）。
每次运行都重新读配置 ⇒ 改完下一轮就生效，不用重启任何东西。日志头部会打印
`配置来源：结束 ← … ｜ 开始 ← …`，一眼能看出当前生效的是哪一份。

## 状态文件

`%LOCALAPPDATA%\dsh-gacha-calendar\state.json`：

```json
{
  "ba-jp|event|end|1793113200000": { "fired": [72, 24] },
  "ba-jp|gacha|end|1793152740000": { "fired": [72, 24] }
}
```

- 键 = `gameId|side|kind|T`（`T` = 该方向绝对毫秒时间戳）。**带 `side`** 是因为同一款游戏的
  卡池与活动经常在同一刻结束，少这一段会让后一条被前一条静默压掉。
- 值只有 `fired`（已发过的节点小时数）。没有版本壳子、没有元数据 —— 面板 / 其它宿主可以直接读。
- **清理**：每轮 tick 会把"键里的 T 已过"的记录删掉；条目结束了，记录就没有保留价值。
- **只在真的送达成功时**才记已发：失败不记 ⇒ 下一轮自动重试，不会静默漏掉。
- 写盘用「同目录临时文件 + rename」原子替换，`%LOCALAPPDATA%` 下不会出现半截 JSON。
- 文件损坏（非法 JSON / 顶层不是对象）⇒ 按空状态继续（最坏只是同一档再提醒一次），日志里会写明。

## 日志

`%LOCALAPPDATA%\dsh-gacha-calendar\remind.log`，每次运行追加一段：

```
===== 2026-10-27 12:44:12 UTC+08:00 ｜ node tools/remind/remind.mjs --limit=1 ｜ pid 12345 =====
[2026-10-27 12:44:12] 二游日历 · 到期提醒（送达）
[2026-10-27 12:44:12]   节点：结束 T-72h / T-24h / T-6h / T-2h ｜ 开始 T-24h / T-2h（共 6 档）
...
----- 退出码 0 · 用时 479 ms -----
```

- 同一轮的所有行共享同一个运行头，排查时按 `=====` 分段。
- 只追加，不覆盖；**超过 1MB 轮转一次**：`remind.log` → `remind.log.1`（只保留一份历史）。
- 计划任务跑的时候没有控制台，日志是唯一的事后证据；`--json` 也一样会写日志，只是 stdout 换成 JSON。

## 安装计划任务

```powershell
# 默认每 30 分钟
powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1

# 改成每 15 分钟（重跑即覆盖，幂等）
powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -IntervalMinutes 15

powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Status
powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Uninstall
```

`install.ps1` 做了什么：

- 任务名 `dsh-gacha-calendar-remind`，**当前用户**、`LogonType=Interactive`（只在该用户登录时运行）、
  `RunLevel=Limited` —— 不需要管理员，也不弹 UAC。
- 触发器：现在 +2 分钟第一次，之后每 `-IntervalMinutes` 分钟重复（默认 30，范围 5~1440）。
- 设置：`StartWhenAvailable`（错过时尽快补跑）、`Hidden`、插电 / 电池都跑、
  `MultipleInstances=IgnoreNew`、单次最长 30 分钟。
- 动作：`wscript.exe //B //NoLogo remind-run.vbs`，工作目录 = `%LOCALAPPDATA%\dsh-gacha-calendar`。
- 启动器 `remind-run.vbs`（UTF-16LE）用 `WScript.Shell.Run(cmd, 0, False)` 起 node：
  第二个参数 `0` = `SW_HIDE`，这是**唯一能保证不闪黑窗**的方式；node 的输出只进 `remind.log`。
  每次运行固定 `--limit=3`（防某轮大量条目同时到期时刷屏，想改就改启动器 / 重跑安装）。
- 首次安装会把仓库里的 `remind-config.json` 复制到 `%LOCALAPPDATA%`（已存在则**不覆盖**）。
- 在开始菜单建「二游日历.lnk」并写入 AUMID（见下一节「应用身份」）；`-Uninstall` 会一并删除。

`-Status` 会打印任务状态、间隔、**下次运行时间**、上次运行 / 结果、启动器 / 脚本 / 日志路径，
并做一次**路径漂移检查**（仓库被移动、node 升级换了路径时提示重跑安装），
外加**快捷方式是否存在、里面写的 AUMID 是什么**。

## 应用身份（AUMID / 横幅顶部的应用名）

通知横幅**顶部**那行应用名和图标，不是 toast XML 能决定的（XML 里没有这个字段），而是由
**AUMID（AppUserModelID）** 决定的。Windows 对「非打包应用」的规则很死板：

> 身份 = 开始菜单里的一条带 `System.AppUserModel.ID` 的快捷方式。

所以 `install.ps1` 会建这条快捷方式：

| 项 | 值 |
|---|---|
| AUMID | `DshGachaCalendar.Reminder`（`toast.ps1` 里是同一个常量，改一处必须同步改另一处） |
| 快捷方式 | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\二游日历.lnk` |
| 目标 | `wscript.exe //B //NoLogo "<LOCALAPPDATA>\dsh-gacha-calendar\remind-run.vbs"`（与计划任务动作一致） |
| 工作目录 | `%LOCALAPPDATA%\dsh-gacha-calendar` |
| 图标 | `%SystemRoot%\System32\timedate.cpl,0`（系统「日期和时间」图标 = 日历 + 时钟） |

AUMID **不是**快捷方式的普通字段（`TargetPath` / `Arguments` 那一层），只能通过 shell 的
`IPropertyStore` 写：属性键 `PKEY_AppUserModel_ID` = `{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, 5`，
接口 `IID_IPropertyStore` = `{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}`，入口
`SHGetPropertyStoreFromParsingName(路径, NULL, GPS_READWRITE, …)`。`install.ps1` 用内联 C#
（`Add-Type`，约 45 行）做这件事，写完**立刻回读**核对；`-Status` 也会把读到的 AUMID 打出来。
重复安装是原地覆盖（同一个路径、同一个文件名），不会出现第二条快捷方式。

`toast.ps1` 的三级兜底（顺序固定，`stdout` 会写明这次用的是哪一级：`ok: … ｜ AppId 第N级…`）：

1. **第1级** `DshGachaCalendar.Reminder` —— 快捷方式存在才试 ⇒ 横幅顶部显示「二游日历」+ 图标；
2. **第2级** `{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe` ——
   没装快捷方式 / 第1级抛异常 ⇒ 照样能弹，但横幅顶部显示「Windows PowerShell」；
3. **第3级** `CreateToastNotifier()` 空参 —— 有包标识的宿主环境偶尔能用。

三级都失败才非 0 退出。所以「没安装」不等于「弹不出来」，只等于「名字难看」。

### 为什么图标是系统图标

仓库 `assets/` 下只有面板截图（`screenshot-*.png`），**没有** `.ico` / 图标 png，所以先借系统的
「日期和时间」图标（`timedate.cpl` 第 0 号 = 日历 + 时钟，Win10/11 都有）。要换成自己的图标：

1. 把 `.ico` 拷到一个**固定路径**（例如 `%LOCALAPPDATA%\dsh-gacha-calendar\app.ico`，由安装脚本复制）；
2. 改 `install.ps1` 里的 `$IconLocation`（`'<路径>,0'`），重跑安装即可。

不要直接把图标路径指到仓库里的文件 —— 仓库一移动，快捷方式图标就变成白纸。

## 排错

**没弹通知？按顺序查：**

1. `--dry-run` 看有没有"本轮送达计划"。没有 ⇒ 要么数据里没有到期条目（`--refresh` 重抓），
   要么这些档位已经发过（`--all --dry-run` 能强制列出，确认是不是去重）。
2. 真弹一次：`node tools/remind/remind.mjs --limit=1`。看日志里有没有 `✓ 已送达`；
   失败会带 toast.ps1 的 stderr 与退出码。
3. **专注助手 / 勿扰模式 / 通知总开关**会把通知静默吞掉：`Show()` 不报错，但横幅不出现。
   脚本只能如实报告"已提交给通知中心"，不能保证"你看见了"。
4. 日志里出现 `✗ 当前平台不是 Windows` ⇒ 判定可以跑，送达没有实现（见「跨平台」）。
5. `✗ 状态写入失败` ⇒ 检查 `%LOCALAPPDATA%\dsh-gacha-calendar` 的权限 / 磁盘。

**横幅顶部还是「Windows PowerShell」？**

按顺序查（三条都能自己验证，不用猜）：

```powershell
# 1) 快捷方式在不在（不在 ⇒ 必然回退到 PowerShell 身份）
Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\二游日历.lnk"

# 2) 快捷方式里写的 AUMID 对不对（-Status 会打印这一行）
powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Status

# 3) 最近一条通知记在哪个应用名下：读得到 = 新身份已生效
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory('DshGachaCalendar.Reminder').Count
```

- 快捷方式缺失 / AUMID 为空 / AUMID 不对 ⇒ 重跑 `install.ps1`（幂等，会重建并回读核对）。
- 三条都对但横幅外观没变 ⇒ 可能是 Explorer 缓存了旧的应用身份：注销重登（或重启 Explorer）再看。
  **不要**去 toast XML 里塞应用名 —— 那个位置没有对应字段，塞了也不会显示。
- 想确认「这次到底走的哪一级」：把 `toast.ps1` 直接跑一次，看它的 `stdout`；
  或者查 PowerShell 那个 AUMID 的 history —— 里面出现新条目就说明走了第2级兜底。

**计划任务没跑？**

```powershell
powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Status
Get-ScheduledTaskInfo -TaskName dsh-gacha-calendar-remind | Format-List *
```

- `上次结果` 是 `0` 但日志没新增 ⇒ 看 `-Status` 里的"启动器 / 脚本"路径是否还存在（仓库移动了？）。
- 登录前 / 锁屏时也能跑的前提是「用户已登录」；**关机或注销期间不会跑**，开机登录后
  `StartWhenAvailable` 会补一次。
- 企业策略可能禁用 Windows Script Host（启动器是 `.vbs`）⇒ 任务结果非 0、日志无新增。
  这时的替代做法是把任务动作改成
  `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File <你自己写的 .ps1>`
  （可能闪一下窗口），或者把 `remind.mjs` 注册成开机自启项。
- 改了 `-IntervalMinutes`/仓库位置/node 路径 ⇒ 重跑 `install.ps1`（幂等，会覆盖任务与启动器）。

**中文乱码？** 日志是 UTF-8 无 BOM；`install.ps1` 是 UTF-8 **带** BOM（含中文，Windows PowerShell
5.1 需要 BOM 才不乱码）；`toast.ps1` 不要动。`remind.mjs` / `lib/*.mjs` 是 UTF-8 无 BOM。

**参数报错（退出码 2）？** `--hours` 与 `--nodes`/`--start-nodes` 互斥；节点必须是 `> 0` 的小时数；
`--limit` 必须是整数。错误信息会直接说明收到的是什么。

## 已知限制

1. **专注助手 / 勿扰会吞通知**：`Show()` 成功 ≠ 用户看见。日志写「已送达（已提交通知中心）」，
   别把它当「用户已读」。
2. **休眠 / 关机期间会错过**：用的是「错过时尽快补跑一次」。补跑策略是**只发最紧急的一档**
   （例如合盖 3 天后打开，只发 T-24h 那条，不会把 72/24/6 三条一起补出来）—— 这是刻意的。
3. **数据源仍在每轮真抓（TTL 过期时）**：缓存 6 小时，过期那一轮要让 core 直连抓 28 个源
   （demo 实测 8~14 秒）。源站抖动时该轮提醒可能少几条。
4. **快照接口仍被宿主挡 403**：产品形态本来最省的路是读插件的内存快照，实测拿不到
   （宿主对所有路径回 `text/plain: forbidden`，连 `/` 都是）。所以数据依旧走 core 直连。
   这条不解决，「零网络开销的定时提醒」就立不住。分析见 git 历史里的旧 README（`e8d848d`）。
5. **只取每侧一条外显档期**：同一格里的「并行多池 / 多条活动」在 `bannerHover` / `eventHover`
   的多行文本里，本工具**不展开**。所以开始提醒只在源站把下一期写进外显档期时才会命中。
6. **开始提醒≈很少命中**：真实数据里每侧通常只给"当前这一期"的起止，开始时刻多半已经过去，
   派生阶段就会跳过（日志里显示"已过 T 的跳过 N 个方向"）。这是数据形态，不是漏判。
7. **年份补全按当前年**：`MM-DD HH:MM` 形态不带年份，12 月看 `01-03` 这类跨年文本可能补错一年
   （core 面板同口径）。带年份的文本以源站为准。
8. **读不出档期的文本不硬猜**：`长期`、`X版本更新后 ~ …` 这类会如实计数并跳过。
9. **无 tz 的条目按本机时区解释**（与 core 面板兜底一致）。
10. **横幅顶部的应用名取决于「有没有装」**：装过 `install.ps1`（快捷方式 + AUMID 都在）⇒ 顶部应是
    「二游日历」；没装 / 快捷方式被删 ⇒ `toast.ps1` 退回 PowerShell 的 AUMID，顶部显示「Windows PowerShell」。
    **这条无法用 API 证明**：Windows 没有公开接口能读「横幅顶部将显示什么名字」。能机器验证的只有
    ①通知记在哪个 AUMID 名下（`History.GetHistory(<AUMID>)`）②快捷方式里写的 AUMID 与文件名
    （「二游日历.lnk」）。外观仍需肉眼确认一次；图标借的是系统日历图标（仓库里没有 ico，见上）。
11. **没有并发锁**：两次运行理论上有机会互相覆盖状态（计划任务是串行的、命中缓存时单轮 < 1 秒，
    实际很难撞上）。要接多宿主（扩展 + 计划任务同时跑）时，得加锁或让宿主只保留一个 tick 源。
12. **计划任务只在 Windows**：`notify.mjs` 与 `install.ps1` 是 Windows 实现；`tick` / `derive` /
    `state` / `format` 平台无关（非 Windows 上 `--dry-run` 可跑，真弹会以退出码 1 明确失败）。
13. **`--limit` 截断的条目下一轮才发**：被截断的条目不记已发，不会丢；但也意味着"一轮最多 N 条"。
14. **日志只保留一份历史**：`remind.log` + `remind.log.1`，更早的丢弃（1MB 量级 ≈ 上百轮）。

## 面板接入预留

现在**没有任何面板入口**（`src/` 一行没改），但下面这些是给面板留好的接口：

- **配置项叫什么**：`endNodes` / `startNodes`（小时数组）。
- **在哪读**：`lib/config.mjs` 的 `resolveNodeConfig({ userFile, bundledFile, overrides })`；
  每次运行都读，路径固定为 `%LOCALAPPDATA%\dsh-gacha-calendar\remind-config.json`。
- **面板怎么写**：把上面那个 JSON 写进同一路径即可（写 `tmp` + rename 更稳），下一轮运行自动生效；
  不需要重启插件、不需要通知本工具。写坏了也不会停摆（回落到默认并 warning）。
- **面板怎么展示"已提醒到哪一档"**：直接读 `state.json`（平表，键 `gameId|side|kind|T`，
  值 `fired`）。`T` 与 `tick` 的入参同源，面板可以据此显示"已发 T-24h，下次 T-2h"。
- **面板想预览/手动触发**：`node tools/remind/remind.mjs --dry-run --json`（机器可读、不弹不写状态），
  或 `--limit=N` 手动弹；`--json` 的 `tick.toNotify` 就是"下一次会发什么"。
- **面板想自己定时**（不装计划任务）：import `lib/tick.mjs`（零依赖、纯函数），自己拿 `now` 调；
  扩展 alarms 每 30 分钟一次即可，与计划任务并存时建议只留一个 tick 源（见已知限制 11）。
- **未来要加的维度**（逐游戏白名单 / 静音时段 / 补发策略）：加**独立配置键**，在 `derive` 之后、
  `tick` 之前过滤 `items`，或作为 `tick` 的 options —— 不要塞进 `endNodes` / `startNodes`，
  这两个数组只表示"小时数节点"。
- **安装状态**：`install.ps1 -Status` 已能给出下次运行时间与路径漂移检查，面板可以解析它的输出，
  或直接 `Get-ScheduledTask -TaskName dsh-gacha-calendar-remind`。

## 验收命令清单

```powershell
node tools/remind/remind.mjs --dry-run                        # 候选 / 命中 / 状态里已发
node tools/remind/remind.mjs --nodes=336,24 --dry-run         # 多节点同时到期 ⇒ 只发最紧急
node tools/remind/remind.mjs --limit=1                        # 真弹一条
node tools/remind/remind.mjs --dry-run                        # 第二次：已发档位被跳过
node tools/remind/remind.mjs --all --dry-run                  # 忽略去重，强制列出
powershell -ExecutionPolicy Bypass -File tools\remind\install.ps1 -Status
Get-Content "$env:LOCALAPPDATA\dsh-gacha-calendar\state.json"

# 应用身份是否生效（读得到 = 通知记在「二游日历」名下，而不是 PowerShell）
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory('DshGachaCalendar.Reminder').Count
```

## 与历史 demo 的关系

- `demo.mjs`（现场抓 / 判定 / 去重 / 送达）与 `demo-simple.mjs`（缓存优先）**保留不动**，
  用来对照"从 demo 到产品版"的演进；它们的旧 README 内容（快照 403 的完整实测表等）见
  git 历史（提交 `e8d848d`）。
- demo 的状态文件在 `%LOCALAPPDATA%\dsh-gacha-remind\`，与产品版 `%LOCALAPPDATA%\dsh-gacha-calendar\`
  **互不覆盖**，可以同时跑。
- 新代码只从 `lib/` 拿公共逻辑：`derive.mjs` 的时区 / 墙钟换算是 demo-simple 里验证过的那段
  （原样复用，行号注释在文件头），不要再复制第三份。
