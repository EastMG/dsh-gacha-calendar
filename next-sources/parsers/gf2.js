// next-sources/parsers/gf2.js —— 少女前线2：追放 国服（sunborngame 官方 API）
//
// 契约：async (url, signal, tz) → 数据对象 | null（null = 未公布）
//
// ── 实测形态（2026-10-01/02 抓夹具，见 fixtures/gf2-*）────────────────────────
// 列表 API：GET /website/news_list/{typeId}?page=1&limit=10
//   → { code:0, msg:"", data:{ limit, page, total, list:[{Id,Type,Title,Date,Content,Marks,Site,GlobalTop}] } }
//   ⚠️ **列表里的 `Content` 恒为空字符串**（实测 4 个夹具都是 ""）：正文只在详情 API 里。
//      所以卡池/活动的「活动时间」必须再抓一次 /website/news/{Id}。
//      任务书里说的「Content 是 HTML 富文本」指的是**详情**响应，列表响应不是。
// 详情 API：GET /website/news/{Id} → { code:0, data:{ Id, Type, Title, Date, Content:"<p>…<br>…", … } }
//
// ── typeId 实测语义（与任务书的「简化版形态」有出入，以实测为准）──────────────
//   · typeId=4：**活动与卡池混排**。同页既有【静默突触】这类大型主题活动，也有
//     「…限时概率UP活动现已开启！」「【新装采购·睡醒的人鱼】」「【重逢采购】」这类卡池公告。
//     → 卡池侧**必须按标题过滤**出卡池类公告，不能无脑取第一条（第一条往往是主题活动）。
//   · typeId=3：官方公告（版本更新公告 / 临时维护公告 / 封禁公告）。
//   · 卡池过滤词：概率UP / 采购 / 军备提升（GF2 的卡池就叫「采购」，装备池叫「军备提升」）。
//
// ── `Date` 字段的真正含义（实测的交叉验证，非猜测）──────────────────────────
//   · 9/22 版本更新公告：Date="2026-09-21 18:31:03"（公告发布时刻），
//     正文「维护时间：2026年9月22日09:00~12:00」。
//   · 卡池公告 2128「代理人、莉塔拉、科谢尼娅限时概率UP活动现已开启！」：
//     Date="2026-09-22 12:00:00" = **当日维护结束 12:00**；正文「活动时间：
//     2026年9月22日 版本更新后~2026年10月13日 08:59」。
//   · 另一条【迭代回廊】Date="2026-10-01 05:00:00" —— 正是国服每日 05:00 刷新点。
//   ⇒ `Date` = **该条公告的生效时刻**，而正文里的「版本更新后」= 维护结束 = `Date` 的时刻部分。
//     所以「版本更新后」这类**起点不明确的窗口**用 `Date` 的时刻补齐（源站自身给出的值），
//     不去猜「凌晨4点」之类的惯例。日期不同日则视为无法解析、跳过该窗口（宁缺勿造）。
//
// ── 时区 UTC+8（Asia/Shanghai）**推定** ─────────────────────────────────────
//   源站正文未硬标注时区。推定依据：① API 的 Date 全部是北京时间口径（发布 18:31、
//   维护 09:00~12:00）；② 每日刷新点 05:00 是国服惯例；③ 同一条公告里的维护窗口与
//   卡池窗口同源同口径。属**推定**，报告里已注明（非硬证据）。

import { fetchJson, textOf, sourceInstant, sourceWallParts, fmtWindow } from "../lib/env.js";

export const GF2_BASE = "https://gf2-web-preregister-api.sunborngame.com";
const GF2_HOME = "https://gf2.sunborngame.com/";
export const GF2_TZ = "Asia/Shanghai";
// 注册表用的两个入口（两侧 URL 就是任务书给的那两个 typeId）
export const GF2_GACHA_URL = `${GF2_BASE}/website/news_list/4?page=1&limit=10`;
export const GF2_EVENT_URL = `${GF2_BASE}/website/news_list/3?page=1&limit=10`;

