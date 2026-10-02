// next-sources/parsers/ournotes-global.js —— BanG Dream！OurNotes **国际服**（BHK 发行）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null（null = 未公布）
//   · 活动侧：{ event, eventDates, eventDatesRaw, eventHover }
//   · 卡池侧：{ banner, roles?, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//   两侧读**同一份公告 feed**（与国际服一致：一份公告里既有招募也有活动），靠标题分流。
//
// ══ 条目形态：**默认未配置**（只挂备选源，不给 url/eventUrl）════════════════
//   本条目在 registry-p9.js 里**没有** `url` / `eventUrl`，只有 `altSources` / `eventAltSources`。
//   插件 50-refresh.js 的语义是 `if (!source.url && !source.eventUrl) → skipped`：
//   不抓取、不计成功也不计失败，UI 显示「未配置（不抓取卡池/活动）」；用户在设置页选「官方公告（BHK）」
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

import { fetchJson, decodeEntities, textOf, sourceInstant, sourceWallParts, fmtWindow } from "../lib/env.js";

export const OURNOTES_GLOBAL_GAME_BASE_ID = 118241;
export const OURNOTES_GLOBAL_TZ = "Asia/Shanghai";
export const OURNOTES_GLOBAL_LANGS = ["zh-tw", "zh-cn", "en-us", "ko-kr"];
export const OURNOTES_GLOBAL_HOME = "https://www.biligames.com/";
const LIST_ORIGIN = "https://l11-web-api.biligames.com";
const DETAIL_LIMIT = 8;

export function ournotesGlobalListUrl(lang = OURNOTES_GLOBAL_LANGS[0]) {
	return `${LIST_ORIGIN}/game/news/page?game_base_id=${OURNOTES_GLOBAL_GAME_BASE_ID}&show_position=1&lang=${lang}`;
}
export function ournotesGlobalDetailUrl(id, lang = OURNOTES_GLOBAL_LANGS[0]) {
	return `${LIST_ORIGIN}/game/news/detail?game_base_id=${OURNOTES_GLOBAL_GAME_BASE_ID}&id=${id}&lang=${lang}`;
}
export const OURNOTES_GLOBAL_LIST_URL = ournotesGlobalListUrl("zh-tw");
// 备选源标识就是 URL 本身（`altSourceId(alt) = alt.url`）→ 注册表里的 URL 必须与这里逐字一致
export function langOf(url, fallback = OURNOTES_GLOBAL_LANGS[0]) {
	try {
		const v = new URL(url).searchParams.get("lang");
		return v && OURNOTES_GLOBAL_LANGS.includes(v) ? v : fallback;
	} catch { return fallback; }
}

//#region 文本工具（自带一份，理由见文件头「合并器注意」）
const ENT_EXTRA = {
	middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–", nbsp: " ", amp: "&",
	lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sup2: "²", sup3: "³", yen: "¥"
};
export function decodeExtra(s) {
	return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
		const v = ENT_EXTRA[String(k).toLowerCase()];
		return v != null ? v : m;
	}));
}
function plain(html) { return decodeExtra(textOf(html)).replace(/\s+/g, " ").trim(); }
// 按 </p> 切段（详情正文若是 HTML）；纯文本没有 <p> → 退化成按行切
export function ournotesGlobalParagraphs(html) {
	const s = String(html == null ? "" : html);
	const chunks = /<\/p\s*>/i.test(s) ? s.split(/<\/p\s*>/i) : s.split(/\r?\n/);
	return chunks.map((c) => plain(c)).filter(Boolean);
}
//#endregion

