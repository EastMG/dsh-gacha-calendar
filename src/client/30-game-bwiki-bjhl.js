// src/client/30-game-bwiki-bjhl.js —— 白荆回廊（国服）：bwiki「历史卡池一览」+「活动一览」（prop=text 渲染后 HTML）
//
// ── 为什么单独一个文件（而不是塞进 30-game-bwiki-register.js）────────────────────
// 2026-10-03 起本仓库的惯例是「每款/每组游戏一个**自包含**文件」（条目 + 解析器 + 抓取器 + 登记），
// 后接入的 `30-game-wqmt.js` / `30-game-pengpeng.js` / `30-game-zspms-official.js` 都按这个写法。
// 白荆回廊的两条来源都落在 `wiki.biligame.com/bjhl`，但它们是**两个不同的页面、两种不同的 HTML 结构**
// （卡池是 `draw-box` 卡片流，活动是 `activity-box` 卡片流），与 bwiki-register 里那 4 条
// （物华/战双/卡厄斯/雪松）互不相干 ⇒ 新开一个文件，不动既有条目。
// 复用的只有**公共层**：`fetchMediaWikiText`（自动补 `origin=*` + 取 `parse.text`）、
// `ns_bwiki_windowsFromCell`（日期/时间 → 绝对窗口，两份文本）、`ns_bwiki_gachaPayload` /
// `ns_bwiki_eventPayload`（选当期 + 悬停 + 数组收口）。**没有**第二套时间解析、也没有第二套悬停排版。
//
// ── 源站事实（2026-11-15 实测，夹具见 test/fixtures/bjhl-gacha / bjhl-events）──────────
//   卡池：GET https://wiki.biligame.com/bjhl/api.php?action=parse&page=历史卡池一览&prop=text&format=json&formatversion=2
//         → `JSON.parse.text` 是**渲染后的 HTML**（数据由 Lua `Module:卡池图鉴` 生成，SMW `action=ask` 查不到）
//         195 张卡片，一张卡一段（**不含未来池之外的特殊标记**）：
//           <div class="draw-box divsort" data-param1="常态共鸣·UP">
//             …<div class="draw-name">常态共鸣·红珠小姐</div>
//             <div class="draw-open">2026.11.19 04:00 ~ 2026.12.03 03:50</div>
//             …「概率提升」角色 = `<a title="同调者/红珠小姐">`（潜航类池子只有 `记忆烙痕/…`，无角色）
//   活动：GET 同站 action=parse&page=活动一览
//         55 张卡片：`<div class="divsort activity-box">` → `.activity-name` / `.activity-type` /
//         `.activity-open`（`2026-11-05 10:00:00 ~ 2026-12-03 03:50:00`，**带秒**）
//   时区：`Asia/Shanghai`（国服；源站未显式标注，与同站其余国服 wik i同口径）。
//   Referer：bwiki 对高频请求会回 567（WAF 挑战页），统一带 `Referer: https://wiki.biligame.com/`。
//   请求数：每侧 **1 个**（两个页面各一次 action=parse）。
//
// ── 字段口径 ──────────────────────────────────────────────────────────────────────
//   池名 = `.draw-name` 原文；角色 = 该卡片 `同调者/…` 链接（去重、保序，`、` 连接）。
//   角色**只去掉**已经被池名写进去的那一个（`常态共鸣·红珠小姐` 的 `红珠小姐`）—— 不去就是
//   `常态共鸣·红珠小姐：红珠小姐`；只做这层去重，不改写池名、也不补池名里没有的角色。
//   活动名 = `.activity-name` 原文；类别 = `.activity-type`（`普通活动` / `主题活动` / `联动活动` / `测试`），
//   只用于 `ns_bwiki_eventTier` 的档位判定，不进外显。
//   起止：源站墙钟 → `ns_bwiki_windowsFromCell(..., tz)`（两端都是绝对墙钟，`raw` 与 `display` 按公共层约定分开）。
//
// ── 失败语义（与全仓一致）────────────────────────────────────────────────────────
//   · HTTP 非 2xx / 响应不是 JSON / 没有 `parse.text` ⇒ **抛**（`fetchMediaWikiText` 自己抛 `http-…` / `bad-json`）；
//   · 拿到了页面却**一张卡片都解不出**（源站改版）⇒ **抛**（抓取失败，不是"当期没有"）；
//   · 卡片解出来了、但没有一张覆盖当前时刻 ⇒ 返回 `null`（未公布，不硬凑过期档期）。

