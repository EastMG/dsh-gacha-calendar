// src/client/30-game-batch2.js —— 第二批接入（2026-11-11）：崩坏3 内容中台 / OurNotes 日服 SPICA / 卡厄斯梦境 TapTap
//
// 三处来源各自独立，互不共享解析器；共用的是仓库既有口径：
//   · 条目事实形状 `{ key, title, show, startTs, endTs, tz, raw, display, source }`（见 30-game-komoe.js 的文件头）
//   · 悬停只由 `hoverTextFromItems` 生成、数组只由 `dataArrayProducedGachaOf` / `dataArrayProducedEventsOf` 生成
//   · 当期判定只走 `coversNow` / `coveredOrOpen`，**不**在本文件另写一套
//
// ── ① 崩坏3 `bh3`（卡池 + 活动）—— 米哈游内容中台 ─────────────────────────────────
//   GET https://act-api-takumi-static.mihoyo.com/content_v2_user/app/b9d5f96cd69047eb/getContentList
//       ?iChanId=697&iPageSize=30&iPage=1&sLangKey=zh-cn      ← 卡池频道
//       ?iChanId=696&iPageSize=30&iPage=1&sLangKey=zh-cn      ← 活动频道
//     `b9d5f96cd69047eb` = bh3.mihoyo.com 前端里的 appId（与米游社 BBS 那套是两个接口，别混）。
//     实测 2026-11-11 00:53 +08：卡池 200 / application/json / 151 KB / iTotal=863；
//                               活动 200 / application/json / 约 150 KB / iTotal=687。
//     响应 `{ retcode:0, message:"OK", data:{ iTotal, list:[{ iInfoId, sTitle, sContent(HTML), dtStartTime, dtEndTime }] } }`；
//     `Access-Control-Allow-Origin: *`（直连也通），这里仍走宿主代理 —— 与仓库其它来源同一条路径，
//     且能带 `Referer: https://bh3.mihoyo.com/`（实测源站不校验，但保持浏览器形态）。白名单见 src/index.js。
//
//   · 卡池：名称 + 正文里能确定的角色 + **档期**。档期三级取值（2026-11-11 二次实测 697 频道 30 条逐条）：
//       ① `>>开放时间` 文本块 —— 跃升武装 / 跃升补给 / 庆典（角色·装备）/ 时光追忆 / 服装补给这些类别有
//          （例：跃升武装「龙威燎天烈&游戏人生」→ `11月6日12:00~11月26日04:00`）；
//       ② 同帖「商城礼包【上架时间】」那几行 —— 标准双池（角色补给 / 装备补给）的正文只有图片
//          `>>补给信息`，但**礼包窗口与补给窗口一致**（跃升武装/跃升补给三条同帖文本互证：
//          礼包 `11月6日12:00~11月26日04:00` == 同帖 `>>开放时间` 的区间）；
//       ③ 两处都没有 ⇒ **只出名称/角色、不起档期**（`bannerDates` / `bannerDatesRaw` 留空，显示层按长期画）。
//     ⚠️ `dtEndTime` **一个字节都不读**：30/30 恒为 `2035-01-01 00:00:00` 占位（源站的"无结束"哨兵）。
//        上一版把它当权威 ⇒ 整批档期落在 2035；这一版宁可留空，也不把哨兵当年份。
//     `dtStartTime` 不当补给开始时刻（实测 跃升武装帖 `dtStartTime`=11-03 18:30，而 `>>开放时间` 写 11-06 12:00
//     —— 前者是帖子/内容上线时刻，不是开池时刻），只作两用：**年份线索**（`inferYear`）与「帖已发布」判据。
//     在期 = 档期两端明确且 `coveredOrOpen`；并列时按「开始更晚 → 帖更晚」取一条当外显，
//     悬停/数组收全部在期池（`poolHoverOrderOf`，结束升序）。一条都不在期 ⇒ 退回「已发布的最新一帖」、
//     档期留空 —— 不拿已经过去的窗口冒充当期。
//     角色：只认正文 `S级角色「X」` / `A级女武神角色卡「Y」`；标题 `角色补给丨X` 仅在该帖正文没写角色时兜底
//     （`庆典角色补给丨镇×偃月叩晓等目标限时UP` 会拆成 镇 / 偃月叩晓）。装备补给里的武器/圣痕名字**不当角色**。
//   · 活动：标题 + 正文「>>开放时间 / 【活动时间】」块里的区间。实测 30 条里 27 条有时间块；
//       其余 3 条（主线更新稿）正文没有时间块 ⇒ **如实跳过**，不补时刻。
//       区间两种写法：
//         `11月12日10:00~11月26日04:00`             ← 两端绝对时刻
//         `9.1版本更新后~11月6日12:00`               ← 起点是相对表述 ⇒ startTs=null（仓库口径），raw 原样保留
//       无年份：借 `dtStartTime` 的年份与月份（共用 `inferYear`）；结束月日小于开始 ⇒ 次年（`endsNextYear`）。
//     标题就是源站标题（`晚秋拾光丨参与活动获取3★圣痕等奖励`），不拆「丨」后半句 —— 与其它来源一致。
//
// ── ② BanG Dream！OurNotes·日服 `ournotes` 的**卡池** —— SPICA（社区攻略站）────────────
//   列表 https://spica.wiki/ournotes/gachas （服务端渲染 HTML：`<ul><li><a href="/ournotes/gacha/{id}">名称</a>`）
//   详情 https://spica.wiki/ournotes/gacha/{id}
//     `<h1>名称</h1>` + `<dt class="k">開催期間</dt><dd class="v">2026.11.08 15:00 – 2026.11.18 14:59</dd>`
//     + `<h2>ピックアップ</h2><ul><li><a …>角色名</a>…`（pickup）
//   实测 2026-11-11 00:53 +08：列表 200 / text/html / 44 KB / 23 本 / 页面「更新 2026.11.09」；
//     列表**没有日期**（只有 id + 名称）⇒ 日期必须进详情页拿。
//   抓取口径：列表取 id 顺序 → **只抓前 5 条详情**（`SPICA_MAX_DETAILS`，列表按开始时间倒序，
//     在期/最近的池都在头部），不抓 23 条。详情里没有 `開催期間` 的池如实 startTs/endTs=null，不进外显。
//   响应**无 ACAO** ⇒ 必须走宿主代理（白名单 `spica.wiki`）。来源标签「SPICA」；tz=Asia/Tokyo。
//   外显/悬停/数组：当期 = 覆盖 now 的详情（按 startTs 最新）；悬停列出所有 `coveredOrOpen` 的池
//     （`poolHoverOrderOf`：结束升序），数组由 `dataArrayProducedGachaOf` 直出（主条 + 并列条）。
//     `bannerDates` ← `display`（`MM-DD HH:MM ~ MM-DD HH:MM`，源站墙钟 JST），`bannerDatesRaw` ← `raw`。
//
// ── ③ 卡厄斯梦境 `czn`（卡池 + 活动）—— TapTap 官方 tab（feed JSON → 逐帖详情）──────────
//   列表 GET https://www.taptap.cn/webapiv2/feed/v7/by-group
//            ?X-UA=<客户端身份串>&type=official&group_id=974342&limit=10&sort=created&from=0
//   详情 GET https://www.taptap.cn/webapiv2/moment/v3/detail?X-UA=<同上>&id=<帖 id>
//     实测 2026-11-11 +08：列表 200 / application/json / 178 KB / 10 帖 / `data.list[].moment.id_str`；
//     详情 200 / 每帖 30~200 KB。两者都**无 ACAO** ⇒ 走宿主代理（`www.taptap.cn` 已在白名单）。
//     `X-UA` 缺了或写错直接 400（值与 30-game-pengpeng.js 同一份，照页面自己的请求抄）。
//   正文 = `data.first_post.contents.json`（block 数组：`paragraph` 取 `children[].text`，`image` 跳过）。
//     卡池与活动都从**详情**解析 —— 此前活动侧只吃列表摘要（摘要里没有「营救概率提升」分节），
//     卡池侧因为 bwiki `Module:Gacha/data` 停更而恒 nomatch。详情 JSON 一直在响应里，只是没被调用。
//   · 卡池：`■ …营救概率提升` 分节 → 池名（分节标题原文）+ 角色（分节标题里的 `「」`，正文里的不算）
//     + 起止（分节内 `概率提升期间：` / `概率提升时间：` 那一行）。**没有 `■` 分节**的单帖公告
//     （`常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始`）整帖算一条池，池名 = 帖子标题。
//   · 「维护结束后 / 维护开始前」按**同帖**维护窗（`◈更新时间：` 后面那一行）映射：
//       维护结束后 → 该次维护的**结束**时刻；维护开始前 → 该次维护的**开始**时刻。
//     匹配用"墙钟月日 +（端点写了年份时）年"；同帖没有那一天维护窗 ⇒ 该端点**如实留空**
//     （例：`2026/12/02 维护开始前` 的 12-02 维护窗不在同帖 ⇒ endTs=null，不猜）。
//     两端都拿不到绝对时刻的行不进外显/悬停/数组（仓库口径：`endTs == null` 不算在期），
//     但解析结果里保留事实（测试逐条钉住）。
//   · 活动：① 同帖维护窗本身（服务器维护，标题 = 帖子标题）；② `■ 活动 – …` 分节里的【活动时间】。
//     `营救概率提升` 分节归卡池，**不再**算成活动（此前摘要路径把它当活动 ⇒ 双计）。
//   来源标签「TapTap 官方」（卡池/活动同一份）；tz=Asia/Shanghai。
//   抓取口径（2026-11-12 加固，TapTap 有阿里云 WAF、实测被限流过）：
//     · 列表首页 10 帖（不翻页）→ **按标题挑命中帖**（版本/更新/维护/活动/一览/概率提升…）→
//       只抓最近 3 份命中帖的详情（`NS_BATCH2_CZN_DETAIL_TARGET`；`NS_BATCH2_CZN_MAX_DETAILS=4`
//       只是失败时的兜底上限，不是常态）。角色演示 / PV / 设定图这类物料帖不进详情。
//     · 卡池与活动两侧**共享同一份 docs**：模块级缓存，key = 完整 feed URL（不同来源地址天然隔离），
//       TTL 30 s，用 `nowMs()` 判过期；**只有抓成功才写缓存**（失败下一轮重试）。
//     · 单帖详情失败 ⇒ `continue`（某一份 500 不再让整侧"抓取异常"）；≥1 份成功就照常出数据，
//       **全部失败才抛错**。
//
// ⚠️ 本文件排在各 `30-game-*.js` 之后（ORDER / CORE_ORDER 的两个位置都写死了）：
//    它要 `registerSource` 合并既有条目（ournotes / czn），而那两条分别在 30-game-bandori.js 与
//    30-game-bwiki-register.js 里声明 ⇒ 必须后跑。崩坏3 的条目仍在 30-game-hoyoverse.js（那里保留图标/备选源），
//    本文件只登记它的两个抓取器；`EVENT_FETCHERS["bh3"]` 由 29-parser-register.js 先建好、这里补 `default`。

