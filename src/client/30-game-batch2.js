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
// ── ③ 卡厄斯梦境 `czn`（卡池 + 活动）—— TapTap 官方 tab 的 **SSR HTML 页面**（robots.txt 允许）──
//   ⚠️ 2026-11-13 换路径：`https://www.taptap.cn/robots.txt` 明确
//        Disallow: /webapi/   与   /webapiv2/
//      旧实现恰好走 `webapiv2/feed` + `webapiv2/moment detail`（既被 robots 禁，又实测吃阿里云 WAF）。
//      现在只抓 **robots 允许、实测 200 / 无 WAF** 的 topic 页（2 个请求）：
//        https://www.taptap.cn/app/759688/topic?type=official
//        https://www.taptap.cn/app/759688/topic?type=official&page=2    ← 抓取器自己拼
//   SSR 数据在 `<script type="application/json" id="__NUXT_DATA__">…</script>` 里，是 **Nuxt devalue**
//   编码（一个数组：元素可为字面量或**数字引用**，对象/数组的成员是下标）。解码见
//     `ns_batch2_cznDevalueOf`（最小实现 + 兼容策略写在那段注释里）。
//   每帖取 `data.<hash>.list[].moment`：`topic.title` / `topic.summary`（正文，SSR 侧**截断在 200 字**）/
//   `created_time`（unix 秒）。实测 2026-11-13 22:29 +08：每页 10 帖，共 20 帖；卡池 / 活动都在前 20 帖。
//   · 卡池：帖子标题或正文首行含 `营救概率提升`（或正文带 `概率提升时间：` 标签）⇒ 一条池；
//       池名 = 正文首行（它就是公告标题那一行，含 `营救概率提升`）；没有首行就退帖子标题；
//       角色 = 池名里的 `「」`（正文其它地方的名字不算）；起止 = `概率提升时间：` / `活动时间：`
//       标签那一行的区间。**只看标签行**，不拿正文里别的区间凑。
//   · 「维护结束后 / 维护开始前」用**同帖/同页**维护窗（`◈更新时间：` / `维护时间：` 等）映射：
//       维护结束后 → 该次维护的**结束**时刻；维护开始前 → 该次维护的**开始**时刻。
//     匹配用"墙钟月日 +（端点写了年份时）年"；同页没有那一天维护窗 ⇒ 该端点**如实留空**
//     （实测 `2026/12/02 维护开始前` 的 12-02 维护窗不在第 1/2 页 ⇒ endTs=null，不猜）。
//   · 活动：① 同页维护窗（服务器维护，标题 = 帖子标题）；② `活动时间：` 标签（实测三种写法
//     `➤活动时间：` / `〓活动时间〓` / `【活动时间】`）的区间。
//     `营救概率提升` 帖归卡池，**不再**算成活动（双计守卫：那类帖的 `➤活动时间：` 正是池的档期）。
//     `即日起～<绝对终点>` 的起点锚在**帖子 `created_time`**（源站自己的发布时刻；没有 created_time
//     就留空，不拿 now 猜）。
//   来源标签「TapTap 官方」（卡池/活动同一份）；tz=Asia/Shanghai；响应无 ACAO ⇒ 仍走宿主代理
//   （`www.taptap.cn` 已在白名单，tools/check-host-allow.mjs 守）。
//   抓取口径：固定 2 页（`NS_BATCH2_CZN_PAGES`），任一页失败跳过、**两页都失败才抛错**；
//   卡池载荷顺手带上活动字段 ⇒ 引擎的 `reuseSameRequest` 让活动侧同一轮 0 请求（两侧仍各有独立
//   抓取器与失败归因）。**没有**模块级共享缓存 / TTL —— 每次抓取就是这 2 个请求。
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
const NS_BATCH2_CZN_SOURCE_LABEL = "TapTap 官方";
// 只抓 robots.txt 允许的 topic 页（`/webapi/` 与 `/webapiv2/` 都被 Disallow，旧 JSON 路径已整体删除）。
// 第 2 页由抓取器自己拼 `&page=2`（实测 200，SSR payload 与第 1 页同构）。
const NS_BATCH2_CZN_TOPIC_URL = "https://www.taptap.cn/app/759688/topic?type=official";
const NS_BATCH2_CZN_PAGES = 2;

