// next-sources/parsers/p5x.js —— P5X 国服（完美世界官方站）
//
// ⚠️ 调研修正（2026-10-02 实测）：官方站的**卡池/活动专栏已停更 2 年**
//   · /news/gamebroad/（卡池）最后一条 2024-10-10
//   · /news/gameevent/（活动）最后一条 2024-09-27
//   · 但 /news/gamenews/（综合，即版本更新公告）**仍在更新**（实测最新 2026-09-24「5.4.1版本今日上线」）
//   所以本解析器**只用 gamenews**：从版本更新公告正文里抽「开始日—结束日」档期。
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw? } | { event, eventDates, ... }
//
// 时区：国服，源码站**未见显式标注**（原文只有「2026年9月24日—10月22日」），按 UTC+8 推定。
// 数据形态：日期是**纯日期无时分**（如「2026年9月24日—10月22日更新前」）→
//   起止时刻按惯例补 04:00 / 03:59（维护窗口「凌晨04:20-上午10:00」的典型形态）。
//   ⚠️ 这是**推算**，不是源站给定值；调用方若需要精确时刻应自行复核。

import { fetchText, stripTags, decodeEntities, sourceInstant, fmtWindow, pad2 } from "../lib/env.js";

const BASE = "https://p5x.wanmei.com";

// 列表页 → 条目数组 [{ href, title, dateText }]
export function parseP5xList(html) {
	const items = [];
	// 站点形态：<a href="/news/gamenews/20260924/264338.html"> … <p class="item_title">标题</p> … <p class="date_time">2026.09.24</p>
	const re = /<a[^>]+href="(\/news\/[a-z]+\/(\d{8})\/(\d+)\.s?html)"[^>]*>([\s\S]{0,1200}?)<\/a>/g;
	for (const m of String(html).matchAll(re)) {
		const block = m[4];
		const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/);
		const dm = block.match(/class="date_time"[^>]*>([\s\S]*?)<\/\w+>/);
		const title = tm ? stripTags(tm[1]) : "";
		if (!title) continue;
		items.push({ href: m[1], dateKey: m[2], id: m[3], title, dateText: dm ? stripTags(dm[1]) : "" });
	}
	// 兜底：站点偶有 class 顺序不同 → 退化为"按 href 切块"再就近找标题/日期
	if (items.length === 0) {
		const links = [...String(html).matchAll(/href="(\/news\/([a-z]+)\/(\d{8})\/(\d+)\.s?html)"/g)];
		for (const m of links) {
			const start = m.index;
			const block = String(html).slice(start, start + 1400);
			const tm = block.match(/class="item_title"[^>]*>([\s\S]*?)<\/\w+>/) || block.match(/<p[^>]*>([^<]{4,80})<\/p>/);
			const title = tm ? stripTags(tm[1]) : "";
			if (title) items.push({ href: m[1], dateKey: m[3], id: m[4], title, dateText: "" });
		}
	}
	// 去重（同一 href 可能在"最新/推荐"两处出现）
	const seen = new Set();
	return items.filter((x) => (seen.has(x.href) ? false : (seen.add(x.href), true)));
}

// 详情页正文 → 纯文本
function bodyText(html) {
	return decodeEntities(
		String(html)
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/p>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
	).replace(/[ \t\u00a0]+/g, " ");
}

