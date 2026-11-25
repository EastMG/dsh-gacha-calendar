// test/cases-wuwa-20261126.mjs —— 鸣潮：活动 `tag` 口径失效 + 「角色忆旅唤取」池被过滤（活网审计 A）
//
// ── 现场（`_audit-A-raw/wuwa.event.1.txt`，2026-11-26 01:45 +08 抓的官网 `zh-Hans.json`，116772 字符）──
//   · `recommend`/`game`/`activity` 三组里 `tag` 分布实测 = 1×8、**3×5**、4×3、**5×1**、6×1、7×8；
//   · 当期真活动主要落在 **tag=3**（[拉海洛方块・逆转]休闲活动 / [昔梦赠礼]七日签到活动 /
//     [第二索拉：未名之梦]休闲活动 …），tag=5 只剩 1 条（[回音盈域] 养成材料限时双倍活动）；
//   · 卡池侧新出现「角色忆旅唤取」池（[忆旅回响Ⅱ]，11-12 04:00 ~ 12-22 03:59）与「武器忆旅唤取」
//     （[回响铸忆Ⅱ]）。
// 旧实现两个硬编码：活动 `if (Number(it.tag) !== 5) continue`（⇒ 活动侧 nomatch）、卡池
// `isChar = /角色活动唤取/`（⇒ 在期的第 4 个角色池整条丢失）。本段守修好后的口径。
//
// ── 本段守什么 ──
//   ① 夹具就是 2026-11-26 的活网原始响应（逐字节同 `_audit-A-raw/wuwa.event.{0,1}.txt`），
//      先把 `tag` 分布与「tag=3 的条目才是当期活动」这层**证据**钉住（反向证明旧判据只剩 1 条可收）；
//   ② 活动侧按内容特征收：三组都扫、tag 3/5 都收、排除卡池/公告/商城/常驻、正文必须有「活动时间」
//      ⇒ events 5 条（4 条 tag=3 + 1 条 tag=5），外显仍按**现有在期口径**（档位 → 结束最早 → 起点最早）；
//   ③ 卡池侧白名单加「角色忆旅唤取」⇒ gacha 数组 5 条（主条 + 4 口角色池）、悬停 4 池逐行；
//      **武器侧口径不变**（武器活动唤取 / 武器忆旅唤取 都不显）；
//   ④ 反向证明：公告（【先行体验】功能说明 / 库街区「签到工具」）、常驻玩法（「心影映花」）、
//      商城（[全新服饰]限时特惠 / [商城礼包]限时折扣上架）都不进活动数组。
//
// 夹具：`wuwa-notice-entry-20261126` / `wuwa-notice-zhhans-20261126`（真抓原样，meta 记 url + capturedAt），
// 已登记 `test/map.json`。时间断言写绝对毫秒（UTC / +08 两道门禁同一份期望值）。

import { readFileSync } from "node:fs";
import { createEngine } from "../packages/core/core.mjs";
import { check, section } from "./harness.mjs";

const TZ_CN = "Asia/Shanghai";
const NOW = Date.parse("2026-11-26T01:45:00+08:00");   // 审计采集时刻
const ENTRY_URL = "https://aki-gm-resources-back.aki-game.com/gamenotice/G152/76402e5b20be2c39f095a152090afddc/entrypoint.json";
const fxText = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");
const B = {
	entry: fxText("wuwa-notice-entry-20261126/response.txt"),
	hans: fxText("wuwa-notice-zhhans-20261126/response.txt")
};
const JSON_ = JSON.parse(B.hans);

