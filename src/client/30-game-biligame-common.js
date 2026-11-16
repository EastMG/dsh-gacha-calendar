// src/client/30-game-biligame-common.js —— biligame 官方新闻 API（api.biligame.com/news）公共层
//
// 职责（2026-11-16 由 30-game-biligame.js 拆出）：只放**两个厂商文件共用**的 helper / 常量，不发请求。
//   · 列表 URL 构造 / 兄弟 typeId / 详情 URL；
//   · 列表 JSON → 条目（按生效时刻倒序）与多路 feed 合并去重；
//   · 正文 `</p>` 切段 + 源站墙钟（月日、可能缺年份、日期与时刻粘连）→ 窗口；
//   · 标题清洗 / 悬停行投影（`ns_biligame_activity_hoverRows` / `byEndAsc`）/ `yearHintOf`。
// 服务对象：30-game-longyuan.js（物华弥新活动侧）与 30-game-cygames.js（闪耀优俊少女国服 uma-cn 两侧）。
//   各款自己的正文解析与抓取器留在各自厂商文件里（物华在 longyuan、闪耀在 cygames）。
// 复用关系：同一闭包内的函数声明提升 ⇒ 两个厂商文件直接引用；符号名 `ns_biligame_activity_*` 不变。

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-biligame-activity.js（压平后见 30-game-biligame.js）
// ─────────────────────────────────────────────────────────────────────────────
// 原 src/client/35-parsers-biligame-activity.js（压平后见 30-game-biligame.js）
//
// 由 next-sources/parsers/biligame-activity.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_biligame-activity__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-biligame-activity.js（压平后见 30-game-biligame.js） —— biligame 官方公告（活动/卡池档期）
//
// 契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null（null = 未公布）
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover? }        （eventHover 缺省 = 当期只有 1 条）
//   · 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover? }
//   本文件服务两个游戏（同一套官方接口 api.biligame.com/news）：
//     ① 物华弥新 国服 —— **只做活动侧**（卡池侧仍用 B2 的 bwiki `限时招集档案`，见 registry-p9.js）
//     ② 闪耀优俊少女 国服 —— 卡池 + 活动两侧（**取代** B2 的 bwiki 推算表作主源）
//
//   ══ 悬停（hover）规则 —— 用户 2026-10-03 反馈「新增游戏的面板外显/悬停的样式、格式、规则
//      和原来的差别很大」，核实后确认三类偏差，本文件按「方案 A」全部修掉 ══
//     · 排版唯一真源 = `lib/env.js` 的 `hoverPool` / `hoverEvent`（压平后见 28-parser-hover-tools.js；与本体 buildPoolHover /
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
// ── 为什么不再 import `biligame-announce.js`（原 next-sources 的嘟嘟脸解析器，已并入本文件；P6 嘟嘟脸，同形态）─────────────
//   思路/函数确实同源（列表 → 逐条详情 → 正文抽档期 → 挑覆盖 now 的窗口 → 抽不到就 null），
//   但历史上跨解析器 import 会被合并器的命名空间隔离打断（它给本文件的**声明**加 `ns_<file>_`
//   前缀，却不重命名"从别的解析器 import 进来的名字"）→ 生成物里会变成 `… is not defined`。
//   所以当时两个文件各自抄了一份 `decodeExtra` + 实体表。
//   ⚠️ 2026-10-03 更新：压平成 `src/client/` 普通源码段后**不再有命名空间合并器**，
//   而那两份 `ENT_EXTRA` / `decodeExtra` / `plain` **函数体逐字节相同、表互为子集** ——
//   已统一到 `27-parser-text.js` 的 `decodeExtra` / `htmlText` / `htmlTextTight`（并集表）。
//   本条历史记录保留，因为"跨文件同名/同源"这个坑值得记住。

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

// 按 </p> 切段（公告正文的每个逻辑单元都是 <p>；textOf 的行会把多段粘一起，不能用）
function ns_biligame_activity_biligameParagraphs(html) {
	return String(html == null ? "" : html)
		.split(/<\/p\s*>/i)
		.map((chunk) => htmlText(chunk).replace(/\s+/g, " ").trim())
		.filter(Boolean);
}

//#region 悬停排版（**只有名称与档期**，见文件头「悬停规则」）
// 本区域只做两件事：① 从「覆盖 now 的档期」里取出名称；② 按结束时间升序排好交给共用工具。
// 排版（3 空格 / 档期格式化 / 窗口全同只写一遍 / <2 条返回 ""）**全在 lib/env.js**（压平后见 28-parser-hover-tools.js），这里绝不自拼。
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
			// `name` 给 hoverPool 用（它的过滤/显示读 name），`title` 给**条目反生成**与数组收口用
			// （`dataArrayExtrasFromEntriesOf` 读 title/label）—— 同一行两种形状，值相同。
			return name ? { name, title: name, startTs: x.startTs, endTs: x.endTs, raw: x.raw } : null;
		})
		.filter(Boolean);
}
// ① 物华弥新 活动侧：名称 = 源站小节名（`四、经以山海` → `经以山海`），缺小节时退回段落标签
// ⚠️ P5 清理（2026-11-08）：原来这里还有三个只给测试用的包装
// （`ns_biligame_activity_whmxEventHover` / `umaCnEventHover` / `umaCnPoolHover`）——
// 它们各自只是 `hoverEvent/hoverPool(hoverRows(covering, nameOf), tz)` 的一句，生产调用方
// 早就改成直接 `hoverRows(...)` + `dataArrayProduced*Of` 了。名字投影（nameOf）现在写在各调用点
// 与回归里，包装层已删。
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
				title: decodeExtra(x.title).replace(/\s+/g, " ").trim(),
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
		const y1 = inferYear(a.y, a.mo, yearHint);
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
		if (b.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) y2 = y1 + 1;
		const startTs = sourceInstant(y1, a.mo, a.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
		if (!(endTs > startTs)) { skipped.push({ raw: raws.src, rawNorm: raws.norm, reason: "bad-order" }); i += 2; continue; }
		windows.push({ startTs, endTs, raw: raws.src, rawNorm: raws.norm, glued, at: a.at, end: b.end });
		i += 2;
	}
	return { norm, windows, skipped };
}
//#endregion

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

function ns_biligame_activity_yearHintOf(item, tz) {
	const ts = item && item.dateTs != null ? item.dateTs : null;
	return ts == null ? null : sourceWallParts(ts, tz);
}
