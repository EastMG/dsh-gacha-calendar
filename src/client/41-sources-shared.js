// src/client/41-sources-shared.js —— 新增来源解析器共用的：抓取桥接 + 悬停排版工具
//
// 历史沿革：这些代码原本在 `next-sources/lib/env.js`（ESM 模块，由外部生成器内联进 45-next-sources.js）。
// 2026-10-03 按用户要求「把 next-sources 合并进原 source，不留 next-source」压平成普通源码段，
// `next-sources/` 目录与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
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

		// ── HTML 命名实体（**唯一真源**）───────────────────────────────────────────
		// 2026-10-03 合并：此前 **5 个解析器**各写一份 `ENT_EXTRA` + `decodeExtra`
		//   （bandori / biligame-activity / biligame-announce / ournotes-global / ournotes），
		//   函数体**逐字节相同**，差别只在实体表 —— 而 5 张表**互为子集**。
		//   现在用**并集**（30 个，行为探测确认完整覆盖 5 张表），所以：
		//     · 零回归（原来能解的仍然能解）
		//     · 更正确（原来哪个解析器缺 `&copy;` / `&yen;`，就会把实体字面量漏到面板上）
		//   表里也含 `amp/lt/gt/quot/apos/nbsp`（下面 `decodeEntities` 本来就处理），重复无害。
		const ENTITIES_EXTRA = {
			middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–",
			nbsp: " ", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
			sup2: "²", sup3: "³", deg: "°", ensp: " ", emsp: " ",
			thinsp: " ", bull: "•", copy: "©", reg: "®", trade: "™",
			laquo: "«", raquo: "»", amp: "&", quot: "\"", apos: "'",
			lt: "<", gt: ">", yen: "¥", hearts: "♥", star: "★",
		};
		/** 在 `decodeEntities` 之上再解一批命名实体（媒体/排版符号）。 */
		function decodeExtra(s) {
			return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
				const v = ENTITIES_EXTRA[String(k).toLowerCase()];
				return v != null ? v : m;
			}));
		}
		/** HTML → 纯文本（保留换行结构）。原来 5 个文件里的 `plain()` 都是这个。 */
		function htmlText(html) { return decodeExtra(textOf(html)); }
		/** 同上，但把空白压成单空格并去首尾空白（原来只有 ournotes-global 这么做）。 */
		function htmlTextTight(html) { return htmlText(html).replace(/\s+/g, " ").trim(); }

		// ── 时间戳与排序（**唯一真源**）────────────────────────────────────────────
		// 2026-10-03 收敛：
		//   · `toTs` 有 2 份、语义还不同（bestdori **宽容**：接受数字字符串；sekai **严格**：只接受 number）
		//   · `byNewestStart` 有 3 份，其中 umapyoi 那份**缺 null 守卫**
		//     （`a.endTs - b.endTs` 在 endTs 为 null 时得 NaN，排序行为未定义）
		//   现在统一为下面两个。取**宽容版** `numOrNull`：对 number 两者行为一致，
		//   对数字字符串宽容版能解出来而严格版返回 null —— 即"能解析的更多"，属改进。

		/** 源站时间戳 → 数字毫秒；`null` / `""` / 非数字 → null。接受数字字符串。 */
		function numOrNull(v) {
			if (v == null || v === "") return null;
			const n = Number(v);
			return Number.isFinite(n) ? n : null;
		}

		/**
		 * 「按开始时间从新到旧」排序：开始晚的在前；同开始则**结束早的在前**（空结束排最后）；
		 * 再同则按 id 升序。`endTs` 用 `Infinity` 兜空值 —— 原 umapyoi 版直接相减，
		 * 一旦有 null 就得 NaN（潜在 bug），这里一并修掉。
		 */
		function byNewestStart(a, b) {
			return (b.startTs - a.startTs)
				|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
				|| ((Number(a.id) || 0) - (Number(b.id) || 0));
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

		//#region 悬停排版共用工具（**唯一真源，改实现就改这里**）
		// 方案 A（用户 2026-10-03）：新增来源的悬停频出「格式/规则与原有条目差别很大」，
		// 根因是各批次各写各的。这里把排版逻辑做成唯一真源，解析器一律调用。
		// ⚠️ 2026-10-03 之后 `next-sources/` 与生成器都已删除，本段**不再由任何脚本抽取/覆盖**。
		// ── 为什么单独立一个区域 ──
		// 用户 2026-10-03 反馈「新增游戏的悬停样式/格式/规则和原来的差别很大」。核实后确认：
		// 各批次解析器**各写各的悬停**，出现了三类偏差 ——
		//   ① 悬停里塞元信息（来源 URL / 时区推定 / 抓取条数 / 实现细节）—— 本体条目**从不**这样做
		//   ② 「档期在前、名称在后」（本体一律 `名称 + 3 空格 + 档期`）
		//   ③ 档期用源站原文而非 fmtWindow 格式化
		// 修法（方案 A）：把本体那两个函数的排版逻辑抽到这里做**唯一真源**，解析器一律调用。
		// （落点原本是 next-sources/lib/env.js，压平后就是本文件；测试与运行时读的是同一份代码。）
// ── 与本体唯一的差别 ──
// 本体的两个函数调 `fmtWindow(ts, endTs)` **漏传 tz**（`wallOf` 会退回本机时区）；
// 这里 tz 是**显式参数**，非 UTC+8 的源（日服 JST / 国际服 UTC）才能排对时刻。
//
// ── 返回 "" 的语义（与本体一致，调用方必须遵守）──
// 「当期条数 < 2」时返回 ""，表示**交回 UI 的默认单条两行式**：
//   卡池 `池名：角色名` ⏎ `档期`；活动 `名称` ⏎ `档期`。
// 所以调用方**不要**在返回值后面再拼任何东西；空串就让字段留空。

// 长期/常驻判定：**直接用本体 30-parsers.js 的那一条**（阈值也只有那一处）。
// ⚠️ 2026-10-03 收敛：这里曾有一份逐字重复的实现 + 第二个 `HOVER_MAX_WINDOW_DAYS = 120` 常量。
//    同一条规则不该有第二份实现/第二个值 —— 已删，改为调用 `isLongTermWindow`。
//    （函数声明会提升，所以 41 在本体的 30 之后拼接也不影响这里的调用。）
// 排序：结束时间升序（无/未知结束时间排最后），再按开始时间
function hoverSortByEnd(a, b) {
	const ea = a.endTs == null ? Infinity : a.endTs;
	const eb = b.endTs == null ? Infinity : b.endTs;
	if (ea !== eb) return ea - eb;
	const sa = a.startTs == null ? Infinity : a.startTs;
	const sb = b.startTs == null ? Infinity : b.startTs;
	return sa - sb;
}
// 永久/常驻活动计数行 —— **直接用本体 `permanentLine`**（30-parsers.js）。
// ⚠️ 2026-10-03 收敛：这里曾有一份逐字相同的副本 `hoverPermanentLine`（措辞 `以及常驻活动 N 项`）。
//    本体注释写着"抽成函数是为了**措辞只有一处**"，副本正是打破了那句话，已删。

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
		.filter((x) => !isLongTermWindow(x));
	if (list.length < 2) return permanentLine(permanentCount);
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
	if (permanentCount > 0) lines.push(permanentLine(permanentCount));
	return lines.join("\n");
}