//#region 字段候选（**假设**，源站不可达，见文件头）
function pickStr(obj, keys) {
	for (const k of keys) {
		const v = obj ? obj[k] : null;
		if (typeof v === "string" && v.trim() !== "") return v.trim();
	}
	return "";
}
function pickNum(obj, keys) {
	for (const k of keys) {
		const v = obj ? obj[k] : null;
		if (typeof v === "number" && Number.isFinite(v)) return v;
		if (typeof v === "string" && /^\d{6,}$/.test(v.trim())) return Number(v.trim());
	}
	return null;
}
const K_ID = ["id", "news_id", "article_id", "content_id", "newsId"];
const K_TITLE = ["title", "name", "subject", "news_title"];
const K_TIME = ["display_time", "displayTime", "create_time", "createTime", "publish_time", "publishTime", "date", "ctime"];
const K_CONTENT = ["content", "body", "text", "detail", "description", "news_content"];
const K_START = ["start_time", "startTime", "begin_time", "beginTime", "start_at", "startAt", "start_date"];
const K_END = ["end_time", "endTime", "end_at", "endAt", "end_date", "endDate"];
export function ournotesGlobalTitle(x) {
	return plain(pickStr(x, K_TITLE));
}
export function ournotesGlobalInstant(x, tz = OURNOTES_GLOBAL_TZ) {
	return parseOurNotesGlobalStamp(pickStr(x, K_TIME), tz);
}
//#endregion

//#region 列表 / 详情结构
// 列表 JSON → { totalCount, items:[{ id, title, sortKey, dateTs, raw }] }（按发布时间倒序）
//   结构不合法（非对象 / code≠0 / data 非对象 / list 非数组）→ 抛错（结构性损坏）
export function parseOurNotesGlobalPage(json) {
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
			const sortKey = pickStr(x, K_TIME);
			return {
				id: pickNum(x, K_ID),
				title: ournotesGlobalTitle(x),
				sortKey,
				dateTs: parseOurNotesGlobalStamp(sortKey, OURNOTES_GLOBAL_TZ),
				raw: x
			};
		})
		.filter((x) => x.id != null && x.title)
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
	return { totalCount: Number.isFinite(totalCount) ? totalCount : items.length, items, raw: d };
}
// 空 = 未公布：`total_count === 0` 或 list 为空（**实测** Lead 抓到的那次就是 total_count:0）
export function isOurNotesGlobalEmpty(json, page = null) {
	const p = page || parseOurNotesGlobalPage(json);
	return p.totalCount === 0 || p.items.length === 0;
}
export function ournotesGlobalDetailText(detail) {
	const d = detail && typeof detail === "object" && detail.data && typeof detail.data === "object" ? detail.data : detail;
	if (!d || typeof d !== "object") return "";
	const v = (() => {
		for (const k of K_CONTENT) {
			const c = d[k];
			if (typeof c === "string" && c.trim() !== "") return c;
			if (c && typeof c === "object" && typeof c.rendered === "string") return c.rendered;
		}
		return "";
	})();
	return v;
}
// 结构化档期（若源站给了 start/end 字段就优先用，给了才好）；拿不到 → null
export function ournotesGlobalStructuredWindow(item, tz = OURNOTES_GLOBAL_TZ) {
	const d = item && typeof item === "object" && item.data && typeof item.data === "object" ? item.data : item;
	const a = pickStr(d, K_START), b = pickStr(d, K_END);
	if (!a || !b) return null;
	const aTs = parseOurNotesGlobalStamp(a, tz), bTs = parseOurNotesGlobalStamp(b, tz);
	if (aTs == null || bTs == null || !(bTs > aTs)) return null;
	return { startTs: aTs, endTs: bTs, raw: `${a} ~ ${b}`, glued: false, structured: true };
}
//#endregion

