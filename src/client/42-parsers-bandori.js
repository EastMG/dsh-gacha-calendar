// src/client/35-parsers-bandori.js
//
// 由 next-sources/parsers/bandori.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bandori__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bandori.js —— BanG Dream! 少女乐团派对 国服（biligame 官方公告 API）
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
		&& coversNow(s.primary, now)
		&& !!ns_bandori_bandoriRolesFromSection(text, s));
}
// 当期（覆盖 now）的全部活动节（含卡池节 —— 这一期一起开的档期都能在悬停里看到）
function ns_bandori_bandoriActiveSections(sections, now) {
	return (sections || []).filter((s) => s.primary && coversNow(s.primary, now));
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
