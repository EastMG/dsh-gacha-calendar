// src/client/30-game-bwiki-bjhl.js —— 白荆回廊（国服）：bwiki「历史卡池一览」（prop=text 渲染后 HTML）
//   +「活动一览」的 SMW `分类:活动`（action=ask 结构化 JSON）
//
// ── 为什么单独一个文件（而不是塞进 30-game-bwiki-register.js）────────────────────
// 2026-10-03 起本仓库的惯例是「每款/每组游戏一个**自包含**文件」（条目 + 解析器 + 抓取器 + 登记），
// 后接入的 `30-game-wqmt.js` / `30-game-pengpeng.js` / `30-game-zspms-official.js` 都按这个写法。
// 白荆回廊的两条来源都落在 `wiki.biligame.com/bjhl`，但**取数形态不同**：卡池是 Lua 渲染出来的
// `draw-box` 卡片流（SMW 查不到），活动是 wiki 自己的 `分类:活动`（SMW 属性齐全、结构化）
// ⇒ 新开一个文件，不动既有条目。
// 复用的只有**公共层**：`fetchMediaWikiText`（卡池：自动补 `origin=*` + 取 `parse.text`）、
// `fetchJson`（活动 ask）、`ns_bwiki_windowsFromCell`（日期/时间 → 绝对窗口，两份文本）与
// `ns_bwiki_batchGachaPayloadOf` / `ns_bwiki_eventPayload`（选当期 + 悬停 + 数组收口）。
// **没有**第二套时间解析、也没有第二套悬停排版。
//
// ── 源站事实（2026-11-15 实测，夹具见 test/fixtures/bjhl-gacha / bjhl-events）──────────
//   卡池：GET https://wiki.biligame.com/bjhl/api.php?action=parse&page=历史卡池一览&prop=text&format=json&formatversion=2
//         → `JSON.parse.text` 是**渲染后的 HTML**（数据由 Lua `Module:卡池图鉴` 生成，SMW `action=ask` 查不到）
//         195 张卡片，一张卡一段（**不含未来池之外的特殊标记**）：
//           <div class="draw-box divsort" data-param1="常态共鸣·UP">
//             …<div class="draw-name">常态共鸣·红珠小姐</div>
//             <div class="draw-open">2026.11.19 04:00 ~ 2026.12.03 03:50</div>
//             …「概率提升」角色 = `<a title="同调者/红珠小姐">`（潜航类池子只有 `记忆烙痕/…`，无角色）
//   活动：GET 同站 `action=ask&format=json&query=<urlencoded>`（2026-11-15 换掉「action=parse 取
//         Lua 渲染后的 HTML 再解析」那层：活动页的 `.activity-box` 卡片就是这份 SMW 查询渲染出来的）
//         查询 = `[[分类:活动]][[结束时间::+]]|?开始时间|?结束时间|?活动名称|?活动类型|limit=500`
//         实测 200 / 26,933 B / **55 行**（`limit=500` 一次拿全，无 `query-continue-offset` ⇒ 恒 1 个请求）。
//         四列都是 `_txt`（printouts = 字符串数组），时间 = 补零 ISO 墙钟且**带秒**
//         （`2026-11-05 10:00:00` ~ `2026-12-03 03:50:00`，与旧 HTML 的 `.activity-open` 逐字同形）；
//         `活动名称` 有值（页名可能只是简称：实测页 `「寻花异旅，此世同行」` 的名称带完整前缀）；
//         `活动类型` = `普通活动` / `主题活动` / `联动活动` / `测试`（旧 `.activity-type` 那一列）。
//         没有 `?角色` 属性（实测 printouts 恒为空数组）⇒ 活动侧本来就没有角色字段，不编。
//   时区：`Asia/Shanghai`（国服；源站未显式标注，与同站其余国服 wiki 同口径）。
//   Referer：bwiki 对高频请求会回 567（WAF 挑战页），统一带 `Referer: https://wiki.biligame.com/`。
//   请求数：每侧 **1 个**（卡池一次 action=parse、活动一次 action=ask）。
//
// ── 字段口径 ──────────────────────────────────────────────────────────────────────
//   池名 = `.draw-name` 原文；角色 = 该卡片 `同调者/…` 链接（去重、保序，`、` 连接）。
//   角色**只去掉**已经被池名写进去的那一个（`常态共鸣·红珠小姐` 的 `红珠小姐`）—— 不去就是
//   `常态共鸣·红珠小姐：红珠小姐`；只做这层去重，不改写池名、也不补池名里没有的角色。
//   活动名 = printout `活动名称`（没值才退回页名）；类别 = `活动类型`（多值 `、` 连接），
//   只用于 `ns_bwiki_eventTier` 的档位判定，不进外显。
//   起止：`开始时间` / `结束时间` 两列 → `ns_bwiki_windowsFromCell("起 ~ 止", tz)`（两端都是绝对墙钟，
//   `raw` 与 `display` 按公共层约定分开）；**缺任一端 / 窗口不成立（源站错行）⇒ 那条不产出**
//   （与旧 HTML 口径一致：`.activity-open` 里至少两个日期点才成一条）。
//
// ── 失败语义（与全仓一致）────────────────────────────────────────────────────────
//   · HTTP 非 2xx / 响应不是 JSON ⇒ **抛**（`fetchJson` 自己抛 `http-…` / `bad-json`）；
//   · 卡池页面**没有 `parse.text`** / 一张卡片都解不出（源站改版）⇒ **抛**；
//   · 活动响应**没有 `query.results`**（`{}` / 结构变）或 printouts 一条都解不出 ⇒ **抛**
//     （`bjhl-events-changed:bad-json` / `bjhl-events-changed:no-rows`）；
//   · 解出来了、但没有一条覆盖当前时刻 ⇒ 返回 `null`（未公布，不硬凑过期档期）。

