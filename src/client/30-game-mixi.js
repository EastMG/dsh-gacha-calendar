// src/client/30-game-mixi.js —— MIXI：怪物弹珠·日服（gwdz）
//
// 职责（2026-11-16 按厂商重排）：由 30-game-bwiki-batch5.js 拆出；条目 + 解析器 + 抓取器 + 登记都在本文件。
// 源：① 卡池 = bwiki `Data:GachaConfig.json`（JSON 直读；`9999/9/9 99:59` 哨兵 ⇒ endTs=null）
//     ② 活动 = `Widget:游戏活动日历` 的 `CALENDAR_DATA.events`（结构化配对；`recur` / 单日解禁跳过）。
// 复用关系：bwiki 公共层（载荷生成器 + `ns_b5_*` 时间锚 helper）；符号名 `ns_gwdz_*` 原样保留。
// 请求预算：卡池 1 + 活动 1 = 每轮 2 次（两侧 URL 不同，不共享）。

// ② gwdz / 怪物弹珠（中文 wiki；游戏是日版内容、wiki 用中文写）
//    ① 卡池：GET …/gwdz/api.php?action=parse&page=Data:GachaConfig.json&prop=wikitext&format=json&formatversion=2
//       `parse.wikitext` 是**一份 JSON 字符串**（不是 HTML）⇒ `JSON.parse` 后取 `卡池列表`：
//       每条 `{ 名称, 启用, 启用时间, 关闭时间, 相对路径, 引用卡池列表? }`。
//       `启用:false` 的是模板条目（`池基础` / `友情抽` / `4星基础-暗`）⇒ 跳过。
//       `关闭时间` 为 **`9999/9/9 99:59` 哨兵**（常驻池：彩兽神祭/超兽神祭/…）⇒ `endTs = null`
//       （仓库口径：终点未知**不算**当期；事实仍保留在条目里）。
//       实测在期：`物语` = 无职转生Ⅲ联动-6星3体up，2026/11/15 11:00 ~ 2026/12/02 10:59。
//    ② 活动：GET …/gwdz/api.php?action=parse&page=Widget:游戏活动日历&prop=wikitext&format=json&formatversion=2
//       正文里是 `var CALENDAR_DATA = { meta, categories, events:[…] }`（**wiki 自己的活动日历数据**，
//       页内注释明写「更新：只改下面 CALENDAR_DATA 里的 events 数组」）。每个事件
//       `{ start, end, time, endTime, title, type, recur? }`；带 `recur` 的是每月轮换（无具体窗口）⇒ 跳过。
//       ⚠️ 为什么不是 `#ask`：该 wiki 的活动记事（`分类:活动记事`）是**月份总览页**，
//       `{{活动记事}}` 用 `{{#set:}}` 写在**页面上**（不是子对象）⇒ SMW 的 printouts 是
//       页面级多值数组（`活动期间` / `活动全称` / `活动类型` 各存一份），**无法把「名称 ↔ 期间 ↔ 类型」配成一行**；
//       实测 `[[分类:活动记事]][[活动期间::>2026/11/01]]` 连日期过滤都不生效（`_txt` 类型）。
//       所以活动侧取 wiki 自己的 `CALENDAR_DATA`（结构化、按事件配对、页内自述为维护入口）。

//#region ② 怪物弹珠（gwdz）：卡池 = `Data:GachaConfig.json`（JSON 直读）；活动 = 活动日历 `CALENDAR_DATA`
const ns_gwdz_TZ = "Asia/Shanghai";
const ns_gwdz_GACHA_PAGE = "Data:GachaConfig.json";
const ns_gwdz_GACHA_URL = "https://wiki.biligame.com/gwdz/api.php?action=parse&page="
	+ encodeURIComponent(ns_gwdz_GACHA_PAGE) + "&prop=wikitext&format=json&formatversion=2";
const ns_gwdz_CAL_PAGE = "Widget:游戏活动日历";
const ns_gwdz_CAL_URL = "https://wiki.biligame.com/gwdz/api.php?action=parse&page="
	+ encodeURIComponent(ns_gwdz_CAL_PAGE) + "&prop=wikitext&format=json&formatversion=2";
