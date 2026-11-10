// src/client/30-game-batch2.js —— 第二批接入（2026-11-11）：崩坏3 米哈游内容中台 / OurNotes 日服 SPICA / 卡厄斯梦境 TapTap 官方 tab
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
//   · 卡池：**只出名称（+正文里能确定的角色）**，不出起止。理由（2026-11-11 实测 30 条逐条）：
//       `dtEndTime` 恒为 `2035-01-01 00:00:00` 占位（不是真实结束）；装备/角色/服装/跃升补给的正文
//       只有 `>>开放等级` / `>>补给规则` / 商城礼包时间，**没有**补给本身的起止。
//       `dtStartTime` 是真实开启时刻，只用来挑「最近一期已开启的补给」，**不**拿来凑一个
//       `起 / 止` 区间（那会把"只知起点"印成"源站说了起点"）。所以载荷只有 banner / roles，
//       `bannerDates` / `bannerDatesRaw` 留空 ⇒ 数据数组的窗口 ts 为 null ⇒ 显示层按「长期/无结束时间」画。
//       角色：只认正文里 `S级角色「X」` / `A级角色「Y」` 这种明确写法；标题 `角色补给丨X` 仅在该补给
//       正文没有任何「X级角色」时兜底（`庆典角色补给丨镇×偃月叩晓等目标限时UP` 会拆成 镇 / 偃月叩晓）。
//       装备补给里的武器/圣痕名字**不当角色**（不猜）。
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
//   响应**无 ACAO** ⇒ 必须走宿主代理（白名单 `spica.wiki`）。来源标签「SPICA（社区）」；tz=Asia/Tokyo。
//   外显/悬停/数组：当期 = 覆盖 now 的详情（按 startTs 最新）；悬停列出所有 `coveredOrOpen` 的池
//     （`poolHoverOrderOf`：结束升序），数组由 `dataArrayProducedGachaOf` 直出（主条 + 并列条）。
//     `bannerDates` ← `display`（`MM-DD HH:MM ~ MM-DD HH:MM`，源站墙钟 JST），`bannerDatesRaw` ← `raw`。
//
// ── ③ 卡厄斯梦境 `czn` 的**活动** —— TapTap 官方 tab ─────────────────────────────────
//   https://www.taptap.cn/app/759688/topic?type=official （服务端渲染 HTML，实测 2026-11-11：200 / 440 KB）
//   结构：每张卡 = `<a class="tap-router moment-article__link" href="/moment/{id}…">` +
//     `<span class="moment-article__summary--title…">标题</span>` +
//     `<div class="moment-article__summary--content…"><p …>摘要（含 <br> 与全角标点）</p>`
//   首条实测：「赛季「凝结于雪上的约定」阶段2更新介绍」，摘要里
//     `2026/11/11 08:00 ~ 2026/11/11 13:00（服务器时间），预计维护 5 小时`
//     （同一帖在 SSR 的 JSON payload 里还有一份 `\u002F` 转义版本；本文件**只吃渲染后的 HTML**，
//      同一段文本只解析一次，不读 payload。）
//   其余官方帖（角色演示 / 设定图 / PV / 福利发放）正文没有完整起止 ⇒ **如实不进日历**（不拿"11月11日登场"
//     这种单日当区间、也不拿"领取截止"当活动期）。有区间的帖（如
//     `2026/11/04 02:00~2026/11/25 02:00（服务器时间）`）按区间进外显/悬停/数组。
//   响应无 ACAO，`www.taptap.cn` 已在白名单（2026-11-10 夜幕之下那批登记）⇒ 走宿主代理。
//   来源标签「TapTap 官方」；tz=Asia/Shanghai。
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
const NS_BATCH2_SPICA_SOURCE_LABEL = "SPICA（社区）";

const NS_BATCH2_CZN_TZ = "Asia/Shanghai";
const NS_BATCH2_CZN_URL = "https://www.taptap.cn/app/759688/topic?type=official";
const NS_BATCH2_CZN_REFERER = "https://www.taptap.cn/";
const NS_BATCH2_CZN_SOURCE_LABEL = "TapTap 官方";

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

/** 截出「时间标签 → 下一个 `【` / `>>` / `=====` 标签」之间的那段正文。 */
function ns_batch2_bh3EventBlockOf(text) {
	const t = String(text == null ? "" : text);
	const m = NS_BATCH2_BH3_TIME_LABEL_RE.exec(t);
	if (!m) return "";
	const rest = t.slice(m.index + m[0].length);
	const stop = rest.search(/\n\s*(?:【|>>|=====)/);
	return (stop >= 0 ? rest.slice(0, stop) : rest).trim();
}