// 依次试候选：单条失败（网络/404）不整体崩，留给下一条；**全部失败则抛出第一个错误**
// —— 不能把"源站挂了"静默降级成"未公布"（那会让上层以为当期真的没内容）。
async function firstWorking(candidates, work) {
	let firstErr = null;
	for (const c of candidates) {
		try {
			const r = await work(c);
			if (r) return r;
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	if (firstErr) throw firstErr;
	return null;
}

// 卡池类公告的标题特征（实测：采购 = 角色池，军备提升 = 装备池）
const GF2_POOL_RE = /概率UP|采购|军备提升/;
// 版本更新公告的特征（活动侧优先取它；其余是临时维护/封禁公告）
const GF2_VERSION_RE = /版本更新|维护/;

// ── 列表解析 ──
// 容错：形状不对 → 抛错（= 该侧抓取失败）；list 为空数组 → 返回 []（= 当期无内容）
export function parseGf2List(json, tz = GF2_TZ) {
	if (!json || typeof json !== "object") throw new Error("gf2-bad-json");
	if (json.code !== 0) throw new Error("gf2-code-" + json.code);
	const data = json.data;
	if (!data || !Array.isArray(data.list)) throw new Error("gf2-bad-json");
	return data.list
		.filter((x) => x && typeof x.Id === "number" && typeof x.Title === "string")
		.map((x) => ({
			id: x.Id,
			type: x.Type,
			title: x.Title,
			date: typeof x.Date === "string" ? x.Date : "",
			dateTs: parseGf2Date(x.Date, tz)
		}));
}

// "2026-09-22 12:00:00" → 绝对毫秒（按 tz 解释源站墙钟）。解析不出 → null
export function parseGf2Date(s, tz = GF2_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

export function gf2DetailUrl(id) { return `${GF2_BASE}/website/news/${id}`; }

// ── 正文窗口解析 ──
// 令牌化：日期(必带年) / 时刻 / 「版本更新后」类短语 / 区间分隔符
// 为什么用令牌而不用一条大正则：GF2 的窗口有 3 种写法混排——
//   `2026年9月22日09:00~12:00`（同日，末段只有时刻）
//   `2026年9月22日 版本更新后~2026年11月3日 08:59`（起点是短语）
//   `2026年9月22日 版本更新后~2026年10月13日 08:59`
// 令牌走法可以把「起点未知」和「末段缺日期」分别处理，比分组的可选组好读也好测。
const GF2_TOKEN = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?|(版本更新完成后|版本更新后|更新维护后|维护完成后|维护后|更新后)|([~～\-—－至])/g;

// 「维护后」类短语 → 用 dateHint（= 该条公告的 `Date`）的时刻补起点；
// 只有 hint 的**日历日**与窗口起点日一致时才敢用（否则宁可不解析这个窗口）
function resolvePhrase(phrase, dateHint, tz, y, mo, d) {
	if (!phrase || !dateHint) return null;
	const hintParts = sourceWallParts(dateHint, tz);
	if (!hintParts) return null;
	if (hintParts.y !== y || hintParts.mo !== mo || hintParts.d !== d) return null;
	return { h: hintParts.h, mi: hintParts.mi };
}

// 从正文纯文本抽窗口。返回 [{ label, startTs, endTs, raw, openStart }]
//   · 只认**同一行内**的窗口（textOf 已把 <br> 变成 \n）——实测 GF2 的窗口都不跨行
//   · 单日期（如「补偿有效期：2026年9月28日23:59:59」）不构成窗口 → 不产出（不硬凑区间）
export function parseGf2Windows(text, tz = GF2_TZ, dateHint = null) {
	const out = [];
	const lines = String(text == null ? "" : text).split("\n");
	let lastHeader = "";
	for (const lineRaw of lines) {
		const line = String(lineRaw);
		if (!line.trim()) continue;
		const toks = [];
		GF2_TOKEN.lastIndex = 0;
		let m;
		while ((m = GF2_TOKEN.exec(line)) !== null) {
			toks.push({
				date: m[1] ? { y: +m[1], mo: +m[2], d: +m[3] } : null,
				time: m[4] != null ? { h: +m[4], mi: +m[5], s: m[6] != null ? +m[6] : 0 } : null,
				phrase: m[7] || null,
				sep: m[8] || null,
				at: m.index,
				end: m.index + m[0].length
			});
			if (m[0] === "") GF2_TOKEN.lastIndex++;   // 保险：零宽匹配不吞死循环
		}
		let i = 0;
		while (i < toks.length) {
			const t0 = toks[i];
			if (!t0.date) { i++; continue; }
			let j = i + 1;
			let startTime = null, startPhrase = null;
			if (toks[j] && toks[j].time) { startTime = toks[j].time; j++; }
			else if (toks[j] && toks[j].phrase) { startPhrase = toks[j].phrase; j++; }
			if (!(toks[j] && toks[j].sep)) { i++; continue; }
			j++;
			let endDate = null, endTime = null, endPhrase = null;
			if (toks[j] && toks[j].date) { endDate = toks[j].date; j++; }
			if (toks[j] && toks[j].time) { endTime = toks[j].time; j++; }
			else if (toks[j] && toks[j].phrase) { endPhrase = toks[j].phrase; j++; }
			if (!endDate && !endTime && !endPhrase) { i++; continue; }

			const y1 = t0.date.y, mo1 = t0.date.mo, d1 = t0.date.d;
			// 末段没写日期（同日窗口，如 `09:00~12:00`）→ 日期同起点。
			// 注意：GF2 的日期令牌**必带年**（没有「9月22日」这种裸写法），所以 endDate 一定有 y。
			const eD = endDate || { y: y1, mo: mo1, d: d1 };
			const y2 = eD.y, mo2 = eD.mo, d2 = eD.d;

			// 起点时分
			let h1 = 0, mi1 = 0;
			if (startTime) { h1 = startTime.h; mi1 = startTime.mi; }
			else if (startPhrase) {
				const r = resolvePhrase(startPhrase, dateHint, tz, y1, mo1, d1);
				if (!r) { i++; continue; }          // 短语无法定日 → 跳过，不猜
				h1 = r.h; mi1 = r.mi;
			}
			// 终点时分
			let h2 = 23, mi2 = 59;
			if (endTime) { h2 = endTime.h; mi2 = endTime.mi; }
			else if (endPhrase) {
				const r = resolvePhrase(endPhrase, dateHint, tz, y2, mo2, d2);
				if (!r) { i++; continue; }
				h2 = r.h; mi2 = r.mi;
			}

			const startTs = sourceInstant(y1, mo1, d1, h1, mi1, tz);
			const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
			if (!(endTs > startTs)) { i++; continue; }
			const pre = line.slice(0, t0.at);
			let label = pre.replace(/[\s\u00a0]+/g, "").replace(/[:：]+$/, "");
			// 行内标签过长（说明这行是正文句子而非「XX时间：」标签）→ 不用它
			if (label.length > 12) label = "";
			if (!label) label = lastHeader;
			out.push({
				label,
				startTs,
				endTs,
				raw: line.slice(t0.at, toks[j - 1].end).trim(),
				openStart: !!startPhrase
			});
			i++;
		}
		// 记忆「上一行是短标签行」（如单独一行的 `活动时间：`）→ 供下一行的窗口当 label。
		// 只认以「时间/日程/期间/期限/范围」结尾且不含数字的短行，避免把 `尊敬的指挥官：`
		// 这种称呼行当成标签（实测踩到：2142 的维护窗口被标成"尊敬的指挥官"）。
		const cleaned = line.replace(/[\s\u00a0★☆※]+/g, "");
		if (cleaned && /[:：]$/.test(cleaned) && cleaned.length <= 12) {
			const cand = cleaned.replace(/[:：]+$/, "");
			if (!/\d/.test(cand) && /(时间|日程|期间|期限|范围)$/.test(cand)) lastHeader = cand;
		}
	}
	return out;
}

// 卡池公告正文里的 UP 对象（人形）→ roles
export function parseGf2Roles(contentHtml) {
	const t = textOf(contentHtml);
	const a = t.indexOf("本期概率UP对象");
	const b = t.indexOf("访问说明");
	const scope = a >= 0 ? t.slice(a, b > a ? b : undefined) : t;
	const names = [];
	for (const m of scope.matchAll(/■\s*(?:精英|标准|旧式)?人形[「【]([^」】]{1,20})[」】]/g)) {
		const n = m[1].trim();
		if (n && !names.includes(n)) names.push(n);
	}
	return names.join("、");
}

function cleanTitle(t) {
	return String(t == null ? "" : t).replace(/\s+/g, " ").trim();
}

// 选当期窗口：优先「覆盖 now」的（越快结束越该被盯住，与插件 selectCurrent 同口径），
// 其次未来最近要开的，最后退化为结束最晚的。
export function selectGf2Window(wins, now) {
	const list = Array.isArray(wins) ? wins : [];
	if (!list.length) return null;
	const covering = list.filter((w) => w.startTs <= now && w.endTs >= now);
	if (covering.length) return covering.slice().sort((a, b) => a.endTs - b.endTs)[0];
	const future = list.filter((w) => w.startTs > now).sort((a, b) => a.startTs - b.startTs);
	if (future.length) return future[0];
	return list.slice().sort((a, b) => b.endTs - a.endTs)[0];
}

// ── 卡池侧 ──
// 取 typeId=4 列表 → 过滤卡池类公告（概率UP/采购/军备提升）→ 详情 → 抽窗口。
// 逐条最多试 3 条（一般第 1 条就命中），避免为了容错把请求数放大。
export async function gachaGf2(url, signal, tz = GF2_TZ) {
	const listUrl = url || GF2_GACHA_URL;
	const list = parseGf2List(await fetchJson(listUrl, { referer: GF2_HOME, signal, mode: "proxy" }), tz);
	if (!list.length) return null;
	const pools = list.filter((x) => GF2_POOL_RE.test(x.title));
	const ordered = (pools.length ? pools : list).slice().sort((a, b) => b.id - a.id);
	const now = Date.now();
	return firstWorking(ordered.slice(0, 3), async (it) => {
		const detail = await fetchJson(gf2DetailUrl(it.id), { referer: GF2_HOME, signal, mode: "proxy" });
		const d = detail && detail.data;
		if (!d) return null;
		const hint = parseGf2Date(d.Date || it.date, tz);
		const wins = parseGf2Windows(textOf(d.Content || ""), tz, hint);
		const w = selectGf2Window(wins, now);
		if (!w) return null;
		return {
			banner: cleanTitle(it.title),
			roles: parseGf2Roles(d.Content || ""),
			bannerDates: fmtWindow(w.startTs, w.endTs, tz),
			bannerDatesRaw: w.raw,
			startTs: w.startTs,
			endTs: w.endTs
		};
	});
}

// ── 活动侧 ──
// typeId=3 = 官方公告栏目。GF2 **没有独立的「活动一览」**：
//   · 版本更新公告给出的时间窗口是「维护时间：2026年9月22日09:00~12:00」（版本开服窗口）
//   · 主题大活动的窗口（如【静默突触】2026年9月22日 版本更新后~2026年11月3日 08:59）
//     落在 typeId=4 里，不在 typeId=3。
// 本侧按任务书给定的 URL（typeId=3）取**最新版本更新公告**，外显其维护窗口；
// 公告正文里所有可解析窗口逐行进 eventHover 如实交代。已知语义弱点：维护窗口只有几小时，
// 不等于「活动周期」——这是源站该栏目本身的形态，报告里已注明（不硬造活动区间）。
export async function eventsGf2(url, signal, tz = GF2_TZ) {
	const listUrl = url || GF2_EVENT_URL;
	const list = parseGf2List(await fetchJson(listUrl, { referer: GF2_HOME, signal, mode: "proxy" }), tz);
	if (!list.length) return null;
	const byId = list.slice().sort((a, b) => b.id - a.id);
	const versions = byId.filter((x) => GF2_VERSION_RE.test(x.title));
	const ordered = (versions.length ? versions : byId).slice(0, 3);
	const now = Date.now();
	return firstWorking(ordered, async (it) => {
		const detail = await fetchJson(gf2DetailUrl(it.id), { referer: GF2_HOME, signal, mode: "proxy" });
		const d = detail && detail.data;
		if (!d) return null;
		const hint = parseGf2Date(d.Date || it.date, tz);
		const wins = parseGf2Windows(textOf(d.Content || ""), tz, hint);
		const w = selectGf2Window(wins, now);
		if (!w) return null;
		const hover = wins
			.slice()
			.sort((a, b) => a.endTs - b.endTs)
			.map((x) => `${fmtWindow(x.startTs, x.endTs, tz)}${x.label ? `   ${x.label}` : ""}`)
			.join("\n");
		return {
			event: cleanTitle(it.title),
			eventDates: fmtWindow(w.startTs, w.endTs, tz),
			eventDatesRaw: w.raw,
			eventHover: hover
		};
	});
}