const NS_BATCH2_BH3_TZ = "Asia/Shanghai";
const NS_BATCH2_BH3_REFERER = "https://bh3.mihoyo.com/";
const NS_BATCH2_BH3_GACHA_URL = "https://act-api-takumi-static.mihoyo.com/content_v2_user/app/b9d5f96cd69047eb/getContentList?iChanId=697&iPageSize=30&iPage=1&sLangKey=zh-cn";
const NS_BATCH2_BH3_EVENT_URL = "https://act-api-takumi-static.mihoyo.com/content_v2_user/app/b9d5f96cd69047eb/getContentList?iChanId=696&iPageSize=30&iPage=1&sLangKey=zh-cn";
const NS_BATCH2_BH3_SOURCE_LABEL = "官网公告";

const NS_BATCH2_SPICA_TZ = "Asia/Tokyo";
const NS_BATCH2_SPICA_LIST_URL = "https://spica.wiki/ournotes/gachas";
const NS_BATCH2_SPICA_DETAIL_BASE = "https://spica.wiki/ournotes/gacha/";
const NS_BATCH2_SPICA_REFERER = "https://spica.wiki/";
const NS_BATCH2_SPICA_MAX_DETAILS = 5;
const NS_BATCH2_SPICA_SOURCE_LABEL = "SPICA";

const NS_BATCH2_CZN_TZ = "Asia/Shanghai";
const NS_BATCH2_CZN_REFERER = "https://www.taptap.cn/";
const NS_BATCH2_CZN_SOURCE_LABEL = "TapTap";
// TapTap 的客户端身份串（缺了直接 400 `INVALID_XUA`）；与 30-game-pengpeng.js 逐字同一份。
const NS_BATCH2_CZN_XUA = "V=1&PN=WebApp&LANG=zh_CN&VN_CODE=100000000&LOC=CN&PLT=PC&DS=Android&UID=&OS=Windows&OSV=10&DT=PC";
const NS_BATCH2_CZN_GROUP_ID = "974342";
const NS_BATCH2_CZN_LIMIT = 10;
// 兜底上限（**不是常态**）：正常情况下按标题命中 + 早停，一轮只抓 3 份详情。
// 上限比早停目标多 1 份 —— 命中帖里某一份失败时，还能再补一份，不把整轮拖成"抓取异常"。
const NS_BATCH2_CZN_MAX_DETAILS = 4;
// 早停目标：列表是 `sort=created`（新帖在前），当期池 / 当期活动的公告一定是最新那几份；
// 更早的命中帖描述的是已经结束的档期（实测 2026-11-11：3 份命中帖 = 版本更新介绍 + 活动回顾 + 营救概率提升，
// 更早的「开发者日志」「一封信」这类均无档期）。所以最近 3 份命中帖即视为覆盖当期，不再往下抓。
const NS_BATCH2_CZN_DETAIL_TARGET = 3;
// 详情挑选关键词：只抓"可能带档期"的帖。角色演示 / PV / 设定图 / 制作人来信这类物料帖不进详情
// ⇒ 这是 22 次请求降到个位数的关键（此前 10 帖全抓，其中 8 帖一个档期都没有）。
const NS_BATCH2_CZN_DETAIL_TITLE_RE = /更新|版本|維護|维护|公告|活動|活动|一覽|一览|概率提升|预告|預告/;
// 两侧共享 docs 的缓存 TTL（毫秒）。key 用**完整 feed URL**（含 X-UA / group_id / limit / from），
// 不同来源地址天然隔离；过期判断必须走 `nowMs()`（core 不直接读 Date.now()）。
const NS_BATCH2_CZN_DOCS_TTL_MS = 30 * 1000;

/** 官方 tab 的 feed 列表地址（`from` = 偏移；本来源只吃首页，不翻页）。 */
function ns_batch2_cznFeedUrl() {
	return "https://www.taptap.cn/webapiv2/feed/v7/by-group"
		+ "?X-UA=" + encodeURIComponent(NS_BATCH2_CZN_XUA)
		+ "&type=official&group_id=" + NS_BATCH2_CZN_GROUP_ID
		+ "&limit=" + NS_BATCH2_CZN_LIMIT + "&sort=created&from=0";
}

