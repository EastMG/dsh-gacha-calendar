// src/client/30-game-bandori.js —— BanG Dream（国服手游 / OurNotes 日服 / 国际服）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ══ 以下为原 42-parsers-bandori.js 的内容（原样保留）══
// src/client/42-parsers-bandori.js —— BanG Dream 全系（国服手游 / OurNotes 日服 / OurNotes 国际服 / Bestdori 备选源）
//
// ⚠️ 2026-10-03 按**游戏厂商 / 来源平台**合并（用户要求）：原先一款游戏一个文件（17 个），
//    现按厂商/系列归并成 10 个。合并只改**文件边界**，符号名（`ns_<域>_` 前缀）**一个都没动** ——
//    所以 `44-test-exports.js` 的模块命名空间、`test/registry-shim.mjs` 的抓取器对照表、
//    以及所有用例都不受影响（它们认的是符号名，不是文件名）。
//
//    本文件由以下文件**原样**拼接而成（各自的原文件头整体保留，前面加了分隔标记）：
//      · 42-parsers-bandori.js              BanG Dream！少女乐团派对·国服（biligame 官方公告）
//      · 42-parsers-ournotes.js             BanG Dream！OurNotes·日服（WP REST）
//      · 42-parsers-ournotes-global.js      BanG Dream！OurNotes·国际服（BHK 官方公告）
//      · 42-parsers-bestdori.js             BanG Dream（Bestdori 社区库，备选源）

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-bandori.js
// ─────────────────────────────────────────────────────────────────────────────
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

