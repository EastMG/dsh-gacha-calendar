// test/cases-names-a.mjs —— 2026-11-26 用户要求「把过长的显示名缩短」：探头/并列条那一行的短名
//
// ── 现场（2026-11-26 活网审计 `_names-audit.json` + 实测）──────────────────────────────
// 并列条/探头那一行的显示名在数据层被写成 `title`（源站原文），最长 69 字：
//   · fgo/卡池   `Fate/Grand Order「Road to 终章」奏章Ⅱ篇纪念 岩窟王 基督山推荐召唤：岩窟王、基督山、…`（69 字）
//   · hsr/卡池   `「铭心之萃•银狼LV.999」角色活动跃迁：银狼LV.999（欢愉•虚数）`（37 字）
//   · wd/卡池    `予爱未名·夏彦篇：鸥字回时、妄夜之魇、微醺视线、最佳拍档`（28 字）
//   · genshin/卡池 `「呀吼吼博物志」109-2期角色活动祈愿：「博闻异旅·莉奈娅(岩)」`（34 字）
//   · wuwa/卡池  `忆旅回响Ⅱ：椿、洛可可、菲比、布兰特、散华、丹瑾、炽霞`（27 字）
// 共同点：源站**结构化了**短名（`池名：角色` 的冒号后半 / 角色列），只是旧实现没写进条目的 `show`。
//
// ── 口径（硬约束）───────────────────────────────────────────────────────────────
// **超长名不做程序截断**（用户 2026-11-18 明确要求，见 `test/cases-display-name.mjs` 文件头）。
// 所以并列条只显示**有源站证据的短名**：数据层 opt-in `extrasShowFromEntry`（默认关）打开后，
// 并列条 `show` = 条目自己的 show（过与主条同一处 `cleanRoleNames`），`title` 仍是源站原文。
// 悬停文本 / 提醒标题 / 数组 title 一个字不动。
//
// ── 本段守什么 ──
//   ① hsr：官方公告 CMS 夹具（`p4-hsr-cms-1126`，2026-11-26 真抓）⇒ 4 条并列条的 show = 角色名；
//   ② wd：米游社公告夹具（`wd-miyoushe-1126` + 3 篇详情，2026-11-26 真抓）⇒ 2 条并列条 show = 角色列；
//   ③ bh3：内容中台夹具（`bh3-content-event`）⇒ 活动卡片外显取「丨」前那段，数组/悬停原文不动；
//   ④ 每一侧都配「原文不动」的反向断言（title / 悬停 / roles 逐字）。
// fgo / 原神 / 鸣潮 的并列条由 `test/cases-core.mjs`（fgo）与 `test/cases-p3.mjs`（原神 / 鸣潮）
// 的 golden 已批准差异段守住（那份夹具更早、字段更全）。
//
// ⚠️ 本文件**不是** `all.mjs` 的独立段：由 `test/cases-display-name.mjs` 末尾 import 并执行
//    （段数被 README 守卫钉死 —— `test/cases-health.mjs` 顶部注释记录的同一套约定）。
//    所以直接 `node cases-names-a.mjs` 不会跑任何用例（没有入口）。

import { readFileSync } from "node:fs";
import { createEngine } from "../packages/core/core.mjs";
import { T } from "./load.mjs";
import { check, section } from "./harness.mjs";

const TZ_CN = "Asia/Shanghai";
// 夹具抓取时刻（各夹具 meta 里的 capturedAt；用同一时刻才能命中各自的"当期"）
const NOW_HSR = Date.parse("2026-11-26T01:53:00+08:00");   // p4-hsr-cms-1126
const NOW_WD = Date.parse("2026-11-26T01:53:00+08:00");    // wd-miyoushe-1126
const NOW_BH3 = Date.parse("2026-11-11T12:00:00+08:00");   // bh3-content-*（2026-11-11 01:00 抓）

const fx = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");
const makeStore = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } }; };
const engineAt = (transport, now) => createEngine({ transport, storage: makeStore(), now: () => now, timer: { setTimeout, clearTimeout } });
const NO_NET = { async fetchRaw() { throw new Error("本段不联网"); }, async fetchViaProxy() { throw new Error("本段不联网"); } };
const textResp = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) });

/** 并列条（source = hover）的 [title, show] 快照，用于"逐条逐字"断言。 */
const extrasOf = (rec, field) => (rec[field] || []).filter((x) => x.source === "hover").map((x) => [x.title, x.show]);