// `关闭时间` 是 `9999/9/9 99:59` 这类哨兵 ⇒ 常驻池（`endTs = null`，见文件头 ④①）
function ns_gwdz_isSentinel(point) {
	return !!point && (point.y >= 9999 || point.mo > 12 || point.d > 31 || (point.h != null && point.h > 23) || (point.mi != null && point.mi > 59));
}
// `parse.wikitext`（JSON 字符串）→ 条目事实
function ns_gwdz_parseConfig(json, tz = ns_gwdz_TZ) {
	const wikitext = json && json.parse && json.parse.wikitext;
	if (typeof wikitext !== "string") throw new Error("gwdz-config:bad-json");
	let cfg;
	try { cfg = JSON.parse(wikitext); } catch { throw new Error("gwdz-config:bad-json"); }
	const list = cfg && cfg.卡池列表;
	if (!list || typeof list !== "object" || Array.isArray(list)) throw new Error("gwdz-config:bad-list");
	const rows = [];
	let i = 0;
	for (const [, v] of Object.entries(list)) {
		if (!v || typeof v !== "object") continue;
		if (v.启用 !== true) continue;                                  // 模板条目（池基础 / 友情抽 / 4星基础-暗）
		const banner = String(v.名称 == null ? "" : v.名称).replace(/\s+/g, " ").trim();
		const sp = ns_b5_pointOfText(v.启用时间);
		if (!banner || !sp) continue;
		const epRaw = ns_b5_pointOfText(v.关闭时间);
		const startTs = ns_b5_tsOf(sp, false, tz);
		const sentinel = ns_gwdz_isSentinel(epRaw);
		const endTs = epRaw && !sentinel ? ns_b5_tsOf(epRaw, true, tz) : null;
		if (endTs != null && !(endTs > startTs)) continue;
		const rawEnd = String(v.关闭时间 == null ? "" : v.关闭时间).trim();
		const rawStart = String(v.启用时间 == null ? "" : v.启用时间).trim();
		rows.push({
			_i: i++,
			banner,
			roles: "",
			category: "",
			startTs,
			endTs,                                                       // 常驻（哨兵）= null：不算当期
			raw: rawEnd ? `${rawStart} ~ ${rawEnd}` : rawStart,          // 源站原文（起止两格各按原样）
			display: endTs == null ? ns_b5_stampOf(sp) : fmtWindow(startTs, endTs, tz),
			isMain: true
		});
	}
	if (rows.length === 0) throw new Error("gwdz-config:no-rows");
	return rows;
}
// ── 活动日历 `CALENDAR_DATA` ───────────────────────────────────────────────────
// 从 JS 对象字面量里取 `events: [ … ]`：**按括号平衡 + 跳过字符串与 // 行注释**切片（不 eval）。
function ns_gwdz_sliceBalance(text, openCh, closeCh, from) {
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		const c = text[i];
		if (c === '"') { i++; while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; } continue; }
		if (c === "/" && text[i + 1] === "/") { const n = text.indexOf("\n", i); i = n < 0 ? text.length : n; continue; }
		if (c === openCh) depth++;
		else if (c === closeCh) { depth--; if (depth === 0) return { start: from, end: i, text: text.slice(from, i + 1) }; }
	}
	return null;
}
// `var CALENDAR_DATA = { … };` → 对象字面量文本（找不到 ⇒ 结构损坏）
function ns_gwdz_calendarObjectOf(wikitext) {
	const s = String(wikitext == null ? "" : wikitext);
	const at = s.indexOf("var CALENDAR_DATA");
	if (at < 0) throw new Error("gwdz-calendar:bad-json");
	const objStart = s.indexOf("{", at);
	if (objStart < 0) throw new Error("gwdz-calendar:bad-json");
	const seg = ns_gwdz_sliceBalance(s, "{", "}", objStart);
	if (!seg) throw new Error("gwdz-calendar:bad-json");
	return seg.text;
}
// events 数组 → 逐条对象文本（跳过统一 `recur` 轮换；不 eval，只按花括号切）
function ns_gwdz_eventObjectsOf(objText) {
	// ⚠️ 必须认**属性名** `events:` + `[`（注释里也出现过 "events 数组" 这种字样，
	//    按裸 `indexOf("events")` 会切到 meta.notices 那个数组 —— 2026-11-15 实测踩过）
	const s = String(objText);
	const m = /\bevents\s*:\s*\[/.exec(s);
	if (!m) throw new Error("gwdz-calendar:bad-events");
	const arrStart = m.index + m[0].length - 1;
	const seg = ns_gwdz_sliceBalance(s, "[", "]", arrStart);
	if (!seg) throw new Error("gwdz-calendar:bad-events");
	const arr = seg.text;
	const out = [];
	for (let i = 0; i < arr.length; i++) {
		if (arr[i] !== "{") continue;
		const one = ns_gwdz_sliceBalance(arr, "{", "}", i);
		if (!one) break;
		out.push(one.text);
		i = one.end;
	}
	if (out.length === 0) throw new Error("gwdz-calendar:no-events");
	return out;
}
// 对象文本里取某个 `key: "值"`（只认字符串值；取不到 ⇒ ""）
function ns_gwdz_fieldOf(objText, key) {
	const s = String(objText);
	const re = new RegExp("(?:^|[\\s,{])" + key + "\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
	const m = re.exec(s);
	if (!m) return "";
	return m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
}
// `CALENDAR_DATA` → 活动条目事实（纯函数）。单日解禁（`endTime` 空且同一天）⇒ 没有窗口 ⇒ 跳过。
function ns_gwdz_parseCalendar(wikitext, tz = ns_gwdz_TZ) {
	const objects = ns_gwdz_eventObjectsOf(ns_gwdz_calendarObjectOf(wikitext));
	const rows = [];
	let i = 0;
	for (const obj of objects) {
		if (/\brecur\s*:/.test(obj)) continue;                          // 每月轮换：没有具体窗口
		const title = ns_gwdz_fieldOf(obj, "title");
		const startText = ns_gwdz_fieldOf(obj, "start");
		const endText = ns_gwdz_fieldOf(obj, "end");
		const timeText = ns_gwdz_fieldOf(obj, "time") || "00:00";
		const endTimeText = ns_gwdz_fieldOf(obj, "endTime");
		if (!title || !startText) continue;
		const sp = ns_b5_pointOfText(`${startText} ${timeText}`);
		if (!sp) continue;
		const epDay = endText ? ns_b5_pointOfText(endText) : null;
		let ep = null;
		if (epDay && endTimeText) ep = ns_b5_pointOfText(`${endText} ${endTimeText}`);
		else if (epDay && endText !== startText) ep = { ...epDay, h: 23, mi: 59 };
		if (!ep) continue;                                             // 单日解禁 / 维护：一个时刻，不构成窗口
		const startTs = ns_b5_tsOf(sp, false, tz);
		const endTs = ns_b5_tsOf(ep, true, tz);
		if (!(endTs > startTs)) continue;
		const raw = `${ns_b5_stampOf(sp)} ~ ${ns_b5_stampOf(ep)}`;
		rows.push({
			_i: i++,
			event: title,
			kind: ns_gwdz_fieldOf(obj, "type"),
			category: ns_gwdz_fieldOf(obj, "type"),
			startTs,
			endTs,
			raw,
			display: fmtWindow(startTs, endTs, tz)
		});
	}
	if (rows.length === 0) throw new Error("gwdz-calendar:no-window");
	return rows;
}
function ns_gwdz_gachaPayloadOf(items, tz, now) {
	return ns_bwiki_batchGachaPayloadOf(Array.isArray(items) ? items : [], tz, now, { id: "gwdz" });
}
function ns_gwdz_eventPayloadOf(items, tz, now) {
	return ns_bwiki_eventPayload(Array.isArray(items) ? items : [], tz, now, 0, "gwdz");
}
async function ns_gwdz_gacha(url, signal, tz = ns_gwdz_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url) === "" ? ns_gwdz_GACHA_URL : String(url);
	const json = await fetchJson(target, { referer: ns_b5_REFERER, signal, mode: "proxy" });
	return ns_gwdz_gachaPayloadOf(ns_gwdz_parseConfig(json, tz), tz, ns_bwiki_nowOf(now));
}
async function ns_gwdz_events(url, signal, tz = ns_gwdz_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url) === "" ? ns_gwdz_CAL_URL : String(url);
	const json = await fetchJson(target, { referer: ns_b5_REFERER, signal, mode: "proxy" });
	const wikitext = json && json.parse && json.parse.wikitext;
	if (typeof wikitext !== "string") throw new Error("gwdz-calendar:bad-json");
	return ns_gwdz_eventPayloadOf(ns_gwdz_parseCalendar(wikitext, tz), tz, ns_bwiki_nowOf(now));
}
//#endregion

registerSource({
	id: "gwdz",
	defaultHidden: false,
	tz: "Asia/Shanghai",
	name: "怪物弹珠·日服",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cb/99/e6/cb99e6ce-600e-c8b3-94d4-3846ef2c4a04/AppIcon-1x_U007emarketing-0-9-0-85-220-0.png/512x512bb.jpg",
	url: ns_gwdz_GACHA_URL,
	source: "Bwiki 卡池配置",
	eventUrl: ns_gwdz_CAL_URL,
	eventSource: "Bwiki 活动日历"
});

GACHA_FETCHERS["gwdz"] = (url, signal, tz, now) => ns_gwdz_gacha(url, signal, tz, now);
EVENT_FETCHERS["gwdz"] = Object.assign(EVENT_FETCHERS["gwdz"] || {}, {
	default: (url, signal, tz, now) => ns_gwdz_events(url, signal, tz, now)
});