//#region ① 白荆回廊（bjhl / 历史卡池一览 + 活动一览）
// 两个入口的 URL 是**条目的事实**（登记与夹具索引都按它逐字比对），所以集中在这里
const BJHL_TZ = "Asia/Shanghai";
const BJHL_REFERER = "https://wiki.biligame.com/";
const BJHL_GACHA_PAGE = "历史卡池一览";
function ns_bwiki_bjhlPageUrl(page) {
	return "https://wiki.biligame.com/bjhl/api.php?action=parse&page=" + page + "&prop=text&format=json&formatversion=2";
}
const BJHL_GACHA_URL = ns_bwiki_bjhlPageUrl(BJHL_GACHA_PAGE);

// 活动侧：SMW `action=ask`。列名 = wiki 自己的属性名（`_txt`，实测值见文件头）；`limit=500` 是 SMW
// 单页上限（当前 55 行 ⇒ 一次拿全）。`[[结束时间::+]]` 保留：该 wiki 这两列现在是 `_txt`（实测不过滤，
// 两种写法都回 55 行），若日后改成 `_dat` 它会自动把往期挡在取数层（下游 `coversNow` 仍是最终判据）。
const BJHL_EVENTS_API = "https://wiki.biligame.com/bjhl/api.php";
const BJHL_EVENTS_PAGE_SIZE = 500;
const BJHL_EVENTS_KEY_NAME = "活动名称";
const BJHL_EVENTS_KEY_START = "开始时间";
const BJHL_EVENTS_KEY_END = "结束时间";
const BJHL_EVENTS_KEY_TYPE = "活动类型";
const BJHL_EVENTS_QUERY = "[[分类:活动]][[结束时间::+]]"
	+ `|?${BJHL_EVENTS_KEY_START}|?${BJHL_EVENTS_KEY_END}|?${BJHL_EVENTS_KEY_NAME}|?${BJHL_EVENTS_KEY_TYPE}`
	+ `|limit=${BJHL_EVENTS_PAGE_SIZE}`;
const BJHL_EVENTS_MAX_PAGES = 2;
// 第 2 页（`|offset=500`）—— URL 由**同一个 query 串**拼出来，测试与夹具都按它比对。
// ⚠️ 续页 URL 在 `query=` 的**尾部**扩展（`…limit%3D500%7Coffset%3D500`），与基准 URL 是前缀关系：
// 夹具映射的"前缀命中"兜底会让续页命中第 1 页。当前 55 行 < 500，续页在夹具里永不触发；真到那一天，
// 给续页补一条精确映射即可（不要为此把续页 URL 拼成另一种形态）。
function ns_bwiki_bjhlEventsUrlOf(offset) {
	const n = Number(offset);
	const q = n > 0 ? `${BJHL_EVENTS_QUERY}|offset=${n}` : BJHL_EVENTS_QUERY;
	return BJHL_EVENTS_API + "?action=ask&format=json&query=" + encodeURIComponent(q);
}
const BJHL_EVENTS_URL = ns_bwiki_bjhlEventsUrlOf(0);

// 卡片流：按**卡片起点**切片（`<div>` 嵌套，「到下一张卡起点」比配对闭合更稳）。
// 目前只有卡池侧在用（活动侧已改 SMW ask，不再解析 HTML）：卡池卡 = `<div class="draw-box …" data-param1="<卡池类型>">`。
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

