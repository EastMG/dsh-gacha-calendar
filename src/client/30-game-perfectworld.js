// src/client/30-game-perfectworld.js —— 完美世界（女神异闻录：夜幕魅影 / 异环）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ── 解析器 / 抓取器 ──

		// 异环（ldshop 繁体）：解析「項目/資訊」卡池表（含 期間/角色/棋盤 行），返回全部卡池
		// 表格行结构：<td><p>期間</p></td><td><p>8月19日－9月9日</p></td>
		function parseLdshopPools(html) {
			const out = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
			for (const tb of tables) {
				const body = tb[1];
				if (!/期間/.test(body.replace(/<[^>]+>/g, "|"))) continue;
				let info = {};
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
					const tds = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]).trim());
					if (tds.length >= 2 && tds[0] && tds[0] !== "項目") info[tds[0]] = tds[1];
				}
				if (!info["期間"]) continue;
				const range = parseLdshopRange(info["期間"]);
				if (!range) continue;
				const chars = [info["全新S級角色"], info["復刻S級角色"]].filter(Boolean).join("/");
				out.push({
					banner: info["角色棋盤"] || "异环卡池",
					roles: chars,
					...range,
					isMain: true
				});
			}
			return out;
		}


		// 异环（ldshop 经 host 代理）：抓页面 → 解析卡池表 → 选当期
		async function fetchLdshopNte(pageUrl, _signal, tz) {
			const html = await proxyFetchText(pageUrl, "https://www.ldshop.gg/");
			const pools = parseLdshopPools(html);
			if (pools.length === 0) return null;
			return selectCurrent(pools, nowMs());
		}


		// 异环（官网 yh.wanmei.com 公告，经 host 代理）：抓游戏公告列表 → 取最新维护/更新公告 → 解析当期限定棋盘卡池与限时活动
		// 官网公告列表条目：<a href="/news/gamebroad/YYYYMMDD/N.html">…<h2 class="title">标题</h2>
		const NTE_ITEM_RE = /<a href="(\/news\/gamebroad\/\d+\/\d+\.html)"[\s\S]*?<h2 class="title">([^<]+)<\/h2>/g;

		// 带新卡池的公告标题：停服维护/版本更新；"1.3版本「…」更新公告"这类版本名夹在中间，所以"更新公告"也要算
		const NTE_MAINT_RE = /停服维护|停服更新|维护公告|版本更新|更新公告/;

		// 逐页向下的上限：维护公告会随新公告发布被挤到第 2、3 页，只看第 1 页会把"进行中的卡池"误判成未公布
		const NTE_MAX_LIST_PAGES = 3;

		// 每次最多试几篇公告正文（按从新到旧），避免某篇规则失效时白抓一堆
		const NTE_MAX_DETAILS = 3;


		// 取分页控件里的后续页地址（相对当前页）：<ul class="pagination"> … <a href="index1.html">2</a>
		function nteNextPageUrls(listUrl, html, seen) {
			const pg = String(html || "").match(/<ul class="pagination">[\s\S]*?<\/ul>/);
			if (!pg) return [];
			const dir = listUrl.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
			const out = [];
			for (const m of pg[0].matchAll(/href="(index\d+\.html)"/g)) {
				const u = dir + m[1];
				if (u !== listUrl && !seen.has(u) && !out.includes(u)) out.push(u);
			}
			return out;
		}


		// 逐页（index.html → index1.html → index2.html …）从新到旧找"带新卡池"的维护/版本更新公告，
		// 取第一篇能解析出当期卡池/活动的正文；"不停服更新"不含新卡池，跳过。
		// 三态：有当期内容 → 数据；列表页有公告但都不含当期内容（或"不停服更新"）→ null（未公布）；
		//      列表页**一条公告链接都没有** → 抛错（官网列表改版，让面板显示"卡池失败"而不是"未公布"）。
		async function fetchNteWanmei(listUrl, signal, tz) {
			const ref = "https://yh.wanmei.com/";
			const seen = new Set();
			const queue = [listUrl];
			let details = 0;
			let sawAnyLink = false;
			while (queue.length && seen.size < NTE_MAX_LIST_PAGES) {
				const url = queue.shift();
				if (seen.has(url)) continue;
				seen.add(url);
				const html = await proxyFetchText(url, ref);
				if (/\/news\/gamebroad\/\d+\/\d+\.html/.test(html)) sawAnyLink = true;
				// 列表条目本身从新到旧：边收集边试，命中当期内容立刻返回
				for (const m of html.matchAll(NTE_ITEM_RE)) {
					if (!NTE_MAINT_RE.test(m[2]) || /不停服/.test(m[2])) continue;
					if (details >= NTE_MAX_DETAILS) return null;   // 试读额度用完（此时必然已见到公告链接）
					details++;
					const data = parseNteWanmei(await proxyFetchText("https://yh.wanmei.com" + m[1], ref), tz);
					if (data) return data;
				}
				for (const u of nteNextPageUrls(listUrl, html, seen)) if (!queue.includes(u)) queue.push(u);
			}
			if (!sawAnyLink) throw new Error("nte-list-shape-changed");
			return null;
		}


		// 异环公告里的「棋盘」条目解析（角色卡池）。
		//
		// 为什么从**「棋盘」**入手（用户建议，2026-09-30）：
		//   异环的角色卡池在公告里叫「X」**限定棋盘**，条目形如
		//     ● 全新限定S级角色「黑羽」
		//     开放时间：9月24日版本更新后-10月15日05:59
		//     棋盘说明：可通过「预言终幕时」限定棋盘获得S级角色「黑羽」。…
		//   `棋盘说明` 是**角色卡池独有的锚点** —— 弧盘走 `研募说明`、剧情段没有这个字段。
		//   用「有棋盘说明」筛，比用"全新限定S级角色"精确：后者漏掉**返场**（`限定S级角色「安魂曲」返场`，
		//   没有"全新"二字），而那也是一张在开的角色池。
		//
		// 旧实现只认 `全新限定S级角色「X」…开放时间：N月N日**维护**更新后-…` 一条正则，
		// 而现公告写的是 `**版本**更新后` → 一条都匹配不上 → 卡池为空 → `if (!data.banner) return null`
		// → `fetchNteWanmei` 继续往下试，最终拿 index1 页那篇**已过期**的旧公告冒充当期。
		function parseNteBoards(text, nowYear) {
			const lines = text.split("\n").map((l) => l.trim());
			// 「一、 全新角色&弧盘」这一段的边界（只在这里找，避免匹配到别处的"开放时间"）
			const start = lines.findIndex((l) => /^一、/.test(l));
			if (start < 0) return [];
			let end = lines.findIndex((l, i) => i > start && /^二、/.test(l));
			if (end < 0) end = lines.length;
			const pools = [];
			for (let i = start; i < end; i++) {
				const m = lines[i].match(/^●\s*(?:全新)?(限定S级角色|S级角色)「([^」]+)」(返场)?/);
				if (!m) continue;
				// 往后找该条目的「开放时间」与「棋盘说明」（各限 8 行内）
				let range = null, board = "";
				for (let j = i + 1; j < Math.min(end, i + 8); j++) {
					if (!range) {
						const t = lines[j].match(/^开放时间：(\d+)月(\d+)日(?:(?:维护|版本)更新后|(\d{1,2}):(\d{2}))\s*[-–—]\s*(\d+)月(\d+)日(\d{1,2}):(\d{2})/);
						if (t) {
							range = {
								sMo: +t[1], sD: +t[2], sH: t[3] ? +t[3] : 11, sMi: t[4] ? +t[4] : 0,
								eMo: +t[5], eD: +t[6], eH: +t[7], eMi: +t[8]
							};
						}
					}
					if (!board) {
						const b = lines[j].match(/棋盘说明：可通过「([^」]+)」限定棋盘获得/);
						if (b) board = b[1];
					}
				}
				// **有棋盘说明才是角色卡池**（弧盘那条走研募说明，会在这里被排除）
				if (!range || !board) continue;
				pools.push({
					name: board,
					// 类型：`全新限定S级角色` → 限定棋盘；`限定S级角色…返场` → 返场限定棋盘。
					// 注意 `限定` 属于**类型的一部分**，不是动词/修饰（与国服"更新限时限定招募"同理）。
					type: `${m[3] ? "返场" : ""}限定棋盘`,
					roles: baRoleName(m[2]),
					startTs: new Date(nowYear, range.sMo - 1, range.sD, range.sH, range.sMi).getTime(),
					endTs: new Date(nowYear, range.eMo - 1, range.eD, range.eH, range.eMi).getTime()
				});
			}
			return pools;
		}


		// 解析官网公告正文 → 当期卡池（有「棋盘说明」的角色卡池，按**统一规则**合并）+ 当期活动（限时活动）
		function parseNteWanmei(html, tz) {
			const text = String(html || "")
				.replace(/<script[\s\S]*?<\/script>/gi, " ")
				.replace(/<style[\s\S]*?<\/style>/gi, " ")
				.replace(/<[^>]+>/g, "\n")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\n\s*\n+/g, "\n").trim();
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			const data = { banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", event: "", eventDates: "", eventDatesRaw: "" };
			// 当期卡池：**按统一规则**——当前时刻落在开放期间内的「棋盘」全部合并外显。
			// 卡片/悬停都走 banner + roles（与其它游戏一致）：类型进 `banner`，
			// 悬停由面板兜底显示 `类型：角色` + 日期。**不构造 bannerHover**（同国服，见 §48.3d）。
			const now = nowMs();
			const nowYear = new Date(now).getFullYear();
			const active = parseNteBoards(text, nowYear)
				.filter((p) => p.endTs >= now && p.startTs <= now)
				.sort((a, b) => a.endTs - b.endTs);
			if (active.length > 0) {
				data.banner = [...new Set(active.map((p) => p.type))].join(" & ");
				data.roles = [...new Set(active.map((p) => p.roles).filter(Boolean))].join("、");
				// 窗口取结束最早的那个（与 selectCurrent 的 `first` 同口径）
				const first = active[0];
				data.bannerDates = `${fmt(new Date(first.startTs).getMonth() + 1, new Date(first.startTs).getDate(), new Date(first.startTs).getHours(), new Date(first.startTs).getMinutes())} ~ ${fmt(new Date(first.endTs).getMonth() + 1, new Date(first.endTs).getDate(), new Date(first.endTs).getHours(), new Date(first.endTs).getMinutes())}`;
				data.bannerDatesRaw = data.bannerDates;
			}
			// 当期活动：「X」限时活动 活动时间：M月D日(维护|版本)更新后|hh:mm-M月D日hh:mm
			const ev = text.match(/「([^」]+)」限时活动[\s\S]{0,200}?活动时间：(\d+)月(\d+)日(?:(?:维护|版本)更新后|(\d{1,2}):(\d{2}))\s*[-–—]\s*(\d+)月(\d+)日(\d{1,2}):(\d{2})/);
			if (ev) {
				const sMo = +ev[2], sD = +ev[3], sH = ev[4] ? +ev[4] : 11, sMi = ev[5] ? +ev[5] : 0;
				const eMo = +ev[6], eD = +ev[7], eH = +ev[8], eMi = +ev[9];
				data.event = ev[1];
				data.eventDates = `${fmt(sMo, sD, sH, sMi)} ~ ${fmt(eMo, eD, eH, eMi)}`;
				data.eventDatesRaw = data.eventDates;
			}
			if (!data.banner) return null;
			return data;
		}

		// ══ 以下为原 42-parsers-p5x.js 的内容（原样保留）══
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
		const y2 = m[4] ? +m[4] : (endsNextYear(mo1, null, +m[5], null) ? y1 + 1 : y1);   // 跨年：结束月小于开始月
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
// 归一化标题：去掉站点尾巴「-P5X-《女神异闻录：夜幕魅影》手游官网」
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
	const now = nowMs();
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
	const now = nowMs();
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

		// ── 条目 ──
		registerSource({
				id: "p5x",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "女神异闻录：夜幕魅影",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/03/1e/f4/031ef49f-b3d0-5bdd-077b-67d213f99c86/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://p5x.wanmei.com/news/gamenews/index.html",
				source: "官网公告",
				eventUrl: "https://p5x.wanmei.com/news/gamenews/index.html",
				eventSource: "官网公告",
		});

		registerSource({
				id: "nte",
				defaultHidden: false,
				tz: TZ_CN,
				parserVersion: 2,
				name: "异环",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/8/8c/YH_APP.png!/fw/64",
				source: "官网公告",
				// 经 host 代理抓取（wanmei 跨域无 CORS）；官方公告（服务端渲染）含当期限定棋盘卡池 + 限时活动起止
				url: "https://yh.wanmei.com/news/gamebroad/",
				// 活动源同官网公告（同一公告同时含卡池与活动）
				eventUrl: "https://yh.wanmei.com/news/gamebroad/",
				eventSource: "官网公告",
				// 备选：LDSHOP（静态表格，经 host 代理）
				altSources: [
					{ label: "LDSHOP", url: "https://www.ldshop.gg/tw/blog/nte/neverness-to-everness-banner.html", fetcher: "nte-ldshop" }
				]
		});

		// ── 抓取器登记 ──
					// 异环：ldshop（繁体，静态表格经 host 代理）
GACHA_FETCHERS["nte"] = (url, signal, tz) => fetchNteWanmei(url, signal, tz);
		GACHA_FETCHERS["nte-ldshop"] = (url, signal, tz) => fetchLdshopNte(url, signal, tz);
					// 异环：活动源就是同一篇官网公告（与卡池侧**同一条 URL**，fetchNteWanmei 一个函数同时解析两者）。
			// 注册成独立活动源的意义：卡池侧本轮抓挂、或用户把**卡池**来源改成自定义/备选时，
			// 活动侧仍能自己抓、自己报错，而不是整列空掉（复用只是"同一 URL 省一次请求"的优化，不是它的腿）。
EVENT_FETCHERS["nte"] = {
				default: (url, signal, tz) => fetchNteWanmei(url, signal, tz)
			};

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["p5x"] = (url, signal, tz) => ns_p5x_gachaP5x(url, signal, tz);
		EVENT_FETCHERS["p5x"] = Object.assign(EVENT_FETCHERS["p5x"] || {}, { default: (url, signal, tz) => ns_p5x_eventsP5x(url, signal, tz) });
