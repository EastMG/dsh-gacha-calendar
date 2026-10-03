		//#region next-sources（新增游戏来源：解析器 + 来源声明 + 抓取器登记）
		// ⚠️ 生成物，勿手改：改 next-sources/ 后重跑
		//    node diag/handoff-2026/merge-next-sources.mjs
		// 条目与备选源全部来自 next-sources/registry.js（单一真源），解析器来自 next-sources/parsers/。

		//#region next-sources 桥接适配器
		// 解析器原本 import ./lib/env.js；这里用插件已有实现 + 少量补齐顶上（解析器代码不改）。
		//   sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags → 本体已有
		//   pad2 / decodeEntities / textOf                                    → 本区补
		//   fetchText / fetchJson / fetchMediaWikiText                        → 接宿主代理 / 直连
		const ENTITIES_NS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
		// ⚠️ pad2 本体**没有**（第一版误以为有 → 7 个 bwiki 来源全报 "pad2 is not defined"）
		function pad2(n) { return String(n).padStart(2, "0"); }
		function decodeEntities(s) {
			return String(s).replace(/&(#\d+|[a-z]+);/gi, (m, k) => {
				const key = k.toLowerCase();
				if (ENTITIES_NS[key] != null) return ENTITIES_NS[key];
				if (/^#\d+$/.test(key)) { try { return String.fromCodePoint(Number(key.slice(1))); } catch { return m; } }
				return m;
			});
		}
		function textOf(html) {
			return decodeEntities(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
				.replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
		}
		async function fetchText(url, opts) {
			const o = opts || {};
			if (o.mode === "direct") {
				const res = await transportFetchRaw(url, { signal: o.signal, headers: Object.assign({}, rawHeaders(url), o.headers || {}) });
				if (!res.ok) throw new Error("http-" + res.status);
				return res.text();
			}
			return proxyFetchText(url, o.referer || "", o.headers, o.body);
		}
		async function fetchJson(url, opts) {
			const t = await fetchText(url, opts);
			try { return JSON.parse(t); } catch { throw new Error("bad-json"); }
		}
		async function fetchMediaWikiText(url, opts) {
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const json = await fetchJson(apiUrl, opts);
			const text = json && json.parse && json.parse.text;
			if (typeof text !== "string") throw new Error("bad-json");
			return text;
		}
		//#endregion

		//#region 悬停排版共用工具（**从 next-sources/lib/env.js 原样内联，勿手改**）
		// 方案 A（用户 2026-10-03）：新增来源的悬停频出「格式/规则与原有条目差别很大」，
		// 根因是各批次各写各的。这里把排版逻辑做成唯一真源，解析器一律调用。
		// 本区域内容由 merge-next-sources.mjs 从 env.js 的「悬停排版」区域抽取，改实现请改 env.js。
// ── 为什么单独立一个区域 ──
// 用户 2026-10-03 反馈「新增游戏的悬停样式/格式/规则和原来的差别很大」。核实后确认：
// 各批次解析器**各写各的悬停**，出现了三类偏差 ——
//   ① 悬停里塞元信息（来源 URL / 时区推定 / 抓取条数 / 实现细节）—— 本体条目**从不**这样做
//   ② 「档期在前、名称在后」（本体一律 `名称 + 3 空格 + 档期`）
//   ③ 档期用源站原文而非 fmtWindow 格式化
// 修法（方案 A）：把本体那两个函数的排版逻辑抽到这里做**唯一真源**，解析器一律调用。
//
// ── 为什么能同时服务测试与运行时 ──
//   · Node 测试直接 `import { hoverPool, hoverEvent } from "../lib/env.js"`
//   · 插件运行时由生成器把**本区域原样内联**进 ADAPTER（见 diag/handoff-2026/merge-next-sources.mjs）
//   ⇒ 只有一份实现，不存在漂移。
//
// ── 与本体唯一的差别 ──
// 本体的两个函数调 `fmtWindow(ts, endTs)` **漏传 tz**（`wallOf` 会退回本机时区）；
// 这里 tz 是**显式参数**，非 UTC+8 的源（日服 JST / 国际服 UTC）才能排对时刻。
//
// ── 返回 "" 的语义（与本体一致，调用方必须遵守）──
// 「当期条数 < 2」时返回 ""，表示**交回 UI 的默认单条两行式**：
//   卡池 `池名：角色名` ⏎ `档期`；活动 `名称` ⏎ `档期`。
// 所以调用方**不要**在返回值后面再拼任何东西；空串就让字段留空。

// 长期/常驻判定：声明窗口超过 120 天的不当作「当期活动」（阈值同本体 EVENT_MAX_WINDOW_DAYS）
const HOVER_MAX_WINDOW_DAYS = 120;
function hoverIsLongTerm(x) {
	return !!x && x.startTs != null && x.endTs != null && (x.endTs - x.startTs) > HOVER_MAX_WINDOW_DAYS * 864e5;
}
// 排序：结束时间升序（无/未知结束时间排最后），再按开始时间
function hoverSortByEnd(a, b) {
	const ea = a.endTs == null ? Infinity : a.endTs;
	const eb = b.endTs == null ? Infinity : b.endTs;
	if (ea !== eb) return ea - eb;
	const sa = a.startTs == null ? Infinity : a.startTs;
	const sb = b.startTs == null ? Infinity : b.startTs;
	return sa - sb;
}
// 永久/常驻活动计数行（措辞与本体 permanentLine 逐字一致）
function hoverPermanentLine(count) { return count > 0 ? `以及常驻活动 ${count} 项` : ""; }

/**
 * 卡池列悬停。复刻本体 `buildPoolHover`：
 *   每池两行 —— `池名：角色` ⏎ `档期`；窗口完全相同的池合并时间（只在末尾写一遍）。
 * `pools` 项：`{ name, label?, startTs?, endTs?, raw? }`（`label` 优先于 `name`）。
 * 返回 "" = 不足 2 池，交回 UI 默认两行式。
 */
function hoverPool(pools, tz) {
	const list = (Array.isArray(pools) ? pools : [])
		.filter((p) => p && typeof p.name === "string" && p.name.trim() !== "")
		.sort(hoverSortByEnd);
	if (list.length < 2) return "";
	const allTimed = list.every((p) => p.startTs != null && p.endTs != null);
	const same = allTimed && new Set(list.map((p) => `${p.startTs}~${p.endTs}`)).size === 1;
	const lines = [];
	for (const p of list) {
		lines.push(p.label || p.name);
		if (same) continue;
		const t = p.startTs != null && p.endTs != null ? fmtWindow(p.startTs, p.endTs, tz) : String(p.raw || "").trim();
		if (t) lines.push(t);
	}
	if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs, tz));
	return lines.join("\n");
}

/**
 * 活动列悬停。复刻本体 `buildEventHover`：
 *   每条一行 `名称` + **3 空格** + `档期`（档期用 fmtWindow 格式化）；
 *   窗口完全相同时只列名称、末尾写一次档期；缺起止的行显示该行 `raw` 原文。
 * **不排序**（与本体一致：调用方负责排序）。
 * `permanentCount` = 永久/常驻活动数，只在末尾补一行计数。
 * 返回 "" = 不足 2 条（交回 UI 默认两行式）。
 */
function hoverEvent(items, tz, permanentCount = 0) {
	const list = (Array.isArray(items) ? items : [])
		.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
		.filter((x) => !hoverIsLongTerm(x));
	if (list.length < 2) return hoverPermanentLine(permanentCount);
	const allTimed = list.every((x) => x.startTs != null && x.endTs != null);
	const same = allTimed && new Set(list.map((x) => `${x.startTs}~${x.endTs}`)).size === 1;
	const lines = list.map((x) => {
		if (x.startTs != null && x.endTs != null) {
			return same ? x.name : `${x.name}   ${fmtWindow(x.startTs, x.endTs, tz)}`;
		}
		const raw = String(x.raw || "").trim();
		return raw ? `${x.name}   ${raw}` : x.name;
	});
	if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs, tz));
	if (permanentCount > 0) lines.push(hoverPermanentLine(permanentCount));
	return lines.join("\n");
}
		//#endregion


		// ===== 内联自 next-sources/parsers/p5x.js（模块级标识符已加 ns_p5x_ 前缀）=====

// next-sources/parsers/p5x.js —— P5X 国服（完美世界官方站）
//
// ⚠️ 调研结论（2026-10-02 / 2026-10-03 实测）
//   官方站的**卡池/活动专栏已停更两年**：
//     · /news/gamebroad/（游戏公告）最后一条 2024-10-10
//     · /news/gameevent/（游戏活动）最后一条 2024-09-27
//     · /news/gamenews/（游戏新闻 = 版本更新公告）**仍在更新**（实测最新 2026-09-24「5.4.1版本今日上线」）
//   所以只能从**版本更新公告正文**里抽卡池/活动。这没问题 —— 官方正文是**分区块**的，
//   每个区块自带标题与 `活动时间：`，形如：
//
//     <p>契约更新</p>
//     <p>缘结之契开启</p>
//     <p>活动时间：2026年9月24日—2026年10月22日</p>
//     <p>指定自选契约「缘结之契」再次开启！</p>
//
// ── 2026-10-03 修的真实 bug ──
//   旧实现把**公告标题**（`逐月者之梦《女神异闻录：夜幕魅影》5.4.1版本今日上线`）
//   当成"卡池名"，并在**全文**里抓第一个覆盖当前的 `A日—B日`。后果：
//   · 面板卡池列显示的是**版本更新公告标题**，像"5.4.1版本今日上线"这种，用户看不出卡池是什么；
//   · 抓到的档期是**版本周期**（如 09-24 ~ 10-22），而不是卡池周期。
//   实测反例（证明两者确实不同）：5.3.1 版本周期 8/13–9/3，而官方在同篇正文里给
//   「统统创飞」「怪盗幻像的试炼」写的是 **8/24–9/3**。
//   修法：**先切区块**，卡池只认「契约更新」块、活动只认「活动更新」块，各自用**自己那行的**档期。
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw? } | { event, eventDates, ... }
//
// 时区：国服，源站**未见显式标注**（原文只有「2026年9月24日—10月22日」），按 UTC+8 推定。
// 数据形态：日期是**纯日期无时分** → 起止按惯例补 04:00 / 03:59（推算，非源站给定值）。


const ns_p5x_BASE = "https://p5x.wanmei.com";

// 列表页 → 条目数组 [{ href, title, dateText }]
function ns_p5x_parseP5xList(html) {
	const items = [];
	// 站点形态：<a href="/news/gamenews/20260924/264338.html"> … <p class="item_title">标题</p> … <p class="date_time">2026.09.24</p>
	const re = /<a[^>]+href="(\/news\/[a-z]+\/(\d{8})\/(\d+)\.s?html)"[^>]*>([\s\S]{0,1200}?)<\/a>/g;
	for (const m of String(html).matchAll(re)) {
		const block = m[4];
		const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/);
		const dm = block.match(/class="date_time"[^>]*>([\s\S]*?)<\/\w+>/);
		const title = tm ? stripTags(tm[1]) : "";
		if (!title) continue;
		items.push({ href: m[1], dateKey: m[2], id: m[3], title, dateText: dm ? stripTags(dm[1]) : "" });
	}
	// 兜底：站点偶有 class 顺序不同 → 退化为"按 href 切块"再就近找标题/日期
	if (items.length === 0) {
		const links = [...String(html).matchAll(/href="(\/news\/([a-z]+)\/(\d{8})\/(\d+)\.s?html)"/g)];
		for (const m of links) {
			const start = m.index;
			const block = String(html).slice(start, start + 1400);
			const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/) || block.match(/<p[^>]*>([^<]{4,80})<\/p>/);
			const title = tm ? stripTags(tm[1]) : "";
			if (title) items.push({ href: m[1], dateKey: m[3], id: m[4], title, dateText: "" });
		}
	}
	// 去重（同一 href 可能在"最新/推荐"两处出现）
	const seen = new Set();
	return items.filter((x) => (seen.has(x.href) ? false : (seen.add(x.href), true)));
}

// 详情页正文 → 纯文本（**按块级标签切行**，区块解析依赖这个行结构）
// 导出供测试：夹具测试需要"HTML→行文本"这一步，跟抓取器用同一实现，避免测试自造。
function ns_p5x_p5xBodyText(html) {
	return decodeEntities(
		String(html)
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/p>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
	).replace(/[ \t\u00a0]+/g, " ");
}

// 从**单行文本**抽「YYYY年M月D日 — YYYY年M月D日」档期
// 形态（实测）：`2026年9月24日—10月22日更新前`、`2026年10月5日—2026年10月22日更新前`
function ns_p5x_parseP5xWindows(text, tz) {
	const out = [];
	const re = /(20\d{2})年(\d{1,2})月(\d{1,2})日\s*[—\-~～至]\s*(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/g;
	for (const m of String(text).matchAll(re)) {
		const y1 = +m[1], mo1 = +m[2], d1 = +m[3];
		const y2 = m[4] ? +m[4] : (mo1 > +m[5] ? y1 + 1 : y1);   // 跨年：结束月小于开始月
		const mo2 = +m[5], d2 = +m[6];
		// 时刻：公告只给日期 → 按国服惯例补 04:00 开 / 03:59 收（推算，见文件头）
		const startTs = sourceInstant(y1, mo1, d1, 4, 0, tz);
		const endTs = sourceInstant(y2, mo2, d2, 3, 59, tz);
		if (endTs <= startTs) continue;
		out.push({ startTs, endTs, raw: `${y1}年${mo1}月${d1}日 ~ ${y2}年${mo2}月${d2}日` });
	}
	return out;
}

// ── 区块解析 ──
// 类别行形态（实测）：`活动更新`、`契约更新`、`玩法更新`、`功能拓展`、`启示卡更新`、
//   `版本更新`、以及**类别与标题同行**的 `活动更新-2.5周年时光庆典`、`活动BOSS更新-追欲的魔术师`。
// 注意：不能只按"含更新"就认 —— 正文里还有 `版本更新后，将新增2种启示卡…` 这类叙述句。
// 这里要求整行**以「类别+更新/拓展」结尾**，或后面只跟一个短分隔符+标题（≤40 字），
// 从而把叙述句排除掉。
const ns_p5x_P5X_CAT_RE = /^([\u4e00-\u9fffA-Za-z]{2,10}(?:更新|拓展))(?:\s*[-－—－:：]\s*(.{1,40}))?$/;
// `活动时间：…` 及其近义写法
const ns_p5x_P5X_TIME_RE = /^(?:活动|开放|售卖|举办|开启|持续)时间\s*[:：]\s*(.+)$/;

/**
 * 把公告正文切成区块。返回 [{ category, name, title, windowRaw, lines }]
 *   · category —— 类别行（如 `契约更新` / `活动更新`）
 *   · name     —— 与类别同行的标题（`活动更新-2.5周年时光庆典` 时为 `2.5周年时光庆典`）
 *   · title    —— 该区块的展示名：优先同行标题，否则取类别行后的第一条非时间行
 *   · windowRaw—— 该区块里**第一行** `活动时间：…` 的原文
 */
function ns_p5x_parseP5xBlocks(text) {
	const lines = String(text).split("\n").map((s) => s.trim()).filter(Boolean);
	const blocks = [];
	let cur = null;
	for (const line of lines) {
		const cm = line.match(ns_p5x_P5X_CAT_RE);
		if (cm) {
			if (cur) blocks.push(cur);
			cur = { category: cm[1], name: (cm[2] || "").trim(), title: (cm[2] || "").trim(), windowRaw: "", lines: [] };
			continue;
		}
		if (!cur) continue;                    // 类别行之前的内容（导语）忽略
		const tm = line.match(ns_p5x_P5X_TIME_RE);
		if (tm) {
			if (!cur.windowRaw) cur.windowRaw = tm[1].trim();
			continue;
		}
		if (!cur.title) cur.title = line;       // 类别行后紧跟的第一条非时间行 = 标题
		cur.lines.push(line);
	}
	if (cur) blocks.push(cur);
	return blocks;
}

// 供测试：直接对一段正文本跑区块解析
function ns_p5x_parseP5xText(text, tz) {
	const blocks = ns_p5x_parseP5xBlocks(text);
	return blocks.map((b) => ({
		category: b.category,
		title: b.title,
		windowRaw: b.windowRaw,
		windows: ns_p5x_parseP5xWindows(b.windowRaw, tz)
	}));
}

// 归一化标题：去掉站点尾巴「-P5X-《女神异闻录：夜幕魅影》手游官网」
function ns_p5x_cleanTitle(t) {
	return String(t).replace(/[-—|]\s*P5X\s*[-—|]?[\s\S]*$/, "").trim() || String(t).trim();
}

// 取列表里最新的 N 条公告并解析出区块。
// ⚠️ **逐条容错**：只有"最新一条都抓不到"才算真失败（抛出）；
//    次新那条只是"多看一条"的兜底（上一轮公告通常已过期），它抓不到（404/超时）不该拖垮整个条目
//    —— 实测踩过：夹具只映射了最新一条，多抓的第 2 条 404 直接把整条报成"抓取失败"。
async function ns_p5x_fetchP5xAnnouncements(url, signal, count = 2) {
	const listUrl = url || `${ns_p5x_BASE}/news/gamenews/index.html`;
	const list = ns_p5x_parseP5xList(await fetchText(listUrl, { referer: ns_p5x_BASE, signal }));
	if (list.length === 0) throw new Error("p5x-list-empty");
	const sorted = list.slice().sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)).slice(0, Math.max(1, count));
	const out = [];
	for (let i = 0; i < sorted.length; i++) {
		const item = sorted[i];
		const detailUrl = item.href.startsWith("http") ? item.href : ns_p5x_BASE + item.href;
		try {
			const text = ns_p5x_p5xBodyText(await fetchText(detailUrl, { referer: ns_p5x_BASE, signal }));
			out.push({ item, text, blocks: ns_p5x_parseP5xBlocks(text) });
		} catch (err) {
			if (err && err.name === "AbortError") throw err;   // 中止信号必须透传
			if (i === 0) throw err;                            // 最新一条失败 = 真失败
			// 次新一条失败 → 忽略（已有一条可用）
		}
	}
	return out;
}

// 在候选区块里挑"覆盖当前时刻"的那个；都没有就返回 null（= 未公布）
function ns_p5x_pickCurrentBlock(cands, tz, now) {
	const withWin = [];
	for (const b of cands) {
		const wins = ns_p5x_parseP5xWindows(b.windowRaw, tz);
		if (wins.length === 0) continue;
		withWin.push({ block: b, win: wins[0] });
	}
	return withWin.find((x) => x.win.startTs <= now && x.win.endTs >= now) || null;
}

// 正文导语里的「…「X」获取概率限时UP！」—— 本期限定 UP 池名（官方只给名字，常不给档期）
function ns_p5x_p5xUpNames(text) {
	const out = [];
	for (const m of String(text).matchAll(/[「【]([^」】]{2,30})[」】]\s*获取概率限时UP/g)) {
		const n = m[1].trim();
		if (n && !out.includes(n)) out.push(n);
	}
	return out;
}

// ── 卡池侧 ──
// 只认「契约更新」块（官方唯一明确写卡池档期的地方）。
// 抽不到覆盖当前的契约档期 → null（未公布）。**绝不**退化成"拿版本公告标题当卡池名"。
async function ns_p5x_gachaP5x(url, signal, tz = "Asia/Shanghai") {
	const anns = await ns_p5x_fetchP5xAnnouncements(url, signal, 2);
	const now = Date.now();
	for (const { text, blocks } of anns) {
		const poolBlocks = blocks.filter((b) => /契约/.test(b.category) || /契约/.test(b.title));
		const hit = ns_p5x_pickCurrentBlock(poolBlocks, tz, now);
		if (!hit) continue;
		const up = ns_p5x_p5xUpNames(text);
		const hover = [
			hit.block.title,
			fmtWindow(hit.win.startTs, hit.win.endTs, tz),
			up.length ? `本期限定UP：${up.join("、")}` : ""
		].filter(Boolean).join("\n");
		return {
			banner: hit.block.title,
			roles: "",
			bannerDates: fmtWindow(hit.win.startTs, hit.win.endTs, tz),
			bannerDatesRaw: hit.block.windowRaw,
			bannerHover: hover,
			startTs: hit.win.startTs,
			endTs: hit.win.endTs
		};
	}
	return null;
}

// ── 活动侧 ──
// 只认「活动」类区块（`活动更新` / `活动BOSS更新`）。外显取**最早结束**的当期活动（最紧迫），
// 悬停按结束时间升序逐行列出全部当期活动。
async function ns_p5x_eventsP5x(url, signal, tz = "Asia/Shanghai") {
	const anns = await ns_p5x_fetchP5xAnnouncements(url, signal, 2);
	const now = Date.now();
	for (const { blocks } of anns) {
		const evBlocks = blocks.filter((b) => /活动/.test(b.category));
		const active = [];
		for (const b of evBlocks) {
			const wins = ns_p5x_parseP5xWindows(b.windowRaw, tz);
			if (wins.length === 0) continue;
			const w = wins[0];
			if (w.startTs <= now && w.endTs >= now && b.title) active.push({ block: b, win: w });
		}
		if (active.length === 0) continue;
		// 稳定排序：先按结束时间升序（越紧迫越前），同结束时间保持原文顺序
		active.sort((a, b) => a.win.endTs - b.win.endTs);
		const primary = active[0];
		const hover = active.map((x) => `${x.block.title}  ${fmtWindow(x.win.startTs, x.win.endTs, tz)}`).join("\n");
		return {
			event: primary.block.title,
			eventDates: fmtWindow(primary.win.startTs, primary.win.endTs, tz),
			eventDatesRaw: primary.block.windowRaw,
			eventHover: hover
		};
	}
	return null;
}

// 供测试：从本地 HTML 直接跑解析（不联网）
function ns_p5x_gachaP5xFromHtml(listHtml, detailHtml, tz = "Asia/Shanghai") {
	void listHtml; void detailHtml; void tz;
	throw new Error("unused");   // 夹具测试走 fetch 注入（见 test/run.mjs）
}

		// ===== 内联自 next-sources/parsers/bwiki.js（模块级标识符已加 ns_bwiki_ 前缀）=====

// next-sources/parsers/bwiki.js —— 批次 B2：bwiki（MediaWiki api.php）来源
//
// 统一抓取形态（**全部 mode:"proxy"**，2026-10-02 实测 bwiki 全系 ACAO 为空）：
//   https://wiki.biligame.com/<wiki>/api.php?action=parse&page=<页面名URL编码>&prop=text&format=json&formatversion=2
// 用 `fetchMediaWikiText(url, opts)`：它会自动追加 `&origin=*` 并取 `parse.text`。
// 契约：async (url, signal, tz) → 数据对象 | null（见 CONVENTIONS.md）。
//   `now` 只在最后一位、自带默认值（铁律 2）；测试可传固定 now 以离线断言。
//
// ─────────────────────────────────────────────────────────────────────────────
// 实测结论（2026-10-02，夹具见 fixtures/bwiki-*）：**7 个来源 / 8 个"侧"里只有 2 侧能给出"当期"数据**
//   来源            页面            结构                        实测最新一条        当期可用?
//   whmx 物华弥新    限时招集档案     CardSelect 表 113 行        2026-09-30 起        ✅ 覆盖 now
//   umamusume 简中   简中卡池         两张表：已实装 191 行 / 预测 240 行  2026-10-23 止  ✅ 覆盖 now
//   umamusume 日服   活动             单表 100 行（标题=「往期活动」）   2025-12-26 起    ❌ 归档，停在 2025-12
//   whmx 物华弥新    活动             CardSelect 表 62 行        2025-05-01 起        ❌ 停在 2025-05
//   zspms 战双       研发记录         107 张小表（每池一张）       2024-03-21 起        ❌ 停在 2024Q1
//   kedrgame 雪松    卡池信息         无表格，仅「台架测试[一/二]」  2024-12-07 ~ 13      ❌ 台架测试占位
//   czn 卡厄斯梦境   卡池记录         只有「模板:Gacha」链接，空页   —                    ❌ 无内容
//   stellasora 星塔  首页             活动日历 2 项（JS 计算剩余时间） 2026-04-07 止     ❌ 停更 + 无名
//   ⇒ 另外 6 侧在"当期"判定下**如实返回 null**（源站抓到页面但当期没有内容），
//     而不是硬凑一个过期档期。逐条都在这份注释与 registry-b2.js 里写明。
// ─────────────────────────────────────────────────────────────────────────────
//
// 「当期」判定沿用插件本体 `src/client/30-parsers.js` 的 bwiki 语义（bwikiGachaPayload /
// genericEventPayload）：**过滤出覆盖当前时刻的条目；一条都没有 → 返回 null（未公布）**。
// 卡池外显取"结束最早"的池（越快结束越该盯住），roles 合并同期全部主池；活动外显优先
// 剧情/挑战档，悬停按结束时间升序逐行。
//
// 时区（依据见 registry-b2.js 注释）：
//   · 国服（whmx / umamusume 简中 / zspms / kedrgame / czn / stellasora）= Asia/Shanghai（**推测**，源站未显式标注）
//   · 赛马娘日服（umamusume 活动）= Asia/Tokyo（**硬标注**：卡池页正文「日服卡池时间记录统一为日本时间」）
//
// 已知源站坑（都做了处理，见各解析器注释）：
//   ① umamusume 简中「已实装卡池」表的时间列是 **结束 ~ 开始**（与其它表相反）→ 按整表多数票判定朝向
//   ② 该表 191 个数据行里，94 行「支援卡卡池」共用上一行的 `rowspan="2"` 时间 → 只有 3 格，需继承日期
//   ③ 战双日期带 12 小时制（`10:00 AM`）；雪松日期只有日期无时刻；whmx 有「开服后」这种无时刻写法
//   ④ 源站存在错行（uma 日服活动 `2025/04/10 11:00~ 2024/04/18 10:59`）→ endTs<=startTs 的行整行丢弃
//   ⑤ bwiki 对高频请求返回 HTTP 567（WAF 挑战页，body 7KB，含 "567 <id>"）→ 抓夹具必须重试/限速


//#region HTML 工具（够用即可，不引依赖）
// MediaWiki 的表格会嵌套（cell 内嵌 table）→ 用深度计数切表，避免非贪婪正则截断
function ns_bwiki_eachTable(html) {
	const out = [];
	const re = /<table\b[^>]*>|<\/table>/gi;
	let m, depth = 0, start = -1;
	while ((m = re.exec(html))) {
		if (m[0][1] !== "/") { if (depth === 0) start = m.index; depth++; }
		else { depth--; if (depth === 0) out.push(html.slice(start, m.index + m[0].length)); }
	}
	return out;
}
// 行 → [{ attrs, cells:[{tag,attrs,html,text}] }]
function ns_bwiki_tableRows(tbl) {
	const rows = [];
	const re = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
	let m;
	while ((m = re.exec(tbl))) rows.push({ attrs: m[1], cells: ns_bwiki_rowCells(m[2]) });
	return rows;
}
function ns_bwiki_rowCells(rowHtml) {
	const out = [];
	const re = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
	let m;
	while ((m = re.exec(rowHtml))) {
		out.push({ tag: m[1].toLowerCase(), attrs: m[2], html: m[3], text: stripTags(m[3]) });
	}
	return out;
}
function ns_bwiki_attrOf(html, name) {
	const s = String(html);
	const m = s.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i")) || s.match(new RegExp(name + "\\s*=\\s*'([^']*)'", "i"));
	return m ? stripTags(m[1]) : "";
}
// 表头单元格文本（取第一行含 <th> 的）
function ns_bwiki_headerCells(tbl) {
	const hr = ns_bwiki_tableRows(tbl).find((r) => r.cells.some((c) => c.tag === "th"));
	return hr ? hr.cells.map((c) => c.text) : [];
}
function ns_bwiki_findTablesByHeaders(tables, wanted) {
	return tables.filter((tbl) => {
		const h = ns_bwiki_headerCells(tbl).join("|");
		return wanted.every((w) => h.includes(w));
	});
}
// 表/节点之前最近的小节标题（用于取干净的池名、区分「已实装/预测」两张同表头表）
function ns_bwiki_headingBefore(html, idx) {
	const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
	let m, last = "";
	while ((m = re.exec(html))) {
		if (m.index >= idx) break;
		last = stripTags(m[2]).replace(/\s*\[\s*编辑\s*\]\s*/g, "").trim();
	}
	return last;
}
// 图片名 → 可读名（whmx 用 `孤岛螺旋-banner.png`；stellasora 用 `Banner bossrush 5.png`）
function ns_bwiki_cleanImgName(alt) {
	let x = String(alt || "").trim();
	if (!x || /^(无图|暂无)/.test(x)) return "";
	x = x.replace(/^文件\s*[:：]\s*/, "").replace(/\.(png|jpe?g|gif|webp)$/i, "");
	x = x.replace(/^banner[\s_-]*/i, "").replace(/[\s_-]*banner$/i, "");
	return x.trim();
}
// 单元格里所有 <a title="…">（去重、保序）—— bwiki 常把角色名只放在 title/alt 属性里。
// 少数行没有角色词条，只有图片文件链接（如 whmx 自选池 `文件:结伴同游·请调书.png`）→ 退化为清洗后的文件名。
function ns_bwiki_linkTitles(html) {
	const out = [], seen = new Set();
	const re = /<a\b[^>]*\btitle\s*=\s*"([^"]*)"/gi;
	let m;
	while ((m = re.exec(String(html)))) {
		let t = stripTags(m[1]).trim();
		if (/^(文件|File|分类|Category)\s*[:：]/i.test(t) || /\.(png|jpe?g|gif|webp)$/i.test(t)) t = ns_bwiki_cleanImgName(t);
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}
//#endregion

//#region 日期解析
// 三种源站写法：
//   `2026年09月30日 10:00`、`2026年9月30日开服后`（无时刻）
//   `2026/09/30 10:00`、`2026/9/30 9:59 AM`（12 小时制）、`2024/12/7`
//   `10月22日 09:59`（省年份 → 继承上一个点的年份，月倒退则 +1 年）
const ns_bwiki_DATE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?|(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})|(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;

// 紧跟日期之后的时刻（可带 AM/PM）；没有 → null（= 源站只给日期）
function ns_bwiki_timeAfter(text, from) {
	const m = String(text).slice(from, from + 14).match(/^\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?/);
	if (!m) return null;
	let h = +m[1];
	const mi = +m[2];
	const ap = m[3] ? m[3].toLowerCase() : "";
	if (ap === "p" && h < 12) h += 12;
	if (ap === "a" && h === 12) h = 0;
	if (h > 23 || mi > 59) return null;
	return { h, mi };
}
// 文本 → 日期点数组 [{y,mo,d,h,mi,noTime}]
function ns_bwiki_parsePoints(text) {
	const s = String(text);
	const out = [];
	let lastY = null, lastMo = null;
	ns_bwiki_DATE_RE.lastIndex = 0;
	let m;
	while ((m = ns_bwiki_DATE_RE.exec(s))) {
		let y, mo, d;
		if (m[1] != null) { y = +m[1]; mo = +m[2]; d = +m[3]; }
		else if (m[4] != null) { y = +m[4]; mo = +m[5]; d = +m[6]; }
		else { y = null; mo = +m[7]; d = +m[8]; }
		if (y == null) {
			if (lastY == null) continue;                        // 前面也没有年份 → 无法定位
			y = lastMo != null && mo < lastMo - 6 ? lastY + 1 : lastY;   // 跨年（12月 → 1月）
		}
		const t = ns_bwiki_timeAfter(s, m.index + m[0].length);
		out.push({ y, mo, d, h: t ? t.h : 0, mi: t ? t.mi : 0, noTime: !t });
		lastY = y; lastMo = mo;
	}
	return out;
}
function ns_bwiki_pointTs(p, tz) { return sourceInstant(p.y, p.mo, p.d, p.h, p.mi, tz); }
function ns_bwiki_prettyPoint(p) { return `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}`; }

// 整表朝向：源站有些表写「开始 ~ 结束」，有些写「结束 ~ 开始」（uma 简中已实装表就是后者）。
// 用多数票判定，避免个别错行把整表判反；错行本身按 endTs<=startTs 丢弃。
function ns_bwiki_detectOrientation(texts, tz) {
	let rev = 0, nor = 0;
	for (const t of texts) {
		const ps = ns_bwiki_parsePoints(t);
		if (ps.length < 2) continue;
		const a = ns_bwiki_pointTs(ps[0], tz), b = ns_bwiki_pointTs(ps[1], tz);
		if (a > b) rev++;
		else if (a < b) nor++;
	}
	return rev > nor ? "endFirst" : "startFirst";
}
// 单元格 → 窗口（取前两个日期点）；只有日期没时刻时：起点按 00:00、终点按 23:59
function ns_bwiki_windowsFromCell(text, tz, orient = "startFirst") {
	const ps = ns_bwiki_parsePoints(text);
	if (ps.length < 2) return [];
	const a = ps[0], b = ps[1];
	let sp, ep;
	if (orient === "endFirst") { sp = b; ep = a; } else { sp = a; ep = b; }
	const startTs = ns_bwiki_pointTs(sp, tz);
	const endTs = ns_bwiki_pointTs(ep.noTime ? { ...ep, h: 23, mi: 59 } : ep, tz);
	if (!(endTs > startTs)) return [];                     // 源站错行 → 丢掉（不硬造）
	const raw = String(text).replace(/\s+/g, " ").trim();
	return [{ startTs, endTs, raw, startText: ns_bwiki_prettyPoint(sp), endText: ns_bwiki_prettyPoint(ep) }];
}
//#endregion

//#region 当期挑选（沿用插件本体语义）
const ns_bwiki_EVENT_TIER1_RE = /剧情|叙事|主线|故事|活动正篇|总力战|總力戰|大决战|大決戰|决战|決戰|危机合约|危機合約|制约解除|综合战术|綜合戰術|挑战|挑戰|深度巡防|极限|逆境深塔|全息/;
function ns_bwiki_eventTier(x) {
	const cat = `${x.cat || ""} ${x.name || x.event || ""}`.trim();
	return ns_bwiki_EVENT_TIER1_RE.test(cat) ? 1 : 2;
}
function ns_bwiki_nowOf(now) { return typeof now === "number" && Number.isFinite(now) ? now : Date.now(); }

// 覆盖 now 的条目：结束在未来且已开始（起点未知的行按"已开始"处理）
function ns_bwiki_activeItems(items, now) {
	return items.filter((it) => it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now));
}
// 卡池：主池优先；外显取结束最早（同结束按**页面顺序**，与插件 `selectCurrent` 的稳定排序一致）
function ns_bwiki_pickCurrentPool(items, now) {
	const act = ns_bwiki_activeItems(items, now);
	if (act.length === 0) return null;
	const main = act.filter((it) => it.isMain !== false);
	const pool = (main.length ? main : act).slice()
		.sort((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0)));
	return { first: pool[0], pool };
}
function ns_bwiki_mergeRoles(items) {
	const seen = new Set(), out = [];
	for (const it of items) {
		for (const r of String(it.roles || "").split(/[、，,]/)) {
			const k = r.trim();
			if (!k || seen.has(k)) continue;
			seen.add(k);
			out.push(k);
		}
	}
	return out.join("、");
}
// 活动：外显优先剧情/挑战档，同级内结束时间升序
function ns_bwiki_pickCurrentEvent(items, now) {
	const act = ns_bwiki_activeItems(items, now);
	if (act.length === 0) return null;
	const ordered = act.slice().sort((a, b) => (ns_bwiki_eventTier(a) - ns_bwiki_eventTier(b))
		|| (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0)));
	return { first: ordered[0], ordered };
}
const ns_bwiki_permanentLine = (n) => (n > 0 ? `以及常驻活动 ${n} 项` : "");
// 卡池悬停：每池一行「池名：角色」，窗口不同时逐行补时间
function ns_bwiki_buildPoolHover(pools, tz) {
	if (pools.length < 2) return "";
	const same = new Set(pools.map((p) => `${p.startTs}~${p.endTs}`)).size === 1;
	const lines = [];
	for (const p of pools) {
		lines.push(`${p.banner}${p.roles ? `：${p.roles}` : ""}`);
		if (!same) lines.push(fmtWindow(p.startTs, p.endTs, tz));
	}
	if (same) lines.push(fmtWindow(pools[0].startTs, pools[0].endTs, tz));
	return lines.join("\n");
}
// 活动悬停：结束时间升序逐行；全部同窗口时时间只在末尾写一遍（与插件 ns_bwiki_buildEventHover 同）
function ns_bwiki_buildEventHover(items, tz, permanentCount = 0) {
	if (items.length < 2) return ns_bwiki_permanentLine(permanentCount);
	const same = new Set(items.map((x) => `${x.startTs}~${x.endTs}`)).size === 1;
	const lines = items.map((x) => (same ? x.event : `${x.event}   ${fmtWindow(x.startTs, x.endTs, tz)}`));
	if (same) lines.push(fmtWindow(items[0].startTs, items[0].endTs, tz));
	if (permanentCount > 0) lines.push(ns_bwiki_permanentLine(permanentCount));
	return lines.join("\n");
}
function ns_bwiki_gachaPayload(items, tz, now, extraHover = "") {
	const cur = ns_bwiki_pickCurrentPool(items, now);
	if (!cur) return null;                       // 有候选但都不覆盖当期 → 未公布（不硬凑过期档期）
	const first = cur.first;
	const hover = [ns_bwiki_buildPoolHover(cur.pool, tz), extraHover].filter(Boolean).join("\n");
	return {
		banner: first.banner,
		roles: ns_bwiki_mergeRoles(cur.pool),
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}
function ns_bwiki_eventPayload(items, tz, now, permanentCount = 0) {
	const cur = ns_bwiki_pickCurrentEvent(items, now);
	if (!cur) return null;
	const first = cur.first;
	return {
		event: first.event,
		eventDates: fmtWindow(first.startTs, first.endTs, tz),
		eventDatesRaw: first.raw || "",
		eventHover: ns_bwiki_buildEventHover(cur.ordered, tz, permanentCount)
	};
}
//#endregion

//#region ① 物华弥新（whmx）
// 卡池页「限时招集档案」：`<table id="CardSelectTr" class="CardSelect wikitable sortable col-fold">`
//   表头 `活动名称 | UP器者 | 开放时间 | 备注`，113 行数据；**名称/UP 都只在 <img alt> / <a title> 属性里**
//   （正文 text 是空的），所以必须读属性。行属性 `data-param1` 是招集类型（新实装器者·限定 …）。
//   时间写法：`2026年09月30日 10:00 ~ 10月22日 09:59`（终点省年份）；远古行有 `2024年4月19日开服后~…`。
function ns_bwiki_parseWhmxGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];                       // 空页 → 无候选
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间", "活动名称"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-gacha:no-table");   // 结构变了 → 抓取失败
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		const banner = ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || ns_bwiki_attrOf(r.attrs, "data-param1") || "限时招集";
		const roles = ns_bwiki_linkTitles(c1.html).join("、") || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt"));
		items.push({
			_i: i, banner, roles, cat: ns_bwiki_attrOf(r.attrs, "data-param1"), note: c3.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
// 活动页「活动」：同款 CardSelect 表，表头 `活动时间 | 图 | 名称 | 类型 | 备注`，63 行数据。
// ⚠️ 实测最新一条 = 2025/05/01（页面缓存时间 2026-10-01，即内容确实停在 2025-05）→ 当期无覆盖 → null。
function ns_bwiki_parseWhmxEvents(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-whmx-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 5 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3, c4] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			cat: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")), note: c4.text,
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
//#endregion

//#region ② 闪耀优俊少女 国服（umamusume / page=简中卡池）
// 页面两张同表头的表（各含表头行共 192 / 241 行，数据行 191 / 240）：
//   ①「已实装卡池」= 简中服**实际已实装**的记录（当期外显用这张） ②「预测卡池」= **推算**。
//   ⚠️ 页首正文：「简中卡池加速 -> 简中预测时间-185天 / 2025/05/22 简中重新更新 -> 简中预测时间+423天」
//      ⇒ 简中服时刻是**按日服时差推算**出来的，**不是官方时刻表**。本解析器只用①做当期外显，
//        ②的推算结果只放进 `bannerHover` 并显式标注「接下来的预测卡池（按日服时差推算，非官方时刻表）」。
//   表结构：表头 `时间 | 卡池(colspan=2) | Up对象` → 数据行 4 格 [时间][池类型][池名][Up对象]，
//     其中「支援卡卡池」行与上一行共用时间（上一行 `rowspan="2"`）→ 只有 3 格，需继承日期。
//   ⚠️① 表时间列是 **结束 ~ 开始**（整表多数票判定为 endFirst）；② 表是 **开始 ~ 结束**。
function ns_bwiki_parseUmaCnGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return { live: [], predicted: [] };
	const cands = ns_bwiki_findTablesByHeaders(tables, ["时间", "卡池"]);
	if (cands.length === 0) throw new Error("bwiki-uma-cn-gacha:no-table");
	const parseOne = (tbl) => {
		const raw = [];
		let pendingDate = "";
		for (const r of ns_bwiki_tableRows(tbl)) {
			const cs = r.cells;
			if (!cs.length || cs.some((c) => c.tag === "th")) continue;
			if (cs.length >= 4) {
				pendingDate = cs[0].text;
				raw.push({ dateText: pendingDate, catCell: cs[1], nameCell: cs[2], upCell: cs[3] });
			} else if (cs.length === 3) {
				raw.push({ dateText: pendingDate, catCell: cs[0], nameCell: cs[1], upCell: cs[2] });
			}
		}
		const orient = ns_bwiki_detectOrientation(raw.map((x) => x.dateText), tz);
		const items = [];
		raw.forEach((x, i) => {
			const wins = ns_bwiki_windowsFromCell(x.dateText, tz, orient);
			if (wins.length === 0) return;
			const cat = x.catCell.text;
			const roles = textOf(x.upCell.html).split("\n")
				.map((s) => s.trim().replace(/^简\//, "")).filter(Boolean).join("、");
			items.push({
				_i: i,
				banner: String(x.nameCell.text).replace(/\s+/g, " ").trim() || "卡池",
				roles, cat, isMain: !/支援/.test(cat),
				startTs: wins[0].startTs, endTs: wins[0].endTs,
				orient,                                   // 整表朝向（诊断/测试用；不进契约字段）
				raw: wins[0].raw                          // 源站原文（不含任何加工）
			});
		});
		return items;
	};
	// 用各表之前最近的小节标题区分「已实装」/「预测」（取不到标题时退回文档顺序）
	const withHead = cands.map((tbl) => ({ tbl, head: ns_bwiki_headingBefore(html, html.indexOf(tbl)) }));
	const liveTbl = (withHead.find((x) => /已实装/.test(x.head)) || withHead[0]).tbl;
	const predTbl = (withHead.find((x) => /预测/.test(x.head)) || withHead[1] || withHead[0]).tbl;
	return { live: parseOne(liveTbl), predicted: predTbl === liveTbl ? [] : parseOne(predTbl) };
}
// 预测卡池：只列"还没开始"的若干条（按开始时间升序），并显式标注为推算。
// 注：该表是 wiki 按日服时差机械平移出来的，池名里连**日服原始年份**都还留着
// （如 `八骏赛马娘卡池 20230911` 被平移到 2026-09），且远期条目一路排到 2029 年 ⇒ 只能当参考。
function ns_bwiki_umaCnPredictHover(predicted, tz, now, limit = 3) {
	const next = predicted.filter((p) => p.startTs > now).sort((a, b) => a.startTs - b.startTs || (a._i - b._i)).slice(0, limit);
	if (next.length === 0) return "";
	const lines = next.map((p) => `${p.banner}   ${fmtWindow(p.startTs, p.endTs, tz)}`);
	return ["—— 接下来的预测卡池（按日服时差推算，非官方时刻表） ——", ...lines].join("\n");
}
//#endregion

//#region ③ 赛马娘 日服（umamusume / page=活动）—— 时区硬标注 Asia/Tokyo
// 页面只有一张表，标题是「往期活动」（**归档**，不是当期排期），100 行；表头 `活动时间 | 图 | 名称 | 类型`。
//   时间写法 `2025/12/26 11:00~ 2026/01/08 10:59`（开始 ~ 结束）。
//   第 1 行是常驻（`常驻~ 常驻`，无日期）→ 只计入常驻条数，不进当期排序。
//   ⚠️ 实测最新一条 2025/12/26 ~ 2026/01/08（页面缓存时间 2026-10-01）→ 当期无覆盖 → null。
//   ⚠️ 源站有错行 `2025/04/10 11:00~ 2024/04/18 10:59` → endTs<=startTs 被整行丢弃。
function ns_bwiki_parseUmaJpEvents(html, tz = "Asia/Tokyo") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return { items: [], permanent: 0 };
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-uma-jp-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	let permanent = 0;
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) {
			if (/常驻|永久|長期|长期/.test(c0.text)) permanent++;
			return;
		}
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			cat: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return { items, permanent };
}
//#endregion

//#region ④ 战双帕弥什 国服（zspms / page=研发记录）
// 107 张独立小表，每张 = 一期「降临狙击」研发池：行1 = `<td colspan="2">` 立绘/名（名在 <a title>），
//   行2 = `日期 | 2024/03/21 10:00 AM 至 2024/04/04 09:59 AM`（**12 小时制**），
//   行3 = `效果 | 「<a title=角色>」…`。表格前最近的 h2 就是干净的池名（如 `【露西亚·深红囚影】…限时概率UP`）。
//   ⚠️ 实测最新一期 = 2024/03/21（页面缓存时间 2026-10-01）→ 该页 **停在 2024Q1**，当期无覆盖 → null。
//      （页首自述「目前该记录仅包括"降临狙击角色"池和"命运降临角色狙击"池」。）
function ns_bwiki_parseZspmsGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const items = [];
	let seenLabel = 0;
	tables.forEach((tbl, ti) => {
		const rows = ns_bwiki_tableRows(tbl);
		let dateText = "", roleText = "", imgTitle = "";
		for (const r of rows) {
			if (r.cells.length === 1) {                        // 立绘行（colspan=2）
				const t = ns_bwiki_attrOf(r.cells[0].html, "title") || r.cells[0].text;
				if (t) imgTitle = t;
			}
			for (let i = 0; i < r.cells.length; i++) {
				const label = r.cells[i].text;
				const next = r.cells[i + 1];
				if (!next) continue;
				if (/^(日期|时间)/.test(label)) { dateText = next.text; seenLabel++; }
				else if (/^效果/.test(label)) roleText = next.html;
			}
		}
		const w = ns_bwiki_windowsFromCell(dateText, tz, "startFirst")[0];
		if (!w) return;
		const head = ns_bwiki_headingBefore(html, html.indexOf(tbl));
		const roles = ns_bwiki_linkTitles(roleText).join("、");
		items.push({
			_i: ti,
			banner: head || ns_bwiki_cleanImgName(imgTitle) || "研发池",
			roles, cat: "研发", note: "降临狙击角色池",
			startTs: w.startTs, endTs: w.endTs, raw: w.raw
		});
	});
	if (seenLabel === 0 && tables.length > 0) throw new Error("bwiki-zspms-gacha:no-table");   // 结构变了
	return items;
}
//#endregion

//#region ⑤ 雪松（kedrgame / page=卡池信息）—— ⚠️ 台架测试占位页，可能已停更
// 该页**没有任何表格**，只有两个小节「台架测试[一]」「台架测试[二]」，正文形如：
//   `<b>===时间===</b>：2024/12/7-2024/12/13`（**只有日期、没有时刻**）
//   第二段是 `？-？`（未填）。→ 实测唯一可解析的窗口 = 2024/12/07 ~ 2024/12/13，早于当期 → null。
//   ⚠️ 风险标注：最近编辑 2025-08-01、页面自称「台架测试」；但同 wiki 有 `历史卡池-精英集结-1.0.0-*`、
//      `游戏内部公告(2026.6/7)` 等更新页面，说明 wiki 还活着、只是本页不再是有效数据源。
function ns_bwiki_parseKedrGacha(html, tz = "Asia/Shanghai") {
	const re = /={2,}\s*时间\s*={2,}\s*(?:<\/b>)?\s*[:：]?\s*([^<]*)/g;
	const items = [];
	let m, i = 0;
	while ((m = re.exec(String(html)))) {
		const value = m[1].replace(/\s+/g, " ").trim();
		const w = ns_bwiki_windowsFromCell(value, tz, "startFirst")[0];
		if (!w) continue;
		items.push({
			_i: i++,
			banner: ns_bwiki_headingBefore(html, m.index) || "卡池",
			roles: "", cat: "台架测试", note: value,
			startTs: w.startTs, endTs: w.endTs, raw: value
		});
	}
	return items;
}
//#endregion

//#region ⑥ 卡厄斯梦境 国服（czn / page=卡池记录）—— ⚠️ 实测为空页
// `prop=text` 全文只有 `模板:Gacha` 一个链接，**无表格、无日期**（wiki 侧该模板已不存在/不产出内容）。
// 同 wiki 站内搜索 "卡池" 只命中 4 页（卡池记录 / 首页 / 首页-PC端 / 首页-移动端），没有更好的卡池页。
// ⇒ 返回 []，抓取器据此返回 null（如实"抓到了页面但当期没内容"）。若日后 wiki 补全为 CardSelect 表，
//    本解析器按 whmx 同款表头（开放时间/活动名称）兜底解析。
function ns_bwiki_parseCznGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return [];
	const cands = ns_bwiki_findTablesByHeaders(tables, ["开放时间"]);
	if (cands.length === 0) return [];                         // 有表但不是卡池表 → 视为无内容
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[2].text), tz);
	const items = [];
	rows.forEach((r, i) => {
		const [c0, c1, c2] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c2.text, tz, orient);
		if (wins.length === 0) return;
		items.push({
			_i: i,
			banner: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c0.html, "alt")) || c0.text || "卡池",
			roles: ns_bwiki_linkTitles(c1.html).join("、"),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw
		});
	});
	return items;
}
//#endregion

//#region ⑦ 星塔旅人 国服（stellasora / page=首页 的「活动日历」区块）—— ⚠️ 低可用性
// 区块形如：
//   `<div class="activity-item"><img alt="Banner bossrush 5.png" …>
//      <div class="activity-time" data-end-time="2026-04-01T02:59:59">计算中...</div>
//      <div class="activity-date">2026/03/01</div></div>`
// 只有 2 项；**没有活动名文本字段**（只能取立绘文件名）、剩余时间由页面 JS 现算（静态是「计算中...」）。
// `data-end-time` 是**不带时区**的 ISO → 按源站墙钟（国服 UTC+8）解释（**假设**，见 registry-b2.js）。
// ⚠️ 实测两项分别止于 2026-04-01 / 2026-04-07（页面静态计数「当前正在进行的活动有 0 个」）→ 当期无覆盖 → null。
function ns_bwiki_parseStellasoraEvents(html, tz = "Asia/Shanghai") {
	const out = [];
	const re = /<div class="activity-item">([\s\S]*?)<div class="activity-date"\s*>([^<]*)<\/div>/g;
	let m, i = 0;
	while ((m = re.exec(String(html)))) {
		const block = m[1];
		const endIso = ns_bwiki_attrOf(block, "data-end-time");
		const startText = m[2].replace(/\s+/g, " ").trim();
		const alt = ns_bwiki_attrOf(block, "alt");
		const sp = ns_bwiki_parsePoints(startText)[0];
		const em = String(endIso).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
		if (!sp || !em) continue;
		const startTs = sourceInstant(sp.y, sp.mo, sp.d, 0, 0, tz);
		const endTs = sourceInstant(+em[1], +em[2], +em[3], +em[4], +em[5], tz);
		if (!(endTs > startTs)) continue;
		out.push({
			_i: i++,
			event: ns_bwiki_cleanImgName(alt) || "活动",
			cat: "活动日历", img: ns_bwiki_cleanImgName(alt), imgRaw: alt,
			startTs, endTs, raw: `${startText} ~ ${endIso}`
		});
	}
	return out;
}
//#endregion

//#region 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
async function ns_bwiki_fetchHtml(url, signal) {
	return fetchMediaWikiText(url, { signal, mode: "proxy" });
}
// 物华弥新 国服 —— 卡池
async function ns_bwiki_gachaWhmx(url, signal, tz = "Asia/Shanghai", now) {
	const items = ns_bwiki_parseWhmxGacha(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_gachaPayload(items, tz, ns_bwiki_nowOf(now));
}
// 物华弥新 国服 —— 活动
async function ns_bwiki_eventsWhmx(url, signal, tz = "Asia/Shanghai", now) {
	const items = ns_bwiki_parseWhmxEvents(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now));
}
// 闪耀优俊少女 国服 —— 卡池（只用「已实装卡池」，预测只进 bannerHover 且标注为推算）
async function ns_bwiki_gachaUmaCn(url, signal, tz = "Asia/Shanghai", now) {
	const { live, predicted } = ns_bwiki_parseUmaCnGacha(await ns_bwiki_fetchHtml(url, signal), tz);
	const n = ns_bwiki_nowOf(now);
	return ns_bwiki_gachaPayload(live, tz, n, ns_bwiki_umaCnPredictHover(predicted, tz, n));
}
// 赛马娘 日服 —— 活动（bwiki 侧；页面为「往期活动」归档）
async function ns_bwiki_eventsUmaJp(url, signal, tz = "Asia/Tokyo", now) {
	const { items, permanent } = ns_bwiki_parseUmaJpEvents(await ns_bwiki_fetchHtml(url, signal), tz);
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now), permanent);
}
// 战双帕弥什 国服 —— 卡池（研发记录）
async function ns_bwiki_gachaZspms(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseZspmsGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 雪松 —— 卡池（台架测试占位页）
async function ns_bwiki_gachaKedr(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseKedrGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 卡厄斯梦境 国服 —— 卡池（页面为空，预期 null）
async function ns_bwiki_gachaCzn(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_gachaPayload(ns_bwiki_parseCznGacha(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
// 星塔旅人 国服 —— 活动（首页活动日历，低可用性）
async function ns_bwiki_eventsStellasora(url, signal, tz = "Asia/Shanghai", now) {
	return ns_bwiki_eventPayload(ns_bwiki_parseStellasoraEvents(await ns_bwiki_fetchHtml(url, signal), tz), tz, ns_bwiki_nowOf(now));
}
//#endregion

		// ===== 内联自 next-sources/parsers/umapyoi.js（模块级标识符已加 ns_umapyoi_ 前缀）=====

// next-sources/parsers/umapyoi.js —— 赛马娘 日服（第三方 API：api.umapyoi.net）
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? } | null
//
// ⚠️ 实测（2026-10-02 夹具 `b1-umapyoi-gacha`，704 条）与任务给的简化形态的差别：
//   GET https://api.umapyoi.net/api/v1/gacha → JSON **数组**，每条 =
//     { card_type: "Outfit" | "Support Card", id, start_date, end_date, type }
//   · `start_date` / `end_date` 是 **Unix 秒**（不是毫秒）。
//   · `end_date === 2147483647`（INT32_MAX）是**常驻哨兵**：源站用它表示"没有结束时间"（夹具里 38 条）。
//   · **源站只给"卡"（id + 卡类型）的获取窗口，没有卡池名** —— 所以 banner 只能合成：
//     本解析器把"同一 (start_date, end_date) 的一批新卡"当作一个卡池窗口，
//     banner 写成「赛马娘日服卡池（卡类型…）」。
//     ⚠️ 只按 `start_date` 分组是**错的**：实测 29 个 start_date 同时挂多组不同 end_date，
//        而且常驻卡（哨兵）与有界卡会共用同一个 start_date —— 按 start 分组会把"常驻"
//        混进窗口，从而把整组误判成已过期（2026-03-11 那批就是这样）。
//
// 时区：`Asia/Tokyo`。依据（两条）：
//   ① bwiki 正文硬标注「日服卡池时间记录统一为日本时间」；
//   ② 夹具自洽：666 个**有界** end_date 全部落在 02:59:59Z（= 11:59:59 JST，一个不差），
//      且 664/704 个 start_date 落在 03:00Z（= 12:00 JST，日服卡池 12:00 更新）——
//      只有 UTC+9 才能把这些渲染成"整点 12:00 / 11:59:59"。
//
// 选池规则（本项目 JSON 源的通用约定，见 registry-b1.js 注释）：
//   覆盖当前时刻的**有界窗口**里取 startTs 最新的那批（并列取结束更早、id 更小）。
//   常驻卡（哨兵）不构成"当期窗口"；当期没有任何有界窗口 → 返回 null（未公布）。


const ns_umapyoi_DEFAULT_URL = "https://api.umapyoi.net/api/v1/gacha";
// 供注册表引用（作为「备选源」时必须与 `altSourceId(alt) = alt.url` 的字符串**完全一致**才能命中）
const ns_umapyoi_UMAPYOI_URL = ns_umapyoi_DEFAULT_URL;
const ns_umapyoi_PERMANENT_END = 2147483647;   // 源站常驻哨兵（Unix 秒 = INT32_MAX）
const ns_umapyoi_HOVER_MAX = 20;                      // hover 最多列这么多行，余下只报数量

const ns_umapyoi_toNum = (v) => {
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
const ns_umapyoi_byNewestStart = (a, b) => (b.startTs - a.startTs) || (a.endTs - b.endTs) || (a.id0 - b.id0);

// 纯函数：夹具/单测可直接喂 JSON（不联网）
function ns_umapyoi_parseUmapyoiGacha(json, now = Date.now(), tz = "Asia/Tokyo") {
	if (!Array.isArray(json)) throw new Error("umapyoi-bad-shape");
	const rows = [];
	for (const it of json) {
		if (!it || typeof it !== "object") continue;
		const s = ns_umapyoi_toNum(it.start_date);
		if (s == null) continue;
		const e = ns_umapyoi_toNum(it.end_date);
		// 常驻哨兵（或缺失结束）→ endTs 记为 null：**绝不**把 2147483647 当成真实时刻
		const permanent = e == null || e >= ns_umapyoi_PERMANENT_END;
		rows.push({
			id: it.id,
			id0: ns_umapyoi_toNum(it.id) == null ? Number.MAX_SAFE_INTEGER : ns_umapyoi_toNum(it.id),
			cardType: String(it.card_type == null ? "" : it.card_type),
			type: it.type,
			startTs: s * 1000,
			endTs: permanent ? null : e * 1000,
			permanent
		});
	}
	if (rows.length === 0) throw new Error("umapyoi-no-rows");

	// 有界窗口 = 同一 (start_date, end_date) 的一批卡（见文件头：不能只按 start_date 分组）
	const merged = new Map();
	for (const r of rows) {
		if (r.permanent) continue;
		const k = r.startTs + "|" + r.endTs;
		let p = merged.get(k);
		if (!p) { p = { startTs: r.startTs, endTs: r.endTs, id0: r.id0, items: [] }; merged.set(k, p); }
		p.items.push(r);
		if (r.id0 < p.id0) p.id0 = r.id0;
	}
	const pools = [...merged.values()].map((p) => ({
		startTs: p.startTs,
		endTs: p.endTs,
		id0: p.id0,
		items: p.items,
		ids: p.items.map((x) => x.id).filter((x) => x != null),
		cardTypes: [...new Set(p.items.map((x) => x.cardType).filter(Boolean))]
	}));

	const active = pools.filter((p) => p.startTs <= now && p.endTs >= now).sort(ns_umapyoi_byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;   // 抓到数据但当期没有有界窗口（常驻卡不算） = 未公布

	const types = cur.cardTypes.join("、");
	const banner = types ? `赛马娘日服卡池（${types}）` : "赛马娘日服卡池";
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	const lines = active.slice(0, ns_umapyoi_HOVER_MAX).map((p) => {
		const detail = `${p.cardTypes.join("、") || "卡"}×${p.items.length}`
			+ (p.ids.length ? `（id ${p.ids.join("、")}）` : "");
		return `${fmtWindow(p.startTs, p.endTs, tz)}  ${detail}`;
	});
	if (active.length > lines.length) lines.push(`…另有 ${active.length - lines.length} 个同期窗口未列出`);
	const permActive = rows.filter((r) => r.permanent && r.startTs <= now).length;
	if (permActive > 0) lines.push(`另有 ${permActive} 张常驻卡（end_date=2147483647 哨兵，无结束时间，不计入当期窗口）`);
	// 源站无卡池名 → hover 首行如实说明 banner 是合成的
	const hover = ["赛马娘日服（源站为卡级数据，无卡池名；起止＝该批新卡的获取窗口）", ...lines].join("\n");

	return {
		banner,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		bannerHover: hover
	};
}

// 抓取器：mode="direct"（实测 api.umapyoi.net 响应 ACAO=*）
async function ns_umapyoi_gachaUmapyoi(url, signal, tz = "Asia/Tokyo", now = Date.now()) {
	const data = await fetchJson(url || ns_umapyoi_DEFAULT_URL, { signal, mode: "direct" });
	return ns_umapyoi_parseUmapyoiGacha(data, now, tz);
}

		// ===== 内联自 next-sources/parsers/bestdori.js（模块级标识符已加 ns_bestdori_ 前缀）=====

// next-sources/parsers/bestdori.js —— BanG Dream!（Bestdori 社区数据库，取**简中服**时间段）
//
// 契约：async (url, signal, tz) → 卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//                              活动侧 { event, eventDates, eventDatesRaw?, eventHover? }    （两侧都可为 null = 未公布）
//
// ⚠️ 实测（2026-10-02 夹具 `b1-bestdori-gacha` / `b1-bestdori-events`）与任务给的简化形态的差别：
//   1. 两个文件都是**以 id 为 key 的对象**（不是数组）：gacha 2149 个键、events 345 个键。
//   2. 时间是 **字符串毫秒**（`"1462071600000"`），需要 Number()；缺失服区为 `null`。
//   3. 字段名实测：
//      gacha：{ resourceName, bannerAssetBundleName, gachaName[5], publishedAt[5], closedAt[5], type, newCards }
//      event：{ eventType, eventName[5], assetBundleName, startAt[5], endAt[5], … }
//      —— 任务里猜的 `eventName`/`startAt`/`publishedAt`/`closedAt` 全对，但**值是字符串**。
//
// 服区下标：0=日 1=英 2=繁中 **3=简中** 4=韩。
//   实测交叉验证（夹具里的 gacha 1「リリース記念ガチャ」五连名称）：
//     [0] リリース記念ガチャ / [1] Release Celebration Gacha / [2] 遊戲上線紀念轉蛋 / [3] 开服纪念招募 / [4] 오픈 기념 뽑기
//   → [3] 是**简体中文**，即简中服（本条目要的服区）。gacha 里带 CN 时间的有 1734 / 2149 条。
//
// 时区：UTC+8。UTC 毫秒本身就是**绝对时刻**，这里**不做任何时区换算**；
//   `tz`（Asia/Shanghai）只用于把绝对时刻渲染成源站墙钟文本（sourceWallParts/fmtWindow）。
//   交叉验证（调研文档 + 夹具）：官方 displayTime 2026-09-29 10:00 ↔ 简中服 startAt=1790647200000（=02:00Z）完全吻合。


const ns_bestdori_DEFAULT_GACHA = "https://bestdori.com/api/gacha/all.5.json";
const ns_bestdori_DEFAULT_EVENT = "https://bestdori.com/api/events/all.5.json";
const ns_bestdori_CN_INDEX = 3;                        // 简中服下标（见文件头实测）
const ns_bestdori_LONG_MS = 400 * 86400e3;             // >400 天 = 长期/常驻池（如 closedAt=2100-08-15）
const ns_bestdori_HOVER_MAX = 20;

const ns_bestdori_toTs = (v) => {
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
const ns_bestdori_byNewestStart = (a, b) => (b.startTs - a.startTs)
	|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
	|| ((Number(a.id) || 0) - (Number(b.id) || 0));

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**（≤400 天）简中池里取 startTs 最新的一期当"当期卡池"；
// 长期/常驻池（miracle/free 等，closedAt 常是 2100 哨兵）不参与选择，只在 hover 里报个数。
function ns_bestdori_parseBestdoriGacha(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-gacha-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const pools = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.publishedAt) || !Array.isArray(v.closedAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.gachaName) ? v.gachaName[ns_bestdori_CN_INDEX] : null;
		const p = ns_bestdori_toTs(v.publishedAt[ns_bestdori_CN_INDEX]);
		const c = ns_bestdori_toTs(v.closedAt[ns_bestdori_CN_INDEX]);
		if (!name || p == null || c == null || c <= p) continue;   // 该服区没出这期 → 跳过
		pools.push({ id: k, name: String(name), type: String(v.type || ""), startTs: p, endTs: c, long: c - p > ns_bestdori_LONG_MS });
	}
	if (!sawIndexed) throw new Error("bestdori-gacha-bad-shape");   // 结构变了（不再有 publishedAt/closedAt 数组）
	const active = pools.filter((x) => x.startTs <= now && x.endTs >= now);
	const bounded = active.filter((x) => !x.long).sort(ns_bestdori_byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;   // 抓到数据但没有"当期"有界窗口 = 未公布（长期池不算当期）

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 同名同期（同一期招募在多处登记）→ 合并成一行并标 ×n，hover 才不会被重复行刷屏
	const pooled = [];
	for (const p of bounded) {
		const hit = pooled.find((x) => x.name === p.name && x.startTs === p.startTs && x.endTs === p.endTs);
		if (hit) hit.n += 1; else pooled.push({ ...p, n: 1 });
	}
	const shown = pooled.slice(0, ns_bestdori_HOVER_MAX).map((p) => `${p.name}（${p.type}）${p.n > 1 ? `×${p.n}` : ""}  ${fmtWindow(p.startTs, p.endTs, tz)}`);
	if (pooled.length > shown.length) shown.push(`…另有 ${pooled.length - shown.length} 个同期卡池未列出`);
	const longN = active.length - bounded.length;
	if (longN > 0) shown.push(`另有 ${longN} 个长期/常驻卡池（结束时间是 2100 之类的哨兵值，未计入"当期"）`);

	return {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		bannerHover: shown.length >= 2 ? shown.join("\n") : ""
	};
}

// ── 活动侧 ──
function ns_bestdori_parseBestdoriEvents(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-event-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const rows = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.startAt) || !Array.isArray(v.endAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.eventName) ? v.eventName[ns_bestdori_CN_INDEX] : null;
		const s = ns_bestdori_toTs(v.startAt[ns_bestdori_CN_INDEX]);
		const e = ns_bestdori_toTs(v.endAt[ns_bestdori_CN_INDEX]);
		if (!name || s == null || e == null || e <= s) continue;
		rows.push({ id: k, name: String(name), type: String(v.eventType || ""), startTs: s, endTs: e });
	}
	if (!sawIndexed) throw new Error("bestdori-event-bad-shape");
	const active = rows.filter((x) => x.startTs <= now && x.endTs >= now).sort(ns_bestdori_byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 活动一般只有一期在期；多期时 hover 逐行列出（与插件 buildEventHover 同约定：<2 条返回 ""）
	const hover = active.length >= 2
		? active.map((x) => `${x.name}（${x.type}）  ${fmtWindow(x.startTs, x.endTs, tz)}`).join("\n")
		: "";
	return { event: cur.name, eventDates: dates, eventDatesRaw: dates, eventHover: hover };
}

// 抓取器：mode="proxy"（实测 bestdori.com 无 ACAO，必须走宿主代理）
async function ns_bestdori_gachaBestdori(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_GACHA, { signal });
	return ns_bestdori_parseBestdoriGacha(data, now, tz);
}
async function ns_bestdori_eventsBestdori(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_EVENT, { signal });
	return ns_bestdori_parseBestdoriEvents(data, now, tz);
}

		// ===== 内联自 next-sources/parsers/sekai.js（模块级标识符已加 ns_sekai_ 前缀）=====

// next-sources/parsers/sekai.js —— PJSK 缤纷舞台（sekai-master-db cn-diff，GitHub Pages 静态 JSON）
//
// 契约：async (url, signal, tz) → 卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//                              活动侧 { event, eventDates, eventDatesRaw?, eventHover? }    （两侧都可为 null = 未公布）
//
// ⚠️ 实测（2026-10-02 夹具 `b1-sekai-gachas` 59 条 / `b1-sekai-events` 198 条）与任务给的形态的差别：
//   1. `gachas.json` 的 `gachaType` 是**字符串枚举**（beginner/normal/sureturn/subeginner/ceil/sunormal），
//      不是数字；`events.json` 的 `eventType` 也是字符串（marathon/cheerful_carnival/world_bloom）。
//   2. **`events.json` 里根本没有 `endAt` 字段**（这是任务给的字段形态里最需要纠正的一处）。
//      实测字段：startAt / aggregateAt / rankingAnnounceAt / distributionStartAt / closedAt / distributionEndAt。
//      本解析器把**活动游玩期**取为 `startAt ~ aggregateAt`（aggregateAt = 活动结束、开始统计的时刻），
//      并在 `eventDatesRaw` 里如实注明这个映射；`closedAt` 是结果公布时刻，不作窗口结束。
//   3. `gachas.json` 里有大量**长期池**：endAt 是 2099 哨兵（如 id 579「任务招募」2025-01-01 ~ 2099-12-30）。
//      它们不参与"当期"选择（见下），只在 hover 里报个数。
//
// 时区：UTC+8（`Asia/Shanghai`）。epoch 毫秒 = 绝对时刻，**不做时区换算**，`tz` 只用于渲染墙钟文本。
//   依据（夹具自洽，把"推测"变成了可验证的三条）：
//   ① 生日池 836「[桐谷遥]HAPPY BIRTHDAY 2026招募」startAt=1790784000000 → UTC+8 渲染正好是 2026-10-01 00:00
//      （桐谷遥生日当天 00:00；UTC+9 会渲染成 01:00，不成立）；
//   ② 月卡池 802「缤纷月卡招募」startAt=1788145200000 → UTC+8 是 2026-09-01 04:00（每月 1 日 04:00 换月卡）；
//   ③ 常规卡池轮换时刻 825/826… 都落在 UTC+8 的 12:00。
//
// ✅ 服区**已确认 = 国服（简体中文）**（2026-10-03 复核，推翻此前"存疑"的判断）：
//   · 仓库 description = "Project Sekai (Simplified Chinese) Master DB Difference"、
//     README = "Sekai Master Data Diff for CN server"（GitHub 原文）
//   · 同库 events / cards / cardEpisodes / characterProfiles **全为简体**
//     （`雨过天晴的启明星` / `卡牌剧情（上篇）` / `宫益坂女子学园`），
//     对照 `tc-diff` 同结构全繁体（`雨後的第一顆星` / `支線劇情（前篇）` / `宮益坂女子學園`）
//   · 官网 pjsk.nvsgames.cn 页脚 published by Nuverse；国服公测 2025-03-27
//
// ⚠️ 但两处**数据质量**问题必须知道（它们不是"区服标错"，是上游回填残留）：
//   ① `events.json` 首条 id=1「雨过天晴的启明星」startAt=1633762800000 = 2021-10-09 15:00(UTC+8)，
//      **早于国服公测**（2025-03-27）→ 该时间线是上游对齐/回填的产物，
//      拿它当"国服活动排期"会**失真**。
//   ② 部分条目名是繁体（59 条卡池里 18 条，如 gacha 16「新手應援起跑衝刺招募」）→
//      国服客户端为「世界」的回响回填 2020–2024 历史时**沿用了繁中串**（CN/TW 共用 Nuverse 6.4.0
//      结构）；2024-05 之后的记录全部是简体。
//      **不做机械繁转简**：两岸官方译法本就不同（`[新手应援]必定获得1名★4成员10连招募券招募`
//      vs 繁中服 `[新手應援]必中1名★4成員10連票券招募`），机械转换会产出第三种、非官方的字符串。


const ns_sekai_DEFAULT_GACHA = "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json";
const ns_sekai_DEFAULT_EVENT = "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json";
// 长期/常驻池阈值：**对齐本体** `EVENT_MAX_WINDOW_DAYS = 120`（本体对"长期/常驻玩法"的定义）。
// 旧值 400 天只够挡住 2099 哨兵值，会放过 365 天的**永久**池 ——
// 实测 `新手限定★4自选阶梯招募`（03-26 16:00 ~ 次年 03-26 15:59，整 365 天）就是这样漏进"当期招募"的
// （用户 2026-10-03 要求「规则和原来一致」）。限时招募最长约 1 个月，120 天阈值不会误伤。
const ns_sekai_LONG_MS = 120 * 86400e3;

const ns_sekai_toTs = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ns_sekai_byNewestStart = (a, b) => (b.startTs - a.startTs)
	|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
	|| ((a.id || 0) - (b.id || 0));

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**池里取 startTs 最新的一期当"当期招募"；长期池（2099 哨兵等）不参与"当期"，
// 也不进悬停（它们恒在架，列出来是噪音）。
function ns_sekai_parseSekaiGachas(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-gacha-bad-shape");
	const pools = [];
	for (const g of json) {
		if (!g || typeof g !== "object") continue;
		const s = ns_sekai_toTs(g.startAt), e = ns_sekai_toTs(g.endAt);
		const name = typeof g.name === "string" ? g.name.trim() : "";
		if (!name || s == null || e == null || e <= s) continue;
		pools.push({ id: g.id, name, type: String(g.gachaType || ""), startTs: s, endTs: e, long: e - s > ns_sekai_LONG_MS });
	}
	if (pools.length === 0) throw new Error("sekai-gacha-bad-shape");
	const active = pools.filter((x) => x.startTs <= now && x.endTs >= now);
	const bounded = active.filter((x) => !x.long).sort(ns_sekai_byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 悬停 = 全部当期**有界**池（长期池不参与"当期"，见上）。每池一行池名 + 档期，窗口完全相同则
	// 档期只在末尾写一遍 —— 排版交给共用工具 hoverPool（与本体 buildPoolHover 逐字一致）。
	// 源站没有角色名 → name 就用池名本身（对应本体的「池名：角色」里的池名位置）。
	// 池名里的「（ceil）」等后缀来自 `gachaType` 枚举，**不是源站原文** → 不进悬停；
	// 同名同窗的阶梯/高级礼物招募多条各自成行（源站如此，不再合并成 ×n）。
	const hover = hoverPool(bounded.map((p) => ({ name: p.name, startTs: p.startTs, endTs: p.endTs })), tz);
	// 只有 1 个当期池 → hover 为 ""，**不设 bannerHover**，由 UI 走默认两行式「banner ⏎ bannerDates」
	return {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}

// ── 活动侧 ──
// 活动窗口 = startAt ~ aggregateAt（**源站无 endAt**，见文件头 ②；aggregateAt 缺失时退回 closedAt）
function ns_sekai_parseSekaiEvents(json, now = Date.now(), tz = "Asia/Shanghai") {
	if (!Array.isArray(json)) throw new Error("sekai-event-bad-shape");
	const rows = [];
	for (const e of json) {
		if (!e || typeof e !== "object") continue;
		const s = ns_sekai_toTs(e.startAt);
		const agg = ns_sekai_toTs(e.aggregateAt);
		const end = agg != null ? agg : ns_sekai_toTs(e.closedAt);   // 源站无 endAt：优先 aggregateAt
		const name = typeof e.name === "string" ? e.name.trim() : "";
		if (!name || s == null || end == null || end <= s) continue;
		rows.push({ id: e.id, name, type: String(e.eventType || ""), startTs: s, endTs: end, closedAt: ns_sekai_toTs(e.closedAt) });
	}
	if (rows.length === 0) throw new Error("sekai-event-bad-shape");
	const active = rows.filter((x) => x.startTs <= now && x.endTs >= now).sort(ns_sekai_byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// ⚠️ 降级逻辑（保留）：源站 `events.json` **没有** `endAt` 字段，活动游玩期取 `startAt ~ aggregateAt`
	//    （aggregateAt = 活动结束、开始统计的时刻）；aggregateAt 缺失时退回 `closedAt`。
	//    这句说明是**实现细节**，只留在代码注释里，**不进悬停**。
	// `eventDatesRaw`：既有约定是"保留源站原文"，这里如实记录上面那次映射（本体也有条目这么做）。
	// `eventDatesRaw` 就写格式化档期本身：UI 的默认两行式会直接显示它
	// （`eventDatesRaw || eventDates`），所以**不能**在这儿夹带说明文字
	// —— 用户 2026-10-03 明确要求「元信息彻底删掉」。实测旧版把说明拼进来后，
	//    面板上出现了 `09-30 15:00 ~ 10-09 20:59（源站无 endAt：结束取 aggregateAt；…）` 这种尾巴。
	const raw = dates;
	// 悬停 = 全部当期活动，结束时间升序逐行「名称 + 3 空格 + 档期」（档期由共用工具 fmtWindow 格式化，
	// 与本体 buildEventHover 逐字一致）。**不排序**由工具负责 → 这里先排好序再传。
	// 只有 1 条 → 工具返回 ""，不设 eventHover，由 UI 走默认两行式「event ⏎ eventDates」。
	const ordered = active.slice().sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
	const hover = hoverEvent(ordered.map((x) => ({ name: x.name, startTs: x.startTs, endTs: x.endTs })), tz);
	return {
		event: cur.name,
		eventDates: dates,
		eventDatesRaw: raw,
		...(hover ? { eventHover: hover } : {})
	};
}

// 抓取器：mode="direct"（实测 sekai-world.github.io = GitHub Pages 静态资源，带 ACAO）
async function ns_sekai_gachaSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_GACHA, { signal, mode: "direct" });
	return ns_sekai_parseSekaiGachas(data, now, tz);
}
async function ns_sekai_eventsSekai(url, signal, tz = "Asia/Shanghai", now = Date.now()) {
	const data = await fetchJson(url || ns_sekai_DEFAULT_EVENT, { signal, mode: "direct" });
	return ns_sekai_parseSekaiEvents(data, now, tz);
}

		// ===== 内联自 next-sources/parsers/gf2.js（模块级标识符已加 ns_gf2_ 前缀）=====

// next-sources/parsers/gf2.js —— 少女前线2：追放 国服（sunborngame 官方 API）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ── 实测形态（2026-10-01/02 抓夹具，见 fixtures/gf2-*）────────────────────────
// 列表 API：GET /website/news_list/{typeId}?page=1&limit=10
//   → { code:0, msg:"", data:{ limit, page, total, list:[{Id,Type,Title,Date,Content,Marks,Site,GlobalTop}] } }
//   ⚠️ **列表里的 `Content` 恒为空字符串**（实测 4 个夹具都是 ""）：正文只在详情 API 里。
//      所以卡池/活动的「活动时间」必须再抓一次 /website/news/{Id}。
//      任务书里说的「Content 是 HTML 富文本」指的是**详情**响应，列表响应不是。
// 详情 API：GET /website/news/{Id} → { code:0, data:{ Id, Type, Title, Date, Content:"<p>…<br>…", … } }
//
// ── typeId 实测语义（与任务书的「简化版形态」有出入，以实测为准）──────────────
//   · typeId=1：资讯（艾莫远航 / 邮件赠礼 / 外观情报），1163 条。不是排期。
//   · typeId=2/5/6/7/8：**全为空**（total=0）。
//   · typeId=3：官方公告（版本更新公告 / 临时维护公告 / 封禁公告），83 条。**里面没有活动。**
//   · typeId=4：**活动与卡池混排**，536 条。同页既有【静默突触】【迭代回廊】这类主题活动，
//     也有「…限时概率UP活动现已开启！」「【新装采购·睡醒的人鱼】」「【重逢采购】」这类卡池公告。
//   ⇒ **两侧都读 typeId=4**，靠标题互补过滤分流：
//        命中 概率UP/采购/军备提升 → 卡池；其余 → 活动。
//     （GF2 的卡池就叫「采购」，装备池叫「军备提升」。）
//   ⚠️ 2026-10-03 修：活动侧原先读 typeId=3 并外显版本更新公告的**维护窗口**
//      （面板上出现「9月22日版本更新公告 · 09-22 09:00~12:00」= 停机维护 3 小时），
//      已改为读 typeId=4。详见 ns_gf2_eventsGf2 处的注释。
//
// ── `Date` 字段的真正含义（实测的交叉验证，非猜测）──────────────────────────
//   · 9/22 版本更新公告：Date="2026-09-21 18:31:03"（公告发布时刻），
//     正文「维护时间：2026年9月22日09:00~12:00」。
//   · 卡池公告 2128「代理人、莉塔拉、科谢尼娅限时概率UP活动现已开启！」：
//     Date="2026-09-22 12:00:00" = **当日维护结束 12:00**；正文「活动时间：
//     2026年9月22日 版本更新后~2026年10月13日 08:59」。
//   · 另一条【迭代回廊】Date="2026-10-01 05:00:00" —— 正是国服每日 05:00 刷新点。
//   ⇒ `Date` = **该条公告的生效时刻**，而正文里的「版本更新后」= 维护结束 = `Date` 的时刻部分。
//     所以「版本更新后」这类**起点不明确的窗口**用 `Date` 的时刻补齐（源站自身给出的值），
//     不去猜「凌晨4点」之类的惯例。日期不同日则视为无法解析、跳过该窗口（宁缺勿造）。
//
// ── 时区 UTC+8（Asia/Shanghai）**推定** ─────────────────────────────────────
//   源站正文未硬标注时区。推定依据：① API 的 Date 全部是北京时间口径（发布 18:31、
//   维护 09:00~12:00）；② 每日刷新点 05:00 是国服惯例；③ 同一条公告里的维护窗口与
//   卡池窗口同源同口径。属**推定**，报告里已注明（非硬证据）。


const ns_gf2_GF2_BASE = "https://gf2-web-preregister-api.sunborngame.com";
const ns_gf2_GF2_HOME = "https://gf2.sunborngame.com/";
const ns_gf2_GF2_TZ = "Asia/Shanghai";
// 注册表用的两个入口。
// ⚠️ 两侧**同一个 typeId=4**（活动与卡池混排），用互补过滤分流：
//    命中 ns_gf2_GF2_POOL_RE → 卡池；其余 → 活动。
//    曾经的 eventUrl 是 typeId=3（官方公告），那里面**只有版本更新/维护/封禁**，
//    导致活动侧外显成「9月22日版本更新公告 · 09-22 09:00~12:00」= 停机维护窗口（已修）。
const ns_gf2_GF2_GACHA_URL = `${ns_gf2_GF2_BASE}/website/news_list/4?page=1&limit=10`;
const ns_gf2_GF2_EVENT_URL = `${ns_gf2_GF2_BASE}/website/news_list/4?page=1&limit=10`;

// 依次试候选：单条失败（网络/404）不整体崩，留给下一条；**全部失败则抛出第一个错误**
// —— 不能把"源站挂了"静默降级成"未公布"（那会让上层以为当期真的没内容）。
async function ns_gf2_firstWorking(candidates, work) {
	let firstErr = null;
	for (const c of candidates) {
		try {
			const r = await work(c);
			if (r) return r;
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (firstErr) throw firstErr;
	return null;
}

// 卡池类公告的标题特征（实测：采购 = 角色池，军备提升 = 装备池）
const ns_gf2_GF2_POOL_RE = /概率UP|采购|军备提升/;

// ── 列表解析 ──
// 容错：形状不对 → 抛错（= 该侧抓取失败）；list 为空数组 → 返回 []（= 当期无内容）
function ns_gf2_parseGf2List(json, tz = ns_gf2_GF2_TZ) {
	if (!json || typeof json !== "object") throw new Error("gf2-bad-json");
	if (json.code !== 0) throw new Error("gf2-code-" + json.code);
	const data = json.data;
	if (!data || !Array.isArray(data.list)) throw new Error("gf2-bad-json");
	return data.list
		.filter((x) => x && typeof x.Id === "number" && typeof x.Title === "string")
		.map((x) => ({
			id: x.Id,
			type: x.Type,
			title: x.Title,
			date: typeof x.Date === "string" ? x.Date : "",
			dateTs: ns_gf2_parseGf2Date(x.Date, tz)
		}));
}

// "2026-09-22 12:00:00" → 绝对毫秒（按 tz 解释源站墙钟）。解析不出 → null
function ns_gf2_parseGf2Date(s, tz = ns_gf2_GF2_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

function ns_gf2_gf2DetailUrl(id) { return `${ns_gf2_GF2_BASE}/website/news/${id}`; }

// ── 正文窗口解析 ──
// 令牌化：日期(必带年) / 时刻 / 「版本更新后」类短语 / 区间分隔符
// 为什么用令牌而不用一条大正则：GF2 的窗口有 3 种写法混排——
//   `2026年9月22日09:00~12:00`（同日，末段只有时刻）
//   `2026年9月22日 版本更新后~2026年11月3日 08:59`（起点是短语）
//   `2026年9月22日 版本更新后~2026年10月13日 08:59`
// 令牌走法可以把「起点未知」和「末段缺日期」分别处理，比分组的可选组好读也好测。
const ns_gf2_GF2_TOKEN = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?|(版本更新完成后|版本更新后|更新维护后|维护完成后|维护后|更新后)|([~～\-—－至])/g;

// 「维护后」类短语 → 用 dateHint（= 该条公告的 `Date`）的时刻补起点；
// 只有 hint 的**日历日**与窗口起点日一致时才敢用（否则宁可不解析这个窗口）
function ns_gf2_resolvePhrase(phrase, dateHint, tz, y, mo, d) {
	if (!phrase || !dateHint) return null;
	const hintParts = sourceWallParts(dateHint, tz);
	if (!hintParts) return null;
	if (hintParts.y !== y || hintParts.mo !== mo || hintParts.d !== d) return null;
	return { h: hintParts.h, mi: hintParts.mi };
}

// 从正文纯文本抽窗口。返回 [{ label, startTs, endTs, raw, openStart }]
//   · 只认**同一行内**的窗口（textOf 已把 <br> 变成 \n）——实测 GF2 的窗口都不跨行
//   · 单日期（如「补偿有效期：2026年9月28日23:59:59」）不构成窗口 → 不产出（不硬凑区间）
function ns_gf2_parseGf2Windows(text, tz = ns_gf2_GF2_TZ, dateHint = null) {
	const out = [];
	const lines = String(text == null ? "" : text).split("\n");
	let lastHeader = "";
	for (const lineRaw of lines) {
		const line = String(lineRaw);
		if (!line.trim()) continue;
		const toks = [];
		ns_gf2_GF2_TOKEN.lastIndex = 0;
		let m;
		while ((m = ns_gf2_GF2_TOKEN.exec(line)) !== null) {
			toks.push({
				date: m[1] ? { y: +m[1], mo: +m[2], d: +m[3] } : null,
				time: m[4] != null ? { h: +m[4], mi: +m[5], s: m[6] != null ? +m[6] : 0 } : null,
				phrase: m[7] || null,
				sep: m[8] || null,
				at: m.index,
				end: m.index + m[0].length
			});
			if (m[0] === "") ns_gf2_GF2_TOKEN.lastIndex++;   // 保险：零宽匹配不吞死循环
		}
		let i = 0;
		while (i < toks.length) {
			const t0 = toks[i];
			if (!t0.date) { i++; continue; }
			let j = i + 1;
			let startTime = null, startPhrase = null;
			if (toks[j] && toks[j].time) { startTime = toks[j].time; j++; }
			else if (toks[j] && toks[j].phrase) { startPhrase = toks[j].phrase; j++; }
			if (!(toks[j] && toks[j].sep)) { i++; continue; }
			j++;
			let endDate = null, endTime = null, endPhrase = null;
			if (toks[j] && toks[j].date) { endDate = toks[j].date; j++; }
			if (toks[j] && toks[j].time) { endTime = toks[j].time; j++; }
			else if (toks[j] && toks[j].phrase) { endPhrase = toks[j].phrase; j++; }
			if (!endDate && !endTime && !endPhrase) { i++; continue; }

			const y1 = t0.date.y, mo1 = t0.date.mo, d1 = t0.date.d;
			// 末段没写日期（同日窗口，如 `09:00~12:00`）→ 日期同起点。
			// 注意：GF2 的日期令牌**必带年**（没有「9月22日」这种裸写法），所以 endDate 一定有 y。
			const eD = endDate || { y: y1, mo: mo1, d: d1 };
			const y2 = eD.y, mo2 = eD.mo, d2 = eD.d;

			// 起点时分
			let h1 = 0, mi1 = 0;
			if (startTime) { h1 = startTime.h; mi1 = startTime.mi; }
			else if (startPhrase) {
				const r = ns_gf2_resolvePhrase(startPhrase, dateHint, tz, y1, mo1, d1);
				if (!r) { i++; continue; }          // 短语无法定日 → 跳过，不猜
				h1 = r.h; mi1 = r.mi;
			}
			// 终点时分
			let h2 = 23, mi2 = 59;
			if (endTime) { h2 = endTime.h; mi2 = endTime.mi; }
			else if (endPhrase) {
				const r = ns_gf2_resolvePhrase(endPhrase, dateHint, tz, y2, mo2, d2);
				if (!r) { i++; continue; }
				h2 = r.h; mi2 = r.mi;
			}

			const startTs = sourceInstant(y1, mo1, d1, h1, mi1, tz);
			const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
			if (!(endTs > startTs)) { i++; continue; }
			const pre = line.slice(0, t0.at);
			let label = pre.replace(/[\s\u00a0]+/g, "").replace(/[:：]+$/, "");
			// 行内标签过长（说明这行是正文句子而非「XX时间：」标签）→ 不用它
			if (label.length > 12) label = "";
			if (!label) label = lastHeader;
			out.push({
				label,
				startTs,
				endTs,
				raw: line.slice(t0.at, toks[j - 1].end).trim(),
				openStart: !!startPhrase
			});
			i++;
		}
		// 记忆「上一行是短标签行」（如单独一行的 `活动时间：`）→ 供下一行的窗口当 label。
		// 只认以「时间/日程/期间/期限/范围」结尾且不含数字的短行，避免把 `尊敬的指挥官：`
		// 这种称呼行当成标签（实测踩到：2142 的维护窗口被标成"尊敬的指挥官"）。
		const cleaned = line.replace(/[\s\u00a0★☆※]+/g, "");
		if (cleaned && /[:：]$/.test(cleaned) && cleaned.length <= 12) {
			const cand = cleaned.replace(/[:：]+$/, "");
			if (!/\d/.test(cand) && /(时间|日程|期间|期限|范围)$/.test(cand)) lastHeader = cand;
		}
	}
	return out;
}

// 卡池公告正文里的 UP 对象（人形）→ roles
function ns_gf2_parseGf2Roles(contentHtml) {
	const t = textOf(contentHtml);
	const a = t.indexOf("本期概率UP对象");
	const b = t.indexOf("访问说明");
	const scope = a >= 0 ? t.slice(a, b > a ? b : undefined) : t;
	const names = [];
	for (const m of scope.matchAll(/■\s*(?:精英|标准|旧式)?人形[「【]([^」】]{1,20})[」】]/g)) {
		const n = m[1].trim();
		if (n && !names.includes(n)) names.push(n);
	}
	return names.join("、");
}

function ns_gf2_cleanTitle(t) {
	return String(t == null ? "" : t).replace(/\s+/g, " ").trim();
}

// 活动名（悬停行首用）：标题去掉「现已开启/限时开启/正式开启」这类**通用开启语**，其余原样保留。
//   `【静默突触】现已开启` → `【静默突触】`
// 为什么要去：一行里若写成「【静默突触】现已开启·玩法开启时间」，「开启」重复两次很难读。
// 去不掉（标题本身就是完整名称）时回退原标题，绝不返回空串。
// ⚠️ 副词组必须**含「现」**（实测夹具标题就是「现已开启」），且动词组必须**必需**：
//    若写成 `(?:已|限时)?(?:开启|上线|开放)?$`，因为整组可空，引擎会退化成只吃掉末尾的「开」，
//    把「现已开启」削成「现」（实测踩到）。
const ns_gf2_GF2_OPEN_SUFFIX = /[!！。.\s]*((?:现已|现已正式|正式|限时|即将|已)?(?:开启|上线|开放))[!！。.\s]*$/;
function ns_gf2_gf2EventName(title) {
	const s = ns_gf2_cleanTitle(title).replace(ns_gf2_GF2_OPEN_SUFFIX, "").trim();
	return s || ns_gf2_cleanTitle(title);
}

// 一个「活动名 + 该窗口的区分名（源站标签，如「玩法开启时间」/「奖励兑换时间」）」。
// 同一条公告里多个**不同名**的时间窗（玩法开启 / 奖励兑换）必须能互相区分，
// 且**行首必须可读名称而不是纯档期**（用户 2026-10-03 反馈的偏差②，少前2 最严重：
// 旧悬停里根本没有活动名，只有 `09-22 12:00 ~ 11-03 08:59   玩法开启时间`）。
// 拿不到标签的行退化为「活动名」+ 该行 raw 原文（由 hoverEvent 处理，不硬造标签）。
function ns_gf2_gf2WindowName(baseName, w) {
	const label = String((w && w.label) || "").trim();
	return label ? `${baseName}·${label}` : baseName;
}

// 选当期窗口：优先「覆盖 now」的（越快结束越该被盯住，与插件 selectCurrent 同口径），
// 其次未来最近要开的，最后退化为结束最晚的。
function ns_gf2_selectGf2Window(wins, now) {
	const list = Array.isArray(wins) ? wins : [];
	if (!list.length) return null;
	const covering = list.filter((w) => w.startTs <= now && w.endTs >= now);
	if (covering.length) return covering.slice().sort((a, b) => a.endTs - b.endTs)[0];
	const future = list.filter((w) => w.startTs > now).sort((a, b) => a.startTs - b.startTs);
	if (future.length) return future[0];
	return list.slice().sort((a, b) => b.endTs - a.endTs)[0];
}

// ── 卡池侧 ──
// 取 typeId=4 列表 → 过滤卡池类公告（概率UP/采购/军备提升）→ 详情 → 抽窗口。
// 逐条最多试 3 条（一般第 1 条就命中），避免为了容错把请求数放大。
async function ns_gf2_gachaGf2(url, signal, tz = ns_gf2_GF2_TZ) {
	const listUrl = url || ns_gf2_GF2_GACHA_URL;
	const list = ns_gf2_parseGf2List(await fetchJson(listUrl, { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" }), tz);
	if (!list.length) return null;
	const pools = list.filter((x) => ns_gf2_GF2_POOL_RE.test(x.title));
	const ordered = (pools.length ? pools : list).slice().sort((a, b) => b.id - a.id);
	const now = Date.now();
	return ns_gf2_firstWorking(ordered.slice(0, 3), async (it) => {
		const detail = await fetchJson(ns_gf2_gf2DetailUrl(it.id), { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" });
		const d = detail && detail.data;
		if (!d) return null;
		const hint = ns_gf2_parseGf2Date(d.Date || it.date, tz);
		const wins = ns_gf2_parseGf2Windows(textOf(d.Content || ""), tz, hint);
		const w = ns_gf2_selectGf2Window(wins, now);
		if (!w) return null;
		return {
			banner: ns_gf2_cleanTitle(it.title),
			roles: ns_gf2_parseGf2Roles(d.Content || ""),
			bannerDates: fmtWindow(w.startTs, w.endTs, tz),
			bannerDatesRaw: w.raw,
			startTs: w.startTs,
			endTs: w.endTs
		};
	});
}

// ── 活动侧 ──
// ⚠️ 2026-10-03 修的真实 bug：原实现读 **typeId=3（官方公告栏目）**，取最新「版本更新公告」，
//   外显其**维护窗口** —— 面板上就出现了
//       「9月22日版本更新公告」  09-22 09:00 ~ 09-22 12:00
//   这是**停机维护的 3 小时**，跟"当前活动"毫无关系（用户反馈"少前2 活动有问题"）。
//   实测确认：typeId=3 里只有版本更新/临时维护/封禁公告，**没有活动**；
//   `typeId=2/5/6/7/8` 全为空，`typeId=1` 是资讯（艾莫远航）；**活动与卡池同在 typeId=4**。
//   例（typeId=4 实测）：
//     【静默突触】现已开启            玩法开启时间：2026年9月22日 版本更新后~2026年11月3日 08:59
//     代理人、莉塔拉、科谢尼娅限时概率UP活动现已开启！  活动时间：…~2026年10月13日 08:59
//   修法：活动侧与卡池侧**读同一个 typeId=4**，用**互补过滤**分流 ——
//     命中 ns_gf2_GF2_POOL_RE（概率UP/采购/军备提升）→ 卡池；其余 → 活动。
async function ns_gf2_eventsGf2(url, signal, tz = ns_gf2_GF2_TZ) {
	const listUrl = url || ns_gf2_GF2_EVENT_URL;
	const list = ns_gf2_parseGf2List(await fetchJson(listUrl, { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" }), tz);
	if (!list.length) return null;
	// 排除法：typeId=4 排掉卡池，剩下的就是活动
	const acts = list.filter((x) => !ns_gf2_GF2_POOL_RE.test(x.title));
	const ordered = (acts.length ? acts : list).slice().sort((a, b) => b.id - a.id);
	const now = Date.now();
	// 逐条试，取**第一条能解出覆盖当前时刻窗口**的活动（列表按 Id 倒序 = 最新在前；
	// 版本大活动如【静默突触】排在最前，与官方"头条"一致）
	return ns_gf2_firstWorking(ordered.slice(0, 4), async (it) => {
		const detail = await fetchJson(ns_gf2_gf2DetailUrl(it.id), { referer: ns_gf2_GF2_HOME, signal, mode: "proxy" });
		const d = detail && detail.data;
		if (!d) return null;
		const hint = ns_gf2_parseGf2Date(d.Date || it.date, tz);
		const wins = ns_gf2_parseGf2Windows(textOf(d.Content || ""), tz, hint);
		const w = ns_gf2_selectGf2Window(wins, now);
		if (!w) return null;
		// 悬停：只把**覆盖当前时刻**的窗口当作"当期"，其余（未来/已过）不列进 hover，避免误导。
		// 格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`。
		// 名称 = 活动名 + 该窗口的源站标签（「玩法开启时间」/「奖励兑换时间」），这样一条公告里的
		// 多个不同名窗口既**行首可读**（不再是纯档期打头），又能互相区分。
		// 只有 1 条窗口 → hoverEvent 返回 "" → 不设 eventHover，由 UI 走默认两行式。
		const baseName = ns_gf2_gf2EventName(it.title);
		const active = wins
			.filter((x) => x.startTs <= now && x.endTs >= now)
			.sort((a, b) => a.endTs - b.endTs);
		const eventHover = hoverEvent(active.map((x) => ({
			name: ns_gf2_gf2WindowName(baseName, x),
			startTs: x.startTs,
			endTs: x.endTs,
			raw: x.raw
		})), tz);
		return {
			event: ns_gf2_cleanTitle(it.title),
			eventDates: fmtWindow(w.startTs, w.endTs, tz),
			eventDatesRaw: w.raw,
			...(eventHover ? { eventHover } : {})
		};
	});
}

		// ===== 内联自 next-sources/parsers/bandori.js（模块级标识符已加 ns_bandori_ 前缀）=====

// next-sources/parsers/bandori.js —— BanG Dream! 少女乐团派对 国服（biligame 官方公告 API）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ── 实测形态（2026-10-01/02 抓夹具，见 fixtures/bandori-list、bandori-detail-18418）──
// 列表：GET https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20
//   → { code:0, totalNum:2815, data:[{ id, title, ctime, mtime, content, displayTime?, typeId, … }] }
//   ⚠️ 两个实测坑（任务书已提示，夹具再次证实）：
//     ① 列表里的 `content` 是**截断的**（末尾 `…`）→ 正文必须抓详情 /news/{id}
//     ② **返回顺序非严格倒序**：page 1 的头两条是 2019 年的常驻置顶公告
//        （概率公示 / 公平运营声明），后面才是 2026 年的倒序块
//        → 必须按 `displayTime || ctime` 自行排序，不能信数组顺序
// 详情：GET https://api.biligame.com/news/{id}
//   → { request_id, code:0, data:{ id, title, content(完整 HTML), displayTime, mtime, typeName, … } }
//
// ── 公告正文的实际结构（两侧都从这里抽）──────────────────────────────────
// 一期公告用 `活动一、`…`活动八、` 分节，每节形如：
//     活动二、「黄金周纪念·前篇Dream＆KIRAMEKI Festival招募」开启！
//     ★招募日程★
//     9月29日维护后~10月11日12:59
//     …
//     ※可招募时间：9月29日维护后~10月16日12:59      ← 节内补充窗口（挂到 hover）
// 所以：
//   · 卡池侧 = 名字含「招募」且**非**免费/确定/StepUp 类的那一节（活动二）→ 主窗口 + ★5 名单当 roles
//   · 活动侧 = 名字不含「招募」的那一节（活动一「…」挑战演出活动）→ 主窗口
//   · 每一节的**主窗口**只取 `★…日程★`/`★…时间★` 之后的第一条窗口行（节内补充窗口不算主窗口）
//     —— 否则同节多条窗口会让「选当期」随系统时间漂移，测试也不可复现。
//   · `维护后`（起点无具体时刻）用该公告 `displayTime` 的时刻补齐（实测 18418：
//     displayTime=2026-09-29 10:00:00，正文「9月29日维护后」= 10:00，与 Bestdori CN startAt 吻合）。
//
// ── 时区 UTC+8（Asia/Shanghai）**已交叉验证** ─────────────────────────────
//   任务书给的交叉证据：官方 displayTime=2026-09-29 10:00 ↔ Bestdori CN startAt=2026-09-29 02:00Z
//   （= 10:00+08）。本条是硬证据，非推测。


const ns_bandori_BANDORI_LIST_URL = "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20";
const ns_bandori_BANDORI_TZ = "Asia/Shanghai";
const ns_bandori_BANDORI_HOME = "https://www.biligame.com/detail/?id=138";

// lib/env.js 的 decodeEntities 只覆盖了少量实体，公告正文里高频出现的
// `&middot;` / `&times;` / `&hellip;` / `&sup2;` 需要本地补齐（不改 lib/）。
const ns_bandori_ENT_EXTRA = {
	middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–",
	lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
	sup2: "²", sup3: "³", deg: "°", ensp: " ", emsp: " ", thinsp: " ",
	bull: "•", copy: "©", reg: "®", trade: "™", laquo: "«", raquo: "»"
};
function ns_bandori_decodeExtra(s) {
	return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
		const v = ns_bandori_ENT_EXTRA[String(k).toLowerCase()];
		return v != null ? v : m;
	}));
}
// 公告 HTML → 纯文本（先补实体再走 textOf，保证 &middot; 这类不残留）
function ns_bandori_plain(html) { return ns_bandori_decodeExtra(textOf(html)); }
// 标题（WP/REST 的 title 可能是对象；这里统一取字符串）
function ns_bandori_bandoriTitle(x) {
	const t = x && x.title;
	if (t && typeof t === "object") return ns_bandori_decodeExtra(t.rendered || "");
	return ns_bandori_decodeExtra(t || "");
}

// ── 列表解析 ──
function ns_bandori_parseBandoriList(json) {
	if (!json || typeof json !== "object") throw new Error("bandori-bad-json");
	if (json.code !== 0) throw new Error("bandori-code-" + json.code);
	if (!Array.isArray(json.data)) throw new Error("bandori-bad-json");
	return json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => ({
			id: x.id,
			title: ns_bandori_bandoriTitle(x),
			displayTime: x.displayTime || "",
			ctime: x.ctime || "",
			mtime: x.mtime || "",
			// 排序用的"生效时刻"：优先 displayTime（= 维护后开服时刻），退 ctime
			sortKey: String(x.displayTime || x.ctime || ""),
			dateTs: ns_bandori_parseBandoriDate(x.displayTime || x.ctime)
		}))
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));   // 严格倒序
}

// "2026-09-29 10:00:00" → 绝对毫秒（按 tz 解释源站墙钟）
function ns_bandori_parseBandoriDate(s, tz = ns_bandori_BANDORI_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

function ns_bandori_bandoriDetailUrl(listUrl, id) {
	let origin = "https://api.biligame.com";
	try { origin = new URL(listUrl || ns_bandori_BANDORI_LIST_URL).origin; } catch { /* keep default */ }
	return `${origin}/news/${id}`;
}

// ── 窗口行 ──
// 整行匹配（前后不允许有别的文字）——实测这样刚好滤掉正文里大量
// 「9月29日维护后，《MATSURI BAYASHI》将上架…」这类**带尾巴**的日期句，
// 以及「本期也将开启限时招募券任务（9月29日 维护后～10月14日 22:59）！」这类括注。
const ns_bandori_WIN_LINE = /^[※☆★\s]*((?:20\d{2}年)?\d{1,2}月\d{1,2}日\s*(?:更新维护后|维护后|\d{1,2}:\d{2})?)\s*[~～]\s*((?:(?:20\d{2}年)?\d{1,2}月\d{1,2}日\s*)?(?:更新维护后|维护后|\d{1,2}:\d{2}))\s*[！!。]?\s*$/;
const ns_bandori_HALF = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(更新维护后|维护后)?(?:\s*(\d{1,2}):(\d{2}))?$/;

// 单侧（起点或终点）→ { mo, d, phrase, h, mi }；解析不出 → null
function ns_bandori_parseHalf(s) {
	const m = ns_bandori_HALF.exec(String(s || "").trim());
	if (!m) return null;
	return {
		y: m[1] ? +m[1] : null,
		mo: +m[2], d: +m[3],
		phrase: m[4] || null,
		h: m[5] != null ? +m[5] : null,
		mi: m[6] != null ? +m[6] : null
	};
}

// 一条窗口行 → { startTs, endTs, raw }；短语起点用 hint（公告 displayTime）补时刻
function ns_bandori_parseBandoriWindow(line, tz = ns_bandori_BANDORI_TZ, hint = null) {
	const m = ns_bandori_WIN_LINE.exec(String(line || "").trim());
	if (!m) return null;
	const a = ns_bandori_parseHalf(m[1]), b = ns_bandori_parseHalf(m[2]);
	if (!a || !b) return null;
	// 年份：源站只写「9月29日」→ 取公告年份（hint）；跨年时末段 +1
	const hintParts = hint != null ? sourceWallParts(hint, tz) : null;
	const y1 = a.y != null ? a.y : (hintParts ? hintParts.y : null);
	if (y1 == null) return null;
	let y2 = b.y != null ? b.y : y1;
	if (b.y == null && (b.mo < a.mo || (b.mo === a.mo && b.d < a.d))) y2 = y1 + 1;

	let h1 = a.h, mi1 = a.mi;
	if (h1 == null) {
		if (!a.phrase || !hintParts) return null;           // 起点不明又不给 hint → 不猜
		h1 = hintParts.h; mi1 = hintParts.mi;
	}
	if (mi1 == null) mi1 = 0;
	let h2 = b.h, mi2 = b.mi;
	if (h2 == null) {
		if (!b.phrase || !hintParts) return null;
		h2 = hintParts.h; mi2 = hintParts.mi;
	}
	if (mi2 == null) mi2 = 0;

	const startTs = sourceInstant(y1, a.mo, a.d, h1, mi1, tz);
	const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
	if (!(endTs > startTs)) return null;
	return { startTs, endTs, raw: String(line).trim() };
}

// ── 正文分节 ──
// 返回 [{ name, quote, windows:[{…}], primary }]
//   · name  = 「活动二、…」里的整段
//   · quote = name 里第一个「…」内的名字（外显用，比整段干净）
//   · primary = 节内第一条「★…日程★/★…时间★」表头之后的窗口；没有表头则取该节第一条窗口
function ns_bandori_parseBandoriSections(text, tz = ns_bandori_BANDORI_TZ, hint = null) {
	const lines = String(text == null ? "" : text).split("\n").map((s) => s.trim()).filter(Boolean);
	const sections = [];
	let cur = null;
	let expectWindow = false;      // 上一条是 ★…日程★ 类表头 → 下一条窗口即主窗口
	for (const line of lines) {
		const sec = /^活动\s*[一二三四五六七八九十百\d]+\s*、\s*([\s\S]+)$/.exec(line);
		if (sec) {
			cur = { name: sec[1].trim(), quote: "", windows: [], primary: null };
			const q = /[「【]([^」】]+)[」】]/.exec(cur.name);
			cur.quote = q ? q[1].trim() : "";
			sections.push(cur);
			expectWindow = false;
			continue;
		}
		if (/^[★☆※\s]*(活动日程|招募日程|活动时间|招募时间|举办日程|开展时间|日程)[★☆※\s]*$/.test(line)) {
			expectWindow = true;
			continue;
		}
		const w = ns_bandori_parseBandoriWindow(line, tz, hint);
		if (w) {
			if (cur) {
				cur.windows.push(w);
				if (cur.primary == null && expectWindow) cur.primary = w;
			}
			expectWindow = false;
			continue;
		}
		if (line.length > 14) expectWindow = false;   // 长正文行打断"表头→窗口"的邻接关系
	}
	for (const s of sections) if (s.primary == null && s.windows.length) s.primary = s.windows[0];
	return sections;
}

// 卡池节 = 名字含「招募」；主卡池节 = 再排除免费/确定/StepUp 这类派生池
const ns_bandori_GACHA_SEC_RE = /招募/;
const ns_bandori_GACHA_SIDE_RE = /免费|無料|确定|確定|初次|Step\s*up|StepUp|1日1次|每日|一日一次/i;

function ns_bandori_pickBandoriGachaSection(sections) {
	const pool = (sections || []).filter((s) => s.primary && ns_bandori_GACHA_SEC_RE.test(s.name));
	if (!pool.length) return null;
	const main = pool.filter((s) => !ns_bandori_GACHA_SIDE_RE.test(s.name));
	return (main.length ? main : pool)[0];
}
function ns_bandori_pickBandoriEventSection(sections) {
	const pool = (sections || []).filter((s) => s.primary && !ns_bandori_GACHA_SEC_RE.test(s.name) && /活动/.test(s.name));
	if (pool.length) return pool[0];
	return (sections || []).find((s) => s.primary && !ns_bandori_GACHA_SEC_RE.test(s.name)) || null;
}
// 悬停标签用的实体清理：卡池/活动名进悬停前必须把 `&middot;` 之类还原，
// 否则同一期内容会出现两种形态 —— 外显 banner 走 `ns_bandori_bandoriTitle`（已还原成 `·`），
// 而悬停用节里的 quote（未还原，会显示成 `黄金周纪念&middot;前篇…`）。
// 外显与悬停**必须逐字一致**。
// ⚠️ 只用于悬停标签；roles 字段的对外契约不变（既有的 `&sup2;` 形态由既有测试钉住）。
function ns_bandori_hoverLabel(s) {
	return ns_bandori_decodeExtra(String(s == null ? "" : s)).replace(/\s+/g, " ").trim();
}
// 每节的主窗口 → 悬停条目 `{ name, startTs, endTs, raw }`（hoverPool / hoverEvent 的入参形状）。
// 名称取节内第一个「…」里的名字（quote），比整段干净；raw 保留源站原文（缺起止时才用）。
function ns_bandori_bandoriSectionItem(section, name) {
	return {
		name: ns_bandori_hoverLabel(name || section.quote || section.name),
		startTs: section.primary.startTs,
		endTs: section.primary.endTs,
		raw: section.primary.raw
	};
}
// 当期（覆盖 now）的主卡池节：含「招募」且排除免费/确定/StepUp 这类派生池。
// ⚠️ 还要**有 ★5 名单**才算"池"：公告里「★5 期间限定 奇迹招募券礼包」这种**礼包上架**节
//    名字也带「招募」，但没有任何角色（实测真实夹具 18418 第 2 个这样的节）。
//    卡池悬停是「池名：角色」两行式，没有角色的节塞进去只会让悬停出现光秃秃的商品名。
function ns_bandori_bandoriActiveGachaSections(sections, text, now) {
	return (sections || []).filter((s) =>
		s.primary && !ns_bandori_GACHA_SIDE_RE.test(s.name) && ns_bandori_GACHA_SEC_RE.test(s.name)
		&& s.primary.startTs <= now && s.primary.endTs >= now
		&& !!ns_bandori_bandoriRolesFromSection(text, s));
}
// 当期（覆盖 now）的全部活动节（含卡池节 —— 这一期一起开的档期都能在悬停里看到）
function ns_bandori_bandoriActiveSections(sections, now) {
	return (sections || []).filter((s) => s.primary && s.primary.startTs <= now && s.primary.endTs >= now);
}

// 节内 ★5 名单 → roles（实测形态：`★5 丸山彩[镜中无法映照的手中]`、`★5 CHU² [这样的休假方式]`）
function ns_bandori_bandoriRolesFromSection(text, section) {
	if (!section) return "";
	const lines = String(text == null ? "" : text).split("\n").map((s) => s.trim());
	const startIdx = lines.findIndex((l) => l.startsWith(`活动`) && l.includes(section.name));
	if (startIdx < 0) return "";
	const names = [];
	for (let i = startIdx + 1; i < lines.length; i++) {
		if (/^活动\s*[一二三四五六七八九十百\d]+\s*、/.test(lines[i])) break;
		const m = /^★\s*5\s*(.+?)\s*[\[［]/.exec(lines[i]);
		if (m) {
			const n = m[1].replace(/[&][a-z0-9]+;/gi, "").trim();
			if (n && !names.includes(n)) names.push(n);
		}
	}
	return names.join("、");
}

// ── 取一期公告：列表倒序 → 逐条抓详情 → 用 selector 挑第一个"可用"的 ──
// 单条详情失败（网络/404）不整体崩，继续下一条；**全部失败则抛第一个错误**
// （不能把"源站挂了"静默降级成"未公布"）。
async function ns_bandori_loadAnnouncement(listUrl, signal, selector, limit = 5) {
	const list = ns_bandori_parseBandoriList(await fetchJson(listUrl, { referer: ns_bandori_BANDORI_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;
	let firstErr = null;
	for (const it of list.slice(0, limit)) {
		try {
			const detail = await fetchJson(ns_bandori_bandoriDetailUrl(listUrl, it.id), { referer: ns_bandori_BANDORI_HOME, signal, mode: "proxy" });
			const d = detail && detail.data;
			if (!d || typeof d.content !== "string") continue;
			const text = ns_bandori_plain(d.content);
			const hint = ns_bandori_parseBandoriDate(d.displayTime || d.mtime || it.displayTime || it.ctime) || it.dateTs;
			const sections = ns_bandori_parseBandoriSections(text, ns_bandori_BANDORI_TZ, hint);
			const picked = selector(sections);
			if (!picked) continue;
			return { item: it, data: d, text, hint, sections, picked };
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (firstErr) throw firstErr;
	return null;
}

// ── 卡池侧 ──
async function ns_bandori_gachaBandori(url, signal, tz = ns_bandori_BANDORI_TZ) {
	const listUrl = url || ns_bandori_BANDORI_LIST_URL;
	const a = await ns_bandori_loadAnnouncement(listUrl, signal, ns_bandori_pickBandoriGachaSection);
	if (!a) return null;
	const w = a.picked.primary;
	const banner = a.picked.quote || a.picked.name;
	// 悬停（本体 buildPoolHover 格式）：当期主池每池两行「池名：角色」⏎「档期」，结束时间升序。
	// 派生池（免费/确定/StepUp）不进悬停；只有 1 个当期主池时 hoverPool 返回 "" → 不设 bannerHover。
	const pools = ns_bandori_bandoriActiveGachaSections(a.sections, a.text, Date.now()).map((s) => {
		const roles = ns_bandori_bandoriRolesFromSection(a.text, s).replace(/、/g, "/");
		const name = ns_bandori_hoverLabel(s.quote || s.name);
		return { ...ns_bandori_bandoriSectionItem(s, name), label: roles ? `${name}：${roles}` : name };
	});
	const bannerHover = hoverPool(pools, tz);
	return {
		banner,
		roles: ns_bandori_bandoriRolesFromSection(a.text, a.picked),
		bannerDates: fmtWindow(w.startTs, w.endTs, tz),
		bannerDatesRaw: w.raw,
		startTs: w.startTs,
		endTs: w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

// ── 活动侧 ──
// 同源同一份公告：外显取"挑战演出活动"那一节，hover 列出该公告全部节的窗口
// （含卡池节，并附节名），这样悬停能看到这一期一起开的全部档期。
async function ns_bandori_eventsBandori(url, signal, tz = ns_bandori_BANDORI_TZ) {
	const listUrl = url || ns_bandori_BANDORI_LIST_URL;
	const a = await ns_bandori_loadAnnouncement(listUrl, signal, ns_bandori_pickBandoriEventSection);
	if (!a) return null;
	const w = a.picked.primary;
	// 悬停格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`，
	// **名称在前**（旧实现是「档期在前、名称在后」，与本体相反 —— 用户 2026-10-03 反馈的偏差②）。
	// 只有 1 条当期 → hoverEvent 返回 "" → 不设 eventHover，由 UI 走默认两行式。
	const active = ns_bandori_bandoriActiveSections(a.sections, Date.now());
	const eventHover = hoverEvent(active.map((s) => ns_bandori_bandoriSectionItem(s)), tz);
	return {
		event: a.picked.quote || ns_bandori_bandoriTitle(a.item) || a.picked.name,
		eventDates: fmtWindow(w.startTs, w.endTs, tz),
		eventDatesRaw: w.raw,
		...(eventHover ? { eventHover } : {})
	};
}

		// ===== 内联自 next-sources/parsers/ournotes.js（模块级标识符已加 ns_ournotes_ 前缀）=====

// next-sources/parsers/ournotes.js —— BanG Dream! OurNotes 日服（bushimo 官方 WordPress REST）
//
// 契约：async (url, signal, tz) → { event, eventDates, eventDatesRaw?, eventHover? } | null
//   本来源**只有活动/公告侧单侧**（没有卡池专用源）——按任务书只写 event 侧。
//
// ── 可直连（mode="direct"）──────────────────────────────────────────────────
//   调研实测 `https://bang-dream-on.bushimo.jp` 的 ACAO **回显 Origin**
//   → 是环境里仅有的三个可直接 fetch 的源之一（另两个是 api.umapyoi.net / sekai-world.github.io）。
//   注意：registry 里声明的 mode 与这里 fetchJson 传的 mode **必须一致**。
//
// ── 实测形态（2026-10-01/02 抓夹具 fixtures/ournotes-list）──────────────────
// 列表：GET /wp-json/wp/v2/posts?per_page=20&page=1
//   → 标准 WP REST 数组，每项 { id, date, date_gmt, link, title{rendered}, excerpt{rendered}, content{rendered}, … }
//   ⚠️ **不能加 `_fields=id,date,date_gmt,link,title` 裁剪**（任务书给的省流写法）：
//      活动区间藏在 `excerpt`/`content` 里，只取 title/date 就只剩"公告发布时刻"，
//      拿不到任何「举办期间」。夹具实测：288 的活动区间 `2026年9月24日(木)～10月28日(水)14:59`
//      只出现在 content 里，excerpt 里没有。
//   ⚠️ 这是**新游戏**：全站只有 11 篇公告（2026-01 建站 → 2026-09），
//      其中只有 6 篇带日期区间，属正常状态，不是抓取失败。
//
// ── 时区 Asia/Tokyo（**实测**，非推测）──────────────────────────────────────
//   逐条比对 `date` 与 `date_gmt`：全部相差 **9 小时**
//   （例：id=389 `date=2026-09-21T16:30:30` / `date_gmt=2026-09-21T07:30:30`）→ JST=UTC+9。
//
// ── 取值策略 ────────────────────────────────────────────────────────────────
//   公告不是排期表：一篇公告里可能完全没有日期（如 id=389「動作環境について」），
//   也可能有多个不相干的区间（直播时刻、展会日程、活动期间）。
//   所以：① 按 date_gmt 倒序遍历公告；② 从 title+excerpt+content 抽「日期[时刻]～日期[时刻]」区间；
//        ③ 外显取**第一条覆盖当前时刻**的区间（没有则取最新一篇的第一条区间）；
//        ④ hover 逐行列出所有覆盖当前的区间（附所属公告标题）。
//   只给"一个日期"的句子（「9月24日(木)に決定しました！」）**不算区间** → 不产出，不硬凑。


const ns_ournotes_OURNOTES_LIST_URL = "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1";
const ns_ournotes_OURNOTES_TZ = "Asia/Tokyo";

// lib/env.js 的 decodeEntities 未覆盖的常见实体（公告里 `&hellip;` 之类）
const ns_ournotes_ENT_EXTRA = { hellip: "…", middot: "·", times: "×", mdash: "—", ndash: "–", nbsp: " ", amp: "&", quot: '"', apos: "'" };
function ns_ournotes_decodeExtra(s) {
	return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
		const v = ns_ournotes_ENT_EXTRA[String(k).toLowerCase()];
		return v != null ? v : m;
	}));
}
function ns_ournotes_plain(html) { return ns_ournotes_decodeExtra(textOf(html)); }
function ns_ournotes_ournotesTitle(x) {
	const t = x && x.title;
	if (t && typeof t === "object") return ns_ournotes_decodeExtra(t.rendered || "").replace(/\s+/g, " ").trim();
	return ns_ournotes_decodeExtra(t || "").replace(/\s+/g, " ").trim();
}

// ── 日文日期区间令牌 ──
// 令牌化而不是一条大正则：日文公告里「年」可省、「月」在末段可省（`10月17日(土)・18日(日)`）、
// 时刻可省、分隔符有 `～`/`〜`/`~`/`・` 多种 —— 用一条正则的可选组会互相吃掉，走令牌清楚得多。
//   DATE：年?(可选) 月?(可选) 日 + 可选 (曜日)
//   TIME：HH:MM（全角冒号也算）
//   SEP ：~ ～ 〜 〰 － - – — ・
const ns_ournotes_JP_TOKEN = /(?:(20\d{2})\s*年)?\s*(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日(?:\s*[（(][^）)]{0,6}[）)])?|(\d{1,2})\s*[:：]\s*(\d{2})|([~\uff5e\u301c\u3030\uff0d\-\u2013\u2014]|・)/g;

// 从一段文本抽区间。返回 [{ startTs, endTs, raw }]（同 raw 去重）
//   起点**必须**带月份（防止把「5日連続」「30日間」这类裸"日"当窗口起点）
//   末段可省"月"（`・18日(日)`）→ 月份取起点月，日小于起点日则进一个月
//   末段缺时刻 → 全天（00:00 / 23:59）；起点缺时刻 → 00:00
function ns_ournotes_parseOurNotesWindows(text, tz = ns_ournotes_OURNOTES_TZ, hint = null) {
	const out = [];
	const seen = new Set();
	const s = String(text == null ? "" : text);
	ns_ournotes_JP_TOKEN.lastIndex = 0;
	const toks = [];
	let m;
	while ((m = ns_ournotes_JP_TOKEN.exec(s)) !== null) {
		toks.push({
			date: m[3] != null ? { y: m[1] ? +m[1] : null, mo: m[2] != null ? +m[2] : null, d: +m[3] } : null,
			time: m[4] != null ? { h: +m[4], mi: +m[5] } : null,
			sep: m[6] || null,
			at: m.index,
			end: m.index + m[0].length
		});
		if (m[0] === "") ns_ournotes_JP_TOKEN.lastIndex++;
	}
	const hintParts = hint != null ? sourceWallParts(hint, tz) : null;
	let i = 0;
	while (i < toks.length) {
		const t0 = toks[i];
		if (!t0.date || t0.date.mo == null) { i++; continue; }
		let j = i + 1;
		let startTime = null;
		if (toks[j] && toks[j].time) { startTime = toks[j].time; j++; }
		if (!(toks[j] && toks[j].sep)) { i++; continue; }
		j++;
		let endDate = null, endTime = null;
		if (toks[j] && toks[j].date) { endDate = toks[j].date; j++; }
		if (toks[j] && toks[j].time) { endTime = toks[j].time; j++; }
		if (!endDate && !endTime) { i++; continue; }

		// 年份：源站常只写月日 → 取公告年份
		const y1 = t0.date.y != null ? t0.date.y : (hintParts ? hintParts.y : null);
		if (y1 == null) { i++; continue; }
		let y2, mo2, d2;
		if (endDate) {
			mo2 = endDate.mo != null ? endDate.mo : t0.date.mo;
			d2 = endDate.d;
			y2 = endDate.y != null ? endDate.y : y1;
			if (endDate.y == null) {
				if (mo2 < t0.date.mo || (mo2 === t0.date.mo && d2 < t0.date.d)) {
					// 末段只写「日」且比起点日小 → 视为下一个月
					if (endDate.mo == null) { mo2 = t0.date.mo + 1; if (mo2 > 12) { mo2 = 1; y2 = y1 + 1; } }
					else y2 = y1 + 1;
				}
			}
		} else {
			mo2 = t0.date.mo; d2 = t0.date.d; y2 = y1;
		}
		const h1 = startTime ? startTime.h : 0, mi1 = startTime ? startTime.mi : 0;
		const h2 = endTime ? endTime.h : 23, mi2 = endTime ? endTime.mi : 59;
		const startTs = sourceInstant(y1, t0.date.mo, t0.date.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) { i++; continue; }
		const raw = s.slice(t0.at, toks[j - 1].end).trim();
		if (!seen.has(raw)) { seen.add(raw); out.push({ startTs, endTs, raw }); }
		i++;
	}
	return out;
}

// ── 公告集合 → [{ id, title, dateTs, windows }]（按 date_gmt 倒序）──
function ns_ournotes_parseOurNotesPosts(json, tz = ns_ournotes_OURNOTES_TZ) {
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	return json
		.filter((p) => p && p.id != null)
		.map((p) => {
			const hint = ns_ournotes_parseOurNotesInstant(p.date, tz);
			const hay = [
				ns_ournotes_ournotesTitle(p),
				ns_ournotes_plain(p.excerpt && p.excerpt.rendered),
				ns_ournotes_plain(p.content && p.content.rendered)
			].join("\n");
			return {
				id: p.id,
				title: ns_ournotes_ournotesTitle(p),
				dateText: p.date || "",
				dateTs: hint,
				windows: ns_ournotes_parseOurNotesWindows(hay, tz, hint)
			};
		})
		.sort((a, b) => (b.dateTs || 0) - (a.dateTs || 0));
}

// WP 的 `date` 是**源站本地时间且不带时区后缀**（"2026-09-21T16:30:30"）→ 按 tz 解释为墙钟
function ns_ournotes_parseOurNotesInstant(s, tz = ns_ournotes_OURNOTES_TZ) {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

// 外显挑选：第一条"覆盖当前时刻"的区间（按公告倒序、区间原序）；都没有则取最新一篇的第一条区间
function ns_ournotes_selectOurNotesPrimary(entries, now) {
	const list = Array.isArray(entries) ? entries : [];
	for (const p of list) for (const w of p.windows) if (w.startTs <= now && w.endTs >= now) return { post: p, win: w };
	for (const p of list) if (p.windows.length) return { post: p, win: p.windows[0] };
	return null;
}

// ── 抓取器（活动侧单侧）──
async function ns_ournotes_eventsOurNotes(url, signal, tz = ns_ournotes_OURNOTES_TZ) {
	const listUrl = url || ns_ournotes_OURNOTES_LIST_URL;
	// mode 必须与 registry-<batch>.js 里声明的 "direct" 一致（本目录只有 3 个源可直连）
	const json = await fetchJson(listUrl, { signal, mode: "direct" });
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	if (json.length === 0) return null;
	const posts = ns_ournotes_parseOurNotesPosts(json, tz);
	const now = Date.now();
	const picked = ns_ournotes_selectOurNotesPrimary(posts, now);
	if (!picked || !picked.win) return null;
	const active = [];
	for (const p of posts) for (const w of p.windows) if (w.startTs <= now && w.endTs >= now) active.push({ p, w });
	// 悬停格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`，
	// **名称在前**（旧实现「档期在前、名称在后」，与本体相反 —— 用户 2026-10-03 反馈的偏差②）。
	// 名称用公告标题（这是该站的"活动名"来源）；行内不再附来源站名/URL/时区推定等元信息。
	// ⚠️ 只有 1 条当期窗口时 hoverEvent 返回 "" → **不设 eventHover**，由 UI 走默认两行式
	//    「名称 ⏎ 档期」（实测夹具里覆盖当期的只有 1 条：288 那篇）。
	const list = (active.length ? active : [picked]).map(({ p, w }) => ({
		name: p.title,
		startTs: w.startTs,
		endTs: w.endTs,
		raw: w.raw
	}));
	const eventHover = hoverEvent(list, tz);
	return {
		event: picked.post.title,
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw,
		...(eventHover ? { eventHover } : {})
	};
}

		// ===== 内联自 next-sources/parsers/fgo.js（模块级标识符已加 ns_fgo_ 前缀）=====

// next-sources/parsers/fgo.js —— FGO 国服 · fgo.wiki（MediaWiki 1.43.9 + SemanticMediaWiki）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ══ 为什么最终选了「解析 HTML 表格」而不是 SMW `action=ask`（两条路都实测过）══
// 任务书提示该站启用了 SMW、`action=ask` 能拿结构化结果。实测结论：**ask 可用，但这条
// 路在本站选不出「国服当期」**，所以外显走 HTML 表格；SMW 只留作交叉验证时间口径。
//
//   ✅ ask 确实能用（2026-10-02 实测）：
//      https://fgo.wiki/api.php?action=ask&query=[[分类:活动]][[开始时间::>2026/09/01]]|?中文名称|?开始时间|?结束时间|?类型
//      返回 SMW 属性 `中文名称` / `开始时间` / `结束时间` / `类型`(Event|Campaign)，
//      且时间值带 `timestamp`（**UTC 秒**，例如 幕末武斗神话 开始 raw=1/2026/9/24/11/0/0/0
//      = 11:00Z ↔ 国服表 19:00 → +8）。这一点比仓库里原神那套（bwiki 的 raw 是服务器本地 +08，
//      需要按 tz 解释）更省事。
//   ❌ 但 `分类:活动` **同时含国服与日服的页面，且没有任何服务器判别字段**：
//      · 页面属性里确实有 `国服`/`日服`/`服务器` 三个 Property，实测**值全为空数组**
//        （printouts.国服 = []）→ 过滤不掉，`[[国服::+]]` 查询返回 0 条。
//      · 分类也一致：国服的「幕末武斗神话…」与日服的「见鬼去吧！南瓜农场屠杀」都是
//        `分类:活动` + `分类:主要活动` + `分类:活动信息`。
//      · 结果：2026-10-02 这一天，国服(9/24~10/15)与日服(9/16~10/7)两个 **Event** 都覆盖当期，
//        ask 无法回答"哪个是国服当期活动"。夹具 fgo-ask-activity 保留了这份证据。
//   ❌ 卡池侧 ask 更没用：`分类:推荐召唤` 的页面 printouts 只有一个畸形键 `{"3":[]}`，
//      **没有 开始时间/结束时间 属性**。
//   ✅ HTML 路（本文件采用）：`卡池一览` 的第一张表表头就写着 **「国服当前卡池」**；
//      `活动一览` 的国服表按年份分节（`2026年`），而日服表在页面最前面、表头明确标注
//      **「活动时间 （日本标准时间）」** —— 服务器归属是**页面自己标好的**，不用猜。
//      行内还带 `data-sort-value="2026-09-29 11:00"`（UTC）可交叉校验（本文件不依赖它）。
//
// ══ 实测形态（夹具 fgo-gacha-parse 115KB / fgo-event-parse 1.4MB）══
//   · `卡池一览`：3 张表 = [国服当前卡池, 日服当前卡池, 国服近未来卡池(带「预估」)]
//     列 = 卡池名 | 开始时间 ~ 结束时间 | 推荐召唤从者 | 推荐召唤概念礼装
//     窗口原文形如 `2026年9月22日(周二) 19:00 ~ 2026年10月6日(周二) 13:59`（同日用 <br> 分隔）
//   · `活动一览`：12 张表 = [日服当前(表头含「日本标准时间」), 2026年, 2025年, … 2016年]
//     国服表列 = 活动时间 | 名称 | 公告页面 | 类型
//     ⚠️ 国服表的**两个日期之间没有 `~`**，靠 `<br />` 换行分隔
//        （`<td data-sort-value="…">2026年9月29日(周二)19:00<br />2026年12月20日(周日)13:59`）
//        → 所以不按"分隔符"解析，而是「取该单元格里出现的**前两个** 日期+时刻」。
//
// ══ 时区 UTC+8（Asia/Shanghai）—— 有硬交叉验证 ══
//   国服表头不标时区，但：SMW 里同名活动的 `开始时间`(UTC) 与国服表墙钟**严格差 8 小时**
//   （幕末武斗神话：SMW=2026-09-24T11:00Z ↔ 国服表 9/24 19:00；南瓜农场屠杀同类吻合）
//   → 国服表就是 UTC+8，非推测。
//
// ══ 缓存警告 ══
//   两个页面顶部都有「该页面的信息或许并非最新 …刷新页面缓存」提示。任务书建议 `&action=purge`，
//   实测 **purge 必须 POST**（`{"error":{"code":"mustbeposted"}}`），而本目录的传输层
//   （lib/env.js `fetchText`/`fetchJson`）只有 GET —— 所以**不做 purge**。
//   好在 `action=parse` 是按当前 revision 重新渲染的（夹具里页面自带的刷新链接时间戳
//   `_=20261001172628` 正是抓取时刻），实测数据是新鲜的。


const ns_fgo_FGO_API = "https://fgo.wiki/api.php";
const ns_fgo_FGO_GACHA_PAGE = "卡池一览";
const ns_fgo_FGO_EVENT_PAGE = "活动一览";
const ns_fgo_FGO_TZ = "Asia/Shanghai";
const ns_fgo_FGO_REFERER = "https://fgo.wiki/";

function ns_fgo_fgoParseUrl(page) {
	// ⚠️ 这里对 page 做 encodeURIComponent —— registry-<batch>.js 里的 URL 必须用**同一个**构造方式，
	// 否则离线夹具（test/map.json / cases-b3.mjs 的 overrides 按整串匹配）会命中不到。
	return `${ns_fgo_FGO_API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`;
}
const ns_fgo_FGO_GACHA_URL = ns_fgo_fgoParseUrl(ns_fgo_FGO_GACHA_PAGE);
const ns_fgo_FGO_EVENT_URL = ns_fgo_fgoParseUrl(ns_fgo_FGO_EVENT_PAGE);

// ── 只做 indexOf 扫描的表格切分（1.4MB 页面上不跑贪婪正则）──
function ns_fgo_fgoTables(html) {
	const heads = [];
	const hre = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/g;
	let hm;
	while ((hm = hre.exec(html)) !== null) heads.push({ index: hm.index, text: stripTags(hm[2]) });
	const out = [];
	let i = html.indexOf("<table");
	while (i !== -1) {
		const end = html.indexOf("</table>", i);
		let head = null;
		for (let k = heads.length - 1; k >= 0; k--) if (heads[k].index < i) { head = heads[k].text; break; }
		out.push({ index: i, head, html: html.slice(i, end === -1 ? html.length : end + 8) });
		i = html.indexOf("<table", i + 1);
	}
	return out;
}

function ns_fgo_rowsOf(tableHtml) {
	return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
}
function ns_fgo_cellsOf(rowHtml) {
	return [...rowHtml.matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t\1>/g)].map((m) => m[2]);
}
function ns_fgo_isHeaderRow(cells) {
	const first = stripTags(cells[0]);
	if (/国服当前卡池|日服当前卡池|国服近未来卡池/.test(first)) return true;
	const t = cells.map((c) => stripTags(c)).join(" ").trim();
	return /^活动时间/.test(t) && /名称/.test(t);
}

// ── 单元格里的「日期+时刻」对 ──
// 取该单元格中**前两个**「YYYY年M月D日(周X) HH:MM」；时刻可缺（近未来表写「预估 … ~ …」）
// → 缺起点时刻按 00:00、缺终点时刻按 23:59（只影响预估行，当期表都有明确时刻）
const ns_fgo_FGO_DT = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(]\s*周\s*[一二三四五六日天]\s*[）)])?(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?/g;
function ns_fgo_parseFgoWindow(cellText, tz = ns_fgo_FGO_TZ) {
	const hits = [];
	ns_fgo_FGO_DT.lastIndex = 0;
	let m;
	while ((m = ns_fgo_FGO_DT.exec(String(cellText || ""))) !== null) {
		hits.push({ text: m[0].replace(/\s+/g, " ").trim(), y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null });
		if (m[0] === "") ns_fgo_FGO_DT.lastIndex++;
	}
	if (hits.length < 2) return null;
	const a = hits[0], b = hits[1];
	const startTs = sourceInstant(a.y, a.mo, a.d, a.h == null ? 0 : a.h, a.mi == null ? 0 : a.mi, tz);
	const endTs = sourceInstant(b.y, b.mo, b.d, b.h == null ? 23 : b.h, b.mi == null ? 59 : b.mi, tz);
	if (!(endTs > startTs)) return null;
	// raw 用两个匹配片段拼 `… ~ …`：国服活动表的两个日期之间**没有**分隔符（只有 <br />），
	// 拼接后既能当"源站原文"展示，也和卡池表的原文形态一致。
	return { startTs, endTs, raw: `${a.text} ~ ${b.text}` };
}

// 选当期：覆盖 now 的里按 (类型档位, 结束时间, 开始时间) 取第一 —— 与插件
// 30-parsers.js 的 sortEventItems/pickEventPrimary 同口径（越快结束越该被盯住）。
// 没有覆盖的 → 取最近要开的；再没有 → null（未公布，不硬造）。
function ns_fgo_pickRow(rows, now) {
	if (!rows.length) return null;
	const covering = rows.filter((r) => r.startTs <= now && r.endTs >= now);
	const pool = covering.length ? covering : rows.filter((r) => r.startTs > now);
	if (!pool.length) return null;
	return pool.slice().sort((a, b) => {
		const t = (a.tier || 0) - (b.tier || 0);
		if (t !== 0) return t;
		if (a.endTs !== b.endTs) return a.endTs - b.endTs;
		return a.startTs - b.startTs;
	})[0];
}

// ── 卡池侧：国服当前卡池 ──
// 悬停里的角色名用「、」连接（与本体 buildPoolHover 的 `池名：角色` 观感一致）：
// wiki 表格用**空格**分隔从者名（`阿蒂拉 罗摩 兰斯洛特(Saber) …`），
// 直接塞进「池名：角色」会变成一长串空格分隔名，跟本体的「A、B、C」不一致。
function ns_fgo_formatFgoRoles(roles) {
	return String(roles || "").replace(/\s+/g, " ").trim().replace(/ +/g, "、");
}

function ns_fgo_parseFgoBannerTable(html, tz = ns_fgo_FGO_TZ, now = Date.now()) {
	const tables = ns_fgo_fgoTables(html);
	if (!tables.length) throw new Error("fgo-no-table");
	const tb = tables.find((t) => /国服当前卡池/.test(stripTags(ns_fgo_rowsOf(t.html)[0] || "")));
	if (!tb) throw new Error("fgo-no-current-banner-table");
	const rows = [];
	for (const r of ns_fgo_rowsOf(tb.html)) {
		const cells = ns_fgo_cellsOf(r);
		if (cells.length < 2 || ns_fgo_isHeaderRow(cells)) continue;
		const name = stripTags(cells[0]).replace(/\s+/g, " ").trim();
		const w = ns_fgo_parseFgoWindow(stripTags(cells[1]), tz);
		if (!name || !w) continue;
		let roles = cells.length > 2 ? stripTags(cells[2]).replace(/\s+/g, " ").trim() : "";
		// wiki 在"推荐召唤从者>15 骑"时用一行占位提示顶替名单 → 不把它当角色名
		if (/请前往|大于15|详见|Template:/.test(roles)) roles = "";
		rows.push({ banner: name, roles, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	const best = ns_fgo_pickRow(rows, now);
	if (!best) return null;
	// 悬停（本体 buildPoolHover 格式）：当期主池每池「池名：角色」+ 档期两行，结束时间升序。
	// 「卡池一览」的这一张表 = **国服当前卡池**，表内解析出的行本就都是当期池，不需要再按 now 过滤。
	// 只有 1 个当期池时 hoverPool 返回 ""，此处**不设 bannerHover**，由 UI 走默认两行式。
	// 角色名过长（>8 骑，如「天草四郎时贞推荐召唤」动辄 20 骑）会淹掉档期行 → 不放进悬停。
	const pools = (rows.length < 2 ? [] : rows)
		.slice()
		.sort((a, b) => (a.endTs === b.endTs ? a.startTs - b.startTs : a.endTs - b.endTs))
		.map((r) => {
			const names = ns_fgo_formatFgoRoles(r.roles);
			const short = names && names.split("、").length <= 8 ? names : "";
			return {
				name: r.banner,
				label: short ? `${r.banner}：${short}` : r.banner,
				startTs: r.startTs,
				endTs: r.endTs,
				raw: r.raw
			};
		});
	const bannerHover = hoverPool(pools, tz);
	return {
		...best,
		openCount: rows.length,
		...(bannerHover ? { bannerHover } : {})
	};
}

// ── 活动侧：国服当年那张表 ──
// 选表规则（三条同时成立）：① 表头含「活动时间」且含「名称」且含「类型」；
// ② **不得**含「日本标准时间」（那是日服表）；③ 表前最近的标题是 `YYYY年`，取年份最大的那张。
function ns_fgo_findFgoEventTable(html) {
	const tables = ns_fgo_fgoTables(html);
	let best = null;
	for (const t of tables) {
		const head = stripTags(ns_fgo_rowsOf(t.html)[0] || "");
		if (!/活动时间/.test(head) || !/名称/.test(head) || !/类型/.test(head)) continue;
		if (/日本标准时间/.test(head)) continue;
		const ym = /(\d{4})\s*年/.exec(t.head || "");
		if (!ym) continue;
		const year = +ym[1];
		if (!best || year > best.year) best = { year, table: t };
	}
	return best;
}

function ns_fgo_parseFgoEventTable(html, tz = ns_fgo_FGO_TZ, now = Date.now()) {
	const found = ns_fgo_findFgoEventTable(html);
	if (!found) throw new Error("fgo-no-cn-event-table");
	const rows = [];
	let skipped = 0;
	for (const r of ns_fgo_rowsOf(found.table.html)) {
		const cells = ns_fgo_cellsOf(r);
		if (cells.length < 4 || ns_fgo_isHeaderRow(cells)) continue;
		const w = ns_fgo_parseFgoWindow(stripTags(cells[0]), tz);
		const name = stripTags(cells[1]).replace(/\s+/g, " ").trim();
		if (!w || !name) { skipped++; continue; }
		const type = stripTags(cells[3]).replace(/\s+/g, " ").trim();
		rows.push({ name, type, tier: /^Event/i.test(type) ? 0 : 1, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	const best = ns_fgo_pickRow(rows, now);
	if (!best) return { year: found.year, rows, skipped, event: null };
	// 悬停：只列**覆盖当前时刻**的行（该年的表含全年 57 行，全列会淹没当期；按结束时间升序）。
	// 格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`。
	// ⚠️ 表格第 4 列的**类型**（Event/Campaign）是源站的**分类词**，不是活动名 —— 旧实现把它塞在
	//    「档期」和「名称」之间（`09-24 19:00 ~ 10-15 13:59   Event   幕末…`），既把档期放在了行首，
	//    又把分类词冒充成名称的一部分。用户 2026-10-03 反馈后**彻底删掉**（分类只用于 `tier` 排序，
	//    保留在 rows 里供外部使用，不进悬停文本）。
	const active = rows
		.filter((x) => x.startTs <= now && x.endTs >= now)
		.sort((a, b) => (a.endTs === b.endTs ? a.startTs - b.startTs : a.endTs - b.endTs));
	// <2 条时 hoverEvent 返回 "" → 不设 eventHover，由 UI 走默认两行式
	const eventHover = hoverEvent(active, tz);
	return {
		year: found.year,
		rows,
		skipped,
		activeCount: active.length,
		event: best.name,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ── 抓取器 ──
// ⚠️ mode 必须与 registry-b3.js 里声明的 "proxy" 一致（fgo.wiki 的 ACAO 为空，不能直连）
async function ns_fgo_fetchPageText(url, signal) {
	if (!/^https?:\/\//.test(String(url || ""))) throw new Error("fgo-bad-url");
	return fetchMediaWikiText(url, { referer: ns_fgo_FGO_REFERER, signal, mode: "proxy" });
}

async function ns_fgo_gachaFgo(url, signal, tz = ns_fgo_FGO_TZ) {
	const html = await ns_fgo_fetchPageText(url || ns_fgo_fgoParseUrl(ns_fgo_FGO_GACHA_PAGE), signal);
	const r = ns_fgo_parseFgoBannerTable(html, tz, Date.now());
	if (!r) return null;
	return {
		banner: r.banner,
		roles: r.roles || "",
		bannerDates: fmtWindow(r.startTs, r.endTs, tz),
		bannerDatesRaw: r.raw,
		startTs: r.startTs,
		endTs: r.endTs,
		// 有 ≥2 个当期池才有值；1 个池时 ns_fgo_parseFgoBannerTable 不设该字段（UI 走默认两行式）
		...(r.bannerHover ? { bannerHover: r.bannerHover } : {})
	};
}

async function ns_fgo_eventsFgo(url, signal, tz = ns_fgo_FGO_TZ) {
	const html = await ns_fgo_fetchPageText(url || ns_fgo_fgoParseUrl(ns_fgo_FGO_EVENT_PAGE), signal);
	const r = ns_fgo_parseFgoEventTable(html, tz, Date.now());
	if (!r || !r.event) return null;
	return {
		event: r.event,
		eventDates: r.eventDates,
		eventDatesRaw: r.eventDatesRaw,
		// ≥2 条当期活动才有值；只有 1 条时不设该字段（UI 走默认两行式「名称 ⏎ 档期」）
		...(r.eventHover ? { eventHover: r.eventHover } : {})
	};
}

		// ===== 内联自 next-sources/parsers/miyoushe.js（模块级标识符已加 ns_miyoushe_ 前缀）=====

// next-sources/parsers/miyoushe.js —— 米哈游系官方公告（米游社 BBS API）
//
// 覆盖 4 个游戏（gids 实测四个都 200 且返回对应游戏的正确公告）：
//   1 = 崩坏3 / 2 = 原神 / 6 = 崩坏：星穹铁道 / 8 = 绝区零
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null
//   卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//   活动侧 { event, eventDates, eventDatesRaw?, eventHover? }
//   ⚠️ **now 必须是第 4 个参数**。本仓库历史 bug：now 收到 tz 字符串 → `startTs <= now` 恒假
//      → 静默显示"未公布"。本文件全部命中判定都用传入的 now，不读全局时钟。
//   ⚠️ 这是**官方补充源**，与既有 bwiki 条目（`genshin` / `hsr` / `zzz`）**并存**，
//      所以 id 加 `-official` 后缀、不撞车。
//
// ══════════════════════════════════════════════════════════════════════════════
// 一、端点与实测形态（夹具 2026-10-02 抓，见 fixtures/p4-*）
// ══════════════════════════════════════════════════════════════════════════════
//  列表  GET /painter/wapi/getNewsList?gids=<gid>&type=<1|2|3>&page_size=20
//        type=1 公告/补给、type=2 活动、type=3 资讯
//        → { retcode:0, message:"OK", data:{ list:[ { post:{ post_id, subject,
//            created_at(epoch 秒), images[], content:"", summary:"", structured_content:"" },
//            news_meta:null, text_summary:"", brief_structured_content:"" }, … ],
//            last_id, is_last } }
//  详情  GET /post/wapi/getPostFull?post_id=<post_id>
//        → { retcode:0, data:{ post:{ post:{ post_id, subject, created_at, content(HTML) } } } }
//
//  ⚠️ `post_id` 在 JSON 里是**字符串**（"78549971"），不能用 `===` 跟数字比。
//  ⚠️ `created_at` 是 **epoch 秒**（不是毫秒），且是**绝对时刻**（可直接用，不必按 tz 解释）。
//
//  ⚠️⚠️ **列表里没有"档期文本"字段**：实测各游戏的 **type=1（公告/补给）** 列表里，
//      `post.content` / `post.summary` / `post.structured_content` / `post.meta_content` /
//      `text_summary` / `brief_structured_content` 全为空，`news_meta` 恒为 **null**
//      （夹具 p4-{bh3,genshin,hsr,zzz}-news：0/20 条 post.content，news_meta 全 null）。
//      → **卡池侧必须再抓详情正文**才能拿到档期。这是本解析器"抓列表 → 抓详情 → 从正文抽档期"
//        两步形态的原因（与 ournotes.js 同形）。
//
//  ✅ **但 type=2（活动）列表有一层被低估的显式字段**（实测发现，任务书原话"该 API 没有显式
//      档期字段"**只对 type=1 成立**）：每条的 `news_meta` 都带
//         { activity_status: 1|2|3, start_at_sec: "…", end_at_sec: "…" }   （**epoch 秒的字符串**）
//      20/20 条齐全（夹具 p4-{bh3,genshin,hsr,zzz}-events）。`activity_status` 与"是否已结束"相关
//      （实测 bh3：进行中的两条=1，其余历史条目=3）。
//      ⚠️ 但它的**结束时刻口径各游戏不一致**，所以**没有**拿它当外显：
//        · 崩坏3  `09-28 12:00 ~ 10-07 23:59` = 正文「9.28 12:00~10.7 23:59」**完全一致**
//        · 星铁   `09-28 18:44 ~ 10-13 00:00` ≈ 正文「9月28日 - 10月12日 23:59」+1 分钟（= 参与截止）
//        · 原神   `10-02 12:00 ~ 11-10 20:00` ← 正文写「10月2日-10月31日23:59」、**开奖时间 11月10日**
//                  → 这里的 end 是**开奖时刻**，不是参与截止（口径不同）
//      结论：外显仍取**公告正文**（玩家看到的活动时间就是正文那句），
//      `news_meta` 只作**兜底**：当正文一个可解析窗口都抽不到时，用它的显式档期顶上，
//      并在 `eventDatesRaw` / `bannerDatesRaw` 里标明来源是 news_meta（不冒充正文）。
//      ⚠️ 这句来源说明**只进 raw 字段**（既有约定：本体也有条目这么做）；**悬停里不写**（见 §五）。
//
//  ⚠️ **详情端点有 Referer 门（实测）**：不带 Referer 一律 `HTTP 403 / body "Forbidden"`：
//        · 桌面 UA + 无 Referer                     → 403
//        · 桌面 UA + Referer: www.miyoushe.com      → 200
//        · 桌面 UA + Referer: bbs-api.miyoushe.com（宿主代理的默认值） → 200
//        · 只有 Origin、没有 Referer                 → 403   ← 门是 Referer，不是 UA
//      → 本文件显式传 `referer: https://www.miyoushe.com/`；**列表**端点不需要 Referer（200）。
//
//  🚨 生产环境前置条件（**Lead 集成时必须处理，本文件不越界改 src/**）：
//      `src/index.js` 的 `PROXY_ALLOW_HOSTS` **当前不含 `bbs-api.miyoushe.com`**
//      （白名单里只有同门的 `api-takumi-static.mihoyo.com`）。本目录新源一律 `mode="proxy"`，
//      所以离线夹具测试能全绿，但**真机上会拿到 `{error:"host not allowed"}`**。
//      → 需 Lead 在 `PROXY_ALLOW_HOSTS` 里加 `"bbs-api.miyoushe.com"`（一行，属插件本体改动）。
//
// ══════════════════════════════════════════════════════════════════════════════
// 二、时区 = Asia/Shanghai（UTC+8）—— **推测**
// ══════════════════════════════════════════════════════════════════════════════
//  正文里的时刻（`2026-09-30 12:00`、`9.28 12:00`）都是**国服墙钟原文**，源站**没有**标注时区。
//  按国服惯例取 UTC+8。可佐证的旁证（非硬证据）：
//    · 绝区零 3.2 限时频段 `2026-09-30 12:00 ~ 2026-10-20 14:59` —— 12:00 开池 / 14:59 收池，
//      是国服"中午开、下午收"的典型口径（与 bwiki 各源一致）；
//    · 官方公告的发布时刻 `created_at` 落在 UTC+8 的整点/半点（10:00、04:00、12:00 等），
//      而按 UTC+9 渲染会变成 11:00、05:00、13:00（不整）。
//  → 因此本文件把 `tz` 默认写成 `Asia/Shanghai`，并在**注释**里如实标"推测"
//    （⚠️ 悬停里**不写**时区说明 —— 用户 2026-10-03：「元信息彻底删掉」，见 §五）。
//
// ══════════════════════════════════════════════════════════════════════════════
// 三、正文档期抽取（**实测的格式清单**，全部来自 p4-*-detail-* 夹具）
// ══════════════════════════════════════════════════════════════════════════════
//   ✅ 能抽到：
//     · `9.28 12:00~10.7 23:59`                       崩坏3 有奖活动（**无年份**，取公告年）
//     · `2026-09-30 12:00 ~ 2026-10-20 14:59`         绝区零 3.2 限时频段
//     · `参与时间：即日起 - 2026年10月18日 23:59`      绝区零 有奖活动（起点"即日起"）
//     · `2026年10月2日-2026年10月31日23:59`           原神 有奖活动（分隔符是**紧贴的 `-`**）
//     · `2026年9月28日 - 2026年10月12日 23:59`        星铁 有奖活动
//     · `2026/09/28 4.6版本更新后 - 2026/11/10 15:00`  星铁 活动跃迁（起点是**版本锚点**）
//     · `整体活动时间：2026/09/30 10:00 ~ 2026/11/03 03:59` 原神 type=1 活动说明
//   ❌ **抽不到（正文里根本没有日期，时间画在配图里）→ 本侧如实返回 null**：
//     · 崩坏3 补给（`p4-bh3-detail-gacha` / `-char`）：正文只有 `>>开放等级`、
//       `>>补给信息`（**一张图**）、`>>补给规则`（`每10次装备补给必定获得4★武器或圣痕`）
//       → 全文 0 个日期。**绝不拿 `created_at` 当档期、绝不硬凑**。
//     · 原神 祈愿（`p4-genshin-detail-wish` / `-wish2`）：正文只有 `〓祈愿介绍〓`，
//       全程写"活动期间"却**不给日期**，全文 0 个日期。
//
//  抽取策略（令牌化 + 配对，而不是一条大正则）：
//    ① 扫令牌：ABS(YYYY-MM-DD/./年 的完整日期[+HH:MM])、VER(`X.Y版本更新后`/`X.Y版本结束`)、
//       BARE(无年份 `M.D HH:MM`)、OPEN(`即日起`)；
//    ② 相邻两令牌之间只允许"连接符"`~ ～ 〜 〰 - – — － 至 到`（可带空白）→ 配对成窗口；
//       紧贴的 `YYYY/MM/DD` + `X.Y版本更新后`（中间只有空白）视作**同一个起点**；
//    ③ 缺时刻：起点按 00:00、终点按 23:59；
//    ④ 无年份 `M.D` 的年份取**公告发布年**（按 tz 渲染）；终点月日早于起点 → 终点进一年；
//    ⑤ `即日起` → 起点取公告 `created_at`（并标 `inferred`）；`X.Y版本更新后` → 起点取
//       **同列表里 `X.Y版本更新说明` 的发布时刻**（版本锚点，标 `inferred`）；
//       锚点找不到才退回正文里的字面日期 00:00；
//    ⑥ `endTs > startTs` 才产出；按**时间区间**去重（保留 raw 更全的那条）；**文档顺序**保留。
//  选当期：候选公告按 `created_at` **倒序**，逐篇抓详情，取**第一条覆盖 now 的窗口**；
//          没有覆盖 now 的窗口 → 返回 `null`（未公布），**不退回过期档期**。
//
//  候选筛选（标题关键词分流，见 ns_miyoushe_classifyMiyousheTitle）：
//    · 卡池侧 补给/祈愿/跃迁/频段/调频/招募…
//    · 活动侧 活动/征集/赛事/签到/有奖/话题…
//    同一标题同时命中两边时**卡池关键词优先**（实例：`4.6版本活动跃迁（其一）` 是卡池公告，
//    虽然字面含"活动"）。命不中的（版本更新说明、封禁名单、商城上新…）直接跳过。
//
//  成本：列表 1 次请求 + **最多 ns_miyoushe_MIYOUSHE_MAX_DETAILS 篇正文**（顺序、间隔 ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS，
//        对 WAF 友好）；候选已按时间倒序，覆盖 now 的窗口一旦出现即被采用。
//
// ══════════════════════════════════════════════════════════════════════════════
// 四、失败口径（"只有结构性损坏才 throw"）
// ══════════════════════════════════════════════════════════════════════════════
//   · HTTP 非 2xx / 响应不是 JSON / `retcode !== 0`          → **throw**（该侧算抓取失败）
//   · 列表为空（实测 `gids=99999` → `retcode:0, list:[]`）    → 返回 null（未公布）
//   · 单篇详情 `retcode 1101/1102`（"post not exist"，实测）  → **跳过该篇**（不算失败）
//   · 单篇详情 HTTP 404/410                                   → 跳过该篇
//   · 全部候选都失败且出现过**硬错**（403/567/坏 JSON…）      → **throw**（别把封禁静默成"未公布"）
//     （实测详情缺 Referer 就是 403 "Forbidden" —— 这种必须能被看见）
//
// ══════════════════════════════════════════════════════════════════════════════
// 五、悬停排版（用户 2026-10-03：「元信息彻底删掉」）
// ══════════════════════════════════════════════════════════════════════════════
//  排版**不再本地实现**，一律调 `lib/env.js` 的 `hoverPool` / `hoverEvent`
//  （与本体 `buildPoolHover` / `buildEventHover` 逐字一致），本文件只负责：
//    · 卡池侧：每池一项 `{ name: 公告标题, label: 「池名：角色」, startTs, endTs }` → hoverPool
//      （角色名空 → label 退化成池名；与本体 `banner：roles` 同构）
//    · 活动侧：每条 `{ name: 公告标题, startTs, endTs }`，**先按结束时间升序排好**再传给 hoverEvent
//      （`hoverEvent` 自己不排序，与本体一致）
//    · 当期**不足 2 项**时两个工具返回 `""` → **不设** `bannerHover` / `eventHover` 字段，
//      让 UI 走默认两行式（卡池 `池名：角色` ⏎ 档期；活动 `名称` ⏎ 档期）
//
//  🚫 以下信息**一律不进悬停文本**（只留在本文件的代码注释里）：
//     · 来源站名 / 域名 / URL / API 名（米游社官方公告、bbs-api.miyoushe.com、getNewsList…）
//     · 时区推定说明（"国服墙钟按 UTC+8 换算 —— 源站未标注时区＝推测"）
//     · 抓取统计（"本轮有 N 篇公告正文抓取失败"）
//     · 内部 id / 源站字段名（post_id、start_at_sec、end_at_sec、activity_status、news_meta…）
//     · 游戏名 + 区服前缀（悬停里不重复游戏名）
//     · 任何「（…）」形式的实现说明（"本篇第 N 段档期"、"起点为推断"、"源站 news_meta 显式档期"…）
//  ⇒ 用户明确要求"直接删掉"：**删除**，不要把这些信息改放到悬停的别的行/字段里。
//     （`bannerDatesRaw` / `eventDatesRaw` 是**既有**的"源站原文 / 溯源说明"约定字段，
//      本次维持现状 —— 那不是"迁移目的地"，只是原本就长这样。）


const ns_miyoushe_MIYOUSHE_TZ = "Asia/Shanghai";                     // **推测**（理由见文件头 §二）
const ns_miyoushe_MIYOUSHE_REFERER = "https://www.miyoushe.com/";    // 详情端点的 Referer 门（实测）
// ⚠️ 这里**曾**导出 `MIYOUSHE_PROVENANCE`（"米游社官方公告（档期由公告正文抽出；国服墙钟按 UTC+8 换算
//    —— 源站未标注时区＝推测）"），专门塞进悬停首行。用户 2026-10-03 要求「元信息彻底删掉」→
//    常量与悬停首行**一并删除**。来源站名 / 时区推定这类信息只留在**本文件注释**里（§一/§二）。

const ns_miyoushe_LIST_BASE = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList";
const ns_miyoushe_DETAIL_BASE = "https://bbs-api.miyoushe.com/post/wapi/getPostFull";

// gids（实测：1=崩坏3 / 2=原神 / 6=星穹铁道 / 8=绝区零）
const ns_miyoushe_MIYOUSHE_GIDS = { bh3: 1, genshin: 2, hsr: 6, zzz: 8 };
// type（实测：1=公告/补给、2=活动、3=资讯）
const ns_miyoushe_MIYOUSHE_TYPES = { GACHA: 1, EVENT: 2, INFO: 3 };

const ns_miyoushe_MIYOUSHE_MAX_DETAILS = 5;        // 每侧最多抓几篇正文
const ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS = 200;  // 篇间隔（顺序抓，避免把源站打急）

// ⚠️ registry-p4.js 里声明的 url 必须由这两个函数生成，否则离线夹具（map.json 按整串匹配）命中不到。
function ns_miyoushe_miyousheListUrl(gids, type, pageSize = 20) {
	return `${ns_miyoushe_LIST_BASE}?gids=${gids}&type=${type}&page_size=${pageSize}`;
}
function ns_miyoushe_miyousheDetailUrl(postId) {
	return `${ns_miyoushe_DETAIL_BASE}?post_id=${encodeURIComponent(String(postId))}`;
}

//#region 列表 / 详情解析（纯函数）
// type=2 列表每条都带 `news_meta`（显式档期，epoch 秒**字符串**）→ 解析成绝对毫秒；type=1 恒 null。
function ns_miyoushe_parseNewsMeta(nm) {
	if (!nm || typeof nm !== "object") return null;
	const s = Number(nm.start_at_sec), e = Number(nm.end_at_sec);
	if (!Number.isFinite(s) || !Number.isFinite(e) || !(s > 0) || !(e > s)) return null;
	const st = Number(nm.activity_status);
	return { startTs: s * 1000, endTs: e * 1000, status: Number.isFinite(st) ? st : null };
}

function ns_miyoushe_parseMiyousheList(json) {
	if (!json || typeof json !== "object") throw new Error("miyoushe-bad-shape");
	if (json.retcode !== 0) throw new Error("miyoushe-retcode-" + json.retcode);
	const list = json.data && json.data.list;
	if (!Array.isArray(list)) throw new Error("miyoushe-bad-list");
	const out = [];
	for (const it of list) {
		const p = it && it.post;
		if (!p || p.post_id == null || p.post_id === "") continue;
		const sec = Number(p.created_at);
		out.push({
			// ⚠️ 保留字符串形态（源站就是字符串；夹具 map 的 URL 也按它拼）
			postId: String(p.post_id),
			subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
			// created_at 是 **epoch 秒**，转毫秒；源站的绝对时刻，不需要按 tz 解释
			createdTs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : null,
			// 只有 type=2 列表才有（type=1 恒 null）；epoch 秒的**字符串**，要 Number() 一下
			newsMeta: ns_miyoushe_parseNewsMeta(it && it.news_meta)
		});
	}
	return out;
}

function ns_miyoushe_parseMiyousheDetail(json) {
	if (!json || typeof json !== "object") throw new Error("miyoushe-bad-shape");
	if (json.retcode !== 0) throw new Error("miyoushe-retcode-" + json.retcode);
	const p = json.data && json.data.post && json.data.post.post;
	if (!p || p.post_id == null) throw new Error("miyoushe-bad-post");
	const sec = Number(p.created_at);
	return {
		postId: String(p.post_id),
		subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
		createdTs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : null,
		content: String(p.content || "")
	};
}

// "这篇拿不到"≠"这一侧抓取失败"：实测详情对不存在的 post 回 **HTTP 200 + retcode 1101/1102**
// （`{"data":null,"message":"post not exist","retcode":1102}`），不是 HTTP 404。
function ns_miyoushe_isMiyousheMissing(err) {
	const m = String((err && err.message) || err || "");
	return /\b(404|410)\b/.test(m) || /miyoushe-retcode-(1101|1102)\b/.test(m);
}
//#endregion

//#region 标题关键词分流
// 冲突时卡池优先：`4.6版本活动跃迁（其一）` 是**卡池**公告（字面含"活动"）。
const ns_miyoushe_BANNER_KW = /祈愿|补给|跃迁|频段|调频|招募|概率UP|概率提升|扭蛋|蛋池/;
const ns_miyoushe_EVENT_KW = /活动|征集|赛事|签到|登录|庆典|有奖|话题|抽奖|投票|答题|委托|福利/;

function ns_miyoushe_classifyMiyousheTitle(subject) {
	const t = String(subject == null ? "" : subject);
	if (ns_miyoushe_BANNER_KW.test(t)) return "gacha";
	if (ns_miyoushe_EVENT_KW.test(t)) return "event";
	return "unknown";
}
//#endregion

//#region 版本锚点（`X.Y版本更新后` → 该版本更新公告的发布时刻）
// 实测（p4-hsr-news）：`4.6版本更新说明` created_at=2026-09-28 07:00:11 +08 → 4.6 的起点。
// 必须排除「预下载开启&更新通知」（比正式更新早 1~2 天）与《云•XX》的更新说明。
const ns_miyoushe_VER_UPD_RE = /(\d{1,2}\.\d{1,2})\s*版本(?:更新说明|更新公告|更新通知|更新预告)/;
function ns_miyoushe_miyousheVersionStarts(items) {
	const map = {};
	for (const it of items || []) {
		const t = String((it && it.subject) || "");
		if (/预下载|前瞻|预约|预抽|云[•·]/.test(t)) continue;
		const m = ns_miyoushe_VER_UPD_RE.exec(t);
		if (!m) continue;
		if (map[m[1]] == null && it.createdTs != null) map[m[1]] = it.createdTs;
	}
	return map;
}
// 版本锚点 → 绝对时刻。`更新后` = 该版本的起点（没有 → 不可解）；`结束` = 下一个已知版本起点 − 1 分钟。
function ns_miyoushe_resolveVersionAnchor(ver, kind, verStarts) {
	const cur = verStarts ? verStarts[ver] : null;
	if (cur == null) return null;
	if (kind === "更新后") return cur;
	if (kind === "结束") {
		const later = Object.keys(verStarts)
			.filter((v) => verStarts[v] > cur)
			.sort((a, b) => verStarts[a] - verStarts[b])[0];
		return later == null ? null : verStarts[later] - 60000;
	}
	return null;
}
//#endregion

//#region 正文档期抽取
// 令牌化：ABS 完整日期 | VER 版本锚点 | BARE 无年份 M.D HH:MM | OPEN 即日起
// 组序号：1-5 = ABS(y,mo,d,h,mi)，6-7 = VER(num,kind)，8-11 = BARE(mo,d,h,mi)
const ns_miyoushe_ABS_SRC = "(20\\d{2})\\s*[-\\/年.]\\s*(\\d{1,2})\\s*[-\\/月.]\\s*(\\d{1,2})\\s*日?"
	+ "(?:\\s*[（(]\\s*周?[一二三四五六日天]\\s*[）)])?"
	+ "(?:\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2}))?";
const ns_miyoushe_VER_SRC = "(\\d{1,2}\\.\\d{1,2})\\s*版本(更新后|结束)";
const ns_miyoushe_BARE_SRC = "(\\d{1,2})\\s*[.\\/]\\s*(\\d{1,2})\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2})";
const ns_miyoushe_OPEN_SRC = "即日起";
const ns_miyoushe_TOKEN_RE = new RegExp([ns_miyoushe_ABS_SRC, ns_miyoushe_VER_SRC, ns_miyoushe_BARE_SRC, ns_miyoushe_OPEN_SRC].join("|"), "g");
// 两个日期之间只允许"连接符"（可带空白）。**故意不允许空串**：避免把相邻但无关的日期配成窗口。
const ns_miyoushe_CONNECTOR_RE = /^\s*[~～〜〰\-–—－至到]\s*$/;

function ns_miyoushe_tokenizeMiyoushe(s) {
	const toks = [];
	ns_miyoushe_TOKEN_RE.lastIndex = 0;
	let m;
	while ((m = ns_miyoushe_TOKEN_RE.exec(s)) !== null) {
		if (m[0] === "") { ns_miyoushe_TOKEN_RE.lastIndex++; continue; }
		const start = m.index, end = m.index + m[0].length;
		if (m[1] != null) {
			toks.push({ kind: "abs", start, end, y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null, ver: null });
		} else if (m[6] != null) {
			toks.push({ kind: "ver", start, end, ver: m[6], verKind: m[7] });
		} else if (m[8] != null) {
			toks.push({ kind: "bare", start, end, y: null, mo: +m[8], d: +m[9], h: +m[10], mi: +m[11] });
		} else {
			toks.push({ kind: "open", start, end });
		}
	}
	return toks;
}

/**
 * 从一段公告正文（HTML 或纯文本）里抽出所有「起 ~ 止」档期。
 * @param {string} text 详情正文（HTML 会先 textOf 去标签；已是纯文本也安全）
 * @param {string} tz 源站墙钟时区
 * @param {{hintTs?:number, verStarts?:Record<string,number>}} opts
 *        hintTs = 公告发布时刻（**无年份**日期的年份来源 + `即日起` 的起点）
 *        verStarts = `X.Y版本更新后` 的版本锚点表（见 ns_miyoushe_miyousheVersionStarts）
 * @returns {Array<{startTs:number,endTs:number,raw:string,at:number,inferred:boolean,note:string}>}
 */
function ns_miyoushe_collectMiyousheWindows(text, tz = ns_miyoushe_MIYOUSHE_TZ, opts = {}) {
	const html = String(text == null ? "" : text);
	const s = /<[a-z!/]/i.test(html) ? textOf(html) : html;
	const hintTs = opts.hintTs != null && Number.isFinite(opts.hintTs) ? opts.hintTs : null;
	const verStarts = opts.verStarts || {};
	const hint = hintTs != null ? sourceWallParts(hintTs, tz) : null;
	const toks = ns_miyoushe_tokenizeMiyoushe(s);

	// 起点令牌 → 绝对时刻
	const startOf = (info) => {
		if (info.kind === "abs") {
			let ts = sourceInstant(info.y, info.mo, info.d, info.h == null ? 0 : info.h, info.mi == null ? 0 : info.mi, tz);
			if (info.ver) {
				// `2026/09/28 4.6版本更新后` → 用版本更新公告时刻（更准）；锚点缺失才退回字面日期 00:00
				const v = ns_miyoushe_resolveVersionAnchor(info.ver, info.verKind || "更新后", verStarts);
				if (v != null) ts = v;
			}
			return ts;
		}
		if (info.kind === "bare") {
			if (!hint) return null;      // 没有公告年份可借 → 不解（不猜当前年）
			return sourceInstant(hint.y, info.mo, info.d, info.h == null ? 0 : info.h, info.mi == null ? 0 : info.mi, tz);
		}
		if (info.kind === "ver") return ns_miyoushe_resolveVersionAnchor(info.ver, info.verKind, verStarts);
		if (info.kind === "open") return hintTs;   // `即日起` → 公告发布时刻
		return null;
	};
	// 终点令牌 → 绝对时刻（无年份时按起点年，月日更早则进一年）
	const endOf = (info, startTs) => {
		if (info.kind === "ver") return ns_miyoushe_resolveVersionAnchor(info.ver, info.verKind, verStarts);
		if (info.kind === "open") return null;
		const h = info.h == null ? 23 : info.h, mi = info.mi == null ? 59 : info.mi;
		let y = info.y;
		if (y == null) {
			const sw = sourceWallParts(startTs, tz);
			y = sw.y;
			if (info.mo < sw.mo || (info.mo === sw.mo && info.d < sw.d)) y += 1;
		}
		return sourceInstant(y, info.mo, info.d, h, mi, tz);
	};

	const byKey = new Map();
	// 去重键用**时间区间**而不是 raw 文本：同一段区间在正文里常有"全写"与"只写版本锚点"两种形态
	// （实测星铁：`2026/09/28 4.6版本更新后 ~ …` 与 `4.6版本更新后 ~ …` 是同一段），
	// 只按 raw 去重会重复列出。保留 raw 更长的那条（信息更全），插入顺序即文档顺序。
	const addWindow = (w) => {
		const key = w.startTs + "|" + w.endTs;
		const prev = byKey.get(key);
		if (!prev) { byKey.set(key, w); return; }
		if (w.raw.length > prev.raw.length) {
			prev.raw = w.raw;
			prev.at = w.at;
			prev.inferred = w.inferred;
			prev.note = w.note;
		}
	};
	let i = 0;
	while (i < toks.length) {
		const a = toks[i];
		const info = { kind: a.kind, y: a.y, mo: a.mo, d: a.d, h: a.h, mi: a.mi, ver: a.ver, verKind: a.verKind };
		let aEnd = a.end;
		let j = i + 1;
		// 紧贴的 `YYYY/MM/DD` + `X.Y版本更新后`（中间只有空白）= 同一个起点
		if (a.kind === "abs" && a.h == null && toks[j] && toks[j].kind === "ver" && /^\s*$/.test(s.slice(a.end, toks[j].start))) {
			info.ver = toks[j].ver;
			info.verKind = toks[j].verKind;
			aEnd = toks[j].end;
			j++;
		}
		const b = toks[j];
		i++;
		if (!b) continue;
		if (!ns_miyoushe_CONNECTOR_RE.test(s.slice(aEnd, b.start))) continue;
		if (b.kind !== "abs" && b.kind !== "bare" && b.kind !== "ver") continue;

		const st = startOf(info);
		if (st == null) continue;
		const en = endOf(b, st);
		if (en == null || !(en > st)) continue;
		const raw = s.slice(a.start, b.end).replace(/\s+/g, " ").trim();
		const inferredVer = info.kind === "ver" || (info.kind === "abs" && !!info.ver);
		addWindow({
			startTs: st,
			endTs: en,
			raw,
			at: a.start,
			inferred: info.kind === "open" || inferredVer,
			note: info.kind === "open" ? "起点「即日起」＝取公告发布时刻"
				: inferredVer ? "起点「版本更新后」＝取该版本更新公告的发布时刻"
					: ""
		});
	}
	return [...byKey.values()];
}

// 当期 = 文档顺序里**第一条覆盖 now** 的窗口；没有就是没有（不退回过期档期）
function ns_miyoushe_pickMiyousheWindow(windows, now) {
	for (const w of windows || []) if (w.startTs <= now && w.endTs >= now) return w;
	return null;
}

// 卡池名册：优先只看"首个档期之前"的引言（那才是本期名单），引言里没有才退回全文。
// 例：星铁跃迁引言 → 「真珠」；绝区零频段引言没有名单 → 全文取「洛克茜、普罗米娅」。
const ns_miyoushe_ROLE_RE = /限定\s*(?:[5S]\s*[星级])?\s*(?:角色|代理人|女武神)\s*[「【\[]([^」】\]]+)[」】\]]/g;
function ns_miyoushe_extractRoles(s) {
	const names = [];
	ns_miyoushe_ROLE_RE.lastIndex = 0;
	let m;
	while ((m = ns_miyoushe_ROLE_RE.exec(s)) !== null) {
		const n = m[1].replace(/[（(].*$/, "").trim();
		if (n && !names.includes(n)) names.push(n);
		if (names.length >= 6) break;
	}
	return names.join("、");
}
function ns_miyoushe_miyousheRoles(text, stopAt = null) {
	const s = String(text == null ? "" : text);
	const plain = /<[a-z!/]/i.test(s) ? textOf(s) : s;
	const head = stopAt != null && stopAt > 0 ? plain.slice(0, stopAt) : "";
	return (head ? ns_miyoushe_extractRoles(head) : "") || ns_miyoushe_extractRoles(plain);
}
//#endregion

//#region 抓取
const ns_miyoushe_sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 源站原文（`bannerDatesRaw` / `eventDatesRaw` 用）。
// ⚠️ 这两个字段**会被 UI 的默认两行式直接显示**（面板取 `bannerDatesRaw || bannerDates`、
//    `eventDatesRaw || eventDates`）—— 所以它们**只能放档期文本本身**，
//    绝不能夹带「这来自哪个字段」之类的说明（用户 2026-10-03：「元信息彻底删掉」）。
//    旧实现在 news_meta 兜底时返回 `news_meta 档期（源站显式字段，非正文）：…`，
//    一旦兜底路径触发，这句话就会原样出现在面板上 —— 已修。
//    「本窗口来自 news_meta 兜底」这一事实保留在 `p.source`（不显示）+ 代码注释里。
function ns_miyoushe_rawOf(p, tz) {
	if (p.source === "news_meta") return fmtWindow(p.startTs, p.endTs, tz);
	return p.raw;
}

// ── 悬停条目 ──────────────────────────────────────────────────────────────────
// 排版交给 lib/env.js 的 `hoverPool` / `hoverEvent`（与本体 buildPoolHover / buildEventHover 逐字一致）。
// 用户 2026-10-03：「悬停里的元信息彻底删掉」→ 这里**只**产出名称与档期，别的一概不传。
// 池名与本体 `banner：roles` 同构：有角色名 →「池名：角色」，没有 → 只写池名。
const ns_miyoushe_hoverPoolName = (w) => (w.roles ? `${w.subject}：${w.roles}` : w.subject);
// 活动悬停顺序：结束时间升序（无/未知结束排在最后），并列再按开始时间 —— 与 lib/env.js 内部规则一致
function ns_miyoushe_byEndTs(a, b) {
	const ea = a.endTs == null ? Infinity : a.endTs;
	const eb = b.endTs == null ? Infinity : b.endTs;
	if (ea !== eb) return ea - eb;
	const sa = a.startTs == null ? Infinity : a.startTs;
	const sb = b.startTs == null ? Infinity : b.startTs;
	return sa - sb;
}
// `raw` 只在"缺起止"时才会被 hoverEvent 印出来；news_meta 兜底行的 raw 是内部字段说明
// （`start_at_sec=…`）→ 不给它，免得内部字段名有机会漏进悬停。
const ns_miyoushe_hoverRaw = (w) => (w.source === "news_meta" ? "" : w.raw);

// 列表 → 候选 → 逐篇详情 → 抽档期。返回值可能是 null（未公布）；结构性损坏直接抛。
async function ns_miyoushe_collectMiyousheSide(listUrl, signal, tz, now, want) {
	const listJson = await fetchJson(listUrl, { signal, mode: "proxy", referer: ns_miyoushe_MIYOUSHE_REFERER });
	const items = ns_miyoushe_parseMiyousheList(listJson);
	if (items.length === 0) return null;                       // 实测 gids=99999 → retcode 0 + 空 list
	const verStarts = ns_miyoushe_miyousheVersionStarts(items);
	const cands = items
		.filter((it) => ns_miyoushe_classifyMiyousheTitle(it.subject) === want)
		.sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0))
		.slice(0, ns_miyoushe_MIYOUSHE_MAX_DETAILS);
	if (cands.length === 0) return null;                       // 该列表里没有本侧公告

	const covering = [];
	let okCount = 0, firstHardErr = null;
	for (let idx = 0; idx < cands.length; idx++) {
		if (idx > 0 && ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS > 0) await ns_miyoushe_sleep(ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS);
		const it = cands[idx];
		let d;
		try {
			d = ns_miyoushe_parseMiyousheDetail(await fetchJson(ns_miyoushe_miyousheDetailUrl(it.postId), { signal, mode: "proxy", referer: ns_miyoushe_MIYOUSHE_REFERER }));
		} catch (e) {
			if (!ns_miyoushe_isMiyousheMissing(e) && !firstHardErr) firstHardErr = e;
			continue;
		}
		okCount++;
		const hintTs = d.createdTs != null ? d.createdTs : it.createdTs;
		const wins = ns_miyoushe_collectMiyousheWindows(d.content, tz, { hintTs, verStarts });
		const roles = ns_miyoushe_miyousheRoles(d.content, wins.length ? wins[0].at : null);
		for (const w of wins) {
			w.subject = d.subject || it.subject;
			w.postId = d.postId;
			w.roles = roles;
			w.source = "content";
			// 候选已按 created_at 倒序、窗口按文档顺序 → covering[0] 就是"最新一篇公告里的第一条当期窗口"
			if (w.startTs <= now && w.endTs >= now) covering.push(w);
		}
	}
	// 一篇正文都没拿到、且出现过硬错（403/567/坏 JSON）→ 抛出去，让界面显示"抓取失败"
	// 而不是把封禁静默成"未公布"。全是"post not exist"（1101/1102）则不算失败 → null。
	if (okCount === 0) {
		if (firstHardErr) throw firstHardErr;
		return null;
	}
	// 兜底：正文一个覆盖 now 的窗口都抽不到时，退回源站**显式**字段 news_meta（只有 type=2 列表有）。
	// 口径与正文可能不同（实测原神的 end 是开奖时刻）→ 悬停/raw 里**标明来源**，不冒充正文。
	if (covering.length === 0) {
		for (const it of cands) {
			const nm = it.newsMeta;
			if (!nm || !(nm.startTs <= now && nm.endTs >= now)) continue;
			covering.push({
				startTs: nm.startTs, endTs: nm.endTs,
				// ⚠️ 不留「news_meta start_at_sec=… end_at_sec=…」这种内部字段说明：内部字段名不进数据
				//    （`eventDatesRaw` 的溯源说明由 ns_miyoushe_rawOf 统一给；悬停由 ns_miyoushe_hoverRaw 屏蔽）
				raw: fmtWindow(nm.startTs, nm.endTs, tz),
				subject: it.subject, postId: it.postId, roles: "",
				inferred: false, note: "", source: "news_meta", status: nm.status
			});
		}
	}
	if (covering.length === 0) return null;                    // 抓到正文但没有覆盖 now 的档期 = 未公布
	return { primary: covering[0], covering };
}

/** 卡池侧（type=1 公告/补给；标题按卡池关键词分流） */
async function ns_miyoushe_gachaMiyoushe(url, signal, tz = ns_miyoushe_MIYOUSHE_TZ, now = Date.now()) {
	const listUrl = url || ns_miyoushe_miyousheListUrl(ns_miyoushe_MIYOUSHE_GIDS.bh3, ns_miyoushe_MIYOUSHE_TYPES.GACHA);
	const r = await ns_miyoushe_collectMiyousheSide(listUrl, signal, tz, now, "gacha");
	if (!r) return null;
	const p = r.primary;
	// 悬停 = 全部当期池，每池「池名：角色」一行 + 档期（排版交给共用工具 hoverPool，≥2 池才有内容）。
	// 只有 1 个当期池 → "" → **不设** bannerHover，由 UI 走默认两行式「banner ⏎ bannerDates」。
	const bannerHover = hoverPool(r.covering.map((w) => ({
		name: w.subject,
		label: ns_miyoushe_hoverPoolName(w),
		startTs: w.startTs,
		endTs: w.endTs,
		raw: ns_miyoushe_hoverRaw(w)
	})), tz);
	return {
		banner: p.subject,
		roles: p.roles || "",
		bannerDates: fmtWindow(p.startTs, p.endTs, tz),
		bannerDatesRaw: ns_miyoushe_rawOf(p, tz),
		startTs: p.startTs,
		endTs: p.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

/** 活动侧（type=2 活动；标题按活动关键词分流） */
async function ns_miyoushe_eventsMiyoushe(url, signal, tz = ns_miyoushe_MIYOUSHE_TZ, now = Date.now()) {
	const listUrl = url || ns_miyoushe_miyousheListUrl(ns_miyoushe_MIYOUSHE_GIDS.bh3, ns_miyoushe_MIYOUSHE_TYPES.EVENT);
	const r = await ns_miyoushe_collectMiyousheSide(listUrl, signal, tz, now, "event");
	if (!r) return null;
	const p = r.primary;
	// 悬停 = 全部当期活动，结束时间升序逐行「名称 + 3 空格 + 档期」
	// （排版交给共用工具 hoverEvent；它自己**不排序** → 这里先排好再传）。
	// 只有 1 条 → "" → **不设** eventHover，由 UI 走默认两行式「event ⏎ eventDates」。
	const eventHover = hoverEvent(r.covering.slice().sort(ns_miyoushe_byEndTs).map((w) => ({
		name: w.subject,
		startTs: w.startTs,
		endTs: w.endTs,
		raw: ns_miyoushe_hoverRaw(w)
	})), tz);
	return {
		event: p.subject,
		eventDates: fmtWindow(p.startTs, p.endTs, tz),
		eventDatesRaw: ns_miyoushe_rawOf(p, tz),
		...(eventHover ? { eventHover } : {})
	};
}
//#endregion

		// ===== 内联自 next-sources/parsers/umamusume-official.js（模块级标识符已加 ns_umamusume-official_ 前缀）=====

// next-sources/parsers/umamusume-official.js —— 赛马娘 **官方公告**（日服 umamusume.jp + 国际服 umamusume.com）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null
//   卡池侧 { banner, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//   活动侧 { event, eventDates, eventDatesRaw?, eventHover? }
//   null = 未公布（抓到了公告，但没有覆盖 now 的档期）；只有结构性损坏才 throw。
//   `bannerHover` / `eventHover` 只在**当期 ≥2 条**时出现（`hoverPool` / `hoverEvent` 返回空串 → 本文件不设该字段），
//   否则交回 UI 的默认单条两行式；内容只有「名称 + 档期」，**不含任何元信息**（见 `ns_umamusume_official_umaCurrentItems` 的说明）。
//
// ── 与既有源的关系（**并存，不替换**）────────────────────────────────────────
//   · 日服：既有 `parsers/umapyoi.js`（第三方 api.umapyoi.net，只有"卡级获取窗口"、无卡池名）
//     与本文件的 `uma-jp-official`（官网公告，有卡池名 + 完整活动/卡池文案）**并存**。
//   · 国际服：既有 `parsers/bwiki.js` 的 `eventsUmaJp` / `gachaUmaCn`（bwiki 表格，简中服）
//     与本文件的 `uma-global`（**国际服官方公告**）**并存**。谁是主源由 Lead 决定，本文件不擅自替换。
//
// ── 实测形态（2026-10-02 夹具，见 fixtures/p5-uma-*）─────────────────────────
// 日服（TZ = Asia/Tokyo，源站即日服官网）：
//   GET  /api/ajax/pr_info_index?format=json&page=<N>
//        → { response_code: 1, information_list: [{ announce_id, title, message, post_at, update_at,
//            announce_label, image, og_image, post_platform_flag }], total_page_count: 32 }
//        实测 page=1 → 10 条（**分页参数只有 `page` 有效**；p / page_no / limit / size 实测全无效），
//        total_page_count=32（page=2 同样 10 条，已抓夹具 p5-uma-jp-index-p2）。
//   GET  /api/ajax/pr_info_detail?format=json&announce_id=<id>
//        → { response_code: 1, detail: { announce_id, title, message, from_date, to_date, post_at, … } }
// 国际服（TZ = **UTC**，与日服不同；post_at 实测是 UTC，如 "2026-09-28 22:00:00" = 15:00 PDT）：
//   POST /api/ajax/pr_info_index?format=json   body {"announce_label":1,"limit":50,"offset":0}
//        → { response_code: 1, information_list: [ … 50 条 … ], show_more_button: 1 }
//        ⚠️ **必须 POST**：GET / 空 body → `{"response_code":102}`（实测）；只有 1 才是成功。
//        announce_label：1=Game / 0=All / 3=Media（本解析器只用 1）。
//   POST /api/ajax/pr_info_detail?format=json  body {"announce_id":<id>}
//
// ── ⚠️ 最重要的一条实测纠正：「档期不在 from_date/to_date 里」────────────────
//   `detail.from_date` / `detail.to_date` 是**该公告的展示/失效期**，不是卡池/活动档期：
//     日服 3470：from=2026-10-01 to=2027-01-31，而正文写「開催期間 10/1 12:00 ～ 11/2 11:59」；
//     日服 3477（进化技能追加，其实没有活动期）：from=10-01 to=**2027-01-31**（同批公告共用同一 to_date）；
//     国际服所有详情：to_date 一律 `2026-12-31 23:59:59`（年终哨兵）——连"问题修复"公告也是。
//   → 真正的档期只在 `detail.message` 正文里，且**日文正文还有第二段小期间**
//     （3472 的「販売期間 9/30 12:00 ～ 10/13 4:59」），所以**绝不能**拿 from/to 当档期，
//     否则会把"整批公告的展示期"当成卡池期，`bannerDates` 会是错的（这条是本文件存在的理由）。
//   本解析器因此：① 先从正文抽日期区间（统一 tokenizer，日文/英文共用）；
//                 ② 只有正文里**完全抽不到**区间时，才退化为 from_date ~ to_date
//                    （退化事实标在 `windows[].label` / `source="fallback"` 上，**供测试与排障**，
//                     绝不写进 hover —— 用户 2026-10-03 要求悬停里元信息彻底删掉）；
//                 ③ 外显取"覆盖 now 且开始最晚"的那条区间；一条都不覆盖 now → 返回 null。
//
// ── 分类（靠标题关键词，源站没有分类字段）──────────────────────────────────
//   日服：`ガチャ` → 卡池；`イベント` / `キャンペーン` → 活动。
//   国际服：scout / recruit / gacha / spotlight / pickup / banner → 卡池；
//            event / campaign / celebration / story → 活动；卡池优先。
//
// ── 传输：POST 只能自己封装（lib/env.js 的 fetchText/fetchJson 只支持 GET）────
//   走宿主同源代理 `/api/gacha-calendar-proxy`：代理读**请求体**并透传
//   （src/index.js proxyHandler：`method = body !== "" ? "POST" : "GET"`），
//   所以 POST 的最小形态是 `fetch(proxyUrl, { method:"POST", body: JSON.stringify(payload) })`。
//   ⚠️ 实测（2026-10-02）两个域名响应都**没有 ACAO**（CloudFront `Vary: Origin` 但不回 ACAO）
//   → 只能是 mode="proxy"；但 `umamusume.jp` / `umamusume.com` **不在** src/index.js 的
//   PROXY_ALLOW_HOSTS 白名单里 → 代理会回 403 `host not allowed`（本批次只写 next-sources/，
//   已上报 Lead 加白名单，未擅自改插件本体）。


// ── URL / 时区常量 ──
const ns_umamusume_official_UMA_JP_INDEX_URL = "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1";
const ns_umamusume_official_UMA_JP_DETAIL_URL = "https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=";
const ns_umamusume_official_UMA_JP_TZ = "Asia/Tokyo";
const ns_umamusume_official_UMA_GLOBAL_INDEX_URL = "https://umamusume.com/api/ajax/pr_info_index?format=json";
const ns_umamusume_official_UMA_GLOBAL_DETAIL_URL = "https://umamusume.com/api/ajax/pr_info_detail?format=json";
const ns_umamusume_official_UMA_GLOBAL_TZ = "UTC";                  // 实测：post_at 为 UTC（日服为 JST，两者不同）
const ns_umamusume_official_UMA_GLOBAL_LABEL_GAME = 1;              // 1=Game / 0=All / 3=Media

/** 每侧最多抓这么多条详情（列表每条候选一次请求，每个列表页最多 6 条候选） */
const ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS = 12;
/** 列表翻页上限（page=1 通常就够；只在第一页没找到覆盖 now 的档期时才翻页） */
const ns_umamusume_official_UMA_DEFAULT_MAX_PAGES = 3;
/** 每页候选（分类命中）上限 */
const ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE = 6;

// ── 分类关键词 ──
const ns_umamusume_official_JP_GACHA_RE = /ガチャ/;
const ns_umamusume_official_JP_EVENT_RE = /イベント|キャンペーン/;
const ns_umamusume_official_GL_GACHA_RE = /scout|recruit|gacha|spotlight|pickup|pick-?up|banner/i;
const ns_umamusume_official_GL_EVENT_RE = /event|campaign|celebration|story/i;

/**
 * 标题分流：返回 "gacha" | "event" | null（null = 与卡池/活动都无关，如「不具合」「功能更新」）。
 * mode="jp" 用日文关键词，mode="global" 用英文关键词；卡池优先于活动。
 */
function ns_umamusume_official_classifyUmaTitle(title, mode = "jp") {
	const t = String(title == null ? "" : title);
	const gacha = mode === "global" ? ns_umamusume_official_GL_GACHA_RE : ns_umamusume_official_JP_GACHA_RE;
	const event = mode === "global" ? ns_umamusume_official_GL_EVENT_RE : ns_umamusume_official_JP_EVENT_RE;
	if (gacha.test(t)) return "gacha";
	if (event.test(t)) return "event";
	return null;
}

// ── 日期区间 tokenizer（日文 / 英文共用）────────────────────────────────────
// 为什么用 tokenizer 而不是一条大正则：正文明日混杂、年份可省、时刻可省、
// 12 小时制的 am/pm 在月日之后、范围符有 `～`/`〜`/`-`/`–` 多种。
// ⚠️ 全部用具名捕获组。早期版本用 $n 下标（`endate` 里嵌了 `(Jan|…)` 与年份组），
//    导致后续下标整体错位（实测 `g[7].slice` 直接 TypeError）→ 换具名组。
const ns_umamusume_official_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ns_umamusume_official_AMPM = String.raw`(?:a\.?\s?m\.?|p\.?\s?m\.?)`;
const ns_umamusume_official_TOKEN_RE = new RegExp([
	// 日文：2026年10月1日 / 10月1日（"日"必带）
	String.raw`(?<jpdate>(?:(?<y1>\d{4})\s*年\s*)?(?<mo1>\d{1,2})\s*月\s*(?<d1>\d{1,2})\s*日)`,
	// 英文：Sep 28 / September 28, 2026（年份只在**同一段**里粘着才吃，所以 `,?\s*` 里不含 `<`）
	String.raw`(?<endate>\b(?<mon>Jan|Feb|Mar|Apr|May|Jun|Jul|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(?<d3>\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(?<y3>\d{4}))?)`,
	// 数字：2026/10/1 2026-10-01 10/1
	// ⚠️ 分隔符两侧**不能**用 `\b`（`/` `-` 是 non-word，`/\b\d/` 永不成立 → 实测整条 numdate 全不匹配）
	//    → 用数字边界 `(?<!\d)` / `(?!\d)`。`.` 形式必须两侧都有点（`10.1`）。
	String.raw`(?<numdate>(?<![\d\/\-.])(?:(?<y4>\d{4})[\/\-](?<mo4>\d{1,2})[\/\-](?<d4>\d{1,2})|(?<mo5>\d{1,2})[\/\-](?<d5>\d{1,2})|\.(?<mo6>\d{1,2})\.(?<d6>\d{1,2}))(?![\d\/\-.]))`,
	// 裸 4 位年份（英文写法把年份写在末尾：`Oct 12, 2026`）；不能用 `\b`（见上）
	String.raw`(?<yearonly>(?<![\d\/\-.])\d{4}(?![\d\/\-.]))`,
	// 时刻：10:00 / 9:59 + 可选 am/pm（`\b` 在 `:` 右侧不成立，左侧只用数字边界）
	String.raw`(?<time>(?<!\d)(?<hh>\d{1,2}):(?<mm>\d{2})(?!\d)(?:\s*(?<ampm>${ns_umamusume_official_AMPM}))?)`,
	// 范围符：必须是**独立 token**（早期版本漏了这一支 → `～` 不产生 token，窗口永远配不上，
	// 实测症状是所有详情都退化成 from_date～to_date）。
	//   · `～〜〰` 与 en/em dash：直接认（英文原文 `Sep 28–9:59 p.m.` 前面紧贴数字，不能加"前后非数字"断言）
	//   · 半角 `-`：只认两侧带空白的（`2026-10-01` 里紧贴数字的连字符绝不能被当范围符）
	String.raw`(?<sep>[~～〜〰–—]|(?<![\d\w])\s+-\s+(?![\d\w]))`
].join("|"), "g");

/** 文本 → token 流：[{k:"d"|"t"|"y"|"s", …, at, end}] */
function ns_umamusume_official_tokenizeUma(text) {
	const s = String(text == null ? "" : text);
	ns_umamusume_official_TOKEN_RE.lastIndex = 0;
	const toks = [];
	let m;
	while ((m = ns_umamusume_official_TOKEN_RE.exec(s)) !== null) {
		if (m[0] === "") { ns_umamusume_official_TOKEN_RE.lastIndex++; continue; }
		const g = m.groups || {};
		const at = m.index, end = m.index + m[0].length;
		if (g.jpdate) {
			toks.push({ k: "d", y: g.y1 ? +g.y1 : null, mo: +g.mo1, d: +g.d1, at, end });
		} else if (g.endate) {
			toks.push({ k: "d", y: g.y3 ? +g.y3 : null, mo: ns_umamusume_official_MONTHS[g.mon.slice(0, 3).toLowerCase()] || null, d: +g.d3, at, end });
		} else if (g.numdate) {
			toks.push(g.y4
				? { k: "d", y: +g.y4, mo: +g.mo4, d: +g.d4, at, end }
				: { k: "d", y: null, mo: +(g.mo5 != null ? g.mo5 : g.mo6), d: +(g.d5 != null ? g.d5 : g.d6), at, end });
		} else if (g.yearonly) {
			toks.push({ k: "y", y: +g.yearonly, at, end });
		} else if (g.time) {
			let h = +g.hh;
			const mi = +g.mm;
			const ap = String(g.ampm || "").replace(/[.\s]/g, "").toLowerCase();
			if (ap.startsWith("p") && h < 12) h += 12;
			if (ap.startsWith("a") && h === 12) h = 0;
			toks.push({ k: "t", h, mi, at, end });
		} else if (g.sep) {
			toks.push({ k: "s", at, end });
		}
	}
	return toks;
}
/** 调试用（测试可直接断言 token 流） */
function ns_umamusume_official_debugUmaTokens(text) { return ns_umamusume_official_tokenizeUma(text); }

// ── 档期区间的"标板"（plate）正则 ───────────────────────────────────────────
// 走「正则切候选串 → tokenizer 解释」两条腿：位置运算交给正则引擎，避免手工下标。
// ⚠️ 本文件早期版本在同一个 token 数组上手写 `j`/`firstSepIdx` 双重游标，实测出现
//    `j=4 但 seq=["d:11/2"]`（范围符凭空消失）这种自相矛盾状态，最后定位为下标耦合错误。
//    改成正则标板后，从结构上不可能再出现"范围符没被收进 seq"的情况。
const ns_umamusume_official_F_DATE = String.raw`(?:(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|(?:\d{4}[\/\-])?\d{1,2}[\/\-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?)`;
const ns_umamusume_official_F_TIME = String.raw`(?:\d{1,2}:\d{2}(?:\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))?)`;
const ns_umamusume_official_F_SEP = String.raw`(?:[~～〜〰–—]|\s-\s)`;
const ns_umamusume_official_F_ATOM = String.raw`(?:(?:${ns_umamusume_official_F_TIME}\s*,?\s*)?${ns_umamusume_official_F_DATE}(?:\s*,?\s*${ns_umamusume_official_F_TIME})?(?:\s*,?\s*\d{4})?|${ns_umamusume_official_F_TIME})`;
/** 用于"抹掉上下文里的日期/时刻"（取 label 时），以及定位相邻区间 */
const ns_umamusume_official_DATE_TIME_SPAN_RE = new RegExp(String.raw`${ns_umamusume_official_F_ATOM}|${ns_umamusume_official_F_TIME}\s*,`, "g");
const ns_umamusume_official_RANGE_PLATES = [
	new RegExp(String.raw`${ns_umamusume_official_F_ATOM}\s*${ns_umamusume_official_F_SEP}\s*${ns_umamusume_official_F_ATOM}`, "g"),
	// 兜底写法：「…10/1 12:00から11/2 11:59まで」（没有范围符，用「から」）
	/(?:(?:\d{1,2}[\/\-]\d{1,2})\s*\d{1,2}:\d{2}[^\d]{0,8}から[^\d]{0,8}(?:\d{1,2}[\/\-]\d{1,2})\s*\d{1,2}:\d{2})/g
];

/** 从正文里切出所有"日期[时刻] 范围符 日期[时刻]"候选串（含位置，供 label 取上下文）；去重叠 */
function ns_umamusume_official_extractUmaRangePlates(s) {
	const text = String(s == null ? "" : s);
	const found = [];
	for (const re of ns_umamusume_official_RANGE_PLATES) {
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(text)) !== null) {
			if (m[0] === "") { re.lastIndex++; continue; }
			found.push({ text: m[0], at: m.index });
		}
	}
	found.sort((a, b) => (a.at - b.at) || (b.text.length - a.text.length));
	const picked = [];
	for (const f of found) {
		if (picked.some((p) => f.at < p.at + p.text.length && p.at < f.at + f.text.length)) continue;
		picked.push(f);
	}
	return picked;
}

/**
 * 标签清洗（从"范围起点之前"的正文里取短标签，如「イベント開催期間」「Spotlight Scout Availability Period」）。
 *
 * ⚠️ 踩过的两个坑，顺序不能反：
 *   ① **先切段再去标签**会切在标签属性里（`<h2 class="heading">` 的最后一个 `>` 落在属性引号里）
 *      → 必须先 `strip tags`，再按句读/换行切段；
 *   ② 不能停在句读/"！"上取整段：日文长公告里"上一段正文 + 下一段标题"中间是句号
 *      （`…開催中です！ イベント開催期間 9/30 …`）→ 段内还有正文。所以段内再取
 *      **最后一个全角空格后的片段**（日文标题与正文之间正是全角空格），并把空白折叠成 `·`。
 *   最后掐掉段首引导词（`As of` / `until` / `まで`）与段尾连接词（`from` / `（UTC）`）。
 */
const ns_umamusume_official_LABEL_LEAD_RE = /^(?:as of|from|until|till|on|at|the|period|期間|日時)\s*[:：]?\s*/i;
const ns_umamusume_official_LABEL_TAIL_RE = /[\s（(]*(?:from|to|until|till|at|on|まで|から|より|以降|以前)[\s（()）]*$/i;
function ns_umamusume_official_labelBeforeUma(text, at) {
	const head = String(text == null ? "" : text).slice(Math.max(0, at - 180), at);
	const plain = head.replace(/<[^>]*>/g, " ").replace(ns_umamusume_official_DATE_TIME_SPAN_RE, " ");
	// ⚠️ 切段对象必须**先掐掉尾部空白**：`…Period</h2>\n ` 去标签后是 `…Period \n `，
	//    直接按最后一个 `\n` 切会只剩一个空格 → 标签全空（实测英文标签就是这么丢的）
	const trimmed = plain.replace(/\s+$/, "");
	const cut = Math.max(trimmed.lastIndexOf("\n"), trimmed.lastIndexOf("。"), trimmed.lastIndexOf("！"), trimmed.lastIndexOf("!"));
	const seg = trimmed.slice(cut >= 0 ? cut + 1 : 0);
	// 段内取最后一个全角空格后的片段（仅当该空格前面出现 CJK 时；否则英文标题会被切碎）
	const zs = seg.lastIndexOf("\u3000");
	const tail = zs >= 0 && /[぀-ヿ一-鿿]/.test(seg.slice(0, zs)) ? seg.slice(zs + 1) : seg;
	let x = tail.replace(/\s+/g, "·").trim();
	// ⚠️ 两端只能用**字符类**裁剪：`(?:connector)?\s*$` 这种"可选+空白"的正则会把整段吃掉
	//    （实测 `…Availability Period` 被整段删除，因为可选组匹配空 + `\s*$` 匹配了结尾）
	x = x.replace(/^[·\s■・:：、,，\-–—]+/, "").replace(/[·\s,、，■・:：–—-]+$/, "");
	x = x.replace(ns_umamusume_official_LABEL_LEAD_RE, "").replace(ns_umamusume_official_LABEL_TAIL_RE, "");
	x = x.replace(/^&nbsp;|^[·・]+/i, "").replace(/[·\s,、，■・:：–—&-]+$/i, "").trim();
	if (x.length > 40) x = x.slice(-40).trim();
	return x;
}

/**
 * 正文 → 档期窗口数组 [{ startTs, endTs, raw, label }]（按出现顺序，按绝对区间去重）。
 * tz = 源站墙钟时区；hintTs = 该公告 post_at 换算出的绝对时刻（用于补年份）。
 *
 * 两种语序都要吃（实测两种都存在）：
 *   日文 `開催期間 10/1 12:00 ～ 11/2 11:59`                        → [d,t] ～ [d,t]
 *   英文 `Period 10:00 p.m., Sep 28–9:59 p.m., Oct 12, 2026 (UTC)` → [t,d] ～ [t,d]，年份在末段末尾
 */
function ns_umamusume_official_parseUmaWindows(text, tz, hintTs = null) {
	const s = String(text == null ? "" : text);
	const hintParts = hintTs != null && Number.isFinite(hintTs) ? sourceWallParts(hintTs, tz) : null;
	const hintYear = hintParts ? hintParts.y : new Date().getFullYear();
	const out = [];
	const seen = new Set();

	for (const plate of ns_umamusume_official_extractUmaRangePlates(s)) {
		const toks = ns_umamusume_official_tokenizeUma(plate.text);
		const sepIdx = toks.findIndex((t) => t.k === "s");
		if (sepIdx < 0) continue;
		const left = toks.slice(0, sepIdx);
		const right = toks.slice(sepIdx + 1);
		const startDate = left.find((t) => t.k === "d") || null;
		const startTime = left.find((t) => t.k === "t") || null;
		const endDate = right.find((t) => t.k === "d") || null;
		const endTime = right.find((t) => t.k === "t") || null;
		if (!startDate || (!endDate && !endTime)) continue;

		const y1 = startDate.y != null ? startDate.y : hintYear;
		let y2, mo2, d2;
		if (endDate) {
			mo2 = endDate.mo || startDate.mo;
			d2 = endDate.d;
			const ey = endDate.y != null ? endDate.y : (right.find((t) => t.k === "y") || {}).y;
			y2 = ey != null ? ey : y1;
			// 跨年：末段月日比起点早且没写年份 → +1 年
			if (ey == null && (mo2 < startDate.mo || (mo2 === startDate.mo && d2 < startDate.d))) y2 = y1 + 1;
		} else {
			mo2 = startDate.mo; d2 = startDate.d; y2 = y1;
		}
		const h1 = startTime ? startTime.h : 0, mi1 = startTime ? startTime.mi : 0;
		const h2 = endTime ? endTime.h : 23, mi2 = endTime ? endTime.mi : 59;
		const startTs = sourceInstant(y1, startDate.mo, startDate.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) continue;
		const key = startTs + "|" + endTs;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ startTs, endTs, raw: plate.text.replace(/\s+/g, " ").trim(), label: ns_umamusume_official_labelBeforeUma(s, plate.at) });
	}
	return out;
}

// ── 公告条目 / 详情 ─────────────────────────────────────────────────────────
/** `"2026-10-01 12:00:00"` 这种源站墙钟 → 绝对毫秒（按 tz 解释，**不**用 Date 直接解析） */
function ns_umamusume_official_parseUmaInstant(s, tz) {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s == null ? "" : s).trim());
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

/** 列表 JSON → [{ id, title, kind, postTs, postText }]（保持源站顺序：新→旧） */
function ns_umamusume_official_parseUmaIndex(json, mode = "jp", tz = ns_umamusume_official_UMA_JP_TZ) {
	if (!json || typeof json !== "object") throw new Error("uma-bad-json");
	if (json.response_code !== 1) throw new Error("uma-bad-response:" + json.response_code);
	const list = json.information_list;
	if (!Array.isArray(list)) throw new Error("uma-bad-list");
	const out = [];
	for (const it of list) {
		if (!it || typeof it !== "object") continue;
		const id = it.announce_id;
		if (id == null) continue;
		const title = String(it.title == null ? "" : it.title).replace(/\s+/g, " ").trim();
		out.push({
			id,
			title,
			kind: ns_umamusume_official_classifyUmaTitle(title, mode),
			postTs: ns_umamusume_official_parseUmaInstant(it.post_at, tz),
			postText: it.post_at == null ? "" : String(it.post_at)
		});
	}
	return out;
}

/**
 * 详情 JSON → { id, title, windows, source, postTs, kind }。
 *   source = "body"    ：档期来自正文（正常路径）
 *   source = "fallback"：正文里一条区间都抽不到 → 退化为 from_date ~ to_date
 *                        （只在 `windows[].label` 上标注，**不进 hover**）
 *   source = "none"    ：正文与 from/to 都没有区间 → windows 为空
 */
function ns_umamusume_official_parseUmaDetail(json, tz = ns_umamusume_official_UMA_JP_TZ, classifyMode = "jp") {
	if (!json || typeof json !== "object") throw new Error("uma-bad-json");
	if (json.response_code !== 1) throw new Error("uma-bad-response:" + json.response_code);
	const d = json.detail || json.information || null;
	if (!d || typeof d !== "object") throw new Error("uma-bad-detail");
	const title = String(d.title == null ? "" : d.title).replace(/\s+/g, " ").trim();
	const postTs = ns_umamusume_official_parseUmaInstant(d.post_at, tz);
	let windows = ns_umamusume_official_parseUmaWindows(d.message, tz, postTs);
	let source = windows.length ? "body" : "none";
	if (!windows.length) {
		const fromTs = ns_umamusume_official_parseUmaInstant(d.from_date, tz);
		const toTs = ns_umamusume_official_parseUmaInstant(d.to_date, tz);
		if (fromTs != null && toTs != null && toTs > fromTs) {
			windows = [{ startTs: fromTs, endTs: toTs, raw: `${d.from_date} ～ ${d.to_date}`, label: "from_date～to_date（正文无区间，退化；**非**真实档期）" }];
			source = "fallback";
		}
	}
	return { id: d.announce_id, title: title || "", windows, source, postTs, kind: ns_umamusume_official_classifyUmaTitle(title, classifyMode) };
}

// ── 选当期 / 悬停 ───────────────────────────────────────────────────────────
/**
 * 覆盖 now 的「公告 × 窗口」对，按固定偏好排序：
 *   ① startTs 最新（并列取 endTs 更早、id 更小）；
 *   ② 并列时**预告稿排后**：日服同一档期常有两篇（`【予告】…開催決定！` + 正式 `…開催！`），
 *      实测 3469/3470 的窗口完全一样（都是 10-01 12:00 ~ 11-02 11:59）→ 否则外显会显示预告稿。
 *
 * ⚠️ 一条都不覆盖 now → 空数组（`ns_umamusume_official_pickUmaWindow` 据此返回 null = 未公布，绝不把过期/未来档期硬凑成"当期"）。
 * ⚠️ 排序**同时**服务外显与悬停：`ns_umamusume_official_pickUmaWindow` 取第 0 项当外显；`hoverEvent` 不重排 →
 *    活动悬停的第一行就是外显的那条。`hoverPool` 自带"按结束时间升序"的规则（与本体一致），会重排卡池。
 */
function ns_umamusume_official_umaCurrentWindows(entries, now) {
	const active = [];
	for (const e of entries) for (const w of e.windows) if (w.startTs <= now && w.endTs >= now) active.push({ e, w });
	if (!active.length) return [];
	const previewRank = (e) => (/予告|coming soon/i.test(String(e.title || "")) ? 1 : 0);
	active.sort((x, y) =>
		(y.w.startTs - x.w.startTs)
		|| (previewRank(x.e) - previewRank(y.e))
		|| (x.w.endTs - y.w.endTs)
		|| (x.e.id - y.e.id));
	return active;
}

/**
 * 从多个详情的窗口里选当期：覆盖 now 的窗口里取 startTs 最新（并列取 endTs 更早、id 更小）。
 * 一条都不覆盖 → **返回 null**（未公布），绝不把过期/未来档期硬凑成"当期"。
 */
function ns_umamusume_official_pickUmaWindow(entries, now) {
	return ns_umamusume_official_umaCurrentWindows(entries, now)[0] || null;
}

/**
 * 当期项（交给 `lib/env.js` 的 `hoverPool` / `hoverEvent` 排版）：**一条公告最多一项**。
 *   · `name` = 公告标题（即卡池名 / 活动名）—— 与本体的 `banner：roles` / 活动名同构；
 *     ⚠️ 官方公告**只有标题、没有"角色"字段**，所以卡池悬停的 `name` 就是 `banner` 本身
 *     （本体是 `池名：角色`，这里退化成只有池名；**不**去正文猜角色，也不补任何前缀）。
 *   · 一条公告正文可能有**多段**覆盖 now 的小期间（实测 3472 有 3 段、3481 有 2 段）→ 只取
 *     `ns_umamusume_official_umaCurrentWindows` 里该公告的**第一段**（startTs 最新、并列取 endTs 更早），
 *     否则同名活动会在悬停里重复 2~3 行（本体一律一条目一行）。
 *   · 档期交给共用工具用**源站 tz**（日服 JST / 国际服 UTC）格式化成 `MM-DD HH:MM ~ MM-DD HH:MM`。
 *
 * ⚠️ 悬停里**只放名称与档期**（用户 2026-10-03：「元信息彻底删掉」）。以下信息一律**不进悬停文本**：
 *     来源站名 / URL / API 名 · 时区推定说明 · 抓取统计（`共扫描 N 条 / 取详情 M 条`）·
 *     内部公告 id（`[3470]`）· 源站字段名标签（`開催期間` / `Event·Availability·Period`）·
 *     游戏名+区服前缀 · fallback 退化说明与任何「（…）」实现说明。
 *     这些只留在**代码注释**与 `ns_umamusume_official_parseUmaDetail` 的 `source` / `windows[].label` 字段里（供测试与排障）。
 *     ⚠️ 所以这里**不传 `label`**：`hoverPool` 会用 `label` 顶掉 `name`，而 label 正是源站字段名。
 *
 * ⚠️ 抓取策略说明（"每条候选抓一次详情、每页最多 N 条候选"）写在 `ns_umamusume_official_collectSide` 的注释里，不进悬停。
 */
function ns_umamusume_official_umaCurrentItems(entries, now) {
	const seen = new Set();
	const out = [];
	for (const { e, w } of ns_umamusume_official_umaCurrentWindows(entries, now)) {
		const key = e.id != null ? "id:" + e.id : e;      // 同一条公告只留第一段（见上）
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ name: e.title, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	return out;
}

// ── 传输：POST 自己封装（lib/env.js 的 fetchText/fetchJson 只支持 GET）────────
const ns_umamusume_official_PROXY_PREFIX = "/api/gacha-calendar-proxy";

/** 代理 URL（与 lib/env.js 同形态；测试夹具 harness 能识别该前缀并取出被代理的 url） */
function ns_umamusume_official_proxyUrlFor(url, referer = "", headers = null, contentType = null) {
	let api = ns_umamusume_official_PROXY_PREFIX + "?url=" + encodeURIComponent(url) + "&referer=" + encodeURIComponent(referer);
	if (headers) api += "&headers=" + encodeURIComponent(JSON.stringify(headers));
	if (contentType) api += "&contentType=" + encodeURIComponent(contentType);
	return api;
}

/**
 * POST JSON 的抓取封装。
 *   mode="proxy"（默认）：宿主代理读**请求体**并透传为 POST（见 src/index.js proxyHandler）
 *   mode="direct"       ：浏览器原生 fetch（本两源无 ACAO，实跑只能走 proxy）
 * 结构问题（坏 JSON / 非 200 / 代理拒绝）→ throw。
 */
async function ns_umamusume_official_postJsonUma(url, body, { referer = "", headers = null, signal, mode = "proxy", label = "uma" } = {}) {
	const fetchImpl = globalThis.fetch;
	if (typeof fetchImpl !== "function") throw new Error(label + "-no-fetch");
	const payload = JSON.stringify(body == null ? {} : body);
	if (mode === "direct") {
		const res = await fetchImpl(url, {
			method: "POST",
			signal,
			headers: { "content-type": "application/json; charset=utf-8", accept: "application/json, text/plain, */*", ...(headers || {}), ...(referer ? { referer } : {}) },
			body: payload
		});
		if (!res.ok) throw new Error(label + "-http-" + res.status);
		const text = await res.text();
		try { return JSON.parse(text); } catch { throw new Error(label + "-bad-json"); }
	}
	const api = ns_umamusume_official_proxyUrlFor(url, referer, headers, "application/json; charset=utf-8");
	const res = await fetchImpl(api, { method: "POST", signal, headers: { Accept: "application/json", "content-type": "application/json; charset=utf-8" }, body: payload });
	if (!res.ok) throw new Error(label + "-proxy-http-" + res.status);
	const text = await res.text();
	let j = null;
	try { j = JSON.parse(text); } catch { j = null; }
	if (!j || typeof j !== "object") throw new Error(label + "-proxy-bad-json");
	if (j.status !== 200 || typeof j.body !== "string") throw new Error(label + "-proxy:" + (j.error || j.status));
	try { return JSON.parse(j.body); } catch { throw new Error(label + "-bad-json"); }
}

function ns_umamusume_official_originOf(url) { try { return new URL(url).origin + "/"; } catch { return ""; } }
/** 日服列表 URL 构造函数：分页参数**只有 `page`**（实测 p / page_no / limit / size 全无效） */
function ns_umamusume_official_umaJpPageUrl(base, page) {
	const b = String(base || ns_umamusume_official_UMA_JP_INDEX_URL);
	if (/[?&]page=\d+/.test(b)) return b.replace(/([?&])page=\d+/, "$1page=" + page);
	return b + (b.includes("?") ? "&" : "?") + "page=" + page;
}

// ── 抓取主循环 ──────────────────────────────────────────────────────────────
/**
 * 通用主循环：列表新→旧，只看"卡池/活动"命中的条目；逐条抓详情抽窗口。
 *
 * ⚠️ 为什么**不**在"拿到第一个覆盖 now 的窗口"时就 break：
 *    同一页里可能有多条都覆盖 now（实测日服 page1：卡池 3470/3469 同窗口、活动 3481 与 3472 多段期间），
 *    而列表顺序 ≠ 档期新旧 → 提前 break 会让外显取决于"源站列表顺序"（不确定、且可能选到较旧的那条）。
 *    所以本函数**把本页所有分类命中的候选都扫完**（受 `pageSize`/`maxDetails` 约束），
 *    再由 `ns_umamusume_official_pickUmaWindow` 客观地取"覆盖 now 且 startTs 最新"的那条。
 *    只有"整页都没有覆盖 now 的窗口"时才翻下一页（更早的页只会有更旧的档期，没必要继续）。
 *
 * 错误处理：第一页列表失败 → throw（该侧算抓取失败）；后续页失败 → 当作"没有更多"停止翻页；
 *          单条详情失败 → 跳过并计数（不当成整侧失败）。
 */
async function ns_umamusume_official_collectSide({ side, kind, indexUrl, tz, now, signal, maxDetails, maxPages, pageSize, detailUrlFor }) {
	const details = [];
	const scanned = [];
	let detailCount = 0;
	let skipped = 0;
	const isGlobal = kind === "global";

	for (let page = 1; page <= maxPages && detailCount < maxDetails; page++) {
		const listUrl = isGlobal ? indexUrl : ns_umamusume_official_umaJpPageUrl(indexUrl, page);
		let listJson;
		try {
			listJson = isGlobal
				? await ns_umamusume_official_postJsonUma(indexUrl, { announce_label: ns_umamusume_official_UMA_GLOBAL_LABEL_GAME, limit: 50, offset: 0 }, { referer: ns_umamusume_official_originOf(indexUrl), signal, label: "uma-global-index" })
				: await fetchJson(listUrl, { signal, mode: "proxy", referer: ns_umamusume_official_originOf(listUrl) });
		} catch (e) {
			if (page === 1) throw e;
			break;
		}
		const items = ns_umamusume_official_parseUmaIndex(listJson, kind, tz);
		for (const it of items) scanned.push(it);
		const cands = items.filter((x) => x.kind === side).slice(0, pageSize);
		let covered = false;
		for (const c of cands) {
			if (detailCount >= maxDetails) break;
			const detailUrl = isGlobal ? ns_umamusume_official_UMA_GLOBAL_DETAIL_URL : detailUrlFor(c.id);
			let dj;
			try {
				dj = isGlobal
					? await ns_umamusume_official_postJsonUma(detailUrl, { announce_id: c.id }, { referer: ns_umamusume_official_originOf(detailUrl), signal, label: "uma-global-detail" })
					: await fetchJson(detailUrl, { signal, mode: "proxy", referer: ns_umamusume_official_originOf(detailUrl) });
			} catch { skipped++; detailCount++; continue; }
			detailCount++;
			let det;
			try { det = ns_umamusume_official_parseUmaDetail(dj, tz, kind); } catch { skipped++; continue; }
			if (!det.title) det.title = c.title;
			if (det.id == null) det.id = c.id;
			details.push(det);
			if (det.windows.some((w) => w.startTs <= now && w.endTs >= now)) covered = true;
		}
		if (covered) break;                      // 本页已有覆盖 now 的候选 → 不再翻页（更早的页只会更旧）
	}
	return { details, scanned, detailCount, skipped };
	// ⚠️ `scanned` / `detailCount` / `skipped` 只作**诊断计数**（原来被拼进悬停首行「共扫描 N 条 / 取详情 M 条」，
	//    用户 2026-10-03 要求「元信息彻底删掉」→ 该首行已删，计数保留给排障与将来日志，**绝不进悬停文本**）。
}

// ── 日服 ────────────────────────────────────────────────────────────────────
/**
 * 赛马娘 日服 官方公告 卡池侧。
 * @param {string} url 列表 URL（默认 ns_umamusume_official_UMA_JP_INDEX_URL；分页参数 `page`）
 * @param {AbortSignal} signal
 * @param {string} tz 源站时区（默认 Asia/Tokyo）
 * @param {number} now 当前时刻（**第 4 参**；仓库历史 bug 是把 now 放第 2 参 → startTs<=now 恒假）
 * @param {{maxDetails?:number,maxPages?:number,pageSize?:number}} opts
 */
async function ns_umamusume_official_gachaUmaJpOfficial(url, signal, tz = ns_umamusume_official_UMA_JP_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectSide({
		side: "gacha", kind: "jp", indexUrl: url || ns_umamusume_official_UMA_JP_INDEX_URL, tz, now, signal,
		maxDetails: opts.maxDetails || ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
		maxPages: opts.maxPages || ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
		pageSize: opts.pageSize || ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
		detailUrlFor: (id) => ns_umamusume_official_UMA_JP_DETAIL_URL + id
	});
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;                       // 抓到公告但当期没有覆盖 now 的卡池期 = 未公布
	// ≥2 个当期池才给悬停；只有 1 个 → **不设** bannerHover，交回 UI 默认两行式（`池名：角色` ⏎ 档期）
	const bannerHover = hoverPool(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		banner: picked.e.title,
		bannerDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		bannerDatesRaw: picked.w.raw,
		startTs: picked.w.startTs,
		endTs: picked.w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

/** 赛马娘 日服 官方公告 活动侧（イベント / キャンペーン）。now 是第 4 参。 */
async function ns_umamusume_official_eventsUmaJpOfficial(url, signal, tz = ns_umamusume_official_UMA_JP_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectSide({
		side: "event", kind: "jp", indexUrl: url || ns_umamusume_official_UMA_JP_INDEX_URL, tz, now, signal,
		maxDetails: opts.maxDetails || ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
		maxPages: opts.maxPages || ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
		pageSize: opts.pageSize || ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
		detailUrlFor: (id) => ns_umamusume_official_UMA_JP_DETAIL_URL + id
	});
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// ≥2 条当期活动才给悬停；只有 1 条 → **不设** eventHover，交回 UI 默认两行式（`名称` ⏎ 档期）
	const eventHover = hoverEvent(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		event: picked.e.title,
		eventDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		eventDatesRaw: picked.w.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ── 国际服（POST；时区 UTC）─────────────────────────────────────────────────
async function ns_umamusume_official_collectGlobal(side, url, tz, now, signal, opts) {
	const indexUrl = url || ns_umamusume_official_UMA_GLOBAL_INDEX_URL;
	return ns_umamusume_official_collectSide({
		side, kind: "global", indexUrl, tz, now, signal,
		maxDetails: opts.maxDetails || ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
		maxPages: opts.maxPages || ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
		pageSize: opts.pageSize || ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
		detailUrlFor: () => ns_umamusume_official_UMA_GLOBAL_DETAIL_URL
	});
}

/** 赛马娘 国际服（Global）官方公告 卡池侧（Scout）。now 是第 4 参。 */
async function ns_umamusume_official_gachaUmaGlobal(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectGlobal("gacha", url, tz, now, signal, opts);
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// 同卡池侧：≥2 个当期池才给悬停，否则交回 UI 默认两行式
	const bannerHover = hoverPool(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		banner: picked.e.title,
		bannerDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		bannerDatesRaw: picked.w.raw,
		startTs: picked.w.startTs,
		endTs: picked.w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

/** 赛马娘 国际服（Global）官方公告 活动侧。now 是第 4 参。 */
async function ns_umamusume_official_eventsUmaGlobal(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectGlobal("event", url, tz, now, signal, opts);
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// 同活动侧：≥2 条当期活动才给悬停，否则交回 UI 默认两行式
	const eventHover = hoverEvent(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		event: picked.e.title,
		eventDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		eventDatesRaw: picked.w.raw,
		...(eventHover ? { eventHover } : {})
	};
}

		// ===== 内联自 next-sources/parsers/biligame-announce.js（模块级标识符已加 ns_biligame-announce_ 前缀）=====

// next-sources/parsers/biligame-announce.js —— 嘟嘟脸恶作剧 国服（biligame 官方公告 API）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null（null = 未公布）
//   · 卡池侧：{ banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover }
//   两侧都读**同一份官方公告**（同 bandori.js：一份公告里既有活动档期也有招募档期）。
//
// ══ 实测形态（2026-10-02 抓夹具：fixtures/p6-ddlezj-list、fixtures/p6-ddlezj-detail）══
// 列表：GET https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50
//   → { request_id, data:[13 条], totalNum:13, pageNo, code:0, ts }
//   条目 = { id, title, typeId, displayTime?, ctime, mtime, content(截断，末尾 `...`) }
//   ⚠️ 三处实测细节（都与 bandori 同款 API 的表现不同，别照抄结论）：
//     ① 本游戏列表**本身就按时间倒序**（13 条严格递减）；bandori 那批是"置顶公告打乱顺序"。
//        仍然自行排序：排序键 = `displayTime || ctime`（字符串比较，形如 `YYYY-MM-DD HH:MM:SS`）。
//     ② **5/13 条没有 displayTime**（17631 / 17429 / 17244 / 16948 / 16947）→ 必须退到 ctime。
//     ③ 列表里的 content 是**截断**的 → 正文只能抓详情 /news/{id}。
// 详情：GET https://api.biligame.com/news/{id}
//   → { request_id, data:{ id, title, content(完整 HTML), displayTime, mtime, typeName, typeId,
//                          gameExtensionId, site, author }, gameInfo, code:0, ts }
//   ⚠️ `/news/17825` 的 data 里 `gameExtensionId=1282` + `site=嘟嘟脸恶作剧` —— 这是扩展 id 的
//      **第二重独立印证**（第一重：官网页面的网络请求自身就带 gameExtensionId=1282）。
//      参数空间实测：positionId 只有 `2` 有数据；typeId=1 主公告(13) / 2 预约(1) / 3~8 空。
//
// ══ 正文结构（HTML 富文本：169 个 <p> / 41 个 <br>）══
//   每个 <p> 是一个逻辑单元，**标题与档期经常各占一个 <p>**：
//     <p>一、主题剧院【凝聚滴落的回忆之池】</p>
//     <p>活动时间：2026/04/23 &nbsp;维护后 - 2026/05/07 09:59</p>
//     <p>③梦境之地</p>
//     <p>活动时间：2026/04/30 10:00 - 2026/05/07 09:59 (UTC+9)</p>
//     <p>三、招募UP中 使徒招募 ①精选使徒招募【积极心态】雨伊 活动时间：…  ← 标题与档期同段</p>
//   `textOf()` 会把 `<br>` 换成换行、把 `</p><p>` 换成**空格** → 用 textOf 的"行"会把同段多个
//   `<p>` 粘成一长行（夹具里就是这样）。所以本解析器**按 `</p>` 切段**再净化
//   （与 fgo.js / bwiki.js 自写 HTML 工具的做法一致），段内再把空白压平。
//
// ══ 时区：条目 tz = "+540"（UTC+9 固定偏移）—— **源站原文标 UTC+9，不是我们换算的** ══
//   正文里 `(UTC+9)` 出现 **4 处**，例如：
//     `活动时间：2026/04/30 10:00 - 2026/05/07 09:59 (UTC+9)`
//   这是**源站原文**。国服公告却用日本时区，**属源站如此**（本项目不改源站口径）。
//   另有大量档期**不带后缀**（`活动时间：2026/04/30 10:00 - 2026/05/07 10:59`），但同一份公告里
//   同一天的收尾时刻与带后缀的严格一致（七、艾利亚斯边境 活动时间收尾 `05-07 10:59`
//   ↔ 同节 BOSS登场时间 `2026/05/07 10:59 (UTC+9)`）→ 整份公告统一按 UTC+9 解释。
//   raw 字段里保留源站**是否写了后缀**（写了就带上），不做任何改写。
//
// ══ 「维护后」不猜时刻（任务书明确要求：抽不到就返回 null）══
//   大量档期写作 `2026/04/23 维护后 - 2026/05/07 09:59`：起点只有"维护后"、**没有钟点**。
//   公告的 displayTime 是**发布时刻**（17825 = 2026-04-27 12:00），不等于该次维护的结束时刻
//   （维护发生在 04-23）→ 用它补齐会把窗口起点写错。故：**起点无钟点的档期一律不产出**
//   （计入 `skippedNoTime`，只在 hover 里如实说明），绝不硬凑。
//   同一份公告里所有档期都抽不出"覆盖当前时刻"的窗口 → 抓取器返回 null（未公布）。


const ns_biligame_announce_DDLEZJ_GAME_EXTENSION_ID = 1282;
const ns_biligame_announce_DDLEZJ_LIST_URL = "https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50";
// 条目 tz：源站正文自标 (UTC+9)，故用固定偏移分钟数 "+540"（≡ Asia/Tokyo，无夏令时）
const ns_biligame_announce_DDLEZJ_TZ = "+540";
// ⚠️ 只有公告**正文档期**用 UTC+9；列表/详情里的 displayTime|ctime 是 B 站 CMS 的**发布时刻**，
//    实测口径是国服 UTC+8（**推测**，源站未标注）→ 单独一个常量，只用于 dateTs（排序/诊断）。
//    排序键本身是原始字符串，窗口换算完全不受它影响。
const ns_biligame_announce_DDLEZJ_CMS_TZ = "Asia/Shanghai";
const ns_biligame_announce_DDLEZJ_HOME = "https://game.bilibili.com/trickcal/news/";
// 一条公告最多往下抓几篇详情（公告很稀疏：全站只有 13 篇）
const ns_biligame_announce_DETAIL_LIMIT = 6;

// lib/env.js 的 decodeEntities 只覆盖少量实体，公告正文里的这几个高频实体本地补齐（不改 lib/）
const ns_biligame_announce_ENT_EXTRA = {
	middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–", nbsp: " ",
	sup2: "²", sup3: "³", deg: "°", bull: "•", copy: "©", reg: "®",
	lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»"
};
function ns_biligame_announce_decodeExtra(s) {
	return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
		const v = ns_biligame_announce_ENT_EXTRA[String(k).toLowerCase()];
		return v != null ? v : m;
	}));
}
function ns_biligame_announce_plain(html) { return ns_biligame_announce_decodeExtra(textOf(html)); }

//#region 列表
// 列表条目 → [{ id, title, displayTime, ctime, mtime, sortKey, dateTs }]，严格按生效时刻倒序
function ns_biligame_announce_parseDdlezjList(json) {
	if (!json || typeof json !== "object") throw new Error("ddlezj-bad-json");
	if (json.code !== 0) throw new Error("ddlezj-code-" + json.code);
	if (!Array.isArray(json.data)) throw new Error("ddlezj-bad-json");
	return json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => {
			const displayTime = x.displayTime || "";
			const ctime = x.ctime || "";
			const sortKey = displayTime || ctime;      // 实测 5/13 条没有 displayTime → 退 ctime
			return {
				id: x.id,
				title: ns_biligame_announce_decodeExtra(x.title).replace(/\s+/g, " ").trim(),
				typeId: x.typeId,
				displayTime,
				ctime,
				mtime: x.mtime || "",
				sortKey,
				dateTs: ns_biligame_announce_parseDdlezjDate(sortKey)
			};
		})
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));   // 严格倒序
}
// "2026-06-22 14:21:07"（CMS 发布时刻，不带时区后缀）→ 绝对毫秒（按 tz 解释墙钟）
function ns_biligame_announce_parseDdlezjDate(s, tz = ns_biligame_announce_DDLEZJ_CMS_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}
function ns_biligame_announce_ddlezjDetailUrl(listUrl, id) {
	let origin = "https://api.biligame.com";
	try { origin = new URL(listUrl || ns_biligame_announce_DDLEZJ_LIST_URL).origin; } catch { /* keep default */ }
	return `${origin}/news/${id}`;
}
//#endregion

//#region 正文 → 段落
// 按 </p> 切段（标题/档期各占一段，或同段）：去标签 + 还原实体 + 空白压平
function ns_biligame_announce_ddlezjParagraphs(html) {
	return String(html == null ? "" : html)
		.split(/<\/p\s*>/i)
		.map((chunk) => ns_biligame_announce_plain(chunk).replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
//#endregion

//#region 档期抽取
// 段落里的「标签：起 - 止[(UTC±N)]」。要点：
//   · 标签限定 2~12 个非空白非冒号字符（`活动时间` / `商店兑换时间` / `BOSS登场时间` / `投票收件`…）
//   · 起止都必须是 **带 4 位年份** 的日期（能滤掉正文里 `04/30 03:00` 这种裸月日）
//   · 起点的钟点可缺（`维护后`）→ 仍匹配上来，但由调用方判定为"抽不到"并跳过
//   · 终点必须带钟点
// 分段拼装（一条大正则手写括号极易出错）：组序 = 1 标签 / 2 起 / 3 起后缀 / 4 止 / 5 止后缀
//   ⚠️ 后缀必须在**捕获组之外**：否则 `2026/05/07 09:59 (UTC+9)` 会被整段当成"止"，
//      再送去解析时刻就必然失败（第一版就踩了这个坑，4 条 (UTC+9) 档期全被误判成"抽不到"）。
const ns_biligame_announce_RE_LABEL = "[^\\s：:]{2,12}";
const ns_biligame_announce_RE_DATE = "\\d{4}\\s*[/\\-.]\\s*\\d{1,2}\\s*[/\\-.]\\s*\\d{1,2}";
const ns_biligame_announce_RE_TIME = "\\d{1,2}\\s*[:：]\\s*\\d{2}";
const ns_biligame_announce_RE_UTC = "UTC[+-]\\d{1,2}";
const ns_biligame_announce_RE_START = `(${ns_biligame_announce_RE_DATE}(?:\\s*(?:${ns_biligame_announce_RE_TIME}|维护后))?)(?:\\s*\\((${ns_biligame_announce_RE_UTC})\\))?`;
const ns_biligame_announce_RE_END = `(${ns_biligame_announce_RE_DATE}\\s*${ns_biligame_announce_RE_TIME})(?:\\s*\\((${ns_biligame_announce_RE_UTC})\\))?`;
const ns_biligame_announce_WIN_RE = new RegExp(
	`(${ns_biligame_announce_RE_LABEL})[：:]\\s*${ns_biligame_announce_RE_START}\\s*(?:~|～|至|到|-|–|—)\\s*${ns_biligame_announce_RE_END}`,
	"g"
);
const ns_biligame_announce_STAMP = /^(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})$/;
function ns_biligame_announce_parseDdlezjStamp(s) {
	const m = ns_biligame_announce_STAMP.exec(String(s == null ? "" : s).trim());
	if (!m) return null;
	const h = +m[4], mi = +m[5];
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi };
}
// 段落里的标题段：`一、…` / `① …` / 小标题 `使徒招募` `卡片扭蛋` / 纯括号名 `【冒险通行证】`
//   （实测：`九、通行证` 与 `【冒险通行证】` 各占一段，不把后者当小标题就会两期都叫「九、通行证」）
const ns_biligame_announce_HEAD_SEC = /^[一二三四五六七八九十百]+\s*[、.．]/;
const ns_biligame_announce_HEAD_ITEM = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]/;
const ns_biligame_announce_HEAD_SUB = /^(使徒招募|卡片扭蛋)$/;
const ns_biligame_announce_HEAD_PURE = /^【[^】]{1,12}】$/;
// 段内标题（档期与标题同段时用）：取最后 1~2 个空白分词，滤掉长描述句
function ns_biligame_announce_pickTitle(prefix, fallback) {
	const toks = String(prefix || "").split(/\s+/).filter(Boolean);
	const ok = (t) => {
		const s = String(t).replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*/, "").trim();
		return s && s.length <= 22 && !/[。，,！!？?；;]/.test(s) ? s : "";
	};
	for (let i = toks.length - 1; i >= 0 && i >= toks.length - 2; i--) {
		const s = ok(toks[i]);
		if (!s) continue;
		// 末段过短（如 `【冒险通行证】`）→ 与上一段拼起来，名字更完整
		if (s.length <= 7 && i > 0) {
			const p = ok(toks[i - 1]);
			if (p) return p + " " + s;
		}
		return s;
	}
	return String(fallback || "").trim();
}
// 招募/扭蛋 = 卡池侧；其余 = 活动侧（与 bandori.js 的 GACHA_SEC_RE 同口径）
const ns_biligame_announce_GACHA_RE = /招募|扭蛋|卡池|精选/;

// 正文 HTML → { items:[{name,label,startTs,endTs,suffix,raw,kind}], skippedNoTime:[…] }
//   kind: "gacha" | "event"；suffix: 源站原文里的 `UTC+9`（没写就是 ""）
function ns_biligame_announce_parseDdlezjAnnouncement(html, tz = ns_biligame_announce_DDLEZJ_TZ) {
	const paragraphs = ns_biligame_announce_ddlezjParagraphs(html);
	const items = [];
	const skippedNoTime = [];
	let current = "";                                  // 最近的标题段
	for (const para of paragraphs) {
		ns_biligame_announce_WIN_RE.lastIndex = 0;
		let m, hadWindow = false;
		while ((m = ns_biligame_announce_WIN_RE.exec(para)) !== null) {
			hadWindow = true;
			const label = m[1];
			const startText = m[2].trim();
			const endText = m[4].trim();
			const suffix = m[5] || m[3] || "";         // (UTC+9) 写在起或止之后都认
			const name = ns_biligame_announce_pickTitle(para.slice(0, m.index), current);
			const raw = `${startText} ~ ${endText}${suffix ? ` (${suffix})` : ""}`;
			if (m[0] === "") ns_biligame_announce_WIN_RE.lastIndex++;
			// 起点无钟点（`维护后`）→ 不猜，如实记入 skippedNoTime
			if (!/\d\s*[:：]\s*\d{2}\s*$/.test(startText)) {
				skippedNoTime.push({ name, label, raw });
				continue;
			}
			const a = ns_biligame_announce_parseDdlezjStamp(startText);
			const b = ns_biligame_announce_parseDdlezjStamp(endText);
			if (!a || !b) { skippedNoTime.push({ name, label, raw }); continue; }
			const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
			const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
			if (!(endTs > startTs)) continue;          // 源站错行 → 丢掉，不硬造
			items.push({
				name: name || label,
				label,
				startTs, endTs,
				suffix,
				raw,
				kind: ns_biligame_announce_GACHA_RE.test(name) ? "gacha" : "event"
			});
		}
		if (hadWindow) continue;
		if (ns_biligame_announce_HEAD_SEC.test(para) || ns_biligame_announce_HEAD_ITEM.test(para) || ns_biligame_announce_HEAD_SUB.test(para) || ns_biligame_announce_HEAD_PURE.test(para)) {
			current = para.replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]\s*/, "").trim();
		}
	}
	return { items, skippedNoTime, paragraphs };
}
// 纯函数便捷入口：只要窗口（不含标题推断结果里的 kind 之外的加工）
function ns_biligame_announce_parseDdlezjWindows(html, tz = ns_biligame_announce_DDLEZJ_TZ) {
	return ns_biligame_announce_parseDdlezjAnnouncement(html, tz).items;
}
//#endregion

//#region 选当期（覆盖 now；不覆盖 → null，不硬凑过期档期）
// 卡池：覆盖当前的招募档里取**结束最早**的（越快结束越该盯住，与插件 selectCurrent 同口径）；
//       并列按文档顺序。
function ns_biligame_announce_pickDdlezjGacha(items, now) {
	const act = (items || []).filter((x) => x.kind === "gacha" && x.startTs <= now && x.endTs >= now);
	if (!act.length) return null;
	return act.map((x, i) => ({ x, i })).sort((a, b) => (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
// 活动：覆盖当前的**活动档**（label=`活动时间`）优先，其次其它标签（商店兑换时间 / BOSS登场时间…）；
//       同级内结束最早优先，并列按文档顺序。
function ns_biligame_announce_pickDdlezjEvent(items, now) {
	const act = (items || []).filter((x) => x.kind === "event" && x.startTs <= now && x.endTs >= now);
	if (!act.length) return null;
	const rank = (x) => (x.label === "活动时间" ? 0 : 1);
	return act.map((x, i) => ({ x, i })).sort((a, b) => (rank(a.x) - rank(b.x)) || (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
function ns_biligame_announce_covering(items, now, kind) {
	return (items || []).filter((x) => x.kind === kind && x.startTs <= now && x.endTs >= now)
		.map((x, i) => ({ x, i }))
		.sort((a, b) => (a.x.endTs - b.x.endTs) || (a.i - b.i))
		.map((o) => o.x);
}
// hover 里把"抽不出来的档期"如实说明（本公告里有 15 条 `维护后` 起点）
function ns_biligame_announce_skipNote(parsed) {
	const n = parsed.skippedNoTime.length;
	if (!n) return "";
	return `—— 另有 ${n} 条档期起点写作「维护后」（源站未给钟点、且公告发布时间 ≠ 维护结束时刻）→ 不产出，绝不硬凑 ——`;
}
const ns_biligame_announce_TZ_NOTE = "（源站正文自标 (UTC+9)，本条目 tz=+540）";
//#endregion

//#region 抓取器（契约：async (url, signal, tz) → 对象 | null；now 在最后、有默认值）
// 列表倒序 → 逐条往下抓详情（最多 ns_biligame_announce_DETAIL_LIMIT 篇），由调用方从每篇里挑"覆盖当前时刻"的档期；
// 单条详情失败（网络/404）不整体崩，继续下一条，
// **但若所有详情请求都失败** → 抛错（不能把"源站挂了"静默降级成"未公布"）。
// 实测（2026-10-02）：13 篇里只有「活动公告」类带档期，最新几篇是规则/开发者笔记（0 条档期）
// → 必须往下走几篇才可能命中当期，故 limit 取 6。
async function ns_biligame_announce_loadDdlezj(listUrl, signal, tz) {
	const list = ns_biligame_announce_parseDdlezjList(await fetchJson(listUrl, { referer: ns_biligame_announce_DDLEZJ_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;
	let firstErr = null, loaded = 0;
	const seen = [];
	for (const it of list.slice(0, ns_biligame_announce_DETAIL_LIMIT)) {
		try {
			const detail = await fetchJson(ns_biligame_announce_ddlezjDetailUrl(listUrl, it.id), { referer: ns_biligame_announce_DDLEZJ_HOME, signal, mode: "proxy" });
			const d = detail && detail.data;
			if (!d || typeof d.content !== "string") continue;
			loaded++;
			seen.push({ item: it, data: d, parsed: ns_biligame_announce_parseDdlezjAnnouncement(d.content, tz) });
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (loaded === 0 && firstErr) throw firstErr;
	return { seen };
}
// 卡池侧
async function ns_biligame_announce_gachaDdlezj(url, signal, tz = ns_biligame_announce_DDLEZJ_TZ, now = Date.now()) {
	const ctx = await ns_biligame_announce_loadDdlezj(url || ns_biligame_announce_DDLEZJ_LIST_URL, signal, tz);
	if (!ctx) return null;
	for (const { item, data, parsed } of ctx.seen) {
		const best = ns_biligame_announce_pickDdlezjGacha(parsed.items, now);
		if (!best) continue;
		const act = ns_biligame_announce_covering(parsed.items, now, "gacha");
		const lines = act.map((x) => `${fmtWindow(x.startTs, x.endTs, tz)}   ${x.name}`);
		const note = ns_biligame_announce_skipNote(parsed);
		const hover = [
			`嘟嘟脸恶作剧 国服 · ${data.title || item.title} ${ns_biligame_announce_TZ_NOTE}`,
			...lines,
			...(note ? [note] : [])
		].join("\n");
		return {
			banner: best.name,
			roles: "",                                  // 源站为公告正文，无结构化角色名单（池名里已带角色）
			bannerDates: fmtWindow(best.startTs, best.endTs, tz),
			bannerDatesRaw: best.raw,
			startTs: best.startTs,
			endTs: best.endTs,
			bannerHover: hover
		};
	}
	return null;                                       // 抓到公告但当期无覆盖 → 未公布
}
// 活动侧
async function ns_biligame_announce_eventsDdlezj(url, signal, tz = ns_biligame_announce_DDLEZJ_TZ, now = Date.now()) {
	const ctx = await ns_biligame_announce_loadDdlezj(url || ns_biligame_announce_DDLEZJ_LIST_URL, signal, tz);
	if (!ctx) return null;
	for (const { item, data, parsed } of ctx.seen) {
		const best = ns_biligame_announce_pickDdlezjEvent(parsed.items, now);
		if (!best) continue;
		const act = ns_biligame_announce_covering(parsed.items, now, "event");
		const lines = act.map((x) => `${fmtWindow(x.startTs, x.endTs, tz)}   ${x.name}${x.label === "活动时间" ? "" : `（${x.label}）`}`);
		const note = ns_biligame_announce_skipNote(parsed);
		const hover = [
			`嘟嘟脸恶作剧 国服 · ${data.title || item.title} ${ns_biligame_announce_TZ_NOTE}`,
			...lines,
			...(note ? [note] : [])
		].join("\n");
		return {
			event: best.name,
			eventDates: fmtWindow(best.startTs, best.endTs, tz),
			eventDatesRaw: best.raw,
			eventHover: hover
		};
	}
	return null;
}
//#endregion

		// ===== 内联自 next-sources/parsers/kedr-wiki.js（模块级标识符已加 ns_kedr-wiki_ 前缀）=====

// next-sources/parsers/kedr-wiki.js —— 雪松（bwiki 社区结构化页 `往期动员【常驻】—1.0.0—`）
//
// 契约：async (url, signal, tz, now = Date.now()) → { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover } | null
//
// ⚠️ **这是社区 wiki，不是官方源**：雪松（Кедр / kedrgame，俄语"雪松"）**官方源未找到**
//    （调研结论见 `dsh-gacha-calendar-新增来源第二轮调研-2026-10-02.md` §5：官方无公告 API，
//      bwiki 的 `page=卡池信息` 又是「台架测试」占位页）→ 本来源是**社区结构化页**，`kind: "wiki"`。
//    稳定性弱于官方 API：页面随时可能被社区改写/停更。
//
// ══ 实测形态（2026-10-02 抓夹具 fixtures/p6-kedr-archive，HTTP 200 / 17,298 B）══
//   GET https://wiki.biligame.com/kedrgame/api.php?action=parse&page=<percent-encoded>&prop=text&format=json&formatversion=2
//   （页名 `往期动员【常驻】—1.0.0—` **必须 percent-encode 后再拼 URL**，见 ns_kedr_wiki_kedrParseUrl）
//   → 标准 MediaWiki `{ parse:{ title, pageid, text } }`，`text` 是 16,516 B 的 HTML。
//
//   ⚠️ **与任务书假设不同：该页没有任何 `<table>`（实测 0 张）**，所以不存在"表格档期抽取"。
//      真实结构是「每个小节一段档期 + 若干可折叠卡池面板」：
//        <h1><span class="mw-headline" id="1.0.0-1"><b>1.0.0-1</b></span>…[编辑]</h1>
//        <div …><p><big>
//          <b>开始时间：2026-06-22-12:00<br /></b>
//          <b>结束时间：2026-06-29-05:00<br /></b>
//        </big></p>
//        <div class="panel panel-info"><div class="panel-heading">…<span>卡池:精英集结·指挥</span>…展开/折叠
//          <div class="panel-body…"><p>角色：<a title="安吉拉">安吉拉</a><br />职业：指挥<br />卡池：【<a …>精英集结·指挥</a>】…
//      要点：① 档期不是一行"起 ~ 止"，而是**开始时间 / 结束时间 两行**（各带 `<br />`）→ 要配对；
//            ② 时间戳形态是 `YYYY-MM-DD-HH:MM`（日期与时刻之间**又多一个连字符**，非标准写法）；
//            ③ 小节标题在 `<h1>` 里，4 节 = `1.0.0-1` ~ `1.0.0-4`；
//            ④ 每节 2 个卡池（`卡池:` 出现在折叠面板标题上），`角色：` 后是 UP 角色（安克文本即名字）。
//      ⇒ 解析器按 `<h1>` 切节（下面 ns_kedr_wiki_kedrSections），节内配对两个时间戳 + 收集卡池/角色。
//
// ══ 时区 Asia/Shanghai（**推测**，源站未标注）══
//   页面正文没有任何时区字样。两条旁证支持国服 UTC+8：① 每期 `结束时间` 都落在 **05:00**
//   （国服常见的每日 05:00 日切点）；② 起始是 `12:00`（中午开池）。**未经源站声明**，故记"推测"。
//
// ══ 「往期动员」是**归档页**（重要）══
//   页面标题即「往期」：实测 4 期全部落在 2026-06-22 ~ 2026-07-20（抓取时刻 2026-10-02 已全部结束）
//   → 抓取器在"当期"语义下会**如实返回 null（未公布）**，而不是硬凑一个过期档期。
//   若社区把当期动员也挂到同一页/同款结构，本解析器无需改动即可产出。
//
// ══ bwiki 反爬（抓夹具时必看）══
//   高频请求会被腾讯 EdgeOne WAF 拦成 **HTTP 567**（返回 ~7KB 挑战页、**不是 JSON**）
//   → 抓夹具要限速 30s 重试，并**校验 body 是不是 JSON**（否则会把挑战页存成夹具）。
//   本次抓取两次请求都是 HTTP 200 + 合法 JSON（无触发）。`fetchMediaWikiText` 对坏 JSON 会抛
//   `bad-json` → 属"该侧抓取失败"，不会被当成"未公布"。


const ns_kedr_wiki_KEDR_API = "https://wiki.biligame.com/kedrgame/api.php";
const ns_kedr_wiki_KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";
const ns_kedr_wiki_KEDR_ARCHIVE_PAGE = "往期动员【常驻】—1.0.0—";
// 推测：国服 UTC+8（源站未标注；旁证见文件头）
const ns_kedr_wiki_KEDR_TZ = "Asia/Shanghai";

// ⚠️ 页名必须 encodeURIComponent 后再拼（与 fgo.js 的 fgoParseUrl 同做法）：
//    registry-p6.js 里的 URL 必须用这同一个函数构造，否则离线夹具（test/map.json 的整串键）命中不到。
function ns_kedr_wiki_kedrParseUrl(page) {
	return `${ns_kedr_wiki_KEDR_API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`;
}
const ns_kedr_wiki_KEDR_ARCHIVE_URL = ns_kedr_wiki_kedrParseUrl(ns_kedr_wiki_KEDR_ARCHIVE_PAGE);

//#region 结构解析
// 按 <h1>…</h6> 切节；节标题取 `<span class="mw-headline">`（退回去标签后的文本），并去掉 `[编辑]`
//   ⚠️ 页首的目录标题 `<h2 id="mw-toc-heading">目录</h2>` 也是 heading → 显式排除（否则小节数虚高）
function ns_kedr_wiki_kedrSections(html) {
	const s = String(html == null ? "" : html);
	const heads = [];
	const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
	let m;
	while ((m = re.exec(s)) !== null) {
		if (/mw-toc-heading/.test(m[2])) continue;
		const inner = m[3];
		const hl = /<span[^>]*class="mw-headline"[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
		const title = stripTags(hl ? hl[1] : inner)
			.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
			.replace(/\s+/g, " ")
			.trim();
		heads.push({ level: +m[1], title, start: m.index, bodyStart: re.lastIndex });
	}
	return heads.map((h, i) => ({
		title: h.title,
		level: h.level,
		html: s.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : s.length)
	}));
}
// `开始时间：2026-06-22-12:00` / `结束时间：2026-06-29-05:00`
//   ⚠️ 源站的时间戳是 `YYYY-MM-DD-HH:MM`（日期与时刻之间再多一个连字符）→ 分隔符放宽
const ns_kedr_wiki_STAMP_BODY = "(\\d{4})\\s*[-\\/.]\\s*(\\d{1,2})\\s*[-\\/.]\\s*(\\d{1,2})\\s*[-\\s]\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2})";
function ns_kedr_wiki_kedrStamp(sectionHtml, label) {
	const re = new RegExp(label + "\\s*[:：][\\s\\S]{0,40}?" + ns_kedr_wiki_STAMP_BODY);
	const m = re.exec(String(sectionHtml == null ? "" : sectionHtml));
	if (!m) return null;
	const h = +m[4], mi = +m[5];
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi, text: `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}-${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
}
// 节内卡池名：`卡池:精英集结·指挥`（折叠面板标题上）；正文里 `卡池：【<a…>…】` 形态由
// 排除 `<`/`【`/`】` 的字符类天然跳过，不会重复取到。去重保序。
function ns_kedr_wiki_kedrPools(sectionHtml) {
	return [...String(sectionHtml == null ? "" : sectionHtml).matchAll(/卡池\s*[:：]\s*([^<【】\n]{1,24})/g)]
		.map((m) => m[1].replace(/\s+/g, " ").trim())
		.filter((x, i, a) => x && a.indexOf(x) === i);
}
// 节内 UP 角色：`角色：<a …>安吉拉</a><br />` → 取到第一个 <br>/</p> 之前的内容去标签
function ns_kedr_wiki_kedrRoles(sectionHtml) {
	const out = [];
	const re = /角色\s*[:：]([\s\S]{0,200}?)(?:<br\s*\/?>|<\/p>|$)/gi;
	let m;
	while ((m = re.exec(String(sectionHtml == null ? "" : sectionHtml))) !== null) {
		const t = stripTags(m[1]).replace(/\s+/g, " ").trim();
		if (t && !out.includes(t)) out.push(t);
		if (m[0] === "") re.lastIndex++;
	}
	return out;
}

// 页面 HTML → { sectionTitles, items:[{section,pools,roles,startTs,endTs,raw}], skipped }
//   结构性损坏（没有任何小节）→ 抛错（该侧算抓取失败），与 bwiki.js 的 no-table 同口径。
function ns_kedr_wiki_parseKedrArchive(html, tz = ns_kedr_wiki_KEDR_TZ) {
	const sections = ns_kedr_wiki_kedrSections(html);
	if (sections.length === 0) throw new Error("kedr-wiki:no-section");
	const items = [];
	let skipped = 0;
	sections.forEach((sec, i) => {
		const a = ns_kedr_wiki_kedrStamp(sec.html, "开始时间");
		const b = ns_kedr_wiki_kedrStamp(sec.html, "结束时间");
		if (!a || !b) { skipped++; return; }                      // 缺档期的小节（如纯说明节）→ 跳过
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }            // 源站错行 → 丢掉，不硬造
		items.push({
			_i: i,
			section: sec.title || `第 ${i + 1} 节`,
			pools: ns_kedr_wiki_kedrPools(sec.html),
			roles: ns_kedr_wiki_kedrRoles(sec.html),
			startTs, endTs,
			// raw：两端都是源站原文（`YYYY-MM-DD-HH:MM`），中间的 `~` 是本解析器拼的（源站分行写）
			raw: `${a.text} ~ ${b.text}`
		});
	});
	return { sectionTitles: sections.map((s) => s.title), items, skipped };
}
//#endregion

//#region 抓取器
// 当期 = 窗口覆盖 now 的那一节（取结束最早，并列按页面顺序）；没有覆盖 → null（未公布）
async function ns_kedr_wiki_gachaKedrWiki(url, signal, tz = ns_kedr_wiki_KEDR_TZ, now = Date.now()) {
	const html = await fetchMediaWikiText(url || ns_kedr_wiki_KEDR_ARCHIVE_URL, { referer: ns_kedr_wiki_KEDR_REFERER, signal, mode: "proxy" });
	const parsed = ns_kedr_wiki_parseKedrArchive(html, tz);
	const act = parsed.items
		.filter((x) => x.startTs <= now && x.endTs >= now)
		.map((x, i) => ({ x, i }))
		.sort((a, b) => (a.x.endTs - b.x.endTs) || (a.x._i - b.x._i))
		.map((o) => o.x);
	if (act.length === 0) return null;
	const first = act[0];
	const head = `${ns_kedr_wiki_KEDR_ARCHIVE_PAGE}（bwiki 社区页，非官方源；tz=UTC+8 为推测）`;
	const lines = act.map((x) => `${fmtWindow(x.startTs, x.endTs, tz)}   ${x.section}${x.pools.length ? `（${x.pools.join(" / ")}）` : ""}`);
	return {
		banner: first.pools.length ? `${first.section}（${first.pools.join(" / ")}）` : first.section,
		roles: first.roles.join("、"),
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw,
		startTs: first.startTs,
		endTs: first.endTs,
		bannerHover: [head, ...lines].join("\n")
	};
}
//#endregion

		// ===== 内联自 next-sources/parsers/stellasora.js（模块级标识符已加 ns_stellasora_ 前缀）=====

// next-sources/parsers/stellasora.js —— 星塔旅人 国服（悠星官方 CMS API）
//
// 来源（2026-10-02 实测「已验证可达」）：
//   类型目录  GET /api/resource/news-type
//   列表      GET /api/resource/news?index=1&size=N&type=<latest|notice|news|activity>
//   详情      GET /api/resource/news/<id>
//   同源反代 —— bundle 原文：`const Ye="/"; function j(s){return x({url:`${Ye}api/${s}`})}`
//   （⚠️ 真实 host 是**官网同源**，不是独立 API 域名；我先前试 `*.yostar.net` 等全 DNS 不可达）
//
// 可抓取性：服务端裸 GET，**无 token / 无签名**；响应 **无 ACAO** → 必须 mode:"proxy"
//
// 时区：Asia/Shanghai
//   · publishTime 是 epoch ms，直接是绝对时刻，无需换算
//   · 正文档期是**国服墙钟**（如 `2026/10/01 04:00 ~ 2026/10/31 03:59`，04:00 日切 = 国服特征）
//   · ⚠️ 源站**未显式标注时区** → 标「推测」
//     ⚠️ 「时区是推测」这类实现说明**只留在代码注释里**，**绝不进悬停文本**
//        （用户 2026-10-03：悬停里的元信息——来源站名/URL/时区推定/抓取条数/内部 id/实现说明——彻底删掉）。
//
// ── 列表里哪个分类装什么（实测）──────────────────────────────
//   type=notice   (349 条)  ← **卡池 + 活动说明**都在这里，本解析器主用
//   type=latest   (366 条)  同上 + 新闻
//   type=activity (15 条)   基本是**线下/周边**（BW 展会、联动、周边上新）→ 不作为游戏内活动
//   type=news     (2 条)    首曝/定档类新闻
//
// ── 详情正文的档期形态（实测）────────────────────────────────
//   `▌招募时间<br>2026/09/29 维护结束后 ~ 2026/10/20 10:59<br>`
//   `▌开放时间<br>2026/09/01 04:00 ~ 2026/10/01 03:59<br>`
//   `▌售卖时间<br>2026/10/01 04:00 ~ 2026/10/31 03:59<br>`
//   ⇒ 统一形态：`▌<环节>时间<br> <起点> ~ <终点>`；起点可能是「维护结束后」（相对锚点）
//
//   ⚠️ 起点是「维护结束后」时**没有绝对时刻**：用该公告的 publishTime 当锚点，
//      并标 `startInferred: true`。绝不硬造一个假时刻。

const ns_stellasora_STELLA_BASE = "https://stellasora.yostar.cn";
const ns_stellasora_STELLA_TZ = "Asia/Shanghai";   // 推测：源站未标注，但 04:00 日切与国服一致

function ns_stellasora_stellaListUrl(type = "notice", size = 20, index = 1) {
	return `${ns_stellasora_STELLA_BASE}/api/resource/news?index=${index}&size=${size}&type=${type}`;
}
function ns_stellasora_stellaDetailUrl(id) {
	return `${ns_stellasora_STELLA_BASE}/api/resource/news/${id}`;
}

// ── 正文 → 纯文本（保留 `<br>` 换行；档期是 `<br>` 分隔的，不能直接压成空格）──
function ns_stellasora_brText(html) {
	let t = String(html == null ? "" : html);
	t = t.replace(/<br\s*\/?>/gi, "\n");
	t = t.replace(/<\/(?:p|div|li|tr|h\d)>/gi, "\n");
	t = t.replace(/<[^>]+>/g, "");
	t = decodeEntities(t);
	t = t.replace(/[ \t\u00a0\u3000]+/g, " ");
	return t.trim();
}

// ── 日期令牌子 ──
// `2026/09/29 09:00` / `2026-09-29 09:00` / `09/29 09:00`（省年份，用锚点年）
const ns_stellasora_YMD_RE = /(?:(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2}))(?:\s*(\d{1,2}):(\d{2}))?/;
const ns_stellasora_MD_RE = /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?/;
const ns_stellasora_REL_START_RE = /维护结束后|维护后|更新结束后|更新后/;

// ⚠️ 必须先"挖掉"已匹配的完整年月日，再找省略年份的月日。
//    否则 `2026/09/29 维护结束后` 里的 `09/29` 会被 ns_stellasora_MD_RE 当成"省年份的月日"匹配到，
//    于是走错分支、把「维护结束后」的相对锚点丢掉（本仓库实测踩过这个坑）。
function ns_stellasora_maskYmd(s) {
	return s.replace(new RegExp(ns_stellasora_YMD_RE.source, "g"), (m) => "\u0000".repeat(m.length));
}

// 从一段文本解析一个「起点 ~ 终点」区间。返回 { startTs, endTs, raw, startInferred } 或 null
function ns_stellasora_parseStellaWindow(segText, tz = ns_stellasora_STELLA_TZ, anchorTs = null) {
	const s = String(segText == null ? "" : segText).replace(/\s*\n\s*/g, " ").trim();
	if (!s) return null;
	// 先看有没有显式区间分隔符
	const sepMatch = /[~～〜－—–]/.exec(s);
	const anchorParts = anchorTs != null ? sourceWallParts(anchorTs, tz) : null;

	// ① 起点：相对锚点（「维护结束后」）优先于裸日期 → 绝对日期（完整年月日） → 绝对日期（省年份）
	//
	// ⚠️ 顺序很重要：源站写的是 `2026/09/29 维护结束后 ~ 2026/10/20 10:59` —— **日期与「维护结束后」同时出现**。
	//    若让 ns_stellasora_YMD_RE 先命中，起点会变成 `09-29 00:00`（那天零点），但真实开局是**维护结束**那一刻。
	//    故「维护结束后」优先，用公告发布时刻当锚点并标 startInferred
	//    （与仓库既有惯例一致：FGO 的 `即日起` / 绝区零的 `4.6版本更新后` 起点都标 inferred 并写进 raw）。
	//    未出现该词时，`2026/10/01 04:00` 这类显式起点照常按原样解析。
	//    ⚠️ 2026-10-03：`startInferred` **只作内部标记**（供 raw / 调试用），**不再写进悬停** ——
	//       旧悬停里的「（起点按公告发布时刻推断）」是**实现说明**，用户要求元信息彻底删掉。
	let startTs = null, startInferred = false, startRaw = "";
	const relMatch = ns_stellasora_REL_START_RE.exec(s);
	const head = sepMatch ? s.slice(0, sepMatch.index) : s;
	const ymd1 = ns_stellasora_YMD_RE.exec(head);
	const md1 = !ymd1 ? ns_stellasora_MD_RE.exec(ns_stellasora_maskYmd(head)) : null;

	if (relMatch && anchorTs != null) {
		// 「维护结束后」：用公告发布时刻当锚点，并标记为推断值
		startTs = anchorTs;
		startInferred = true;
		startRaw = relMatch[0];
	} else if (ymd1) {
		startTs = sourceInstant(+ymd1[1], +ymd1[2], +ymd1[3], ymd1[4] != null ? +ymd1[4] : 0, ymd1[5] != null ? +ymd1[5] : 0, tz);
		startRaw = ymd1[0];
	} else if (md1 && anchorParts) {
		startTs = sourceInstant(anchorParts.y, +md1[1], +md1[2], md1[3] != null ? +md1[3] : 0, md1[4] != null ? +md1[4] : 0, tz);
		startRaw = md1[0];
	} else if (relMatch) {
		// 「维护结束后」但**没有锚点** → 无法定位绝对时刻 → 交给下面的 null 分支（不硬造）
		startTs = null;
	}

	// ② 终点（必须在分隔符之后）
	let endTs = null, endRaw = "";
	if (sepMatch) {
		const tail = s.slice(sepMatch.index + sepMatch[0].length);
		const ymd2 = ns_stellasora_YMD_RE.exec(tail);
		const md2 = !ymd2 ? ns_stellasora_MD_RE.exec(ns_stellasora_maskYmd(tail)) : null;
		if (ymd2) {
			endTs = sourceInstant(+ymd2[1], +ymd2[2], +ymd2[3], ymd2[4] != null ? +ymd2[4] : 23, ymd2[5] != null ? +ymd2[5] : 59, tz);
			endRaw = ymd2[0];
		} else if (md2) {
			// 省年份：月份比起点小（或同月日更小）→ 跨年
			let y = anchorParts ? anchorParts.y : null;
			const sParts = startTs != null ? sourceWallParts(startTs, tz) : null;
			if (sParts) {
				y = sParts.y;
				if (+md2[1] < sParts.mo || (+md2[1] === sParts.mo && +md2[2] < sParts.d)) y = sParts.y + 1;
			}
			if (y != null) {
				endTs = sourceInstant(y, +md2[1], +md2[2], md2[3] != null ? +md2[3] : 23, md2[4] != null ? +md2[4] : 59, tz);
				endRaw = md2[0];
			}
		}
	}

	if (startTs == null || endTs == null) return null;
	if (!(endTs > startTs)) return null;
	return { startTs, endTs, raw: s, startInferred };
}

// ── 正文 → 全部带标签的档期 ──
// 返回 [{ label, startTs, endTs, raw, startInferred }]，按出现顺序
function ns_stellasora_parseStellaWindows(html, tz = ns_stellasora_STELLA_TZ, anchorTs = null) {
	const text = ns_stellasora_brText(html);
	const out = [];
	// `▌<标签>时间` 后面紧跟一段（到下一个 ▌ 或结尾）
	const marks = [...text.matchAll(/▌\s*([^\n]{0,20}?时间)\s*\n?([^\n]*)/g)];
	for (const m of marks) {
		const label = m[1].replace(/\s+/g, "");
		const seg = (m[2] || "").trim();
		const w = ns_stellasora_parseStellaWindow(seg, tz, anchorTs);
		if (w) out.push({ label, ...w });
	}
	// 兜底：正文里存在「A ~ B」但没有 ▌标签
	if (out.length === 0) {
		for (const line of text.split("\n")) {
			const w = ns_stellasora_parseStellaWindow(line, tz, anchorTs);
			if (w) out.push({ label: "", ...w });
		}
	}
	return out;
}

// ── 分类：招募（卡池） / 活动 ──
// 实测标题形态：
//   卡池  「空白的稚梦」限时招募开启 / 「沐于温情笑意中」限时招募开启
//   活动  「猎影合围Beta」活动说明 / 「月华窃梦人」活动说明 / 「联合讨伐」活动说明
//   排除  维护更新说明 / 版本内容一览 / 版本活动一览 / 概率公示
function ns_stellasora_stellaIsGacha(title) {
	return /招募/.test(String(title || ""));
}
function ns_stellasora_stellaIsEvent(title) {
	const t = String(title || "");
	if (ns_stellasora_stellaIsGacha(t)) return false;
	if (/维护|更新说明|版本内容|版本活动一览|概率公示|封禁|处罚|问卷/.test(t)) return false;
	return /活动说明|活动开启|活动一览|活动预告/.test(t) || /活动/.test(t);
}
// 卡池标题 → 干净的卡池名：去掉「限时招募开启」等尾巴
function ns_stellasora_stellaGachaName(title) {
	return String(title || "").replace(/(限时|限定)?招募(开启|说明|一览)?[！!。.]?$/, "").trim() || String(title || "").trim();
}

// 卡池正文 → 该池的 UP 角色/秘纹名（悬停里「池名：角色」的右半边）。
// 实测形态（详情首段，**招募说明**里紧跟其后）：
//   「…全新5星旅人「艾蕾」招募概率提升！」          → 艾蕾
//   「…全新5星秘纹「睡前童话」招募概率提升！」      → 睡前童话
// 只取**首个**匹配（4 星行一定写在 5 星行之后，如「活动期间，4星旅人「师渺」「璟麟」…」）；
// 抓不到就返回 ""，悬停行退回只写池名 —— 与本体 `label = banner + (roles ? "：" + roles : "")` 同构，
// **绝不臆造**一个角色名。
const ns_stellasora_STELLA_NEW_FIVE_STAR_RE = /全新\s*5\s*星[^「」]{0,8}「([^「」]{1,24})」/;
const ns_stellasora_STELLA_FIVE_STAR_RE = /5\s*星[^「」]{0,8}「([^「」]{1,24})」/;
function ns_stellasora_stellaFeaturedName(html) {
	const t = ns_stellasora_brText(html);
	const m = ns_stellasora_STELLA_NEW_FIVE_STAR_RE.exec(t) || ns_stellasora_STELLA_FIVE_STAR_RE.exec(t);
	return m ? m[1].trim() : "";
}

// ── 列表解析 ──
function ns_stellasora_parseStellaList(json) {
	if (!json || json.code !== 0 || !json.data || !Array.isArray(json.data.rows)) throw new Error("stella-bad-json");
	return json.data.rows
		.filter((x) => x && x.id != null)
		.map((x) => ({
			id: x.id,
			title: decodeEntities(String(x.title || "")).trim(),
			publishTs: typeof x.publishTime === "number" ? x.publishTime : null,
			type: x.type || "",
			typeLabel: x.typeLabel || "",
			url: x.link || ""
		}))
		.sort((a, b) => (b.publishTs || 0) - (a.publishTs || 0));
}

// ── 抓详情并按标题分流，选出「覆盖 now」的条目 ──
// side: "gacha" | "event"
// 返回 { entry, win, candidates } 或 null
async function ns_stellasora_collectStellaSide(url, signal, tz, now, side) {
	const listUrl = url || ns_stellasora_stellaListUrl("notice");
	const list = ns_stellasora_parseStellaList(await fetchJson(listUrl, { signal, mode: "proxy" }));
	const want = side === "gacha" ? ns_stellasora_stellaIsGacha : ns_stellasora_stellaIsEvent;
	const candidates = [];
	// 列表按时间倒序；只扫前若干条，每篇抓一次详情
	for (const row of list.slice(0, 20)) {
		if (!want(row.title)) continue;
		let detail = null;
		try {
			const dj = await fetchJson(ns_stellasora_stellaDetailUrl(row.id), { signal, mode: "proxy" });
			detail = dj && dj.code === 0 && dj.data && dj.data.news ? dj.data.news : null;
		} catch { continue; }   // 单篇失败不拖垮整体
		if (!detail) continue;
		const anchorTs = row.publishTs != null ? row.publishTs : null;
		const wins = ns_stellasora_parseStellaWindows(detail.content, tz, anchorTs);
		// featured：该篇正文里的 UP 主推（卡池悬停「池名：角色」用；活动侧不用）
		const featured = ns_stellasora_stellaFeaturedName(detail.content);
		for (const w of wins) candidates.push({ row, win: w, featured });
	}
	if (candidates.length === 0) return null;
	// 覆盖 now 的里，取「起点最新」的那条（并列时取终点更晚的）
	const covering = candidates.filter((c) => c.win.startTs <= now && c.win.endTs >= now);
	if (covering.length === 0) return null;
	covering.sort((a, b) => (b.win.startTs - a.win.startTs) || (b.win.endTs - a.win.endTs) || (b.row.id - a.row.id));
	return { picked: covering[0], covering };
}

// ── 悬停 ──────────────────────────────────────────────────────────
// 一律走 `lib/env.js` 的 hoverPool / hoverEvent（与本体 buildPoolHover / buildEventHover **逐字同格式**）。
//
// 为什么不再自己拼字符串（2026-10-03 修，用户点名「新增游戏的悬停样式/格式/规则和原来的差别很大」）：
//   ① 旧实现把**元信息/实现说明**塞进了悬停 —— 主要是行尾的「（起点按公告发布时刻推断）」，
//      那本是 `startInferred` 的**实现说明**。本体条目**从不**在悬停里写这些 →
//      **直接删掉，且不改放到别的字段**；说明只留在本文件注释里（见 ns_stellasora_parseStellaWindow 与下方 ③）。
//   ② 旧实现是「档期在前、名称在后」；本体一律 `名称 + 3 空格 + 档期` → 交回 hoverEvent 排版。
//   ③ `startInferred` 的**判定逻辑原样保留**（「维护结束后」→ 用该公告 publishTime 当锚点，
//      不硬造时刻）；变的只是"不再把它写成悬停文案"。
//
// 卡池池项：`{ name, label, startTs, endTs, raw }`。
//   name  = 池名（与面板外显 `banner` 同一个字符串）
//   label = 「池名：角色」（角色抓不到就 = 池名）—— 与本体 `label = banner + (roles ? "：" + roles : "")` 同构
function ns_stellasora_stellaPoolItems(covering) {
	return covering.map((c) => {
		const name = ns_stellasora_stellaGachaName(c.row.title);
		return {
			name,
			label: c.featured ? `${name}：${c.featured}` : name,
			startTs: c.win.startTs,
			endTs: c.win.endTs,
			raw: c.win.raw
		};
	});
}

// 活动项：`{ name, startTs, endTs, raw }`。**排序由调用方负责**（hoverEvent 不排序），
// 这里照本体 sortEventItems 同序：结束时间升序（越快结束越靠前），同结束时间再按开始时间升序。
function ns_stellasora_stellaEventItems(covering) {
	return covering
		.map((c) => ({ name: c.row.title, startTs: c.win.startTs, endTs: c.win.endTs, raw: c.win.raw }))
		.sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
}

// ── 卡池侧 ──
async function ns_stellasora_gachaStellasora(url, signal, tz = ns_stellasora_STELLA_TZ, now = Date.now()) {
	const got = await ns_stellasora_collectStellaSide(url, signal, tz, now, "gacha");
	if (!got) return null;
	const { picked, covering } = got;
	// ⚠️ 卡池列的悬停字段是 **bannerHover**（面板 `title: g.bannerHover || gachaTitle`；
	//    50-refresh 的 `pickFields(g.data, GACHA_FIELDS)` 也只留 bannerHover）——
	//    旧实现写的是 `eventHover`，运行时被丢弃 = 卡池悬停**根本没生效**。
	const hover = hoverPool(ns_stellasora_stellaPoolItems(covering), tz);
	const out = {
		banner: ns_stellasora_stellaGachaName(picked.row.title),
		bannerDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		bannerDatesRaw: picked.win.raw,
		startTs: picked.win.startTs,
		endTs: picked.win.endTs,
		event: "",
		eventDates: ""
	};
	// hoverPool 在「当期池 < 2」时返回 ""：此时**不设** bannerHover，交回 UI 的默认两行式
	// 「池名：角色」⏎「档期」—— 不要自己再补一行，那正是与本体不一致的来源。
	if (hover) out.bannerHover = hover;
	return out;
}

// ── 活动侧 ──
async function ns_stellasora_eventsStellasora(url, signal, tz = ns_stellasora_STELLA_TZ, now = Date.now()) {
	const got = await ns_stellasora_collectStellaSide(url, signal, tz, now, "event");
	if (!got) return null;
	const { picked, covering } = got;
	const hover = hoverEvent(ns_stellasora_stellaEventItems(covering), tz);
	const out = {
		// 外显 = 该公告标题（源站的活动名写法；本次**不改**外显与档期字段的内容）。
		// 悬停里的名称与它同源同字，故「外显能看到的活动名」在悬停里也一定看得到。
		event: picked.row.title,
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw
	};
	// hoverEvent 在「当期活动 < 2」时返回 ""：此时**不设** eventHover，
	// 交回 UI 的默认两行式「活动名」⏎「档期|原文」。
	if (hover) out.eventHover = hover;
	return out;
}

// 供测试：从一篇详情 JSON 直接算档期
function ns_stellasora_stellaWindowsFromDetail(detailJson, tz = ns_stellasora_STELLA_TZ) {
	const n = detailJson && detailJson.data && detailJson.data.news;
	if (!n) throw new Error("stella-bad-detail");
	const anchorTs = typeof n.publishTime === "number" ? n.publishTime : null;
	return ns_stellasora_parseStellaWindows(n.content, tz, anchorTs);
}

		// ===== 内联自 next-sources/parsers/bwiki-wikitext.js（模块级标识符已加 ns_bwiki-wikitext_ 前缀）=====

// next-sources/parsers/bwiki-wikitext.js —— 批次 P8：三个 bwiki 来源的**wikitext 形态**解析器
//
// 本文件只装 P8 的三个来源（**不动** parsers/bwiki.js —— 那是 B2 的 `prop=text` HTML 形态）：
//   ① 战双帕弥什 zspms   —— 两步：SMW `action=ask` 索引 → 取最新「版本更新公告」→ `prop=wikitext` 正文
//   ② 卡厄斯梦境 czn     —— 一步：`Module:Gacha/data` 的 **Lua 表**（`prop=wikitext`）
//   ③ 雪松 kedrgame      —— 一步：`Template:首页游戏版本内容` 的 **模板调用**（`prop=wikitext`）
//
// 契约（与 CONVENTIONS.md / 插件 40-fetchers.js 完全一致）：
//   async (url, signal, tz, now = Date.now()) → 数据对象 | null
//     · 卡池侧 { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//     · 活动侧 { event, eventDates, eventDatesRaw, eventHover }
//   `now` 一律**第 4 个参数**（铁律 2：本仓库历史上把 now 放第二位 → `startTs <= now` 恒假 → 静默"未公布"）。
//   覆盖 now 的档期一条都没有 → **返回 null（未公布）**，绝不硬凑过期档期；结构性损坏才 throw。
//
// ══ 抓取证据（2026-10-02 实抓，夹具全部为真响应）══════════════════════════════
//   fixtures/p8-zspms-ask        HTTP 200 / 20,470B  SMW ask 命中 **40 条**，最新《远信回响》20260922
//   fixtures/p8-zspms-notice     HTTP 200 / 42,908B  parse.wikitext["*"] 正文 9,846B
//   fixtures/p8-czn-module       HTTP 200 /  1,591B  Lua 表 **6 期**（0001~0006）
//   fixtures/p8-kedr-template    HTTP 200 /  3,750B  `时间进度条` **5 条**
//   fixtures/p8-czn-record       HTTP 200 /    423B  备选页 `卡池记录`（模板调用 1 条，2026/03）
//
// ⚠️ bwiki 反爬（EdgeOne WAF）：请求发太密会被拦成 **HTTP 567**（≈7KB JS 挑战页、非 JSON、页内含 requestId）。
//    实测只带 UA 也能 200，**不是请求头问题** → 抓夹具要 6~10s 间隔 + 退避重试 + 校验 body 是 JSON
//    （见 test/capture-p8.mjs）。运行期若某侧抛 `bad-json`/`proxy-http-567`，那是 WAF，不是"未公布"。
//
// ══ 时区：三个来源一律 Asia/Shanghai（**均为推测**）═══════════════════════════
//   源站**都没有**时区标注。旁证：
//     · zspms 停服维护 05:00~11:00、卡池日切 05:00（国服特征）；公告尾部写「2026年9月22日」
//     · czn `10:00:00` 开池 / `02:00:00` 关池（国服作息）
//     · kedr 每期都在 `05:00` 换池（与 P6 的雪松社区页同款旁证）
//   故记"推测"，注册表注释里同样标注。
//
// ══ 「版本更新后」这类**相对起点**的锚点策略（重要，与任务书略有出入，理由在此）══
//   stellasora.js 的先例：相对起点没有绝对时刻 → 用**该公告的发布时间**当锚点 + 标 `startInferred: true`。
//   本文件沿用该精神（相对起点必须有据可依的锚点、必须标 inferred、绝不假造时刻），但锚点优先级更细：
//     ① 源站**自己写明的停服维护窗口**的结束时刻（`…将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
//        —— "版本更新后"就是维护结束之后，这是**源站原文给的绝对锚点**，比公告发布日期精确 2 天；
//     ② 兜底：公告 `{{公告|时间=YYYYMMDD}}` 字段（**= stellasora 先例的"公告发布时间"**，本夹具里是 20260922）；
//     ③ 再兜底：该相对点**自带的日期**（`2026年9月24日版本更新后`）按当日 00:00（防御性；只要正则匹配到相对点，
//        ② 的公告时间字段就一定存在，故这条实际到不了，保留以防字段被源站删除）。
//   三条路径**都**标 `startInferred: true`，并把推断依据留在**数据字段**（`startFrom`/`startRel`）与代码注释里。
//   ⚠️ 悬停**不写**推断依据（用户 2026-10-03：「悬停里的元信息彻底删掉」）——悬停只放名称/角色/档期，
//   与本体 buildPoolHover / buildEventHover 同格式（见下面 "当期挑选 / 悬停" 区域）。
//   （若坚持"一律用发布时间"，只需删掉 ns_bwiki_wikitext_zspmsMaintenanceWindow 的调用。兜底锚点行为不受悬停改动影响。）


//#region 通用：MediaWiki `prop=wikitext`（fetchMediaWikiText 只取 parse.text，这里要 parse.wikitext）
// 实测两种返回形态都要兼容：
//   · 本项目抓到的 bwiki 是 `{"parse":{"title":…,"wikitext":{"*":"正文"}}}`（对象包一层 `"*"`）
//   · 部分 MediaWiki（如 fgo.wiki 的某些配置）直接给字符串 → 也兼容
function ns_bwiki_wikitext_mediaWikiWikitext(json) {
	const p = json && json.parse;
	if (!p) return null;
	const wt = p.wikitext;
	if (typeof wt === "string") return wt;
	if (wt && typeof wt === "object" && typeof wt["*"] === "string") return wt["*"];
	return null;
}
// 带 Referer 请求（浏览器真实会带；bwiki 的 EdgeOne WAF 拦的主要是"频率"，但少一个 bot 信号没坏处）。
// ⚠️ 夹具测试不受影响：离线 harness 只读代理 URL 里的 `url` 参数，忽略 referer。
async function ns_bwiki_wikitext_fetchWikitext(url, signal, referer = "") {
	const json = await fetchJson(url, { referer, signal, mode: "proxy" });
	const wt = ns_bwiki_wikitext_mediaWikiWikitext(json);
	if (wt == null) throw new Error("bad-json");     // 含 missingtitle（HTTP 仍 200）→ 结构性损坏
	return wt;
}
//#endregion

//#region 通用：当期挑选 / 悬停
// ── 悬停排版（用户 2026-10-03 方案 A）────────────────────────────────────────
// 用户反馈「新增游戏的面板外显/悬停的样式、格式、规则和原来的差别很大」。本文件此前各写各的悬停，
// 三类偏差全中：① 首行塞元信息（来源站名/URL/SMW 时间/tz 推定/抓取条数/维护锚点）；
// ② 「档期在前、名称在后」；③ 自拼档期文本而非 fmtWindow。
// 修法：**排版一律交给 lib/env.js 的共用工具**（与本体 buildPoolHover / buildEventHover 逐字一致），
// 本区域只负责把解析结果映射成入参；悬停里**只剩** 名称/角色/档期。
// ⚠️ 元信息（来源站名、域名/URL、API/页面名、时区推定、抓取条数、内部 id、SMW 时间、起点锚点、
//    「起点推断」注记、游戏名+区服前缀、任何「（…）」实现说明）**直接删掉**，不搬家、不进任何字段。
//    实现说明只留在**代码注释**与数据字段（startInferred/startFrom/startRel）里，供测试与排查用。
function ns_bwiki_wikitext_nowOf(now) { return typeof now === "number" && Number.isFinite(now) ? now : Date.now(); }
// 覆盖 now 的条目（起点/终点都有绝对时刻才进候选；缺任一端的不产出）
function ns_bwiki_wikitext_activeItems(items, now) {
	return items.filter((it) => it.endTs != null && it.startTs != null && it.startTs <= now && it.endTs >= now);
}
// 卡池条目 → `hoverPool` 入参。`name` = 池名原文（工具用它判空/兜底），`label` = 外显同构的「池名：角色」
// （逐字照本体调用方：src/client/30-parsers.js 的 selectArknights`label: `${it.banner}：${it.roles}``）。
// ⚠️ 战双的池名形如「时崎狂三狙击 / 命运时崎狂三狙击」——**原样**当池名用，不自己编角色名。
function ns_bwiki_wikitext_poolItem(x) {
	const name = String(x.banner == null ? "" : x.banner).trim();
	const roles = String(x.roles == null ? "" : x.roles).trim();
	return {
		name,
		label: roles ? `${name}：${roles}` : name,
		startTs: x.startTs,
		endTs: x.endTs,
		raw: x.raw || ""
	};
}
// 活动条目 → `hoverEvent` 入参：显示的是**活动名**（不是「活动时间」这类标签）+ 档期。
function ns_bwiki_wikitext_eventItem(x, nameOf) {
	return { name: nameOf(x), startTs: x.startTs, endTs: x.endTs, raw: x.raw || "" };
}
// 卡池侧载荷。cmp 决定"外显"优先序；默认 = 结束最早优先（越快结束越该盯住，与 bwiki.js 同口径）。
// 悬停一律走共用 `hoverPool`：≥2 池 → 每池「池名：角色」行 + 档期行（窗口全同则只写一次档期）；
// **<2 池 → 不设 bannerHover**（交回 UI 的「banner：roles」⏎「档期」两行式兜底，与本体约定一致）。
function ns_bwiki_wikitext_gachaPayload(items, tz, now, opts = {}) {
	const act = ns_bwiki_wikitext_activeItems(items, now);
	if (act.length === 0) return null;                       // 有候选但都不覆盖当期 → 未公布（不硬凑过期档期）
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const hover = hoverPool(sorted.map(ns_bwiki_wikitext_poolItem), tz);
	const out = {
		banner: first.banner,
		roles: first.roles || "",
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs
	};
	if (hover) out.bannerHover = hover;
	return out;
}
// 活动侧载荷。cmp 决定外显优先序；悬停列出**全部覆盖当期**的条目（按同一排序，**名称在前**）。
// 悬停一律走共用 `hoverEvent`（名称 + 3 空格 + 档期；不排序，由调用方排好）：
// **<2 条 → 不设 eventHover**（交回 UI 的「event」⏎「eventDates|raw」兜底）。
function ns_bwiki_wikitext_eventPayload(items, tz, now, opts = {}) {
	const act = ns_bwiki_wikitext_activeItems(items, now);
	if (act.length === 0) return null;
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const nameOf = opts.nameOf || ((x) => x.name || x.event || "");
	const hover = hoverEvent(sorted.map((x) => ns_bwiki_wikitext_eventItem(x, nameOf)), tz, opts.permanentCount || 0);
	return {
		event: nameOf(first),
		eventDates: fmtWindow(first.startTs, first.endTs, tz),
		eventDatesRaw: first.raw || "",
		...(hover ? { eventHover: hover } : {})
	};
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ① 战双帕弥什 国服（zspms）
//    SMW ask 索引 → 最新「版本更新公告」→ prop=wikitext 正文抽档期
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_ZSPMS_TZ = "Asia/Shanghai";        // 推测：源站未标注（旁证见文件头）
const ns_bwiki_wikitext_ZSPMS_ASK_QUERY = "[[分类:游戏更新公告]][[类别::版本]]|?标题|?时间|sort=时间|order=desc|limit=40";
const ns_bwiki_wikitext_ZSPMS_ASK_URL = "https://wiki.biligame.com/zspms/api.php?action=ask&query="
	+ encodeURIComponent(ns_bwiki_wikitext_ZSPMS_ASK_QUERY) + "&format=json";
// ⚠️ `prop=wikitext`（**不是** prop=text）；页名必须 encodeURIComponent 后再拼（否则夹具整串键命中不到）
function ns_bwiki_wikitext_zspmsParseUrl(page) {
	return `https://wiki.biligame.com/zspms/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_ZSPMS_REFERER = "https://wiki.biligame.com/zspms/";

//#region 战双：SMW ask 索引
// 实测返回（fixtures/p8-zspms-ask）：
//   {"query-continue-offset":40,
//    "query":{"printrequests":[{"label":"标题",…},{"label":"时间",…}],
//             "results":{"《远信回响》版本更新公告":{"printouts":{"标题":["《远信回响》版本更新公告"],
//                                                              "时间":["20260922"]},
//                                                 "fulltext":"《远信回响》版本更新公告","fullurl":…,"namespace":0,"exists":"1"}},
//             "serializer":"SMW\\Serializers\\QueryResultSerializer","version":2,
//             "meta":{"hash":…,"count":40,"offset":0,…}}}
// ⚠️ `时间` 是**字符串** `"20260922"`（YYYYMMDD），**不是** SMW 的 timestamp 对象。
//    但仍做兼容：字符串 / 数组 / {timestamp} / {fulltext} 都吃。
function ns_bwiki_wikitext_smwText(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return ns_bwiki_wikitext_smwText(v[0]);
	if (typeof v === "object") {
		if (typeof v.timestamp === "number") return String(v.timestamp);
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}
// ask JSON → 按 `时间` 严格倒序的行 [{ page, title, time, fullurl }]
//   结构性损坏（无 query.results）→ 抛错；**0 条也抛错**：该查询依赖 `类别::版本`，
//   返回 0 条说明索引/属性坏了，绝不能静默降级成"未公布"（任务书明确要求）。
function ns_bwiki_wikitext_parseZspmsAsk(json) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("zspms-ask:bad-json");
	const rows = Object.entries(results).map(([page, v]) => {
		const p = (v && v.printouts) || {};
		return {
			page,
			title: ns_bwiki_wikitext_smwText(p["标题"]) || page,
			time: ns_bwiki_wikitext_smwText(p["时间"]),
			fullurl: (v && v.fullurl) || ""
		};
	});
	if (rows.length === 0) throw new Error("zspms-ask:no-result");
	rows.sort((a, b) => (b.time > a.time ? 1 : b.time < a.time ? -1 : 0));
	return rows;
}
//#endregion

//#region 战双：正文 → 档期
// `{{颜色引用|红|2026年9月24日版本更新后 - 2026年11月5日05:00}}` —— 档期**写在模板参数里**，
// 所以必须先剥模板（保留内文），否则整段档期都看不见。处理顺序：
//   ① `{{颜色引用|<色>|<正文>}}` → 只留 <正文>（档期就在这里）  ② `{{公告|…}}` 信息模板 → 整块丢弃（时间另取）
//   ③ 其它无参/单参模板 → 无参丢、有参留最后一个参数   ④ `'''` 粗体标记 → 去掉
//   ⑤ `[[file:…]]` → 去掉   ⑥ `<br>`/块级标签 → 换行（正文是 `<br>` 分行写的）
//   ⑦ 标题 `==X==` → 独立行，并打上 `\u0001H<level>\u0001` 前缀（后面要靠标题栈取活动名）
function ns_bwiki_wikitext_zspmsNormalize(wikitext) {
	let s = String(wikitext == null ? "" : wikitext);
	s = s.replace(/\{\{颜色引用\s*\|[^|{}]*\|([\s\S]*?)\}\}/g, "$1");
	s = s.replace(/\{\{公告[\s\S]*?\}\}/g, "");
	s = s.replace(/\{\{[^{}]*\}\}/g, (m) => { const i = m.lastIndexOf("|"); return i < 0 ? "" : m.slice(i + 1, -2); });
	s = s.replace(/'''/g, "");
	s = s.replace(/\[\[(?:file|File|文件)\s*:[^\]]*\]\]/g, "");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<\/?(?:hr|center|div|p|li|ul|ol|table|tr|td|th)\b[^>]*>/gi, "\n");
	s = s.replace(/<\/?(?:b|i|u|span|small|big|font|sup|sub)\b[^>]*>/gi, "");
	s = s.replace(/&nbsp;/gi, " ");
	// ⚠️ 标题必须**整行**匹配（加 m + ^$）：否则表格行 `{| class="wikitable" style="…"` 里的两个 `=`
	//    会被当成一级标题，往标题栈里塞一个假标题。
	s = s.replace(/^(={1,6})\s*([^=\n]+?)\s*\1\s*$/gm, (m, eq, title) => `\u0001H${eq.length}\u0001${title}`);
	return s;
}

// 停服维护窗口（源站原文，例：`我们将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
// 只在含「停服维护/停机维护」的那一行里找 `YY…MM…DD HH:MM - HH:MM`（终点可省日期）。
function ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz = ns_bwiki_wikitext_ZSPMS_TZ) {
	const line = String(text == null ? "" : text).split("\n").find((l) => /停服维护|停机维护|维护更新/.test(l) && /\d{4}\s*年/.test(l));
	if (!line) return null;
	const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[-–—－~～至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})/.exec(line);
	if (!m) return null;
	const y = +m[1], mo = +m[2], d = +m[3];
	const startTs = sourceInstant(y, mo, d, +m[4], +m[5], tz);
	let endTs = sourceInstant(y, mo, d, +m[6], +m[7], tz);
	if (endTs <= startTs) endTs = sourceInstant(y, mo, d + 1, +m[6], +m[7], tz);   // 跨零点的维护（如 22:00-02:00）
	if (!(endTs > startTs)) return null;
	const raw = `${y}-${pad2(mo)}-${pad2(d)} ${pad2(+m[4])}:${m[5]} - ${pad2(+m[6])}:${m[7]}`;
	return { startTs, endTs, raw };
}

// 中文年月日「起点 - 终点」窗口（源站墙钟原文形态）：
//   `2026年9月24日版本更新后 - 2026年11月5日05:00`（相对起点）
//   `2026年9月29日10:00 - 2026年11月3日23:59`（双端显式时刻）
//   `2026年9月24日 - 2026年10月1日`（双端只有日期 → 起点 00:00 / 终点 23:59）
// ⚠️ 内部空白只用 `[ \t]`（**不许跨行**）：否则维护段 `9月24日05:00 - 11:00` 会跟下一行的日期拼成假窗口。
const ns_bwiki_wikitext__SP = "[ \\t]*";
const ns_bwiki_wikitext__CN_DATE = "(\\d{4})" + ns_bwiki_wikitext__SP + "年" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "月" + ns_bwiki_wikitext__SP + "(\\d{1,2})" + ns_bwiki_wikitext__SP + "日";
const ns_bwiki_wikitext__CN_TIME = "(\\d{1,2})" + ns_bwiki_wikitext__SP + "[:：]" + ns_bwiki_wikitext__SP + "(\\d{2})";
const ns_bwiki_wikitext__CN_REL = "(版本更新后|维护结束后|维护后|更新结束后|更新后)";
const ns_bwiki_wikitext__CN_WIN_SRC = ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + "|" + ns_bwiki_wikitext__CN_REL + ")?" + ns_bwiki_wikitext__SP + "[-–—－~～至到]" + ns_bwiki_wikitext__SP
	+ ns_bwiki_wikitext__CN_DATE + ns_bwiki_wikitext__SP + "(?:" + ns_bwiki_wikitext__CN_TIME + ")?";

// 标题栈 → 该行的活动名。先取最内层标题；若它是通用容器标题（如 `4）活动时间`）→ 往上爬一级。
const ns_bwiki_wikitext__GENERIC_HEAD = /^(活动时间|活动说明|活动奖励|活动对象|活动规则|活动玩法|活动内容|活动时间如下)$/;
function ns_bwiki_wikitext_cleanHead(title) {
	return String(title == null ? "" : title)
		.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
		.replace(/^\d+\s*）\s*/, "")
		.replace(/^[一二三四五六七八九十]+\s*、\s*/, "")
		.replace(/[\s:：]+$/, "")
		.replace(/\s+/g, " ")
		.trim();
}
function ns_bwiki_wikitext_zspmsHeadings(lines) {
	const out = [];
	lines.forEach((l, i) => {
		const m = /^\u0001H(\d)\u0001(.*)$/.exec(l);
		if (m) out.push({ lineIdx: i, level: +m[1], title: ns_bwiki_wikitext_cleanHead(m[2]) });
	});
	return out;
}
function ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) {
	const stack = [];
	for (const h of heads) {
		if (h.lineIdx > lineIdx) break;
		while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
		stack.push(h);
	}
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title && !ns_bwiki_wikitext__GENERIC_HEAD.test(stack[i].title)) return stack[i].title;
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].title) return stack[i].title;
	return "";
}

// 活动时间标签（`活动时间：` / `•【勤务·限时任务】开放时间：` / `开启时间：` / `售卖时间：` …）
const ns_bwiki_wikitext__ZSPMS_LABEL_RE = /^[\s*•·\-]*?(?:【[^】]{1,20}】)?[ \t]*([^\s:：]{0,10}?(?:活动时间|开放时间|开启时间|售卖时间|持续时间|领取时间|兑换时间))[ \t]*[:：]/;

// 「研发池名」：`通过“淬炼活动角色” “命运淬炼活动角色”研发池产出/获得` → 池名数组
function ns_bwiki_wikitext_zspmsPools(line) {
	const m = /通过([^，。；\n]{1,90}?)研发池/.exec(line);
	if (!m) return [];
	return m[1].split(/[“”"'‘’「」\s&、]+/).map((x) => x.trim()).filter(Boolean);
}
// 池名前面最近的 `「…」`（就是产出物/角色，如 `「阿德莱德·破渊」`、`「时崎狂三」`）
function ns_bwiki_wikitext_zspmsRoleBefore(line, idx) {
	const head = line.slice(0, idx);
	const all = [...head.matchAll(/「([^」]{1,30})」/g)];
	return all.length ? all[all.length - 1][1].trim() : "";
}

// 正文 wikitext → { anchor, items:[{kind:"gacha"|"event", …}], skipped, headings }
// 条目标签：gacha = 窗口所在行提到「研发池」；event = 带时间标签 / 行首就是窗口 / 行内有「时间段内」。
// **一条都没解出来 → 抛错**（结构性损坏：版本更新公告不可能没有档期；不能静默当"未公布"）。
function ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz = ns_bwiki_wikitext_ZSPMS_TZ, askRow = null) {
	const raw = String(wikitext == null ? "" : wikitext);
	const timeField = ((raw.match(/\|\s*时间\s*=\s*(\d{8})/) || [])[1]) || (askRow && askRow.time) || "";
	const annDate = /^\d{8}$/.test(timeField)
		? { y: +timeField.slice(0, 4), mo: +timeField.slice(4, 6), d: +timeField.slice(6, 8) }
		: null;
	const text = ns_bwiki_wikitext_zspmsNormalize(raw);
	const maint = ns_bwiki_wikitext_zspmsMaintenanceWindow(text, tz);
	const lines = text.split("\n");
	const heads = ns_bwiki_wikitext_zspmsHeadings(lines);
	const items = [];
	let skipped = 0;
	const re = new RegExp(ns_bwiki_wikitext__CN_WIN_SRC, "g");
	let m;
	while ((m = re.exec(text))) {
		// —— 起点：显式时刻 > 相对锚点（① 源站维护结束时刻 → ② 公告时间字段[stellasora 先例] → ③ 自带日期）
		//    三条相对锚点路径都标 startInferred=true，并把依据写进 startFrom（hover 会如实显示）
		let startTs, startInferred = false, startFrom = "", startRel = "";
		if (m[4] != null) {
			startTs = sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
		} else if (m[6] != null) {
			startRel = m[6];
			startInferred = true;
			if (maint && maint.endTs != null) { startTs = maint.endTs; startFrom = `源站维护窗口 ${maint.raw} 的结束时刻`; }
			else if (annDate) { startTs = sourceInstant(annDate.y, annDate.mo, annDate.d, 0, 0, tz); startFrom = `公告时间 ${timeField}`; }
			else { startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz); startFrom = `自带日期 ${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`; }
		} else {
			startTs = sourceInstant(+m[1], +m[2], +m[3], 0, 0, tz);
			startInferred = true;
			startFrom = "源站只给日期，起点按 00:00";
		}
		// —— 终点（缺时刻按 23:59）
		const endTs = m[10] != null
			? sourceInstant(+m[7], +m[8], +m[9], +m[10], +m[11], tz)
			: sourceInstant(+m[7], +m[8], +m[9], 23, 59, tz);
		if (!(endTs > startTs)) { skipped++; continue; }             // 源站错行 → 丢弃，不硬造

		// —— 行上下文（分类 + 池名 + 活动名都只看本行）
		const lineStart = text.lastIndexOf("\n", m.index) + 1;
		let lineEnd = text.indexOf("\n", m.index);
		if (lineEnd < 0) lineEnd = text.length;
		const line = text.slice(lineStart, lineEnd);
		const lineIdx = text.slice(0, lineStart).split("\n").length - 1;
		const isPool = /研发池/.test(line);
		const base = {
			_i: items.length,
			startTs, endTs,
			raw: m[0],
			startInferred, startFrom, startRel,
			line: line.trim()
		};
		if (isPool) {
			const pools = ns_bwiki_wikitext_zspmsPools(line);
			const role = ns_bwiki_wikitext_zspmsRoleBefore(line, m.index - lineStart);
			items.push({
				...base,
				kind: "gacha",
				banner: pools.length ? pools.join(" / ") : (role || "研发池"),
				roles: role,
				pools
			});
			continue;
		}
		const labelM = ns_bwiki_wikitext__ZSPMS_LABEL_RE.exec(line);
		const stripped = line.replace(/^[\s*•·\-]+/, "");
		if (labelM || stripped.startsWith(m[0]) || /时间段内/.test(line)) {
			items.push({
				...base,
				kind: "event",
				label: labelM ? labelM[1] : "",
				name: ns_bwiki_wikitext_zspmsNameAt(heads, lineIdx) || (labelM ? labelM[1] : "活动")
			});
			continue;
		}
		skipped++;
	}
	if (items.length === 0) throw new Error("zspms-notice:no-window");     // 结构变了，当抓取失败
	return { anchor: maint ? { ts: maint.endTs, raw: maint.raw, how: "维护结束" } : null, announceTime: timeField, items, skipped, headings: heads };
}

// 活动外显优先序：① 剧情/挑战/演算这类"内容档"优先 ② 结束最早 ③ 开始最早 ④ 文档顺序
const ns_bwiki_wikitext__ZSPMS_TIER1 = /剧情|主线|故事|叙事|挑战|BOSS|Boss|试玩|玩法|关卡|演算|行动|作战|防卫|巡防|赛季|联合/;
function ns_bwiki_wikitext_zspmsEventTier(x) { return ns_bwiki_wikitext__ZSPMS_TIER1.test(x.name || "") ? 1 : 2; }
function ns_bwiki_wikitext_zspmsEventCmp(a, b) {
	return (ns_bwiki_wikitext_zspmsEventTier(a) - ns_bwiki_wikitext_zspmsEventTier(b)) || (a.endTs - b.endTs) || (a.startTs - b.startTs) || (a._i - b._i);
}
// ⚠️ 原先这里有个 zspmsHeader()：往悬停首行拼「战双帕弥什 bwiki 版本更新公告「…」（SMW 时间=…；…；tz=UTC+8
//    为推测；起点锚点=源站维护结束 …）」。按方案 A **整段删除**（元信息不进悬停，也不搬到别的字段）。
//    公告标题/SMW 时间/维护窗口仍是**数据字段**（announceTime / anchor / startFrom），解析逻辑不变。

// 两步抓取：ask 索引 → 最新公告正文。结构性损坏（无结果 / 坏 JSON / 正文无档期）都会抛错。
async function ns_bwiki_wikitext_zspmsLatestNotice(url, signal) {
	const rows = ns_bwiki_wikitext_parseZspmsAsk(await fetchJson(url || ns_bwiki_wikitext_ZSPMS_ASK_URL, { referer: ns_bwiki_wikitext_ZSPMS_REFERER, signal, mode: "proxy" }));
	const row = rows[0];
	if (!row || !row.page) throw new Error("zspms-ask:no-page");
	const wikitext = await ns_bwiki_wikitext_fetchWikitext(ns_bwiki_wikitext_zspmsParseUrl(row.page), signal, ns_bwiki_wikitext_ZSPMS_REFERER);
	return { row, rows, wikitext };
}
async function ns_bwiki_wikitext_gachaZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = Date.now()) {
	// `row`（ask 索引行）仍要传给解析器：`{{公告|时间=…}}` 缺失时用它兜底相对起点的锚点。
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_gachaPayload(parsed.items.filter((x) => x.kind === "gacha"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: (a, b) => (a.endTs - b.endTs) || (a._i - b._i)
	});
}
async function ns_bwiki_wikitext_eventsZspms(url, signal, tz = ns_bwiki_wikitext_ZSPMS_TZ, now = Date.now()) {
	const { row, wikitext } = await ns_bwiki_wikitext_zspmsLatestNotice(url, signal);
	const parsed = ns_bwiki_wikitext_parseZspmsAnnouncement(wikitext, tz, row);
	return ns_bwiki_wikitext_eventPayload(parsed.items.filter((x) => x.kind === "event"), tz, ns_bwiki_wikitext_nowOf(now), {
		cmp: ns_bwiki_wikitext_zspmsEventCmp,
		nameOf: (x) => x.name
	});
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ② 卡厄斯梦境 国服（czn）—— `Module:Gacha/data` 的 Lua 表
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_CZN_TZ = "Asia/Shanghai";          // 推测：10:00 开池 / 02:00 关池，国服作息
const ns_bwiki_wikitext_CZN_MODULE_PAGE = "Module:Gacha/data";
// ⚠️ 页面名写 `Module:Gacha/data`，但返回的 `parse.title` 是 **`模块:Gacha/data`**（中文命名空间别名）——
//    别拿 title 反查页面名。URL 里的 `%3A` / `%2F` 就是这两个分隔符。
const ns_bwiki_wikitext_CZN_MODULE_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_MODULE_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_RECORD_PAGE = "卡池记录";
const ns_bwiki_wikitext_CZN_RECORD_URL = `https://wiki.biligame.com/czn/api.php?action=parse&page=${encodeURIComponent(ns_bwiki_wikitext_CZN_RECORD_PAGE)}&prop=wikitext&format=json`;
const ns_bwiki_wikitext_CZN_REFERER = "https://wiki.biligame.com/czn/";

// `2026-5-28 10:00:00`（月/日**不补零**，秒可省）→ { y, mo, d, h, mi }
function ns_bwiki_wikitext_cznStamp(text) {
	const m = /^\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[ \t]+(\d{1,2})\s*[:：]\s*(\d{2}))?(?:\s*[:：]\s*(\d{2}))?\s*$/.exec(String(text == null ? "" : text));
	if (!m) return null;
	const h = m[4] != null ? +m[4] : 0, mi = m[5] != null ? +m[5] : 0;
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi };
}
// Lua 表 → 6 期 [{ id, type, char, startTs, endTs, raw }]
// 实测形态（fixtures/p8-czn-module，999B，6 期）：
//   return { ["0001"] = { type = "主战员营救概率提升", start_date = "2026-5-28 10:00:00",
//                          end_date = "2026-6-17 02:00:00", link_char = "绯", }, … }
function ns_bwiki_wikitext_parseCznLua(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const entryRe = /\[\s*"([^"]+)"\s*\]\s*=\s*\{([\s\S]*?)\}/g;
	let m;
	while ((m = entryRe.exec(src))) {
		const body = m[2];
		const f = {};
		for (const fm of body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) f[fm[1]] = fm[2];
		const a = ns_bwiki_wikitext_cznStamp(f.start_date), b = ns_bwiki_wikitext_cznStamp(f.end_date);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;                       // 源站错行 → 丢弃
		items.push({
			_i: items.length,
			id: m[1],
			type: f.type || "",
			char: f.link_char || "",
			startTs, endTs,
			raw: `${f.start_date} ~ ${f.end_date}`
		});
	}
	if (items.length === 0) throw new Error("czn-lua:no-entry");   // 结构变了（Lua 表被改/页面空）→ 抓取失败
	return items;
}
// 备选页 `卡池记录`（**只有 1 条**模板调用，2026/03，已过期；本文件只导出纯函数，不挂抓取器）：
//   {{Gacha|id=TEST|title=小春概率UP|type=救援概率UP|Start_Date=2026/03/22 8:59:00|End_Date=2026/03/27 8:59:00|UP=小春|banner=…}}
function ns_bwiki_wikitext_parseCznRecord(wikitext, tz = ns_bwiki_wikitext_CZN_TZ) {
	const src = String(wikitext == null ? "" : wikitext);
	const items = [];
	const callRe = /\{\{\s*Gacha\s*\|([\s\S]*?)\}\}/g;
	let m;
	while ((m = callRe.exec(src))) {
		const f = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			f[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		const a = ns_bwiki_wikitext_cznStamp(f["Start_Date"]), b = ns_bwiki_wikitext_cznStamp(f["End_Date"]);
		if (!a || !b) continue;
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) continue;
		items.push({
			_i: items.length,
			id: f.id || "",
			banner: f.title || "卡池",
			roles: f.UP || "",
			cat: f.type || "",
			startTs, endTs,
			raw: `${f["Start_Date"]} ~ ${f["End_Date"]}`
		});
	}
	return items;
}
// 卡池外显：**开始最新**的覆盖档（与 bestdori/sekai/stellasora 的"最新开始"同口径：
// 卡厄斯这 6 期是两两成对的三批，最新一批 = 赛季限定）
// ⚠️ 原先此处给 `ns_bwiki_wikitext_gachaPayload` 传了 header「卡厄斯梦境 bwiki Module:Gacha/data（Lua 表 6 期；tz=UTC+8 为推测）」
//    —— 那是悬停元信息（来源站名 / API 名 / 抓取条数 / 时区推定），按方案 A **整段删除**。
//    Lua 表页名/期数仍是**数据**（ns_bwiki_wikitext_CZN_MODULE_PAGE / items.length），注释与注册表里都有，不进悬停。
async function ns_bwiki_wikitext_gachaCzn(url, signal, tz = ns_bwiki_wikitext_CZN_TZ, now = Date.now()) {
	const items = ns_bwiki_wikitext_parseCznLua(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_CZN_MODULE_URL, signal, ns_bwiki_wikitext_CZN_REFERER), tz)
		.map((x) => ({ ...x, banner: `${x.type}（${x.char}）`, roles: x.char }));
	return ns_bwiki_wikitext_gachaPayload(items, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
//#endregion

// ══════════════════════════════════════════════════════════════════════════════
// ③ 雪松（kedrgame）—— `Template:首页游戏版本内容` 的 `{{时间进度条|…}}` 调用
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_KEDR_TZ = "Asia/Shanghai";         // 推测：每期 05:00 换池（与 P6 社区页旁证一致）
// ⚠️ **必须带 `Template:` 前缀**：不带前缀返回 `{"code":"missingtitle"}`（HTTP 仍 200）；
//    返回的 `parse.title` 是 `模板:首页游戏版本内容`（中文命名空间别名）。
const ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE = "Template:首页游戏版本内容";
function ns_bwiki_wikitext_kedrTemplateUrl(page = ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE) {
	return `https://wiki.biligame.com/kedrgame/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_KEDR_TEMPLATE_URL = ns_bwiki_wikitext_kedrTemplateUrl();
const ns_bwiki_wikitext_KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";

// `{{时间进度条|开始时间=2026/10/02 05:00|结束时间=2026/10/09 05:00|名称=【精英集结·支援】西尔维亚|链接=…|倒计时名称=…}}`
// → 参数对象数组。`<!-- -->` 注释块先剥掉（页尾注释里有一堆 `{{板块|按钮|…}}`，虽不含时间进度条，防患于未然）。
function ns_bwiki_wikitext_kedrTemplateCalls(wikitext) {
	const src = String(wikitext == null ? "" : wikitext).replace(/<!--[\s\S]*?-->/g, "");
	const out = [];
	const re = /\{\{\s*时间进度条\s*\|([^{}]*)\}\}/g;
	let m;
	while ((m = re.exec(src))) {
		const params = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		out.push(params);
	}
	return out;
}
// `2026/10/02 05:00`（月/日不补零，秒可省）
function ns_bwiki_wikitext_kedrStamp(text) { return ns_bwiki_wikitext_cznStamp(text); }
// 卡池 vs 活动分流（任务书口径）：含 `精英集结`/`演习`（雪松的抽卡系统叫「动员」，池名形如【精英集结·支援】）= 卡池；
// 含 `活动`/`赛季`/`通行证`/`剧情` = 活动。
function ns_bwiki_wikitext_kedrIsGacha(name) { return /精英集结|演习|动员|卡池/.test(String(name == null ? "" : name)); }
function ns_bwiki_wikitext_kedrIsEvent(name) {
	const n = String(name == null ? "" : name);
	if (ns_bwiki_wikitext_kedrIsGacha(n)) return false;
	return /活动|赛季|通行证|剧情|战令|防卫|挑战/.test(n);
}
// `【精英集结·支援】西尔维亚` → `西尔维亚`（`】` 之后就是 UP 角色）
function ns_bwiki_wikitext_kedrRoleFromName(name) {
	const m = /】\s*(.+?)\s*$/.exec(String(name == null ? "" : name));
	return m ? m[1].trim() : "";
}
// 模板 wikitext → { gacha:[…], event:[…], skipped }
// **一条时间进度条都没有 → 抛错**（模板被清空/改版 = 结构性损坏，不当"未公布"）
function ns_bwiki_wikitext_parseKedrTemplate(wikitext, tz = ns_bwiki_wikitext_KEDR_TZ) {
	const calls = ns_bwiki_wikitext_kedrTemplateCalls(wikitext);
	if (calls.length === 0) throw new Error("kedr-template:no-call");
	const gacha = [], event = [];
	let skipped = 0;
	calls.forEach((p, i) => {
		const name = String(p["名称"] || "").trim();
		const a = ns_bwiki_wikitext_kedrStamp(p["开始时间"]), b = ns_bwiki_wikitext_kedrStamp(p["结束时间"]);
		if (!name || !a || !b) { skipped++; return; }            // 缺名称/档期 → 跳过，不硬造
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }
		const item = {
			_i: i, name, startTs, endTs,
			raw: `${p["开始时间"]} ~ ${p["结束时间"]}`,
			link: p["链接"] || "", timer: p["倒计时名称"] || ""
		};
		if (ns_bwiki_wikitext_kedrIsGacha(name)) gacha.push({ ...item, banner: name, roles: ns_bwiki_wikitext_kedrRoleFromName(name) });
		else if (ns_bwiki_wikitext_kedrIsEvent(name)) event.push(item);
		else skipped++;
	});
	if (gacha.length + event.length === 0) throw new Error("kedr-template:no-window");
	return { gacha, event, skipped, calls };
}
// ⚠️ 原先这里有个 _KEDR_HEADER：「雪松 bwiki Template:首页游戏版本内容（社区维护；【精英集结】/【演习】= 卡池，
//    活动/赛季/通行证/剧情 = 活动；tz=UTC+8 为推测）」——悬停元信息（来源站名/页面名/分流口径/时区推定），
//    按方案 A **整段删除**（分流规则仍在 ns_bwiki_wikitext_kedrIsGacha / ns_bwiki_wikitext_kedrIsEvent 的注释里）。
// 卡池：开始最新的覆盖档（该模板是**当期**面板，两条卡池同窗口 → 取文档顺序第一条）
async function ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = Date.now()) {
	const { gacha } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_gachaPayload(gacha, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
// 活动：开始最新的覆盖档（个人剧情活动 > 战令通行证赛季 / 边境防卫）
async function ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = Date.now()) {
	const { event } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_eventPayload(event, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i), nameOf: (x) => x.name });
}
//#endregion

		// ===== 内联自 next-sources/parsers/biligame-activity.js（模块级标识符已加 ns_biligame-activity_ 前缀）=====

// next-sources/parsers/biligame-activity.js —— biligame 官方公告（活动/卡池档期）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null（null = 未公布）
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover? }        （eventHover 缺省 = 当期只有 1 条）
//   · 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover? }
//   本文件服务两个游戏（同一套官方接口 api.biligame.com/news）：
//     ① 物华弥新 国服 —— **只做活动侧**（卡池侧仍用 B2 的 bwiki `限时招集档案`，见 registry-p9.js）
//     ② 闪耀优俊少女 国服 —— 卡池 + 活动两侧（**取代** B2 的 bwiki 推算表作主源）
//
//   ══ 悬停（hover）规则 —— 用户 2026-10-03 反馈「新增游戏的面板外显/悬停的样式、格式、规则
//      和原来的差别很大」，核实后确认三类偏差，本文件按「方案 A」全部修掉 ══
//     · 排版唯一真源 = `lib/env.js` 的 `hoverPool` / `hoverEvent`（与本体 buildPoolHover /
//       buildEventHover **逐字一致**），本文件**不自己拼字符串**、不排序（工具不排序，调用方排）。
//     · 活动侧 ≥2 条：每条一行「名称 + 3 空格 + 档期（fmtWindow）」，按结束时间升序；
//       只有 1 条 → 工具返回 "" → **不设** `eventHover`，交回 UI 默认两行式（`event` ⏎ `eventDates`）。
//     · 卡池侧 ≥2 池：每池「池名：角色」⏎ 档期（窗口全同则档期只在末尾写一遍）；
//       只有 1 池 → 工具返回 "" → **不设** `bannerHover`，交回 UI 默认两行式（`banner：roles` ⏎ 档期）。
//     · 悬停里**只放名称与档期**：来源站名 / URL / API 名 / 时区推定说明 / 抓取统计 /
//       内部 id（gameExtensionId、typeId、post_id）/ 游戏名+区服前缀 / 任何「（…）」实现说明
//       一律**彻底不进悬停文本**（用户原话「元信息彻底删掉」）——只留在**代码注释**与
//       `parse*` 的返回字段里（供测试与排障），**不搬到别处、不写进别的字段**。
//       ⚠️ 例外：`bannerDatesRaw` / `eventDatesRaw` 照既有约定**保留源站原文**（本体也有条目这么做）。
//
// ── 为什么不再 import `biligame-announce.js`（P6 嘟嘟脸，同形态）─────────────
//   思路/函数确实同源（列表 → 逐条详情 → 正文抽档期 → 挑覆盖 now 的窗口 → 抽不到就 null），
//   但**插件合并器 `diag/handoff-2026/merge-next-sources.mjs` 按文件做命名空间隔离**：
//   它剥掉每个解析器的 import/export 并给本文件的声明加 `ns_<file>_` 前缀，
//   **并不会重命名别的解析器文件里 import 进来的名字** → 跨解析器 import 会在生成物里变成
//   `ns_biligame_activity_decodeExtra is not defined`。故本文件自带一份 `ns_biligame_activity_decodeExtra`（与 biligame-announce.js 同表），
//   只 import `lib/env.js` 的名字（那些由合并器的桥接适配器顶上）。
//
// ══ 接口实测形态（2026-10-02 抓夹具）════════════════════════════════════════
// 列表：GET https://api.biligame.com/news/list?gameExtensionId=<id>&positionId=2&typeId=<t>&pageNum=1&pageSize=50
//   → { request_id, data:[…], totalNum, pageNo, code:0, ts }
//   条目 = { id, title, typeId, displayTime?, ctime, mtime, content(截断), createTime, modifyTime }
//   ⚠️ `positionId=2` **必填**（省略返回空）；条目里 `displayTime` **可能缺**（实测物华弥新
//      typeId=4 有 5/36 条没有、typeId=1 有 10/17 条没有）→ 排序键必须退到 `ctime`。
//   ⚠️ 列表里的 `content` 是**截断**的 → 正文档期只能抓详情 `/news/{id}`。
// 详情：GET https://api.biligame.com/news/<id>
//   → { request_id, data:{ id, title, content(完整 HTML), displayTime, typeName, typeId,
//                          gameExtensionId, site, author }, gameInfo, code:0, ts }
//   夹具里 `data.site` / `data.gameExtensionId` 是**独立印证**：
//     18419 → site=物华弥新 gid=613 ；18426 → site=闪耀！优俊少女 gid=1006 。
//
// ══ ① 物华弥新 国服（gameExtensionId=613）══════════════════════════════════
//   ⚠️⚠️ **两路 typeId 都要拉，缺一会丢档期**（实测）：
//     typeId=4（`typeName=活动`）totalNum=36，最新 2026-09-30 id=18419「经以山海」限时活动开启
//     typeId=1（`typeName=公告`）totalNum=17，**最新 2026-09-10 id=18334「无稽妄语」限时活动开启**
//       —— 18334 这条**不在 typeId=4 里**（两路 id 集合实测**零重叠**：36 ∩ 17 = ∅）
//   合并规则：按 id 去重 + 按 `displayTime||ctime` 严格倒序（实测合并后前 6 条 =
//   18419 / 18334 / 18265 / 18194 / 18109 / 18047，夹具都抓了前 5 条详情）。
//
//   ══ 正文档期形态（**注意：与任务书里的猜测不同，这里是实测原文**）══
//     `活动时间：9月23日 10:00 ~ 10月22日 09:59`      ← **不带年份、用「月日」**
//     `活动时间：9月30日 10:00 ~ 常驻`                 ← 终点是「常驻」= 无终点 → **不产出**
//     标题与档期**不在同一段**：`<p>一、旅程将启-经以山海</p>` + `<p>活动时间：…</p>`
//     ⇒ 按 `</p>` 切段后，用小节标题（`一、…`）+ 紧随其后的 `活动时间：` 行配对。
//     年份推断：源站只写「月日」→ 取**该公告 displayTime 的年份**；起月比发布月大 6 个月以上
//     视为上一年（跨年公告），终点若比起点早就 +1 年。（夹具里所有窗口都同年，无需跨年。）
//     kind：小节标题含 `招集|招募|引介|卡池|扭蛋` → 卡池侧，其余 → 活动侧（本文件活动侧只用后者）。
//
//   ══ 外显取哪一条？══
//     同一份公告里有十几条「活动时间」（登录活动、主线活动、试炼场、衣装…全都叫「活动时间」）。
//     规则：① 覆盖 now 优先；② 小节名与**标题里引号中的活动名**完全一致者优先
//     （18419 标题「经以山海」限时活动开启 → 小节`四、经以山海`；18334 → 小节`二、无稽妄语`），
//     ③ 其次结束最早；④ 并列按文档顺序。⇒ 取到的是本期**主线活动**，而不是最早结束的登录活动。
//
// ══ ② 闪耀优俊少女 国服（gameExtensionId=1006）══════════════════════════════
//   ⚠️ **只有单一 feed（typeId=1）且卡池/活动混排**（totalNum=671，一页 50）。
//     `typeId=4`（活动专类）实测**已停更**（13 条，停在 2026-04-19）→ **不用它**。
//   标题分流（任务书口径）：
//     卡池 = 标题含 `招募` / `扭蛋` / `必得`（先判卡池：`…庆典招募开放！` 里也含「活动」字样）
//     活动 = 标题含 `活动` / `赛事` / `剧情` / `举办`
//     两者都不含 → **跳过**（如`养成剧本…开放！`/`部分养成优俊少女追加进化技能！`），不抓详情。
//   ⚠️ 正文档期形如：`10/2 12:00 ～ 10/13 11:59`（**全角波浪 `～`**、**不带年份**、**月/日**），
//     且**标签常与前一段或同段共存**：
//       <p>精选招募开放期间</p><p>10/2 12:00 ～ 10/13 11:59</p>      ← 上一段是标签
//       <p>活动期间 10/1 12:00 ～ 10/711:59</p>                      ← 同段；⚠️ 源站**少了一个空格**
//     ⇒ 标签取「同段内窗口之前的文字」，空则退回「上一段非窗口段」。
//     ⚠️ 实测源站笔误 `10/711:59`（18423 活动期间）：日期与时刻**粘连**。本解析器用
//        `ns_biligame_activity_deglueDateTimes()` 归一成 `10/7 11:59`，并记 `glued:true` + `rawNorm`（供测试与排障）。
//        ⚠️ 这条说明**只留在这里**：旧版曾把它拼成一个「（源站原文…粘连…）」括号注进悬停 → 已删。
//     外显挑选：同一条公告里常有多个「…期间」（活动期间 / 奖励领取期间 / 报名期间 / 第N轮…）→
//       卡池侧优先标签含`招募`的窗口，活动侧优先`活动期间`，其次含`期间|时间`，最后其它；同级结束早者先。
//
// ══ 时区 tz = Asia/Shanghai（**推测，但有逐字交叉印证**）════════════════════
//   源站**不标时区**。交叉印证：公告 `displayTime`（B 站 CMS 发布时刻）与正文档期墙钟**逐字一致**：
//     · 18419 displayTime=2026-09-30 10:00:00 ↔ 正文`活动时间：9月30日 10:00 ~ …`
//     · 18426 displayTime=2026-10-02 12:00:00 ↔ 正文`10/2 12:00 ～ 10/13 11:59`
//   ⇒ 正文墙钟与 CMS 同一口径；B 站 CMS 为 UTC+8 → 记 Asia/Shanghai。（仍是**推定**，不是源站声明。）
//   绝对时刻一律走 `sourceInstant(...)`，文本一律走 `fmtWindow(...)`（源站墙钟原文不重解释）。
//
// ══ EdgeOne/抓取注意 ══
//   `api.biligame.com` **无 ACAO**（调研实测）→ mode 一律 "proxy"，**不可 direct**。
//   抓夹具时别并发太猛（列表+详情共 11 次请求，实测每 7~9 秒一发全部 HTTP 200）。


const ns_biligame_activity_BILIGAME_ACTIVITY_TZ = "Asia/Shanghai";
const ns_biligame_activity_WHMX_GAME_EXTENSION_ID = 613;
const ns_biligame_activity_UMA_CN_GAME_EXTENSION_ID = 1006;
// 物华弥新：4=活动专类 / 1=公告（两路 id 实测零重叠，缺一路就丢档期）
const ns_biligame_activity_WHMX_TYPE_IDS = [4, 1];
const ns_biligame_activity_WHMX_LIST_URL = ns_biligame_activity_biligameListUrl(ns_biligame_activity_WHMX_GAME_EXTENSION_ID, ns_biligame_activity_WHMX_TYPE_IDS[0]);
// 两路 URL（注册表只声明主 URL=typeId 4；解析器会自行派生 typeId 1 那路，见 ns_biligame_activity_whmxListUrls()）
const ns_biligame_activity_WHMX_LIST_URLS = ns_biligame_activity_WHMX_TYPE_IDS.map((t) => ns_biligame_activity_biligameListUrl(ns_biligame_activity_WHMX_GAME_EXTENSION_ID, t));
const ns_biligame_activity_UMA_CN_LIST_URL = ns_biligame_activity_biligameListUrl(ns_biligame_activity_UMA_CN_GAME_EXTENSION_ID, 1);
const ns_biligame_activity_WHMX_HOME = "https://game.bilibili.com/whmx/";
const ns_biligame_activity_UMA_CN_HOME = "https://game.bilibili.com/umamusume/";
// 逐条往下抓详情的上限（公告很稀疏：一天最多 1~2 篇，但档期藏在正文里）
const ns_biligame_activity_DETAIL_LIMIT_WHMX = 6;
const ns_biligame_activity_DETAIL_LIMIT_UMA = 8;

// 列表 URL 构造：positionId=2 **必填**（实测省略返回空），pageSize=50 足够（两游戏都 < 700 且只取最新的）
function ns_biligame_activity_biligameListUrl(gameExtensionId, typeId, pageSize = 50) {
	return `https://api.biligame.com/news/list?gameExtensionId=${gameExtensionId}`
		+ `&positionId=2&typeId=${typeId}&pageNum=1&pageSize=${pageSize}`;
}
// 同一参数空间里换另一路 typeId（物华弥新两路都拉）——只改 typeId，其余参数原样，保证
// 「夹具 URL ⇄ 解析器实际请求的 URL」字符串完全一致（离线夹具按整串命中）
function ns_biligame_activity_siblingListUrl(listUrl, typeId) {
	try {
		const u = new URL(listUrl);
		u.searchParams.set("typeId", String(typeId));
		return u.toString();
	} catch {
		return ns_biligame_activity_biligameListUrl(ns_biligame_activity_WHMX_GAME_EXTENSION_ID, typeId);
	}
}
function ns_biligame_activity_whmxListUrls(listUrl = ns_biligame_activity_WHMX_LIST_URL) {
	const primary = listUrl || ns_biligame_activity_WHMX_LIST_URL;
	let t = ns_biligame_activity_WHMX_TYPE_IDS[0];
	try { t = Number(new URL(primary).searchParams.get("typeId")) || t; } catch { /* keep */ }
	const other = ns_biligame_activity_WHMX_TYPE_IDS.find((x) => x !== t) || t;
	const out = [primary];
	const second = ns_biligame_activity_siblingListUrl(primary, other);
	if (second !== primary) out.push(second);
	return out;
}
function ns_biligame_activity_biligameDetailUrl(listUrl, id) {
	let origin = "https://api.biligame.com";
	try { origin = new URL(listUrl || ns_biligame_activity_WHMX_LIST_URL).origin; } catch { /* keep default */ }
	return `${origin}/news/${id}`;
}

//#region 文本工具（本文件自带；见文件头「为什么不再 import」）
// lib/env.js 的 decodeEntities 只覆盖少量实体，公告正文里的这几个高频实体本地补齐（不改 lib/）
const ns_biligame_activity_ENT_EXTRA = {
	middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–", nbsp: " ",
	lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sup2: "²", sup3: "³",
	yen: "¥", deg: "°", bull: "•", copy: "©", reg: "®", hearts: "♥", star: "★"
};
function ns_biligame_activity_decodeExtra(s) {
	return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
		const v = ns_biligame_activity_ENT_EXTRA[String(k).toLowerCase()];
		return v != null ? v : m;
	}));
}
function ns_biligame_activity_plain(html) { return ns_biligame_activity_decodeExtra(textOf(html)); }
// 按 </p> 切段（公告正文的每个逻辑单元都是 <p>；textOf 的行会把多段粘一起，不能用）
function ns_biligame_activity_biligameParagraphs(html) {
	return String(html == null ? "" : html)
		.split(/<\/p\s*>/i)
		.map((chunk) => ns_biligame_activity_plain(chunk).replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
//#endregion

//#region 悬停排版（**只有名称与档期**，见文件头「悬停规则」）
// 本区域只做两件事：① 从「覆盖 now 的档期」里取出名称；② 按结束时间升序排好交给共用工具。
// 排版（3 空格 / 档期格式化 / 窗口全同只写一遍 / <2 条返回 ""）**全在 lib/env.js**，这里绝不自拼。
//
// ⚠️ 为什么这里有注释而悬停里没有：来源/URL/tz 推定/抓取条数/内部 id 都是**排障信息**，
//    用户明确要求「元信息彻底删掉」→ 只留在代码注释与 `parse*` 的返回字段（skipped / section /
//    label / raw…）里，**不搬到别处、不写进别的字段**。
// ⚠️ 「常驻不产出」「源站日期与时刻粘连」这类**实现说明**同样不进悬停（旧版曾拼在 hover 里）。
function ns_biligame_activity_byEndAsc(a, b) { return (a.endTs - b.endTs) || (a.startTs - b.startTs); }
// 覆盖 now 的档期 → 悬停行（`name` 由调用方给的 nameOf 决定；空名行直接丢弃，不硬造占位名）
function ns_biligame_activity_hoverRows(covering, nameOf) {
	return (covering || [])
		.slice()
		.sort(ns_biligame_activity_byEndAsc)
		.map((x) => {
			const name = String(nameOf(x) || "").trim();
			return name ? { name, startTs: x.startTs, endTs: x.endTs, raw: x.raw } : null;
		})
		.filter(Boolean);
}
// ① 物华弥新 活动侧：名称 = 源站小节名（`四、经以山海` → `经以山海`），缺小节时退回段落标签
function ns_biligame_activity_whmxEventHover(covering, tz) {
	return hoverEvent(ns_biligame_activity_hoverRows(covering, (x) => x.section || x.label), tz);
}
// ② 闪耀优俊少女 活动侧：名称 = 源站期间标签（`活动期间` / `第1轮` / `决赛轮：匹配期间` …）；
//    标签缺失时退回公告标题（= 该活动的名字），仍为空则整行丢弃。
//    多条期间属于**同一份公告**，因此每行只写期间名 + 档期，不再重复活动名（同一个名字重复 N 遍没有信息量）。
function ns_biligame_activity_umaCnEventHover(covering, tz, fallbackName = "") {
	return hoverEvent(ns_biligame_activity_hoverRows(covering, (x) => x.label || fallbackName), tz);
}
// ③ 闪耀优俊少女 卡池侧：每池写「池名：角色」（与本体 `banner：roles` 同构；无角色时只写池名）。
//    池名取**源站期间标签**（`精选招募开放期间` / `开放期间`）：同一份公告可能同时开着多个期间，
//    若用公告标题，每池同名 → `hoverPool` 会输出重复行。列出的期间集合 = 原有「覆盖 now」集合，
//    **当期判定不变**（本次只改 hover 拼装，不动外显/档期字段）。
function ns_biligame_activity_umaCnPoolHover(covering, tz, rolesText = "", fallbackName = "") {
	const suffix = rolesText ? `：${rolesText}` : "";
	return hoverPool(ns_biligame_activity_hoverRows(covering, (x) => `${x.label || fallbackName}${suffix}`), tz);
}
//#endregion

//#region 列表
// 列表 JSON → [{ id, title, typeId, displayTime, ctime, sortKey, dateTs }]，严格按生效时刻倒序
function ns_biligame_activity_parseBiligameList(json) {
	if (!json || typeof json !== "object") throw new Error("biligame-bad-json");
	if (json.code !== 0) throw new Error("biligame-code-" + json.code);
	if (!Array.isArray(json.data)) throw new Error("biligame-bad-json");
	return json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => {
			const displayTime = x.displayTime || "";
			const ctime = x.ctime || "";
			const sortKey = displayTime || ctime;      // 实测大量条目缺 displayTime → 退 ctime
			return {
				id: x.id,
				title: ns_biligame_activity_decodeExtra(x.title).replace(/\s+/g, " ").trim(),
				typeId: x.typeId,
				displayTime,
				ctime,
				sortKey,
				dateTs: ns_biligame_activity_parseCmsStamp(sortKey)
			};
		})
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
}
// "2026-09-30 10:00:00"（CMS 发布时刻，不带时区后缀）→ 绝对毫秒（按 tz 解释墙钟）
function ns_biligame_activity_parseCmsStamp(s, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}
// 多路 feed 合并：按 id 去重（先到先得）+ 严格倒序（实测两路 id 零重叠，但去重仍必要）
function ns_biligame_activity_mergeBiligameLists(groups) {
	const seen = new Set();
	const out = [];
	for (const g of groups || []) {
		for (const it of g || []) {
			if (seen.has(it.id)) continue;
			seen.add(it.id);
			out.push(it);
		}
	}
	return out.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
}
//#endregion

//#region 档期抽取：源站墙钟（月日、可能缺年份）→ 窗口
// ⚠️ 实测源站笔误：`10/711:59`（日期与时刻粘连，见 18423 活动期间）。
//    只处理「日期数字 ≥3 位且紧跟 HH:MM」的形态（正常运行写法 `10/7 11:59` / `9月23日 10:00` 不受影响），
//    按「末 2 位为小时」优先切分（`711` → 7 日 11 时），若日不合法再试「末 1 位为小时」。
//    ins（可选）：收集插入的空格位置，供 `raw` 回到**源站原文**（契约要求 raw 保留原文）。
const ns_biligame_activity_GLUE_RE = /([\/\-.]|月|日)(\d{2,4})\s*[:：]\s*(\d{2})/g;
function ns_biligame_activity_deglueDateTimes(s, ins = null) {
	const src = String(s == null ? "" : s);
	let out = "", last = 0;
	ns_biligame_activity_GLUE_RE.lastIndex = 0;
	let m;
	while ((m = ns_biligame_activity_GLUE_RE.exec(src)) !== null) {
		if (m[0] === "") { ns_biligame_activity_GLUE_RE.lastIndex++; continue; }
		const run = m[2];
		if (run.length < 3) continue;                 // 正常写法（`日 10:00` / `10:00`）→ 原样
		let day = null, hour = null;
		const d2 = run.slice(0, run.length - 2), h2 = run.slice(-2);
		if (d2 !== "" && +d2 >= 1 && +d2 <= 31 && +h2 <= 23) { day = d2; hour = h2; }
		else {
			const d1 = run.slice(0, run.length - 1), h1 = run.slice(-1);
			if (d1 !== "" && +d1 >= 1 && +d1 <= 31 && +h1 <= 23) { day = d1; hour = h1; }
		}
		if (day == null) continue;
		out += src.slice(last, m.index) + m[1] + day;
		if (ins) ins.push({ normIndex: out.length, srcIndex: m.index + m[1].length + run.length });
		out += " " + hour + ":" + m[3];
		last = m.index + m[0].length;
	}
	return out + src.slice(last);
}
// 归一化坐标 → 源站坐标（因为只插入了空格，逐个抵消即可）
function ns_biligame_activity_toSourceRange(normStart, normEnd, ins) {
	let s = normStart, e = normEnd;
	for (const p of ins) {
		if (p.normIndex < normStart) s--;
		if (p.normIndex < normEnd) e--;
	}
	return { s, e };
}
// 令牌表：① 完整「日期+时刻」 ② 只有日期（止点缺时刻时兜底） ③ 区间分隔符 ④ 「常驻/永久」= 无终点
//   日期形态涵盖实测两种：`9月23日 10:00`（无年）与 `2026/09/30 10:00`（带年）
const ns_biligame_activity_TOK_RE = new RegExp([
	"(?<stamp>(?:(?<sy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<smo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<sd>\\d{1,2})\\s*日?\\s*(?<sh>\\d{1,2})\\s*[:：]\\s*(?<smi>\\d{2}))",
	"(?<date>(?:(?<dy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<dmo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<dd>\\d{1,2})\\s*日?)",
	"(?<sep>[~\uff5e\u301c\u223c至到]|\\s[-\\u2013\\u2014\\uff0d]\\s|[-\\u2013\\u2014\\uff0d])",
	"(?<perm>常驻|永久)"
].join("|"), "g");
function ns_biligame_activity_tokenizeWindows(text) {
	const out = [];
	ns_biligame_activity_TOK_RE.lastIndex = 0;
	let m;
	while ((m = ns_biligame_activity_TOK_RE.exec(text)) !== null) {
		if (m[0] === "") { ns_biligame_activity_TOK_RE.lastIndex++; continue; }
		const g = m.groups || {};
		const at = m.index, end = m.index + m[0].length;
		if (g.stamp != null) {
			const t = { kind: "stamp", text: g.stamp, at, end, y: g.sy ? +g.sy : null, mo: +g.smo, d: +g.sd, h: +g.sh, mi: +g.smi };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31 && t.h <= 23 && t.mi <= 59) out.push(t);
		} else if (g.date != null) {
			const t = { kind: "date", text: g.date, at, end, y: g.dy ? +g.dy : null, mo: +g.dmo, d: +g.dd, h: null, mi: null };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31) out.push(t);
		} else if (g.sep != null) {
			out.push({ kind: "sep", text: g.sep, at, end });
		} else if (g.perm != null) {
			out.push({ kind: "perm", text: g.perm, at, end });
		}
	}
	return out;
}
// 源站不写年份时的补全：以公告发布年为准；起月比发布月大 6 个月以上 → 视为上一年（跨年公告）
function ns_biligame_activity_yearOf(y, mo, hint) {
	if (y != null) return y;
	if (!hint || hint.y == null) return null;
	return mo > hint.mo + 6 ? hint.y - 1 : hint.y;
}
// 一段文本 → { norm, windows:[{ startTs, endTs, raw(源站原文), rawNorm(归一化后), glued, perm? }] }
//   · 起点必须带时刻（令牌 ①）  · 终点可以是时刻/日期（缺时刻 → 23:59）/「常驻」
//   · 年份抽不出来（源站无年份且公告也没年份）→ 该窗口进 skipped，不产出
function ns_biligame_activity_extractWindowsDetailed(text, yearHint, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ) {
	const src = String(text == null ? "" : text);
	const ins = [];
	const norm = ns_biligame_activity_deglueDateTimes(src, ins);
	const glued = ins.length > 0;
	const toks = ns_biligame_activity_tokenizeWindows(norm);
	const windows = [], skipped = [];
	const rawOf = (a, b) => {
		const r = ns_biligame_activity_toSourceRange(a.at, b.end, ins);
		return { src: src.slice(r.s, r.e).trim(), norm: norm.slice(a.at, b.end).trim() };
	};
	for (let i = 0; i < toks.length; i++) {
		const a = toks[i];
		if (a.kind !== "stamp") continue;
		const sep = toks[i + 1];
		if (!sep || sep.kind !== "sep") continue;
		const b = toks[i + 2];
		if (!b) continue;
		const raws = rawOf(a, b);
		const y1 = ns_biligame_activity_yearOf(a.y, a.mo, yearHint);
		if (y1 == null) { skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "no-year" }); i += 2; continue; }
		if (b.kind === "perm") {
			skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "perm" });   // 「常驻」= 无终点 → 不产出
			i += 2;
			continue;
		}
		if (b.kind !== "stamp" && b.kind !== "date") continue;
		const h1 = a.h, mi1 = a.mi;
		const h2 = b.kind === "stamp" ? b.h : 23;
		const mi2 = b.kind === "stamp" ? b.mi : 59;
		let y2 = b.y != null ? b.y : y1;
		if (b.y == null && (b.mo < a.mo || (b.mo === a.mo && b.d < a.d))) y2 = y1 + 1;
		const startTs = sourceInstant(y1, a.mo, a.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
		if (!(endTs > startTs)) { skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "bad-order" }); i += 2; continue; }
		windows.push({ startTs, endTs, raw: raws.src, rawNorm: raws.norm, glued, at: a.at, end: b.end });
		i += 2;
	}
	return { norm, windows, skipped };
}
function ns_biligame_activity_extractWindows(text, yearHint, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ) {
	return ns_biligame_activity_extractWindowsDetailed(text, yearHint, tz).windows;
}
//#endregion

//#region ① 物华弥新 活动正文档期
// 小节标题 `一、旅程将启-经以山海` / `十三、试炼场`
const ns_biligame_activity_WHMX_SECTION_RE = /^[一二三四五六七八九十百]+\s*[、.．]\s*(.+)$/;
// 小节名含这些词 → 卡池侧（本文件活动侧不用；保留 kind 便于测试断言）
const ns_biligame_activity_GACHA_SEC_RE = /招集|招募|引介|卡池|扭蛋/;
const ns_biligame_activity_WHMX_LABEL_RE = /^([^\s：:]{2,12})\s*[：:]/;
// 正文 HTML → { items:[{ name, section, label, startTs, endTs, raw, glued, kind }], skipped, paragraphs }
function ns_biligame_activity_parseWhmxActivity(html, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, yearHint = null) {
	const paragraphs = ns_biligame_activity_biligameParagraphs(html);
	const items = [], skipped = [];
	let section = "";
	for (const para of paragraphs) {
		const sec = ns_biligame_activity_WHMX_SECTION_RE.exec(para);
		if (sec) { section = sec[1].trim(); continue; }     // 标题独占一段（实测）
		const { norm, windows, skipped: sk } = ns_biligame_activity_extractWindowsDetailed(para, yearHint, tz);
		if (!windows.length) {
			for (const s of sk) skipped.push({ ...s, section });
			continue;
		}
		const labelM = ns_biligame_activity_WHMX_LABEL_RE.exec(para);
		const label = labelM ? labelM[1] : "";
		for (const w of windows) {
			items.push({
				name: section || label,
				section,
				label,
				startTs: w.startTs,
				endTs: w.endTs,
				raw: w.raw,
				rawNorm: w.rawNorm,
				glued: w.glued,
				kind: ns_biligame_activity_GACHA_SEC_RE.test(section) ? "gacha" : "event"
			});
		}
		for (const s of sk) skipped.push({ ...s, section });
	}
	return { items, skipped, paragraphs };
}
//#endregion

//#region ② 闪耀优俊少女 正文/标题
// 标题分流：卡池（招募/扭蛋/必得）优先；其次活动（活动/赛事/剧情/举办）；都不含 → null（跳过，不抓详情）
const ns_biligame_activity_UMA_GACHA_RE = /招募|扭蛋|必得/;
const ns_biligame_activity_UMA_EVENT_RE = /活动|赛事|剧情|举办/;
function ns_biligame_activity_classifyUmaCnTitle(title) {
	const t = String(title == null ? "" : title);
	if (ns_biligame_activity_UMA_GACHA_RE.test(t)) return "gacha";
	if (ns_biligame_activity_UMA_EVENT_RE.test(t)) return "event";
	return null;
}
// 正文 HTML → { items:[{ name:标签, label, startTs, endTs, raw, glued }], skipped, paragraphs }
//   标签：同段内窗口之前的文字（`活动期间 10/1 12:00 ～ …`）→ 空则退回上一段非窗口段
function ns_biligame_activity_parseUmaCnAnnouncement(html, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, yearHint = null) {
	const paragraphs = ns_biligame_activity_biligameParagraphs(html);
	const items = [], skipped = [];
	let prevLabel = "";
	for (const para of paragraphs) {
		const { norm, windows, skipped: sk } = ns_biligame_activity_extractWindowsDetailed(para, yearHint, tz);
		if (!windows.length) {
			for (const s of sk) skipped.push({ ...s, label: prevLabel });
			// 记录「可能是标签」的短段（供下一段的窗口使用）：实测标签形如
			// `精选招募开放期间` / `开放期间` / `活动期间` / `角色剧情开放期间` → 需含 期间|时间 等词
			if (para.length <= 24 && !/[。！？，,；;：:]/.test(para) && /期间|时间|开放|活动/.test(para)) prevLabel = para;
			continue;
		}
		for (const w of windows) {
			const head = norm.slice(0, w.at).replace(/^[※·・\-—\s]+/, "").replace(/[：:]\s*$/, "").trim();
			const label = head || prevLabel;
			items.push({ name: label || "（无标签）", label, startTs: w.startTs, endTs: w.endTs, raw: w.raw, rawNorm: w.rawNorm, glued: w.glued });
		}
		for (const s of sk) skipped.push({ ...s, label: prevLabel });
	}
	return { items, skipped, paragraphs };
}
// 外显挑选：卡池侧优先标签含`招募`；活动侧优先`活动期间`，其次含`期间|时间`，最后其它细分期间。
// 同级取结束最早，并列按文档顺序。（实测：18425 活动期间 / 18423 活动期间 都是 rank0）
function ns_biligame_activity_pickUmaWindow(items, now, want) {
	const act = (items || []).filter((x) => x.startTs <= now && x.endTs >= now);
	if (!act.length) return null;
	const rank = (x) => {
		const l = String(x.label || "");
		if (want === "gacha") return /招募/.test(l) ? 0 : 1;
		if (/^(活动期间|活动时间)/.test(l)) return 0;
		if (/期间|时间/.test(l)) return 1;
		return 2;
	};
	return act.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || (a.w.endTs - b.w.endTs) || (a.i - b.i))[0].w;
}
// UP 角色/协助卡名（可选字段）：只认 `★★★ [系列名]角色名` 这种明确行（协助卡列表没有 ★★★ → 不产出）
function ns_biligame_activity_umaRoles(paragraphs) {
	const out = [];
	for (const p of paragraphs || []) {
		const m = /^★★★\s*(?:\[[^\]]*\]|【[^】]*】)?\s*([^\s（(＜【\[]+)/.exec(p);
		if (m && m[1] && !out.includes(m[1])) out.push(m[1]);
		if (out.length >= 6) break;
	}
	return out;
}
//#endregion

//#region 文字清洗 / 标题里的活动名
// 标题清洗：去掉尾部的动作尾巴（`开放！`/`即将开放！`/`举办中！`/`开启`…），保留活动/卡池名
const ns_biligame_activity_TITLE_TAIL_RE = /[\s，,。！!～~\-—]*(?:即将|现已|正在|已)?(?:开放|开启|举办|登场|上线|开始|结束|预告|推出)[中]?[！!。]?\s*$/;
function ns_biligame_activity_cleanTitle(t) {
	let s = String(t == null ? "" : t).trim();
	for (let i = 0; i < 2; i++) {
		const n = s.replace(ns_biligame_activity_TITLE_TAIL_RE, "").trim();
		if (n === s) break;
		s = n;
	}
	return s || String(t == null ? "" : t).trim();
}
// 标题里引号中的活动名：`「经以山海」限时活动开启` → 经以山海
// （物华弥新用它把外显锁定到本期主线活动小节，而不是最早结束的登录活动）
function ns_biligame_activity_quotedName(title) {
	const m = /[「“"【]([^」”"】]{2,14})[」”"】]/.exec(String(title == null ? "" : title));
	return m ? m[1].trim() : "";
}
//#endregion

//#region 物华弥新 外显挑选 / 抓取器
function ns_biligame_activity_pickWhmxEvent(items, now, preferName = "") {
	const act = (items || []).filter((x) => x.kind === "event" && x.startTs <= now && x.endTs >= now);
	if (!act.length) return null;
	const rank = (x) => {
		if (!preferName) return 1;
		if (x.section === preferName) return 0;
		if (x.section.includes(preferName)) return 1;
		return 2;
	};
	return act.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
function ns_biligame_activity_coveringWhmxEvents(items, now) {
	return (items || [])
		.filter((x) => x.kind === "event" && x.startTs <= now && x.endTs >= now)
		.map((x, i) => ({ x, i }))
		.sort((a, b) => (a.x.startTs - b.x.startTs) || (a.i - b.i))
		.map((o) => o.x);
}
// ⚠️ 曾经这里有 `WHMX_TZ_NOTE`（时区推定说明）与 `skipNote()`（「常驻不产出」说明），两者都只用于
//    拼旧悬停 → 用户要求「元信息彻底删掉」后**已整体删除**（时区推定的依据仍在文件头 ① 的交叉印证里，
//    「常驻」为何不进 items 仍在 `ns_biligame_activity_extractWindowsDetailed` 的注释与 `skipped[].reason` 里）。
function ns_biligame_activity_yearHintOf(item, tz) {
	const ts = item && item.dateTs != null ? item.dateTs : null;
	return ts == null ? null : sourceWallParts(ts, tz);
}
// 活动侧抓取器（契约：async (url, signal, tz, now = Date.now()) → 对象 | null）
//   两路 typeId（4 与 1）**都拉** → 合并去重倒序 → 逐条抓详情（≤6 篇）→ 正文抽档期 → 挑覆盖 now 的
//   · 抓到公告但没有任何覆盖 now 的活动档期 → null（未公布）
//   · 所有详情请求都失败 → 抛错（不能把「源站挂了」静默降级成「未公布」）
//   · 一路 feed 失败且最终没找到覆盖 now 的档期 → 抛错（此时不能声称「未公布」）
async function ns_biligame_activity_eventsWhmxOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = Date.now()) {
	const listUrl = url || ns_biligame_activity_WHMX_LIST_URL;
	const merged = [];
	const feedErrors = [];
	let okFeeds = 0;
	for (const u of ns_biligame_activity_whmxListUrls(listUrl)) {
		try {
			const items = ns_biligame_activity_parseBiligameList(await fetchJson(u, { referer: ns_biligame_activity_WHMX_HOME, signal, mode: "proxy" }));
			merged.push(items);
			okFeeds++;
		} catch (e) {
			feedErrors.push(e);
		}
	}
	if (okFeeds === 0) throw feedErrors[0];
	const list = ns_biligame_activity_mergeBiligameLists(merged);
	if (!list.length) return null;                     // 两路都是空列表 → 源站无公告 = 未公布
	let firstErr = null, loaded = 0;
	for (const it of list.slice(0, ns_biligame_activity_DETAIL_LIMIT_WHMX)) {
		let d = null;
		try {
			const detail = await fetchJson(ns_biligame_activity_biligameDetailUrl(listUrl, it.id), { referer: ns_biligame_activity_WHMX_HOME, signal, mode: "proxy" });
			d = detail && detail.data;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		if (!d || typeof d.content !== "string") continue;
		loaded++;
		const title = ns_biligame_activity_decodeExtra(d.title || it.title || "").replace(/\s+/g, " ").trim();
		const parsed = ns_biligame_activity_parseWhmxActivity(d.content, tz, ns_biligame_activity_yearHintOf(it, tz));
		const best = ns_biligame_activity_pickWhmxEvent(parsed.items, now, ns_biligame_activity_quotedName(title));
		if (!best) continue;
		// 悬停 = 覆盖 now 的全部活动档期，逐行「小节名 + 3 空格 + 档期」（共用工具排版，按结束时间升序）。
		// 只有 1 条 → 工具返回 "" → **不设** eventHover，交回 UI 默认两行式（`event` ⏎ `eventDates`）。
		// ⚠️ 旧版的「来源：B站官方公告 api.biligame.com/news（gameExtensionId=613，typeId=4/1…
		// 共 N 篇）」「物华弥新 国服 · 标题 + tz 推定」「▶ 标出外显那条」「另有 N 条常驻不产出」
		// 全部是元信息/实现说明 → 已彻底删除（见文件头「悬停规则」）。
		const eventHover = ns_biligame_activity_whmxEventHover(ns_biligame_activity_coveringWhmxEvents(parsed.items, now), tz);
		const eventDates = fmtWindow(best.startTs, best.endTs, tz);
		return {
			event: ns_biligame_activity_cleanTitle(title) || best.section || best.label,
			eventDates,
			eventDatesRaw: best.raw,
			...(eventHover ? { eventHover } : {})
		};
	}
	if (loaded === 0 && firstErr) throw firstErr;
	if (feedErrors.length) throw feedErrors[0];        // 一路 feed 失败 → 不能声称「未公布」
	return null;
}
//#endregion

//#region 闪耀优俊少女 抓取器（卡池 + 活动，同一 feed 靠标题分流）
// 单一 feed（typeId=1）→ 逐条往下（≤8 篇）→ 标题分流 → 只抓**本侧相关**的详情 → 正文抽档期
async function ns_biligame_activity_loadUmaCn(url, signal, tz, now, want) {
	const listUrl = url || ns_biligame_activity_UMA_CN_LIST_URL;
	const list = ns_biligame_activity_parseBiligameList(await fetchJson(listUrl, { referer: ns_biligame_activity_UMA_CN_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;                     // 空列表 → 源站无公告 = 未公布
	let firstErr = null, loaded = 0, tried = 0;
	for (const it of list.slice(0, ns_biligame_activity_DETAIL_LIMIT_UMA)) {
		const title = ns_biligame_activity_decodeExtra(it.title || "").replace(/\s+/g, " ").trim();
		if (ns_biligame_activity_classifyUmaCnTitle(title) !== want) continue;   // 标题分流：不相关的不抓详情（省请求）
		tried++;
		let d = null;
		try {
			const detail = await fetchJson(ns_biligame_activity_biligameDetailUrl(listUrl, it.id), { referer: ns_biligame_activity_UMA_CN_HOME, signal, mode: "proxy" });
			d = detail && detail.data;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		if (!d || typeof d.content !== "string") continue;
		loaded++;
		const dt = ns_biligame_activity_decodeExtra(d.title || title).replace(/\s+/g, " ").trim();
		const parsed = ns_biligame_activity_parseUmaCnAnnouncement(d.content, tz, ns_biligame_activity_yearHintOf(it, tz));
		const best = ns_biligame_activity_pickUmaWindow(parsed.items, now, want);
		if (!best) continue;
		// 覆盖 now 的全部期间（**当期判定不变**，与旧版同一集合），按结束时间升序排好供悬停排版。
		// 悬停文本由调用方按侧拼（卡池 `hoverPool` / 活动 `hoverEvent`）——本函数不再返回 hover，
		// 因为两侧排版不同（卡池要「池名：角色」+ 每池两行），旧版共用一份 hover 正是偏差来源之一。
		// ⚠️ 旧版的「来源：B站官方公告 api.biligame.com/news（gameExtensionId=1006，单一 feed
		// typeId=1 卡池/活动混排，按标题分流）」「闪耀！优俊少女 国服 · 标题 + tz 推定」「▶ 支线」
		// 与「源站原文粘连 → 按 … 解析」全是元信息/实现说明 → 已彻底删除（见文件头「悬停规则」）。
		const active = parsed.items
			.filter((x) => x.startTs <= now && x.endTs >= now)
			.sort(ns_biligame_activity_byEndAsc);
		return { title: dt, best, active, roles: want === "gacha" ? ns_biligame_activity_umaRoles(parsed.paragraphs) : [] };
	}
	if (loaded === 0 && tried > 0 && firstErr) throw firstErr;   // 本侧相关详情全都失败 → 抛错
	return null;
}
// 卡池侧
async function ns_biligame_activity_gachaUmaCnOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = Date.now()) {
	const hit = await ns_biligame_activity_loadUmaCn(url, signal, tz, now, "gacha");
	if (!hit) return null;
	const { title, best, active, roles } = hit;
	const banner = ns_biligame_activity_cleanTitle(title) || best.label;
	const rolesText = roles.join("、");
	// 悬停 = 全部当期池（每池「池名：角色」+ 档期）；只有 1 个当期池 → "" → **不设** bannerHover，
	// 交回 UI 默认两行式（`banner：roles` ⏎ `bannerDates`）。
	const bannerHover = ns_biligame_activity_umaCnPoolHover(active, tz, rolesText, banner);
	return {
		banner,
		roles: rolesText,
		bannerDates: fmtWindow(best.startTs, best.endTs, tz),
		bannerDatesRaw: best.raw,
		startTs: best.startTs,
		endTs: best.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}
// 活动侧
async function ns_biligame_activity_eventsUmaCnOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = Date.now()) {
	const hit = await ns_biligame_activity_loadUmaCn(url, signal, tz, now, "event");
	if (!hit) return null;
	const { title, best, active } = hit;
	const event = ns_biligame_activity_cleanTitle(title) || best.label;
	// 悬停 = 全部当期期间，逐行「期间名 + 3 空格 + 档期」（档期由 fmtWindow 格式化：源站粘连笔误
	// `10/711:59` 在这里如实显示为 `10-07 11:59`）；只有 1 条 → "" → **不设** eventHover。
	const eventHover = ns_biligame_activity_umaCnEventHover(active, tz, event);
	return {
		event,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		...(eventHover ? { eventHover } : {})
	};
}
//#endregion

		// ===== 内联自 next-sources/parsers/ournotes-global.js（模块级标识符已加 ns_ournotes-global_ 前缀）=====

// next-sources/parsers/ournotes-global.js —— BanG Dream！OurNotes **国际服**（BHK 发行）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null（null = 未公布）
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover }
//   · 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//   两侧读**同一份公告 feed**（与国际服一致：一份公告里既有招募也有活动），靠标题分流。
//
// ══ 条目形态：**默认未配置**（只挂备选源，不给 url/eventUrl）════════════════
//   本条目在 registry-p9.js 里**没有** `url` / `eventUrl`，只有 `altSources` / `eventAltSources`。
//   插件 50-refresh.js 的语义是 `if (!source.url && !source.eventUrl) → skipped`：
//   不抓取、不计成功也不计失败，UI 显示「未配置（不抓取卡池/活动）」；用户在设置页选「官方公告（BHK）」
//   才会真正抓取。与米游社那套「崩坏3 新建条目、默认未配置」完全同型（见 45-next-sources.js）。
//
// ══ 接口（Lead 定位；本机**抓不到**，夹具是**合成**的，见下）══════════════════
//   发行商 = BHK（BILIBILI HK LIMITED），bundleId `com.bilibili.sirius`，内部代号 sirius。
//   列表 GET https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw
//   详情 GET https://l11-web-api.biligames.com/game/news/detail?game_base_id=118241&id=<id>&lang=zh-tw
//   Lead 实测抓到过一次：`{"code":0,"data":{"page_number":1,"page_size":20,"total_count":0,"list":[]}}`
//   → 源站**暂无公告**（国际服 2026-09-24 才上线）。
//   ⚠️ 此后本机对该域 `fetch failed`（ECONNRESET）：2026-10-03 复测三个 lang（zh-tw/zh-cn/en-us）
//      全部失败（实测 437~1507ms 直接失败）→ **拿不到真实夹具**。故本模块的夹具是**合成**的，
//      并在 fixtures/p9-ournotes-global-*/response.txt.meta.json 与 test/cases-p9.mjs 里**明确标注**。
//
// ══ 因此本解析器对**字段名**采取宽容策略（合成夹具只覆盖我们假设的字段）══════
//   · 列表项 id：`id` / `news_id` / `article_id` / `content_id`
//   · 标题：`title` / `name` / `subject`（可能是纯文本，也可能带 HTML）
//   · 发布时间（用于**推断正文里省略年份**）：`display_time` / `create_time` / `publish_time` / `date`
//   · 详情正文：`content` / `body` / `text` / `detail` / `description`（HTML 或纯文本）
//   · 结构化档期（若源站给了就优先用，给了才好）：`start_time`+`end_time` 等常见命名
//   · `total_count === 0` 或 `list` 为空 → 返回 null（= 未公布）
//   ⚠️ 以上字段名是**假设**，不是实测（源站无可达内容）。若将来抓一次真实响应，第一件事就是
//      按真实字段收紧这几个候选列表（位置集中在本文件 #region 字段候选）。
//
// ══ tz = Asia/Shanghai（**任务书指定**）═════════════════════════════════════
//   国际服含港澳台（zh-tw / zh-cn 为主），源站未标时区。**不要**照日服用 Asia/Tokyo。
//   绝对时刻走 `sourceInstant(...)`，文本走 `fmtWindow(...)`。
//
// ══ 合并器注意 ══
//   与 biligame-activity.js 同理：本文件**不 import 其它解析器**（合并器按文件命名空间隔离、
//   不会重命名跨文件 import 的名字），只 import lib/env.js。逻辑与 uma 的正文抽档期同源但自带一份。


const ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID = 118241;
const ns_ournotes_global_OURNOTES_GLOBAL_TZ = "Asia/Shanghai";
const ns_ournotes_global_OURNOTES_GLOBAL_LANGS = ["zh-tw", "zh-cn", "en-us", "ko-kr"];
const ns_ournotes_global_OURNOTES_GLOBAL_HOME = "https://www.biligames.com/";
const ns_ournotes_global_LIST_ORIGIN = "https://l11-web-api.biligames.com";
const ns_ournotes_global_DETAIL_LIMIT = 8;

function ns_ournotes_global_ournotesGlobalListUrl(lang = ns_ournotes_global_OURNOTES_GLOBAL_LANGS[0]) {
	return `${ns_ournotes_global_LIST_ORIGIN}/game/news/page?game_base_id=${ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID}&show_position=1&lang=${lang}`;
}
function ns_ournotes_global_ournotesGlobalDetailUrl(id, lang = ns_ournotes_global_OURNOTES_GLOBAL_LANGS[0]) {
	return `${ns_ournotes_global_LIST_ORIGIN}/game/news/detail?game_base_id=${ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID}&id=${id}&lang=${lang}`;
}
const ns_ournotes_global_OURNOTES_GLOBAL_LIST_URL = ns_ournotes_global_ournotesGlobalListUrl("zh-tw");
// 备选源标识就是 URL 本身（`altSourceId(alt) = alt.url`）→ 注册表里的 URL 必须与这里逐字一致
function ns_ournotes_global_langOf(url, fallback = ns_ournotes_global_OURNOTES_GLOBAL_LANGS[0]) {
	try {
		const v = new URL(url).searchParams.get("lang");
		return v && ns_ournotes_global_OURNOTES_GLOBAL_LANGS.includes(v) ? v : fallback;
	} catch { return fallback; }
}

//#region 文本工具（自带一份，理由见文件头「合并器注意」）
const ns_ournotes_global_ENT_EXTRA = {
	middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–", nbsp: " ", amp: "&",
	lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sup2: "²", sup3: "³", yen: "¥"
};
function ns_ournotes_global_decodeExtra(s) {
	return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
		const v = ns_ournotes_global_ENT_EXTRA[String(k).toLowerCase()];
		return v != null ? v : m;
	}));
}
function ns_ournotes_global_plain(html) { return ns_ournotes_global_decodeExtra(textOf(html)).replace(/\s+/g, " ").trim(); }
// 按 </p> 切段（详情正文若是 HTML）；纯文本没有 <p> → 退化成按行切
function ns_ournotes_global_ournotesGlobalParagraphs(html) {
	const s = String(html == null ? "" : html);
	const chunks = /<\/p\s*>/i.test(s) ? s.split(/<\/p\s*>/i) : s.split(/\r?\n/);
	return chunks.map((c) => ns_ournotes_global_plain(c)).filter(Boolean);
}
//#endregion

//#region 字段候选（**假设**，源站不可达，见文件头）
function ns_ournotes_global_pickStr(obj, keys) {
	for (const k of keys) {
		const v = obj ? obj[k] : null;
		if (typeof v === "string" && v.trim() !== "") return v.trim();
	}
	return "";
}
function ns_ournotes_global_pickNum(obj, keys) {
	for (const k of keys) {
		const v = obj ? obj[k] : null;
		if (typeof v === "number" && Number.isFinite(v)) return v;
		if (typeof v === "string" && /^\d{6,}$/.test(v.trim())) return Number(v.trim());
	}
	return null;
}
const ns_ournotes_global_K_ID = ["id", "news_id", "article_id", "content_id", "newsId"];
const ns_ournotes_global_K_TITLE = ["title", "name", "subject", "news_title"];
const ns_ournotes_global_K_TIME = ["display_time", "displayTime", "create_time", "createTime", "publish_time", "publishTime", "date", "ctime"];
const ns_ournotes_global_K_CONTENT = ["content", "body", "text", "detail", "description", "news_content"];
const ns_ournotes_global_K_START = ["start_time", "startTime", "begin_time", "beginTime", "start_at", "startAt", "start_date"];
const ns_ournotes_global_K_END = ["end_time", "endTime", "end_at", "endAt", "end_date", "endDate"];
function ns_ournotes_global_ournotesGlobalTitle(x) {
	return ns_ournotes_global_plain(ns_ournotes_global_pickStr(x, ns_ournotes_global_K_TITLE));
}
function ns_ournotes_global_ournotesGlobalInstant(x, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ) {
	return ns_ournotes_global_parseOurNotesGlobalStamp(ns_ournotes_global_pickStr(x, ns_ournotes_global_K_TIME), tz);
}
//#endregion

//#region 列表 / 详情结构
// 列表 JSON → { totalCount, items:[{ id, title, sortKey, dateTs, raw }] }（按发布时间倒序）
//   结构不合法（非对象 / code≠0 / data 非对象 / list 非数组）→ 抛错（结构性损坏）
function ns_ournotes_global_parseOurNotesGlobalPage(json) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("ournotes-global-bad-json");
	if (json.code !== 0) throw new Error("ournotes-global-code-" + json.code);
	const d = json.data;
	if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("ournotes-global-bad-json");
	if (!Array.isArray(d.list)) throw new Error("ournotes-global-bad-json");
	const totalRaw = d.total_count != null ? d.total_count : d.totalCount;
	const totalCount = totalRaw == null ? d.list.length : Number(totalRaw);
	const items = d.list
		.filter((x) => x && typeof x === "object")
		.map((x) => {
			const sortKey = ns_ournotes_global_pickStr(x, ns_ournotes_global_K_TIME);
			return {
				id: ns_ournotes_global_pickNum(x, ns_ournotes_global_K_ID),
				title: ns_ournotes_global_ournotesGlobalTitle(x),
				sortKey,
				dateTs: ns_ournotes_global_parseOurNotesGlobalStamp(sortKey, ns_ournotes_global_OURNOTES_GLOBAL_TZ),
				raw: x
			};
		})
		.filter((x) => x.id != null && x.title)
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
	return { totalCount: Number.isFinite(totalCount) ? totalCount : items.length, items, raw: d };
}
// 空 = 未公布：`total_count === 0` 或 list 为空（**实测** Lead 抓到的那次就是 total_count:0）
function ns_ournotes_global_isOurNotesGlobalEmpty(json, page = null) {
	const p = page || ns_ournotes_global_parseOurNotesGlobalPage(json);
	return p.totalCount === 0 || p.items.length === 0;
}
function ns_ournotes_global_ournotesGlobalDetailText(detail) {
	const d = detail && typeof detail === "object" && detail.data && typeof detail.data === "object" ? detail.data : detail;
	if (!d || typeof d !== "object") return "";
	const v = (() => {
		for (const k of ns_ournotes_global_K_CONTENT) {
			const c = d[k];
			if (typeof c === "string" && c.trim() !== "") return c;
			if (c && typeof c === "object" && typeof c.rendered === "string") return c.rendered;
		}
		return "";
	})();
	return v;
}
// 结构化档期（若源站给了 start/end 字段就优先用，给了才好）；拿不到 → null
function ns_ournotes_global_ournotesGlobalStructuredWindow(item, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ) {
	const d = item && typeof item === "object" && item.data && typeof item.data === "object" ? item.data : item;
	const a = ns_ournotes_global_pickStr(d, ns_ournotes_global_K_START), b = ns_ournotes_global_pickStr(d, ns_ournotes_global_K_END);
	if (!a || !b) return null;
	const aTs = ns_ournotes_global_parseOurNotesGlobalStamp(a, tz), bTs = ns_ournotes_global_parseOurNotesGlobalStamp(b, tz);
	if (aTs == null || bTs == null || !(bTs > aTs)) return null;
	return { startTs: aTs, endTs: bTs, raw: `${a} ~ ${b}`, glued: false, structured: true };
}
//#endregion

//#region 日期令牌（容错：年月日 / 斜杠 / 点 / ISO，年份可省）
function ns_ournotes_global_parseOurNotesGlobalStamp(s, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ) {
	const t = String(s == null ? "" : s).trim();
	if (t === "") return null;
	// 纯数字：> 1e11 视为毫秒，否则视为秒（**假设**）
	if (/^\d{10,13}$/.test(t)) {
		const n = Number(t);
		return n > 1e11 ? n : n * 1000;
	}
	// ⚠️ `(?:\s*日)?` 必须写成可选组：若写成 `\s*日?`，后面的空格会被 `\s*` 吃掉，
	//    而时刻组本身可选 → 正则不回退，`2026-10-01 12:00:00` 会被静默当成 00:00（本模块第一版踩过）
	const m = /^(?:(\d{4})\s*[年\/\-.]\s*)?(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})(?:\s*日)?(?:[\sT]+(\d{1,2})\s*[:：]\s*(\d{2}))?/.exec(t);
	if (!m) return null;
	const y = m[1] ? +m[1] : null;
	if (y == null) return null;                     // 没有年份 → 需要外部补全（由调用方按公告年补）
	const mo = +m[2], d = +m[3], h = m[4] != null ? +m[4] : 0, mi = m[5] != null ? +m[5] : 0;
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
	return sourceInstant(y, mo, d, h, mi, tz);
}
const ns_ournotes_global_TOK_RE = new RegExp([
	"(?<stamp>(?:(?<sy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<smo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<sd>\\d{1,2})\\s*日?\\s*(?<sh>\\d{1,2})\\s*[:：]\\s*(?<smi>\\d{2}))",
	"(?<date>(?:(?<dy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<dmo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<dd>\\d{1,2})\\s*日?)",
	"(?<sep>[~\uff5e\u301c\u223c至到]|\\s[-\\u2013\\u2014\\uff0d]\\s|[-\\u2013\\u2014\\uff0d])",
	"(?<perm>常驻|常駐|永久|常設|長期)"
].join("|"), "g");
function ns_ournotes_global_yearOf(y, mo, hint) {
	if (y != null) return y;
	if (!hint || hint.y == null) return null;
	return mo > hint.mo + 6 ? hint.y - 1 : hint.y;
}
// 一段文本 → { norm, windows:[{ startTs, endTs, raw, glued }], skipped }
function ns_ournotes_global_extractOurNotesGlobalWindows(text, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ, yearHint = null) {
	const src = String(text == null ? "" : text);
	const norm = src;
	const toks = [];
	ns_ournotes_global_TOK_RE.lastIndex = 0;
	let m;
	while ((m = ns_ournotes_global_TOK_RE.exec(norm)) !== null) {
		if (m[0] === "") { ns_ournotes_global_TOK_RE.lastIndex++; continue; }
		const g = m.groups || {};
		const at = m.index, end = m.index + m[0].length;
		if (g.stamp != null) {
			const t = { kind: "stamp", text: g.stamp, at, end, y: g.sy ? +g.sy : null, mo: +g.smo, d: +g.sd, h: +g.sh, mi: +g.smi };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31 && t.h <= 23 && t.mi <= 59) toks.push(t);
		} else if (g.date != null) {
			const t = { kind: "date", text: g.date, at, end, y: g.dy ? +g.dy : null, mo: +g.dmo, d: +g.dd, h: null, mi: null };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31) toks.push(t);
		} else if (g.sep != null) toks.push({ kind: "sep", text: g.sep, at, end });
		else if (g.perm != null) toks.push({ kind: "perm", text: g.perm, at, end });
	}
	const windows = [], skipped = [];
	for (let i = 0; i < toks.length; i++) {
		const a = toks[i];
		if (a.kind !== "stamp") continue;
		const sep = toks[i + 1];
		if (!sep || sep.kind !== "sep") continue;
		const b = toks[i + 2];
		if (!b) continue;
		const raw = norm.slice(a.at, b.end).trim();
		if (b.kind === "perm") { skipped.push({ raw, reason: "perm" }); i += 2; continue; }
		if (b.kind !== "stamp" && b.kind !== "date") continue;
		const y1 = ns_ournotes_global_yearOf(a.y, a.mo, yearHint);
		if (y1 == null) { skipped.push({ raw, reason: "no-year" }); i += 2; continue; }
		let y2 = b.y != null ? b.y : y1;
		if (b.y == null && (b.mo < a.mo || (b.mo === a.mo && b.d < a.d))) y2 = y1 + 1;
		const h2 = b.kind === "stamp" ? b.h : 23;
		const mi2 = b.kind === "stamp" ? b.mi : 59;
		const startTs = sourceInstant(y1, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
		if (!(endTs > startTs)) { skipped.push({ raw, reason: "bad-order" }); i += 2; continue; }
		windows.push({ startTs, endTs, raw, glued: false });
		i += 2;
	}
	return { norm, windows, skipped };
}
//#endregion

//#region 标题分流（国际服多语言 → 关键词按语种各一套；**假设**，未拿到真实标题）
const ns_ournotes_global_RE_GACHA_ZH = /招募|扭蛋|必得|祈愿|招集/;
const ns_ournotes_global_RE_EVENT_ZH = /活動|活动|賽事|赛事|劇情|剧情|舉辦|举办|慶典|庆典|任務|任务/;
const ns_ournotes_global_RE_GACHA_EN = /\brecruit|\bgacha\b|\bbanner\b|\bpickup\b|\bpick-up\b/i;
const ns_ournotes_global_RE_EVENT_EN = /\bevent\b|\bcampaign\b|\bstory\b|\bmission\b|\bcelebration\b/i;
const ns_ournotes_global_RE_GACHA_KO = /모집|가챠|뽑기/;
const ns_ournotes_global_RE_EVENT_KO = /이벤트|활동|스토리|캠페인/;
function ns_ournotes_global_classifyOurNotesGlobalTitle(title) {
	const t = String(title == null ? "" : title);
	if (ns_ournotes_global_RE_GACHA_ZH.test(t) || ns_ournotes_global_RE_GACHA_EN.test(t) || ns_ournotes_global_RE_GACHA_KO.test(t)) return "gacha";
	if (ns_ournotes_global_RE_EVENT_ZH.test(t) || ns_ournotes_global_RE_EVENT_EN.test(t) || ns_ournotes_global_RE_EVENT_KO.test(t)) return "event";
	return null;
}
// 标题清洗：去掉尾部动作尾巴（简繁都认：`开放！`/`開放！`/`舉辦中！`…），保留活动/卡池名
const ns_ournotes_global_TITLE_TAIL_RE = /[\s，,。！!～~\-—]*(?:即将|即將|现已|現已|正在|已)?(?:开放|開放|開啟|开启|举办|舉辦|登場|登场|上线|上線|开始|開始|结束|結束|预告|預告)[中]?[！!。]?\s*$/;
function ns_ournotes_global_cleanTitle(t) {
	let s = String(t == null ? "" : t).trim();
	for (let i = 0; i < 2; i++) {
		const n = s.replace(ns_ournotes_global_TITLE_TAIL_RE, "").trim();
		if (n === s) break;
		s = n;
	}
	return s || String(t == null ? "" : t).trim();
}
//#endregion

//#region 抓取器（契约：async (url, signal, tz, now = Date.now()) → 对象 | null）
// 外显挑选：覆盖 now 的窗口里取结束最早的（并列按文档顺序）
function ns_ournotes_global_pickOurNotesGlobalWindow(items, now) {
	const act = (items || []).filter((x) => x.startTs <= now && x.endTs >= now);
	if (!act.length) return null;
	return act.map((x, i) => ({ x, i })).sort((a, b) => (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
function ns_ournotes_global_yearHintOf(item, tz) {
	return item && item.dateTs != null ? sourceWallParts(item.dateTs, tz) : null;
}
async function ns_ournotes_global_loadOurNotesGlobal(url, signal, tz, now, want) {
	const listUrl = url || ns_ournotes_global_OURNOTES_GLOBAL_LIST_URL;
	const lang = ns_ournotes_global_langOf(listUrl);
	// mode 一律 "proxy"：`l11-web-api.biligames.com` 无 ACAO（也未实测直连放行）
	const json = await fetchJson(listUrl, { referer: ns_ournotes_global_OURNOTES_GLOBAL_HOME, signal, mode: "proxy" });
	const page = ns_ournotes_global_parseOurNotesGlobalPage(json);
	if (ns_ournotes_global_isOurNotesGlobalEmpty(json, page)) return null;     // total_count:0 / list 空 → 未公布
	let firstErr = null, loaded = 0, tried = 0;
	for (const it of page.items.slice(0, ns_ournotes_global_DETAIL_LIMIT)) {
		if (ns_ournotes_global_classifyOurNotesGlobalTitle(it.title) !== want) continue;
		tried++;
		let detail = null;
		try {
			detail = await fetchJson(ns_ournotes_global_ournotesGlobalDetailUrl(it.id, lang), { referer: ns_ournotes_global_OURNOTES_GLOBAL_HOME, signal, mode: "proxy" });
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		loaded++;
		const text = ns_ournotes_global_ournotesGlobalDetailText(detail);
		const title = ns_ournotes_global_ournotesGlobalTitle((detail && detail.data) || detail) || it.title;
		const hint = ns_ournotes_global_yearHintOf(it, tz);
		const structured = ns_ournotes_global_ournotesGlobalStructuredWindow(detail, tz);
		const parsed = ns_ournotes_global_extractOurNotesGlobalWindows(text, tz, hint);
		const windows = structured ? [structured, ...parsed.windows] : parsed.windows;
		const best = ns_ournotes_global_pickOurNotesGlobalWindow(windows, now);
		if (!best) continue;
		const active = windows.filter((x) => x.startTs <= now && x.endTs >= now)
			.map((x, i) => ({ x, i }))
			.sort((a, b) => (a.x.startTs - b.x.startTs) || (a.i - b.i))
			.map((o) => o.x);
		const lines = active.map((x) => `${x === best ? "▶ " : "  "}${fmtWindow(x.startTs, x.endTs, tz)}${x.structured ? "   （结构化字段）" : ""}`);
		const note = "（国际服含港澳台，源站未标时区；tz=Asia/Shanghai 按任务书指定，**不是** Asia/Tokyo）";
		const hover = [
			`BanG Dream！OurNotes·国际服 · ${title} ${note}`,
			`来源：BHK 官方公告 l11-web-api.biligames.com（game_base_id=${ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID}，lang=${lang}）`,
			...lines
		].join("\n");
		return { title, best, hover };
	}
	if (loaded === 0 && tried > 0 && firstErr) throw firstErr;   // 本侧相关详情全失败 → 抛错
	return null;
}
async function ns_ournotes_global_gachaOurNotesGlobal(url, signal, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ, now = Date.now()) {
	const hit = await ns_ournotes_global_loadOurNotesGlobal(url, signal, tz, now, "gacha");
	if (!hit) return null;
	const { title, best, hover } = hit;
	return {
		banner: ns_ournotes_global_cleanTitle(title) || "（未命名招募）",
		roles: "",
		bannerDates: fmtWindow(best.startTs, best.endTs, tz),
		bannerDatesRaw: best.raw,
		startTs: best.startTs,
		endTs: best.endTs,
		bannerHover: hover
	};
}
async function ns_ournotes_global_eventsOurNotesGlobal(url, signal, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ, now = Date.now()) {
	const hit = await ns_ournotes_global_loadOurNotesGlobal(url, signal, tz, now, "event");
	if (!hit) return null;
	const { title, best, hover } = hit;
	return {
		event: ns_ournotes_global_cleanTitle(title) || "（未命名活动）",
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		eventHover: hover
	};
}
//#endregion

		// ===== 追加来源进 SOURCES（对齐原有格式：name=游戏名 / source=中文来源名 / tz）=====

		// 注意：米游社那 4 条（bh3 / *-official）不在此列 —— 它们只作为**备选源**挂在下方。

		const NS_SOURCES = [

			{
				id: "p5x",
				tz: "Asia/Shanghai",
				name: "女神异闻录：夜幕魅影",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/03/1e/f4/031ef49f-b3d0-5bdd-077b-67d213f99c86/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://p5x.wanmei.com/news/gamenews/index.html",
				source: "官网公告",
				eventUrl: "https://p5x.wanmei.com/news/gamenews/index.html",
				eventSource: "官网公告",
			},

			{
				id: "pjsk",
				tz: "Asia/Shanghai",
				name: "初音未来：缤纷舞台·国服",
				icon: "https://p16-sg.dailygn.com/obj/g-marketing-assets-sg/2021_12_15_07_41_24/icon_s54607.png",
				url: "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json",
				source: "第三方数据",
				eventUrl: "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json",
				eventSource: "第三方数据",
			},

			{
				id: "wuhuamixin",
				tz: "Asia/Shanghai",
				name: "物华弥新",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/13/7f/87/137f873a-f458-678d-347e-068830a74a69/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/whmx/api.php?action=parse&page=限时招集档案&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=613&positionId=2&typeId=4&pageNum=1&pageSize=50",
				eventSource: "官方公告",
			},

			{
				id: "uma-cn",
				tz: "Asia/Shanghai",
				name: "闪耀！优俊少女",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ca/23/bc/ca23bc1f-5dff-c21a-1881-66c48d02f5b2/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				eventSource: "官方公告",
				altSources: [{"label":"Bwiki 简中卡池（社区推算，非官方）","url":"https://wiki.biligame.com/umamusume/api.php?action=parse&page=简中卡池&prop=text&format=json&formatversion=2","fetcher":"uma-cn-bwiki"}],
			},

			{
				id: "zspms",
				tz: "Asia/Shanghai",
				name: "战双帕弥什",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b2/99/ed/b299ed39-90ea-03df-c7ee-bd09548991e5/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				eventSource: "Bwiki",
			},

			{
				id: "czn",
				tz: "Asia/Shanghai",
				name: "卡厄斯梦境",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/e2/c9/48/e2c94812-11cd-2a52-445a-d67d6ae9e169/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://wiki.biligame.com/czn/api.php?action=parse&page=Module%3AGacha%2Fdata&prop=wikitext&format=json",
				source: "Bwiki",
			},

			{
				id: "gf2",
				tz: "Asia/Shanghai",
				name: "少女前线2：追放",
				icon: "https://gf2-cn.cdn.sunborngame.com/website/official_zf/mobile/image/logo.png",
				url: "https://gf2-web-preregister-api.sunborngame.com/website/news_list/4?page=1&limit=10",
				source: "官方公告",
				eventUrl: "https://gf2-web-preregister-api.sunborngame.com/website/news_list/4?page=1&limit=10",
				eventSource: "官方公告",
			},

			{
				id: "bandori",
				tz: "Asia/Shanghai",
				name: "BanG Dream！少女乐团派对·国服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cb/ae/11/cbae1132-58ee-8b5c-3016-dfd2f5e91e51/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				eventSource: "官方公告",
				altSources: [{"label":"Bestdori 扭蛋（社区数据库）","url":"https://bestdori.com/api/gacha/all.5.json","fetcher":"bandori-bestdori-gacha"}],
				eventAltSources: [{"label":"Bestdori 活动（社区数据库）","url":"https://bestdori.com/api/events/all.5.json","fetcher":"bandori-bestdori-event"}],
			},

			{
				id: "ournotes",
				tz: "Asia/Tokyo",
				name: "BanG Dream！OurNotes·日服",
				icon: "https://bang-dream-on.bushimo.jp/wordpress/wp-content/themes/bang-dream-on_prod/assets/images/common/apple-touch-icon-180x180.png",
				defaultHidden: true,
				eventUrl: "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1",
				eventSource: "官方公告",
			},

			{
				id: "fgo",
				tz: "Asia/Shanghai",
				name: "Fate/Grand Order",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/db/d4/19/dbd4196a-68cb-8a74-ca0b-045d0795e10c/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://fgo.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://fgo.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki",
			},

			{
				id: "uma-jp",
				tz: "Asia/Tokyo",
				name: "赛马娘·日服",
				icon: "https://umamusume.jp/apple-touch-icon.png",
				url: "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1",
				source: "官方公告",
				eventUrl: "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1",
				eventSource: "官方公告",
				altSources: [{"label":"umapyoi（第三方，无卡池名）","url":"https://api.umapyoi.net/api/v1/gacha","fetcher":"uma-jp-umapyoi"}],
				eventAltSources: [{"label":"Bwiki 活动（往期归档）","url":"https://wiki.biligame.com/umamusume/api.php?action=parse&page=活动&prop=text&format=json&formatversion=2","fetcher":"uma-jp-bwiki"}],
			},

			{
				id: "uma-global",
				tz: "UTC",
				name: "赛马娘·国际服",
				icon: "https://play-lh.googleusercontent.com/yN6cCSP7UB_2bsvlCxrtv-FUpEt1IvEFwr0Ucb3wr39QsAd5PLsueSVXuCinDbE4rifhMlX4YNtpLpkGnpsLhCQ=s64-rw",
				url: "https://umamusume.com/api/ajax/pr_info_index?format=json",
				source: "官方公告",
				eventUrl: "https://umamusume.com/api/ajax/pr_info_index?format=json",
				eventSource: "官方公告",
			},

			{
				id: "ddlezj",
				tz: "+540",
				name: "嘟嘟脸恶作剧",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/64/f0/21/64f02145-182e-857a-133c-8de0151425d9/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50",
				eventSource: "官方公告",
			},

			{
				id: "kedr",
				tz: "Asia/Shanghai",
				name: "雪松",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b5/8c/b6/b58cb6b2-4be3-0be0-852a-af761afaab06/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				eventSource: "Bwiki",
				altSources: [{"label":"Bwiki 卡池信息（台架测试占位）","url":"https://wiki.biligame.com/kedrgame/api.php?action=parse&page=卡池信息&prop=text&format=json&formatversion=2","fetcher":"kedr-kaxi"}],
			},

			{
				id: "stellasora",
				tz: "Asia/Shanghai",
				name: "星塔旅人",
				icon: "https://webcnstatic.yostar.net/stellasora/stellasora-cn-official-frontend/main/h5/favicon.png?x-oss-process=image/resize,w_128",
				url: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
				source: "官方公告",
				eventUrl: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
				eventSource: "官方公告",
				eventAltSources: [{"label":"Bwiki 首页活动日历（低可用）","url":"https://wiki.biligame.com/stellasora/api.php?action=parse&page=首页&prop=text&format=json&formatversion=2","fetcher":"stellasora-bwiki"}],
			},

			{
				id: "ournotes-global",
				tz: "Asia/Shanghai",
				name: "BanG Dream！OurNotes·国际服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/ca/da/3a/cada3a9a-491a-fbe5-5494-9be7390e3a9b/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				altSources: [{"label":"官方公告（BHK）","url":"https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw","fetcher":"ournotes-global-gacha"}],
				eventAltSources: [{"label":"官方公告（BHK）","url":"https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw","fetcher":"ournotes-global-event"}],
			},

		];

		for (const s of NS_SOURCES) {

			// 同名条目已存在时不要再 push（例如 bandori/fgo 本体已有），改为**就地覆盖**

			const i = SOURCES.findIndex((x) => x.id === s.id);

			if (i >= 0) { Object.assign(SOURCES[i], s); } else { SOURCES.push(s); }

		}

		// ===== 登记抓取器（键 = 条目 id）=====

		Object.assign(GACHA_FETCHERS, {

			"p5x": (url, signal, tz) => ns_p5x_gachaP5x(url, signal, tz),

			"pjsk": (url, signal, tz) => ns_sekai_gachaSekai(url, signal, tz),

			"wuhuamixin": (url, signal, tz) => ns_bwiki_gachaWhmx(url, signal, tz),

			"uma-cn": (url, signal, tz) => ns_biligame_activity_gachaUmaCnOfficial(url, signal, tz),

			"zspms": (url, signal, tz) => ns_bwiki_wikitext_gachaZspms(url, signal, tz),

			"czn": (url, signal, tz) => ns_bwiki_wikitext_gachaCzn(url, signal, tz),

			"gf2": (url, signal, tz) => ns_gf2_gachaGf2(url, signal, tz),

			"bandori": (url, signal, tz) => ns_bandori_gachaBandori(url, signal, tz),

			"fgo": (url, signal, tz) => ns_fgo_gachaFgo(url, signal, tz),

			"uma-jp": (url, signal, tz) => ns_umamusume_official_gachaUmaJpOfficial(url, signal, tz),

			"uma-global": (url, signal, tz) => ns_umamusume_official_gachaUmaGlobal(url, signal, tz),

			"ddlezj": (url, signal, tz) => ns_biligame_announce_gachaDdlezj(url, signal, tz),

			"kedr": (url, signal, tz) => ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz),

			"stellasora": (url, signal, tz) => ns_stellasora_gachaStellasora(url, signal, tz),

		});

		Object.assign(EVENT_FETCHERS, {

			"p5x": { default: (url, signal, tz) => ns_p5x_eventsP5x(url, signal, tz) },

			"pjsk": { default: (url, signal, tz) => ns_sekai_eventsSekai(url, signal, tz) },

			"wuhuamixin": { default: (url, signal, tz) => ns_biligame_activity_eventsWhmxOfficial(url, signal, tz) },

			"uma-cn": { default: (url, signal, tz) => ns_biligame_activity_eventsUmaCnOfficial(url, signal, tz) },

			"zspms": { default: (url, signal, tz) => ns_bwiki_wikitext_eventsZspms(url, signal, tz) },

			"gf2": { default: (url, signal, tz) => ns_gf2_eventsGf2(url, signal, tz) },

			"bandori": { default: (url, signal, tz) => ns_bandori_eventsBandori(url, signal, tz) },

			"ournotes": { default: (url, signal, tz) => ns_ournotes_eventsOurNotes(url, signal, tz) },

			"fgo": { default: (url, signal, tz) => ns_fgo_eventsFgo(url, signal, tz) },

			"uma-jp": { default: (url, signal, tz) => ns_umamusume_official_eventsUmaJpOfficial(url, signal, tz) },

			"uma-global": { default: (url, signal, tz) => ns_umamusume_official_eventsUmaGlobal(url, signal, tz) },

			"ddlezj": { default: (url, signal, tz) => ns_biligame_announce_eventsDdlezj(url, signal, tz) },

			"kedr": { default: (url, signal, tz) => ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz) },

			"stellasora": { default: (url, signal, tz) => ns_stellasora_eventsStellasora(url, signal, tz) },

		});

		// ===== 登记备选源抓取器（键 = altSources/eventAltSources 的 fetcher 字段）=====

		// GACHA_FETCHERS 是**扁平**表 → 卡池备选源注册在顶层即可；

		// EVENT_FETCHERS 是**按条目 id 分组**的表 → 活动备选源必须注册进 EVENT_FETCHERS[<条目id>]。

		Object.assign(GACHA_FETCHERS, {

			"uma-jp-umapyoi": (url, signal, tz) => ns_umapyoi_gachaUmapyoi(url, signal, tz),

			"bandori-bestdori-gacha": (url, signal, tz) => ns_bestdori_gachaBestdori(url, signal, tz),

			"kedr-kaxi": (url, signal, tz) => ns_bwiki_gachaKedr(url, signal, tz),

			"uma-cn-bwiki": (url, signal, tz) => ns_bwiki_gachaUmaCn(url, signal, tz),

			"ournotes-global-gacha": (url, signal, tz) => ns_ournotes_global_gachaOurNotesGlobal(url, signal, tz),

		});

		EVENT_FETCHERS["uma-jp"] = EVENT_FETCHERS["uma-jp"] || {};

		Object.assign(EVENT_FETCHERS["uma-jp"], {

			"uma-jp-bwiki": { default: (url, signal, tz) => ns_bwiki_eventsUmaJp(url, signal, tz) },

		});

		EVENT_FETCHERS["bandori"] = EVENT_FETCHERS["bandori"] || {};

		Object.assign(EVENT_FETCHERS["bandori"], {

			"bandori-bestdori-event": { default: (url, signal, tz) => ns_bestdori_eventsBestdori(url, signal, tz) },

		});

		EVENT_FETCHERS["stellasora"] = EVENT_FETCHERS["stellasora"] || {};

		Object.assign(EVENT_FETCHERS["stellasora"], {

			"stellasora-bwiki": { default: (url, signal, tz) => ns_bwiki_eventsStellasora(url, signal, tz) },

		});

		EVENT_FETCHERS["ournotes-global"] = EVENT_FETCHERS["ournotes-global"] || {};

		Object.assign(EVENT_FETCHERS["ournotes-global"], {

			"ournotes-global-event": { default: (url, signal, tz) => ns_ournotes_global_eventsOurNotesGlobal(url, signal, tz) },

		});

		//#region 米游社公告（挂成**备选源**，不改默认主源）
		// 用户 2026-10-02 明确要求：「米游社来源全部改名米游社公告，且降级备选，恢复原默认来源」。
		// 所以这里**只加备选**：原神/星铁保持 Bwiki，绝区零保持官方公告（api-takumi-static）。
		// 命中规则 `altSourceId = (alt) => alt.url` 与当前 url 字符串相等；下面是各游戏**专属 gids URL**，不会串。

		{

			const e = SOURCES.find((s) => s.id === "genshin");

			if (!e) { console.warn("[next-sources] 找不到既有条目 genshin，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=2&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=2&type=2&page_size=20";

				GACHA_FETCHERS["genshin-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["genshin"], { "genshin-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "genshin-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "genshin-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "genshin-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "genshin-miyoushe" }];

			}

		}

		{

			const e = SOURCES.find((s) => s.id === "hsr");

			if (!e) { console.warn("[next-sources] 找不到既有条目 hsr，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=6&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=6&type=2&page_size=20";

				GACHA_FETCHERS["hsr-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["hsr"], { "hsr-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "hsr-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "hsr-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "hsr-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "hsr-miyoushe" }];

			}

		}

		{

			const e = SOURCES.find((s) => s.id === "zzz");

			if (!e) { console.warn("[next-sources] 找不到既有条目 zzz，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=8&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=8&type=2&page_size=20";

				GACHA_FETCHERS["zzz-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["zzz"], { "zzz-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "zzz-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "zzz-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "zzz-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "zzz-miyoushe" }];

			}

		}

		// 崩坏3：插件本体此前无来源 → 新建条目且**默认未配置**（用户要求）。

		// 未配置的语义（50-refresh.js）：`if (!source.url && !source.eventUrl) return { ok:true, reason:"skipped" }`

		// → 不抓取、不计成功也不计失败；UI 显示「未配置（不抓取卡池/活动）」。设置页选「米游社公告」即可启用。

		if (!SOURCES.some((s) => s.id === "bh3")) {

			const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=1&page_size=20";

			const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=2&page_size=20";

			GACHA_FETCHERS["bh3-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

			EVENT_FETCHERS["bh3"] = { default: null, "bh3-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } };

			SOURCES.push({

				id: "bh3",

				tz: "Asia/Shanghai",

				name: "崩坏3",

				icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f4/BH3_icon.png!/fw/64",

				// 出厂默认不勾选展示（用户要求）：默认未配置时面板恒空，不该占版面

				defaultHidden: true,

				// 默认**未配置**：不给 url / eventUrl

				source: "",

				eventSource: "",

				altSources: [{ label: "米游社公告", url: G, fetcher: "bh3-miyoushe" }],

				eventAltSources: [{ label: "米游社公告", url: E, fetcher: "bh3-miyoushe" }]

			});

		}

		//#endregion

		//#endregion