//#region ① 白荆回廊（bjhl / 历史卡池一览 + 活动一览）
// 两个页面的 URL 是**条目的事实**（登记与夹具索引都按它逐字比对），所以集中在这里
const BJHL_TZ = "Asia/Shanghai";
const BJHL_REFERER = "https://wiki.biligame.com/";
const BJHL_GACHA_PAGE = "历史卡池一览";
const BJHL_EVENTS_PAGE = "活动一览";
function ns_bwiki_bjhlPageUrl(page) {
	return "https://wiki.biligame.com/bjhl/api.php?action=parse&page=" + page + "&prop=text&format=json&formatversion=2";
}
const BJHL_GACHA_URL = ns_bwiki_bjhlPageUrl(BJHL_GACHA_PAGE);
const BJHL_EVENTS_URL = ns_bwiki_bjhlPageUrl(BJHL_EVENTS_PAGE);

// 卡片流：按**卡片起点**切片（`<div>` 嵌套，「到下一张卡起点」比配对闭合更稳）。
// 卡池卡 = `<div class="draw-box …" data-param1="<卡池类型>">`；活动卡 = `<div class="divsort activity-box" …>`。
function ns_bwiki_bjhlCardsOf(html, re) {
	const s = String(html == null ? "" : html);
	const starts = [];
	const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
	let m;
	while ((m = r.exec(s))) starts.push({ at: m.index, type: m[1] || "" });
	const out = [];
	for (let i = 0; i < starts.length; i++) {
		out.push({ type: starts[i].type, html: s.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : s.length) });
	}
	return out;
}

// 卡片里的「概率提升」角色：`<a title="同调者/红珠小姐">`（潜航类池子只有 `记忆烙痕/…` ⇒ 空串）
function ns_bwiki_bjhlRolesOf(cardHtml, banner) {
	const out = [], seen = new Set();
	const re = /<a\b[^>]*\btitle="同调者\/([^"]*)"/gi;
	let m;
	while ((m = re.exec(String(cardHtml == null ? "" : cardHtml)))) {
		const name = stripTags(m[1]).trim();
		if (!name || seen.has(name)) continue;
		if (banner && banner.indexOf(name) >= 0) continue;   // 池名已经写了这个角色 ⇒ 不重复列（只去掉，不改写）
		seen.add(name);
		out.push(name);
	}
	return out.join("、");
}