/** 一条活动帖的**那一段**窗口：块内多段时取覆盖 now 的（或结束最近的）那段。 */
function ns_batch2_bh3EventWindowOf(text, hint, tz, now) {
	const block = ns_batch2_bh3EventBlockOf(text);
	// ⚠️ **只认时间标签块**，不在全文里兜底找区间：正文里的「金币商店 11月23日04:00~11月26日04:00」
	//    这类子窗口会被误当成活动期（2026-11-11 实测 30 条里 13 条没有活动时间块，全文兜底会把
	//    其中 11 条硬凑出一条假档期）。没有块 ⇒ 这条帖如实不进日历，**不补时刻**。
	const wins = block ? ns_batch2_bh3RangesOf(block, hint, tz) : [];
	if (wins.length === 0) return null;
	const open = wins.filter((w) => coveredOrOpen(w, now));
	const pool = open.length > 0 ? open : wins;
	return pool.slice().sort((a, b) => (a.endTs - b.endTs))[0];
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

/**
 * 卡池频道 → 载荷。**只出名称/角色**：`bannerDates` 与 `bannerDatesRaw` 留空（起止拿不到，不硬凑，见文件头①）。
 * 选「最近一期已开启的补给」只看 `dtStartTime`（真实开启时刻），不把它写进窗口字段。
 */
function ns_batch2_bh3GachaPayloadOf(json, tz, now) {
	const list = json && json.data && Array.isArray(json.data.list) ? json.data.list : null;
	if (!list) throw new Error("bh3-bad-json");
	const started = [];
	for (const it of list) {
		const hint = ns_batch2_bh3WallOf(it.dtStartTime);
		if (!hint) continue;
		const startTs = ns_batch2_bh3InstantOf(hint, tz);
		if (startTs > now) continue;
		started.push({ it, startTs });
	}
	if (started.length === 0) return null;                 // 一期都还没开 = 未公布
	started.sort((a, b) => b.startTs - a.startTs);
	const cur = started[0].it;
	const banner = String(cur.sTitle == null ? "" : cur.sTitle).trim();
	if (!banner) return null;
	const out = {
		banner,
		roles: ns_batch2_bh3RolesOf(cur).join("、"),
		bannerDates: "",
		bannerDatesRaw: ""
	};
	out.gacha = dataArrayProducedGachaOf(out, [], { tz }, now);
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
// ③ 卡厄斯梦境：TapTap 官方 tab HTML → 活动条目事实
// ═══════════════════════════════════════════════════════════════════════════════

/** TapTap SSR 摘要 HTML → 纯文本（`<br>` 换成换行，实体解码）。 */
function ns_batch2_cznText(html) {
	return String(html == null ? "" : html)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
		.replace(/[ \t\u00a0]+/g, " ")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

// 一张卡：标题 span + 摘要 `<p>`（`moment-article__link` 是每张卡的入口）
const NS_BATCH2_CZN_CARD_RE = /<a\b[^>]*class="tap-router moment-article__link"[^>]*href="\/moment\/(\d+)[^"]*"[\s\S]*?<span\b[^>]*class="moment-article__summary--title[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?moment-article__summary--content[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/g;

// 实测两种绝对写法（`2026/11/11 08:00 ~ 2026/11/11 13:00` / `2026年11月11日 08:00 ~ 2026年11月11日 13:00`），
// 以及无年份的中文写法（借 now 的源站年份补）。
const NS_BATCH2_CZN_SLASH_RE = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/;
const NS_BATCH2_CZN_YMD_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;
const NS_BATCH2_CZN_MD_RE = /(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;

/** 摘要里的第一段完整区间 → `{ startTs, endTs, raw, display }`；没有 ⇒ null（不拿单日/截止当区间）。 */
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

/** 官方 tab HTML → 条目事实（有完整区间的帖才进；无档期帖如实跳过）。 */
function ns_batch2_cznItemsOf(html, tz, now) {
	const s = String(html == null ? "" : html);
	const out = [];
	const re = new RegExp(NS_BATCH2_CZN_CARD_RE.source, "g");
	let m;
	while ((m = re.exec(s)) !== null) {
		const title = ns_batch2_cznText(m[2]);
		if (!title) continue;
		const w = ns_batch2_cznWindowOf(ns_batch2_cznText(m[3]), now, tz);
		if (!w) continue;
		out.push({
			key: m[1],
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

/** 活动抓取器（经宿主代理；`www.taptap.cn` 已在白名单）。 */
async function ns_batch2_fetchCznEvents(url, signal, tz = NS_BATCH2_CZN_TZ) {
	const html = await proxyFetchText(url || NS_BATCH2_CZN_URL, NS_BATCH2_CZN_REFERER);
	const now = nowMs();
	return ns_batch2_cznEventPayloadOf(ns_batch2_cznItemsOf(html, tz, now), tz, now);
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

// czn 卡厄斯梦境：卡池侧保持 bwiki（Module:Gacha/data），活动侧此前**没有来源**，补 TapTap 官方 tab。
registerSource({
	id: "czn",
	eventUrl: NS_BATCH2_CZN_URL,
	eventSource: NS_BATCH2_CZN_SOURCE_LABEL
});
EVENT_FETCHERS["czn"] = Object.assign(EVENT_FETCHERS["czn"] || {}, {
	default: (url, signal, tz) => ns_batch2_fetchCznEvents(url, signal, tz)
});
