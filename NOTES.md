# NOTES.md — 现状与经验（开工先读，收尾前更新）

分工：**`AGENTS.md` = 规矩**（什么自动做、什么必须问、什么不许做）；**这份 = 现状**（现在什么样、为什么这样、坑在哪、下一步）。
`README_Dev.md` 是给外部接手者的细节手册（长，按主题组织）；这份只留**当下有用**的。

更新时机：改了行为 / 踩了新坑 / 待办有进出 —— 收尾前回写本文件的「当前状态 / 关键决策 / 坑 / 待办」。

---

## 1. 当前状态（2026-11-26 记）

| 项 | 值 |
|---|---|
| 版本 | **0.15.0**（根包与 `packages/core/package.json` 同号，build 注入 `PLUGIN_VERSION`） |
| 发布 | npm 两包 `latest` 都是 0.15.0；tag `v0.15.0`；GitHub Release 已发 |
| 分支 | `main` 干净，与 `origin/main` 同 sha |
| 门禁 | `node build.mjs --check` ✓ · `cd test && node all.mjs` **7715 通过 / 0 失败**（默认 TZ 与 `TZ=UTC` 各一次）· `node tools/check-host-allow.mjs` 11/0 ✓ ← 数字会漂，写的是当时值 |
| 规模 | 来源 **63 款**（卡池/活动两侧；2026-11-27 接入蓝色星原·国服 + 国际服）· `src/client` 64 个 `.js` + 11 个 `.css` · `test/` 51 个 `cases-*.mjs` + 506 个夹具目录 |
| 兄弟仓库 | `gacha-calendar-extension`（浏览器扩展，**独立版本线**：GitHub 0.2.36 / 商店 0.2.35，core 跟随本仓库发布） |

数据流（理解代码的主线）：

```
30-game-*.js 抓取器 → 解析器**直出条目事实**（title/roles/startTs/endTs/raw/source）
  → 50-refresh.js 的 mergeEntryRecord 收口（外显名归一 + 数组 title/show/roles 落盘）
  → 81-schedule-model.js 的 scheduleNormalize / scheduleItemOf（显示层：卡片读 show||title）
  → 82-schedule-view.js（面板渲染：卡片 / 悬停 / 探头）
```

---

## 2. 架构

### 2.1 两条产品线

- **DSH 插件**（本仓库）：侧栏按钮（轮播）+ 排期面板 + 设置页 + 来源健康页。发布为 npm 包 `dsh-gacha-calendar`。
- **中立 core**（本仓库 `packages/core`）：`createEngine` 的产物，零宿主依赖，发布为 `gacha-calendar-core`。
- **浏览器扩展**（兄弟仓库 `gacha-calendar-extension`）：直接依赖 npm 的 core，不重写解析器；抓取全走 background/白名单代发（MV3 里 fetch 设不了 `Referer`，部分源会 403）。

### 2.2 core 的契约（冻结）

- 注入缝**只有三处**：`transport`（代理类 + CORS 直连类两种）、`storage`（get/set）、`now`（`Date.now()` 的 38 处入口）。
- 对外方法：`listGames` / `getCached` / `refresh` / `selfCheck`。
- Result JSON 冻结：`schemaVersion` + `parserVersions`；**只有加字段才升 `schemaVersion`**。
- 改 core ⇒ 必须评估下游扩展（用户多次提醒「core 更新了，检查一下这边的情况」）。

### 2.3 构建产物（5 个）

`lib/client.js`、`lib/index.js`、`lib/remind-core.mjs`、`packages/core/core.mjs`、`packages/core/package.json`（后两个由 `build.mjs` 生成，版本跟随根包）。

---

## 3. 关键决策 + 理由

### 3.1 抓取与失败降级

- **卡池与活动各自独立判成败**：一侧空/解析失败不连坐另一侧，两侧都空才算失败。理由：换期空档时"卡池空"曾把同条在期活动一起丢掉（方舟整行空白）。
- **失败沿用最近一次成功数据**并标 `stale`、不刷新 `okAt`；界面**不写「（缓存）」**，只在悬停给「上次成功时间」。理由：避免闪空，又不把失败伪装成新数据。
- **不自动兜底/静默降级**：默认源坏了就如实报，由用户自己切备选（2026-11-06 用户明确，全游戏适用）。理由：备选可能更不可靠或被限流，自动切会连累原本可用的源。
- **被 Cloudflare 拦的源只能降级备选或换源**，不靠正则/代理硬修（403 拦截页连宿主代理也过不去）。
- **刷新范围 = 只抓"选中展示"的条目**；隐藏条目不抓。理由：省请求，也不产生看不见的失败原因。
- **并发要克制**：一次性 10 个请求会被源站限流（bwiki 567），表现为"源坏了"。

