// next-sources/parsers/umapyoi.js —— 赛马娘 日服（第三方 API：api.umapyoi.net）
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? } | null
//
// ⚠️ 实测（2026-10-02 夹具 `b1-umapyoi-gacha`，704 条）与任务给的简化形态的差别：
//   GET https://api.umapyoi.net/api/v1/gacha → JSON **数组**，每条 =
//     { card_type: "Outfit" | "Support Card", id, start_date, end_date, type }
//   · `start_date` / `end_date` 是 **Unix 秒**（不是毫秒）。
//   · `end_date === 2147483647`（INT32_MAX）是**常驻哨兵**：源站用它表示"没有结束时间"（夹具里 38 条）。
//   · **源站只给"卡"（id + 卡类型）的获取窗口，没有卡池名** —— 所以 banner 只能合成：
//     本解析器把"同一 (start_date, end_date) 的一批新卡"当作一个卡池窗口，
//     banner 写成「赛马娘日服卡池（卡类型…）」。
//     ⚠️ 只按 `start_date` 分组是**错的**：实测 29 个 start_date 同时挂多组不同 end_date，
//        而且常驻卡（哨兵）与有界卡会共用同一个 start_date —— 按 start 分组会把"常驻"
//        混进窗口，从而把整组误判成已过期（2026-03-11 那批就是这样）。
//
// 时区：`Asia/Tokyo`。依据（两条）：
//   ① bwiki 正文硬标注「日服卡池时间记录统一为日本时间」；
//   ② 夹具自洽：666 个**有界** end_date 全部落在 02:59:59Z（= 11:59:59 JST，一个不差），
//      且 664/704 个 start_date 落在 03:00Z（= 12:00 JST，日服卡池 12:00 更新）——
//      只有 UTC+9 才能把这些渲染成"整点 12:00 / 11:59:59"。
//
// 选池规则（本项目 JSON 源的通用约定，见 registry-b1.js 注释）：
//   覆盖当前时刻的**有界窗口**里取 startTs 最新的那批（并列取结束更早、id 更小）。
//   常驻卡（哨兵）不构成"当期窗口"；当期没有任何有界窗口 → 返回 null（未公布）。

import { fetchJson, fmtWindow } from "../lib/env.js";

const DEFAULT_URL = "https://api.umapyoi.net/api/v1/gacha";
export const PERMANENT_END = 2147483647;   // 源站常驻哨兵（Unix 秒 = INT32_MAX）
const HOVER_MAX = 20;                      // hover 最多列这么多行，余下只报数量

const toNum = (v) => {
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
const byNewestStart = (a, b) => (b.startTs - a.startTs) || (a.endTs - b.endTs) || (a.id0 - b.id0);

// 纯函数：夹具/单测可直接喂 JSON（不联网）
export function parseUmapyoiGacha(json, now = Date.now(), tz = "Asia/Tokyo") {
	if (!Array.isArray(json)) throw new Error("umapyoi-bad-shape");
	const rows = [];
	for (const it of json) {
		if (!it || typeof it !== "object") continue;
		const s = toNum(it.start_date);
		if (s == null) continue;
		const e = toNum(it.end_date);
		// 常驻哨兵（或缺失结束）→ endTs 记为 null：**绝不**把 2147483647 当成真实时刻
		const permanent = e == null || e >= PERMANENT_END;
		rows.push({
			id: it.id,
			id0: toNum(it.id) == null ? Number.MAX_SAFE_INTEGER : toNum(it.id),
			cardType: String(it.card_type == null ? "" : it.card_type),
			type: it.type,
			startTs: s * 1000,
			endTs: permanent ? null : e * 1000,
			permanent
		});
	}
	if (rows.length === 0) throw new Error("umapyoi-no-rows");

	// 有界窗口 = 同一 (start_date, end_date) 的一批卡（见文件头：不能只按 start_date 分组）
	const merged = new Map();
	for (const r of rows) {
		if (r.permanent) continue;
		const k = r.startTs + "|" + r.endTs;
		let p = merged.get(k);
		if (!p) { p = { startTs: r.startTs, endTs: r.endTs, id0: r.id0, items: [] }; merged.set(k, p); }
		p.items.push(r);
		if (r.id0 < p.id0) p.id0 = r.id0;
	}
	const pools = [...merged.values()].map((p) => ({
		startTs: p.startTs,
		endTs: p.endTs,
		id0: p.id0,
		items: p.items,
		ids: p.items.map((x) => x.id).filter((x) => x != null),
		cardTypes: [...new Set(p.items.map((x) => x.cardType).filter(Boolean))]
	}));

	const active = pools.filter((p) => p.startTs <= now && p.endTs >= now).sort(byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;   // 抓到数据但当期没有有界窗口（常驻卡不算） = 未公布

	const types = cur.cardTypes.join("、");
	const banner = types ? `赛马娘日服卡池（${types}）` : "赛马娘日服卡池";
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	const lines = active.slice(0, HOVER_MAX).map((p) => {
		const detail = `${p.cardTypes.join("、") || "卡"}×${p.items.length}`
			+ (p.ids.length ? `（id ${p.ids.join("、")}）` : "");
		return `${fmtWindow(p.startTs, p.endTs, tz)}  ${detail}`;
	});
	if (active.length > lines.length) lines.push(`…另有 ${active.length - lines.length} 个同期窗口未列出`);
	const permActive = rows.filter((r) => r.permanent && r.startTs <= now).length;
	if (permActive > 0) lines.push(`另有 ${permActive} 张常驻卡（end_date=2147483647 哨兵，无结束时间，不计入当期窗口）`);
	// 源站无卡池名 → hover 首行如实说明 banner 是合成的
	const hover = ["赛马娘日服（源站为卡级数据，无卡池名；起止＝该批新卡的获取窗口）", ...lines].join("\n");

	return {
		banner,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		bannerHover: hover
	};
}

// 抓取器：mode="direct"（实测 api.umapyoi.net 响应 ACAO=*）
export async function gachaUmapyoi(url, signal, tz = "Asia/Tokyo", now = Date.now()) {
	const data = await fetchJson(url || DEFAULT_URL, { signal, mode: "direct" });
	return parseUmapyoiGacha(data, now, tz);
}