/** 第 N 页 topic 地址（N≤1 = 注册地址；N>1 追加 `&page=N`，若自定义地址已带 `page=` 则替换）。 */
function ns_batch2_cznTopicUrlOf(page, base) {
	const b = String(base || NS_BATCH2_CZN_TOPIC_URL);
	const n = Number(page);
	if (!(n > 1)) return b;
	if (/[?&]page=\d+/.test(b)) return b.replace(/([?&])page=\d+/, "$1page=" + n);
	return b + (b.indexOf("?") >= 0 ? "&" : "?") + "page=" + n;
}

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
// ③ 卡厄斯梦境：TapTap topic 页 SSR（Nuxt devalue）→ 卡池 / 活动条目事实
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

// ── Nuxt devalue 解码（2026-11-13 换路径的核心）────────────────────────────────
// 页面把 SSR 数据放在 `<script type="application/json" id="__NUXT_DATA__">` 里，格式是 Nuxt 用的
// **devalue**：一个 JSON 数组，根值在 `[0]`；数组元素只可能是
//   · 字面量：字符串 / 布尔 / null                    ← 直接就是值
//   · **数字**：同数组的**下标引用**                    ← 对象/数组的成员、包装容器里都是这种
//   · 特殊容器：`["ShallowReactive", idx]` / `["Reactive", idx]` / `["Ref", idx]` /
//     `["EmptyRef"]` / `["Date", "ISO"]` / `["Set", idx…]` / `["Map", keyIdx, valIdx…]` /
//     `["BigInt", "…"]` / `["RegExp", "src", "flags"]` / `["URL", "…"]` / `["Object", idx]`
// 实测（2026-11-13 抓的 p1/p2）出现过的 tag 只有 ShallowReactive / Reactive / Ref / EmptyRef / Set / Map。
// 兼容策略：只实现上面这些 tag；**未知 tag 当普通数组逐项解**（不抛错，宁可少字段）；下标越界/悬空 ⇒ null；
//   `state` 有自引用环、同一对象被多处引用 ⇒ 每个下标都 memo，且容器**先入 memo 再填内容**
//   （否则环会无限递归 —— 实测直接栈溢出）。我们只读 `data.<hash>.list[]` 下的
//   `moment.topic.title/summary` 与 `created_time`，都是普通字符串/数字。
const NS_BATCH2_CZN_NUXT_RE = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const NS_BATCH2_CZN_DEVALUE_WRAPPERS = ["ShallowReactive", "Reactive", "Ref", "ShallowRef"];
const NS_BATCH2_CZN_DEVALUE_EMPTY = ["EmptyRef", "EmptyShallowRef"];

/** 页面 → `__NUXT_DATA__` 原文。页面结构变了 ⇒ `czn-no-nuxt`（是"抓取异常"，不是"没内容"）。 */
function ns_batch2_cznNuxtTextOf(html) {
	const m = NS_BATCH2_CZN_NUXT_RE.exec(String(html == null ? "" : html));
	if (!m) throw new Error("czn-no-nuxt");
	return m[1];
}