### 3.2 时间与档期

- 条目 `ts` = **绝对时刻**（ms）+ 条目自带 `tz`；文本按源站墙钟解析。理由：同一数据在 UTC 与 +08 机器上得同一个 ts（P4 口径）。
- **外显时间按用户本机时区换算；悬停里保留源站原文本**（2026-10-20 用户口径）。这是显示层口径，与"ts 绝对时刻"是两层，别混。
- **起点未知**：外显只认两端明确（`coversNow`）；"起点未知但终点未过"只对显式开 `includeOpenStart` 的来源进悬停/数组。
- **无结束哨兵**：本批最大结束时间且 ≥2 条共用 ⇒ 视为无结束（`endTs=null`）。否则"结束最晚"会选到 2030 年的常驻池。
- **常驻 / 120 天判定已整条移除**（2026-11-10）。理由：长期活动只剩一天时同样需要被排到前排提醒。

### 3.3 外显与显示名

- 卡池外显合并口径：**当前时刻同时开放的主池合并**（全游戏一套规则，不做逐游戏特例）。
- 显示名只做**有源站证据的归一**（剥体裁尾巴 / 「新登場」领句 / 取「」真名 / 取核心名）；**不做程序截断**（仓库口径见 `README_Dev.md` 与 `test/cases-display-name.mjs` 文件头：超长截断按用户要求回退）。长度交给面板 CSS 省略 + 悬停全文。
- `roles` 是**角色名事实**；卡片"有角色就显示角色"，`banner` / `title` / 悬停 / 提醒标题**仍逐字原文**。
- 探头/并列条的短名走 **opt-in** `extrasShowFromEntry`（默认关；开的地方见代码注释）。
- **近期列表读 `show`**；提醒与侧栏轮播读数组 `title`。两者不同源，别互相覆盖。

### 3.4 数据层

- 解析器**直出条目事实**（P3 起），数据层只做一次归一；数组 `title/show/roles/ts/raw` 是持久化契约。
- 老的"从悬停文本反解数组"路径已删，其输出冻结成字面量 oracle（golden 纪律见 `AGENTS.md`）。

### 3.5 UI

- **新旧面板并存**：旧面板不删（用户明确「旧面板依旧需要保留」）；新面板自 2026-10-28 起**默认开启**，老用户一次性覆写迁移（迁移**不看旧值**），迁移逻辑设退役期（约一个月后请用户下令移除）。
- **探头只是 UI 组件、不承载数据**；表格与探头的数组合并，第一行仍按原选法、逻辑放后段。
- 卡片上的圆角 + 遮罩展开动画**已放弃**（合成层残影/闪烁，越修越丑）。
- 侧栏：**轮播 ≠ 到期提醒**，两套开关分开；footer 多插件同槽竖排靠 CSS（属兼容风险，README 已写明）。
- 设置页：长按拖动排序（顺序要与 README 表格、插件内实际顺序一致）+ 搜索筛选。

### 3.6 提醒与通知

- 只判**结束**方向（"即将开始"因多数源不提前给档期而停用）；档位可配。
- 通知身份走**开始菜单 `.lnk` + AUMID**（原先用 PowerShell 进程身份，显示"PowerShell"且无法分发）；身份设置做成可选按钮。

### 3.7 来源管理

- 来源名**逐字**用源站名；括注只承载必要事实（语言 /「停更」/「不可靠」），由用户逐字定。
- 停更源加「（停更）」并默认置空；不可靠源标「（不可靠）」并默认置空。
- 出厂隐藏 = **至少一侧未配置**的 9 条（2026-11-18 定），其余默认展示。
- 同名多来源**只显示当前选中的那个**，不做双条并列。

### 3.8 蓝色星原·旅谣（2026-11-27 接入，用户点名顺序）

