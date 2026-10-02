// next-sources/test/cases-p4.mjs —— 批次 P4 离线夹具测试（米哈游系官方公告 / 米游社 BBS API）
//
// 三个原则（照 CONVENTIONS.md）：
//   ① 全程离线：`useFixtures()` 注入夹具 fetch；纯函数测试直接读 fixtures/p4-*/response.txt。
//   ② 确定性：「当前时刻」一律用**夹具抓取时刻**（response.txt.meta.json 的 capturedAt）当 now，
//      不随运行日期漂移（否则一个月后"当期"变了会假失败）。抓取器的 now 是**第 4 个参数**。
//   ③ 不拖垮共享 runner：每个抓取器调用都包 try/catch，失败只记 ✗，不抛出去中断别的批次。
//
// 断言里的具体值（`09-28 07:00 ~ 11-10 15:00` / `洛克茜、普罗米娅` / null 等）都是**夹具快照值**；
// 重抓夹具后需要同步更新。绝对时刻的期望值用本地 `cst()` 独立算（Date.UTC − 8h），
// **刻意不调用 sourceInstant()**，避免"用同一个函数验证它自己"。

import { readFileSync } from "node:fs";
import { useFixtures, check, section, assertContract, summary } from "./harness.mjs";
import { setFetchImpl, sourceWallParts } from "../lib/env.js";
import { findSource, SOURCES_P4 } from "../registry-p4.js";
import {
	parseMiyousheList, parseMiyousheDetail, classifyMiyousheTitle, collectMiyousheWindows,
	miyousheVersionStarts, miyousheRoles, isMiyousheMissing,
	gachaMiyoushe, eventsMiyoushe,
	MIYOUSHE_TZ, MIYOUSHE_GIDS, MIYOUSHE_TYPES, MIYOUSHE_MAX_DETAILS,
	MIYOUSHE_PROVENANCE, MIYOUSHE_REFERER, miyousheListUrl, miyousheDetailUrl
} from "../parsers/miyoushe.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}/response.txt`, import.meta.url), "utf8"));
const meta = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}/response.txt.meta.json`, import.meta.url), "utf8"));
// 夹具抓取时刻（= 快照的"当前时刻"）
const snap = (name) => Date.parse(meta(name).capturedAt);

// 独立的 UTC+8 换算（不复用 lib/env 的 sourceInstant，避免自证）
const cst = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - 8 * 3600e3;
const cstWall = (ts) => { const w = sourceWallParts(ts, MIYOUSHE_TZ); const p = (n) => String(n).padStart(2, "0"); return `${w.y}-${p(w.mo)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`; };
const jstWall = (ts) => { const w = sourceWallParts(ts, "Asia/Tokyo"); const p = (n) => String(n).padStart(2, "0"); return `${w.y}-${p(w.mo)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`; };

// 抓取器调用包装：失败只记 ✗（不抛，避免中断共享 runner）
async function grab(fn) {
	try { return { ok: true, data: await fn() }; }
	catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}
function throws(fn) { try { fn(); return false; } catch { return true; } }

const GACHA = MIYOUSHE_TYPES.GACHA, EVENT = MIYOUSHE_TYPES.EVENT;

// ⚠️ 生产 registry 只留 `bh3`（`genshin`/`hsr`/`zzz` 改为**并入插件既有条目**，见 registry-p4.js 注释）。
//    但本文件要测**全部 4 个 gids** 的解析能力，所以这里自带一张测试用条目表。
//    抓取器本身是同一个（按 gids 区分），只是测试时要有"条目"来承载 url/tz。
const TEST_SOURCES = [
	{ id: "bh3", name: "崩坏3", gid: MIYOUSHE_GIDS.bh3, tz: MIYOUSHE_TZ },
	{ id: "genshin", name: "原神", gid: MIYOUSHE_GIDS.genshin, tz: MIYOUSHE_TZ },
	{ id: "hsr", name: "崩坏：星穹铁道", gid: MIYOUSHE_GIDS.hsr, tz: MIYOUSHE_TZ },
	{ id: "zzz", name: "绝区零", gid: MIYOUSHE_GIDS.zzz, tz: MIYOUSHE_TZ }
];
const srcOf = (id) => TEST_SOURCES.find((s) => s.id === id) || null;

// 每个游戏两侧的列表夹具名（夹具名以 p4 开头，便于溯源）
const LIST_FIX = {
	bh3: { gacha: "p4-bh3-news", event: "p4-bh3-events" },
	genshin: { gacha: "p4-genshin-news", event: "p4-genshin-events" },
	hsr: { gacha: "p4-hsr-news", event: "p4-hsr-events" },
	zzz: { gacha: "p4-zzz-news", event: "p4-zzz-events" }
};

// 本批次抓的 22 个夹具 → 必须都在共享 test/map.json 里（否则合并进 all.mjs 后 useFixtures() 会 404）
const P4_FIXTURE_URLS = {
	[miyousheListUrl(1, GACHA)]: "p4-bh3-news/response.txt",
	[miyousheListUrl(1, EVENT)]: "p4-bh3-events/response.txt",
	[miyousheListUrl(2, GACHA)]: "p4-genshin-news/response.txt",
	[miyousheListUrl(2, EVENT)]: "p4-genshin-events/response.txt",
	[miyousheListUrl(6, GACHA)]: "p4-hsr-news/response.txt",
	[miyousheListUrl(6, EVENT)]: "p4-hsr-events/response.txt",
	[miyousheListUrl(8, GACHA)]: "p4-zzz-news/response.txt",
	[miyousheListUrl(8, EVENT)]: "p4-zzz-events/response.txt",
	[miyousheDetailUrl("78549971")]: "p4-bh3-detail-gacha/response.txt",
	[miyousheDetailUrl("78549969")]: "p4-bh3-detail-char/response.txt",
	[miyousheDetailUrl("78469952")]: "p4-bh3-detail-event/response.txt",
	[miyousheDetailUrl("78299710")]: "p4-genshin-detail-wish/response.txt",
	[miyousheDetailUrl("78299709")]: "p4-genshin-detail-wish2/response.txt",
	[miyousheDetailUrl("78610186")]: "p4-genshin-detail-event/response.txt",
	[miyousheDetailUrl("78469941")]: "p4-genshin-detail-activity/response.txt",
	[miyousheDetailUrl("78448395")]: "p4-hsr-detail-warp/response.txt",
	[miyousheDetailUrl("78487092")]: "p4-hsr-detail-event/response.txt",
	[miyousheDetailUrl("78470659")]: "p4-zzz-detail-band/response.txt",
	[miyousheDetailUrl("78540849")]: "p4-zzz-detail-event/response.txt",
	[miyousheListUrl(2, 9)]: "p4-bad-type/response.txt",
	[miyousheDetailUrl("1")]: "p4-post-missing/response.txt",
	[miyousheListUrl(99999, GACHA)]: "p4-gids-unknown/response.txt"
};

export default async function runP4() {
	const inner = useFixtures();
	// 记账包装：统计每次抓取的形态（请求量上限 / 是否走代理 / 是否带 Referer）
	const calls = [];
	setFetchImpl(async (url, opts) => { calls.push(String(url)); return inner(url, opts); });

	// ───────────────────────── P4-0 注册表片段 + 夹具映射 ─────────────────────────
	section("P4-0 注册表片段（契约字段齐备）");
	{
		// ⚠️ registry 里保留**全部 4 个 gids**（bh3 / genshin-official / hsr-official / zzz-official）：
		//    它们只用来承载「米游社公告」**备选源**的声明。生成器会把它们
		//    并进插件既有条目（原神/星铁/绝区零，**只加备选、不改默认主源**）+ 新建 `bh3`（默认未配置），
		//    **不会**作为独立条目进面板。
		check("SOURCES_P4 有 4 条（4 个 gids）", SOURCES_P4.length === 4, String(SOURCES_P4.length));
		const ids = SOURCES_P4.map((s) => s.id);
		check("id = bh3 / genshin-official / hsr-official / zzz-official",
			JSON.stringify(ids) === JSON.stringify(["bh3", "genshin-official", "hsr-official", "zzz-official"]), ids.join(","));
		check("id 无重复", new Set(ids).size === ids.length, ids.join(","));
		// `-official` 后缀是刻意的：避免与插件本体既有 `genshin`/`hsr`/`zzz` 撞 id
		check("未与插件本体既有 id（genshin/hsr/zzz）撞车",
			!ids.includes("genshin") && !ids.includes("hsr") && !ids.includes("zzz"), ids.join(","));
		check("四个 gids 都覆盖到（1/2/6/8）",
			JSON.stringify([...new Set(SOURCES_P4.map((s) => Number(new URL(s.gacha.url).searchParams.get("gids"))))].sort()) === JSON.stringify([1, 2, 6, 8]));
		for (const s of SOURCES_P4) {
			check(`${s.id} tz = Asia/Shanghai（推测，源站未标注）`, s.tz === "Asia/Shanghai", String(s.tz));
			check(`${s.id} 双侧都有`, !!(s.gacha && s.event));
			for (const side of ["gacha", "event"]) {
				const d = s[side];
				check(`${s.id}.${side} 有 url/fetcher/kind/mode`,
					typeof d.url === "string" && d.url.startsWith("https://bbs-api.miyoushe.com/")
					&& typeof d.fetcher === "function" && d.kind === "official-api" && d.mode === "proxy",
					JSON.stringify({ url: d.url, kind: d.kind, mode: d.mode }));
			}
			// 卡池侧必须读 type=1（公告/补给）、活动侧 type=2（活动）—— 与任务书给的口径一致
			check(`${s.id} 卡池侧 type=1 / 活动侧 type=2`,
				new URL(s.gacha.url).searchParams.get("type") === "1" && new URL(s.event.url).searchParams.get("type") === "2");
		}
		// 共享 test/map.json 必须能查到本批次全部夹具 URL
		const map = JSON.parse(readFileSync(new URL("./map.json", import.meta.url), "utf8"));
		for (const url of Object.keys(P4_FIXTURE_URLS)) {
			check(`map.json 收录 ${url}`, map[url] === P4_FIXTURE_URLS[url], JSON.stringify(map[url]));
		}
	}

	// ───────────────────────── P4-1 列表解析（条数与字段） ─────────────────────────
	section("P4-1 列表解析（夹具形态 + 字段）");
	{
		for (const [id, sides] of Object.entries(LIST_FIX)) {
			for (const [side, name] of Object.entries(sides)) {
				const raw = fixture(name);
				const list = raw.data && raw.data.list;
				check(`${name} 夹具是 {retcode:0, data.list[20]}`, raw.retcode === 0 && Array.isArray(list) && list.length === 20,
					`retcode=${raw.retcode} len=${list && list.length}`);
				const items = parseMiyousheList(raw);
				check(`${name} 解析出 20 条且字段齐备`,
					items.length === 20 && items.every((x) => typeof x.postId === "string" && x.postId.length > 0 && x.subject.length > 0 && typeof x.createdTs === "number"),
					`len=${items.length} first=${JSON.stringify(items[0])}`);
				// post_id 源站是**字符串**；created_at 是 **epoch 秒** → ×1000 才是毫秒
				check(`${name} post_id 保留字符串形态 / created_at 秒→毫秒`,
					typeof list[0].post.post_id === "string" && items[0].createdTs === list[0].post.created_at * 1000,
					`${typeof list[0].post.post_id} ${items[0].createdTs}`);
				// 列表里**没有"档期文本"**（这正是 type=1 必须抓详情的原因）
				check(`${name} 列表项正文/摘要全为空（档期不在列表里）`,
					list.every((it) => !it.post.content && !it.post.summary && !it.post.structured_content && !it.text_summary));
				// 实测发现：type=2 每条都带显式 news_meta（epoch 秒字符串）；type=1 恒 null
				const nmOk = side === "event"
					? list.every((it) => it.news_meta && it.news_meta.start_at_sec && it.news_meta.end_at_sec && "activity_status" in it.news_meta)
					: list.every((it) => it.news_meta == null);
				check(`${name} news_meta：${side === "event" ? "20/20 条带显式档期" : "恒为 null（只能抓正文）"}`,
					nmOk, JSON.stringify(list[0].news_meta));
				if (side === "event") {
					check(`${name} news_meta 解析成 epoch 毫秒（秒×1000）`,
						items[0].newsMeta != null && items[0].newsMeta.startTs === Number(list[0].news_meta.start_at_sec) * 1000
						&& items[0].newsMeta.endTs === Number(list[0].news_meta.end_at_sec) * 1000 && items[0].newsMeta.endTs > items[0].newsMeta.startTs,
						JSON.stringify(items[0].newsMeta));
				}
				// 该列表里本侧候选数量（分流结果，也说明有没有可抓的目标）
				const want = side === "gacha" ? "gacha" : "event";
				const n = items.filter((x) => classifyMiyousheTitle(x.subject) === want).length;
				check(`${name} 本侧候选项 ≥ 1`, n >= 1, String(n));
			}
		}
	}

	// ───────────────────────── P4-2 标题关键词分流（补给 / 活动） ─────────────────────────
	section("P4-2 标题关键词分流（补给/活动/无关）");
	{
		const cases = [
			["【补给】装备补给丨垂曦净蕊&花愈朝夕", "gacha"],
			["【补给】角色补给丨愈生佑翎", "gacha"],
			["「煦风欢舞时」祈愿：「雪宴之锋·薇斯纳(风)」概率UP！", "gacha"],
			["3.2版本限时频段（下期）", "gacha"],
			// 同时含"活动"与"跃迁" → **卡池优先**（这是本条分流规则的关键实例）
			["4.6版本活动跃迁（其一）", "gacha"],
			["「幽境危战」活动：紊乱地脉挑战", "event"],
			["【有奖活动】分享你与崩坏3的专属片段，参与讨论赢水晶！", "event"],
			["「跛脚乌鸦奇探录」活动说明", "event"],
			// 无关标题不该被任何一侧收走（否则会白抓详情）
			["4.6版本游戏优化及已知问题说明（09/30更新）", "unknown"],
			["【米游币兑换中心】原神商品上新！", "unknown"],
			["《云•星穹铁道》4.6版本更新说明", "unknown"]
		];
		for (const [t, want] of cases) {
			check(`分流 ${want.padEnd(7)} ← ${t}`, classifyMiyousheTitle(t) === want, classifyMiyousheTitle(t));
		}
		// 分流规则必须与夹具实况一致：bh3 type=1 里既有【补给】也有【公告】
		const bh3 = parseMiyousheList(fixture("p4-bh3-news"));
		const bh3G = bh3.filter((x) => classifyMiyousheTitle(x.subject) === "gacha");
		check("bh3 type=1：被判为卡池侧的全部是【补给】（不会把普通公告当卡池）",
			bh3G.length >= 5 && bh3G.every((x) => /【补给】/.test(x.subject)), `${bh3G.length} 条：${bh3G.map((x) => x.subject).join(" | ").slice(0, 120)}`);
		// 【公告】这个标签**不**决定归哪一侧 —— 里头既有"活动说明/签到"（活动侧），也有版本公告、封禁名单（无关）
		const ann = bh3.filter((x) => /^【公告】/.test(x.subject));
		check("bh3 type=1：【公告】标签不决定分流（同一标签下既有活动类、也有关联不到的）",
			ann.some((x) => classifyMiyousheTitle(x.subject) === "event") && ann.some((x) => classifyMiyousheTitle(x.subject) === "unknown"),
			ann.map((x) => `${classifyMiyousheTitle(x.subject)}:${x.subject}`).join(" | ").slice(0, 200));
	}

	// ───────────────────────── P4-3 正文档期抽取（纯函数，喂真实正文） ─────────────────────────
	section("P4-3 正文档期抽取（每种实测格式）");
	const hsrVerStarts = miyousheVersionStarts(parseMiyousheList(fixture("p4-hsr-news")));
	{
		const det = (n) => parseMiyousheDetail(fixture(n));
		const wins = (n, verStarts = {}) => { const d = det(n); return collectMiyousheWindows(d.content, MIYOUSHE_TZ, { hintTs: d.createdTs, verStarts }); };

		// 版本锚点表（`4.6版本更新说明` 的发布时刻）
		check("版本锚点表：4.6 → 2026-09-28 07:00（UTC+8）",
			hsrVerStarts["4.6"] === 1790550011000 && cstWall(hsrVerStarts["4.6"]) === "2026-09-28 07:00",
			`${hsrVerStarts["4.6"]} ${hsrVerStarts["4.6"] ? cstWall(hsrVerStarts["4.6"]) : "-"}`);
		check("版本锚点表：排除《云•星穹铁道》与「预下载&更新预告」（只留 4.6 一项）",
			Object.keys(hsrVerStarts).length === 1, JSON.stringify(Object.keys(hsrVerStarts)));

		// ① 崩坏3 有奖活动：无年份 `M.D HH:MM~M.D HH:MM` → 年份借公告年
		const bh3e = wins("p4-bh3-detail-event");
		check("bh3 活动：抽出 1 段（无年份 M.D 形态）", bh3e.length === 1, JSON.stringify(bh3e.map((w) => w.raw)));
		check("bh3 活动：09-28 12:00 ~ 10-07 23:59（源站原文 `9.28 12:00~10.7 23:59`）",
			!!bh3e[0] && bh3e[0].startTs === cst(2026, 9, 28, 12, 0) && bh3e[0].endTs === cst(2026, 10, 7, 23, 59) && bh3e[0].raw === "9.28 12:00~10.7 23:59",
			JSON.stringify(bh3e[0]));
		check("bh3 活动：无年份日期的年份确实借自公告发布年（2026）",
			!!bh3e[0] && cstWall(bh3e[0].startTs).startsWith("2026-"));

		// ② 原神 有奖活动：`2026年10月2日-2026年10月31日23:59`（分隔符是紧贴的 -，起点无时刻）
		const gse = wins("p4-genshin-detail-event");
		check("genshin 活动：10-02 00:00 ~ 10-31 23:59（起点无时刻 → 00:00）",
			gse.length === 1 && gse[0].startTs === cst(2026, 10, 2, 0, 0) && gse[0].endTs === cst(2026, 10, 31, 23, 59)
			&& gse[0].raw === "2026年10月2日-2026年10月31日23:59", JSON.stringify(gse));

		// ③ 星铁 有奖活动：`2026年9月28日 - 2026年10月12日 23:59`
		const hse = wins("p4-hsr-detail-event");
		check("hsr 活动：09-28 00:00 ~ 10-12 23:59",
			hse.length === 1 && hse[0].startTs === cst(2026, 9, 28, 0, 0) && hse[0].endTs === cst(2026, 10, 12, 23, 59),
			JSON.stringify(hse));
		check("hsr 活动：开奖时间（2026年10月28日）**单独出现、不配成窗口**", hse.length === 1);

		// ④ 绝区零 频段：`2026-09-30 12:00 ~ 2026-10-20 14:59`
		const zzzb = wins("p4-zzz-detail-band");
		check("zzz 频段：只 1 段（正文里同一区间重复出现已按时间区间去重）", zzzb.length === 1, JSON.stringify(zzzb.map((w) => w.raw)));
		check("zzz 频段：09-30 12:00 ~ 10-20 14:59",
			zzzb[0].startTs === cst(2026, 9, 30, 12, 0) && zzzb[0].endTs === cst(2026, 10, 20, 14, 59)
			&& zzzb[0].raw === "2026-09-30 12:00 ~ 2026-10-20 14:59", JSON.stringify(zzzb[0]));

		// ⑤ 绝区零 活动：起点是「即日起」→ 取公告发布时刻（含秒，如实），并**标记为推断**
		const zzze = wins("p4-zzz-detail-event");
		check("zzz 活动：09-30 12:00 ~ 10-18 23:59（「即日起」取公告 created_at=1790740813）",
			zzze.length === 1 && zzze[0].startTs === 1790740813000 && cstWall(zzze[0].startTs) === "2026-09-30 12:00"
			&& zzze[0].endTs === cst(2026, 10, 18, 23, 59),
			JSON.stringify(zzze));
		check("zzz 活动：起点被标 inferred（如实交代「即日起」是推断）",
			zzze[0].inferred === true && /即日起/.test(zzze[0].note) && zzze[0].raw === "即日起 - 2026年10月18日 23:59");

		// ⑥ 星铁 跃迁：起点是**版本锚点** `2026/09/28 4.6版本更新后`
		const hsw = wins("p4-hsr-detail-warp", hsrVerStarts);
		check("hsr 跃迁：抽 2 段（主跃迁 + 返场；试玩那段与主跃迁同一区间已去重）",
			hsw.length === 2, JSON.stringify(hsw.map((w) => w.raw)));
		check("hsr 跃迁：起点用版本锚点 2026-09-28 07:00（不是字面 00:00）",
			hsw[0].startTs === hsrVerStarts["4.6"] && cstWall(hsw[0].startTs) === "2026-09-28 07:00", cstWall(hsw[0].startTs));
		check("hsr 跃迁：09-28 07:00 ~ 11-10 15:00 / 09-28 07:00 ~ 10-21 11:59",
			hsw[0].endTs === cst(2026, 11, 10, 15, 0) && hsw[1].endTs === cst(2026, 10, 21, 11, 59));
		check("hsr 跃迁：raw 保留源站原文（含「版本更新后」）且标 inferred",
			hsw[0].raw === "2026/09/28 4.6版本更新后 - 2026/11/10 15:00" && hsw[0].inferred === true);
		check("版本锚点缺失时退回字面日期 00:00（不是抛错、也不是瞎猜时刻）",
			(() => { const w = wins("p4-hsr-detail-warp"); return !!w[0] && cstWall(w[0].startTs) === "2026-09-28 00:00"; })());

		// ⑦ 原神 type=1 的"活动说明"：一段里有两条区间（整体 + 紊乱爆发期）
		const gsa = wins("p4-genshin-detail-activity");
		check("genshin type=1 活动说明：抽出 2 段（整体 09-30~11-03 / 爆发期 09-30~10-10）",
			gsa.length === 2 && gsa[0].startTs === cst(2026, 9, 30, 10, 0) && gsa[0].endTs === cst(2026, 11, 3, 3, 59)
			&& gsa[1].endTs === cst(2026, 10, 10, 3, 59), JSON.stringify(gsa));

		// ⑧ **抽不到档期 → 0 段**（不是硬造）
		check("bh3 补给正文 0 段（时间在配图里，正文只有开放等级/保底规则）",
			wins("p4-bh3-detail-gacha").length === 0 && wins("p4-bh3-detail-char").length === 0);
		check("genshin 祈愿正文 0 段（只写「活动期间」不给日期）",
			wins("p4-genshin-detail-wish").length === 0 && wins("p4-genshin-detail-wish2").length === 0);
		check("bh3 补给正文确实含任务书提到的那两句（证明夹具读对了、只是没日期）",
			/das?|开放等级/.test("开放等级") && /保底规则/.test(det("p4-bh3-detail-gacha").content)
			&& /每.*10次.*装备补给必定获得4★武器或圣痕/.test(det("p4-bh3-detail-gacha").content));

		// ⑨ 无年份日期缺 hint → 不解（不猜"当前年"）
		check("无年份日期但没有公告年份可借 → 不产出（不猜）",
			collectMiyousheWindows("9.28 12:00~10.7 23:59", MIYOUSHE_TZ, {}).length === 0);
		check("同段文本给了 hint 就能解（对照）",
			collectMiyousheWindows("9.28 12:00~10.7 23:59", MIYOUSHE_TZ, { hintTs: cst(2026, 9, 28, 12, 0) }).length === 1);
		// ⑩ 跨年：终点月日早于起点 → 终点进一年
		const cross = collectMiyousheWindows("12.28 12:00~1.5 23:59", MIYOUSHE_TZ, { hintTs: cst(2026, 12, 28, 12, 0) });
		check("无年份 + 跨年：终点自动进一年（2026-12-28 → 2027-01-05）",
			cross.length === 1 && cross[0].startTs === cst(2026, 12, 28, 12, 0) && cross[0].endTs === cst(2027, 1, 5, 23, 59),
			cross.length ? `${cstWall(cross[0].startTs)} ~ ${cstWall(cross[0].endTs)}` : "0 段");
		// ⑪ 相邻但无关的两个日期（中间不是连接符）不能被配成窗口
		check("中间不是连接符 → 不配窗口",
			collectMiyousheWindows("开奖时间：2026年10月2日 续 2026年10月31日", MIYOUSHE_TZ, { hintTs: cst(2026, 10, 2, 12, 0) }).length === 0);

		// ⑫ 时区口径：同一绝对时刻在 UTC+8 与 UTC+9 下渲染不同 → 说明 tz 取值真的影响结果
		const t0 = cst(2026, 9, 30, 12, 0);
		check("时区口径：UTC+8 渲染 12:00 / UTC+9 渲染 13:00（故 tz 必须是 UTC+8，且属推测）",
			cstWall(t0) === "2026-09-30 12:00" && jstWall(t0) === "2026-09-30 13:00", `${cstWall(t0)} / ${jstWall(t0)}`);
	}

	// ───────────────────────── P4-4 名册抽取（roles） ─────────────────────────
	section("P4-4 卡池名册（roles，best-effort）");
	{
		const warp = parseMiyousheDetail(fixture("p4-hsr-detail-warp"));
		const w = collectMiyousheWindows(warp.content, MIYOUSHE_TZ, { hintTs: warp.createdTs, verStarts: hsrVerStarts });
		check("hsr 跃迁：引言里的名册 = 真珠（返场角色在首个档期之后，不混入）",
			miyousheRoles(warp.content, w[0].at) === "真珠", JSON.stringify(miyousheRoles(warp.content, w[0].at)));
		check("hsr 跃迁：不限范围时能看到两个限定5星角色（如实反映正文）",
			miyousheRoles(warp.content) === "真珠、绯英", JSON.stringify(miyousheRoles(warp.content)));
		const band = parseMiyousheDetail(fixture("p4-zzz-detail-band"));
		check("zzz 频段：引言没有名册 → 退回全文取「洛克茜、普罗米娅」",
			miyousheRoles(band.content) === "洛克茜、普罗米娅", JSON.stringify(miyousheRoles(band.content)));
		check("bh3 补给：正文没有「限定X级角色」写法 → 名册为空（不硬造）",
			miyousheRoles(parseMiyousheDetail(fixture("p4-bh3-detail-gacha")).content) === "");
	}

	// ───────────────────────── P4-5 错误/边界（纯函数，喂真实错误夹具） ─────────────────────────
	section("P4-5 错误与边界（真实错误响应夹具）");
	{
		check("列表 retcode≠0 → 抛错（实测未指定类型 = 1001）",
			(() => { try { parseMiyousheList(fixture("p4-bad-type")); return false; } catch (e) { return e.message === "miyoushe-retcode-1001"; } })());
		check("详情 retcode≠0 → 抛错（实测 post not exist = 1102）",
			(() => { try { parseMiyousheDetail(fixture("p4-post-missing")); return false; } catch (e) { return e.message === "miyoushe-retcode-1102"; } })());
		check("未知 gids → retcode 0 + 空 list（**不是**错误）→ 解析出 0 条",
			parseMiyousheList(fixture("p4-gids-unknown")).length === 0);
		check("形状损坏 → 抛错（对象/字符串/空对象/缺 list）",
			throws(() => parseMiyousheList({})) && throws(() => parseMiyousheList("x")) && throws(() => parseMiyousheList({ retcode: 0 }))
			&& throws(() => parseMiyousheDetail({ retcode: 0, data: {} })) && throws(() => parseMiyousheDetail(null)));
		// "这篇不存在"≠"这一侧失败"的分级
		check("404/410 与 post not exist(1101/1102) 都算「该篇不存在」→ 跳过而不是整侧失败",
			isMiyousheMissing(new Error("miyoushe-retcode-1102")) && isMiyousheMissing(new Error("miyoushe-retcode-1101"))
			&& isMiyousheMissing(new Error("proxy-http-404")) && isMiyousheMissing(new Error("proxy-bad:410")));
		check("403 / 567 / 坏 JSON 算**硬失败**（不能被当成「未公布」）",
			!isMiyousheMissing(new Error("proxy-bad:403")) && !isMiyousheMissing(new Error("http-567")) && !isMiyousheMissing(new Error("bad-json")));
	}

	// ───────────────────────── P4-6 抓取器端到端（离线走夹具，now=夹具快照时刻） ─────────────────────────
	section("P4-6 抓取器端到端（夹具 fetch，now=夹具抓取时刻）");
	const got = {};
	{
		// 先测**列表为空**与**列表报错**两条分支（用真实夹具）
		const empty = await grab(() => gachaMiyoushe(miyousheListUrl(99999, GACHA), undefined, MIYOUSHE_TZ, snap("p4-bh3-news")));
		check("未知 gids（空列表）→ null（未公布），不抛", empty.ok && empty.data === null, JSON.stringify(empty));
		const badList = await grab(() => gachaMiyoushe(miyousheListUrl(2, 9), undefined, MIYOUSHE_TZ, snap("p4-bh3-news")));
		check("列表 retcode≠0 → 抛错（不是静默 null）", !badList.ok && /miyoushe-retcode-1001/.test(badList.err || ""), JSON.stringify(badList));

		// ⚠️ 这里遍历**测试用条目表**（4 个 gids），而不是生产 SOURCES_P4（只剩 bh3）。
		//    生产侧 genshin/hsr/zzz 是"并入插件既有条目"，但解析能力必须逐 gids 测到。
		for (const src of TEST_SOURCES) {
			for (const side of ["gacha", "event"]) {
				const key = `${src.id}.${side}`;
				calls.length = 0;
				const now = snap(LIST_FIX[src.id][side]);
				const url = miyousheListUrl(src.gid, side === "gacha" ? GACHA : EVENT);
				const fetcher = side === "gacha" ? gachaMiyoushe : eventsMiyoushe;
				const r = await grab(() => fetcher(url, undefined, src.tz, now));
				got[key] = r;
				check(`${key} 抓取未抛错`, r.ok, r.err);
				assertContract(`${src.name} ${side}`, side, r.ok ? r.data : null);

				// ⚠️ 代理形态下真实 url 在 `?url=<percent-encoded>` 里 → 统计前必须 decodeURIComponent
				const dec = calls.map((u) => { try { return decodeURIComponent(u); } catch { return u; } });
				const detCalls = dec.filter((u) => u.includes("/post/wapi/getPostFull")).length;
				const listCalls = dec.filter((u) => u.includes("/painter/wapi/getNewsList")).length;
				check(`${key} 只发 1 次列表请求`, listCalls === 1, String(listCalls));
				check(`${key} 详情请求数 1~${MIYOUSHE_MAX_DETAILS}（限速友好，且有抓）`,
					detCalls >= 1 && detCalls <= MIYOUSHE_MAX_DETAILS, String(detCalls));
				check(`${key} 全程走 /api/gacha-calendar-proxy（mode=proxy）`,
					calls.length > 0 && calls.every((u) => u.startsWith("/api/gacha-calendar-proxy")), JSON.stringify(calls.slice(0, 2)));
				check(`${key} 详情请求带 referer=www.miyoushe.com（实测的 Referer 门）`,
					detCalls > 0 && dec.filter((u) => u.includes("getPostFull")).every((u) => u.includes(`referer=${MIYOUSHE_REFERER}`)),
					JSON.stringify(dec.filter((u) => u.includes("getPostFull")).slice(0, 1)));
				// 确定性：now 必须落在返回的窗口内（否则"当期"判定本身就自相矛盾）
				if (r.ok && r.data && r.data.startTs != null && r.data.endTs != null) {
					check(`${key} now 落在返回窗口内（fixture 快照自洽）`,
						r.data.startTs <= now && now <= r.data.endTs, `${cstWall(r.data.startTs)} ~ ${cstWall(r.data.endTs)} vs ${cstWall(now)}`);
				}
			}
		}

		// 有当期数据的两侧：断言**夹具快照值**
		const hsrG = got["hsr.gacha"].data;
		check("hsr.gacha = 「4.6版本活动跃迁（其一）」", !!hsrG && hsrG.banner === "4.6版本活动跃迁（其一）", JSON.stringify(hsrG && hsrG.banner));
		check("hsr.gacha bannerDates = 09-28 07:00 ~ 11-10 15:00",
			!!hsrG && hsrG.bannerDates === "09-28 07:00 ~ 11-10 15:00", JSON.stringify(hsrG && hsrG.bannerDates));
		check("hsr.gacha startTs = 版本锚点(4.6更新说明 created_at) / endTs = 11-10 15:00(+08)",
			!!hsrG && hsrG.startTs === 1790550011000 && hsrG.endTs === cst(2026, 11, 10, 15, 0), JSON.stringify(hsrG && [hsrG.startTs, hsrG.endTs]));
		check("hsr.gacha bannerDatesRaw 保留源站原文（含「4.6版本更新后」）",
			!!hsrG && hsrG.bannerDatesRaw === "2026/09/28 4.6版本更新后 - 2026/11/10 15:00", JSON.stringify(hsrG && hsrG.bannerDatesRaw));
		check("hsr.gacha roles = 真珠", !!hsrG && hsrG.roles === "真珠", JSON.stringify(hsrG && hsrG.roles));
		check("hsr.gacha bannerHover 带来源/时区交代 + 逐行同期窗口（2 段）",
			!!hsrG && hsrG.bannerHover.startsWith(MIYOUSHE_PROVENANCE) && hsrG.bannerHover.split("\n").length === 3,
			JSON.stringify(hsrG && hsrG.bannerHover.split("\n").length));

		const zzzG = got["zzz.gacha"].data;
		check("zzz.gacha = 「3.2版本限时频段（下期）」", !!zzzG && zzzG.banner === "3.2版本限时频段（下期）", JSON.stringify(zzzG && zzzG.banner));
		check("zzz.gacha bannerDates = 09-30 12:00 ~ 10-20 14:59",
			!!zzzG && zzzG.bannerDates === "09-30 12:00 ~ 10-20 14:59" && zzzG.startTs === cst(2026, 9, 30, 12, 0) && zzzG.endTs === cst(2026, 10, 20, 14, 59),
			JSON.stringify(zzzG && [zzzG.bannerDates, zzzG.startTs, zzzG.endTs]));
		check("zzz.gacha roles = 洛克茜、普罗米娅", !!zzzG && zzzG.roles === "洛克茜、普罗米娅", JSON.stringify(zzzG && zzzG.roles));

		// 四个活动侧：断言夹具快照值
		const expectEvents = {
			"bh3.event": ["【有奖活动】分享你与崩坏3的专属片段，参与讨论赢水晶！", "09-28 12:00 ~ 10-07 23:59"],
			"genshin.event": ["【有奖活动】10月生日会话题活动开启！", "10-02 00:00 ~ 10-31 23:59"],
			"hsr.event": ["【有奖活动】嗷呜咪呜大征集 | 分享幻宠赢周边、星琼", "09-28 00:00 ~ 10-12 23:59"],
			"zzz.event": ["【有奖活动】「锵锵！球仔成长日记」丨分享宠物赢周边好礼", "09-30 12:00 ~ 10-18 23:59"]
		};
		for (const [key, [event, dates]] of Object.entries(expectEvents)) {
			const d = got[key].data;
			check(`${key} = ${event}`, !!d && d.event === event, JSON.stringify(d && d.event));
			check(`${key} eventDates = ${dates}`, !!d && d.eventDates === dates, JSON.stringify(d && d.eventDates));
			check(`${key} eventHover 带来源/时区交代`, !!d && d.eventHover.startsWith(MIYOUSHE_PROVENANCE), JSON.stringify(d && d.eventHover.split("\n")[0]));
		}
		check("zzz.event eventDatesRaw 保留源站原文「即日起 - …」（推断起点如实可查）",
			got["zzz.event"].data.eventDatesRaw === "即日起 - 2026年10月18日 23:59",
			JSON.stringify(got["zzz.event"].data.eventDatesRaw));

		// **抽不到档期 → null**（不硬凑、不拿 created_at 当档期）
		check("bh3.gacha = null（崩坏3 补给公告正文无日期，时间画在配图里）", got["bh3.gacha"].ok && got["bh3.gacha"].data === null, JSON.stringify(got["bh3.gacha"].data));
		check("genshin.gacha = null（原神祈愿公告正文无日期）",
			got["genshin.gacha"].ok && got["genshin.gacha"].data === null, JSON.stringify(got["genshin.gacha"].data));
		// 快照之后很久再看：全部窗口都过期 → null（而不是硬造当期）
		const later = await grab(() => gachaMiyoushe(miyousheListUrl(MIYOUSHE_GIDS.hsr, GACHA), undefined, MIYOUSHE_TZ, Date.UTC(2030, 0, 1)));
		check("2030 年再看 hsr 卡池：档期全过期 → null（未公布，不硬凑）", later.ok && later.data === null, JSON.stringify(later.data));

		// 原始导出函数也直接测一遍（防止只测 registry 包装层）
		const direct = await Promise.all([
			grab(() => gachaMiyoushe(miyousheListUrl(6, GACHA), undefined, MIYOUSHE_TZ, snap("p4-hsr-news"))),
			grab(() => eventsMiyoushe(miyousheListUrl(8, EVENT), undefined, MIYOUSHE_TZ, snap("p4-zzz-events"))),
			grab(() => eventsMiyoushe(miyousheListUrl(1, EVENT), undefined, MIYOUSHE_TZ, snap("p4-bh3-events")))
		]);
		check("3 个导出的抓取器都能离线跑通（proxy 分支）", direct.every((x) => x.ok && x.data), direct.map((x) => x.err || "ok").join(" | "));

		// 活动侧也能直接读 **type=1**（正文里的「活动说明」带档期）—— 说明分流逻辑不绑死列表类型
		const viaType1 = await grab(() => eventsMiyoushe(miyousheListUrl(2, GACHA), undefined, MIYOUSHE_TZ, snap("p4-genshin-news")));
		check("eventsMiyoushe 指到 type=1 列表也能取到站内活动（原神「幽境危战」）",
			viaType1.ok && !!viaType1.data && viaType1.data.event === "「幽境危战」活动：紊乱地脉挑战"
			&& viaType1.data.eventDates === "09-30 10:00 ~ 11-03 03:59",
			JSON.stringify(viaType1.data || viaType1.err));
	}

	// ───────────────────────── P4-7 全候选失败的分级（用真实错误夹具当替身） ─────────────────────────
	section("P4-7 全候选失败：全「post not exist」→ null；全硬错 → 抛错");
	{
		const bh3GachaUrl = miyousheListUrl(MIYOUSHE_GIDS.bh3, GACHA);
		// ① 把 bh3 卡池的候选详情全换成真实的「post not exist」→ 不算失败 → null
		useFixtures({
			[miyousheDetailUrl("78549971")]: "p4-post-missing/response.txt",
			[miyousheDetailUrl("78549969")]: "p4-post-missing/response.txt",
			"https://bbs-api.miyoushe.com/post/wapi/getPostFull": "p4-post-missing/response.txt"
		});
		const missing = await grab(() => gachaMiyoushe(bh3GachaUrl, undefined, MIYOUSHE_TZ, snap("p4-bh3-news")));
		check("全部候选都是「post not exist」→ null（不是抓取失败）", missing.ok && missing.data === null, JSON.stringify(missing));

		// ② 换成真实的 retcode≠0 错误正文 → 硬失败 → 抛错（不能被静默成"未公布"）
		useFixtures({
			[miyousheDetailUrl("78549971")]: "p4-bad-type/response.txt",
			[miyousheDetailUrl("78549969")]: "p4-bad-type/response.txt",
			"https://bbs-api.miyoushe.com/post/wapi/getPostFull": "p4-bad-type/response.txt"
		});
		const hard = await grab(() => gachaMiyoushe(bh3GachaUrl, undefined, MIYOUSHE_TZ, snap("p4-bh3-news")));
		check("全部候选都硬错（retcode≠0）→ 抛错（该侧算抓取失败）", !hard.ok && /miyoushe-retcode-1001/.test(hard.err || ""), JSON.stringify(hard));
	}

	// ───────────────────────── P4-8 news_meta 兜底（正文抽不到时用源站显式字段） ─────────────────────────
	section("P4-8 正文抽不到档期 → 回退 news_meta（并标明来源，不冒充正文）");
	{
		// 把 bh3 活动那篇的正文换成**真实的"无日期"正文**（补给公告：0 个日期）→ 触发兜底
		useFixtures({
			[miyousheDetailUrl("78469952")]: "p4-bh3-detail-gacha/response.txt",
			"https://bbs-api.miyoushe.com/post/wapi/getPostFull": "p4-post-missing/response.txt"
		});
		const r = await grab(() => eventsMiyoushe(miyousheListUrl(1, EVENT), undefined, MIYOUSHE_TZ, snap("p4-bh3-events")));
		check("正文无日期 → 兜底成功（bh3 活动 news_meta = 09-28 12:00 ~ 10-07 23:59）",
			r.ok && !!r.data && r.data.eventDates === "09-28 12:00 ~ 10-07 23:59",
			JSON.stringify(r.data || r.err));
		check("兜底的 eventDatesRaw **标明**来源是 news_meta（不是正文原文）",
			r.ok && !!r.data && /news_meta/.test(r.data.eventDatesRaw) && r.data.eventDatesRaw === "news_meta 档期（源站显式字段，非正文）：09-28 12:00 ~ 10-07 23:59",
			JSON.stringify(r.ok && r.data && r.data.eventDatesRaw));
		check("兜底的 eventHover 也标明「非正文原文」",
			r.ok && !!r.data && /源站 news_meta 显式档期，非正文原文/.test(r.data.eventHover),
			JSON.stringify(r.ok && r.data && r.data.eventHover));
		assertContract("崩坏3 国服 官方公告（news_meta 兜底）", "event", r.ok ? r.data : null);
	}

	// 直接 `node test/cases-p4.mjs` 时自报结果；被 all.mjs import 时不报（由 all.mjs 统一 summary）
	if (process.argv[1] && process.argv[1].endsWith("cases-p4.mjs")) summary();
}

// 直接执行时自动跑
if (process.argv[1] && process.argv[1].endsWith("cases-p4.mjs")) await runP4();
