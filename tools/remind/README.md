# 到期提醒（送达）demo

一个**独立可运行**的 demo，演示「到期提醒」的完整链路：

```
core 引擎现场拉数据 → 判定「即将结束 / 即将开始」→ 状态文件去重 → 弹系统通知（toast）
```

**它不接进插件本体**（`src/` 一行没改）、不改测试、不动版本号 —— 只是为了把「送达」这条链路
先跑通、把坑记下来。真正的产品形态见下面「下一步」。

```
tools/remind/
├── demo.mjs     # 主流程：拉数据 → 判定 → 去重 → 送达（Node，ESM，零依赖）
├── toast.ps1    # WinRT 系统通知（Windows 自带，零安装；不需要 BurntToast）
└── README.md    # 本文件
```

## 怎么跑

先干跑（不发通知、不写状态文件，只看它判成什么）：

```powershell
node tools/remind/demo.mjs --dry-run                    # 默认提前量 2 小时
node tools/remind/demo.mjs --dry-run --hours=336        # 14 天窗口，能看到更多条目
```

确认没问题，再真弹一条（`--limit=1` 避免一次刷屏）：

```powershell
node tools/remind/demo.mjs --hours=336 --limit=1
```

连跑两次，第二次会显示「已通知过，跳过」（去重生效）：

```powershell
node tools/remind/demo.mjs --hours=336 --limit=1
```

调试时想强制重弹（忽略去重）：

```powershell
node tools/remind/demo.mjs --hours=336 --limit=3 --all
```

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--hours=N` | `2` | 提前量（小时）。**双向**：结束落在 `(now, now+N]` 判「即将结束」，开始落在 `(now, now+N]` 判「即将开始」 |
| `--dry-run` | 关 | 只打印：不弹通知、**也不写状态文件**（所以干跑不会污染去重） |
| `--all` | 关 | 忽略去重、强制重弹（仍会记录本次通知） |
| `--limit=N` | `3` | 最多弹几条。`0` = 只统计不弹 |
| `--help` | — | 帮助 |

退出码：`0` 正常；`2` 参数错误；`1` 送达失败或整轮抓取异常（demo 不会因单条通知失败而崩）。

## 四步链路

### 1) 拉数据：core 直连（和插件 UI 同源）

`demo.mjs` 直接 `import { createEngine } from "../../packages/core/core.mjs"`，注入三样东西后
`refresh()` 一轮：

- `transport.fetchRaw` → node 的 `fetch`（返回 WHATWG Response，core 自己看 `ok/status/text`）
- `transport.fetchViaProxy` → 同样直连（node 没有 CORS；DSH 里这一步是宿主代发，见 `src/client/92-dsh-env.js`）
- `storage` → 内存 `Map`（demo 不落盘，也不读插件的设置库）

实测：**约 8~14 秒 / 28 条记录**（core 里 5 个「出厂默认隐藏」条目在默认配置下不抓，所以实际
是 23 个条目、44 个能还原出档期的「卡池侧 / 活动侧」）。

### 2) 判定：每个条目算「即将结束 / 即将开始」

一条「条目」= 某款游戏的**卡池侧**或**活动侧**（`banner`/`bannerDates` 与 `event`/`eventDates`）。

```
结束：startTs <= now 且 endTs ∈ (now, now + 提前量]
开始：startTs ∈ (now, now + 提前量]
```

两个方向天然互斥，输出里分别标 `[即将结束]` / `[即将开始]`。

这里有两个 **demo 自己要补** 的点（都是因为 core 没把对应能力放进公开接口）：

- **档期文本 → 绝对时刻**：Result JSON 里只有文本（`bannerDates` 是**源站墙钟**），没有 `startTs/endTs`。
  文本按源站时区 `tz` 换算成绝对时刻，才是"还剩多久"的真值。`tz` 也不在 Result JSON 里
  （`CONTENT_FIELDS` 只有文本），demo 从 core 如实暴露的注册表 `engine.__test.SOURCES` 取同一份。
  这一步的标准实现其实在 UI 层：`src/client/80-components.js` 的 `localDatesOf` / `localWinText`。
- **判定函数**：`parseDisplayRange` / `dueKindOf` 都定义在 core 的闭包里、没导出，demo 照抄了同等实现
  （`packages/core/core.mjs` 的 `parseDisplayRange` 与 `dueKindOf`），并**额外**接受带年份的
  `YYYY-MM-DD HH:MM`（否则赛马娘日服 / 少前2 那种源站直出年份的条目会被当成「读不出档期」丢掉）。

### 3) 去重：`%LOCALAPPDATA%\dsh-gacha-remind\demo-state.json`

```json
{
  "version": 1,
  "updatedAt": "2026-10-27T03:11:53.055Z",
  "notified": {
    "ba-jp|event|end|1793113200000": "2026-10-27T03:11:38.069Z"
  }
}
```

- 键 = `gameId|side|kind|时间戳`（时间戳 = 该条目的 `endTs` 或 `startTs`）。
  **比"gameId|kind|时间戳"多一段 `side`**：同一款游戏的卡池与活动**常常在同一刻结束**
  （鸣潮 / 绝区零的卡池与当期活动就是同一秒），少这一段会让后一条被前一条静默压掉。
- 每轮先**清理过期项**（键里的时间戳已经过去的记录不再需要，窗口不会回来）。
- **只在真的送达成功时**才记状态：失败不记 ⇒ 下一轮会自动重试，不会静默漏掉。
- 写盘用「同目录临时文件 + rename」替换，避免写一半留下坏文件。

### 4) 送达：`toast.ps1`

`demo.mjs` 用 `child_process.execFile` 调：

```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File toast.ps1 `
  -Title "即将结束 · 蔚蓝档案·日服" -Body "活动「…」\n10-20 23:00 → 10-27 23:00 结束\n还剩 11 小时 48 分" `
  -AppName "二游日历"