- 国服 = 一个条目 `promilia`：卡池默认 **官方公告**（官网公告 API）、备选 **星原档案室**（promilia.wiki） → `TapTap`；活动默认 **星原档案室**、备选 `TapTap` → 官方公告。
- **三源各自独立、不做兜底补全**（用户原话）：默认源失败就如实报失败，不自动切下一个源。
- 国际服 = 另一个条目 `promilia-global`：卡池 + 活动都用 **官方公告**（rgn1 站，繁体），单一来源。
- 官方公告 API 的鉴权是 **无密钥 md5 完整性签名**：`sign = md5(timestamp + 按键名排序的查询串)`（放请求头 sign/timestamp）；走宿主代理（自定义头由代理透传）。公告正文是静态 HTML（ACAO `*`，直连）。
- 国服官方公告里**没有游戏内活动公告**（实测 30 条全读过）⇒ 活动侧默认源只能给星原档案室（promilia.wiki）；官方公告登记为活动备选（将来出现活动公告即可用）。

### 3.9 工程与发布

- `src/` 唯一真源；`lib/` 与 `packages/core/` 是产物，随源码提交。
- 一个仓库出两个 npm 包，**不拆三仓库**（接口已冻结，出现第三个消费者再拆）。
- 版本号 / tag / Release / npm 的授权与流程见 `AGENTS.md` §0。

---

## 4. 坑（都踩过，别再踩）

### 4.1 抓取/解析

1. **刻舟求剑**：只取"最新一期公告/最新卡池"不校验 now ⇒ 已过期 1 小时的池仍外显。正确：选期必须 `start ≤ now ≤ end`；库里的 `d`（当期）过期就去 `p` 里按窗口找。
2. **结束时间盲算**：用"维护开始 + 14 天"给卡池、活动共用 ⇒ 活动结束系统性偏早。正确：卡池 +14 / 活动 +28 分开，且推算值必须可辨识，别冒充解析值；能拿到源站真实窗口就用真实的。
3. **一次并发 10 个请求**被限流（bwiki 567），被误判成"源坏了"。正确：降并发/串行 + 退避。
4. **悬停没用 `raw`**：有原文却用了格式化时间。正确：有 `raw` 必用 `raw`。

### 4.2 DSH 宿主与本地环境

5. **手改 profile 配置**（`~/.dsh/profiles/<profile>/package.json` / `cordis.patch.yml`）会把 DSH 改炸。正确：只用 `dsh plugin --profile <p> add file:<仓库>`；沙箱写不了就让用户执行这一条。
6. **`file:` 装成实体复制**（不是 junction）⇒ 改 workspace 后 GUI 仍跑旧代码。正确：确认 profile 的 `node_modules/dsh-gacha-calendar` 是指向仓库的 junction；是副本就删掉重装。
7. **`dsh` 不在 PATH**：入口在 `<DSH 安装目录>\host-commands\desktop\bin\dsh.cmd`。
8. **pnpm shim 指向旧安装**：DSH 升级后旧 `runtime-commands\bin\pnpm.cmd` 仍指向老路径（已不存在）⇒ 直接用 `node "<DSH 安装目录>\resources\app.asar.unpacked\node_modules\pnpm\bin\pnpm.cjs"`。
9. **侧栏 footer 同槽多插件**（如 cost-meter）会被横排挤压甚至冲突被卸载。正确：覆盖容器 `flex-wrap:wrap` + 按钮 `flex:1 1 100%` 独占一行，并在真实 GUI 里和"装了同槽插件"的状态下实测。
10. **猜宿主按钮尺寸**（padding/宽度）⇒ 反复"还是窄、不对齐"。正确：解包 `app.asar` 读宿主 CSS + 浏览器读真实 DOM，照抄。
11. **改新面板样式波及旧面板**（背景透明、字看不清）。正确：两套样式隔离，改面板必回归旧面板。

### 4.3 构建与测试

