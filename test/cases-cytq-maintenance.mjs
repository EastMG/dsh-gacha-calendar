// test/cases-cytq-maintenance.mjs —— 炽焰天穹：「维护后」起点的在期活动被当"未开始"整条丢（活网审计 A）
//
// ── 现场（`_audit-A-raw/cytq.*.txt`，2026-11-26 01:45 +08 抓的官网 H5 公告）──
// 源站大量活动把起点写成 `2026/11/18 维护后`（审计原始响应里出现 **42 次**）。`ns_cytq_windowOf`
// 按用户口径**不猜钟点** ⇒ `startTs = null`；随后 `ns_bwiki_eventPayload` → `ns_bwiki_activeItems`
// 用的是 `coversNow`（要求两端都有）⇒ 这些条目**连悬停/数组都进不去**：活动侧只剩 3 条（审计判缺 8 条）。
// 函数头注释本来就写着"起点未知按已开始、只用于悬停/数组"（对应 `coveredOrOpen`），与实现矛盾。
//
// ── 修法（局部修复，不动共用函数的默认语义）──
// `ns_bwiki_eventPayload` 新增**可选第 6 参** `{ includeOpenStart }`（默认 off）：
//   · 悬停 / `events[]` 候选 = `coveredOrOpen`（起点未知、终点未过 ⇒ 列出来）；
//   · 外显（`event` / `eventDates`）仍只取**两端明确且覆盖 now** 的那条（不猜起点、不拿未来期）。
// 只有 `ns_cytq_events` 传 `true`；其余 9 个 bwiki 源的调用点一个都没改（静态守卫见 ⑤）。
// 数组侧再把解析器已知的 `endTs` 补回这些条目（`startTs` 仍 null），使它排得进结束时间序。
//
// ── 本段守什么（夹具 = 既有的 `cytq-*` 真抓，2026-11-15 快照）──
//   ① 这份夹具的活动帖里恰好 10 条有窗口：4 条两端明确在期、4 条「维护后」起点、2 条开放终点；
//   ② 端到端：`events[]` 4 ⇒ 8 条，新增 4 条 startTs=null / endTs=12-02 12:59，key 重排后仍连续；
//   ③ 外显**没有变**（仍是两端明确里档位 → 结束最早那条）⇒ "外显不拿起点未知 / 未来期" 的口径保住；
//   ④ 反向证明：旧判据 `coversNow` 在这份夹具上只收 4 条、`coveredOrOpen` 收 8 条，差集 == 那 4 条
//      「维护后」条目；开放终点（`2026/8/12 维护后 ~`，没有终点）两条**仍然不进**（画不出来的行不硬凑）；
//   ⑤ 只剩起点未知的条目时（now = 2026-11-26）⇒ 两侧 `nomatch`，不编一个外显出来（保留"外显不拿未来期"）；
//   ⑥ 静态守卫：`includeOpenStart` 只在共用生成器 + cytq 两处出现（局部修复，不是全局放宽）。

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody } from "./harness.mjs";
import { T, REPO } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const CY = T.parsers.cytq;
const LIST = CY.CYTQ_LIST_URL;
// 2026-11-15 13:50 +08（= cases-new5 的夹具抓取时刻）：4 条两端明确的在期活动
const NOW_LIVE = Date.parse("2026-11-15T13:50:00+08:00");
// 2026-11-26 12:00 +08（= 审计采集日）：夹具里两端明确的都已结束，只剩「维护后」起点那 4 条未过终点
const NOW_AUDIT = Date.parse("2026-11-26T12:00:00+08:00");
// 夹具里「维护后」起点、终点未过的 4 条（标题 + 原文档期；= 审计里"被当未开始整条丢"的那类）
const OPEN_START = [
	["感谢庆典特别活动一览！", "2026/10/28 维护后 ~ 2026/12/2 12:59"],
	["感谢庆典兑换所举办中！", "2026/10/28 维护后 ~ 2026/12/2 12:59"],
	["必得至少免费100连！感谢庆典每日登录活动举办中！", "2026/10/28 维护后 ~ 2026/12/2 12:59"],
	["恒星扫荡战线#12 统御苍穹的骸翼 开启！", "2026/10/8 维护后 ~ 2026/12/2 12:59"]
];
const OPEN_END = ["异时层EX 第一章登场！通关可获得灵魂共鸣核心！", "邀请好友活动 第6期举办中！"];