// 历史卡池一览 → 条目事实（形状与 whmx 同：`{ banner, roles, startTs, endTs, raw, display }`）
function ns_bwiki_parseBjhlGacha(html, tz = BJHL_TZ) {
	const items = [];
	let i = 0;
	for (const card of ns_bwiki_bjhlCardsOf(html, /<div class="draw-box[^"]*"\s+data-param1="([^"]*)"/)) {
		const nm = /<div class="draw-name">([\s\S]*?)<\/div>/.exec(card.html);
		const op = /<div class="draw-open">([\s\S]*?)<\/div>/.exec(card.html);
		if (!nm || !op) continue;
		const banner = stripTags(nm[1]).replace(/\s+/g, " ").trim();
		const open = stripTags(op[1]).replace(/\s+/g, " ").trim();
		// 两种页面的时间写法都吃：`2026.11.19 04:00 ~ 2026.12.03 03:50` / `2026-11-05 10:00:00 ~ …`
		const w = ns_bwiki_windowsFromCell(open, tz, "startFirst")[0];
		if (!banner || !w) continue;
		items.push({
			_i: i++, banner, roles: ns_bwiki_bjhlRolesOf(card.html, banner),
			startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display
		});
	}
	return items;
}

// 活动一览 → 条目事实（形状与 whmx 活动同：`{ event, category, startTs, endTs, raw, display }`）
function ns_bwiki_parseBjhlEvents(html, tz = BJHL_TZ) {
	const items = [];
	let i = 0;
	for (const card of ns_bwiki_bjhlCardsOf(html, /<div class="divsort activity-box"[^>]*data-param1="([^"]*)"/)) {
		const nm = /<a class="activity-name"[^>]*>([\s\S]*?)<\/a>/.exec(card.html);
		const ty = /<div class="activity-type">([\s\S]*?)<\/div>/.exec(card.html);
		const op = /<div class="activity-open">([\s\S]*?)<\/div>/.exec(card.html);
		if (!nm || !op) continue;
		const event = stripTags(nm[1]).replace(/\s+/g, " ").trim();
		const open = stripTags(op[1]).replace(/\s+/g, " ").trim();
		const w = ns_bwiki_windowsFromCell(open, tz, "startFirst")[0];
		if (!event || !w) continue;
		items.push({
			_i: i++, event, category: ty ? stripTags(ty[1]).trim() : "",
			startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display
		});
	}
	return items;
}

//#endregion

//#region ② 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
// `fetchMediaWikiText` 会补 `origin=*` 并取 `parse.text`；`referer` 走宿主代理的 referer 参数。
async function ns_bwiki_fetchBjhlHtml(url, signal) {
	return fetchMediaWikiText(url, { signal, mode: "proxy", referer: BJHL_REFERER });
}
// 卡池侧：一张卡都解不出 ⇒ **抛**（源站改版），不是"当期没有"
async function ns_bwiki_gachaBjhl(url, signal, tz = BJHL_TZ, now) {
	const items = ns_bwiki_parseBjhlGacha(await ns_bwiki_fetchBjhlHtml(url, signal), tz);
	if (items.length === 0) throw new Error("bjhl-gacha-changed:no-cards");
	// 用「同批合并角色」那一版载荷（`ns_bwiki_batchGachaPayloadOf`，与无期迷途 / 夜幕之下同一份）：
	// 白荆回廊同时开 5~6 类池（常态共鸣·UP / 定向共鸣 / 联合共鸣 / 识海甄录 / 启明·先觉·定向潜航），
	// 而 `ns_bwiki_gachaPayload` 会把**所有**在期池的角色并到外显那口池上 ——
	// 实测 2026-11-15：外显「常态共鸣·昊苍」，角色却被填成另一口定向共鸣池的 4 个角色。
	// 这一版只合并**与外显池同批（endTs 相同）**的池：卡池整批换，同一结束时刻就是同一批。
	return ns_bwiki_batchGachaPayloadOf(items, tz, ns_bwiki_nowOf(now), { id: "bjhl" });
}
// 活动侧：同上
async function ns_bwiki_eventsBjhl(url, signal, tz = BJHL_TZ, now) {
	const items = ns_bwiki_parseBjhlEvents(await ns_bwiki_fetchBjhlHtml(url, signal), tz);
	if (items.length === 0) throw new Error("bjhl-events-changed:no-cards");
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now));
}
//#endregion

//#region ③ 条目登记
	registerSource({
		id: "bjhl",
		defaultHidden: false,
		tz: BJHL_TZ,
		name: "白荆回廊",
		// 卡池侧与活动侧是**两个页面**（页面名即事实，见本文件头）
		url: BJHL_GACHA_URL,
		source: "Bwiki 历史卡池",
		eventUrl: BJHL_EVENTS_URL,
		eventSource: "Bwiki 活动一览",
	});
	GACHA_FETCHERS["bjhl"] = (url, signal, tz) => ns_bwiki_gachaBjhl(url, signal, tz);
	EVENT_FETCHERS["bjhl"] = Object.assign(EVENT_FETCHERS["bjhl"] || {}, {
		default: (url, signal, tz) => ns_bwiki_eventsBjhl(url, signal, tz)
	});
//#endregion