/** Nuxt devalue 文本 → 解码后的根值（格式与兼容策略见本段开头注释）。 */
function ns_batch2_cznDevalueOf(text) {
	let arr = null;
	try { arr = JSON.parse(String(text)); } catch { throw new Error("czn-bad-nuxt"); }
	if (!Array.isArray(arr)) throw new Error("czn-bad-nuxt");
	const memo = new Map();
	const get = (idx) => {
		if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= arr.length) return null;
		if (memo.has(idx)) return memo.get(idx);
		const v = arr[idx];
		if (v === null || typeof v !== "object") { memo.set(idx, v); return v; }
		if (Array.isArray(v)) {
			const tag = typeof v[0] === "string" ? v[0] : "";
			if (NS_BATCH2_CZN_DEVALUE_WRAPPERS.indexOf(tag) >= 0) { const r = get(v[1]); memo.set(idx, r); return r; }
			if (NS_BATCH2_CZN_DEVALUE_EMPTY.indexOf(tag) >= 0) { memo.set(idx, null); return null; }
			if (tag === "Date") { const r = new Date(String(v[1])); memo.set(idx, r); return r; }
			if (tag === "BigInt") { let r = null; try { r = BigInt(String(v[1])); } catch { r = null; } memo.set(idx, r); return r; }
			if (tag === "RegExp") { const r = new RegExp(String(v[1]), v[2] == null ? "" : String(v[2])); memo.set(idx, r); return r; }
			if (tag === "URL") { let r = null; try { r = new URL(String(v[1])); } catch { r = null; } memo.set(idx, r); return r; }
			if (tag === "Set") { const out = []; memo.set(idx, out); for (let k = 1; k < v.length; k++) out.push(get(v[k])); return out; }
			if (tag === "Map") { const out = {}; memo.set(idx, out); for (let k = 1; k + 1 < v.length; k += 2) out[String(get(v[k]))] = get(v[k + 1]); return out; }
			if (tag === "Object") { const r = get(v[1]); memo.set(idx, r); return r; }
			const out = [];                                              // 未知 tag：按普通数组解
			memo.set(idx, out);
			for (const x of v) out.push(get(x));
			return out;
		}
		const out = {};
		memo.set(idx, out);
		for (const k of Object.keys(v)) out[k] = get(v[k]);
		return out;
	};
	return get(0);
}

/** 页面 → 解码后的根值。 */
function ns_batch2_cznPayloadOf(html) {
	return ns_batch2_cznDevalueOf(ns_batch2_cznNuxtTextOf(html));
}

/** 源站 `created_time` → 毫秒：实测是 **unix 秒**（1794387600）；兼容已经是毫秒的实现。 */
function ns_batch2_cznCreatedTsOf(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n > 1e12 ? n : n * 1000;
}

/**
 * 页面 → 帖子数组 `{ id, title, body, createdTs }`（源站顺序）。
 * 路径 `data.<hash>.list[].moment`：hash 每页/每次构建都可能变，所以**按"哪个节点带 list[]"找**，
 * 不写死 hash。`body` = `moment.topic.summary`（SSR 侧截断在 200 字，实测）——卡池/活动需要的
 * 标题行与时间行都在前 200 字内；源站没下发的部分不补。
 */
function ns_batch2_cznPostsOf(html) {
	const root = ns_batch2_cznPayloadOf(html);
	const data = root && typeof root === "object" ? root.data : null;
	if (!data || typeof data !== "object") throw new Error("czn-bad-page");
	const out = [];
	const seen = new Set();
	for (const key of Object.keys(data)) {
		const node = data[key];
		if (!node || typeof node !== "object" || !Array.isArray(node.list)) continue;
		for (const item of node.list) {
			const mo = item && typeof item === "object" ? item.moment : null;
			if (!mo || typeof mo !== "object") continue;
			const topic = mo.topic && typeof mo.topic === "object" ? mo.topic : null;
			const title = topic && typeof topic.title === "string" ? topic.title.replace(/\s+/g, " ").trim() : "";
			const body = topic && typeof topic.summary === "string" ? topic.summary.replace(/\r\n?/g, "\n").trim() : "";
			if (!title && !body) continue;                              // 空帖（实测有 1 条 title=undefined）跳过
			const id = mo.id_str == null ? "" : String(mo.id_str);
			if (id && seen.has(id)) continue;
			if (id) seen.add(id);
			out.push({ id, title, body, createdTs: ns_batch2_cznCreatedTsOf(mo.created_time) });
		}
	}
	if (out.length === 0) throw new Error("czn-bad-page");              // 结构变了（不是"没内容"）
	return out;
}

/** 帖子 → 解析用 doc（正文行 + 发布时刻；维护窗由同页汇总，见 `ns_batch2_cznDocsOf`）。 */
function ns_batch2_cznDocOf(post) {
	const lines = String(post && post.body ? post.body : "").split("\n")
		.map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
		.filter((l) => l !== "");
	return {
		id: post && post.id ? String(post.id) : "",
		title: post && post.title ? String(post.title) : "",
		lines,
		createdTs: post && post.createdTs != null ? post.createdTs : null,
		ownMaint: null,                                                  // 由 ns_batch2_cznDocsOf 填；单帖调用时 fallback 自己算
		maint: null
	};
}

