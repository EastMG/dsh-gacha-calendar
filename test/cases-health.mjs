// test/cases-health.mjs —— 来源健康（待办第 3 项「解析器自检」）判定 + 接线 + 持久化
//
// ── 为什么需要它 ──
// 这个功能的价值全在**判定口径**上，而口径错了不会报错，只会"看起来很努力"：
//   · 把 `nomatch`（请求 200、解析出 0 条）当成失败 ⇒ 每天一个新池子的空窗都在报警；
//   · 把 `down`（HTTP 非 2xx / 超时 / 解析崩）当成人 nomatch ⇒ 用户看到"新卡池未公布"，
//     真正的原因（403 / 被墙 / 页面结构变了）被藏起来（终末地上次长期静默失灵就是这么来的）；
//   · 阈值差一天 ⇒ "连续 6 天"就提示"源可能改版或停更"，用户学会无视它。
// 所以这里把四种状态（正常 / 连续失败 / 疑似改版停更 / 从未成功）+ **第 7 天整**这个边界都钉住。
//
// 另守四件"改一半就静默失效"的接线：
//   ① 设置键三处齐（10-config.js 的 DEFAULT_SETTINGS / engine-head.js 的 CONFIG_KEYS /
//      src/index.js 的 schema 且 .volatile()）—— 漏一处的症状分别是"读不到"与"写入被拒"；
//   ② 引擎刷新后**真的把 sourceHealth 写进存储**（不是只算了没存）——用 core 引擎实跑一轮；
//   ③ 设置页只在**有异常**时占地方（用户抱怨过设置页太长），且渲染路径不做任何 IO。
//   ④ 内容没变就**不写**那一笔设置（每轮白写 = 白付一次宿主往返）、变了（如 ok → down）必须写 ——
//      用真实夹具跑完整 refresh，按假存储的写入记账断言。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { check, section, useFixtures } from "./harness.mjs";
import { T, REPO } from "./load.mjs";
import { createEngine } from "../packages/core/core.mjs";

const SRC = path.join(REPO, "src", "client");
const DAY = 86400000;
const NOW = 1761600000000;   // 固定时刻（2025-10-28 前后），所有断言都用它，不看真实时钟

// 一条"正常"的存档记录（可覆盖任意字段）
const recOf = (over) => ({
	at: NOW, okAt: NOW, items: 2, error: "",
	failStreak: 0, nomatchStreak: 0, nomatchSince: 0,
	...over
});

// 只跑一个 id 的引擎（其余全部隐藏 ⇒ 本轮只发 1 个请求，离线也是毫秒级）
// sets 记流水账（[键, 值]）：持久化那一段靠它数"这一轮到底写了几笔、写了哪些键"。
function makeStorage(seed) {
	const m = new Map(Object.entries(seed || {}));
	return {
		map: m,
		sets: [],
		async get(k) { return m.get(k); },
		async set(k, v) { this.sets.push([k, v]); m.set(k, v); }
	};
}

