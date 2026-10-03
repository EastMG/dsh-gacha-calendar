// next-sources/env.js —— 传输与时间工具（与插件本体解耦，供本目录所有解析器使用）
//
// 为什么独立一份：本目录**不合并进插件**（用户要求），但解析器契约必须与
// `src/client/40-fetchers.js` 完全一致，将来才能原样搬过去。这里只放"契约里不涉及业务"的部分。
//
// 契约（与插件一致）：
//   抓取器 async (url, signal, tz) → 数据对象 | null
//     · 卡池侧数据对象：{ banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, event?, eventDates?, eventDatesRaw?, eventHover? }
//     · 活动侧数据对象：{ event, eventDates, eventDatesRaw?, eventHover? }（fetchEntry 只读这几个字段）
//   `tz` = 源站墙钟时区（IANA 名如 "Asia/Shanghai" / "Asia/Tokyo" / "UTC"，或固定偏移分钟数）
//   抓不到内容 → 返回 null（= 未公布）；结构性损坏 → 抛错（= 该侧抓取失败）

//#region 传输
// fetchText(url, { referer, headers, signal, mode })
//   mode = "proxy"（默认）：经宿主代理，绕过 CORS 与 Referer 反爬
//   mode = "direct"        ：浏览器原生 fetch（仅用于实测确认 ACAO 放行的源）
//
// ⚠️ 调研结论（2026-10-02 实测）：判定"可直连"的唯一依据是响应带 ACAO。
//    本目录确认可直连的只有三个源：
//      · https://api.umapyoi.net          （ACAO=*）
//      · https://sekai-world.github.io    （GitHub Pages 静态资源）
//      · https://bang-dream-on.bushimo.jp （WordPress REST，回显 Origin）
//    其余（bwiki 全系 / fgo.wiki / api.biligame.com / bestdori / p5x.wanmei.com /
//    soli-reso / czn.qq.com…）**ACAO 为空，必须走代理**。
const PROXY_PREFIX = "/api/gacha-calendar-proxy";

// 允许测试注入 fetch 实现（Node 下跑离线夹具用）；不注入则用全局 fetch
let fetchImpl = (typeof fetch === "function" ? fetch : null);
function setFetchImpl(fn) { fetchImpl = fn; }
function getFetchImpl() { return fetchImpl; }

async function fetchText(url, opts = {}) {
	const { referer = "", headers: extraHeaders, signal, mode = "proxy" } = opts;
	if (mode === "direct") {
		const res = await fetchImpl(url, { signal, headers: { ...(extraHeaders || {}), ...(referer ? { referer } : {}) } });
		if (!res.ok) throw new Error("http-" + res.status);
		return res.text();
	}
	let api = PROXY_PREFIX + "?url=" + encodeURIComponent(url) + "&referer=" + encodeURIComponent(referer);
	if (extraHeaders) api += "&headers=" + encodeURIComponent(JSON.stringify(extraHeaders));
	const res = await fetchImpl(api, { signal, headers: { Accept: "application/json" } });
	if (!res.ok) throw new Error("proxy-http-" + res.status);
	const j = await res.json();
	if (!j || j.status !== 200 || typeof j.body !== "string") throw new Error("proxy-bad:" + ((j && (j.error || j.status)) || "?"));
	return j.body;
}

async function fetchJson(url, opts = {}) {
	const text = await fetchText(url, opts);
	try { return JSON.parse(text); } catch { throw new Error("bad-json"); }
}

// MediaWiki api.php 包装：自动追加 &origin=*，并取 parse.text
async function fetchMediaWikiText(url, opts = {}) {
	const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
	const res = opts.mode === "direct"
		? await fetchImpl(apiUrl, { signal: opts.signal, headers: opts.headers || {} })
		: null;
	if (res) {
		if (!res.ok) throw new Error("http-" + res.status);
		const json = await res.json();
		const text = json && json.parse && json.parse.text;
		if (typeof text !== "string") throw new Error("bad-json");
		return text;
	}
	const json = await fetchJson(apiUrl, opts);
	const text = json && json.parse && json.parse.text;
	if (typeof text !== "string") throw new Error("bad-json");
	return text;
}
//#endregion