export default async function runNamesA() {
	// ══════════════════════════════════════════════════════════════════════════
	section("2026-11-26 显示名缩短 A：探头/并列条那一行显示各自短名（hsr / wd / bh3）—— 真夹具");
	{
		// ── ① 星铁：官方公告 CMS 夹具 ⇒ 4 条并列条 show = UP 角色名（去属性后缀）────────
		const hsrPayload = JSON.parse(fx("p4-hsr-cms-1126/response.txt"));
		const hsrEngine = engineAt(NO_NET, NOW_HSR);
		const hsrPay = T.parsers["hsr"].parseHsrWarp(hsrPayload, NOW_HSR, TZ_CN);
		const hsr = hsrEngine.__test.mergeEntryRecord({ data: hsrPay }, null, NOW_HSR, { id: "hsr", tz: TZ_CN });
		const hsrHover = extrasOf(hsr, "gacha");
		check("hsr：并列条 4 条、show 逐条 = UP 角色名（`银狼LV.999` / `火花` / `爻光` / `星神★阿哈`）",
			JSON.stringify(hsrHover.map((x) => x[1])) === JSON.stringify(["银狼LV.999", "火花", "爻光", "星神★阿哈"]),
			JSON.stringify(hsrHover.map((x) => x[1])));
		check("hsr：并列条 title **仍是源站原文**（`「池名」角色活动跃迁：角色（属性）`，一条都不许改）",
			hsrHover.length === 4 && hsrHover.every(([t]) => /^「.+」角色活动跃迁：.+（欢愉•/.test(t) && t.indexOf("（") > 0),
			JSON.stringify(hsrHover.map((x) => x[0])));
		// 反向：悬停文本逐字不变（每条 = 原文标签 + 档期；这里钉前两条 + 行数）
		const hsrHoverLines = String(hsrPay.bannerHover || "").split("\n");
		check("hsr：悬停文本逐字不变（8 行；标签仍是「池名：角色（属性）」原文）",
			hsrHoverLines.length === 8
			&& hsrHoverLines[0] === "「铭心之萃•银狼LV.999」角色活动跃迁：银狼LV.999（欢愉•虚数）"
			&& hsrHoverLines[2] === "「铭心之萃•火花」角色活动跃迁：火花（欢愉•火）",
			JSON.stringify(hsrHoverLines.slice(0, 3)));
		// 反向：主条 / banner / roles 不动（卡片主行仍按"有角色显示角色"）
		check("hsr 反向：banner 仍是源站原文、主条 show 仍是合并后的角色名（并列条改动没有外溢）",
			hsr.banner === "「铭心之萃•银狼LV.999」角色活动跃迁"
			&& hsr.gacha[0].show === "银狼LV.999、火花、爻光、星神★阿哈"
			&& hsr.gacha[0].title === hsrPay.banner,
			JSON.stringify([hsr.banner, hsr.gacha[0].show]));

		// ── ② 未定事件簿：米游社公告夹具 ⇒ 2 条并列条 show = 角色列 ──────────────────
		const wdList = fx("wd-miyoushe-1126/response.txt");
		const wdDetailOf = (postId) => {
			for (const dir of ["wd-miyoushe-detail-1126-" + postId, "wd-miyoushe-detail-" + postId]) {
				try { return fx(dir + "/response.txt"); } catch { /* 没有这份详情 */ }
			}
			return null;
		};
		const wdTransport = {
			async fetchRaw(url) {
				const d = /getPostFull\?post_id=/.test(url) ? wdDetailOf(url.split("post_id=")[1]) : null;
				if (d == null) throw new Error("http-404");
				return textResp(d);
			},
			async fetchViaProxy(url) {
				const d = /getPostFull\?post_id=/.test(url) ? wdDetailOf(url.split("post_id=")[1]) : wdList;
				if (d == null) throw new Error("proxy-bad:404");
				return d;
			}
		};
		const wdEngine = engineAt(wdTransport, NOW_WD);
		const wdPay = await wdEngine.__test.GACHA_FETCHERS["wd"](undefined, undefined, TZ_CN);
		const wdRec = wdEngine.__test.mergeEntryRecord({ data: wdPay }, null, NOW_WD, { id: "wd", tz: TZ_CN });
		const wdHover = extrasOf(wdRec, "gacha");
		check("wd：并列条 2 条、show 逐条 = 该池角色列（`星如晤、…、眸中景` / `鸥字回时、…、最佳拍档`）",
			JSON.stringify(wdHover.map((x) => x[1])) === JSON.stringify([
				"星如晤、冷暖心知、水“逆”、眸中景",
				"鸥字回时、妄夜之魇、微醺视线、最佳拍档"
			]),
			JSON.stringify(wdHover.map((x) => x[1])));
		check("wd：并列条 title 仍是原文，且新 show 是原文「：」之后那段（不是按字数硬砍）",
			wdHover.length === 2
			&& wdHover.every(([t, s]) => t.endsWith("\uFF1A" + s) && s !== t),
			JSON.stringify(wdHover));
		check("wd：悬停文本逐字不变（3 行标签 + 3 行档期；标签仍是「池名：角色列」原文）",
			String(wdPay.bannerHover || "") === [
				"四季如夏：微醺视线、最佳拍档", "11-24 11:00 ~ 11-27 04:00",
				"轮替女神之影：星如晤、冷暖心知、水“逆”、眸中景", "11-13 11:00 ~ 11-27 11:00",
				"予爱未名·夏彦篇：鸥字回时、妄夜之魇、微醺视线、最佳拍档", "11-27 11:00 ~ 12-02 04:00"
			].join("\n"),
			JSON.stringify(wdPay.bannerHover));
		check("wd 反向：banner / roles / 主条 show 都不动（并列条改动没有外溢）",
			wdRec.banner === "四季如夏" && wdRec.roles === "微醺视线、最佳拍档"
			&& wdRec.gacha[0].show === "微醺视线、最佳拍档" && wdRec.gacha[0].title === "四季如夏",
			JSON.stringify([wdRec.banner, wdRec.roles, wdRec.gacha[0].show]));

		// ── ③ 崩坏3：内容中台夹具 ⇒ 活动卡片外显取「丨」前那段；数组/悬停原文不动 ────
		const bh3EventBody = fx("bh3-content-event/response.txt");
		const bh3Transport = { async fetchRaw() { throw new Error("no"); }, async fetchViaProxy() { return bh3EventBody; } };
		const bh3Engine = engineAt(bh3Transport, NOW_BH3);
		const bh3Pay = await bh3Engine.__test.EVENT_FETCHERS["bh3"].default(undefined, undefined, TZ_CN);
		const bh3Rec = bh3Engine.__test.mergeEntryRecord({ data: bh3Pay }, null, NOW_BH3, { id: "bh3", tz: TZ_CN });
		check("bh3：活动卡片外显 = 源站原文「丨」前那段（`双核协战丨参与活动获取活动勋章、水晶等奖励！` ⇒ `双核协战`）",
			bh3Pay.event === "双核协战丨参与活动获取活动勋章、水晶等奖励！" && bh3Rec.event === "双核协战",
			JSON.stringify([bh3Pay.event, bh3Rec.event]));
		check("bh3：数组主条 title / show **仍是源站原文**（「丨」与奖励说明原样留着）",
			(bh3Rec.events || []).some((x) => x.source === "primary"
				&& x.title === "双核协战丨参与活动获取活动勋章、水晶等奖励！"
				&& x.show === "双核协战丨参与活动获取活动勋章、水晶等奖励！"),
			JSON.stringify((bh3Rec.events || []).filter((x) => x.source === "primary").map((x) => [x.title, x.show])));
		check("bh3：悬停 10 行逐字不变（首行仍是「丨…奖励！」原文，外显改动没有写回悬停）",
			String(bh3Pay.eventHover || "").split("\n").length === 10
			&& String(bh3Pay.eventHover || "").indexOf("双核协战丨参与活动获取活动勋章、水晶等奖励！   11-05 10:00 ~ 11-26 04:00") >= 0,
			JSON.stringify(String(bh3Pay.eventHover || "").split("\n").slice(0, 2)));
		// 反向：同一款游戏的**卡池侧**不受影响（`协同补给丨协同者「薇塔」开放获取` 的「丨」后是内容）
		const bh3GachaBody = fx("bh3-content-gacha/response.txt");
		const bh3GachaEngine = engineAt({ async fetchRaw() { throw new Error("no"); }, async fetchViaProxy() { return bh3GachaBody; } }, NOW_BH3);
		const bh3GPay = await bh3GachaEngine.__test.GACHA_FETCHERS["bh3"](undefined, undefined, TZ_CN);
		const bh3GRec = bh3GachaEngine.__test.mergeEntryRecord({ data: bh3GPay }, null, NOW_BH3, { id: "bh3", tz: TZ_CN });
		check("bh3 反向：卡池侧「丨」后面是**内容**（不是奖励说明）⇒ banner 逐字不变（规则只碰活动侧）",
			!!bh3GPay && /丨/.test(bh3GPay.banner) && bh3GRec.banner === bh3GPay.banner
			&& !/丨/.test(bh3Rec.event),
			JSON.stringify([bh3GPay && bh3GPay.banner, bh3GRec.banner, bh3Rec.event]));
	}
}