export default async function runHealth() {
	section("来源健康（最近成功 / 连续失败 / 连续 nomatch ⇒ 疑似改版停更）");

	// ── ① 单轮结论：ok / nomatch / down / skip（口径与 buildScrapeInfo 同源）──────────
	{
		const src = { id: "nte", url: "https://example.invalid/gacha", eventUrl: "https://example.invalid/event" };
		const ok = T.sourceHealthRoundOf(src, { data: { banner: "角色A", event: "活动B" }, gachaFail: null, eventFail: null });
		check("两侧都解析出内容 ⇒ ok / items=2", ok.status === "ok" && ok.items === 2, JSON.stringify(ok));

		const half = T.sourceHealthRoundOf(src, { data: { banner: "角色A", event: "" }, gachaFail: null, eventFail: { kind: "nomatch" } });
		check("只有一侧有内容 ⇒ 仍算 ok（未公布不是故障）", half.status === "ok" && half.items === 1, JSON.stringify(half));

		const empty = T.sourceHealthRoundOf(src, { data: {}, gachaFail: { kind: "nomatch" }, eventFail: { kind: "nomatch" } });
		check("两侧「请求成功但解析出 0 条」⇒ nomatch（异环改版 / 雪松停更就是这一种）",
			empty.status === "nomatch" && empty.items === 0 && empty.error === "", JSON.stringify(empty));

		const down = T.sourceHealthRoundOf(src, {
			data: { banner: "角色A" },
			gachaFail: null,
			eventFail: { kind: "down", reason: "HTTP 403" }
		});
		check("任一侧抓取报错 ⇒ down（哪怕另一侧有内容）", down.status === "down", JSON.stringify(down));
		check("down 的 error 用面板同一句文案（活动失败：HTTP 403）", down.error === "活动失败：HTTP 403", down.error);

		const downGacha = T.sourceHealthRoundOf(src, { data: {}, gachaFail: { kind: "down", reason: "网络不通" }, eventFail: null });
		check("卡池侧报错 ⇒ down 且原因指名卡池", downGacha.status === "down" && downGacha.error === "卡池失败：网络不通", downGacha.error);

		// 老缓存里的 fail 是**字符串**（"no-match" / 错误原文）：必须经 normalizeFail 归一后再判，
		// 否则会把"失败"错当"未公布"（健康看板正好会把这个错误长期化）
		const legacy = T.sourceHealthRoundOf(src, { data: {}, gachaFail: "no-match", eventFail: null });
		check("老格式字符串 fail 也认得（no-match ⇒ nomatch）", legacy.status === "nomatch", JSON.stringify(legacy));
		const legacyDown = T.sourceHealthRoundOf(src, { data: {}, gachaFail: "http-500", eventFail: null });
		check("老格式字符串 fail 也认得（错误原文 ⇒ down，且原因原样透出）",
			legacyDown.status === "down" && /HTTP 500/.test(legacyDown.error), JSON.stringify(legacyDown));

		// 这一轮根本没抓：既不算成功也不算失败
		const noSrc = T.sourceHealthRoundOf({ id: "x", url: "", eventUrl: "" }, { ok: true, reason: "skipped" });
		check("两侧都没配来源 ⇒ skip（不许算成 nomatch，否则 7 天后自己伪造一条「疑似停更」）",
			noSrc.status === "skip" && noSrc.items === 0, JSON.stringify(noSrc));
		const skipped = T.sourceHealthRoundOf(src, { ok: true, reason: "skipped" });
		check("被引擎跳过的条目 ⇒ skip", skipped.status === "skip", JSON.stringify(skipped));

		const onlyEvent = T.sourceHealthRoundOf({ id: "e", url: "", eventUrl: "https://example.invalid/e" },
			{ data: { banner: "不该算", event: "活动" }, gachaFail: null, eventFail: null });
		check("只配了活动侧的条目：卡池字段不计入 items", onlyEvent.status === "ok" && onlyEvent.items === 1, JSON.stringify(onlyEvent));
	}

	// ── ② 单源累积：连击 / 起点 / 最近成功时间 ──────────────────────────────────────
	{
		const okRound = { id: "a", status: "ok", items: 2, error: "" };
		const downRound = { id: "a", status: "down", items: 0, error: "卡池失败：网络不通" };
		const nomatchRound = { id: "a", status: "nomatch", items: 0, error: "" };
		const skipRound = { id: "a", status: "skip", items: 0, error: "" };

		const r1 = T.sourceHealthNextOf(undefined, okRound, NOW);
		check("第一次成功 ⇒ okAt = 本轮时间、两条连击都是 0",
			r1.okAt === NOW && r1.failStreak === 0 && r1.nomatchStreak === 0 && r1.nomatchSince === 0, JSON.stringify(r1));

		const r2 = T.sourceHealthNextOf(r1, downRound, NOW + DAY);
		check("连续失败 ⇒ failStreak=1、保留上次成功时间", r2.failStreak === 1 && r2.okAt === NOW, JSON.stringify(r2));
		check("失败原因落到记录里（下一步给 UI 显示）", r2.error === "卡池失败：网络不通", r2.error);
		const r3 = T.sourceHealthNextOf(r2, downRound, NOW + 2 * DAY);
		check("连续失败累加 ⇒ failStreak=2", r3.failStreak === 2 && r3.okAt === NOW, JSON.stringify(r3));

		const n1 = T.sourceHealthNextOf(undefined, nomatchRound, NOW);
		check("连续 nomatch 的起点 = 这一轮时间", n1.nomatchStreak === 1 && n1.nomatchSince === NOW, JSON.stringify(n1));
		const n2 = T.sourceHealthNextOf(n1, nomatchRound, NOW + 3 * DAY);
		check("第 2 轮 nomatch ⇒ 起点不变（跨度是「这一段连击」的跨度）",
			n2.nomatchStreak === 2 && n2.nomatchSince === NOW, JSON.stringify(n2));

		const afterOk = T.sourceHealthNextOf(n2, okRound, NOW + 4 * DAY);
		check("成功一次 ⇒ 两条连击都清零、起点归零（下次再 nomatch 重新起算）",
			afterOk.nomatchStreak === 0 && afterOk.nomatchSince === 0 && afterOk.failStreak === 0 && afterOk.okAt === NOW + 4 * DAY,
			JSON.stringify(afterOk));

		const afterDown = T.sourceHealthNextOf(n1, downRound, NOW + DAY);
		check("nomatch 连击遇到一次失败 ⇒ nomatch 连击清零（不再算「连续 nomatch」）",
			afterDown.nomatchStreak === 0 && afterDown.nomatchSince === 0 && afterDown.failStreak === 1, JSON.stringify(afterDown));

		const kept = T.sourceHealthNextOf(n2, skipRound, NOW + 5 * DAY);
		check("skip（这一轮没抓）⇒ 记录原样保留（不把「没抓」写成成功或失败）",
			kept === n2, JSON.stringify(kept));
		check("skip 且此前没有记录 ⇒ 不产生记录", T.sourceHealthNextOf(undefined, skipRound, NOW) == null);
	}

	// ── ③ 一轮更新的整体存档：搬运 / 丢删 / 坏值 ────────────────────────────────────
	{
		const prev = JSON.stringify({
			v: 1, at: NOW,
			sources: {
				a: recOf({ okAt: NOW - DAY, failStreak: 0 }),
				hiddenOne: recOf({ okAt: NOW - 9 * DAY, nomatchStreak: 9, nomatchSince: NOW - 9 * DAY }),
				gone: recOf({ okAt: NOW })
			}
		});
		const rounds = [
			{ id: "a", status: "nomatch", items: 0, error: "" },
			{ id: "gone", status: "ok", items: 1, error: "" }
		];
		const next = T.sourceHealthUpdateOf(prev, rounds, NOW + DAY, ["a", "hiddenOne"]);
		check("本轮抓到的条目更新成新结论（a ⇒ nomatch）",
			next.sources.a.nomatchStreak === 1 && next.sources.a.nomatchSince === NOW + DAY, JSON.stringify(next.sources.a));
		check("隐藏条目本轮没抓 ⇒ 旧记录原样保留（可能上一轮就断了，别动它）",
			next.sources.hiddenOne.nomatchStreak === 9 && next.sources.hiddenOne.okAt === NOW - 9 * DAY, JSON.stringify(next.sources.hiddenOne));
		check("已删除的条目从存档里丢掉（存档不无限增长）", next.sources.gone === undefined, JSON.stringify(Object.keys(next.sources)));
		const withSkip = T.sourceHealthUpdateOf(prev, [{ id: "a", status: "skip", items: 0, error: "" }], NOW + DAY, ["a", "hiddenOne"]);
		check("本轮「两侧都没配来源 / 被跳过」的条目：记录一并丢弃（否则旧记录会僵成一条假「疑似停更」）",
			withSkip.sources.a === undefined && !!withSkip.sources.hiddenOne, JSON.stringify(Object.keys(withSkip.sources)));
		check("存档带版本号与本轮时间（at 给 UI 判断数据新旧）",
			next.v === 1 && next.at === NOW + DAY, JSON.stringify({ v: next.v, at: next.at }));

		const fromGarbage = T.sourceHealthUpdateOf("{不是 JSON", [{ id: "a", status: "ok", items: 2, error: "" }], NOW, ["a"]);
		check("存档坏了/为空 ⇒ 当空表重建（永不抛：辅助信息不该让刷新失败）",
			!!fromGarbage.sources.a && fromGarbage.sources.a.okAt === NOW, JSON.stringify(fromGarbage));
	}

	// ── ③b 语义比较：这一轮到底要不要再写一笔设置 ──────────────────────────────────
	// 写入是宿主往返（一次 1.4~3.6s）。"内容没变"必须判相同 ⇒ 跳过；只要有一处实质变化
	// （某源 ok→down / items 变 / 多删一个 id）就必须判不同 ⇒ 照旧写，否则健康看板永远停在昨天。
	// 三处时间戳（顶层 at / 记录 at / okAt）**不参与比较**：它们就是本轮 now，比了等于没优化。
	{
		const prevRaw = JSON.stringify({
			v: 1, at: NOW,
			sources: { a: recOf({ okAt: NOW }), b: recOf({ okAt: NOW - DAY, items: 1 }) }
		});
		// 时间戳全部推进（跨 5 天）、其余字段不变
		const advanced = {
			v: 1, at: NOW + 5 * DAY,
			sources: {
				a: recOf({ at: NOW + 5 * DAY, okAt: NOW + 5 * DAY }),
				b: recOf({ at: NOW + 5 * DAY, okAt: NOW + 4 * DAY, items: 1 })
			}
		};
		check("只有时间戳推进（顶层 at / 记录 at / okAt）⇒ 判「内容相同」（否则每轮都写，等于没优化）",
			T.sourceHealthSameOf(prevRaw, advanced) === true);
		check("空存档（默认空串）vs 空 sources ⇒ 也算相同（一条记录都没有时不该为空气写一笔）",
			T.sourceHealthSameOf("", { v: 1, at: NOW, sources: {} }) === true);

		const downOne = JSON.parse(JSON.stringify(advanced));
		downOne.sources.a = recOf({ at: NOW + 5 * DAY, okAt: NOW, items: 0, failStreak: 1, error: "卡池失败：HTTP 503" });
		check("某源从 ok 变 down（items / failStreak / error 都变了）⇒ 判「内容不同」",
			T.sourceHealthSameOf(prevRaw, downOne) === false);
		check("只是 items 变（示例：另一侧的活动下架）⇒ 判「内容不同」",
			T.sourceHealthSameOf(prevRaw, { v: 1, at: NOW, sources: { a: recOf({ items: 1 }), b: recOf({ okAt: NOW - DAY, items: 1 }) } }) === false);
		check("nomatch 连击 / 起点变了 ⇒ 判「内容不同」",
			T.sourceHealthSameOf(prevRaw, { v: 1, at: NOW, sources: { a: recOf({ nomatchStreak: 2, nomatchSince: NOW - DAY }), b: recOf({ okAt: NOW - DAY, items: 1 }) } }) === false);
		check("多一个 id / 少一个 id ⇒ 判「内容不同」（删掉条目要落盘，不能僵在存档里）",
			T.sourceHealthSameOf(prevRaw, { v: 1, at: NOW, sources: { a: recOf() } }) === false
			&& T.sourceHealthSameOf(prevRaw, { v: 1, at: NOW, sources: { a: recOf(), b: recOf({ okAt: NOW - DAY, items: 1 }), c: recOf() } }) === false);
		check("老存档里数字存成字符串也按值比（字符串 2 与数字 2 视为相同，不要假报「变了」）",
			T.sourceHealthSameOf(
				JSON.stringify({ v: 1, at: NOW, sources: { a: { at: NOW, okAt: NOW, items: "2", error: "", failStreak: "0", nomatchStreak: "0", nomatchSince: "0" } } }),
				{ v: 1, at: NOW + DAY, sources: { a: recOf() } }
			) === true);
		check("坏存档 vs 有内容的存档 ⇒ 判「内容不同」（借这一笔把坏存档重写掉）",
			T.sourceHealthSameOf("{不是 JSON", { v: 1, at: NOW, sources: { a: recOf() } }) === false);
	}

	// ── ④ 给 UI 的每源状态：四种状态 + 第 7 天整的边界 + 文案 ────────────────────────
	{
		const entries = [
			{ id: "ok1", name: "原神" },
			{ id: "down1", name: "鸣潮" },
			{ id: "stale1", name: "异环" },
			{ id: "never1", name: "雪松" }
		];
		const sources = {
			ok1: recOf({ okAt: NOW - 3600000, items: 2 }),
			down1: recOf({ okAt: NOW - 2 * DAY, failStreak: 3, error: "卡池失败：网络不通" }),
			stale1: recOf({ okAt: NOW - 10 * DAY, nomatchStreak: 8, nomatchSince: NOW - 8 * DAY }),
			never1: recOf({ okAt: 0, nomatchStreak: 7, nomatchSince: NOW - 7 * DAY })
		};
		const rows = T.sourceHealthOf(sources, NOW, { entries });
		const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
		check("返回顺序 = 传入条目顺序（UI 直接 map，不再排序）", rows.map((r) => r.id).join(",") === "ok1,down1,stale1,never1", rows.map((r) => r.id).join(","));

		check("最近一轮成功 ⇒ state=ok", byId.ok1.state === "ok", byId.ok1.state);
		check("连续失败 ⇒ state=down（不是 nomatch、不是 ok）", byId.down1.state === "down", byId.down1.state);
		check("连续 8 天 nomatch 且曾经成功过 ⇒ state=stale（疑似改版或停更）", byId.stale1.state === "stale", byId.stale1.state);
		check("连续 7 天 nomatch 且**从未成功过** ⇒ state=never（从装上就没抓到东西）", byId.never1.state === "never", byId.never1.state);

		// 文案 = 设置页那一行（游戏名 · 连续失败 N 次 · 最近成功 X 前 · 原因）
		check("失败行的文案含「连续失败 N 次」+「最近成功 X 前」+ 原因",
			byId.down1.text === "连续失败 3 次 · 最近成功 2 天前 · 卡池失败：网络不通", byId.down1.text);
		check("疑似停更行的文案含「连续 N 天没解析出内容」+「疑似改版或停更」",
			byId.stale1.text === "连续 8 天没解析出内容 · 最近成功 10 天前 · 疑似改版或停更", byId.stale1.text);
		check("从未成功行的文案是「从未成功」而不是「最近成功 0 天前」",
			byId.never1.text === "连续 7 天没解析出内容 · 从未成功 · 疑似改版或停更", byId.never1.text);
		check("正常行只报最近成功时间（健康的不占地方，也不编造结论）",
			byId.ok1.text === "最近成功 1 小时前", byId.ok1.text);

		// 阈值边界：**第 7 天整**才翻成疑似停更，差 1 秒都不行（否则"连续 6 天"就报警 ⇒ 用户学会无视）
		const at6d = T.sourceHealthOf({ a: recOf({ okAt: NOW - 8 * DAY, nomatchStreak: 6, nomatchSince: NOW - 6 * DAY }) }, NOW, { entries: [{ id: "a" }] })[0];
		check("连续 6 天 nomatch ⇒ 仍是 ok（阈值是 7 天，不能提前报警）", at6d.state === "ok", at6d.state);
		const justUnder = T.sourceHealthOf({ a: recOf({ nomatchStreak: 2, nomatchSince: NOW - 7 * DAY + 1000 }) }, NOW, { entries: [{ id: "a" }] })[0];
		check("差 1 秒不满 7 天 ⇒ 仍是 ok", justUnder.state === "ok", justUnder.state);
		const exactly7 = T.sourceHealthOf({ a: recOf({ okAt: NOW - 9 * DAY, nomatchStreak: 2, nomatchSince: NOW - 7 * DAY }) }, NOW, { entries: [{ id: "a" }] })[0];
		check("正好 7 天 ⇒ stale（边界取 >=）", exactly7.state === "stale", exactly7.state);

		// N 是可注入的（报告里说明"7 是常量"；这里证明判定确实读它，而不是写死一个数）
		const custom = T.sourceHealthOf({ a: recOf({ okAt: NOW - 5 * DAY, nomatchStreak: 3, nomatchSince: NOW - 3 * DAY }) }, NOW,
			{ entries: [{ id: "a" }], nomatchDays: 3 })[0];
		check("nomatchDays 可注入（默认 7，测试/其它平台可改）", custom.state === "stale", custom.state);

		// 没记录 / 记录过时
		const unknown = T.sourceHealthOf({}, NOW, { entries: [{ id: "zzz", name: "没刷过" }] })[0];
		check("没有记录的条目：known=false 且不算异常（UI 据此不显示它）",
			unknown.known === false && unknown.state === "ok", JSON.stringify(unknown));
		const stale = T.sourceHealthOf({ a: recOf() }, NOW + 30 * DAY, { entries: [{ id: "a" }] })[0];
		check("最近成功时间会随时间推移变旧（不是落盘时算好的死值）", stale.text === "最近成功 30 天前", stale.text);
	}

	// ── ⑤ 持久化路径：引擎刷新后**真的**把 sourceHealth 写进存储 ────────────────────
	{
		// 只留一个条目可见（其余全部隐藏）⇒ 本轮只发 1 个请求；transport 直接失败 ⇒ down（离线可跑）
		const allIds = createEngine({ transport: { async fetchRaw() { throw new Error("no-network"); }, async fetchViaProxy() { throw new Error("no-network"); } }, storage: makeStorage(), now: () => NOW }).__test.SOURCES.map((s) => s.id);
		const visibleId = "nte";
		const storage = makeStorage({
			hidden: allIds.filter((id) => id !== visibleId),
			// 旧存档里有一个"当前隐藏"的条目记录：本路刷新不该动它
			sourceHealth: JSON.stringify({ v: 1, at: NOW - DAY, sources: { genshin: recOf({ okAt: NOW - DAY }) } })
		});
		const engine = createEngine({
			transport: {
				async fetchRaw() { throw new Error("no-network"); },
				async fetchViaProxy() { throw new Error("no-network"); }
			},
			storage,
			now: () => NOW,
			// 缩短到点收尾的预算：本轮 transport 立刻失败，不该等 20 秒
			timer: { setTimeout, clearTimeout }
		});
		await engine.refresh();
		const raw = await storage.get("sourceHealth");
		check("刷新后存储里出现了 sourceHealth（引擎真的写了，不是只算了）", typeof raw === "string" && raw.length > 2, String(raw).slice(0, 80));
		let parsed = null;
		try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
		check("sourceHealth 是合法 JSON 且带 { v, at, sources }", !!parsed && parsed.v === 1 && typeof parsed.at === "number" && !!parsed.sources, String(raw).slice(0, 120));
		check("本轮抓到的条目有记录（down ⇒ failStreak=1，okAt 仍是 0 = 从未成功）",
			!!parsed && !!parsed.sources[visibleId] && parsed.sources[visibleId].failStreak === 1 && parsed.sources[visibleId].okAt === 0,
			JSON.stringify(parsed && parsed.sources[visibleId]));
		check("隐藏条目的旧记录原样保留（本轮没抓它，不许编造结论）",
			!!parsed && !!parsed.sources.genshin && parsed.sources.genshin.okAt === NOW - DAY,
			JSON.stringify(parsed && parsed.sources.genshin));
		// 不污染渲染的唯一数据源：lastData 里不许出现健康字段
		const lastData = JSON.parse(await storage.get("lastData"));
		const polluted = Object.entries(lastData).filter(([, v]) => v && ["failStreak", "nomatchStreak", "nomatchSince", "health"].some((k) => k in v));
		check("lastData 的形状没被污染（健康状态只进 sourceHealth）", polluted.length === 0, polluted.map(([id]) => id).join(","));
	}

	// ── ⑤b 「内容没变就不写」的实跑：状态未变 ⇒ 第二轮零写入；状态变了（ok → down）⇒ 必写 ────
	// 用 fgo 的真实夹具跑**完整 refresh**（两侧都解析出内容 = ok），时间由 let 时钟推进 ——
	// 这是最常见的场景：源都正常、每轮结论一样，旧的实现每轮都要为它付一次设置往返。
	{
		const { FGO_GACHA_URL, FGO_EVENT_URL } = T.parsers["fgo"];
		const fixtureImpl = useFixtures({
			[FGO_GACHA_URL]: "fgo-gacha-parse/response.txt",
			[FGO_EVENT_URL]: "fgo-event-parse/response.txt"
		});
		let netDown = false;
		const impl = async (url, opts) => (netDown
			? { ok: false, status: 503, headers: { get: () => null }, text: async () => "", json: async () => ({}) }
			: fixtureImpl(url, opts));
		const transport = {
			async fetchRaw(url, opts) { return impl(url, opts); },
			// fgo 的抓取器走宿主代理（mode:"proxy"）⇒ 与 harness 的 setFetchImpl 同一套包装：
			// 拼出 `/api/gacha-calendar-proxy?url=…` 交给夹具 impl，再把 {status, body} 拆开。
			async fetchViaProxy(url, opts) {
				const o = opts || {};
				let api = "/api/gacha-calendar-proxy?url=" + encodeURIComponent(String(url));
				api += "&referer=" + encodeURIComponent(o.referer || "");
				if (o.headers) api += "&headers=" + encodeURIComponent(JSON.stringify(o.headers));
				let payload;
				if (o.body !== void 0) {
					api += "&contentType=" + encodeURIComponent(o.contentType || "application/json; charset=utf-8");
					payload = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
				}
				const res = await impl(api, payload !== void 0 ? { method: "POST", body: payload } : undefined);
				if (!res || !res.ok) throw new Error("proxy-http-" + ((res && res.status) || 0));
				const wrapped = JSON.parse(await res.text());
				if (wrapped.status !== 200) throw new Error("proxy-bad:" + wrapped.status);
				return wrapped.body;
			}
		};
		// 夹具抓取时刻（与 cases-b3 同一时刻：当期卡池/活动都覆盖它）
		let clock = Date.UTC(2026, 9, 1, 17, 27);
		const allIds = createEngine({ transport, storage: makeStorage(), now: () => clock }).__test.SOURCES.map((s) => s.id);
		const storage = makeStorage({ hidden: allIds.filter((id) => id !== "fgo") });
		const engine = createEngine({ transport, storage, now: () => clock, timer: { setTimeout, clearTimeout } });
		const wroteSince = (from) => storage.sets.slice(from);
		const keysSince = (from) => wroteSince(from).map(([k]) => k);

		await engine.refresh();
		const afterFirst = await storage.get("sourceHealth");
		check("第一轮：健康存档写了一次（这一点是本测试的对照，不是优化目标）",
			keysSince(0).filter((k) => k === "sourceHealth").length === 1, keysSince(0).join(","));
		let parsed1 = null;
		try { parsed1 = JSON.parse(afterFirst); } catch (e) { parsed1 = null; }
		check("第一轮 fgo 两侧都解析出内容 ⇒ ok / items=2 / 无失败连击",
			!!parsed1 && !!parsed1.sources.fgo && parsed1.sources.fgo.items === 2
			&& parsed1.sources.fgo.failStreak === 0 && parsed1.sources.fgo.nomatchStreak === 0,
			JSON.stringify(parsed1 && parsed1.sources.fgo));

		// ── 第二轮：隔 10 分钟再刷，结论完全一样 ⇒ 不该写 sourceHealth ──
		let mark = storage.sets.length;
		clock += 600000;
		await engine.refresh();
		const secondKeys = keysSince(mark);
		check("状态完全没变的第二轮：**一笔都不写** sourceHealth（省掉的就是这次宿主往返）",
			secondKeys.indexOf("sourceHealth") < 0, secondKeys.join(","));
		check("跳过健康存档时 lastData 照旧写（它在上面的独立一笔里，不许被一起漏掉）",
			secondKeys.indexOf("lastData") >= 0, secondKeys.join(","));
		check("第二轮存储里的 sourceHealth 字符串与第一轮**逐字节相同**（不只是没写，内容也没漂）",
			(await storage.get("sourceHealth")) === afterFirst);

		// ── 第三轮：网络全挂 ⇒ ok → down，状态真的变了 ⇒ 必须写 ──
		mark = storage.sets.length;
		netDown = true;
		clock += 600000;
		await engine.refresh();
		const thirdKeys = keysSince(mark);
		check("状态变了（ok → down）：必须写 sourceHealth（否则看板永远停在「正常」）",
			thirdKeys.indexOf("sourceHealth") >= 0, thirdKeys.join(","));
		check("状态变了这一轮 lastData 也照旧写", thirdKeys.indexOf("lastData") >= 0, thirdKeys.join(","));
		let parsed3 = null;
		try { parsed3 = JSON.parse(await storage.get("sourceHealth")); } catch (e) { parsed3 = null; }
		check("down 落盘：failStreak=1 / items=0 / 原因写进存档",
			!!parsed3 && !!parsed3.sources.fgo && parsed3.sources.fgo.failStreak === 1
			&& parsed3.sources.fgo.items === 0 && /503/.test(parsed3.sources.fgo.error),
			JSON.stringify(parsed3 && parsed3.sources.fgo));
		check("真的写的时候 at 是本轮最新时间（不是被跳过的旧时间）",
			!!parsed3 && parsed3.at === clock, JSON.stringify({ at: parsed3 && parsed3.at, clock }));
	}

	// ── ⑥ 设置键三处齐 + 阈值常量（漏一处就是"设了不生效"/"写入被拒"）────────────────
	{
		check("DEFAULT_SETTINGS.sourceHealth 存在且是空串（10-config.js）",
			T.DEFAULT_SETTINGS.sourceHealth === "", String(T.DEFAULT_SETTINGS.sourceHealth));

		const ehText = readFileSync(path.join(SRC, "engine-head.js"), "utf8");
		const j = ehText.indexOf("const CONFIG_KEYS = [");
		const cfgBlock = j >= 0 ? ehText.slice(j, ehText.indexOf("];", j)) : "";
		const cfgKeys = [...cfgBlock.matchAll(/"([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]);
		check("引擎 CONFIG_KEYS 含 sourceHealth（漏了 = 设置页/健康面板读不到自己写的存档）",
			cfgKeys.includes("sourceHealth"), cfgKeys.join(","));

		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		check("宿主 schema 有 sourceHealth: z.string().default(\"\").volatile()（漏了 = 引擎写入被拒 ⇒ 刷新整轮失败）",
			/sourceHealth:\s*z\.string\(\)\.default\(""\)\.volatile\(\)/.test(hostSrc));

		const helpers = readFileSync(path.join(SRC, "60-helpers.js"), "utf8");
		check("N 天阈值只有一处字面量（SOURCE_HEALTH_NOMATCH_DAYS = 7）",
			/const SOURCE_HEALTH_NOMATCH_DAYS = 7;/.test(helpers));
		check("判定里不许再散写 7 天（阈值必须读常量）",
			!/nomatchSince[^\n]*7\s*\*\s*86400000/.test(helpers.replace(/const SOURCE_HEALTH_NOMATCH_DAYS = 7;/, "")));
	}

	// ── ⑦ 设置页接线（静态）：只在有异常时占地方 + 渲染路径无 IO ─────────────────────
	{
		const comp = readFileSync(path.join(SRC, "80-components.js"), "utf8");
		check("设置页读的是 sourceHealth 存档（不是 lastData 里另起一份）",
			/parseSourceHealth\(s\.sourceHealth\)/.test(comp));
		check("设置页用纯函数折算每源状态（判定不在渲染层重写）",
			/sourceHealthOf\(\s*\n?\s*parseSourceHealth\(s\.sourceHealth\)\.sources/.test(comp));
		check("只把**展示中**的条目交给健康看板（隐藏条目的记录会僵在隐藏前那一刻）",
			/getVisibleEntries\(s\), order\)\.map\(\(g\) => \(\{ id: g\.id, name: g\.name \|\| g\.id \}\)\)/.test(comp));
		check("默认收起：展开开关初值 false（健康的不占地方）",
			/const \[healthAll, setHealthAll\] = \(0, react\.useState\)\(false\)/.test(comp));
		check("异常项过滤 = known && state !== ok（没记录的条目不冒充异常）",
			/healthKnown\.filter\(\(h\) => h\.state !== "ok"\)/.test(comp) && /healthRows\.filter\(\(h\) => h\.known\)/.test(comp));
		check("一条记录都没有时整块不渲染（旧版本升上来不该多一块空卡）",
			/healthKnown\.length === 0 \? null :/.test(comp));
		// 渲染路径不许 IO：健康面板那块 JSX 里不许出现 fetch / localStorage / 读文件
		const k = comp.indexOf("healthKnown.length === 0 ? null :");
		const block = k < 0 ? "" : comp.slice(k, k + 2200);
		check("健康面板不发起请求、不读写本地存储、不读文件（渲染路径零 IO）",
			k >= 0 && !/\bfetch\s*\(|localStorage|readFileSync|XMLHttpRequest/.test(block),
			block.slice(0, 120));
		// 文案由 core 给（UI 只拼「· 名字 · text」），不是渲染层现写一套
		check("行文案来自纯函数的 text（渲染层不另写一套措辞）", /"· " \+ h\.name \+ " · " \+ h\.text/.test(comp));
	}

	// ── ⑧ 构建产物里也有（src/ 是唯一真源，产物必须同源）─────────────────────────────
	{
		const client = readFileSync(path.join(REPO, "lib", "client.js"), "utf8");
		check("lib/client.js（客户端产物）里有 sourceHealth 判定",
			client.includes("function sourceHealthOf(") && client.includes("SOURCE_HEALTH_NOMATCH_DAYS"));
		const core = readFileSync(path.join(REPO, "packages", "core", "core.mjs"), "utf8");
		check("packages/core/core.mjs（中立核心产物）里有同一份判定",
			core.includes("function sourceHealthOf(") && core.includes("SOURCE_HEALTH_NOMATCH_DAYS"));
	}
}
