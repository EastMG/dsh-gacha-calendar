// src/client/35-parsers-p5x.js
//
// 由 next-sources/parsers/p5x.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_p5x__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-p5x.js —— P5X 国服（完美世界官方站）
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
	return withWin.find((x) => coversNow(x.win, now)) || null;
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
		// ⚠️ 2026-10-03 改（方案 A 收敛）：这里原本**手搓**三行悬停 `池名` ⏎ `档期` ⏎ `本期限定UP：角色`
		//    —— 档期夹在名称与角色中间，与本体「池名：角色 ⏎ 档期」的顺序不一致。
		//    现在按通用规则表达：把 UP 角色放进 **`roles`** 字段。
		//    效果（与本体同构）：外显 = 角色名（本体对"有角色名的卡池"就是这么外显的），
		//    UI 默认两行式 = `缘结之契开启：汐见琴音` ⏎ `09-24 04:00 ~ 10-22 03:59`。
		//    只有 1 个当期池 → 不设 bannerHover（hoverPool 的契约就是 <2 条交回 UI）。
		return {
			banner: hit.block.title,
			roles: up.join("、"),
			bannerDates: fmtWindow(hit.win.startTs, hit.win.endTs, tz),
			bannerDatesRaw: hit.block.windowRaw,
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
			if (coversNow(w, now) && b.title) active.push({ block: b, win: w });
		}
		if (active.length === 0) continue;
		// 稳定排序：先按结束时间升序（越紧迫越前），同结束时间保持原文顺序
		active.sort((a, b) => a.win.endTs - b.win.endTs);
		const primary = active[0];
		// ⚠️ 2026-10-03 改：原本手搓 `名称  + 档期`（**2 个空格**），本体一律 **3 个空格** → 改用共用 hoverEvent。
		const hover = hoverEvent(active.map((x) => ({ name: x.block.title, startTs: x.win.startTs, endTs: x.win.endTs })), tz);
		return {
			event: primary.block.title,
			eventDates: fmtWindow(primary.win.startTs, primary.win.endTs, tz),
			eventDatesRaw: primary.block.windowRaw,
			...(hover ? { eventHover: hover } : {})
		};
	}
	return null;
}

// 供测试：从本地 HTML 直接跑解析（不联网）
function ns_p5x_gachaP5xFromHtml(listHtml, detailHtml, tz = "Asia/Shanghai") {
	void listHtml; void detailHtml; void tz;
	throw new Error("unused");   // 夹具测试走 fetch 注入（见 test/run.mjs）
}