/** 帖详情地址（同一个 `X-UA`）。 */
function ns_batch2_cznDetailUrl(id) {
	return "https://www.taptap.cn/webapiv2/moment/v3/detail?X-UA=" + encodeURIComponent(NS_BATCH2_CZN_XUA)
		+ "&id=" + String(id == null ? "" : id);
}

const NS_BATCH2_CZN_FEED_URL = ns_batch2_cznFeedUrl();

// ═══════════════════════════════════════════════════════════════════════════════
// ① 崩坏3：内容中台 JSON → 卡池 / 活动条目事实
// ═══════════════════════════════════════════════════════════════════════════════

/** 内容中台的 `sContent` 是 HTML（`<p>` / `<br>` / `<strong>`）→ 纯文本；块边界保留换行。 */
function ns_batch2_bh3Text(html) {
	return String(html == null ? "" : html)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6]|tr|td)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
		.replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
		.replace(/[ \t\u00a0]+/g, " ")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

/** `dtStartTime` / `dtEndTime` 是**源站墙钟**（`2026-11-04 18:00:00`，无时区标记）→ 拆成字段。 */
function ns_batch2_bh3WallOf(s) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(String(s == null ? "" : s).trim());
	if (!m) return null;
	return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4]), mi: Number(m[5]) };
}

/** 墙钟字段 → 绝对毫秒（按条目 tz）。 */
function ns_batch2_bh3InstantOf(hint, tz) {
	return sourceInstant(hint.y, hint.mo, hint.d, hint.h, hint.mi, tz);
}