12. **`build.mjs` 的 ORDER**：`05-version.js` 不能排第一（`const PLUGIN_VERSION` 会成全局词法绑定，V8 报重复声明）。
13. **改了 `src/` 必须 build**：`PLUGIN_VERSION` 靠 build 注入；不 build 则产物里是旧号，插件不会强制刷新，`build --check` 也红。
14. **夹具命名守卫**：`test/map.json` 的键要匹配段前缀正则（`p3|p4|…|ba|…`），新夹具按段命名（例 `p3c-endfield-fzwiki-gacha-1126`）。
15. **测试时间炸弹**：断言里别写死绝对日期，用相对时间构造。
16. **跨时区假红**：涉及渲染文本的断言要在默认 TZ 与 `TZ=UTC` 下都跑过。
17. **`displayNameNextOf` 白名单会互相打架**：加体裁尾巴前先想"剥完会不会留悬挂修饰词"（例 `…ピックアップガチャ開催！` 多剥一刀剩「ピックアップ」）；已有 `DISPLAY_TAIL_DANGLING` 守卫，新增仍要写反向断言。

### 4.4 发布 / 运维

18. **npm 11 的 staged publish**：`409 previously published/staged` 或 `404` 常常意味着**已经在 registry**（Fastly 缓存延迟）。判定看 `npm view <包> dist-tags`，别重复发、更别改号重发。
19. **`gh release` 必须在仓库目录执行**，别处 `fatal: not a git repository`。
20. **认证 401 = token 失效**：别猜 OTP 流程，先去翻记录找可用 token（细节见 `AGENTS.md` §0.5）。
21. **PowerShell 中文/JSON 编码**：写含中文的文件用 Node/Python 的 UTF-8（PS 5.1 默认编码会写坏 `package.json`）；`git commit -m` 带中文引号会 pathspec 报错 ⇒ 用 `git commit -F <文件>`。
22. **会话上下文爆掉后编造状态**（"网页已批准""已经提审"）：讲状态就贴命令输出，被质疑立刻复核。

### 4.5 交互/实现细节

23. **改动落到错误部件**：要改"刷新横幅的悬停提示"却去改了格子 ⇒ 动手前先确认改动落在哪个 UI 部件。
24. **设置页拖动排序抽搐/漂移**：别用相对位移 + 异步落位。
25. **自造格式/标点**（`【】`、加句号、加括注）与既有条目风格不一致 ⇒ 照现有条目样式写。
26. **来源名"偷偷改"会复发**：改名必须有当轮明确指令，改完自查全表（2026-11-10、11-13、11-26 三次）。

---

## 5. 文件地图

### 5.1 本仓库

```
src/client/                 63 个分片，build.mjs 按 ORDER 拼接成 lib/client.js
  00-head.js                DSH 模块加载壳 + react require（必须第一）
  05-version.js             版本号占位符（build 注入，勿手改）
  10-config.js              配置常量
  15-env.js                 core 环境注入缝（transport / now / timer）
  20-source-core.js         SOURCES 容器 + registerSource
  21-fetcher-tables.js      两张抓取器表（GACHA_FETCHERS / EVENT_FETCHERS）
  22-fetcher-core.js        抓取公共设施（桥接 / 通用载荷 / 备选源解析）
  23-parser-time.js         时间解析（parseTime / parseRange / bwiki 时间表扫描）
  24-parser-window.js       当期窗口判定（补全起点 / 选当期 / 覆盖判定）
  25-parser-order.js        排序优先级（年份 / 跨年 / 永久 / 类别档位）
  26-parser-hover.js        悬停构造（hoverTextFromItems / buildEventHover / buildPoolHover）
  27-parser-text.js         文本工具（decodeEntities / numOrNull …）
  28-parser-hover-tools.js  悬停排版共用工具
  29-parser-register.js     中文/繁体时间解析 + 来源抓取器登记
  30-game-*.js              按厂商分文件（含 30-game-manjuu.js：promilia 国服三源 + promilia-global 国际服单源）；共享工具在 30-game-*-common.js
  44-test-exports.js        纯函数测试出口（测试从这里拿 T.*）
  50-refresh.js             抓取收口 / mergeEntryRecord / 数据层数组
  60-helpers.js             通用工具（cleanRoleNames / 外显名归一 / 排序 / 默认设置）
  65-remind.js              到期提醒（桌面通知）
  80-shared-ui.js           共享 UI 片段
  81-schedule-model.js      排期模型（scheduleNormalize / scheduleItemOf / 轮播取数）
  82-schedule-view.js       面板视图（卡片 / 悬停 / 探头展开）
  83-panel-shell.js         面板外壳 / 布局
  84-settings-page.js       设置页
  90-plugin.js              插件入口（侧栏按钮注册）
  92-dsh-env.js             DSH 环境对接（settings scope / snapshot）
  99-tail.js                收尾
  engine-api.js / engine-head.js  core 引擎装配
  styles/*.css              11 个样式段（CSS_ORDER 见 build.mjs）
src/index.js                宿主侧（schema / 代理路由 / snapshot handler / PROXY_ALLOW_HOSTS）
build.mjs                   产物生成 + `--check` + 版本注入 + 类型声明
packages/core/              中立核心包（core.mjs 由 build 生成；README.md 手写契约）
lib/                        产物（随仓库提交）
cordis.patch.yml            宿主接线（bundle.patch / client.inject / platform）
assets/ + screenshots.json  README 图片与图片清单（改 README 图必碰）
archive/                    不参与构建的历史原型（如 PowerShell 提醒原型）
test/all.mjs                总门禁（聚 50 段用例）
test/harness.mjs            check / section / useFixtures / setFetchImpl
test/load.mjs               引擎加载（T 导出）
test/map.json               URL → 夹具 映射
test/fixtures/              506 个夹具目录（response.txt + meta）
test/legacy-golden.mjs      冻结 oracle 读取器
test/registry-shim.mjs      注册表测试侧快照（含来源条目形状）
tools/                      check-host-allow / check-bom / require-publish-consent / setup-hooks
.githooks/pre-commit        BOM 守卫 + src↔lib 一致性
.github/workflows/          CI（build --check + test/all.mjs）
```