/**
 * 一页或多页 HTML → doc 数组。
 * 每帖 `.ownMaint` = 本**帖**写的维护窗（只有那帖自己算"维护活动"）；
 * `.maint` = 同**页**所有帖维护窗的并集（供「维护结束后/前」跨帖映射 —— 实测 p1 的池帖引用的
 * 正是同页更新介绍帖里的窗）。单页解析失败跳过（≥1 页成功就返回），**全部失败才抛最后一错**。
 */
function ns_batch2_cznDocsOf(htmlList, now, tz) {
	const pages = Array.isArray(htmlList) ? htmlList : [htmlList];
	const out = [];
	let lastErr = null;
	for (const html of pages) {
		let docs = null;
		try { docs = ns_batch2_cznPostsOf(html).map(ns_batch2_cznDocOf); } catch (err) { lastErr = err; continue; }
		const maint = [];
		const seen = new Set();
		for (const doc of docs) {
			doc.ownMaint = ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
			for (const w of doc.ownMaint) {
				const key = `${w.startTs}|${w.endTs}`;
				if (seen.has(key)) continue;
				seen.add(key);
				maint.push(w);
			}
		}
		for (const doc of docs) doc.maint = maint;
		for (const doc of docs) out.push(doc);
	}
	if (out.length === 0) throw lastErr || new Error("czn-bad-page");
	return out;
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

/** 正文行里按标签取"标签那一行的尾巴"：命中第一行就停（`活动时间：…` / `〓活动时间〓…`）。 */
function ns_batch2_cznLabelTailOf(lines, re) {
	for (const line of Array.isArray(lines) ? lines : []) {
		const m = re.exec(line);
		if (m) return { line, tail: String(m[1] == null ? "" : m[1]).trim() };
	}
	return null;
}

// 「营救概率提升」= 卡池帖（活动侧必须排除，否则双计）；期间行标签简繁都收。
const NS_BATCH2_CZN_POOL_RE = /营救概率提升/;
const NS_BATCH2_CZN_POOL_PERIOD_RE = /(?:概率提升(?:期间|時間|时间)|(?:活动|活動)(?:时间|時間))\s*[:：]\s*(.+)$/;
// 活动时间标签（实测三种写法：`➤活动时间：` / `〓活动时间〓` / `【活动时间】`）；尾段可为空（标签独占一行）。
const NS_BATCH2_CZN_EVENT_TIME_LABEL_RE = /(?:【|〓|➤|◈|■)?\s*(?:活动|活動)(?:时间|時間)\s*(?:】|〓|[:：])\s*(.*)$/;
// 「即日起 ~ <绝对终点>」：起点锚在**帖子 created_time**（源站自己的发布时刻；没有就留空，不拿 now 猜）。
const NS_BATCH2_CZN_REL_START_RE = /^(?:即日|今日|自即日|自今日|现在|自现在)起\s*[~～\-–—]\s*(.+)$/;
const NS_BATCH2_CZN_ABS_POINT_RE = /(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})日?\s*(\d{1,2}):(\d{2})(?::\d{2})?/;

/** 单个绝对时刻（`2026/12/1 23:59` 与 `2026年12月1日 23:59:59` 都认）→ 毫秒；读不出 ⇒ null。 */
function ns_batch2_cznAbsPointOf(text, tz) {
	const m = NS_BATCH2_CZN_ABS_POINT_RE.exec(String(text == null ? "" : text));
	if (!m) return null;
	return sourceInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
}

/** `即日起 ~ <绝对终点>` → 窗口（起点 = 帖子 created_time；没有 created_time ⇒ startTs=null，不猜）。 */
function ns_batch2_cznEventWindowOf(text, createdTs, tz) {
	const s = String(text == null ? "" : text).trim();
	const m = NS_BATCH2_CZN_REL_START_RE.exec(s);
	if (!m) return null;
	const endTs = ns_batch2_cznAbsPointOf(m[1], tz);
	if (endTs == null) return null;
	const startTs = createdTs == null ? null : createdTs;
	if (startTs != null && !(endTs > startTs)) return null;
	return { startTs, endTs, raw: s, display: startTs != null ? fmtWindow(startTs, endTs, tz) : s };
}