//#region 时间（源站墙钟 → 绝对时刻；与插件 15-env.js 同实现）
const TZ_FMT_CACHE = new Map();
function tzFormatter(tzName) {
	let f = TZ_FMT_CACHE.get(tzName);
	if (f === void 0) {
		try {
			f = new Intl.DateTimeFormat("en-US", {
				timeZone: tzName, hour12: false,
				year: "numeric", month: "2-digit", day: "2-digit",
				hour: "2-digit", minute: "2-digit", second: "2-digit"
			});
		} catch { f = null; }
		TZ_FMT_CACHE.set(tzName, f);
	}
	return f;
}
function tzOffsetMinutesAt(tzName, ts) {
	const f = tzFormatter(tzName);
	if (!f) return null;
	const d = new Date(ts);
	if (isNaN(d.getTime())) return null;
	const parts = f.formatToParts(d);
	const g = (k) => { const p = parts.find((x) => x.type === k); return p ? Number(p.value) : NaN; };
	const h = g("hour") % 24;
	const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), h, g("minute"), g("second"));
	return (asUTC - (Math.floor(ts / 1000) * 1000)) / 60000;
}
function sourceOffsetMinutes(tz, ts) {
	if (tz == null || tz === "") return null;
	if (typeof tz === "number") return Number.isFinite(tz) ? tz : null;
	if (typeof tz === "string") {
		if (/^[+-]?\d+$/.test(tz.trim())) return Number(tz.trim());
		return tzOffsetMinutesAt(tz.trim(), ts);
	}
	return null;
}
// 源站墙钟（y-mo-d h:mi）→ 绝对毫秒；tz 为空则按本机时区（与插件改造前一致）
function sourceInstant(y, mo, d, h, mi, tz) {
	if (tz == null || tz === "") return new Date(y, mo - 1, d, h, mi).getTime();
	const guess = Date.UTC(y, mo - 1, d, h, mi);
	let off = sourceOffsetMinutes(tz, guess);
	if (off == null) return new Date(y, mo - 1, d, h, mi).getTime();
	let ts = guess - off * 60000;
	const off2 = sourceOffsetMinutes(tz, ts);
	if (off2 != null && off2 !== off) ts = guess - off2 * 60000;
	return ts;
}
// 绝对毫秒 → 源站时区下的墙上时钟字段
function sourceWallParts(ts, tz) {
	const d = new Date(ts);
	if (tz == null || tz === "") {
		return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
	}
	if (typeof tz === "string" && !/^[+-]?\d+$/.test(tz.trim())) {
		const f = tzFormatter(tz.trim());
		if (f) {
			const parts = f.formatToParts(d);
			const g = (k) => { const p = parts.find((x) => x.type === k); return p ? Number(p.value) : NaN; };
			return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute") };
		}
		return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
	}
	const off = sourceOffsetMinutes(tz, ts);
	if (off == null) return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
	const s = new Date(ts + off * 60000);
	return { y: s.getUTCFullYear(), mo: s.getUTCMonth() + 1, d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes() };
}
const pad2 = (n) => String(n).padStart(2, "0");
// 窗口文本：两端同年 → MM-DD HH:MM；跨年 → 两端带年份（与插件 fmtWindow 一致）
function fmtWindow(startTs, endTs, tz) {
	const a = sourceWallParts(startTs, tz), b = sourceWallParts(endTs, tz);
	const md = (w) => `${pad2(w.mo)}-${pad2(w.d)} ${pad2(w.h)}:${pad2(w.mi)}`;
	const ymd = (w) => `${w.y}-${pad2(w.mo)}-${pad2(w.d)} ${pad2(w.h)}:${pad2(w.mi)}`;
	return a.y === b.y ? `${md(a)} ~ ${md(b)}` : `${ymd(a)} ~ ${ymd(b)}`;
}
function fmtMdHm(ts, tz) {
	const w = sourceWallParts(ts, tz);
	return `${pad2(w.mo)}-${pad2(w.d)} ${pad2(w.h)}:${pad2(w.mi)}`;
}
//#endregion

//#region 文本工具
// 去标签 + 实体还原（够用即可，不引依赖）
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#8211": "–", "#8212": "—", "#8216": "‘", "#8217": "’", "#8220": "“", "#8221": "”" };
function decodeEntities(s) {
	return String(s).replace(/&(#\d+|[a-z]+);/gi, (m, k) => {
		const key = k.toLowerCase();
		if (ENTITIES[key] != null) return ENTITIES[key];
		if (/^#\d+$/.test(key)) { try { return String.fromCodePoint(Number(key.slice(1))); } catch { return m; } }
		return m;
	});
}
function stripTags(s) { return decodeEntities(String(s).replace(/<[^>]*>/g, " ")).replace(/[ \t\u00a0]+/g, " ").trim(); }
function textOf(html) { return decodeEntities(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n").trim(); }
//#endregion

//#region 悬停排版（**与本体 buildPoolHover / buildEventHover 完全同格式**）
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

export {
	setFetchImpl, getFetchImpl, fetchText, fetchJson, fetchMediaWikiText,
	sourceInstant, sourceWallParts, sourceOffsetMinutes, tzOffsetMinutesAt,
	fmtWindow, fmtMdHm, pad2,
	decodeEntities, stripTags, textOf,
	hoverPool, hoverEvent,
	PROXY_PREFIX
};