// ask 的 printout 值 → 首个非空字符串（兼容 `["2026-11-05 10:00:00"]` / `[{ timestamp }]` / `[{ raw }]`）
function ns_bwiki_bjhlTextOf(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return ns_bwiki_bjhlTextOf(v[0]);
	if (typeof v === "object") {
		if (typeof v.raw === "string" && v.raw.trim() !== "") return v.raw.trim();
		if (typeof v.timestamp === "number") return String(v.timestamp);
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}

// 活动 ask JSON → 条目事实（形状与 whmx / yslz 活动同：`{ _i, event, category, startTs, endTs, raw, display }`）
// `活动名称` 是干净名（页名可能只是简称）；`活动类型` 多值用 `、` 连成 `category`（只给档位判定）。
// 两端都明确才产出（与旧 HTML 口径一致：`.activity-open` 里两个日期点才成窗口）；缺一端 / 窗口不成立 ⇒ 不产出。
function ns_bwiki_parseBjhlEvents(json, tz = BJHL_TZ) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) {
		throw new Error("bjhl-events-changed:bad-json");
	}
	const items = [];
	for (const [page, v] of Object.entries(results)) {
		if (!v || typeof v !== "object") continue;
		const p = v.printouts;
		if (!p || typeof p !== "object") continue;
		const event = ns_bwiki_bjhlTextOf(p[BJHL_EVENTS_KEY_NAME]).replace(/\s+/g, " ").trim()
			|| String(page).replace(/\s+/g, " ").trim();
		if (!event) continue;
		const startText = ns_bwiki_bjhlTextOf(p[BJHL_EVENTS_KEY_START]);
		const endText = ns_bwiki_bjhlTextOf(p[BJHL_EVENTS_KEY_END]);
		if (!startText || !endText) continue;                    // 缺任一端 ⇒ 不猜（不补 00:00 / 23:59）
		const w = ns_bwiki_windowsFromCell(`${startText} ~ ${endText}`, tz, "startFirst")[0];
		if (!w) continue;                                        // 源站错行（end <= start）⇒ 丢掉
		const types = (Array.isArray(p[BJHL_EVENTS_KEY_TYPE]) ? p[BJHL_EVENTS_KEY_TYPE] : [p[BJHL_EVENTS_KEY_TYPE]])
			.map((x) => ns_bwiki_bjhlTextOf(x)).filter(Boolean);
		items.push({
			_i: items.length, event, category: types.join("、"),
			startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display
		});
	}
	if (items.length === 0) throw new Error("bjhl-events-changed:no-rows");   // 属性名/结构改了 = 结构性损坏
	return items;
}

//#endregion

//#region ② 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
// 卡池：`fetchMediaWikiText` 会补 `origin=*` 并取 `parse.text`；`referer` 走宿主代理的 referer 参数。
async function ns_bwiki_fetchBjhlHtml(url, signal) {
	return fetchMediaWikiText(url, { signal, mode: "proxy", referer: BJHL_REFERER });
}
// 活动：`fetchJson`（同一条 transport 出口：宿主代理 + `Referer`，`origin=*` 由出口统一补）
async function ns_bwiki_fetchBjhlJson(url, signal) {
	return fetchJson(String(url == null ? "" : url), { signal, mode: "proxy", referer: BJHL_REFERER });
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
// 活动侧：`|offset=` 续页（SMW 单页 500 行）。当前 55 行 ⇒ 恒 1 个请求；超过才发第 2 个。
// ⚠️ 续页用 `ns_bwiki_bjhlEventsUrlOf(offset)` 这条**规范地址**（offset 夹在编码过的 query 串里，
//    没法从任意自定义地址安全地重拼）；自定义活动地址只会用到它的第 1 页。
async function ns_bwiki_bjhlEventsOf(url, signal) {
	const base = String(url == null ? "" : url) || BJHL_EVENTS_URL;
	const merged = { query: { results: {} } };
	let offset = 0;
	for (let page = 0; page < BJHL_EVENTS_MAX_PAGES; page++) {
		const json = await ns_bwiki_fetchBjhlJson(page === 0 ? base : ns_bwiki_bjhlEventsUrlOf(offset), signal);
		const results = json && json.query && json.query.results;
		if (!results || typeof results !== "object" || Array.isArray(results)) {
			throw new Error("bjhl-events-changed:bad-json");
		}
		Object.assign(merged.query.results, results);
		const next = Number(json["query-continue-offset"]);
		if (!Number.isFinite(next) || next <= offset) return merged;
		offset = next;
	}
	return merged;
}
// 活动侧：解出来但一条都不覆盖当期 ⇒ `ns_bwiki_eventPayload` 返回 null（未公布，不是失败）
async function ns_bwiki_eventsBjhl(url, signal, tz = BJHL_TZ, now) {
	const items = ns_bwiki_parseBjhlEvents(await ns_bwiki_bjhlEventsOf(url, signal), tz);
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now));
}
//#endregion

//#region ③ 条目登记
	registerSource({
		id: "bjhl",
		defaultHidden: false,
		tz: BJHL_TZ,
		name: "白荆回廊",
		icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/85/4d/b9/854db9d3-2fa2-c3ac-f96a-aa0e6db4a7c5/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
		// 卡池侧 = 渲染后 HTML 页面；活动侧 = SMW `分类:活动`（两个入口不同形态，见本文件头）
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