const makeStore = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } }; };
const transport = {
	async fetchRaw(url) {
		const body = /entrypoint\.json/.test(url) ? B.entry : B.hans;
		return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
	},
	async fetchViaProxy(url) { return /entrypoint\.json/.test(url) ? B.entry : B.hans; }
};
const engineAt = (now) => createEngine({ transport, storage: makeStore(), now: () => now, timer: { setTimeout, clearTimeout } });
const run = async (now) => {
	const e = engineAt(now);
	const g = await e.__test.GACHA_FETCHERS["wuwa"](ENTRY_URL, undefined, TZ_CN, now);
	const ev = await e.__test.EVENT_FETCHERS["wuwa"].default(ENTRY_URL, undefined, TZ_CN, now);
	return { g, ev };
};

export default async function runWuwa20261126() {
	section("2026-11-26 鸣潮（活网审计 A）：活动 tag 口径失效 / 「角色忆旅唤取」池被过滤 —— 真夹具");
	{
		const { g, ev } = await run(NOW);

		// ── ① 夹具证据：tag 分布与「tag=3 才是当期活动」──
		const tagCount = {};
		for (const grp of ["game", "activity", "recommend"]) {
			for (const it of JSON_[grp] || []) tagCount[it.tag] = (tagCount[it.tag] || 0) + 1;
		}
		check("夹具 = 2026-11-26 活网原始响应：三组 tag 分布逐字（1×8 / 3×5 / 4×3 / 5×1 / 6×1 / 7×8）",
			JSON.stringify(tagCount) === JSON.stringify({ 1: 8, 3: 5, 4: 3, 5: 1, 6: 1, 7: 8 }),
			JSON.stringify(tagCount));
		// 反向证明：旧判据（只收 tag=5）在当期**只能收到 1 条**——而这 1 条不是当期活动侧的主力
		const tag5Active = ["game", "activity", "recommend"].flatMap((k) => JSON_[k] || [])
			.filter((it) => Number(it.tag) === 5 && Number(it.startTimeMs) <= NOW && Number(it.endTimeMs) >= NOW);
		check("反向证明：旧判据 `tag === 5` 在当期只命中 1 条（活动侧 nomatch 的原因不是源站没活动）",
			tag5Active.length === 1 && /回音盈域/.test(String(tag5Active[0].tabTitle || "")),
			JSON.stringify(tag5Active.map((x) => x.tabTitle)));

		// ── ② 活动侧：按内容特征收（tag 3 / 5 都收）──
		check("活动侧不再是 nomatch：events 5 条（4 条 tag=3 + 1 条 tag=5），标题与档期逐条",
			Array.isArray(ev.events) && ev.events.length === 5
			&& ev.events.map((x) => x.title).join(" | ") === [
				"[拉海洛方块・逆转]休闲活动",
				"[回音盈域] 养成材料限时双倍活动",
				"[第二索拉：未名之梦] 休闲活动",
				"[先约电台]活动说明",
				"[昔梦赠礼]七日签到活动"
			].join(" | "),
			JSON.stringify((ev.events || []).map((x) => [x.title, x.raw])));
		check("活动数组顺序 = 结束时间升序（12-03 那两条在前，12-22 那三条在后），档期来自 JSON 绝对时间戳",
			ev.events[0].endTs === Date.UTC(2026, 11, 2, 19, 59)   // 12-03 03:59 +08
			&& ev.events[1].endTs === Date.UTC(2026, 11, 2, 19, 59)
			&& ev.events[2].endTs === Date.UTC(2026, 11, 21, 19, 59)   // 12-22 03:59 +08
			&& ev.events[0].startTs === Date.UTC(2026, 10, 18, 3, 0),  // 11-18 11:00 +08
			JSON.stringify(ev.events.map((x) => [x.startTs, x.endTs])));
		check("活动外显仍按**现有在期口径**（档位 → 结束最早 → 起点最早）= [拉海洛方块・逆转]休闲活动 / 11-18 11:00 ~ 12-03 03:59",
			ev.event === "[拉海洛方块・逆转]休闲活动" && ev.eventDates === "11-18 11:00 ~ 12-03 03:59"
			&& ev.eventDatesRaw === "11-18 11:00 ~ 12-03 03:59",
			JSON.stringify([ev.event, ev.eventDates]));
		check("活动悬停逐条出（5 行，名称 + 3 空格 + 档期；与数组同源同序）",
			ev.eventHover === [
				"[拉海洛方块・逆转]休闲活动   11-18 11:00 ~ 12-03 03:59",
				"[回音盈域] 养成材料限时双倍活动   11-25 11:00 ~ 12-03 03:59",
				"[第二索拉：未名之梦] 休闲活动   11-12 04:00 ~ 12-22 03:59",
				"[先约电台]活动说明   11-12 04:00 ~ 12-22 03:59",
				"[昔梦赠礼]七日签到活动   11-12 04:00 ~ 12-22 03:59"
			].join("\n"),
			JSON.stringify(ev.eventHover));
		check("反向证明：公告 / 常驻 / 商城条目都不进活动（【先行体验】功能说明 / 库街区「签到工具」/「心影映花」全新常驻玩法 / [全新服饰]限时特惠 / [商城礼包]限时折扣上架）",
			!ev.events.some((x) => /先行体验|签到工具|心影映花|限时特惠|商城礼包/.test(x.title)),
			JSON.stringify(ev.events.map((x) => x.title)));

		// ── ③ 卡池侧：角色忆旅唤取 进白名单 ──
		check("卡池数组 5 条（主条 `角色活动唤取` + 4 口在期角色池：3 口活动唤取 + 1 口**忆旅唤取**）",
			Array.isArray(g.gacha) && g.gacha.length === 5
			&& g.gacha[0].title === "角色活动唤取"
			&& g.gacha.map((x) => x.title).includes("忆旅回响Ⅱ：椿、洛可可、菲比、布兰特、散华、丹瑾、炽霞"),
			JSON.stringify(g.gacha.map((x) => x.title)));
		check("忆旅池窗口来自源站绝对时间戳（11-12 04:00 ~ 12-22 03:59），不是按活动池窗口硬套",
			g.gacha[4].startTs === Date.UTC(2026, 10, 11, 20, 0) && g.gacha[4].endTs === Date.UTC(2026, 11, 21, 19, 59),
			JSON.stringify([g.gacha[4].startTs, g.gacha[4].endTs]));
		check("卡池悬停 4 池逐行（首行仍是卡池类型；同窗口折叠；忆旅池自带 12-22 档期）",
			g.bannerHover === [
				"角色活动唤取",
				"盛放于昨日梦土的花朵：莉莉、釉瑚、秋水、秧秧",
				"11-12 04:00 ~ 12-03 09:59",
				"符文烁醒之刻：西格莉卡、釉瑚、秋水、秧秧",
				"11-12 04:00 ~ 12-03 09:59",
				"倦客不知身近远：仇远、釉瑚、秋水、秧秧",
				"11-12 04:00 ~ 12-03 09:59",
				"忆旅回响Ⅱ：椿、洛可可、菲比、布兰特、散华、丹瑾、炽霞",
				"11-12 04:00 ~ 12-22 03:59"
			].join("\n"),
			JSON.stringify(g.bannerHover));
		check("角色合并把忆旅池的 5★ 也算进来（莉莉 / 西格莉卡 / 仇远 / 椿 / 洛可可 / 菲比 / 布兰特），4★ 共有名只留一份",
			g.roles === "莉莉、釉瑚、秋水、秧秧、西格莉卡、仇远、椿、洛可可、菲比、布兰特、散华、丹瑾、炽霞",
			JSON.stringify(g.roles));
		check("反向证明：武器侧口径未放宽 —— 武器活动唤取（安魂 / 昭日译注 / 裁竹）与武器忆旅唤取（回响铸忆Ⅱ）都不进数组",
			!g.gacha.some((x) => /安魂|昭日译注|裁竹|回响铸忆Ⅱ/.test(x.title)),
			JSON.stringify(g.gacha.map((x) => x.title)));
	}
}