const ALL_IDS = T.SOURCES.map((x) => x.id);
// transport：夹具按 map.json 查；**代理一律抛**（cytq 有 ACAO: * ⇒ 直连，摸到代理就是接线错了）
const transport = () => ({
	async fetchRaw(u) {
		const body = fixtureBody(String(u));
		return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
	},
	async fetchViaProxy(u) { throw new Error("cytq 不应走代理：" + u); }
});
const makeStore = () => {
	const m = new Map([["hidden", ALL_IDS.filter((id) => id !== "cytq")], ["shown", ["cytq"]]]);
	return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
const refreshAt = async (now) => {
	CY.cytqResetDetailCache();
	const e = createEngine({ transport: transport(), storage: makeStore(), now: () => now, timer: { setTimeout, clearTimeout } });
	const r = await e.refresh();
	return r.games.cytq || {};
};
// 从**同一批夹具**直接算条目事实（反证用；不经引擎，免得"用实现证明实现"）
const detailPosts = () => {
	const list = CY.cytqListOf(fixtureBody(LIST));
	return list
		.filter((x) => CY.CYTQ_SIDE_BY_CLASS[x.categoryClass])
		.map((x) => Object.assign(
			{ id: x.id, side: CY.CYTQ_SIDE_BY_CLASS[x.categoryClass] },
			CY.cytqDetailOf(fixtureBody(CY.cytqDetailUrlOf(x.id)), TZ_CN)
		));
};

export default async function runCytqMaintenance() {
	section("2026-11-26 炽焰天穹（活网审计 A）：「维护后」起点的在期活动被 coversNow 整条丢 —— 局部修复");
	{
		// ── ① 夹具事实：10 条有窗口的活动帖，4/4/2 三档 ──
		const posts = detailPosts().filter((p) => p.side === "event" && p.win);
		const isOpenStart = (p) => p.win.startTs == null && p.win.endTs != null && p.win.endTs >= NOW_LIVE;
		const isCovered = (p) => p.win.startTs != null && p.win.endTs != null && p.win.startTs <= NOW_LIVE && p.win.endTs >= NOW_LIVE;
		const isOpenEnd = (p) => p.win.endTs == null;
		check("夹具事实：活动帖 10 条有窗口 = 4 条两端明确在期 + 4 条「维护后」起点 + 2 条开放终点（没有终点）",
			posts.length === 10
			&& posts.filter(isCovered).length === 4
			&& posts.filter(isOpenStart).length === 4
			&& posts.filter(isOpenEnd).length === 2,
			JSON.stringify({ all: posts.length, covered: posts.filter(isCovered).length, openStart: posts.filter(isOpenStart).length, openEnd: posts.filter(isOpenEnd).length }));
		check("那 4 条「维护后」起点的标题逐字 = 审计里被整条丢掉的那类（庆典一览 / 兑换所 / 每日登录 / 恒星扫荡#12）",
			JSON.stringify(posts.filter(isOpenStart).map((p) => [p.title, p.win.raw]).sort())
			=== JSON.stringify(OPEN_START.slice().sort()));

		// ── ② 端到端：activities 4 ⇒ 8 条，新增的起点仍 null（不猜钟点），终点用解析器事实补齐 ──
		const rec = await refreshAt(NOW_LIVE);
		check("活动侧 `events[]` 4 ⇒ 8 条（局部开关生效）：新增 4 条 = 「维护后」起点条目，startTs=null / endTs=12-02 12:59（+08 手算）",
			Array.isArray(rec.events) && rec.events.length === 8
			&& OPEN_START.every(([title]) => rec.events.some((x) => x.title === title && x.startTs === null && x.endTs === Date.UTC(2026, 11, 2, 4, 59))),
			JSON.stringify((rec.events || []).map((x) => [x.title, x.startTs, x.endTs])));
		check("数组 key 重排后仍连续（`cytq:event:0..7`，顺序 = 结束时间升序 → 起点升序；起点未知排在同结束的后面）",
			rec.events.map((x) => x.key).join(",") === ["0", "1", "2", "3", "4", "5", "6", "7"].map((i) => "cytq:event:" + i).join(",")
			&& rec.events[4].startTs === null && rec.events[7].startTs === null,
			JSON.stringify(rec.events.map((x) => [x.key, x.startTs])));
		check("活动悬停 8 行：新增那 4 行的档期 = **源站原文**（「维护后」原样保留，不编钟点）",
			String(rec.eventHover).split("\n").length === 8
			&& OPEN_START.every(([t, w]) => String(rec.eventHover).includes(`${t}   ${w}`)),
			JSON.stringify(rec.eventHover));

		// ── ③ 外显口径不变：仍只取两端明确且在期的那条 ──
		check("外显没有变（放宽只碰悬停/数组）：仍是「剧情活动批量精选开放中！」/ 10-21 11:00 ~ 11-18 12:59，且它不在「维护后」那 4 条里",
			rec.event === "剧情活动批量精选开放中！" && rec.eventDates === "10-21 11:00 ~ 11-18 12:59"
			&& !OPEN_START.some(([t]) => t === rec.event),
			JSON.stringify([rec.event, rec.eventDates]));

		// ── ④ 反向证明：差集 == 「维护后」条目；开放终点两条仍不进（画不出来的行不硬凑）──
		const inWindow = (p) => T.coveredOrOpen({ startTs: p.win.startTs, endTs: p.win.endTs }, NOW_LIVE);
		check("反向证明：旧判据（两端都明确）只收 4 条、`coveredOrOpen` 收 8 条 ⇒ 旧实现确实把这 4 条整条丢了",
			posts.filter(isCovered).length === 4 && posts.filter(inWindow).length === 8
			&& posts.filter(inWindow).every((p) => isCovered(p) || OPEN_START.some(([t]) => t === p.title)),
			JSON.stringify({ covered: posts.filter(isCovered).length, coveredOrOpen: posts.filter(inWindow).length }));
		check("开放终点（`2026/8/12 维护后 ~` 这类没有结束时刻的）仍然不进数组/悬停",
			OPEN_END.every((t) => !rec.events.some((x) => x.title === t) && !String(rec.eventHover).includes(t)),
			JSON.stringify(rec.events.map((x) => x.title)));

		// ── ⑤ 只剩起点未知的条目 ⇒ nomatch（外显不拿起点未知 / 未来期）──
		const recAudit = await refreshAt(NOW_AUDIT);
		check("保留「外显不拿起点未知」：now = 2026-11-26（夹具里两端明确的都已结束）⇒ 活动侧 nomatch，不编一个外显出来",
			String(recAudit.eventFail && recAudit.eventFail.kind) === "nomatch" && !recAudit.event,
			JSON.stringify([recAudit.event, recAudit.eventFail]));
		// 卡池侧不受开关影响（同一轮里 banner / gacha 与 cases-new5 的 golden 一致）
		check("卡池侧不受影响（同一轮）：外显 Autumn特别精选扭蛋 / 11-04 11:00 ~ 11-18 12:59 / gacha 4 条",
			rec.banner === "Autumn特别精选扭蛋" && rec.bannerDates === "11-04 11:00 ~ 11-18 12:59"
			&& (rec.gacha || []).length === 4,
			JSON.stringify([rec.banner, rec.bannerDates, (rec.gacha || []).length]));

		// 2026-11-27：蓝色星原（promilia）也显式开 includeOpenStart（它没有"版本更新后"能锚的绝对起点，
	// 起点未知的活动只进悬停/数组、不进外显）⇒ 名单加一条，仍然**不是**全局放宽。
	// ── ⑦ 2026-11-26（B2：探头/并列条那一行过长）：并列条 show = 池名 ──────────────
		// 并列条条目的 `title` 是 `池名：角色`（共享载荷 label 的写法，实测最长 36 字）；
		// 探头/并列条那一行读的是 `show` ⇒ 这里落**池名**（源站帖子 h2 标题，剥「举办中！」这类
		// 体裁尾巴）。`title` / `raw` / 悬停仍是源站原文（悬停下面那条就是反向证明）。
		{
			const ga = rec.gacha || [];
			check("cytq 并列条 show = 池名（3 条逐字；title 仍是 `池名：角色` 源站原文）",
				ga.length === 4
				&& ga[1].show === "感谢庆典纪念 SS1.5倍扭蛋" && ga[1].title === "感谢庆典纪念 SS1.5倍扭蛋举办中！"
				&& ga[2].show === "SS小笠原绯雨登场！精选白金扭蛋" && ga[2].title === "SS小笠原绯雨登场！精选白金扭蛋：小笠原绯雨、月城最中"
				&& ga[3].show === "【仅限付费晶石】感谢庆典必得SS扭蛋" && ga[3].title === "【仅限付费晶石】感谢庆典必得SS扭蛋举办中！：小笠原绯雨、月城最中",
				JSON.stringify(ga.map((x) => [x.title, x.show])));
			check("cytq 并列条短名只落在 show：source / raw / ts 与改动前逐字一致（主条 show 仍是角色名）",
				ga.map((x) => x.source).join(",") === "primary,hover,hover,hover"
				&& ga[0].show === rec.roles
				&& ga[1].raw === "11-11 11:00 ~ 11-25 10:59" && ga[1].startTs === Date.UTC(2026, 10, 11, 3, 0)
				&& ga[2].raw === "2026/10/28 维护后 ~ 2026/11/18 12:59" && ga[2].startTs === null && ga[2].endTs === null
				&& ga[3].raw === "2026/10/28 维护后 ~ 2026/11/18 12:59" && ga[3].startTs === null && ga[3].endTs === null,
				JSON.stringify(ga.map((x) => [x.source, x.raw, x.startTs, x.endTs, x.show])));
			check("cytq 反向证明：悬停逐字仍是 `池名：角色` 原文（短名只进数组的 show，不改悬停）",
				String(rec.bannerHover).indexOf("感谢庆典纪念 SS1.5倍扭蛋举办中！") >= 0
				&& String(rec.bannerHover).indexOf("SS小笠原绯雨登场！精选白金扭蛋：小笠原绯雨、月城最中") >= 0
				&& String(rec.bannerHover).indexOf("【仅限付费晶石】感谢庆典必得SS扭蛋举办中！：小笠原绯雨、月城最中") >= 0,
				JSON.stringify(rec.bannerHover));
		}

		// ── ⑥ 静态守卫：这是**局部**修复，共用函数默认语义没被放宽 ──
		const srcDir = path.join(REPO, "src", "client");
		const files = readdirSync(srcDir).filter((f) => f.endsWith(".js"));
		const hits = [];
		for (const f of files) {
			const text = readFileSync(path.join(srcDir, f), "utf8");
			if (text.includes("includeOpenStart")) hits.push(f);
		}
		const callers = files.filter((f) => {
			const text = readFileSync(path.join(srcDir, f), "utf8");
			return /ns_bwiki_eventPayload\([^)]*includeOpenStart/.test(text);
		});
		check("静态守卫：`includeOpenStart` 只出现在「共用生成器 + cytq 调用点」——其余 9 个 bwiki 源仍走严格 `coversNow`（局部修复，不是全局放宽）",
			JSON.stringify(hits.sort()) === JSON.stringify(["30-game-bwiki-common.js", "30-game-manjuu.js", "30-game-wfskey.js"])
			&& JSON.stringify(callers) === JSON.stringify(["30-game-manjuu.js", "30-game-wfskey.js"]),
			JSON.stringify({ hits, callers }));
	}
}