// 从正文抽「YYYY年M月D日 — YYYY年M月D日」档期；返回归一化后的窗口列表
// 形态（实测）：`2026年9月24日—10月22日更新前`、`2026年10月5日—2026年10月22日更新前`
export function parseP5xWindows(text, tz) {
	const out = [];
	const re = /(20\d{2})年(\d{1,2})月(\d{1,2})日\s*[—\-~～至]\s*(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日/g;
	for (const m of String(text).matchAll(re)) {
		const y1 = +m[1], mo1 = +m[2], d1 = +m[3];
		const y2 = m[4] ? +m[4] : (mo1 > +m[5] ? y1 + 1 : y1);   // 跨年：结束月小于开始月
		const mo2 = +m[5], d2 = +m[6];
		// 时刻：公告只给日期 → 按国服惯例补 04:00 开 / 03:59 收（推算，见文件头）
		const startTs = sourceInstant(y1, mo1, d1, 4, 0, tz);
		const endTs = sourceInstant(y2, mo2, d2, 3, 59, tz);
		if (endTs <= startTs) continue;
		out.push({ startTs, endTs, raw: `${y1}年${mo1}月${d1}日 ~ ${y2}年${mo2}月${d2}日` });
	}
	return out;
}

// 归一化标题：去掉站点尾巴「-P5X-《女神异闻录：夜幕魅影》手游官网」
function cleanTitle(t) {
	return String(t).replace(/[-—|]\s*P5X\s*[-—|]?[\s\S]*$/, "").trim() || String(t).trim();
}

// ── 卡池侧 ──
// P5X 没有独立的"卡池时刻表"栏目（gamebroad 已停更）→ 从最新版本更新公告里抽档期。
// 返回体系里的卡池字段；抽不到 → null（未公布）。
export async function gachaP5x(url, signal, tz = "Asia/Shanghai") {
	const listUrl = url || `${BASE}/news/gamenews/index.html`;
	const list = parseP5xList(await fetchText(listUrl, { referer: BASE, signal }));
	if (list.length === 0) throw new Error("p5x-list-empty");
	// 站点新→旧：取第一条（若列表未排序则按 dateKey 排序兜底）
	const sorted = list.slice().sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
	const newest = sorted[0];
	const detailUrl = newest.href.startsWith("http") ? newest.href : BASE + newest.href;
	const text = bodyText(await fetchText(detailUrl, { referer: BASE, signal }));
	const wins = parseP5xWindows(text, tz);
	if (wins.length === 0) return null;
	// ⚠️ 只在**有窗口覆盖当前时刻**时才外显；否则返回 null（= 未公布）。
	// 为什么不做"回退到结束最晚的过期档期"：那会把几年前的活动当成"当期"展示，
	// 与插件本体 `selectCurrent` / `bwikiGachaPayload` 的语义也**不一致**
	// （B2 批次指出过这个偏差，已按插件语义统一）。
	const now = Date.now();
	const cur = wins.find((w) => w.startTs <= now && w.endTs >= now);
	if (!cur) return null;
	return {
		banner: cleanTitle(newest.title),
		roles: "",
		bannerDates: fmtWindow(cur.startTs, cur.endTs, tz),
		bannerDatesRaw: cur.raw,
		startTs: cur.startTs,
		endTs: cur.endTs
	};
}

// ── 活动侧 ──
// 同源同一份数据：把**全部**当期窗口列出（悬停逐行），外显取覆盖当前时刻的那个。
export async function eventsP5x(url, signal, tz = "Asia/Shanghai") {
	const listUrl = url || `${BASE}/news/gamenews/index.html`;
	const list = parseP5xList(await fetchText(listUrl, { referer: BASE, signal }));
	if (list.length === 0) throw new Error("p5x-list-empty");
	const sorted = list.slice().sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
	const newest = sorted[0];
	const detailUrl = newest.href.startsWith("http") ? newest.href : BASE + newest.href;
	const text = bodyText(await fetchText(detailUrl, { referer: BASE, signal }));
	const wins = parseP5xWindows(text, tz);
	if (wins.length === 0) return null;
	const now = Date.now();
	const active = wins.filter((w) => w.startTs <= now && w.endTs >= now);
	const primary = (active.length ? active : wins).slice().sort((a, b) => a.endTs - b.endTs)[0];
	const hover = (active.length ? active : wins)
		.slice().sort((a, b) => a.endTs - b.endTs)
		.map((w) => `${fmtWindow(w.startTs, w.endTs, tz)}${w.raw ? `   (${w.raw})` : ""}`)
		.join("\n");
	return {
		event: cleanTitle(newest.title),
		eventDates: fmtWindow(primary.startTs, primary.endTs, tz),
		eventDatesRaw: primary.raw,
		eventHover: hover
	};
}

// 供测试：从本地 HTML 直接跑解析（不联网）
export function gachaP5xFromHtml(listHtml, detailHtml, tz = "Asia/Shanghai") {
	void listHtml; void detailHtml; void tz;
	throw new Error("unused");   // 夹具测试走 fetch 注入（见 test/run.mjs）
}
