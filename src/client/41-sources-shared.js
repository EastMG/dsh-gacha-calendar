// src/client/34-parsers-shared.js —— 新来源解析器共用的：抓取桥接 + 悬停排版工具
//
// 历史沿革：这些代码原本在 `next-sources/lib/env.js`（ESM 模块，由外部生成器内联进 45-next-sources.js）。
// 2026-10-03 按用户要求「把 next-sources 合并进原 source，不留 next-source」压平成普通源码段，
// 生成器与 `next-sources/` 目录一并删除。功能未变。
//
// 本段提供（解析器直接引用这些名字，不再有 import）：
//   · 抓取：fetchText / fetchJson / fetchMediaWikiText（走宿主代理或直连）
//   · 文本：pad2 / decodeEntities / textOf
//   · 悬停排版：hoverPool / hoverEvent（与本体 buildPoolHover / buildEventHover 逐字一致）
// 其余 env 名字（sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags）由 30-parsers.js 与 15-env.js 提供。

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