// 帖子正文的首行如果只是 `-活动内容：…` 这类列表项，就不是"标题行"（蒂菲拉那帖实测如此）。
const NS_BATCH2_CZN_BULLET_RE = /^[\s•·\-–—➤▶〓#※*＊]/;

/** 这帖算不算卡池帖（返回池名；不算 ⇒ null）。池名 = 公告标题那一行，没有就退帖子标题。 */
function ns_batch2_cznPoolHeadOf(doc) {
	const first = (doc && Array.isArray(doc.lines) && doc.lines[0]) || "";
	const title = String((doc && doc.title) || "");
	const firstIsHeadline = NS_BATCH2_CZN_POOL_RE.test(first) && !NS_BATCH2_CZN_BULLET_RE.test(first);
	const titleHit = NS_BATCH2_CZN_POOL_RE.test(title);
	if (!firstIsHeadline && !titleHit) return null;
	const name = firstIsHeadline ? first : title;
	return { name: name || title || first };
}

/**
 * doc → 卡池事实 `{ title, roles, startTs, endTs, raw, display }`（0 或 1 条）。
 * 角色 = 池名里的 `「」`（正文别处的名字不算 —— 那里常写"与「X」共享保底"）。
 * 期间只认 `概率提升时间：` / `活动时间：` 标签那一行；没有 ⇒ 不成池（不拿正文里别的区间凑）。
 */
function ns_batch2_cznPoolsOf(doc, tz, now) {
	const head = ns_batch2_cznPoolHeadOf(doc);
	if (!head) return [];
	const lab = ns_batch2_cznLabelTailOf(doc.lines, NS_BATCH2_CZN_POOL_PERIOD_RE);
	if (!lab || !lab.tail) return [];
	const maint = doc.maint || ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
	const win = ns_batch2_cznPeriodWindowOf(lab.tail, maint, tz) || ns_batch2_cznWindowOf(lab.tail, now, tz);
	if (!win || (win.startTs == null && win.endTs == null)) return [];
	return [{
		title: head.name,
		roles: ns_batch2_cznQuotedOf(head.name).join("、"),
		startTs: win.startTs,
		endTs: win.endTs,
		raw: win.raw,
		display: win.display
	}];
}

/**
 * doc → 活动事实。两处来源：
 *   ① 同页维护窗（`◈更新时间：` → 服务器维护，标题 = 帖子标题）
 *   ② `活动时间：` 标签（三种写法）的区间；`即日起` 起点锚 created_time
 * **卡池帖不算活动**（双计守卫：那类帖的 `➤活动时间：` 正是池的档期）。
 */
function ns_batch2_cznEventRowsOf(doc, tz, now) {
	const maint = doc.maint || ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
	const ownMaint = doc.ownMaint || ns_batch2_cznMaintWindowsOf(doc.lines, now, tz);
	const out = [];
	const seen = new Set();
	const push = (row) => {
		const key = `${row.title}|${row.startTs}|${row.endTs}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push(row);
	};
	for (const w of ownMaint) {
		if (doc.title) push({ title: doc.title, startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display });
	}
	if (ns_batch2_cznPoolHeadOf(doc)) return out;                        // 双计守卫：卡池帖不重复算活动
	const lab = ns_batch2_cznLabelTailOf(doc.lines, NS_BATCH2_CZN_EVENT_TIME_LABEL_RE);
	if (!lab) return out;
	let tail = lab.tail;
	if (!tail) {
		// 标签独占一行（实测 `〓活动时间〓` / `【活动时间】`）：窗口在**紧随其后那一行**
		const idx = doc.lines.indexOf(lab.line);
		tail = doc.lines[idx + 1] || "";
	}
	const win = ns_batch2_cznPeriodWindowOf(tail, maint, tz)
		|| ns_batch2_cznEventWindowOf(tail, doc.createdTs, tz)
		|| ns_batch2_cznWindowOf(tail, now, tz);
	if (!win || (win.startTs == null && win.endTs == null)) return out;
	const quoted = ns_batch2_cznQuotedOf(doc.title);
	push({
		title: quoted.length > 0 ? quoted[0] : (doc.title || lab.line),
		startTs: win.startTs,
		endTs: win.endTs,
		raw: win.raw,
		display: win.display
	});
	return out;
}

/**
 * 抓 topic 第 1..N 页（固定 2 个请求；`?page=N` 由本函数拼）。
 * 单页失败跳过，**两页都失败才抛最后一错**（一页 500 不再让整侧 down）。
 */
async function ns_batch2_cznPagesOf(url) {
	const pages = [];
	let lastErr = null;
	for (let p = 1; p <= NS_BATCH2_CZN_PAGES; p++) {
		try {
			pages.push(await proxyFetchText(ns_batch2_cznTopicUrlOf(p, url), NS_BATCH2_CZN_REFERER));
		} catch (err) {
			lastErr = err;                                              // 单页失败 ⇒ 跳过，不拖垮整侧
		}
	}
	if (pages.length === 0) throw lastErr || new Error("czn-no-page");
	return pages;
}

/** docs → 活动事实（卡池/活动两侧共用；**无状态**，不缓存）。 */
function ns_batch2_cznEventItemsOf(docs, tz, now) {
	const items = [];
	for (const doc of docs) for (const row of ns_batch2_cznEventRowsOf(doc, tz, now)) items.push(row);
	return items;
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

/**
 * 卡池抓取器（2 个请求：topic p1 + p2，经宿主代理）。
 * 载荷顺手带上活动字段 ⇒ 引擎 `reuseSameRequest` 让活动侧同一轮 0 请求（两侧仍各有独立抓取器）。
 */
async function ns_batch2_fetchCznGacha(url, signal, tz = NS_BATCH2_CZN_TZ) {
	const now = nowMs();
	const docs = ns_batch2_cznDocsOf(await ns_batch2_cznPagesOf(url), now, tz);
	const rows = [];
	for (const doc of docs) for (const p of ns_batch2_cznPoolsOf(doc, tz, now)) rows.push(p);
	const out = ns_batch2_cznGachaPayloadOf(rows, tz, now);
	if (!out) return null;                                              // 当期没有池 ⇒ null（不是 down）
	const events = ns_batch2_cznEventPayloadOf(ns_batch2_cznEventItemsOf(docs, tz, now), tz, now);
	if (events) Object.assign(out, events);
	return out;
}

/** 活动抓取器（同样 2 个请求；独立失败归因，不依赖卡池侧那次成功）。 */
async function ns_batch2_fetchCznEvents(url, signal, tz = NS_BATCH2_CZN_TZ) {
	const now = nowMs();
	const docs = ns_batch2_cznDocsOf(await ns_batch2_cznPagesOf(url), now, tz);
	return ns_batch2_cznEventPayloadOf(ns_batch2_cznEventItemsOf(docs, tz, now), tz, now);
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

// czn 卡厄斯梦境：默认源 = **topic 页 SSR HTML**（robots 允许、无 WAF；2 个请求）。
// 旧的 `webapiv2/feed` + `webapiv2/moment detail` 已整体删除（robots.txt 明确 Disallow）。
// 卡池 / 活动两侧标签统一「TapTap 官方」；bwiki 那页降为**手动备选**（解析器 / 回归逐字保留，
// 见 30-game-bwiki-czn-wikitext.js）。
registerSource({
	id: "czn",
	url: NS_BATCH2_CZN_TOPIC_URL,
	source: NS_BATCH2_CZN_SOURCE_LABEL,
	eventUrl: NS_BATCH2_CZN_TOPIC_URL,
	eventSource: NS_BATCH2_CZN_SOURCE_LABEL,
	altSources: [{
		label: "Bwiki Module:Gacha/data（停更）",
		url: ns_bwiki_wikitext_CZN_MODULE_URL,
		fetcher: "czn-bwiki"
	}]
});
GACHA_FETCHERS["czn"] = (url, signal, tz) => ns_batch2_fetchCznGacha(url, signal, tz);
GACHA_FETCHERS["czn-bwiki"] = (url, signal, tz) => ns_bwiki_wikitext_gachaCzn(url, signal, tz);
EVENT_FETCHERS["czn"] = Object.assign(EVENT_FETCHERS["czn"] || {}, {
	default: (url, signal, tz) => ns_batch2_fetchCznEvents(url, signal, tz)
});