// 区间两种写法（`raw` 保留源站原文；分隔符实测有 `~` / `～` / `-` / `–`）：
//   `11月12日10:00~11月26日04:00`
//   `9.1版本更新后~11月6日12:00`
const NS_BATCH2_BH3_ABS_RANGE_RE = /(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;
const NS_BATCH2_BH3_REL_RANGE_RE = /(?:\d+(?:\.\d+)?\s*版本更新后|版本更新后|维护后|更新后|开服后)\s*[~～\-–—]\s*(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;

/** 一段匹配到的区间文本 → `{ startTs, endTs, raw, display }`；读不出返回 null（不硬凑）。 */
function ns_batch2_bh3RangeOf(text, hint, tz) {
	const s = String(text == null ? "" : text);
	const a = NS_BATCH2_BH3_ABS_RANGE_RE.exec(s);
	if (a) {
		const sm = Number(a[1]), sd = Number(a[2]), sh = Number(a[3]), smi = Number(a[4]);
		const em = Number(a[5]), ed = Number(a[6]), eh = Number(a[7]), emi = Number(a[8]);
		const sy = inferYear(null, sm, hint);
		let ey = inferYear(null, em, hint);
		if (sy == null || ey == null) return null;
		if (endsNextYear(sm, sd, em, ed)) ey += 1;
		const startTs = sourceInstant(sy, sm, sd, sh, smi, tz);
		const endTs = sourceInstant(ey, em, ed, eh, emi, tz);
		if (!(endTs > startTs)) return null;
		return { startTs, endTs, raw: a[0], display: fmtWindow(startTs, endTs, tz) };
	}
	const r = NS_BATCH2_BH3_REL_RANGE_RE.exec(s);
	if (r) {
		const em = Number(r[1]), ed = Number(r[2]), eh = Number(r[3]), emi = Number(r[4]);
		let ey = inferYear(null, em, hint);
		if (ey == null) return null;
		const hintTs = ns_batch2_bh3InstantOf(hint, tz);
		let endTs = sourceInstant(ey, em, ed, eh, emi, tz);
		// 「12月30日更新后 ~ 1月5日」这类跨年：补一个年份再解一次
		if (endTs < hintTs - 60 * 864e5) endTs = sourceInstant(ey + 1, em, ed, eh, emi, tz);
		if (!(endTs > hintTs - 400 * 864e5)) return null;
		// 起点是相对表述 ⇒ startTs=null（仓库口径：起点未知 ≠ 已开始），display 原样保留原文
		return { startTs: null, endTs, raw: r[0], display: r[0] };
	}
	return null;
}

/** 一段文本里的全部区间（按出现顺序；同一段 raw 只留一次）。 */
function ns_batch2_bh3RangesOf(text, hint, tz) {
	const s = String(text == null ? "" : text);
	const found = [];
	for (const re of [NS_BATCH2_BH3_ABS_RANGE_RE, NS_BATCH2_BH3_REL_RANGE_RE]) {
		const g = new RegExp(re.source, "g");
		let m;
		while ((m = g.exec(s)) !== null) {
			const w = ns_batch2_bh3RangeOf(m[0], hint, tz);
			if (w) found.push({ index: m.index, w });
			if (m.index === g.lastIndex) g.lastIndex++;
		}
	}
	found.sort((x, y) => x.index - y.index);
	const out = [];
	const seen = new Set();
	for (const it of found) {
		if (seen.has(it.w.raw)) continue;
		seen.add(it.w.raw);
		out.push(it.w);
	}
	return out;
}

// 活动正文的时间块标签：`>>开放时间` / `【活动时间】` 两种（简繁都收）。
const NS_BATCH2_BH3_TIME_LABEL_RE = /(?:【(?:活动|活動|开放|開放)(?:时间|時間)】|>>\s*(?:活动|活動|开放|開放)(?:时间|時間))/;

/** 截出「标签 → 下一个 `【` / `>>` / `=====` 标签」之间的那段正文。 */
function ns_batch2_bh3BlockAfter(text, labelRe) {
	const t = String(text == null ? "" : text);
	const m = labelRe.exec(t);
	if (!m) return "";
	const rest = t.slice(m.index + m[0].length);
	const stop = rest.search(/\n\s*(?:【|>>|=====)/);
	return (stop >= 0 ? rest.slice(0, stop) : rest).trim();
}

/** 活动正文里的时间块（`>>开放时间` / `【活动时间】`）。 */
function ns_batch2_bh3EventBlockOf(text) {
	return ns_batch2_bh3BlockAfter(text, NS_BATCH2_BH3_TIME_LABEL_RE);
}

/** 多段窗口里挑一段：优先覆盖 now 的（相对起点的 startTs=null 也接受），否则结束最早的那段。 */
function ns_batch2_bh3PickWindowOf(wins, now) {
	const list = Array.isArray(wins) ? wins.filter(Boolean) : [];
	if (list.length === 0) return null;
	const open = list.filter((w) => coveredOrOpen(w, now));
	const pool = open.length > 0 ? open : list;
	return pool.slice().sort((a, b) => (a.endTs - b.endTs))[0];
}

/** 一条活动帖的**那一段**窗口：块内多段时取覆盖 now 的（或结束最近的）那段。 */
function ns_batch2_bh3EventWindowOf(text, hint, tz, now) {
	const block = ns_batch2_bh3EventBlockOf(text);
	// ⚠️ **只认时间标签块**，不在全文里兜底找区间：正文里的「金币商店 11月23日04:00~11月26日04:00」
	//    这类子窗口会被误当成活动期（2026-11-11 实测 30 条里 13 条没有活动时间块，全文兜底会把
	//    其中 11 条硬凑出一条假档期）。没有块 ⇒ 这条帖如实不进日历，**不补时刻**。
	return ns_batch2_bh3PickWindowOf(block ? ns_batch2_bh3RangesOf(block, hint, tz) : [], now);
}

/** 活动频道 → 条目事实数组（无窗口的帖如实跳过）。 */
function ns_batch2_bh3EventItemsOf(json, tz, now) {
	const list = json && json.data && Array.isArray(json.data.list) ? json.data.list : null;
	if (!list) throw new Error("bh3-bad-json");
	const out = [];
	for (const it of list) {
		const hint = ns_batch2_bh3WallOf(it.dtStartTime);
		if (!hint) continue;
		const title = String(it.sTitle == null ? "" : it.sTitle).trim();
		if (!title) continue;
		const w = ns_batch2_bh3EventWindowOf(ns_batch2_bh3Text(it.sContent), hint, tz, now);
		if (!w) continue;
		out.push({
			key: String(it.iInfoId == null ? "" : it.iInfoId),
			title,
			show: title,
			startTs: w.startTs,
			endTs: w.endTs,
			tz,
			raw: w.raw,
			display: w.display,
			source: "hover"
		});
	}
	return out;
}

// 卡池正文里明确的角色写法：`S级角色「愈生佑翎」` / `A级女武神角色卡「午夜苦艾」`
const NS_BATCH2_BH3_ROLE_RE = /([SA])级(?:女武神)?角色(?:卡)?\s*[「『]([^」』]+)[」』]/g;

/** 补给正文 → 角色名数组（只认明确写法；正文没有时对「角色补给丨X」标题做一次保守兜底）。 */
function ns_batch2_bh3RolesOf(item) {
	const text = ns_batch2_bh3Text(item && item.sContent);
	const roles = [];
	const re = new RegExp(NS_BATCH2_BH3_ROLE_RE.source, "g");
	let m;
	while ((m = re.exec(text)) !== null) {
		const name = m[2].trim();
		if (name && roles.indexOf(name) < 0) roles.push(name);
	}
	if (roles.length === 0) {
		const title = String((item && item.sTitle) || "");
		if (/^(?:庆典)?角色补给[丨|]/.test(title)) {
			const tail = title.split(/[丨|]/).slice(1).join("丨")
				.replace(/[「」『』]/g, "")
				.replace(/等.*$/, "")
				.trim();
			if (tail) {
				for (const name of tail.split(/[×✕]/)) {
					const n = name.trim();
					if (n && roles.indexOf(n) < 0) roles.push(n);
				}
			}
		}
	}
	return roles;
}

// 补给档期的两个可选来源（见文件头①的三级取值）。
//   ① `>>开放时间` 块（与活动侧同一个标签族，但这里**只**取开放时间，不含活动时间）
//   ② 同帖「商城礼包【上架时间】」行
const NS_BATCH2_BH3_OPEN_LABEL_RE = /(?:【(?:开放|開放)(?:时间|時間)】|>>\s*(?:开放|開放)(?:时间|時間))/;

/** 「商城礼包【上架时间】」行的窗口（一帖可能有多行/多个礼包；同一区间只留一次）。 */
function ns_batch2_bh3GiftWindowsOf(text, hint, tz) {
	const out = [];
	const seen = new Set();
	for (const line of String(text == null ? "" : text).split("\n")) {
		if (line.indexOf("【上架时间】") < 0) continue;
		for (const w of ns_batch2_bh3RangesOf(line, hint, tz)) {
			if (seen.has(w.raw)) continue;
			seen.add(w.raw);
			out.push(w);
		}
	}
	return out;
}

/**
 * 一条补给帖的**档期**：`>>开放时间` 优先 → 同帖「【上架时间】」兜底 → 都没有 ⇒ null（只出名称/角色）。
 * ⚠️ 不读 `dtEndTime`（恒 2035 占位）。
 */
function ns_batch2_bh3GachaWindowOf(text, hint, tz, now) {
	const openWins = ns_batch2_bh3RangesOf(
		ns_batch2_bh3BlockAfter(text, NS_BATCH2_BH3_OPEN_LABEL_RE), hint, tz);
	const wins = openWins.length > 0 ? openWins : ns_batch2_bh3GiftWindowsOf(text, hint, tz);
	return ns_batch2_bh3PickWindowOf(wins, now);
}

/**
 * 卡池频道 → 载荷。档期取「在期池」；一条都不在期 ⇒ 只出名称/角色（日期留空），不把过去的窗口当当期。
 * 外显：在期池里按「开始更晚 → 帖更晚」取一条；悬停/数组：全部在期池（结束升序）。
 */
function ns_batch2_bh3GachaPayloadOf(json, tz, now) {
	const list = json && json.data && Array.isArray(json.data.list) ? json.data.list : null;
	if (!list) throw new Error("bh3-bad-json");
	const rows = [];
	for (const it of list) {
		const hint = ns_batch2_bh3WallOf(it.dtStartTime);
		if (!hint) continue;
		const title = String(it.sTitle == null ? "" : it.sTitle).trim();
		if (!title) continue;
		const text = ns_batch2_bh3Text(it.sContent);
		rows.push({
			title,
			roles: ns_batch2_bh3RolesOf(it).join("、"),
			postedTs: ns_batch2_bh3InstantOf(hint, tz),                 // `dtStartTime` = 帖子/内容上线时刻
			win: ns_batch2_bh3GachaWindowOf(text, hint, tz, now)
		});
	}
	const started = rows.filter((r) => r.postedTs <= now);
	if (started.length === 0) return null;                            // 一期都还没发布 = 未公布
	const live = started.filter((r) => r.win && coveredOrOpen(r.win, now));
	const startOf = (r) => (r.win && r.win.startTs != null ? r.win.startTs : 0);
	let primary;
	let win = null;
	if (live.length > 0) {
		primary = live.slice().sort((a, b) => (startOf(b) - startOf(a)) || (b.postedTs - a.postedTs))[0];
		win = primary.win;
	} else {
		primary = started.slice().sort((a, b) => b.postedTs - a.postedTs)[0];
	}
	const out = {
		banner: primary.title,
		roles: primary.roles,
		bannerDates: win ? win.display : "",
		bannerDatesRaw: win ? win.raw : ""
	};
	let entries = [];
	if (live.length > 0) {
		// ⚠️ 先摊平成条目事实、**再**排序：`poolHoverOrderOf` 读的是 `endTs` / `startTs`，
		//    直接对 `{ win: {…} }` 那层排会全是 undefined（= 全 Infinity，顺序等于没排）。
		entries = live.map((r) => ({
			title: r.title,
			label: r.roles ? `${r.title}：${r.roles}` : r.title,
			startTs: r.win.startTs,
			endTs: r.win.endTs,
			raw: r.win.raw
		})).sort(poolHoverOrderOf);
		const hover = hoverTextFromItems(entries, "gacha", tz);
		if (hover) out.bannerHover = hover;
		out.gachaHoverItems = entries;
	}
	out.gacha = dataArrayProducedGachaOf(out, entries, { tz }, now);
	return out;
}

/** 活动条目事实 → 载荷（当期 = 覆盖 now 且开始最晚的那条）。 */
function ns_batch2_bh3EventPayloadOf(items, tz, now) {
	const listed = (items || []).filter((x) => coveredOrOpen(x, now));
	const primary = listed.filter((x) => coversNow(x, now)).sort((a, b) => b.startTs - a.startTs)[0] || null;
	if (!primary) return null;
	const entries = sortEventItems(listed.map((x) => Object.assign({}, x, { name: x.title })));
	const out = { event: primary.title, eventDates: primary.display, eventDatesRaw: primary.raw };
	const hover = hoverTextFromItems(entries, "event", tz);
	if (hover) out.eventHover = hover;
	out.events = dataArrayProducedEventsOf(out, entries, { tz }, now);
	out.eventHoverItems = entries;
	return out;
}

/** 卡池抓取器（经宿主代理；`iChanId=697`）。 */
async function ns_batch2_fetchBh3Gacha(url, signal, tz = NS_BATCH2_BH3_TZ) {
	const json = await proxyFetchJson(url || NS_BATCH2_BH3_GACHA_URL, NS_BATCH2_BH3_REFERER);
	return ns_batch2_bh3GachaPayloadOf(json, tz, nowMs());
}

/** 活动抓取器（经宿主代理；`iChanId=696`）。 */
async function ns_batch2_fetchBh3Events(url, signal, tz = NS_BATCH2_BH3_TZ) {
	const json = await proxyFetchJson(url || NS_BATCH2_BH3_EVENT_URL, NS_BATCH2_BH3_REFERER);
	const now = nowMs();
	return ns_batch2_bh3EventPayloadOf(ns_batch2_bh3EventItemsOf(json, tz, now), tz, now);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ② OurNotes 日服：SPICA 卡池列表 / 详情
// ═══════════════════════════════════════════════════════════════════════════════

/** 列表 HTML → `[{ id, title }]`（保持源站顺序，去重）。 */
function ns_batch2_spicaIdsOf(html) {
	const s = String(html == null ? "" : html);
	const out = [];
	const re = /<a\b[^>]*href="\/ournotes\/gacha\/([A-Za-z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/g;
	let m;
	while ((m = re.exec(s)) !== null) {
		const id = m[1];
		if (out.some((x) => x.id === id)) continue;
		const title = stripTags(m[2]).replace(/\s+/g, " ").trim();
		out.push({ id, title });
	}
	return out;
}

const NS_BATCH2_SPICA_PERIOD_RE = /<dt class="k">開催期間<\/dt>\s*<dd class="v">([\s\S]*?)<\/dd>/;
// 实测分隔符是 en dash（`2026.11.08 15:00 – 2026.11.18 14:59`）
const NS_BATCH2_SPICA_DATE_RE = /(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})\s*[–—\-~～]\s*(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/;

/** 详情里的 pickup 名单（`<h2>ピックアップ</h2><ul><li><a>名</a>…`）→ `名1、名2`。 */
function ns_batch2_spicaRolesOf(html) {
	const s = String(html == null ? "" : html);
	const box = /<h2>ピックアップ<\/h2>\s*<ul>([\s\S]*?)<\/ul>/.exec(s);
	if (!box) return "";
	const names = [];
	const re = /<a\b[^>]*>([\s\S]*?)<\/a>/g;
	let m;
	while ((m = re.exec(box[1])) !== null) {
		const name = stripTags(m[1]).replace(/\s+/g, " ").trim();
		if (name && names.indexOf(name) < 0) names.push(name);
	}
	return names.join("、");
}

/**
 * 详情 HTML → `{ title, startTs, endTs, raw, display, roles }`。
 * 没有 `開催期間`、或期间里不是绝对时刻 ⇒ 两端 null，`raw`/`display` 照实保留（不编时刻）。
 */
function ns_batch2_spicaDetailOf(html, tz) {
	const s = String(html == null ? "" : html);
	const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(s);
	const title = stripTags(h1 ? h1[1] : "").replace(/\s+/g, " ").trim();
	if (!title) throw new Error("spica-bad-html");
	const roles = ns_batch2_spicaRolesOf(s);
	const pm = NS_BATCH2_SPICA_PERIOD_RE.exec(s);
	if (!pm) return { title, startTs: null, endTs: null, raw: "", display: "", roles };
	const raw = stripTags(pm[1]).replace(/\s+/g, " ").trim();
	const dm = NS_BATCH2_SPICA_DATE_RE.exec(raw);
	if (!dm) return { title, startTs: null, endTs: null, raw, display: raw, roles };
	const startTs = sourceInstant(Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(dm[4]), Number(dm[5]), tz);
	const endTs = sourceInstant(Number(dm[6]), Number(dm[7]), Number(dm[8]), Number(dm[9]), Number(dm[10]), tz);
	if (!(endTs > startTs)) return { title, startTs: null, endTs: null, raw, display: raw, roles };
	return { title, startTs, endTs, raw, display: fmtWindow(startTs, endTs, tz), roles };
}

/** 详情事实 → 卡池载荷（当期 = 覆盖 now 的最新开始；悬停/数组 = 全部 coveredOrOpen）。 */
function ns_batch2_spicaPayloadOf(items, tz, now) {
	const listed = (items || []).filter((x) => x && coveredOrOpen(x, now));
	const primary = listed.filter((x) => coversNow(x, now)).sort((a, b) => b.startTs - a.startTs)[0] || null;
	if (!primary) return null;
	const entries = listed.slice().sort(poolHoverOrderOf).map((x) => ({
		title: x.title,
		label: x.roles ? `${x.title}：${x.roles}` : x.title,
		startTs: x.startTs,
		endTs: x.endTs,
		raw: x.raw
	}));
	const out = {
		banner: primary.title,
		roles: primary.roles || "",
		bannerDates: primary.display,
		bannerDatesRaw: primary.raw
	};
	const hover = hoverTextFromItems(entries, "gacha", tz);
	if (hover) out.bannerHover = hover;
	out.gacha = dataArrayProducedGachaOf(out, entries, { tz }, now);
	out.gachaHoverItems = entries;
	return out;
}

/** 卡池抓取器：列表 → 前 N 条详情（列表没有日期，必须进详情）。 */
async function ns_batch2_fetchSpicaGacha(url, signal, tz = NS_BATCH2_SPICA_TZ) {
	const listUrl = url || NS_BATCH2_SPICA_LIST_URL;
	const listHtml = await proxyFetchText(listUrl, NS_BATCH2_SPICA_REFERER);
	const ids = ns_batch2_spicaIdsOf(listHtml);
	if (ids.length === 0) throw new Error("spica-list-empty");   // 列表结构变了（不是"未公布"）
	const now = nowMs();
	const items = [];
	for (const it of ids.slice(0, NS_BATCH2_SPICA_MAX_DETAILS)) {
		const html = await proxyFetchText(NS_BATCH2_SPICA_DETAIL_BASE + it.id, NS_BATCH2_SPICA_REFERER);
		const d = ns_batch2_spicaDetailOf(html, tz);
		if (!d.title) d.title = it.title;
		items.push(d);
	}
	return ns_batch2_spicaPayloadOf(items, tz, now);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ③ 卡厄斯梦境：TapTap 列表 → 详情 JSON → 卡池 / 活动条目事实
// ═══════════════════════════════════════════════════════════════════════════════

// 实测两种绝对写法（`2026/11/11 08:00 ~ 2026/11/11 13:00` / `2026年11月11日 08:00 ~ 2026年11月11日 13:00`），
// 以及无年份的中文写法（借 now 的源站年份补）。
const NS_BATCH2_CZN_SLASH_RE = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/;
const NS_BATCH2_CZN_YMD_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;
const NS_BATCH2_CZN_MD_RE = /(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;

/** 一段文本里的**第一段完整绝对区间** → `{ startTs, endTs, raw, display }`；没有 ⇒ null。 */
function ns_batch2_cznWindowOf(text, now, tz) {
	const s = String(text == null ? "" : text);
	let m = NS_BATCH2_CZN_SLASH_RE.exec(s);
	if (m) {
		const startTs = sourceInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
		const endTs = sourceInstant(Number(m[6]), Number(m[7]), Number(m[8]), Number(m[9]), Number(m[10]), tz);
		if (!(endTs > startTs)) return null;
		return { startTs, endTs, raw: m[0], display: fmtWindow(startTs, endTs, tz) };
	}
	m = NS_BATCH2_CZN_YMD_RE.exec(s);
	if (m) {
		const startTs = sourceInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
		const endTs = sourceInstant(Number(m[6]), Number(m[7]), Number(m[8]), Number(m[9]), Number(m[10]), tz);
		if (!(endTs > startTs)) return null;
		return { startTs, endTs, raw: m[0], display: fmtWindow(startTs, endTs, tz) };
	}
	m = NS_BATCH2_CZN_MD_RE.exec(s);
	if (m) {
		const hint = sourceWallParts(now, tz);
		const sm = Number(m[1]), sd = Number(m[2]), sh = Number(m[3]), smi = Number(m[4]);
		const em = Number(m[5]), ed = Number(m[6]), eh = Number(m[7]), emi = Number(m[8]);
		const sy = inferYear(null, sm, hint);
		let ey = inferYear(null, em, hint);
		if (sy == null || ey == null) return null;
		if (endsNextYear(sm, sd, em, ed)) ey += 1;
		const startTs = sourceInstant(sy, sm, sd, sh, smi, tz);
		const endTs = sourceInstant(ey, em, ed, eh, emi, tz);
		if (!(endTs > startTs)) return null;
		return { startTs, endTs, raw: m[0], display: fmtWindow(startTs, endTs, tz) };
	}
	return null;
}

/** 详情 JSON 的正文 → 行数组（`contents.json` 的 `paragraph` 取 `children[].text`；`image` 无文字 ⇒ 跳过）。 */
function ns_batch2_cznLinesOf(json) {
	const data = json && typeof json === "object" ? json.data : null;
	const post = data && data.first_post;
	const blocks = post && post.contents && post.contents.json;
	if (!Array.isArray(blocks)) throw new Error("czn-bad-detail");   // 结构变了（不是"没内容"）
	const out = [];
	for (const b of blocks) {
		if (!b || typeof b !== "object") continue;
		const children = Array.isArray(b.children) ? b.children : [];
		const line = children.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("")
			.replace(/[ \t\u00a0]+/g, " ").trim();
		if (line) out.push(line);
	}
	return out;
}

/** 详情 JSON → `{ title, lines }`（标题取 `moment.topic.title`，缺失时为空串）。 */
function ns_batch2_cznDocOf(json) {
	const lines = ns_batch2_cznLinesOf(json);
	const topic = json && json.data && json.data.moment && json.data.moment.topic;
	const title = topic && typeof topic.title === "string" ? topic.title.replace(/\s+/g, " ").trim() : "";
	return { title, lines };
}

// 同帖维护窗标签：`◈更新时间：`（简繁都收 —— 实测国服写「更新时间」）
const NS_BATCH2_CZN_MAINT_LABEL_RE = /(?:更新|维护|維護)(?:时间|時間)\s*[:：]/;

/** 同帖维护窗（`◈更新时间：` 标签之后 3 行内的第一段绝对区间；一帖可能有多段维护说明）。 */
function ns_batch2_cznMaintWindowsOf(lines, now, tz) {
	const list = Array.isArray(lines) ? lines : [];
	const out = [];
	const seen = new Set();
	for (let i = 0; i < list.length; i++) {
		if (!NS_BATCH2_CZN_MAINT_LABEL_RE.test(list[i])) continue;
		for (let j = i; j < Math.min(i + 4, list.length); j++) {
			const w = ns_batch2_cznWindowOf(list[j], now, tz);
			if (!w) continue;
			if (!seen.has(w.raw)) {
				seen.add(w.raw);
				out.push(w);
			}
			break;
		}
	}
	return out;
}

// 端点 token：`2026/11/11 维护结束后`（相对，按同帖维护窗映射）/ `2026/11/25 02:00`（绝对）。
// 年份可省（`11/11 维护结束后`）—— 省了就用同帖维护窗的墙钟月日去认年份。
const NS_BATCH2_CZN_POINT_RE = /(?:(\d{4})\s*\/\s*)?(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?(?:\s*(维护结束后|维护开始前|维护完成后|更新后|开服后))?/g;
const NS_BATCH2_CZN_CONNECTOR_RE = /^\s*[~～]\s*$/;

/**
 * 端点 token → 绝对时刻：`undefined` = 这个端点写法不认识（整条不解，不猜）；
 * `null` = 写法认识但同帖没有对应维护窗（**如实留空**）。
 */
function ns_batch2_cznPointTsOf(tok, maint, tz) {
	if (!tok) return undefined;
	if (!tok.rel) {
		if (tok.y == null || tok.h == null) return undefined;        // 绝对端点必须写全年月日 + 时刻
		return sourceInstant(tok.y, tok.mo, tok.d, tok.h, tok.mi, tz);
	}
	const hit = (maint || []).find((w) => {
		const p = sourceWallParts(w.startTs, tz);
		return p.mo === tok.mo && p.d === tok.d && (tok.y == null || p.y === tok.y);
	});
	if (!hit) return null;                                           // 同帖没有那天的维护窗 ⇒ 留空
	return /维护开始前/.test(tok.rel) ? hit.startTs : hit.endTs;
}

/**
 * 一行区间文本（`A ~ B`）→ `{ startTs, endTs, raw, display }`。
 * 两端各自按能解析的填：绝对端点 / 维护窗端点；同帖维护窗认不出 ⇒ 该端 `null`。
 * 两端都拿不到 ⇒ 仍返回（caller 自己决定要不要用）。读不出端点写法 ⇒ null（不猜）。
 */
function ns_batch2_cznPeriodWindowOf(text, maint, tz) {
	const s = String(text == null ? "" : text);
	const toks = [];
	const g = new RegExp(NS_BATCH2_CZN_POINT_RE.source, "g");
	let m;
	while ((m = g.exec(s)) !== null) {
		if (m[0] === "") { g.lastIndex++; continue; }
		toks.push({
			start: m.index, end: m.index + m[0].length,
			y: m[1] == null ? null : Number(m[1]),
			mo: Number(m[2]), d: Number(m[3]),
			h: m[4] == null ? null : Number(m[4]),
			mi: m[5] == null ? null : Number(m[5]),
			rel: m[6] || ""
		});
	}
	for (let i = 0; i + 1 < toks.length; i++) {
		const a = toks[i], b = toks[i + 1];
		if (!NS_BATCH2_CZN_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
		const startTs = ns_batch2_cznPointTsOf(a, maint, tz);
		const endTs = ns_batch2_cznPointTsOf(b, maint, tz);
		if (startTs === undefined || endTs === undefined) continue;
		if (startTs != null && endTs != null && !(endTs > startTs)) continue;
		const raw = s.slice(a.start, b.end).replace(/\s+/g, " ").trim();
		// 两端都绝对 ⇒ 格式化；有一端留空 ⇒ 原样印源站原文（不把"未知"渲染成确定时刻）
		const display = startTs != null && endTs != null ? fmtWindow(startTs, endTs, tz) : raw;
		return { startTs: startTs == null ? null : startTs, endTs: endTs == null ? null : endTs, raw, display };
	}
	return null;
}

/** 标题/分节标题里的 `「」` 名字（角色名 / 活动名）；重复只留一次。 */
function ns_batch2_cznQuotedOf(text) {
	const out = [];
	const re = /[「『]([^」』]+)[」』]/g;
	let m;
	while ((m = re.exec(String(text == null ? "" : text))) !== null) {
		const name = m[1].trim();
		if (name && out.indexOf(name) < 0) out.push(name);
	}
	return out;
}

/** 正文 → 分节（`■` 开头的行是分节标题；第一个 `■` 之前的内容归第 0 节，标题为空串）。 */
function ns_batch2_cznSectionsOf(lines) {
	const out = [];
	let cur = { heading: "", lines: [] };
	for (const line of Array.isArray(lines) ? lines : []) {
		const h = /^■\s*(.*)$/.exec(line);
		if (h) {
			out.push(cur);
			cur = { heading: h[1].replace(/\s+/g, " ").trim(), lines: [] };
			continue;
		}
		cur.lines.push(line);
	}
	out.push(cur);
	return out.filter((x) => x.heading || x.lines.length > 0);
}

// 「营救概率提升」= 卡池分节（活动侧必须排除，否则双计）；期间行标签简繁都收。
const NS_BATCH2_CZN_POOL_RE = /营救概率提升/;
const NS_BATCH2_CZN_POOL_PERIOD_RE = /概率提升(?:期间|時間|时间)\s*[:：]\s*(.+)$/;
const NS_BATCH2_CZN_EVENT_TIME_LABEL_RE = /【(?:活动|活動)(?:时间|時間)】/;

/**
 * 详情 → 卡池事实 `{ title, roles, startTs, endTs, raw, display }`。
 * 池名 = 分节标题原文；角色 = 分节标题里的 `「」`（正文里的名字不算 —— 那里常写"与「X」共享保底"）。
 */
function ns_batch2_cznPoolsOf(doc, tz, now) {
	const maint = ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
	const out = [];
	for (const sec of ns_batch2_cznSectionsOf(doc.lines)) {
		const heading = sec.heading;
		// 没有 `■` 分节的单帖公告：整帖算一条池，池名 = 帖子标题
		const isPool = heading ? NS_BATCH2_CZN_POOL_RE.test(heading) : NS_BATCH2_CZN_POOL_RE.test(doc.title);
		if (!isPool) continue;
		const title = heading || doc.title;
		if (!title) continue;
		let win = null;
		for (const line of sec.lines) {
			const m = NS_BATCH2_CZN_POOL_PERIOD_RE.exec(line);
			if (!m) continue;
			const tail = m[1];
			win = ns_batch2_cznPeriodWindowOf(tail, maint, tz) || ns_batch2_cznWindowOf(tail, now, tz);
			if (win) break;
		}
		if (!win || (win.startTs == null && win.endTs == null)) continue;   // 没有期间行 ⇒ 不成池（不外显）
		out.push({
			title,
			roles: ns_batch2_cznQuotedOf(title).join("、"),
			startTs: win.startTs,
			endTs: win.endTs,
			raw: win.raw,
			display: win.display
		});
	}
	return out;
}

/**
 * 详情 → 活动事实。两处来源：
 *   ① 同帖维护窗（`◈更新时间：` → 服务器维护，标题 = 帖子标题）
 *   ② `■ 活动 – …` 分节里的【活动时间】
 * `营救概率提升` 分节**不算活动**（那是卡池，见 `ns_batch2_cznPoolsOf`）。
 */
function ns_batch2_cznEventRowsOf(doc, tz, now) {
	const maint = ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
	const out = [];
	const seen = new Set();
	const push = (row) => {
		const key = `${row.title}|${row.startTs}|${row.endTs}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push(row);
	};
	for (const w of maint) {
		if (doc.title) push({ title: doc.title, startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display });
	}
	for (const sec of ns_batch2_cznSectionsOf(doc.lines)) {
		if (!sec.heading || sec.heading.indexOf("活动") < 0) continue;
		if (NS_BATCH2_CZN_POOL_RE.test(sec.heading)) continue;          // 双计守卫：卡池分节不重复算活动
		const idx = sec.lines.findIndex((l) => NS_BATCH2_CZN_EVENT_TIME_LABEL_RE.test(l));
		if (idx < 0) continue;
		// 标签可能独占一行（实测就是），窗口在紧随其后的一两行里
		const joined = [sec.lines[idx]].concat(sec.lines.slice(idx + 1, idx + 3)).join(" ");
		const cut = joined.indexOf("】");
		if (cut < 0) continue;
		const tail = joined.slice(cut + 1);
		const win = ns_batch2_cznPeriodWindowOf(tail, maint, tz) || ns_batch2_cznWindowOf(tail, now, tz);
		if (!win || (win.startTs == null && win.endTs == null)) continue;
		const quoted = ns_batch2_cznQuotedOf(sec.heading);
		push({
			title: quoted.length > 0 ? quoted[0] : sec.heading,
			startTs: win.startTs,
			endTs: win.endTs,
			raw: win.raw,
			display: win.display
		});
	}
	return out;
}

// ── 两侧共享的 docs 缓存（模块级；key = 完整 feed URL）──────────────────────────────
// 为什么需要：卡池与活动两个抓取器各自调一次 `ns_batch2_cznDocsOf`，此前每轮刷新就是
//   2×(1 列表 + 10 详情) = 22 个 TapTap 请求；TapTap 在阿里云 WAF 后面，实测会被限流
//   （返回 text/html 含 `aliyun_waf`）。同一轮刷新里两份 docs 本来一字不差 ⇒ 共享一次就够。
// 生命周期：`createEngine` 每次构造一个独立的 core（本文件整段都在它的作用域里），缓存因此
//   跟着**引擎实例**走；生产只有 `90-plugin.js` 那一处 `createDshEngine(scope)`（一个插件一个引擎），
//   所以"模块级"就是"从插件启动到退出"，跨轮刷新一直有效。
// 只有**抓成功**才写缓存：失败（含 WAF 页 / 全帖失败）不进缓存，下一轮照常重试。
const NS_BATCH2_CZN_DOCS_CACHE = new Map();

/** 缓存条目是否新鲜（TTL 30 s；时钟一律 `nowMs()`）。 */
function ns_batch2_cznDocsCacheFreshOf(entry) {
	if (!entry) return false;
	const age = nowMs() - entry.at;
	return age >= 0 && age < NS_BATCH2_CZN_DOCS_TTL_MS;
}

/** 列表 feed → 命中标题的帖（保持源站顺序 = 发布倒序；不翻页）。 */
function ns_batch2_cznPostsOf(json) {
	const list = json && json.data && Array.isArray(json.data.list) ? json.data.list : null;
	if (!list) throw new Error("czn-bad-feed");
	const all = [];
	const hit = [];
	for (const item of list) {
		const moment = item && item.moment;
		const id = moment && moment.id_str;
		if (id == null) continue;
		const s = String(id);
		if (all.indexOf(s) >= 0) continue;
		all.push(s);
		const topic = moment.topic;
		const title = topic && typeof topic.title === "string" ? topic.title.replace(/\s+/g, " ").trim() : "";
		if (!NS_BATCH2_CZN_DETAIL_TITLE_RE.test(title)) continue;
		hit.push({ id: s, title });
	}
	if (all.length === 0) throw new Error("czn-feed-empty");        // 结构变了（不是"未公布"）
	// 一帖都没命中 ⇒ 标题词汇变了（不再是我们认的那几类）。如实报错让"抓取异常"可见，
	// **不**退回"10 帖全抓"（那正是被 WAF 限流的老路）。
	if (hit.length === 0) throw new Error("czn-no-title-match");
	return hit;
}

/**
 * 列表 feed → 前 N 份详情（卡池与活动两侧共用这一趟；不翻页）。
 * 挑选：只抓标题命中 `NS_BATCH2_CZN_DETAIL_TITLE_RE` 的帖，成功 3 份即早停；
 * 单帖失败跳过（≥1 份成功就返回），**全部失败才抛错**。
 */
async function ns_batch2_cznDocsOf(url) {
	const feedUrl = url || NS_BATCH2_CZN_FEED_URL;
	const cached = NS_BATCH2_CZN_DOCS_CACHE.get(feedUrl);
	if (ns_batch2_cznDocsCacheFreshOf(cached)) return cached.docs;
	const json = await proxyFetchJson(feedUrl, NS_BATCH2_CZN_REFERER);
	const posts = ns_batch2_cznPostsOf(json);
	const docs = [];
	let lastErr = null;
	let attempts = 0;                                                          // 详情请求次数（含失败的）
	for (const post of posts) {
		if (docs.length >= NS_BATCH2_CZN_DETAIL_TARGET) break;                  // 早停：已覆盖当期
		if (attempts >= NS_BATCH2_CZN_MAX_DETAILS) break;                       // 兜底上限：最多 4 份
		attempts++;
		try {
			docs.push(ns_batch2_cznDocOf(await proxyFetchJson(ns_batch2_cznDetailUrl(post.id), NS_BATCH2_CZN_REFERER)));
		} catch (err) {
			lastErr = err;                                                      // 单帖失败 ⇒ 跳过，不拖垮整侧
		}
	}
	if (docs.length === 0) throw lastErr || new Error("czn-no-detail");
	NS_BATCH2_CZN_DOCS_CACHE.set(feedUrl, { at: nowMs(), docs });              // 只有成功才入缓存
	return docs;
}

/** 卡池载荷（当期 = 覆盖 now 的最新开始；悬停/数组 = 全部 coveredOrOpen）。 */
function ns_batch2_cznGachaPayloadOf(items, tz, now) {
	const listed = (items || []).filter((x) => coveredOrOpen(x, now));
	const primary = listed.filter((x) => coversNow(x, now)).sort((a, b) => b.startTs - a.startTs)[0] || null;
	if (!primary) return null;
	const entries = listed.slice().sort(poolHoverOrderOf).map((x) => ({
		title: x.title,
		label: x.roles ? `${x.title}：${x.roles}` : x.title,
		startTs: x.startTs,
		endTs: x.endTs,
		raw: x.raw
	}));
	const out = {
		banner: primary.title,
		roles: primary.roles || "",
		bannerDates: primary.display,
		bannerDatesRaw: primary.raw
	};
	const hover = hoverTextFromItems(entries, "gacha", tz);
	if (hover) out.bannerHover = hover;
	out.gacha = dataArrayProducedGachaOf(out, entries, { tz }, now);
	out.gachaHoverItems = entries;
	return out;
}

/** 活动条目事实 → 载荷（当期 = 覆盖 now 且开始最晚的那条）。 */
function ns_batch2_cznEventPayloadOf(items, tz, now) {
	const listed = (items || []).filter((x) => coveredOrOpen(x, now));
	const primary = listed.filter((x) => coversNow(x, now)).sort((a, b) => b.startTs - a.startTs)[0] || null;
	if (!primary) return null;
	const entries = sortEventItems(listed.map((x) => Object.assign({}, x, { name: x.title })));
	const out = { event: primary.title, eventDates: primary.display, eventDatesRaw: primary.raw };
	const hover = hoverTextFromItems(entries, "event", tz);
	if (hover) out.eventHover = hover;
	out.events = dataArrayProducedEventsOf(out, entries, { tz }, now);
	out.eventHoverItems = entries;
	return out;
}

/** 卡池抓取器（经宿主代理；列表 feed → 逐帖详情）。 */
async function ns_batch2_fetchCznGacha(url, signal, tz = NS_BATCH2_CZN_TZ) {
	const now = nowMs();
	const rows = [];
	for (const doc of await ns_batch2_cznDocsOf(url)) {
		for (const p of ns_batch2_cznPoolsOf(doc, tz, now)) rows.push(p);
	}
	return ns_batch2_cznGachaPayloadOf(rows, tz, now);
}

/** 活动抓取器（经宿主代理；同一趟列表+详情，只取「维护窗 / 活动分节」）。 */
async function ns_batch2_fetchCznEvents(url, signal, tz = NS_BATCH2_CZN_TZ) {
	const now = nowMs();
	const items = [];
	for (const doc of await ns_batch2_cznDocsOf(url)) {
		for (const row of ns_batch2_cznEventRowsOf(doc, tz, now)) items.push(row);
	}
	return ns_batch2_cznEventPayloadOf(items, tz, now);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 登记：条目（合并既有） + 抓取器表
// ═══════════════════════════════════════════════════════════════════════════════

// bh3 条目本体仍在 30-game-hoyoverse.js（图标 / 米游社备选源在那边）；这里只补两个抓取器。
// 卡池默认源 = 内容中台 697；活动默认源 = 内容中台 696；米游社备选源保留（用户仍可在设置页切）。
GACHA_FETCHERS["bh3"] = (url, signal, tz) => ns_batch2_fetchBh3Gacha(url, signal, tz);
EVENT_FETCHERS["bh3"] = Object.assign(EVENT_FETCHERS["bh3"] || {}, {
	default: (url, signal, tz) => ns_batch2_fetchBh3Events(url, signal, tz)
});

// ournotes 日服：卡池侧此前**没有来源**（只有 bushimo 的 WP 活动源），这里补 SPICA 卡池。
// `registerSource` 按 id 合并 ⇒ tz / name / 活动侧 / defaultHidden 全部保留原样。
registerSource({
	id: "ournotes",
	url: NS_BATCH2_SPICA_LIST_URL,
	source: NS_BATCH2_SPICA_SOURCE_LABEL
});
GACHA_FETCHERS["ournotes"] = (url, signal, tz) => ns_batch2_fetchSpicaGacha(url, signal, tz);

// czn 卡厄斯梦境：卡池侧从「bwiki `Module:Gacha/data`（停更 ⇒ 恒 nomatch）」换成 **TapTap 官方 tab**；
// 活动侧此前只吃列表摘要，现在与卡池走同一趟「列表 → 详情」。两侧标签统一「TapTap 官方」。
// bwiki 那页降为**手动备选**（解析器 / 回归逐字保留，见 30-game-bwiki-czn-wikitext.js）。
registerSource({
	id: "czn",
	url: NS_BATCH2_CZN_FEED_URL,
	source: NS_BATCH2_CZN_SOURCE_LABEL,
	eventUrl: NS_BATCH2_CZN_FEED_URL,
	eventSource: NS_BATCH2_CZN_SOURCE_LABEL,
	altSources: [{
		label: "Bwiki（停更）",
		url: ns_bwiki_wikitext_CZN_MODULE_URL,
		fetcher: "czn-bwiki"
	}]
});
GACHA_FETCHERS["czn"] = (url, signal, tz) => ns_batch2_fetchCznGacha(url, signal, tz);
GACHA_FETCHERS["czn-bwiki"] = (url, signal, tz) => ns_bwiki_wikitext_gachaCzn(url, signal, tz);
EVENT_FETCHERS["czn"] = Object.assign(EVENT_FETCHERS["czn"] || {}, {
	default: (url, signal, tz) => ns_batch2_fetchCznEvents(url, signal, tz)
});