// 标题（WP/REST 的 title 可能是对象；这里统一取字符串）
function ns_bandori_bandoriTitle(x) {
	const t = x && x.title;
	if (t && typeof t === "object") return decodeExtra(t.rendered || "");
	return decodeExtra(t || "");
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
	if (b.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) y2 = y1 + 1;

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
	return decodeExtra(String(s == null ? "" : s)).replace(/\s+/g, " ").trim();
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
			const text = htmlText(d.content);
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
	const pools = ns_bandori_bandoriActiveGachaSections(a.sections, a.text, nowMs()).map((s) => {
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
	const active = ns_bandori_bandoriActiveSections(a.sections, nowMs());
	const eventHover = hoverEvent(active.map((s) => ns_bandori_bandoriSectionItem(s)), tz);
	return {
		event: a.picked.quote || ns_bandori_bandoriTitle(a.item) || a.picked.name,
		eventDates: fmtWindow(w.startTs, w.endTs, tz),
		eventDatesRaw: w.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-ournotes.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-ournotes.js
//
// 由 next-sources/parsers/ournotes.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_ournotes__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-ournotes.js —— BanG Dream! OurNotes 日服（bushimo 官方 WordPress REST）
//
// 契约：async (url, signal, tz) → { event, eventDates, eventDatesRaw?, eventHover? } | null
//   本来源**只有活动/公告侧单侧**（没有卡池专用源）——按任务书只写 event 侧。
//
// ── 可直连（mode="direct"）──────────────────────────────────────────────────
//   调研实测 `https://bang-dream-on.bushimo.jp` 的 ACAO **回显 Origin**
//   → 是环境里仅有的三个可直接 fetch 的源之一（另两个是 api.umapyoi.net / sekai-world.github.io）。
//   注意：registry 里声明的 mode 与这里 fetchJson 传的 mode **必须一致**。
//
// ── 实测形态（2026-10-01/02 抓夹具 fixtures/ournotes-list）──────────────────
// 列表：GET /wp-json/wp/v2/posts?per_page=20&page=1
//   → 标准 WP REST 数组，每项 { id, date, date_gmt, link, title{rendered}, excerpt{rendered}, content{rendered}, … }
//   ⚠️ **不能加 `_fields=id,date,date_gmt,link,title` 裁剪**（任务书给的省流写法）：
//      活动区间藏在 `excerpt`/`content` 里，只取 title/date 就只剩"公告发布时刻"，
//      拿不到任何「举办期间」。夹具实测：288 的活动区间 `2026年9月24日(木)～10月28日(水)14:59`
//      只出现在 content 里，excerpt 里没有。
//   ⚠️ 这是**新游戏**：全站只有 11 篇公告（2026-01 建站 → 2026-09），
//      其中只有 6 篇带日期区间，属正常状态，不是抓取失败。
//
// ── 时区 Asia/Tokyo（**实测**，非推测）──────────────────────────────────────
//   逐条比对 `date` 与 `date_gmt`：全部相差 **9 小时**
//   （例：id=389 `date=2026-09-21T16:30:30` / `date_gmt=2026-09-21T07:30:30`）→ JST=UTC+9。
//
// ── 取值策略 ────────────────────────────────────────────────────────────────
//   公告不是排期表：一篇公告里可能完全没有日期（如 id=389「動作環境について」），
//   也可能有多个不相干的区间（直播时刻、展会日程、活动期间）。
//   所以：① 按 date_gmt 倒序遍历公告；② 从 title+excerpt+content 抽「日期[时刻]～日期[时刻]」区间；
//        ③ 外显取**第一条覆盖当前时刻**的区间（没有则取最新一篇的第一条区间）；
//        ④ hover 逐行列出所有覆盖当前的区间（附所属公告标题）。
//   只给"一个日期"的句子（「9月24日(木)に決定しました！」）**不算区间** → 不产出，不硬凑。


const ns_ournotes_OURNOTES_LIST_URL = "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1";
const ns_ournotes_OURNOTES_TZ = "Asia/Tokyo";

function ns_ournotes_ournotesTitle(x) {
	const t = x && x.title;
	if (t && typeof t === "object") return decodeExtra(t.rendered || "").replace(/\s+/g, " ").trim();
	return decodeExtra(t || "").replace(/\s+/g, " ").trim();
}

// ── 日文日期区间令牌 ──
// 令牌化而不是一条大正则：日文公告里「年」可省、「月」在末段可省（`10月17日(土)・18日(日)`）、
// 时刻可省、分隔符有 `～`/`〜`/`~`/`・` 多种 —— 用一条正则的可选组会互相吃掉，走令牌清楚得多。
//   DATE：年?(可选) 月?(可选) 日 + 可选 (曜日)
//   TIME：HH:MM（全角冒号也算）
//   SEP ：~ ～ 〜 〰 － - – — ・
const ns_ournotes_JP_TOKEN = /(?:(20\d{2})\s*年)?\s*(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日(?:\s*[（(][^）)]{0,6}[）)])?|(\d{1,2})\s*[:：]\s*(\d{2})|([~\uff5e\u301c\u3030\uff0d\-\u2013\u2014]|・)/g;

// 从一段文本抽区间。返回 [{ startTs, endTs, raw }]（同 raw 去重）
//   起点**必须**带月份（防止把「5日連続」「30日間」这类裸"日"当窗口起点）
//   末段可省"月"（`・18日(日)`）→ 月份取起点月，日小于起点日则进一个月
//   末段缺时刻 → 全天（00:00 / 23:59）；起点缺时刻 → 00:00
function ns_ournotes_parseOurNotesWindows(text, tz = ns_ournotes_OURNOTES_TZ, hint = null) {
	const out = [];
	const seen = new Set();
	const s = String(text == null ? "" : text);
	ns_ournotes_JP_TOKEN.lastIndex = 0;
	const toks = [];
	let m;
	while ((m = ns_ournotes_JP_TOKEN.exec(s)) !== null) {
		toks.push({
			date: m[3] != null ? { y: m[1] ? +m[1] : null, mo: m[2] != null ? +m[2] : null, d: +m[3] } : null,
			time: m[4] != null ? { h: +m[4], mi: +m[5] } : null,
			sep: m[6] || null,
			at: m.index,
			end: m.index + m[0].length
		});
		if (m[0] === "") ns_ournotes_JP_TOKEN.lastIndex++;
	}
	const hintParts = hint != null ? sourceWallParts(hint, tz) : null;
	let i = 0;
	while (i < toks.length) {
		const t0 = toks[i];
		if (!t0.date || t0.date.mo == null) { i++; continue; }
		let j = i + 1;
		let startTime = null;
		if (toks[j] && toks[j].time) { startTime = toks[j].time; j++; }
		if (!(toks[j] && toks[j].sep)) { i++; continue; }
		j++;
		let endDate = null, endTime = null;
		if (toks[j] && toks[j].date) { endDate = toks[j].date; j++; }
		if (toks[j] && toks[j].time) { endTime = toks[j].time; j++; }
		if (!endDate && !endTime) { i++; continue; }

		// 年份：源站常只写月日 → 借公告年（共用 inferYear）。
		// ⚠️ 2026-10-03 改：原先是 `t0.date.y ?? hintParts.y` —— **不做"跨年份修正"**，
		//    于是「1 月公告里写的 12 月活动」会被算成**本**年 12 月（实际是去年 12 月）。
		//    `inferYear` 的"起始月比公告月晚 6 个月以上 → 算去年"正为此而设。
		const y1 = inferYear(t0.date.y, t0.date.mo, hintParts);
		if (y1 == null) { i++; continue; }
		let y2, mo2, d2;
		if (endDate) {
			mo2 = endDate.mo != null ? endDate.mo : t0.date.mo;
			d2 = endDate.d;
			y2 = endDate.y != null ? endDate.y : y1;
			if (endDate.y == null && endsNextYear(t0.date.mo, t0.date.d, mo2, d2)) {
				// 末段只写「日」且比起点日小 → 视为下一个月（可能跨年）
				if (endDate.mo == null) { mo2 = t0.date.mo + 1; if (mo2 > 12) { mo2 = 1; y2 = y1 + 1; } }
				else y2 = y1 + 1;
			}
		} else {
			mo2 = t0.date.mo; d2 = t0.date.d; y2 = y1;
		}
		const h1 = startTime ? startTime.h : 0, mi1 = startTime ? startTime.mi : 0;
		const h2 = endTime ? endTime.h : 23, mi2 = endTime ? endTime.mi : 59;
		const startTs = sourceInstant(y1, t0.date.mo, t0.date.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) { i++; continue; }
		const raw = s.slice(t0.at, toks[j - 1].end).trim();
		if (!seen.has(raw)) { seen.add(raw); out.push({ startTs, endTs, raw }); }
		i++;
	}
	return out;
}

// ── 公告集合 → [{ id, title, dateTs, windows }]（按 date_gmt 倒序）──
function ns_ournotes_parseOurNotesPosts(json, tz = ns_ournotes_OURNOTES_TZ) {
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	return json
		.filter((p) => p && p.id != null)
		.map((p) => {
			const hint = ns_ournotes_parseOurNotesInstant(p.date, tz);
			const hay = [
				ns_ournotes_ournotesTitle(p),
				htmlText(p.excerpt && p.excerpt.rendered),
				htmlText(p.content && p.content.rendered)
			].join("\n");
			return {
				id: p.id,
				title: ns_ournotes_ournotesTitle(p),
				dateText: p.date || "",
				dateTs: hint,
				windows: ns_ournotes_parseOurNotesWindows(hay, tz, hint)
			};
		})
		.sort((a, b) => (b.dateTs || 0) - (a.dateTs || 0));
}

// WP 的 `date` 是**源站本地时间且不带时区后缀**（"2026-09-21T16:30:30"）→ 按 tz 解释为墙钟
function ns_ournotes_parseOurNotesInstant(s, tz = ns_ournotes_OURNOTES_TZ) {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

// 外显挑选：第一条"覆盖当前时刻"的区间（按公告倒序、区间原序）；都没有则取最新一篇的第一条区间
function ns_ournotes_selectOurNotesPrimary(entries, now) {
	const list = Array.isArray(entries) ? entries : [];
	for (const p of list) for (const w of p.windows) if (coversNow(w, now)) return { post: p, win: w };
	for (const p of list) if (p.windows.length) return { post: p, win: p.windows[0] };
	return null;
}

// ── 抓取器（活动侧单侧）──
async function ns_ournotes_eventsOurNotes(url, signal, tz = ns_ournotes_OURNOTES_TZ) {
	const listUrl = url || ns_ournotes_OURNOTES_LIST_URL;
	// mode 必须与 registry-<batch>.js 里声明的 "direct" 一致（本目录只有 3 个源可直连）
	const json = await fetchJson(listUrl, { signal, mode: "direct" });
	if (!Array.isArray(json)) throw new Error("ournotes-bad-json");
	if (json.length === 0) return null;
	const posts = ns_ournotes_parseOurNotesPosts(json, tz);
	const now = nowMs();
	const picked = ns_ournotes_selectOurNotesPrimary(posts, now);
	if (!picked || !picked.win) return null;
	const active = [];
	for (const p of posts) for (const w of p.windows) if (coversNow(w, now)) active.push({ p, w });
	// 悬停格式一律交 lib/env.js 的 hoverEvent（= 本体 buildEventHover）：`名称` + 3 空格 + `档期`，
	// **名称在前**（旧实现「档期在前、名称在后」，与本体相反 —— 用户 2026-10-03 反馈的偏差②）。
	// 名称用公告标题（这是该站的"活动名"来源）；行内不再附来源站名/URL/时区推定等元信息。
	// ⚠️ 只有 1 条当期窗口时 hoverEvent 返回 "" → **不设 eventHover**，由 UI 走默认两行式
	//    「名称 ⏎ 档期」（实测夹具里覆盖当期的只有 1 条：288 那篇）。
	const list = (active.length ? active : [picked]).map(({ p, w }) => ({
		name: p.title,
		startTs: w.startTs,
		endTs: w.endTs,
		raw: w.raw
	}));
	const eventHover = hoverEvent(list, tz);
	return {
		event: picked.post.title,
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-ournotes-global.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-ournotes-global.js
//
// 由 next-sources/parsers/ournotes-global.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_ournotes-global__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-ournotes-global.js —— BanG Dream！OurNotes **国际服**（BHK 发行）
//
// 契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null（null = 未公布）
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover }
//   · 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//   两侧读**同一份公告 feed**（与国际服一致：一份公告里既有招募也有活动），靠标题分流。
//
// ══ 条目形态：**默认未配置**（只挂备选源，不给 url/eventUrl）════════════════
//   本条目在 registry-p9.js 里**没有** `url` / `eventUrl`，只有 `altSources` / `eventAltSources`。
//   插件 50-refresh.js 的语义是 `if (!source.url && !source.eventUrl) → skipped`：
//   不抓取、不计成功也不计失败，UI 显示「未配置（不抓取卡池/活动）」；用户在设置页选「BHK官方公告」
//   才会真正抓取。与米游社那套「崩坏3 新建条目、默认未配置」完全同型（见 45-next-sources.js）。
//
// ══ 接口（Lead 定位；本机**抓不到**，夹具是**合成**的，见下）══════════════════
//   发行商 = BHK（BILIBILI HK LIMITED），bundleId `com.bilibili.sirius`，内部代号 sirius。
//   列表 GET https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw
//   详情 GET https://l11-web-api.biligames.com/game/news/detail?game_base_id=118241&id=<id>&lang=zh-tw
//   Lead 实测抓到过一次：`{"code":0,"data":{"page_number":1,"page_size":20,"total_count":0,"list":[]}}`
//   → 源站**暂无公告**（国际服 2026-09-24 才上线）。
//   ⚠️ 此后本机对该域 `fetch failed`（ECONNRESET）：2026-10-03 复测三个 lang（zh-tw/zh-cn/en-us）
//      全部失败（实测 437~1507ms 直接失败）→ **拿不到真实夹具**。故本模块的夹具是**合成**的，
//      并在 fixtures/p9-ournotes-global-*/response.txt.meta.json 与 test/cases-p9.mjs 里**明确标注**。
//
// ══ 因此本解析器对**字段名**采取宽容策略（合成夹具只覆盖我们假设的字段）══════
//   · 列表项 id：`id` / `news_id` / `article_id` / `content_id`
//   · 标题：`title` / `name` / `subject`（可能是纯文本，也可能带 HTML）
//   · 发布时间（用于**推断正文里省略年份**）：`display_time` / `create_time` / `publish_time` / `date`
//   · 详情正文：`content` / `body` / `text` / `detail` / `description`（HTML 或纯文本）
//   · 结构化档期（若源站给了就优先用，给了才好）：`start_time`+`end_time` 等常见命名
//   · `total_count === 0` 或 `list` 为空 → 返回 null（= 未公布）
//   ⚠️ 以上字段名是**假设**，不是实测（源站无可达内容）。若将来抓一次真实响应，第一件事就是
//      按真实字段收紧这几个候选列表（位置集中在本文件 #region 字段候选）。
//
// ══ tz = Asia/Shanghai（**任务书指定**）═════════════════════════════════════
//   国际服含港澳台（zh-tw / zh-cn 为主），源站未标时区。**不要**照日服用 Asia/Tokyo。
//   绝对时刻走 `sourceInstant(...)`，文本走 `fmtWindow(...)`。
//
// ══ 合并器注意 ══
//   与 biligame-activity.js 同理：本文件**不 import 其它解析器**（合并器按文件命名空间隔离、
//   不会重命名跨文件 import 的名字），只 import lib/env.js。逻辑与 uma 的正文抽档期同源但自带一份。


const ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID = 118241;
const ns_ournotes_global_OURNOTES_GLOBAL_TZ = "Asia/Shanghai";
const ns_ournotes_global_OURNOTES_GLOBAL_LANGS = ["zh-tw", "zh-cn", "en-us", "ko-kr"];
const ns_ournotes_global_OURNOTES_GLOBAL_HOME = "https://www.biligames.com/";
const ns_ournotes_global_LIST_ORIGIN = "https://l11-web-api.biligames.com";
const ns_ournotes_global_DETAIL_LIMIT = 8;

function ns_ournotes_global_ournotesGlobalListUrl(lang = ns_ournotes_global_OURNOTES_GLOBAL_LANGS[0]) {
	return `${ns_ournotes_global_LIST_ORIGIN}/game/news/page?game_base_id=${ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID}&show_position=1&lang=${lang}`;
}
function ns_ournotes_global_ournotesGlobalDetailUrl(id, lang = ns_ournotes_global_OURNOTES_GLOBAL_LANGS[0]) {
	return `${ns_ournotes_global_LIST_ORIGIN}/game/news/detail?game_base_id=${ns_ournotes_global_OURNOTES_GLOBAL_GAME_BASE_ID}&id=${id}&lang=${lang}`;
}
const ns_ournotes_global_OURNOTES_GLOBAL_LIST_URL = ns_ournotes_global_ournotesGlobalListUrl("zh-tw");
// 备选源标识就是 URL 本身（`altSourceId(alt) = alt.url`）→ 注册表里的 URL 必须与这里逐字一致
function ns_ournotes_global_langOf(url, fallback = ns_ournotes_global_OURNOTES_GLOBAL_LANGS[0]) {
	try {
		const v = new URL(url).searchParams.get("lang");
		return v && ns_ournotes_global_OURNOTES_GLOBAL_LANGS.includes(v) ? v : fallback;
	} catch { return fallback; }
}

// 按 </p> 切段（详情正文若是 HTML）；纯文本没有 <p> → 退化成按行切
//#endregion

//#region 字段候选（**假设**，源站不可达，见文件头）
function ns_ournotes_global_pickStr(obj, keys) {
	for (const k of keys) {
		const v = obj ? obj[k] : null;
		if (typeof v === "string" && v.trim() !== "") return v.trim();
	}
	return "";
}
function ns_ournotes_global_pickNum(obj, keys) {
	for (const k of keys) {
		const v = obj ? obj[k] : null;
		if (typeof v === "number" && Number.isFinite(v)) return v;
		if (typeof v === "string" && /^\d{6,}$/.test(v.trim())) return Number(v.trim());
	}
	return null;
}
const ns_ournotes_global_K_ID = ["id", "news_id", "article_id", "content_id", "newsId"];
const ns_ournotes_global_K_TITLE = ["title", "name", "subject", "news_title"];
const ns_ournotes_global_K_TIME = ["display_time", "displayTime", "create_time", "createTime", "publish_time", "publishTime", "date", "ctime"];
const ns_ournotes_global_K_CONTENT = ["content", "body", "text", "detail", "description", "news_content"];
const ns_ournotes_global_K_START = ["start_time", "startTime", "begin_time", "beginTime", "start_at", "startAt", "start_date"];
const ns_ournotes_global_K_END = ["end_time", "endTime", "end_at", "endAt", "end_date", "endDate"];
function ns_ournotes_global_ournotesGlobalTitle(x) {
	return htmlTextTight(ns_ournotes_global_pickStr(x, ns_ournotes_global_K_TITLE));
}
//#endregion

//#region 列表 / 详情结构
// 列表 JSON → { totalCount, items:[{ id, title, sortKey, dateTs, raw }] }（按发布时间倒序）
//   结构不合法（非对象 / code≠0 / data 非对象 / list 非数组）→ 抛错（结构性损坏）
function ns_ournotes_global_parseOurNotesGlobalPage(json) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("ournotes-global-bad-json");
	if (json.code !== 0) throw new Error("ournotes-global-code-" + json.code);
	const d = json.data;
	if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("ournotes-global-bad-json");
	if (!Array.isArray(d.list)) throw new Error("ournotes-global-bad-json");
	const totalRaw = d.total_count != null ? d.total_count : d.totalCount;
	const totalCount = totalRaw == null ? d.list.length : Number(totalRaw);
	const items = d.list
		.filter((x) => x && typeof x === "object")
		.map((x) => {
			const sortKey = ns_ournotes_global_pickStr(x, ns_ournotes_global_K_TIME);
			return {
				id: ns_ournotes_global_pickNum(x, ns_ournotes_global_K_ID),
				title: ns_ournotes_global_ournotesGlobalTitle(x),
				sortKey,
				dateTs: ns_ournotes_global_parseOurNotesGlobalStamp(sortKey, ns_ournotes_global_OURNOTES_GLOBAL_TZ),
				raw: x
			};
		})
		.filter((x) => x.id != null && x.title)
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
	return { totalCount: Number.isFinite(totalCount) ? totalCount : items.length, items, raw: d };
}
// 空 = 未公布：`total_count === 0` 或 list 为空（**实测** Lead 抓到的那次就是 total_count:0）
function ns_ournotes_global_isOurNotesGlobalEmpty(json, page = null) {
	const p = page || ns_ournotes_global_parseOurNotesGlobalPage(json);
	return p.totalCount === 0 || p.items.length === 0;
}
function ns_ournotes_global_ournotesGlobalDetailText(detail) {
	const d = detail && typeof detail === "object" && detail.data && typeof detail.data === "object" ? detail.data : detail;
	if (!d || typeof d !== "object") return "";
	const v = (() => {
		for (const k of ns_ournotes_global_K_CONTENT) {
			const c = d[k];
			if (typeof c === "string" && c.trim() !== "") return c;
			if (c && typeof c === "object" && typeof c.rendered === "string") return c.rendered;
		}
		return "";
	})();
	return v;
}
// 结构化档期（若源站给了 start/end 字段就优先用，给了才好）；拿不到 → null
function ns_ournotes_global_ournotesGlobalStructuredWindow(item, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ) {
	const d = item && typeof item === "object" && item.data && typeof item.data === "object" ? item.data : item;
	const a = ns_ournotes_global_pickStr(d, ns_ournotes_global_K_START), b = ns_ournotes_global_pickStr(d, ns_ournotes_global_K_END);
	if (!a || !b) return null;
	const aTs = ns_ournotes_global_parseOurNotesGlobalStamp(a, tz), bTs = ns_ournotes_global_parseOurNotesGlobalStamp(b, tz);
	if (aTs == null || bTs == null || !(bTs > aTs)) return null;
	return { startTs: aTs, endTs: bTs, raw: `${a} ~ ${b}`, glued: false, structured: true };
}
//#endregion

//#region 日期令牌（容错：年月日 / 斜杠 / 点 / ISO，年份可省）
function ns_ournotes_global_parseOurNotesGlobalStamp(s, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ) {
	const t = String(s == null ? "" : s).trim();
	if (t === "") return null;
	// 纯数字：> 1e11 视为毫秒，否则视为秒（**假设**）
	if (/^\d{10,13}$/.test(t)) {
		const n = Number(t);
		return n > 1e11 ? n : n * 1000;
	}
	// ⚠️ `(?:\s*日)?` 必须写成可选组：若写成 `\s*日?`，后面的空格会被 `\s*` 吃掉，
	//    而时刻组本身可选 → 正则不回退，`2026-10-01 12:00:00` 会被静默当成 00:00（本模块第一版踩过）
	const m = /^(?:(\d{4})\s*[年\/\-.]\s*)?(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})(?:\s*日)?(?:[\sT]+(\d{1,2})\s*[:：]\s*(\d{2}))?/.exec(t);
	if (!m) return null;
	const y = m[1] ? +m[1] : null;
	if (y == null) return null;                     // 没有年份 → 需要外部补全（由调用方按公告年补）
	const mo = +m[2], d = +m[3], h = m[4] != null ? +m[4] : 0, mi = m[5] != null ? +m[5] : 0;
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
	return sourceInstant(y, mo, d, h, mi, tz);
}
const ns_ournotes_global_TOK_RE = new RegExp([
	"(?<stamp>(?:(?<sy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<smo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<sd>\\d{1,2})\\s*日?\\s*(?<sh>\\d{1,2})\\s*[:：]\\s*(?<smi>\\d{2}))",
	"(?<date>(?:(?<dy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<dmo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<dd>\\d{1,2})\\s*日?)",
	"(?<sep>[~\uff5e\u301c\u223c至到]|\\s[-\\u2013\\u2014\\uff0d]\\s|[-\\u2013\\u2014\\uff0d])",
	"(?<perm>常驻|常駐|永久|常設|長期)"
].join("|"), "g");
// ⚠️ 2026-10-03：此处原有本地 `yearOf`（补年份）—— 与 `biligame-activity.js` 那份**逐字相同**，
//    已统一到 `30-parsers.js` 的共用 `inferYear(y, mo, hint)`。
// 一段文本 → { norm, windows:[{ startTs, endTs, raw, glued }], skipped }
function ns_ournotes_global_extractOurNotesGlobalWindows(text, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ, yearHint = null) {
	const src = String(text == null ? "" : text);
	const norm = src;
	const toks = [];
	ns_ournotes_global_TOK_RE.lastIndex = 0;
	let m;
	while ((m = ns_ournotes_global_TOK_RE.exec(norm)) !== null) {
		if (m[0] === "") { ns_ournotes_global_TOK_RE.lastIndex++; continue; }
		const g = m.groups || {};
		const at = m.index, end = m.index + m[0].length;
		if (g.stamp != null) {
			const t = { kind: "stamp", text: g.stamp, at, end, y: g.sy ? +g.sy : null, mo: +g.smo, d: +g.sd, h: +g.sh, mi: +g.smi };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31 && t.h <= 23 && t.mi <= 59) toks.push(t);
		} else if (g.date != null) {
			const t = { kind: "date", text: g.date, at, end, y: g.dy ? +g.dy : null, mo: +g.dmo, d: +g.dd, h: null, mi: null };
			if (t.mo >= 1 && t.mo <= 12 && t.d >= 1 && t.d <= 31) toks.push(t);
		} else if (g.sep != null) toks.push({ kind: "sep", text: g.sep, at, end });
		else if (g.perm != null) toks.push({ kind: "perm", text: g.perm, at, end });
	}
	const windows = [], skipped = [];
	for (let i = 0; i < toks.length; i++) {
		const a = toks[i];
		if (a.kind !== "stamp") continue;
		const sep = toks[i + 1];
		if (!sep || sep.kind !== "sep") continue;
		const b = toks[i + 2];
		if (!b) continue;
		const raw = norm.slice(a.at, b.end).trim();
		if (b.kind === "perm") { skipped.push({ raw, reason: "perm" }); i += 2; continue; }
		if (b.kind !== "stamp" && b.kind !== "date") continue;
		const y1 = inferYear(a.y, a.mo, yearHint);
		if (y1 == null) { skipped.push({ raw, reason: "no-year" }); i += 2; continue; }
		let y2 = b.y != null ? b.y : y1;
		if (b.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) y2 = y1 + 1;
		const h2 = b.kind === "stamp" ? b.h : 23;
		const mi2 = b.kind === "stamp" ? b.mi : 59;
		const startTs = sourceInstant(y1, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(y2, b.mo, b.d, h2, mi2, tz);
		if (!(endTs > startTs)) { skipped.push({ raw, reason: "bad-order" }); i += 2; continue; }
		windows.push({ startTs, endTs, raw, glued: false });
		i += 2;
	}
	return { norm, windows, skipped };
}
//#endregion

//#region 标题分流（国际服多语言 → 关键词按语种各一套；**假设**，未拿到真实标题）
const ns_ournotes_global_RE_GACHA_ZH = /招募|扭蛋|必得|祈愿|招集/;
const ns_ournotes_global_RE_EVENT_ZH = /活動|活动|賽事|赛事|劇情|剧情|舉辦|举办|慶典|庆典|任務|任务/;
const ns_ournotes_global_RE_GACHA_EN = /\brecruit|\bgacha\b|\bbanner\b|\bpickup\b|\bpick-up\b/i;
const ns_ournotes_global_RE_EVENT_EN = /\bevent\b|\bcampaign\b|\bstory\b|\bmission\b|\bcelebration\b/i;
const ns_ournotes_global_RE_GACHA_KO = /모집|가챠|뽑기/;
const ns_ournotes_global_RE_EVENT_KO = /이벤트|활동|스토리|캠페인/;
function ns_ournotes_global_classifyOurNotesGlobalTitle(title) {
	const t = String(title == null ? "" : title);
	if (ns_ournotes_global_RE_GACHA_ZH.test(t) || ns_ournotes_global_RE_GACHA_EN.test(t) || ns_ournotes_global_RE_GACHA_KO.test(t)) return "gacha";
	if (ns_ournotes_global_RE_EVENT_ZH.test(t) || ns_ournotes_global_RE_EVENT_EN.test(t) || ns_ournotes_global_RE_EVENT_KO.test(t)) return "event";
	return null;
}
// 标题清洗：去掉尾部动作尾巴（简繁都认：`开放！`/`開放！`/`舉辦中！`…），保留活动/卡池名
const ns_ournotes_global_TITLE_TAIL_RE = /[\s，,。！!～~\-—]*(?:即将|即將|现已|現已|正在|已)?(?:开放|開放|開啟|开启|举办|舉辦|登場|登场|上线|上線|开始|開始|结束|結束|预告|預告)[中]?[！!。]?\s*$/;
function ns_ournotes_global_cleanTitle(t) {
	let s = String(t == null ? "" : t).trim();
	for (let i = 0; i < 2; i++) {
		const n = s.replace(ns_ournotes_global_TITLE_TAIL_RE, "").trim();
		if (n === s) break;
		s = n;
	}
	return s || String(t == null ? "" : t).trim();
}
//#endregion

//#region 抓取器（契约：async (url, signal, tz, now = nowMs()) → 对象 | null）
// 外显挑选：覆盖 now 的窗口里取结束最早的（并列按文档顺序）
function ns_ournotes_global_pickOurNotesGlobalWindow(items, now) {
	const act = (items || []).filter((x) => coversNow(x, now));
	if (!act.length) return null;
	return act.map((x, i) => ({ x, i })).sort((a, b) => (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
function ns_ournotes_global_yearHintOf(item, tz) {
	return item && item.dateTs != null ? sourceWallParts(item.dateTs, tz) : null;
}
async function ns_ournotes_global_loadOurNotesGlobal(url, signal, tz, now, want) {
	const listUrl = url || ns_ournotes_global_OURNOTES_GLOBAL_LIST_URL;
	const lang = ns_ournotes_global_langOf(listUrl);
	// mode 一律 "proxy"：`l11-web-api.biligames.com` 无 ACAO（也未实测直连放行）
	const json = await fetchJson(listUrl, { referer: ns_ournotes_global_OURNOTES_GLOBAL_HOME, signal, mode: "proxy" });
	const page = ns_ournotes_global_parseOurNotesGlobalPage(json);
	if (ns_ournotes_global_isOurNotesGlobalEmpty(json, page)) return null;     // total_count:0 / list 空 → 未公布
	let firstErr = null, loaded = 0, tried = 0;
	for (const it of page.items.slice(0, ns_ournotes_global_DETAIL_LIMIT)) {
		if (ns_ournotes_global_classifyOurNotesGlobalTitle(it.title) !== want) continue;
		tried++;
		let detail = null;
		try {
			detail = await fetchJson(ns_ournotes_global_ournotesGlobalDetailUrl(it.id, lang), { referer: ns_ournotes_global_OURNOTES_GLOBAL_HOME, signal, mode: "proxy" });
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		loaded++;
		const text = ns_ournotes_global_ournotesGlobalDetailText(detail);
		const title = ns_ournotes_global_ournotesGlobalTitle((detail && detail.data) || detail) || it.title;
		const hint = ns_ournotes_global_yearHintOf(it, tz);
		const structured = ns_ournotes_global_ournotesGlobalStructuredWindow(detail, tz);
		const parsed = ns_ournotes_global_extractOurNotesGlobalWindows(text, tz, hint);
		const windows = structured ? [structured, ...parsed.windows] : parsed.windows;
		const best = ns_ournotes_global_pickOurNotesGlobalWindow(windows, now);
		if (!best) continue;
		const active = windows.filter((x) => coversNow(x, now))
			.map((x, i) => ({ x, i }))
			.sort((a, b) => (a.x.startTs - b.x.startTs) || (a.i - b.i))
			.map((o) => o.x);
		// ⚠️ 2026-10-03 改：这里原本手搓悬停，且有**三层**元信息 ——
		//   ① 头行 `BanG Dream！OurNotes·国际服 · ${title}（国际服含港澳台，源站未标时区；tz=… 按任务书指定…）`
		//   ② `来源：BHK 官方公告 l11-web-api.biligames.com（game_base_id=…，lang=…）` ← 来源 URL + 内部字段名 + 内部 id
		//   ③ 行内装饰符 `▶ ` / `  ` + `（结构化字段）` ← 实现说明；且**档期在前**
		//   它一直没被发现，是因为该条目**默认未配置**（出厂不抓取）→ 活体审计永远看不到它的悬停。
		//   现在改用共用 hoverPool：只留「名称 ⏎ 档期」。时区依据写在本文件顶部注释与条目 tz 字段里。
		const name = ns_ournotes_global_cleanTitle(title) || "（未命名）";
		const hover = hoverPool(active.map((x) => ({ name, startTs: x.startTs, endTs: x.endTs })), tz);
		return { title, best, hover };
	}
	if (loaded === 0 && tried > 0 && firstErr) throw firstErr;   // 本侧相关详情全失败 → 抛错
	return null;
}
async function ns_ournotes_global_gachaOurNotesGlobal(url, signal, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ, now = nowMs()) {
	const hit = await ns_ournotes_global_loadOurNotesGlobal(url, signal, tz, now, "gacha");
	if (!hit) return null;
	const { title, best, hover } = hit;
	return {
		banner: ns_ournotes_global_cleanTitle(title) || "（未命名招募）",
		roles: "",
		bannerDates: fmtWindow(best.startTs, best.endTs, tz),
		bannerDatesRaw: best.raw,
		startTs: best.startTs,
		endTs: best.endTs,
		bannerHover: hover
	};
}
async function ns_ournotes_global_eventsOurNotesGlobal(url, signal, tz = ns_ournotes_global_OURNOTES_GLOBAL_TZ, now = nowMs()) {
	const hit = await ns_ournotes_global_loadOurNotesGlobal(url, signal, tz, now, "event");
	if (!hit) return null;
	const { title, best, hover } = hit;
	return {
		event: ns_ournotes_global_cleanTitle(title) || "（未命名活动）",
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		eventHover: hover
	};
}
//#endregion

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-bestdori.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-bestdori.js
//
// 由 next-sources/parsers/bestdori.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bestdori__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bestdori.js —— BanG Dream!（Bestdori 社区数据库，取**简中服**时间段）
//
// 契约：async (url, signal, tz) → 卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//                              活动侧 { event, eventDates, eventDatesRaw?, eventHover? }    （两侧都可为 null = 未公布）
//
// ⚠️ 实测（2026-10-02 夹具 `b1-bestdori-gacha` / `b1-bestdori-events`）与任务给的简化形态的差别：
//   1. 两个文件都是**以 id 为 key 的对象**（不是数组）：gacha 2149 个键、events 345 个键。
//   2. 时间是 **字符串毫秒**（`"1462071600000"`），需要 Number()；缺失服区为 `null`。
//   3. 字段名实测：
//      gacha：{ resourceName, bannerAssetBundleName, gachaName[5], publishedAt[5], closedAt[5], type, newCards }
//      event：{ eventType, eventName[5], assetBundleName, startAt[5], endAt[5], … }
//      —— 任务里猜的 `eventName`/`startAt`/`publishedAt`/`closedAt` 全对，但**值是字符串**。
//
// 服区下标：0=日 1=英 2=繁中 **3=简中** 4=韩。
//   实测交叉验证（夹具里的 gacha 1「リリース記念ガチャ」五连名称）：
//     [0] リリース記念ガチャ / [1] Release Celebration Gacha / [2] 遊戲上線紀念轉蛋 / [3] 开服纪念招募 / [4] 오픈 기념 뽑기
//   → [3] 是**简体中文**，即简中服（本条目要的服区）。gacha 里带 CN 时间的有 1734 / 2149 条。
//
// 时区：UTC+8。UTC 毫秒本身就是**绝对时刻**，这里**不做任何时区换算**；
//   `tz`（Asia/Shanghai）只用于把绝对时刻渲染成源站墙钟文本（sourceWallParts/fmtWindow）。
//   交叉验证（调研文档 + 夹具）：官方 displayTime 2026-09-29 10:00 ↔ 简中服 startAt=1790647200000（=02:00Z）完全吻合。


const ns_bestdori_DEFAULT_GACHA = "https://bestdori.com/api/gacha/all.5.json";
const ns_bestdori_DEFAULT_EVENT = "https://bestdori.com/api/events/all.5.json";
const ns_bestdori_CN_INDEX = 3;                        // 简中服下标（见文件头实测）
// 长期/常驻池阈值：**用本体那一条**（LONG_TERM_MAX_WINDOW_DAYS = 120）。
// ⚠️ 2026-10-03 收敛：这里原本是 400 天，与本体/sekai 的 120 天**不是同一个值** ——
//    同一条规则不该有两个值。实测影响：夹具里 22 个窗口落在 (120, 400] 天之间
//    （「新手限定 / 回归纪念 / 每日免费 / 少女们的回忆 / 开服纪念」这类长期池），
//    在 400 天下会被误判成"当期"。当前真实在架池恰好 0 个落在该区间，故属**潜在**不一致。
const ns_bestdori_LONG_MS = LONG_TERM_MAX_WINDOW_DAYS * 864e5;

// ⚠️ 2026-10-03 收敛：本文件原有 `toTs`（宽容版）与 `byNewestStart` —— 前者与 sekai 那份**语义不同**、
//    后者与 sekai 那份逐字相同（差别只在 `Number(a.id)` 与 `a.id`）。均已统一到
//    `41-sources-shared.js` 的 `numOrNull` / `byNewestStart`。

// ── 卡池侧 ──
// 覆盖当前时刻的**有界**（≤400 天）简中池里取 startTs 最新的一期当"当期卡池"；
// 长期/常驻池（miracle/free 等，closedAt 常是 2100 哨兵）不参与选择，只在 hover 里报个数。
function ns_bestdori_parseBestdoriGacha(json, now = nowMs(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-gacha-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const pools = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.publishedAt) || !Array.isArray(v.closedAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.gachaName) ? v.gachaName[ns_bestdori_CN_INDEX] : null;
		const p = numOrNull(v.publishedAt[ns_bestdori_CN_INDEX]);
		const c = numOrNull(v.closedAt[ns_bestdori_CN_INDEX]);
		if (!name || p == null || c == null || c <= p) continue;   // 该服区没出这期 → 跳过
		pools.push({ id: k, name: String(name), type: String(v.type || ""), startTs: p, endTs: c, long: c - p > ns_bestdori_LONG_MS });
	}
	if (!sawIndexed) throw new Error("bestdori-gacha-bad-shape");   // 结构变了（不再有 publishedAt/closedAt 数组）
	const active = pools.filter((x) => coversNow(x, now));
	const bounded = active.filter((x) => !x.long).sort(byNewestStart);
	const cur = bounded[0] || null;
	if (!cur) return null;   // 抓到数据但没有"当期"有界窗口 = 未公布（长期池不算当期）

	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 同一期招募可能被源站多处登记（同名同窗口）→ 先去重成一条（本体没有「×n」记法，也不该有重复行）。
	// ⚠️ 2026-10-03 改：这里原本**手搓悬停**（`名称（类型枚举）×n  档期` 单行式 + 「另有 N 个未列出」
	//    + 「结束时间是 2100 之类的哨兵值」这类元信息），与本体/其它来源的
	//    「池名 ⏎ 档期」两行式不一致 —— 本备选源没被方案 A 的悬停审计覆盖到（它只是 altSources 里的一个）。
	//    现在改用共用 hoverPool：排版只有一处实现。
	const seen = new Set();
	const uniq = bounded.filter((p) => {
		const k = `${p.name}|${p.startTs}|${p.endTs}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	const hover = hoverPool(uniq.map((p) => ({ name: p.name, startTs: p.startTs, endTs: p.endTs })), tz);

	return {
		banner: cur.name,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}

// ── 活动侧 ──
function ns_bestdori_parseBestdoriEvents(json, now = nowMs(), tz = "Asia/Shanghai") {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("bestdori-event-bad-shape");
	const keys = Object.keys(json);
	let sawIndexed = false;
	const rows = [];
	for (const k of keys) {
		const v = json[k];
		if (!v || typeof v !== "object") continue;
		if (!Array.isArray(v.startAt) || !Array.isArray(v.endAt)) continue;
		sawIndexed = true;
		const name = Array.isArray(v.eventName) ? v.eventName[ns_bestdori_CN_INDEX] : null;
		const s = numOrNull(v.startAt[ns_bestdori_CN_INDEX]);
		const e = numOrNull(v.endAt[ns_bestdori_CN_INDEX]);
		if (!name || s == null || e == null || e <= s) continue;
		rows.push({ id: k, name: String(name), type: String(v.eventType || ""), startTs: s, endTs: e });
	}
	if (!sawIndexed) throw new Error("bestdori-event-bad-shape");
	const active = rows.filter((x) => coversNow(x, now)).sort(byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// 活动一般只有一期在期；多期时 hover 逐行列出（与插件 buildEventHover 同约定：<2 条返回 ""）
	const hover = active.length >= 2
		? active.map((x) => `${x.name}（${x.type}）  ${fmtWindow(x.startTs, x.endTs, tz)}`).join("\n")
		: "";
	return { event: cur.name, eventDates: dates, eventDatesRaw: dates, eventHover: hover };
}

// 抓取器：mode="proxy"（实测 bestdori.com 无 ACAO，必须走宿主代理）
async function ns_bestdori_gachaBestdori(url, signal, tz = "Asia/Shanghai", now = nowMs()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_GACHA, { signal });
	return ns_bestdori_parseBestdoriGacha(data, now, tz);
}
async function ns_bestdori_eventsBestdori(url, signal, tz = "Asia/Shanghai", now = nowMs()) {
	const data = await fetchJson(url || ns_bestdori_DEFAULT_EVENT, { signal });
	return ns_bestdori_parseBestdoriEvents(data, now, tz);
}

		// ── 条目 ──
		registerSource({
				id: "bandori",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "BanG Dream！少女乐团派对·国服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cb/ae/11/cbae1132-58ee-8b5c-3016-dfd2f5e91e51/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				eventSource: "官方公告",
				altSources: [{"label":"Bestdori 扭蛋","url":"https://bestdori.com/api/gacha/all.5.json","fetcher":"bandori-bestdori-gacha"}],
				eventAltSources: [{"label":"Bestdori 活动","url":"https://bestdori.com/api/events/all.5.json","fetcher":"bandori-bestdori-event"}],
		});

		registerSource({
				id: "ournotes",
				defaultHidden: true,
				tz: "Asia/Tokyo",
				name: "BanG Dream！OurNotes·日服",
				icon: "https://bang-dream-on.bushimo.jp/wordpress/wp-content/themes/bang-dream-on_prod/assets/images/common/apple-touch-icon-180x180.png",
				eventUrl: "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1",
				// 日文站点 → 加语言括号（本体惯例，见 ba-jp 的 `官方公告（日文）`）
				eventSource: "官方公告（日文）",
		});

		registerSource({
				id: "ournotes-global",
				defaultHidden: true,
				tz: "Asia/Shanghai",
				name: "BanG Dream！OurNotes·国际服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/ca/da/3a/cada3a9a-491a-fbe5-5494-9be7390e3a9b/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				altSources: [{"label":"BHK官方公告","url":"https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw","fetcher":"ournotes-global-gacha"}],
				eventAltSources: [{"label":"BHK官方公告","url":"https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw","fetcher":"ournotes-global-event"}],
		});

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["bandori"] = (url, signal, tz) => ns_bandori_gachaBandori(url, signal, tz);
		EVENT_FETCHERS["bandori"] = Object.assign(EVENT_FETCHERS["bandori"] || {}, { default: (url, signal, tz) => ns_bandori_eventsBandori(url, signal, tz) });
		EVENT_FETCHERS["ournotes"] = Object.assign(EVENT_FETCHERS["ournotes"] || {}, { default: (url, signal, tz) => ns_ournotes_eventsOurNotes(url, signal, tz) });
		GACHA_FETCHERS["bandori-bestdori-gacha"] = (url, signal, tz) => ns_bestdori_gachaBestdori(url, signal, tz);
		GACHA_FETCHERS["ournotes-global-gacha"] = (url, signal, tz) => ns_ournotes_global_gachaOurNotesGlobal(url, signal, tz);

		EVENT_FETCHERS["bandori"] = EVENT_FETCHERS["bandori"] || {};

		Object.assign(EVENT_FETCHERS["bandori"], {

			"bandori-bestdori-event": { default: (url, signal, tz) => ns_bestdori_eventsBestdori(url, signal, tz) },

		});
		EVENT_FETCHERS["ournotes-global"] = EVENT_FETCHERS["ournotes-global"] || {};

		Object.assign(EVENT_FETCHERS["ournotes-global"], {

			"ournotes-global-event": { default: (url, signal, tz) => ns_ournotes_global_eventsOurNotesGlobal(url, signal, tz) },

		});