厂商文件 → 来源 id（63 款；含 2026-11-27 的 promilia / promilia-global）：

```
hoyoverse   genshin hsr zzz bh3 bh2 wd
kuro        wuwa zspms
cygames     uma-jp uma-global uma-tw uma-kr uma-cn pcr-jp pcr-tw gbf
bandori     bandori ournotes ournotes-global
papergames  yslz wxnn nikki4
perfectworld p5x nte tof
netease     hlr yys
idolmaster  gakumas shinycolors millisita deresute shanison
sega        pjsk pjsk-tc pjsk-kr
bluearchive ba-cn ba-global ba-jp
hypergryph  arknights endfield
aniplex     fgo fgo-jp
hl          hl hl-jp
wonderplanet crashfever | mixi gwdz | dmm kancolle | smilegate czn | longyuan wuhuamixin
manjuu      promilia promilia-global
naroda kedr | aurogan bjhl | aisno wqmt | aojiao gachaparty | baio pengpeng
bluepoch r1999 | epidgames ddlezj | gongguo reso | neowiz browndust2
sunborn gf2 | wfskey cytq | yostar stellasora
```

### 5.2 兄弟仓库 `gacha-calendar-extension`（工作区同级目录）

`src/{background,proxy,transport,storage,refresh-worker,panel,popup,options,remind,ics,dnr.json}`、`dist/`（本地加载）、`store/`（listing 文案 + `PUBLISHING.md` 避坑 + 隐私披露）、`docs/`（GitHub Pages 隐私政策）、`verify.mjs` / `verify-live.mjs` / `tools/{check-domains,edge-publish}.mjs`。
域名守卫两边对应：本仓库 `tools/check-host-allow.mjs` ↔ 扩展 `tools/check-domains.mjs`（从 core 动态推导，别写死）。

### 5.3 本机查证入口（排查用，路径用占位符）

- **当前抓取结果（只读、最快）**：`GET http://127.0.0.1:<宿主端口>/api/gacha-calendar-snapshot.json`（内存镜像，重启即清空，204 = 还没刷新过）。
- **持久化真值**：`%USERPROFILE%\.dsh\settings.yaml` 的 `gacha-calendar:` 段（`lastData` / `lastRefresh` / `lastSource` / `lastVersion`）。`lastData` 是 YAML 单引号折行的 JSON，读前先把 `\n\s*` 折叠成空格再 parse。
- **插件加载入口**：`%USERPROFILE%\.dsh\profiles\desktop`（`node_modules\dsh-gacha-calendar` 应为 junction）。
- **DSH 宿主前端**：`<DSH 安装目录>\resources\app.asar`（解包工具在工作区 `asar-tool`）。
- **宿主代理**：`/api/gacha-calendar-proxy?url=…&referer=…&headers=…&contentType=…&origin=0`；真实数据一律走它。