//#region 日期令牌（容错：年月日 / 斜杠 / 点 / ISO，年份可省）
export function parseOurNotesGlobalStamp(s, tz = OURNOTES_GLOBAL_TZ) {
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
const TOK_RE = new RegExp([
	"(?<stamp>(?:(?<sy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<smo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<sd>\\d{1,2})\\s*日?\\s*(?<sh>\\d{1,2})\\s*[:：]\\s*(?<smi>\\d{2}))",
	"(?<date>(?:(?<dy>20\\d{2})\\s*(?:年|[/\\-.])\\s*)?(?<dmo>\\d{1,2})\\s*(?:月|[/\\-.])\\s*(?<dd>\\d{1,2})\\s*日?)",
	"(?<sep>[~\uff5e\u301c\u223c至到]|\\s[-\\u2013\\u2014\\uff0d]\\s|[-\\u2013\\u2014\\uff0d])",
	"(?<perm>常驻|常駐|永久|常設|長期)"
].join("|"), "g");
function yearOf(y, mo, hint) {
	if (y != null) return y;
	if (!hint || hint.y == null) return null;
	return mo > hint.mo + 6 ? hint.y - 1 : hint.y;
}
// 一段文本 → { norm, windows:[{ startTs, endTs, raw, glued }], skipped }
export function extractOurNotesGlobalWindows(text, tz = OURNOTES_GLOBAL_TZ, yearHint = null) {
	const src = String(text == null ? "" : text);
	const norm = src;
	const toks = [];
	TOK_RE.lastIndex = 0;
	let m;
	while ((m = TOK_RE.exec(norm)) !== null) {
		if (m[0] === "") { TOK_RE.lastIndex++; continue; }
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
		const y1 = yearOf(a.y, a.mo, yearHint);
		if (y1 == null) { skipped.push({ raw, reason: "no-year" }); i += 2; continue; }
		let y2 = b.y != null ? b.y : y1;
		if (b.y == null && (b.mo < a.mo || (b.mo === a.mo && b.d < a.d))) y2 = y1 + 1;
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
const RE_GACHA_ZH = /招募|扭蛋|必得|祈愿|招集/;
const RE_EVENT_ZH = /活動|活动|賽事|赛事|劇情|剧情|舉辦|举办|慶典|庆典|任務|任务/;
const RE_GACHA_EN = /\brecruit|\bgacha\b|\bbanner\b|\bpickup\b|\bpick-up\b/i;
const RE_EVENT_EN = /\bevent\b|\bcampaign\b|\bstory\b|\bmission\b|\bcelebration\b/i;
const RE_GACHA_KO = /모집|가챠|뽑기/;
const RE_EVENT_KO = /이벤트|활동|스토리|캠페인/;
export function classifyOurNotesGlobalTitle(title) {
	const t = String(title == null ? "" : title);
	if (RE_GACHA_ZH.test(t) || RE_GACHA_EN.test(t) || RE_GACHA_KO.test(t)) return "gacha";
	if (RE_EVENT_ZH.test(t) || RE_EVENT_EN.test(t) || RE_EVENT_KO.test(t)) return "event";
	return null;
}
// 标题清洗：去掉尾部动作尾巴（简繁都认：`开放！`/`開放！`/`舉辦中！`…），保留活动/卡池名
const TITLE_TAIL_RE = /[\s，,。！!～~\-—]*(?:即将|即將|现已|現已|正在|已)?(?:开放|開放|開啟|开启|举办|舉辦|登場|登场|上线|上線|开始|開始|结束|結束|预告|預告)[中]?[！!。]?\s*$/;
export function cleanTitle(t) {
	let s = String(t == null ? "" : t).trim();
	for (let i = 0; i < 2; i++) {
		const n = s.replace(TITLE_TAIL_RE, "").trim();
		if (n === s) break;
		s = n;
	}
	return s || String(t == null ? "" : t).trim();
}
//#endregion

//#region 抓取器（契约：async (url, signal, tz, now = Date.now()) → 对象 | null）
// 外显挑选：覆盖 now 的窗口里取结束最早的（并列按文档顺序）
export function pickOurNotesGlobalWindow(items, now) {
	const act = (items || []).filter((x) => x.startTs <= now && x.endTs >= now);
	if (!act.length) return null;
	return act.map((x, i) => ({ x, i })).sort((a, b) => (a.x.endTs - b.x.endTs) || (a.i - b.i))[0].x;
}
function yearHintOf(item, tz) {
	return item && item.dateTs != null ? sourceWallParts(item.dateTs, tz) : null;
}
async function loadOurNotesGlobal(url, signal, tz, now, want) {
	const listUrl = url || OURNOTES_GLOBAL_LIST_URL;
	const lang = langOf(listUrl);
	// mode 一律 "proxy"：`l11-web-api.biligames.com` 无 ACAO（也未实测直连放行）
	const json = await fetchJson(listUrl, { referer: OURNOTES_GLOBAL_HOME, signal, mode: "proxy" });
	const page = parseOurNotesGlobalPage(json);
	if (isOurNotesGlobalEmpty(json, page)) return null;     // total_count:0 / list 空 → 未公布
	let firstErr = null, loaded = 0, tried = 0;
	for (const it of page.items.slice(0, DETAIL_LIMIT)) {
		if (classifyOurNotesGlobalTitle(it.title) !== want) continue;
		tried++;
		let detail = null;
		try {
			detail = await fetchJson(ournotesGlobalDetailUrl(it.id, lang), { referer: OURNOTES_GLOBAL_HOME, signal, mode: "proxy" });
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		loaded++;
		const text = ournotesGlobalDetailText(detail);
		const title = ournotesGlobalTitle((detail && detail.data) || detail) || it.title;
		const hint = yearHintOf(it, tz);
		const structured = ournotesGlobalStructuredWindow(detail, tz);
		const parsed = extractOurNotesGlobalWindows(text, tz, hint);
		const windows = structured ? [structured, ...parsed.windows] : parsed.windows;
		const best = pickOurNotesGlobalWindow(windows, now);
		if (!best) continue;
		const active = windows.filter((x) => x.startTs <= now && x.endTs >= now)
			.map((x, i) => ({ x, i }))
			.sort((a, b) => (a.x.startTs - b.x.startTs) || (a.i - b.i))
			.map((o) => o.x);
		const lines = active.map((x) => `${x === best ? "▶ " : "  "}${fmtWindow(x.startTs, x.endTs, tz)}${x.structured ? "   （结构化字段）" : ""}`);
		const note = "（国际服含港澳台，源站未标时区；tz=Asia/Shanghai 按任务书指定，**不是** Asia/Tokyo）";
		const hover = [
			`BanG Dream！OurNotes·国际服 · ${title} ${note}`,
			`来源：BHK 官方公告 l11-web-api.biligames.com（game_base_id=${OURNOTES_GLOBAL_GAME_BASE_ID}，lang=${lang}）`,
			...lines
		].join("\n");
		return { title, best, hover };
	}
	if (loaded === 0 && tried > 0 && firstErr) throw firstErr;   // 本侧相关详情全失败 → 抛错
	return null;
}
export async function gachaOurNotesGlobal(url, signal, tz = OURNOTES_GLOBAL_TZ, now = Date.now()) {
	const hit = await loadOurNotesGlobal(url, signal, tz, now, "gacha");
	if (!hit) return null;
	const { title, best, hover } = hit;
	return {
		banner: cleanTitle(title) || "（未命名招募）",
		roles: "",
		bannerDates: fmtWindow(best.startTs, best.endTs, tz),
		bannerDatesRaw: best.raw,
		startTs: best.startTs,
		endTs: best.endTs,
		bannerHover: hover
	};
}
export async function eventsOurNotesGlobal(url, signal, tz = OURNOTES_GLOBAL_TZ, now = Date.now()) {
	const hit = await loadOurNotesGlobal(url, signal, tz, now, "event");
	if (!hit) return null;
	const { title, best, hover } = hit;
	return {
		event: cleanTitle(title) || "（未命名活动）",
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		eventHover: hover
	};
}
//#endregion