```

- `-NoProfile -NonInteractive` + `windowsHide: true`：不读用户配置、不弹交互式窗口、不闪黑窗。
- **AppId 兜底**（`toast.ps1` 唯一需要"猜"的地方）：`CreateToastNotifier(<AppId>)` 只接受**已注册的 AUMID**。
  先试 Windows PowerShell 自己的 `{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`，
  失败再回退 `CreateToastNotifier()` 空参；两个都失败 → stderr 打原因、非 0 退出（调用方记日志，不崩）。
  副作用：横幅顶部的应用名是「Windows PowerShell」，`-AppName` 只进底部的 attribution 行与日志。
- 失败路径实测：空标题 → `toast.ps1: 缺少 -Title（本脚本不弹交互式输入）` + 退出码 1。
- XML 文本一律 `SecurityElement::Escape`（卡池名里 `&`、`<` 不罕见）。

**注意**：`Show()` 不抛异常 ≠ 用户一定看见。专注助手 / 勿扰模式 / 通知总开关关闭时系统照收不误、
静默吞掉；脚本只能如实报告「已提交给通知中心」。

## 验收时的实测输出

`node tools/remind/demo.mjs --dry-run`（当时 2026-10-27 11:10，Asia/Shanghai）：44 条候选，
0 条命中 2 小时窗口（那个时刻确实没有条目在这 2 小时内到期），并给出窗口外最近的 5 条作参照。

`node tools/remind/demo.mjs --dry-run --hours=336`：**28 条命中**（最近的是蔚蓝档案·日服活动，
11 小时 48 分后结束），证明 `--hours` 生效。

`node tools/remind/demo.mjs --hours=336 --limit=1`：真弹出一条，内容为
`即将结束 · 蔚蓝档案·日服 / 活动「特殊作战 寻找洛亚第三季」/ 10-20 23:00 → 10-27 23:00 结束 / 还剩 11 小时 48 分`；
随后用 `ToastNotificationManager.History.GetHistory(<AppId>)` 读到同一条 toast 的 XML，确认真的进了通知中心。

再跑一次：`↷ 已通知过，跳过 · [即将结束] 蔚蓝档案·日服 / 活动`（去重生效）。

## 已知问题

### 1) 快照接口 `/api/gacha-calendar-snapshot.json` 被挡（403）—— 本 demo 因此不走它

这是本次要独立做 demo 的直接原因。产品形态里最省的一条路本来是：本机定时任务直接 GET 插件
发布的内存快照。实测拿不到。

**实测方式与结果**（2026-10-27，本机 DSH 桌面端 GUI 在 `http://127.0.0.1:43120`）：

| 请求 | 结果 |
|---|---|
| `GET /api/gacha-calendar-snapshot.json` | **403**，`text/plain`，body 就三个字 `forbidden` |
| 同上 + `?token=x` | **403**，同上 |
| 同上 + `Origin` / `Referer` 同源 | **403** |
| 同上 + `Sec-Fetch-Site: same-origin` / `Sec-Fetch-Mode: cors` | **403** |
| 同上 + `Authorization: Bearer x` / `x-dsh-token` / `x-api-key` | **403** |
| `GET /`（根路径） | **403** —— 说明拦截在**宿主层**，不是插件的 `snapshotHandler` |
| `GET /api/does-not-exist-xyz`（随便一个不存在的路径） | **403** —— 同上，宿主对所有路径都拦 |
| 用真实 Chromium（Playwright）直接导航到该 URL | **403** |

判据：插件自己的 `snapshotHandler` 出错时回的是 JSON（如 `{"error":"loopback-only"}`）或 `204`，
而这里拿到的是 `text/plain` 的 `forbidden`、`cache-control: no-store`、`x-content-type-options: nosniff`
—— 请求根本没走到插件路由。连 `/` 也是 403，说明缺口在**宿主的 Web 服务鉴权**（多半要页面的会话凭证，
本机裸 HTTP 客户端没有；`?token=` 这种形式宿主不认）。

**所以 demo 改走 core 直连**：和插件 UI 同源、同样调 `createEngine().refresh()`，不依赖宿主的任何接口。
代价是每次都要真发 28 个源的网络请求（见下「已知限制」）。

**这件事本身仍待解决**（属于接口问题，不该由 demo 绕过就算完）：宿主需要给本机脚本一条可用的读取口
（例如回环 + 一次性 token、或明确的本机 socket / 文件落点）。这条不解决，「计划任务读快照」的产品形态
就立不住，只能像 demo 这样每次自己抓一轮。

### 2) 专注助手 / 勿扰模式会吞掉通知

`Show()` 只要系统通知服务在跑就返回成功，但专注助手（Focus Assist）、勿扰、通知总开关关闭时
横幅不会出现 —— 脚本无法区分「用户看到了」和「被系统静默吞了」。产品化要在 UI/日志里写清
「已提交」，不要把「弹了」当成「用户知道了」。

### 3) 休眠 / 关机期间会**错过**通知

demo 是「跑一次判一次」，不补历史。笔记本合盖 4 小时再打开，这 4 小时里到期的条目没人提醒
（去重键按时间戳算，过期项还会被清理）。产品化要用计划任务的
「错过时尽快启动（StartWhenAvailable）」+ 唤醒后补跑，并明确「补发 / 不补发」的策略。

### 4) 其它已知限制（demo 这一层）

- **每次真发网络请求**：28 个源，实测 8~14 秒。慢、会耗流量；源站抖动时该轮提醒就少几条。
- **只取每侧一条外显档期**：同一格里的「并行多池 / 多条活动」在 `bannerHover` / `eventHover`
  的多行文本里（面板的日程视图会展开），demo **不展开**。所以「下一个池子什么时候开」这类
  `即将开始` 提醒，实际只在源站已经把下一期写进外显档期时才会命中。
- **年份补全都是"按当前年"**：`MM-DD HH:MM` 形态的文本没有年份，12 月看 `01-03` 这种跨年文本
  可能补错一年（core 的面板口径同样如此）。带年份的文本以源站为准。
- **未处理的档期原文**：`长期`、`X版本更新后 ~ …` 这类无法还原成绝对窗口的，demo 如实报
  「档期读不出」并跳过，不硬猜一个时刻。
- **自定义条目没有 tz**：`tz` 缺失时按本机时区解释，和 core 面板的兜底一致。
- **不读插件配置**：demo 用自己的默认配置抓（所以那 5 个出厂隐藏条目不会抓）；和插件面板显示的
  数据时刻也可能不同（一轮 8~14 秒）。

## 产品形态的下一步

1. **定时**：装成计划任务，**每 30 分钟**跑一次（`--hours=0.5 --limit=3` 的口径），
   「只在该用户登录时运行」、「错过时尽快启动」。数据源换成快照接口 —— **前提是上面那个 403 先解决**。
2. **送达**：复用 `toast.ps1`（无窗口：`-NoProfile -NonInteractive` + `windowsHide`，不要在脚本里
   起任何交互式窗口；计划任务也要勾「隐藏」）。
3. **参考实现要点**（照抄就能少踩）：
   - **无窗口运行**：`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File …`，
     Node 侧 `windowsHide: true`；计划任务用「不管用户是否登录都运行」时**没有桌面会话**，
     WinRT toast 会失败 —— 必须选「只在该用户登录时运行」。
   - **当前用户会话**：toast 是"给某个用户的通知"，它依赖当前登录会话 + 该用户的 AppId 注册；
     SYSTEM 账户 / Session 0 下弹不出来（本 demo 的 `AppName` 兜底也绕不过这一点）。
   - **专注助手会吞通知**：见「已知问题 2」。别把「已提交」当「用户已读」。
   - **AppId**：长期产品应该注册自己的 AUMID（开始菜单快捷方式 + `AppUserModelID`），
     否则横幅永远显示「Windows PowerShell」。
4. **还差的基础设施**（本 demo 刻意没做，产品化必须有）：
   - **配置项**：提前量 / 逐游戏白名单（插件里已有 `remindGames` 键）、上限、静音时段、
     「补发 / 不补发」策略；来源要能覆盖 `--hours` 之类默认值。
   - **日志**：每次运行的命中 / 跳过 / 送达结果落文件 + **日志轮转**（按天或按大小），
     失败要能被诊断（现在的 stderr 只在交互式跑时看得到）。
   - **计划任务安装脚本**：`schtasks` / `Register-ScheduledTask` 一键装、卸载、查看下次运行时间；
     装在 `%LOCALAPPDATA%` 下、不需要管理员权限。
   - **状态文件并发**：现在是「读 → 改 → 写回 + rename」，两次运行撞车仍可能互相覆盖；
     产品化要么加锁，要么让计划任务串行（同一任务默认就是串行的）。
   - **快照接口的鉴权方案**：见「已知问题 1」。

## 为什么不直接改插件

用户明确要求：这是 demo，**不要接进插件本体**（`src/` 一行都不改），不升版本号、不打 tag、不发布。
所以 `core` 里那两个纯函数（`parseDisplayRange` / `dueKindOf`）没有为了 demo 去动导出 ——
demo 自己照抄了一份，差别（多接受带年份的档期）在第二节写清楚了。