---

## 6. 待办

### A. 要先定产品口径才能动（全量活网审计的「可疑」项）

- `arknights` 卡池：官方公告只覆盖限时/联动寻访，常规轮换周没有当期 → 显示"新卡池未公布"是否可接受；是否另接标准/中坚池。（早先"要抓 PRTS 卡池页"的说法已过时：主源就是官方公告 CMS，PRTS 是可切换备选，且 2026-11-07 已摘除自动回退。）
- `wxnn` 两侧空：档期在公告长图里（要 OCR）。
- `czn` 活动起点是「即日起」推定（估算窗口）；卡池外显带「即将开始」措辞（可剥）。
- `wqmt`「灰烬之潮 第16期」「灰烬之途」源站无档期文本，无法判定是否漏。
- `uma-tw` / `uma-cn` 活动外显：取**活动本体**还是**当前阶段**。
- `fgo-jp` 活动外显：是否优先 `eventQuest`；常驻加成（如絆獲得量アップ 到 12-31）会不会顶掉在期活动。

### B. 功能缺口（未配来源，不是解析 bug）

`hl` 卡池 · `tof` 活动 · `reso` 活动 · `ddlezj` 卡池 · `pengpeng` 卡池。

### C. 已定取舍（**不要再当 bug 修**）

- 并列条默认显示源站原文，只有开 opt-in 的侧才短名（其余判"源站无结构化短名 ⇒ 不改"）。
- 卡片显示合并后的 `roles` 是设计（`ba-cn` / `wqmt` / `wuwa` / `bh2` 等）；`banner` 与 `roles` 不同源属"当期合并"口径。
- `pjsk` 三服的英文活动名、`ba-jp` 自带副标题的活动名：判为真名，不改。
- 探头/并列条里 `fgo` 活动、`fgo-jp` 活动判为不改（只有活动名）。
- 旧面板保留、新面板默认开；卡片圆角/遮罩动画不再做。

### D. 本仓库运维

- npm token 收口：早期会话里在聊天中出现过两个 token，**应确认已在 npm 撤销**，并定期轮换现在 `~/.npmrc` 里那个。
- 每次 DSH 升级/重装后自检：profile 的 junction 是否还在、`dsh`/`pnpm` shim 是否指向旧安装。

### E. 浏览器扩展线（兄弟仓库）

- 商店仍停在 0.2.35，GitHub 已到 0.2.36（当时选择"仅 GitHub、跳过商店"）⇒ 商店版本待提交。
- 商店文案本地已改（中/英），待提交，且要同步 Partner Center 表单（本地 md 不是线上生效物）。
- 交接文档 §9 仍未答：扩展做出来后，DSH 插件这份还继续维护吗（需一句产品口径）。
- bwiki 连续请求会被打成 567：节流 + 退避未做（用户判"不紧急"）。

### F. 其它搁置项（用户说先不做 / 进待办）

滚动手感（探头展开时顿挫/事件穿透）· 「开始提醒」档位（保留但注释掉）· 一次性迁移逻辑到期退役 · 「主源失败自动回落备选」（有意不做）· 通知图标可换 · `.ics` 导出 / 抽卡计划攒抽 / 搜索筛选 · 找源（幻塔、碧蓝航线换源、无限暖暖只做国服、少前2）· `dshplugin.net` 目录 PR 收尾。

---

## 7. 本地查证素材（**不进仓库**，只在工作区保存）

- 三个开发会话的用户原话：一代目 / 二代目 / 三代目（2026-09 ~ 2026-11），文件名 `_sess-*.md`。
- `会话总结_dbfa9111_gacha-calendar.md`（一代目阶段总结，含 T1~T88 回合表）。
- `_digest_dbfa9111.txt`（工具调用摘要）。
- `dsh-gacha-calendar-浏览器扩展移植_交接说明.md`（二/三代目交接手册，58+ 节；注意 §0.3 门禁清单、§1「11 款」等已过时）。
- `_early_releases.txt` / `_release_v*.md` / `_rel_notes_*.md`（历史 release 说明原文，写新说明前对照格式用）。

> 这些是**证据源**，不是产品文档；引用时给文件名 + 编号，别把过期结论当现状。