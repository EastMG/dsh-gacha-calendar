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
//   ② 引擎**「立即检查」（selfCheck）之后真的把 sourceHealth 写进存储**（不是只算了没存），
//      用 core 引擎 + 真夹具实跑一次 —— 并且**刷新不再写健康**（2026-10-28 解耦，反向守卫）；
//   ③ 设置页**一张卡**装完（标题「解析器自检」+ 按钮「立即检查」+ 来源健康列表），健康块
//      任何情况下都渲染一行状态（用户抱怨过"整块不渲染 ⇒ 看不到功能"，也抱怨过设置页太长），
//      且渲染路径不做任何 IO；解耦后卡片还必须显示「上次自检 X 前」（数据不再自动更新）；
//   ④ 内容没变就**不写**那一笔存档（自检也是低频动作，但没必要为"什么都没变"付宿主往返）、
//      变了（如 ok → down）必须写 —— 用真实夹具跑完整 selfCheck，按假存储的写入记账断言。
//      ⚠️ 但「上次自检」的时间戳（healthCheckedAt）**每次都写**，否则内容没变的检查不留痕。
//
// ⑨ 另在这段里挂一条**与健康无关**的用例：新版面板开关的一次性迁移（newPanel → newPanelMigrated，
//    宿主 apply 里 void 触发）。它是本轮唯一零覆盖的新功能，而挂在这里是因为「段数」有机器守卫
//    （cases-readme ④）—— 新开 cases-*.mjs 就得同时改 README.md / README_Dev.md / test/README.md
//    三处文档，为一个 27 条断言的用例不值当。用例自身见文件末尾 ⑨。

import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { check, section, useFixtures } from "./harness.mjs";
import { T, REPO, readComponentsSource } from "./load.mjs";
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

// fgo 夹具的 transport（真夹具：两侧都解析出内容 = ok）。用 fgo 而不是 nte 的理由：
// 它的卡池与活动两侧都在夹具里，且活动侧走宿主代理路径 —— 与真实链路一致。
// 返回 { transport, down, up }：down() 之后所有请求 503（ok → down 的实跑就靠它）。
function fgoTransport() {
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
	return {
		transport,
		down() { netDown = true; },
		up() { netDown = false; }
	};
}

export default async function runHealth() {
	section("来源健康（上次成功 / 连续失败 / 连续 nomatch ⇒ 疑似改版停更）");

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

	// ── ② 单源累积：连击 / 起点 / 上次成功时间 ──────────────────────────────────────
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

		// 文案 = 设置页那一行（游戏名 · 连续失败 N 次 · 上次成功 X 前 · 原因）
		check("失败行的文案含「连续失败 N 次」+「上次成功 X 前」+ 原因",
			byId.down1.text === "连续失败 3 次 · 上次成功 2 天前 · 卡池失败：网络不通", byId.down1.text);
		check("疑似停更行的文案含「连续 N 天没解析出内容」+「疑似改版或停更」",
			byId.stale1.text === "连续 8 天没解析出内容 · 上次成功 10 天前 · 疑似改版或停更", byId.stale1.text);
		check("从未成功行的文案是「从未成功」而不是「上次成功 0 天前」",
			byId.never1.text === "连续 7 天没解析出内容 · 从未成功 · 疑似改版或停更", byId.never1.text);
		check("正常行只报上次成功时间（健康的不占地方，也不编造结论）",
			byId.ok1.text === "上次成功 1 小时前", byId.ok1.text);

		// 2026-10-28 设置页四列网格：胶囊 / 原因 / 上次成功三段也由纯函数给（UI 不再自己拼措辞）
		check("down 行四列字段：✕ 抓取失败 + error 原文 + 上次成功 2 天前",
			byId.down1.tag === "✕ 抓取失败" && byId.down1.tone === "error"
			&& byId.down1.reason === "卡池失败：网络不通" && byId.down1.agoText === "上次成功 2 天前",
			JSON.stringify({ tag: byId.down1.tag, tone: byId.down1.tone, reason: byId.down1.reason, agoText: byId.down1.agoText }));
		check("stale 行四列字段：⚠ 疑似停更 + 连续 8 天没解析出内容 + 上次成功 10 天前",
			byId.stale1.tag === "⚠ 疑似停更" && byId.stale1.tone === "warn"
			&& byId.stale1.reason === "连续 8 天没解析出内容" && byId.stale1.agoText === "上次成功 10 天前",
			JSON.stringify({ tag: byId.stale1.tag, tone: byId.stale1.tone, reason: byId.stale1.reason, agoText: byId.stale1.agoText }));
		check("never 行四列字段：⚠ 从未成功（不是「上次成功 0 天前」）",
			byId.never1.tag === "⚠ 从未成功" && byId.never1.tone === "warn"
			&& byId.never1.agoText === "从未成功" && /^连续 \d+ 天没解析出内容$/.test(byId.never1.reason),
			JSON.stringify({ tag: byId.never1.tag, tone: byId.never1.tone, reason: byId.never1.reason, agoText: byId.never1.agoText }));
		check("ok 行四列字段：● 正常 + 解析出 2 条 + 上次成功 1 小时前（灰点弱化交给 CSS）",
			byId.ok1.tag === "● 正常" && byId.ok1.tone === "ok"
			&& byId.ok1.reason === "解析出 2 条" && byId.ok1.agoText === "上次成功 1 小时前",
			JSON.stringify({ tag: byId.ok1.tag, tone: byId.ok1.tone, reason: byId.ok1.reason, agoText: byId.ok1.agoText }));

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
		check("上次成功时间会随时间推移变旧（不是落盘时算好的死值）", stale.text === "上次成功 30 天前", stale.text);
	}

	// ── ④b 显示侧补偿**已移除**：健康记录与面板刷新彻底解耦 ─────────────────────────────
	// 背景：解耦前 refresh() 每轮顺手写健康存档，但"内容没变"的轮次会跳过那一笔 ⇒ 存档里的 okAt
	// 停在最后一次真正写入的轮次，稳定 30 天就会显示"上次成功 30 天前"。当时的补丁在显示侧：
	// `max(okAt, lastRefreshAt)` —— 把上次成功顶到本机最近一轮刷新时间。
	// ⚠️ 2026-10-28 用户决策：健康只由「立即检查」写、与刷新彻底无关 ⇒ 那段补偿**必须删掉**：
	// 刷新跑得很勤、自检却很久没做时，它正好会把"很久没核对来源"伪装成"刚刚成功"。
	// 现在「这份数据有多旧」由设置页标题行的「上次自检 X 前」（healthCheckedAt）回答。
	{
		const entries = [{ id: "ok1", name: "原神" }];
		// 最后一笔健康存档写在 30 天前，而本机刚刚刷过很多轮（刷新与健康已经无关）
		const longAgo = { ok1: recOf({ at: NOW - 30 * DAY, okAt: NOW - 30 * DAY, items: 2 }) };

		const base = T.sourceHealthOf(longAgo, NOW, { entries })[0];
		check("ok 行显示存档里的真实「上次成功」（刷新过但没自检 ⇒ 仍是 30 天前）",
			base.lastOkAt === NOW - 30 * DAY && base.text === "上次成功 30 天前",
			JSON.stringify({ lastOkAt: base.lastOkAt, text: base.text }));

		// 老调用方即使还传这个参数也不许再顶新（参数与逻辑都删了 ⇒ 传了就是被忽略）
		const withOpt = T.sourceHealthOf(longAgo, NOW, { entries, lastRefreshAt: NOW - 60000 })[0];
		check("传 lastRefreshAt 也不再顶新（删除生效：刷新时间不再是「上次成功」的证据）",
			withOpt.lastOkAt === NOW - 30 * DAY && withOpt.text === "上次成功 30 天前",
			JSON.stringify({ lastOkAt: withOpt.lastOkAt, text: withOpt.text }));
		check("忽略 lastRefreshAt 时 state / items / known 都不受影响（判定只读真实 okAt）",
			withOpt.state === "ok" && withOpt.items === 2 && withOpt.known === true,
			JSON.stringify({ state: withOpt.state, items: withOpt.items, known: withOpt.known }));

		// 三种异常状态 + 「ok 但 nomatch 连击未到阈值」：去掉补偿后必须逐字不变（证明没误伤）
		const bad = {
			down1: recOf({ okAt: NOW - 2 * DAY, failStreak: 3, error: "卡池失败：网络不通" }),
			stale1: recOf({ okAt: NOW - 10 * DAY, nomatchStreak: 8, nomatchSince: NOW - 8 * DAY }),
			never1: recOf({ okAt: 0, nomatchStreak: 7, nomatchSince: NOW - 7 * DAY }),
			noma1: recOf({ okAt: NOW - 4 * DAY, nomatchStreak: 2, nomatchSince: NOW - 2 * DAY })
		};
		const badEntries = [
			{ id: "down1", name: "鸣潮" }, { id: "stale1", name: "异环" },
			{ id: "never1", name: "雪松" }, { id: "noma1", name: "蔚蓝" }
		];
		const rowsBad = Object.fromEntries(T.sourceHealthOf(bad, NOW, { entries: badEntries, lastRefreshAt: NOW - 60000 }).map((r) => [r.id, r]));
		check("down 行 lastOkAt 与整行文案逐字不变（连续失败与上次成功不能自相矛盾）",
			rowsBad.down1.lastOkAt === NOW - 2 * DAY
			&& rowsBad.down1.text === "连续失败 3 次 · 上次成功 2 天前 · 卡池失败：网络不通",
			JSON.stringify({ lastOkAt: rowsBad.down1.lastOkAt, text: rowsBad.down1.text }));
		check("stale 行 lastOkAt 与整行文案逐字不变（疑似停更的时间不许被抹新）",
			rowsBad.stale1.lastOkAt === NOW - 10 * DAY
			&& rowsBad.stale1.text === "连续 8 天没解析出内容 · 上次成功 10 天前 · 疑似改版或停更",
			JSON.stringify({ lastOkAt: rowsBad.stale1.lastOkAt, text: rowsBad.stale1.text }));
		check("never 行仍是「从未成功」（不许被编成「刚刚成功」）",
			rowsBad.never1.lastOkAt === 0
			&& rowsBad.never1.text === "连续 7 天没解析出内容 · 从未成功 · 疑似改版或停更",
			JSON.stringify({ lastOkAt: rowsBad.never1.lastOkAt, text: rowsBad.never1.text }));
		// ok 档**并不**等于"此后每轮都成功"：nomatch 没到 7 天阈值时 state 也是 ok，
		// 但那段确实没解析出内容 ⇒ 顶成"刚刚成功"就是显示谎言。
		check("ok 档但 nomatch 连击未到阈值 ⇒ 仍显示真实 okAt（那一段并没有成功过）",
			rowsBad.noma1.state === "ok" && rowsBad.noma1.lastOkAt === NOW - 4 * DAY
			&& rowsBad.noma1.text === "上次成功 4 天前",
			JSON.stringify({ state: rowsBad.noma1.state, lastOkAt: rowsBad.noma1.lastOkAt, text: rowsBad.noma1.text }));

		// 时钟回拨 / 缺省：以前是两个专门的分支，现在连分支都没有（参数被完全忽略）
		const future = T.sourceHealthOf(longAgo, NOW, { entries, lastRefreshAt: NOW + DAY })[0];
		check("lastRefreshAt 在未来（时钟回拨/坏值）⇒ 同样被忽略（不会编「未来成功」）",
			future.lastOkAt === NOW - 30 * DAY && future.text === "上次成功 30 天前",
			JSON.stringify({ lastOkAt: future.lastOkAt, text: future.text }));
		const zero = T.sourceHealthOf(longAgo, NOW, { entries, lastRefreshAt: 0 })[0];
		check("lastRefreshAt=0 / 缺省 ⇒ 与传了完全一致（这个参数已彻底不影响结果）",
			zero.lastOkAt === withOpt.lastOkAt && zero.text === withOpt.text,
			JSON.stringify({ lastOkAt: zero.lastOkAt, text: zero.text }));

		// 静态：补偿必须真的从代码里消失，而不是"只是设置页没传"。
		// 判之前先把注释剥掉 —— 解释"为什么废弃"的注释里会**提到**这个参数名，那是说明不是逻辑。
		const stripComments = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
		const helpersText = readFileSync(path.join(SRC, "60-helpers.js"), "utf8");
		check("60-helpers.js 的**代码**里已经没有任何 lastRefreshAt（参数 + 补偿逻辑都删了，不是停用）",
			stripComments(helpersText).indexOf("lastRefreshAt") < 0);
		const compText = readComponentsSource();
		check("设置页的**代码**里也没有 lastRefreshAt（健康卡不再拿刷新时间当证据）",
			stripComments(compText).indexOf("lastRefreshAt") < 0);
	}

	// ── ⑤ 持久化路径：**「立即检查」（selfCheck）** 之后真的把 sourceHealth 写进存储 ──────
	// 2026-10-28 解耦后的事实：refresh() 完全不碰 sourceHealth；唯一的写入口是 selfCheck。
	// 这一段的形态因此整体换掉：假 storage + **真夹具**跑一次 selfCheck（fgo 两侧都有内容 ⇒ ok），
	// 然后检查存档内容、**并断言 lastData 没有被写**（自检不许污染渲染数据源）。
	{
		const fx = fgoTransport();
		// 夹具抓取时刻（与 cases-b3 同一时刻：当期卡池/活动都覆盖它）
		const clock = Date.UTC(2026, 9, 1, 17, 27);
		const allIds = createEngine({ transport: fx.transport, storage: makeStorage(), now: () => clock }).__test.SOURCES.map((s) => s.id);
		const storage = makeStorage({
			hidden: allIds.filter((id) => id !== "fgo"),
			// 旧存档里有一个"当前隐藏"的条目记录：自检不该动它
			sourceHealth: JSON.stringify({ v: 1, at: clock - DAY, sources: { genshin: recOf({ okAt: clock - DAY }) } })
		});
		const engine = createEngine({ transport: fx.transport, storage, now: () => clock, timer: { setTimeout, clearTimeout } });
		const report = await engine.selfCheck();
		const raw = await storage.get("sourceHealth");
		check("自检后存储里出现了 sourceHealth（引擎真的写了，不是只算了）",
			typeof raw === "string" && raw.length > 2, String(raw).slice(0, 80));
		let parsed = null;
		try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
		check("sourceHealth 是合法 JSON 且带 { v, at, sources }",
			!!parsed && parsed.v === 1 && typeof parsed.at === "number" && !!parsed.sources, String(raw).slice(0, 120));
		check("本轮抓到的条目有记录（ok ⇒ items=2 / okAt=本次自检时间 / 无失败连击）",
			!!parsed && !!parsed.sources.fgo && parsed.sources.fgo.items === 2
			&& parsed.sources.fgo.okAt === clock && parsed.sources.fgo.failStreak === 0,
			JSON.stringify(parsed && parsed.sources.fgo));
		check("隐藏条目的旧记录原样保留（本轮没抓它，不许编造结论）",
			!!parsed && !!parsed.sources.genshin && parsed.sources.genshin.okAt === clock - DAY,
			JSON.stringify(parsed && parsed.sources.genshin));
		// 解耦的两个核心断言：自检写健康，但**不碰**渲染数据源与刷新状态
		const wroteKeys = storage.sets.map(([k]) => k);
		check("自检**不写 lastData**（健康与渲染数据源彻底分开）",
			wroteKeys.indexOf("lastData") < 0, wroteKeys.join(","));
		check("自检不写 lastRefresh / lastSource / lastVersion（它不冒充一次刷新）",
			["lastRefresh", "lastSource", "lastVersion"].every((k) => wroteKeys.indexOf(k) < 0), wroteKeys.join(","));
		check("自检只写两笔：sourceHealth + healthCheckedAt",
			wroteKeys.length === 2 && wroteKeys[0] === "sourceHealth" && wroteKeys[1] === "healthCheckedAt",
			wroteKeys.join(","));
		check("healthCheckedAt = 本次自检时间（「上次自检 X 前」的数据源）",
			(await storage.get("healthCheckedAt")) === clock, String(await storage.get("healthCheckedAt")));
		check("自检报告本身照旧返回（at / total / summary / problems / games）",
			!!report && report.at === clock && report.total === 1
			&& !!report.summary && !!report.games.fgo && Array.isArray(report.problems),
			JSON.stringify(report && Object.keys(report)));
		// 存档里只放健康字段，不许混进内容字段（渲染字段属于 lastData）
		const contentFields = ["banner", "roles", "bannerDates", "event", "eventDates"];
		const leaked = Object.entries((parsed && parsed.sources) || {})
			.filter(([, v]) => v && contentFields.some((k) => k in v));
		check("sourceHealth 的每条记录只有健康字段（内容字段仍只进 lastData）",
			leaked.length === 0, leaked.map(([id]) => id).join(","));

		// 抓取从一开始就失败的那一类（离线可跑）：自检也要把结论落盘 —— down / failStreak=1 /
		// okAt 仍是 0（= 从未成功，UI 显示「从未成功」而不是「上次成功 0 天前」）。
		const downStorage = makeStorage({ hidden: allIds.filter((id) => id !== "fgo") });
		const downEngine = createEngine({
			transport: {
				async fetchRaw() { throw new Error("no-network"); },
				async fetchViaProxy() { throw new Error("no-network"); }
			},
			storage: downStorage,
			now: () => clock,
			timer: { setTimeout, clearTimeout }
		});
		await downEngine.selfCheck();
		let parsedDown = null;
		try { parsedDown = JSON.parse(await downStorage.get("sourceHealth")); } catch (e) { parsedDown = null; }
		check("抓取失败的自检也落盘（down ⇒ failStreak=1，okAt 仍是 0 = 从未成功）",
			!!parsedDown && !!parsedDown.sources.fgo && parsedDown.sources.fgo.failStreak === 1
			&& parsedDown.sources.fgo.okAt === 0,
			JSON.stringify(parsedDown && parsedDown.sources.fgo));
		check("抓取失败的自检也不写 lastData（失败的那次也不许污染渲染数据源）",
			downStorage.sets.map(([k]) => k).indexOf("lastData") < 0,
			downStorage.sets.map(([k]) => k).join(","));
	}

	// ── ⑤a 反向守卫：**refresh() 完全不碰来源健康** ──────────────────────────────────────
	// 解耦的硬要求：刷新只写 lastData / lastRefresh / lastSource / lastVersion。
	// 这里实跑一轮 refresh（真夹具 ⇒ 成功），按写入记账断言那四个缓存键之外一笔都不写 ——
	// 尤其不许出现 sourceHealth / healthCheckedAt。
	{
		const fx = fgoTransport();
		const clock = Date.UTC(2026, 9, 1, 17, 27);
		const allIds = createEngine({ transport: fx.transport, storage: makeStorage(), now: () => clock }).__test.SOURCES.map((s) => s.id);
		const storage = makeStorage({ hidden: allIds.filter((id) => id !== "fgo") });
		const engine = createEngine({ transport: fx.transport, storage, now: () => clock, timer: { setTimeout, clearTimeout } });
		const result = await engine.refresh();
		const keys = storage.sets.map(([k]) => k);
		check("refresh() 实跑：健康存档一个字节都不写（sourceHealth 不在写入账上）",
			keys.indexOf("sourceHealth") < 0, keys.join(","));
		check("refresh() 实跑：也不写 healthCheckedAt（自检时间只属于自检）",
			keys.indexOf("healthCheckedAt") < 0, keys.join(","));
		check("refresh() 实跑：写的就是那四个缓存键（lastData / lastRefresh / lastSource / lastVersion）",
			keys.length === 4 && ["lastData", "lastRefresh", "lastSource", "lastVersion"].every((k) => keys.indexOf(k) >= 0),
			keys.join(","));
		check("refresh() 的返回值仍是冻结的 Result JSON（解耦没有改动契约）",
			!!result && result.schemaVersion === 1 && result.refreshedAt === clock && !!result.games.fgo,
			JSON.stringify(result && Object.keys(result)));
	}

	// ── ⑤b 「内容没变就不写」的实跑（现在是**自检**轮次）：结论未变 ⇒ 不写存档（但写自检时间）；
	//    结论变了（ok → down）⇒ 必写 ─────────────────────────────────────────────────────
	// 用 fgo 的真实夹具跑**完整 selfCheck**（两侧都解析出内容 = ok），时间由 let 时钟推进 ——
	// 自检是低频手动动作，"什么都没变"的那次仍然不该为存档付一次宿主往返；但**自检时间每次必写**，
	// 否则用户刚点完「立即检查」却看到「上次自检 3 天前」。
	{
		const fx = fgoTransport();
		// 夹具抓取时刻（与 cases-b3 同一时刻：当期卡池/活动都覆盖它）
		let clock = Date.UTC(2026, 9, 1, 17, 27);
		const allIds = createEngine({ transport: fx.transport, storage: makeStorage(), now: () => clock }).__test.SOURCES.map((s) => s.id);
		const storage = makeStorage({ hidden: allIds.filter((id) => id !== "fgo") });
		const engine = createEngine({ transport: fx.transport, storage, now: () => clock, timer: { setTimeout, clearTimeout } });
		const keysSince = (from) => storage.sets.slice(from).map(([k]) => k);

		const firstClock = clock;
		await engine.selfCheck();
		const afterFirst = await storage.get("sourceHealth");
		check("第一次自检：健康存档写了一次（这一点是本测试的对照，不是优化目标）",
			keysSince(0).filter((k) => k === "sourceHealth").length === 1, keysSince(0).join(","));
		check("第一次自检同时写下自检时间（否则「上次自检」永远显示从未自检）",
			keysSince(0).indexOf("healthCheckedAt") >= 0 && (await storage.get("healthCheckedAt")) === clock,
			keysSince(0).join(","));
		let parsed1 = null;
		try { parsed1 = JSON.parse(afterFirst); } catch (e) { parsed1 = null; }
		check("第一次自检 fgo 两侧都解析出内容 ⇒ ok / items=2 / 无失败连击",
			!!parsed1 && !!parsed1.sources.fgo && parsed1.sources.fgo.items === 2
			&& parsed1.sources.fgo.failStreak === 0 && parsed1.sources.fgo.nomatchStreak === 0,
			JSON.stringify(parsed1 && parsed1.sources.fgo));

		// ── 第二次：隔 10 分钟再自检，结论完全一样 ⇒ 不该写 sourceHealth（但自检时间必须推进）──
		let mark = storage.sets.length;
		clock += 600000;
		await engine.selfCheck();
		const secondKeys = keysSince(mark);
		check("状态完全没变的第二次自检：**不写** sourceHealth（省掉的就是这次宿主往返）",
			secondKeys.indexOf("sourceHealth") < 0, secondKeys.join(","));
		check("内容没变也必须写自检时间（healthCheckedAt 每次都写，否则「刚检查过」不留痕）",
			secondKeys.indexOf("healthCheckedAt") >= 0 && (await storage.get("healthCheckedAt")) === clock,
			secondKeys.join(","));
		check("第二次自检也不写 lastData（健康与数据轮转彻底分开）",
			secondKeys.indexOf("lastData") < 0, secondKeys.join(","));
		check("第二次自检后存储里的 sourceHealth 字符串与第一次**逐字节相同**（不只是没写，内容也没漂）",
			(await storage.get("sourceHealth")) === afterFirst);

		// ── 第三次：网络全挂 ⇒ ok → down，状态真的变了 ⇒ 必须写 ──
		mark = storage.sets.length;
		fx.down();
		clock += 600000;
		await engine.selfCheck();
		const thirdKeys = keysSince(mark);
		check("状态变了（ok → down）：必须写 sourceHealth（否则看板永远停在「正常」）",
			thirdKeys.indexOf("sourceHealth") >= 0, thirdKeys.join(","));
		check("状态变了这一次自检也照旧写自检时间", thirdKeys.indexOf("healthCheckedAt") >= 0, thirdKeys.join(","));
		check("状态变了也不写 lastData（自检永远不动数据轮转）",
			thirdKeys.indexOf("lastData") < 0, thirdKeys.join(","));
		let parsed3 = null;
		try { parsed3 = JSON.parse(await storage.get("sourceHealth")); } catch (e) { parsed3 = null; }
		check("down 落盘：failStreak=1 / items=0 / 原因写进存档",
			!!parsed3 && !!parsed3.sources.fgo && parsed3.sources.fgo.failStreak === 1
			&& parsed3.sources.fgo.items === 0 && /503/.test(parsed3.sources.fgo.error),
			JSON.stringify(parsed3 && parsed3.sources.fgo));
		check("真的写的时候 at 是本次自检时间（不是被跳过的旧时间）",
			!!parsed3 && parsed3.at === clock, JSON.stringify({ at: parsed3 && parsed3.at, clock }));
		check("down 只推进 failStreak：okAt 停在最后一次成功的那次自检（失败不许抹掉上次成功）",
			!!parsed3 && parsed3.sources.fgo.okAt === firstClock,
			JSON.stringify({ okAt: parsed3 && parsed3.sources.fgo.okAt, firstClock }));
		fx.up();

		// ── ⑤c 健康存档被宿主拒绝 ⇒ **不许**把一次成功的自检判成失败 ────────────────────────
		// 真机现象（2026-10-28 用户截图）：面板底栏「刷新失败：settings-write-rejected:sourceHealth」，
		// 而那一轮抓取其实是**成功**的 —— 根因是宿主进程还是旧 schema（没有 sourceHealth 这个键），
		// `dshStorage.set` 因此抛错。解耦后这条写入链路只活在自检里 ⇒ 要求变成：报告照出、
		// 缓存与配置一个字不动、失败只留一个内存标记（供设置页空状态说真话）。
		// 这里用同一形态的假存储：只让 `set("sourceHealth")` 抛错，其余键照常落盘。
		clock += 600000;
		let rejectHealth = true;
		const fmap = new Map(Object.entries({ hidden: allIds.filter((id) => id !== "fgo") }));
		const fkeys = [];
		const rejected = [];
		const rejectingStorage = {
			async get(k) { return fmap.get(k); },
			async set(k, v) {
				// 宿主拒写：与 92-dsh-env.js 的 dshStorage.set 同一种失败（抛错，不是静默）
				if (rejectHealth && k === "sourceHealth") {
					rejected.push(v);
					throw new Error("settings-write-rejected:sourceHealth");
				}
				fkeys.push(k);
				fmap.set(k, v);
			}
		};
		const engine2 = createEngine({ transport: fx.transport, storage: rejectingStorage, now: () => clock, timer: { setTimeout, clearTimeout } });
		let report2 = null;
		let threw2 = null;
		try { report2 = await engine2.selfCheck(); } catch (e) { threw2 = e; }
		check("健康存档被宿主拒绝时 selfCheck() **不抛**（附属产物写不进不该让自检失败）",
			threw2 === null, threw2 && threw2.message);
		check("健康存档被拒时仍返回完整报告（at / total / summary / problems / games）",
			!!report2 && report2.at === clock && typeof report2.total === "number"
			&& !!report2.summary && !!report2.games && Array.isArray(report2.problems),
			JSON.stringify(report2 && Object.keys(report2)));
		check("健康存档被拒时自检结论照旧（fgo 两侧都成功 —— 这次自检其实是成功的）",
			!!report2 && !!report2.games && !!report2.games.fgo
			&& report2.games.fgo.gacha.state === "ok" && report2.games.fgo.event.state === "ok",
			JSON.stringify(report2 && report2.games && report2.games.fgo));
		check("健康存档被拒时缓存键一笔都没写（自检本来就不写它们，坏也不许连坐）",
			["lastData", "lastRefresh", "lastSource", "lastVersion"].every((k) => fkeys.indexOf(k) < 0),
			fkeys.join(","));
		check("健康存档被拒：确实尝试写过（不是压根没算 / 没走到那一笔就被当成正常）",
			rejected.length === 1 && typeof rejected[0] === "string" && rejected[0].length > 2,
			String(rejected.length));
		check("健康存档被拒：没写进去（存储里没有 sourceHealth，不许谎报已存）",
			(await rejectingStorage.get("sourceHealth")) === undefined);
		check("健康存档被拒：自检时间也没落盘（同一段里被截断，不留「检查过了」的半边假象）",
			(await rejectingStorage.get("healthCheckedAt")) === undefined);
		check("健康存档被拒留下内存标记，且带出宿主原因（设置页空状态靠它说真话）",
			typeof engine2.healthSaveError === "function"
			&& /settings-write-rejected:sourceHealth/.test(engine2.healthSaveError()),
			typeof engine2.healthSaveError === "function" ? engine2.healthSaveError() : "无 healthSaveError 接口");

		// 宿主修好（写入被接受）⇒ 下一次自检要真的落盘，并且把失败标记清掉（否则空状态会一直报警）
		rejectHealth = false;
		mark = fkeys.length;
		clock += 600000;
		await engine2.selfCheck();
		check("宿主修好后同一引擎再自检：健康存档真的落盘了（v=1 且有本次自检时间）",
			(() => {
				let p = null;
				try { p = JSON.parse(fmap.get("sourceHealth")); } catch (e) { p = null; }
				return !!p && p.v === 1 && p.at === clock;
			})(), String(fmap.get("sourceHealth")).slice(0, 120));
		check("宿主修好后：失败标记必须清空（下次写成功就复位）",
			engine2.healthSaveError() === "", String(engine2.healthSaveError()));
		check("宿主修好后：自检时间也落盘（卡片能显示新的「上次自检」）",
			fmap.get("healthCheckedAt") === clock, String(fmap.get("healthCheckedAt")));
		check("宿主修好后仍然不动缓存键（自检永远只写健康那两笔）",
			["lastData", "lastRefresh", "lastSource", "lastVersion"].every((k) => fkeys.slice(mark).indexOf(k) < 0),
			fkeys.slice(mark).join(","));
	}

	// ── ⑥ 设置键三处齐 + 阈值常量 + 「只有一个写入口」的静态守卫 ────────────────────────
	{
		check("DEFAULT_SETTINGS.sourceHealth 存在且是空串（10-config.js）",
			T.DEFAULT_SETTINGS.sourceHealth === "", String(T.DEFAULT_SETTINGS.sourceHealth));
		check("DEFAULT_SETTINGS.healthCheckedAt 存在且是 0 = 从未自检（10-config.js）",
			T.DEFAULT_SETTINGS.healthCheckedAt === 0, String(T.DEFAULT_SETTINGS.healthCheckedAt));

		const ehText = readFileSync(path.join(SRC, "engine-head.js"), "utf8");
		const j = ehText.indexOf("const CONFIG_KEYS = [");
		const cfgBlock = j >= 0 ? ehText.slice(j, ehText.indexOf("];", j)) : "";
		const cfgKeys = [...cfgBlock.matchAll(/"([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]);
		check("引擎 CONFIG_KEYS 含 sourceHealth（漏了 = 设置页/健康面板读不到自己写的存档）",
			cfgKeys.includes("sourceHealth"), cfgKeys.join(","));
		check("引擎 CONFIG_KEYS 含 healthCheckedAt（漏了 = 设置页读不到「上次自检」）",
			cfgKeys.includes("healthCheckedAt"), cfgKeys.join(","));

		const hostSrc = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		check("宿主 schema 有 sourceHealth: z.string().default(\"\").volatile()（漏了 = 引擎写入被拒）",
			/sourceHealth:\s*z\.string\(\)\.default\(""\)\.volatile\(\)/.test(hostSrc));
		check("宿主 schema 有 healthCheckedAt: z.number().default(0).volatile()（漏了 = 自检时间写不进去）",
			/healthCheckedAt:\s*z\.number\(\)\.default\(0\)\.volatile\(\)/.test(hostSrc));

		// ── 「健康存档失败不致命」+「只有一个写入口」的接线守卫（2026-10-28 用户真机截图：
		//    面板底栏「刷新失败：settings-write-rejected:sourceHealth」，而那一轮抓取其实是成功的）──
		// ① 那一笔 storage.set 必须包在 try/catch 里，catch 里**只记标记、不许 rethrow**；
		// ② 全 src/client 只许 engine-api.js 写这两个键（别处散写一笔 = 又出现一条裸 await 的拒写路径）；
		// ③ 而且必须落在 **selfCheck 的函数体**里 —— refresh 的函数体切片内一个都不许出现。
		const api = readFileSync(path.join(SRC, "engine-api.js"), "utf8");
		const refreshAt = api.indexOf("function refresh()");
		const selfCheckAt = api.indexOf("async function selfCheck(");
		// refresh() 的函数体切片**截止到 selfCheck 的文档注释之前**（那段注释讲的是自检，
		// 会正当提到 sourceHealth —— 把它算进 refresh 会误报）。
		const selfDocAt = refreshAt < 0 ? -1 : api.indexOf("// 解析器自检", refreshAt);
		check("能切出 refresh() 与 selfCheck() 的函数体（守卫自身没瞎）",
			refreshAt >= 0 && selfCheckAt > refreshAt && selfDocAt > refreshAt,
			JSON.stringify({ refreshAt, selfCheckAt, selfDocAt }));
		const refreshBody = refreshAt < 0 ? "" : api.slice(refreshAt, selfDocAt > refreshAt ? selfDocAt : selfCheckAt);
		const selfCheckBody = selfCheckAt < 0 ? "" : api.slice(selfCheckAt, api.indexOf("const __test = {", selfCheckAt));
		check("**refresh() 函数体里不许出现 sourceHealth**（解耦的硬要求：刷新完全不碰健康）",
			refreshBody.length > 0 && refreshBody.indexOf("sourceHealth") < 0,
			refreshBody.slice(Math.max(0, refreshBody.indexOf("sourceHealth") - 80), refreshBody.indexOf("sourceHealth") + 80));
		check("refresh() 函数体里也不许出现 healthCheckedAt / healthSaveError（自检时间只属于自检）",
			refreshBody.indexOf("healthCheckedAt") < 0 && refreshBody.indexOf("healthSaveError") < 0);
		const setAt = selfCheckBody.indexOf('await storage.set("sourceHealth"');
		const catchAt = setAt < 0 ? -1 : selfCheckBody.indexOf("} catch (err) {", setAt);
		const catchBlock = catchAt < 0 ? "" : selfCheckBody.slice(catchAt, catchAt + 700);
		check("engine-api.js 里唯一那笔 sourceHealth 写入在 selfCheck() 函数体内",
			setAt >= 0);
		check("引擎写 sourceHealth 的那一笔包在 try/catch 里",
			setAt >= 0 && catchAt > setAt && /healthSaveError = String\(/.test(catchBlock),
			selfCheckBody.slice(Math.max(0, setAt - 120), setAt + 80));
		check("catch 里只记内存标记 + console.warn，**不许 rethrow**（吞掉才不影响自检报告）",
			catchBlock.length > 0 && !/\bthrow\b/.test(catchBlock) && /console\.warn\("\[gacha-calendar\] 来源健康存档/.test(catchBlock),
			catchBlock.slice(0, 200));
		check("自检时间那笔写入也在 selfCheck() 里（与存档同一段尽力而为）",
			selfCheckBody.indexOf('await storage.set("healthCheckedAt"') >= 0
			&& refreshBody.indexOf('storage.set("healthCheckedAt"') < 0);
		check("healthSaveError 的赋值全在 selfCheck() 里（let 声明 1 处 + 清空/失败各 1 处；refresh 一处都没有）",
			(api.match(/healthSaveError = /g) || []).length === 3
			&& (selfCheckBody.match(/healthSaveError = /g) || []).length === 2
			&& refreshBody.indexOf("healthSaveError") < 0,
			JSON.stringify({ all: (api.match(/healthSaveError = /g) || []).length, inSelfCheck: (selfCheckBody.match(/healthSaveError = /g) || []).length }));
		check("引擎对外暴露 healthSaveError()（设置页只读内存值，不新增存储键、不做 IO）",
			/healthSaveError\(\) \{ return healthSaveError; \}/.test(api));
		const clientFiles = readdirSync(SRC).filter((f) => f.endsWith(".js"));
		const healthWriters = clientFiles.filter((f) => {
			const t = readFileSync(path.join(SRC, f), "utf8");
			return t.indexOf('set("sourceHealth"') >= 0 || t.indexOf('set("healthCheckedAt"') >= 0;
		});
		check("src/client 里只有 engine-api.js 写 sourceHealth / healthCheckedAt（没有第二条写入路径）",
			healthWriters.join(",") === "engine-api.js", healthWriters.join(","));
		check("全 src/client 里 `set(\"sourceHealth\"` 只有一处（唯一写入口，不是两套并行）",
			clientFiles.reduce((n, f) => n + (readFileSync(path.join(SRC, f), "utf8").split('set("sourceHealth"').length - 1), 0) === 1,
			String(clientFiles.reduce((n, f) => n + (readFileSync(path.join(SRC, f), "utf8").split('set("sourceHealth"').length - 1), 0)));

		const helpers = readFileSync(path.join(SRC, "60-helpers.js"), "utf8");
		check("N 天阈值只有一处字面量（SOURCE_HEALTH_NOMATCH_DAYS = 7）",
			/const SOURCE_HEALTH_NOMATCH_DAYS = 7;/.test(helpers));
		check("判定里不许再散写 7 天（阈值必须读常量）",
			!/nomatchSince[^\n]*7\s*\*\s*86400000/.test(helpers.replace(/const SOURCE_HEALTH_NOMATCH_DAYS = 7;/, "")));
	}

	// ── ⑦ 设置页接线（静态）：一张卡 + 状态条 + 四列网格 + 渲染路径无 IO ──────────────
	// 用户 2026-10-28 明确：「来源健康」是「解析器自检」的**升级替代**，同一张卡里不许并存两套
	// （旧卡 = 解析器自检 + [开始自检] + 一句说明 + 来源健康 + 自检报告）。同日二次重做
	// （原话「很简陋，整个重做，做好看点」）后的形态 = 标题行 + 状态条（圆点 / 主文案 / 次要信息 /
	// 展开按钮）+ 四列网格列表 + 一行空状态 + 一行自检报告。下面钉住重做后的事实：
	// 标题仍叫「解析器自检」、只有一个按钮且文案「立即检查」、旧说明句已删、健康块**无条件下渲染**。
	{
		const comp = readComponentsSource();
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

		// ── 卡片形态（标题还在、只有一个按钮、旧说明句已删）──
		const cardAt = comp.lastIndexOf("解析器自检");
		const card = cardAt < 0 ? "" : comp.slice(Math.max(0, cardAt - 240), cardAt + 6000);
		check("卡片标题仍是「解析器自检」（不是被改成「来源健康」）",
			cardAt >= 0 && /children: "解析器自检"/.test(card), card.slice(0, 120));
		check("旧说明句「逐个来源检查，区分「无匹配/未公布」与「失败」」已删除（内容已被健康列表覆盖）",
			comp.indexOf("逐个来源检查") < 0);
		check("卡片里只有一个主操作按钮（[立即检查]；「查看全部」是列表展开开关，不是第二个动作），文案「立即检查」",
			(card.match(/gacha-cal-refresh gacha-cal-sort-btn/g) || []).length === 1
			&& /children: selfChecking \? "检查中…" : "立即检查"/.test(card)
			&& comp.indexOf("开始自检") < 0 && comp.indexOf("重新自检") < 0);
		check("「立即检查」仍是原来的 runSelfCheck，busy 时禁用（disabled: selfChecking）",
			/disabled: selfChecking, onClick: runSelfCheck/.test(card) && /await engine\.selfCheck\(\)/.test(comp));

		// ── 状态条：圆点（颜色编码）+ 主文案（左）+ 次要信息（右，弱化）+ 展开按钮 ──
		check("状态条有状态圆点（类名带 tone、颜色档来自 core）+ 主文案三选一",
			/gacha-cal-health-dot gacha-cal-health-dot--" \+ healthTone/.test(card)
			&& /children: healthBad\.length > 0 \? healthBad\.length \+ " 个来源需要关注" : "全部正常"/.test(card));
		check("状态条右侧 = 弱化次要信息 + 展开按钮（aria-expanded 跟着 healthAll，展开后写「只看异常」）",
			/className: "gacha-cal-health-meta", children: healthMeta/.test(card)
			&& /"aria-expanded": healthAll, onClick: \(\) => setHealthAll\(\(v\) => !v\)/.test(card)
			&& /children: healthAll \? "只看异常" : "查看全部"/.test(card));
		check("次要信息口径：有异常 = 正常/停更/失败三档（0 的那档不写）；全正常 =「N 个来源」（无刷新时间）",
			/\[healthOkCount \+ " 正常"/.test(comp)
			&& /healthStaleCount > 0 \? healthStaleCount \+ " 停更" : ""/.test(comp)
			&& /healthDownCount > 0 \? healthDownCount \+ " 失败" : ""/.test(comp)
			&& /: healthKnown\.length \+ " 个来源";/.test(comp));
		check("状态条与列表之间是「1px 极淡分隔线 + 6px 上边距」（CSS 守卫，见 ⑧）",
			/className: "gacha-cal-health-list"/.test(card) && /className: "gacha-cal-health"/.test(card));

		// ── 列表：四列网格（游戏名 / 胶囊 / 原因 / 上次成功），默认只列异常 ──
		check("列表行是四列网格的同一套四个单元格（名字 / 胶囊 / 原因 / 上次成功）",
			/className: "gacha-cal-health-row gacha-cal-health-row--" \+ h\.tone/.test(card)
			&& /className: "gacha-cal-health-name", children: h\.name/.test(card)
			&& /className: "gacha-cal-health-tag gacha-cal-health-tag--" \+ h\.tone, children: h\.tag/.test(card)
			&& /className: "gacha-cal-health-reason", children: h\.reason/.test(card)
			&& /className: "gacha-cal-health-ago", children: h\.agoText/.test(card));
		check("行 tooltip 用 core 给的完整 text（渲染层不另写一套原因措辞）",
			/title: h\.name \+ " · " \+ h\.text/.test(card));
		check("默认只列异常：列表取 healthAll ? healthKnown : healthBad，展开后同网格换全部",
			/healthAll \? healthKnown : healthBad\)\.length > 0/.test(comp)
			&& (comp.match(/healthAll \? healthKnown : healthBad/g) || []).length >= 2);

		// ── 空状态：一行弱化提示 + 图标（不要感叹号），**无条件下渲染** ──
		check("没有任何记录时不再整块不渲染（旧的 healthKnown.length === 0 ? null : 短路已删）",
			comp.indexOf("healthKnown.length === 0 ? null :") < 0);
		check("空状态不再断言「还没刷新过数据」（那会把「写了但被宿主拒绝」说成「从没刷过」）",
			comp.indexOf("还没刷新过数据") < 0);
		// 解耦后「刷新会产生健康数据」这句话已经是错的 ⇒ 空状态改成指路「立即检查」
		check("空状态文案改成「还没有做过来源自检 —— 点「立即检查」开始」（刷新不再产生健康数据）",
			comp.indexOf('"还没有做过来源自检 —— 点「立即检查」开始"') >= 0);
		check("旧的「还没有来源健康数据（刷新一次数据后产生）」已经删掉（那句话现在是假话）",
			comp.indexOf("还没有来源健康数据（刷新一次数据后产生）") < 0);
		check("空状态按引擎的内存标记分岔：写被拒时改说「健康数据暂时无法保存（宿主拒绝写入），不影响刷新」",
			/const healthSaveErr = typeof engine\.healthSaveError === "function" \? engine\.healthSaveError\(\) : ""/.test(comp)
			&& comp.indexOf('"健康数据暂时无法保存（宿主拒绝写入），不影响刷新"') >= 0
			&& comp.indexOf("children: healthSaveErr") >= 0);
		check("引擎没有 healthSaveError 接口的宿主（其它平台）也照常渲染（typeof 兜底成空串）",
			/\? engine\.healthSaveError\(\) : ""/.test(comp));
		check("空状态带图标（refresh svg、弱化色），不用感叹号凑数",
			/className: "gacha-cal-health-empty"/.test(card)
			&& /className: "gacha-cal-health-empty-icon"/.test(card)
			&& card.indexOf("！") < 0);

		// ── 「上次自检 X 前」：解耦后健康数据不再自动更新 ⇒ 新鲜度必须摆在标题行 ──
		check("标题行显示「上次自检 X 前」（读 healthCheckedAt，不是 sourceHealth 的 at）",
			/const healthCheckedAt = Number\(s\.healthCheckedAt\) \|\| 0/.test(comp)
			&& /"上次自检 " \+ tickerSpanText\(healthNow - healthCheckedAt\) \+ "前"/.test(comp));
		check("没有自检过时显示「从未自检」（不是「上次自检 0 分前」这种假新鲜）",
			comp.indexOf('"从未自检"') >= 0);
		check("「上次自检」渲染在标题行（跟标题同一个 head 里、按钮右边留给「立即检查」）",
			/className: "gacha-cal-health-head"/.test(card)
			&& card.indexOf("gacha-cal-health-checked") > card.indexOf("gacha-cal-health-title")
			&& card.indexOf("gacha-cal-health-checked") < card.indexOf('gacha-cal-health-check"'),
			JSON.stringify({ checked: card.indexOf("gacha-cal-health-checked"), btn: card.indexOf('gacha-cal-health-check"') }));
		check("「上次自检」在**空状态**下也照常显示（head 不属于 healthKnown 那一支）",
			card.indexOf("gacha-cal-health-checked") < card.indexOf("healthKnown.length === 0"));
		check("「上次自检」的时间戳来自设置快照（自检写完 ⇒ 宿主推新快照 ⇒ 卡片自己就刷新）",
			/const healthCheckedText = healthCheckedAt > 0/.test(comp)
			&& /children: healthCheckedText/.test(card));

		// ── 自检报告：一行小徽章 + 汇总（完整清单进 title），不再是大段落 ──
		check("自检报告贴在列表下方（同一块的最底部，不再单开一块）",
			card.indexOf("gacha-cal-health-report") > card.indexOf("gacha-cal-health-list"));
		check("自检报告收成一行：小徽章（自检完成 / 自检失败）+ 汇总，贴在列表下方",
			/gacha-cal-health-report-badge", children: "自检完成"/.test(card)
			&& /gacha-cal-health-report-badge--error", children: "自检失败"/.test(card)
			&& /children: selfReportText/.test(card));
		check("逐条 problems 不再渲成大段落（只进 title），旧的「刚检查完：」长句已删除",
			comp.indexOf("selfReport.problems.map") < 0 && comp.indexOf("刚检查完：") < 0);
		check("报告完整明细（游戏数 / 三档 / 逐条 problems）收进 title",
			/const selfReportTitle =/.test(comp)
			&& /selfReport\.problems\.join\("\\n"\)/.test(comp)
			&& /title: selfReportTitle/.test(comp));
		check("自检跑完立刻更新报告：await engine.selfCheck() 之后才 setSelfReport（不是乐观预设）",
			/const report = await engine\.selfCheck\(\);[\s\S]{0,80}setSelfReport\(/.test(comp));

		// 渲染路径不许 IO：卡片那块 JSX 里不许出现 fetch / localStorage / 读文件
		const block = card;
		check("健康面板不发起请求、不读写本地存储、不读文件（渲染路径零 IO）",
			block.length > 0 && !/\bfetch\s*\(|localStorage|readFileSync|XMLHttpRequest/.test(block),
			block.slice(0, 120));

		// 显示侧补偿**已废弃**：设置页不许再把 lastRefresh 传给纯函数（健康与刷新无关）
		const callAt = comp.indexOf("const healthRows = sourceHealthOf(");
		const callSnippet = callAt < 0 ? "" : comp.slice(callAt, callAt + 1200);
		check("sourceHealthOf 的 opts 里只剩 entries：不再传 lastRefreshAt（刷新时间不是健康证据）",
			callAt >= 0 && /entries: applyOrder\(getVisibleEntries\(s\), order\)/.test(callSnippet)
			&& callSnippet.indexOf("lastRefreshAt") < 0,
			callSnippet.slice(0, 260));
		check("全正常时汇总行只有「N 个来源」（「尚未刷新」也已删除，健康卡不提刷新）",
			/: healthKnown\.length \+ " 个来源";/.test(comp)
			&& comp.indexOf("尚未刷新") < 0);
		check("第四列 title 写明语义：自检时观察到的该源最近一次成功解析，不是面板刷新时间",
			/title: h\.name \+ " · " \+ h\.text \+ "\\n第四列「上次成功 X 前」/.test(card)
			&& /由「立即检查」观察，不是面板刷新时间/.test(card));

		// ── 静态反向守卫（用户 2026-10-28 反馈：健康卡里还有"刷新"痕迹 = 没真解耦）──
		// 切片 = 「来源健康」注释/变量区 + 整块健康卡 JSX。这段里**不许**出现 `lastRefresh`
		// （面板刷新时间）或「前刷新」字样 —— 出现即视为解耦失败。
		const varAt = comp.indexOf("// ── 来源健康");
		const varEnd = comp.indexOf("// 自检报告一行结论要用的两个数");
		const hcardAt = comp.indexOf('className: "gacha-cal-health-card"');
		const hcardEnd = comp.indexOf("数据来自各游戏官方公告");
		const healthVars = varAt >= 0 && varEnd > varAt ? comp.slice(varAt, varEnd) : "";
		const healthJsx = hcardAt >= 0 && hcardEnd > hcardAt ? comp.slice(hcardAt, hcardEnd) : "";
		const healthBlock = healthVars + healthJsx;
		check("健康卡切片已定位（注释/变量区 + 整块 JSX）",
			healthVars.length > 1500 && healthJsx.length > 3000,
			JSON.stringify({ vars: healthVars.length, jsx: healthJsx.length, hcardAt, hcardEnd }));
		check("健康卡切片里没有任何 lastRefresh（面板刷新时间不许进健康卡）",
			healthBlock.indexOf("lastRefresh") < 0,
			String(healthBlock.indexOf("lastRefresh")));
		check("健康卡切片里没有「前刷新」字样（全卡只剩标题行一个时间口径）",
			healthBlock.indexOf("前刷新") < 0);
	}

	// ── ⑧ 构建产物里也有（src/ 是唯一真源，产物必须同源）─────────────────────────────
	{
		const client = readFileSync(path.join(REPO, "lib", "client.js"), "utf8");
		check("lib/client.js（客户端产物）里有 sourceHealth 判定",
			client.includes("function sourceHealthOf(") && client.includes("SOURCE_HEALTH_NOMATCH_DAYS"));
		const core = readFileSync(path.join(REPO, "packages", "core", "core.mjs"), "utf8");
		check("packages/core/core.mjs（中立核心产物）里有同一份判定",
			core.includes("function sourceHealthOf(") && core.includes("SOURCE_HEALTH_NOMATCH_DAYS"));

		// ── 四列网格 / 圆点 / 胶囊样式：必须真的进产物，且只用语义变量 ──
		const healthCss = readFileSync(path.join(REPO, "src", "client", "styles", "health.css"), "utf8");
		check("health.css 已进 build.mjs 的 CSS_ORDER（样式文件必须真的进产物，而不是只躺着）",
			/"health\.css"/.test(readFileSync(path.join(REPO, "build.mjs"), "utf8")));
		// 2026-10-28 微调：名字列改 max-content（按内容撑开），原因列吃剩余，胶囊/上次成功各自 max-content / auto。
		// 旧值 minmax(0,1fr) auto minmax(0,1.6fr) auto 会让 2~5 字的名字占满整列，名字与胶囊之间空一大块。
		check("四列网格参数：max-content auto minmax(0,1fr) max-content / gap 9px / padding 6px 8px",
			/grid-template-columns:max-content auto minmax\(0,1fr\) max-content/.test(healthCss)
			&& /gap:9px/.test(healthCss) && /padding:6px 8px/.test(healthCss));
		check("行 overflow:hidden（名字超长也不撑破卡片）+ 名字 max-width:100% 配 ellipsis",
			/\.gacha-cal-health-row\{[^}]*overflow:hidden/.test(healthCss)
			&& /\.gacha-cal-health-name\{[^}]*max-width:100%[^}]*text-overflow:ellipsis/.test(healthCss));
		check("状态圆点 6px + 1px ring；状态胶囊 10px / 细边框 / 同色 9% 底",
			/\.gacha-cal-health-dot\{[^}]*width:6px;height:6px[^}]*box-shadow:0 0 0 1px/.test(healthCss)
			&& /\.gacha-cal-health-tag\{[^}]*font-size:10px/.test(healthCss)
			&& /gacha-cal-health-tag--warn\{[^}]*9%,transparent/.test(healthCss));
		check("汇总行与列表之间的分隔线 = border-l2 的 45%（极淡但看得见，不引入新颜色字面量）",
			/border-top-color:color-mix\(in srgb,var\(--dsw-alias-border-l2[\s\S]*?\) 45%,transparent\)/.test(healthCss));
		check("health.css 的颜色全部走 var(--dsw-alias-*)（没有裸 color:#… 规则）",
			!/[^-]color:#[0-9a-f]{3,8}/i.test(healthCss));
		check("lib/client.js 真的有 .gacha-cal-health-row 网格规则（样式段已拼进产物）",
			client.includes(".gacha-cal-health-row{display:grid"));
		check("lib/client.js 里有四列网格参数（顺序与 health.css 一致）",
			client.includes("grid-template-columns:max-content auto minmax(0,1fr) max-content"));
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

	// ── ⑨ 新版面板开关的一次性迁移（newPanel → newPanelMigrated）─────────────────────
	// 为什么必须补：newPanel 的默认值从 false 改成 true，但**已经存过显式 false 的老用户**
	// 光改默认值无效 —— 只能靠启动时那一笔一次性迁移。它坏掉的两个方向都不报错：
	//   · 漏迁 ⇒ 老用户永远看不到新面板（以为功能没做）；
	//   · 反复迁 ⇒ 用户在设置页关掉，下次启动又被打开展示（以为开关坏了）。
	// 做法 = **真机式桩跑**（与 cases-remind 直接 import lib/remind-core.mjs 同一思路）：
	//   把 src/index.js **原文**搬到临时目录，只把两处 import 指向本地桩
	//   （@deepseek-ai/schemastery 与 ./remind-core.mjs —— 仓库没有 node_modules，这两个是真的
	//   外部依赖；桩只负责"让宿主代码能被 import 起来"，迁移逻辑一行不抄），
	//   再用假 ctx 真调 apply() 与真实导出的 migrateNewPanelOnce()。
	// ⚠️ 迁移函数没有导出（宿主内部实现，不该为测试改导出面）⇒ 只在这份**临时副本**末尾补一行
	//    export；src/index.js 一个字都不动。
	// ⚠️ LOCALAPPDATA 指向临时目录：迁移日志 / identity.json 不写进真实用户目录。
	// ⚠️ 假 ctx.effect 只记账不执行 ⇒ registerRemindTimer 的 setInterval 不会起来，门禁不挂住。
	{
		const prevLocalAppData = process.env.LOCALAPPDATA;
		const box = mkdtempSync(path.join(os.tmpdir(), "dsh-migrate-" + process.pid + "-"));
		try {
			const modDir = path.join(box, "mod");
			const runDir = path.join(box, "run");       // = 假的 %LOCALAPPDATA%
			const stateDir = path.join(runDir, "dsh-gacha-calendar");
			mkdirSync(modDir, { recursive: true });
			mkdirSync(stateDir, { recursive: true });
			process.env.LOCALAPPDATA = runDir;
			const logFile = path.join(stateDir, "remind.log");
			// identity.json 先放一份：apply 的启动预热看到"有缓存"就走毫秒路径、**不排后台探测**
			// （桩里的 notifyIdentityCacheOf 恒回 useCached ⇒ 不会起 PowerShell、不碰真实开始菜单）。
			writeFileSync(path.join(stateDir, "identity.json"), "{}\n", "utf8");

			// 桩 1：schemastery —— 只用链式 DSL 构造 schema，所以"每个方法都返回自己"就够。
			writeFileSync(path.join(modDir, "z-stub.mjs"), `function chain() {
	const o = {
		default: () => o, min: () => o, max: () => o, volatile: () => o,
		object: () => o, array: () => o, string: () => o, boolean: () => o, number: () => o
	};
	return o;
}
const z = { object: () => chain(), boolean: () => chain(), number: () => chain(), string: () => chain(), array: () => chain() };
export default z;
`, "utf8");
			// 桩 2：remind-core —— 迁移完全不碰提醒；具名导出的名字必须齐（缺一个 ESM 导入直接报错）。
			// 2026-10-30 跨平台改造后宿主新增了 HOST_STATE_DIR_NAME / hostStateDirOf / notifyChannelOf /
			// NOTIFY_CHANNEL_* / remindAppleScriptOf 的导入 ⇒ 桩必须一起导出。桩的 hostStateDirOf 只是
			// "能被 import 起来"：固定回假 LOCALAPPDATA 下的 dsh-gacha-calendar（真实的三平台解析规则
			// 由 cases-remind.mjs 的「跨平台」一节按纯函数逐项钉住），这样迁移日志仍然落在临时目录里。
			writeFileSync(path.join(modDir, "remind-core-stub.mjs"), `export const NOTIFY_IDENTITY_MAX_AGE_MS = 86400000;
export const HOST_STATE_DIR_NAME = "dsh-gacha-calendar";
export const NOTIFY_CHANNEL_WINRT = "winrt-toast";
export const NOTIFY_CHANNEL_OSASCRIPT = "osascript";
export const NOTIFY_CHANNEL_NONE = "none";
export function hostStateDirOf(env) {
	const base = env && typeof env.LOCALAPPDATA === "string" ? env.LOCALAPPDATA.trim() : "";
	return base === "" ? "" : base + "/" + HOST_STATE_DIR_NAME;
}
export function notifyChannelOf() { return NOTIFY_CHANNEL_WINRT; }
export function remindAppleScriptOf() { return ""; }
export function notifyIdentityCacheOf() {
	return { useCached: true, shouldRefresh: false, state: { enabled: false, name: "stub", aumid: "stub", shortcutPath: "" } };
}
const empty = () => ({});
export const notifyIdentityFallbackOf = empty;
export const notifyNameOf = () => "stub";
export const notifyShortcutPickOf = empty;
export const remindConfigOf = empty;
export const remindIdentityOf = empty;
export const remindItemsOf = () => [];
export const remindOnOf = () => false;
export const remindStateOf = empty;
export const remindTestToastOf = empty;
export const remindTickOf = () => ({ toNotify: [], stateNext: {} });
export const remindToastOf = () => ({ title: "stub", lines: [] });
export const remindAllowedTickOf = () => ({ toNotify: [], stateNext: {}, allowed: 0, skipped: 0 });
export const remindGamesOf = (value, fallback) => (Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : []));
`, "utf8");

			const srcText = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
			check("桩跑前置：src/index.js 里仍有可替换的 schemastery 导入行（漂移了就重写这条用例）",
				srcText.includes('import z from "@deepseek-ai/schemastery";'));
			const stubbed = srcText
				.replace('import z from "@deepseek-ai/schemastery";', 'import z from "./z-stub.mjs";')
				.replace('} from "./remind-core.mjs";', '} from "./remind-core-stub.mjs";');
			check("桩跑前置：两处 import 都替换成功（否则测的不是真实代码路径）",
				stubbed.includes('"./z-stub.mjs"') && stubbed.includes('"./remind-core-stub.mjs"')
				&& !stubbed.includes("@deepseek-ai/schemastery") && !stubbed.includes('"./remind-core.mjs"'));
			const moduleFile = path.join(modDir, "index.mjs");
			writeFileSync(moduleFile, stubbed + "\nexport { migrateNewPanelOnce };\n", "utf8");
			const mod = await import(pathToFileURL(moduleFile).href);
			check("桩跑能加载真实宿主代码：导出 apply / Config / migrateNewPanelOnce",
				typeof mod.apply === "function" && typeof mod.migrateNewPanelOnce === "function" && !!mod.Config);

			const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");
			const volatileOf = (value) => ({ get: () => value, [VOLATILE_WRITE]: () => {} });
			// 假 settings：update 的**每一笔**都记账（迁移只许写一笔、且键集合固定）。
			const settingsOf = (mode) => {
				const updates = [];
				return {
					updates,
					configure() { /* apply 会调，无副作用 */ },
					async update(ns, patch) {
						updates.push({ ns, patch, keys: Object.keys(patch).sort().join(",") });
						if (mode === "throw") throw new Error("boom-from-settings");
					}
				};
			};
			// 假 ctx：inject("settings") 同步回调（真机是异步，但迁移做的事与时序无关）；
			// effect 只记账不执行 —— 定时器一旦真起来会挂住门禁。
			const ctxOf = (config, settings) => {
				const trace = [];
				const fiber = { config };
				const effect = () => { trace.push("effect"); return () => {}; };
				const ctx = {
					fiber,
					root: { loader: {
						await: async () => { trace.push("loader.await"); },
						locate: (f) => { trace.push(f === fiber ? "locate(fiber)" : "locate(other)"); return "gacha-calendar"; }
					} },
					effect,
					inject(deps, cb) {
						trace.push("inject:" + deps.join("+"));
						if (deps.includes("settings")) cb({ effect, settings });
					}
				};
				return { ctx, trace };
			};
			const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
			const logText = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
			const migLogged = () => (logText().match(/新面板迁移/g) || []).length;

			// ① 首次迁移（标记缺失）：走 apply() 的真实接线 —— 一笔写入、patch 恰好两个键
			// ⚠️ 配置里带 `refreshMigrated: true`：宿主 apply 里还有**另一条**一次性迁移（刷新频率
			//    迁到「启动时」，见 src/index.js 的 migrateRefreshOnce，用例在 cases-refresh ⑭；
			//    它是**无条件**写 0 的，这里只靠标记让它 return）。
			//    让它直接 return，这里测的 newPanel 那一笔才不会被第二笔写入混进来。
			{
				const config = { newPanel: false, refreshMigrated: true };
				const settings = settingsOf();
				const { ctx, trace } = ctxOf(config, settings);
				let threw = null;
				try { mod.apply(ctx, config); await settle(); } catch (err) { threw = err; }
				check("① apply() 不被迁移拖住、两处注入都正常走完（settings + webServer）",
					threw === null && trace.includes("inject:settings") && trace.includes("inject:webServer"),
					threw ? String(threw.message) : trace.join("|"));
				check("① 标记缺失 ⇒ settings.update 恰好被调 1 次",
					settings.updates.length === 1, String(settings.updates.length));
				const u = settings.updates[0] || { ns: "", patch: {}, keys: "" };
				check("① 写入的条目 id = loader.locate(ctx.fiber) 的结果（不写死 id：用户改名也迁得动）",
					u.ns === "gacha-calendar" && trace.includes("locate(fiber)"), u.ns + " / " + trace.join("|"));
				check("① patch 恰好是 { newPanel: true, newPanelMigrated: true }（值 + 键集合都对）",
					!!u.patch && u.patch.newPanel === true && u.patch.newPanelMigrated === true
					&& u.keys === "newPanel,newPanelMigrated", JSON.stringify(u.patch));
				check("① patch 只有那 2 个键（多一个键都不行）",
					!!u.patch && Object.keys(u.patch).length === 2, String(u.patch && Object.keys(u.patch).length));
				check("① 先等 loader.await() 再 locate/写（加载中途写会撞 configuration entry is no longer available）",
					trace.indexOf("loader.await") >= 0 && trace.indexOf("loader.await") < trace.indexOf("locate(fiber)"),
					trace.join("|"));
				check("① 迁移成功留了日志（含条目 id）",
					logText().includes("新面板迁移：条目 gacha-calendar 的 newPanel 已一次性写成 true"));
			}

			// ①b 标记**显式 false**，且配置是 DSH 真实的 volatile 引用形态（不是裸值）
			{
				const config = { newPanel: volatileOf(false), newPanelMigrated: volatileOf(false) };
				const settings = settingsOf();
				const { ctx } = ctxOf(config, settings);
				await mod.migrateNewPanelOnce(ctx, config, settings);
				check("①b newPanelMigrated 裸值为 false（volatile 引用形态）⇒ 仍然迁，且只写 1 笔",
					settings.updates.length === 1, String(settings.updates.length));
				check("①b volatile 形态下 patch 还是那两个键（解包没把写入写歪）",
					!!settings.updates[0] && settings.updates[0].keys === "newPanel,newPanelMigrated",
					JSON.stringify(settings.updates[0] && settings.updates[0].patch));
			}

			// ② 已迁移（标记 true）：零动作 —— 用户关掉后不许被反复打开
			{
				const config = { newPanel: false, newPanelMigrated: true };
				const settings = settingsOf();
				const { ctx } = ctxOf(config, settings);
				const before = migLogged();
				await mod.migrateNewPanelOnce(ctx, config, settings);
				check("② 标记已是 true ⇒ settings.update 零次调用",
					settings.updates.length === 0, String(settings.updates.length));
				check("② 已迁移时连日志都不写（不是「迁了但没变」）",
					migLogged() === before, String(migLogged() - before));
			}

			// ③ 失败不崩：update 抛错 ⇒ 函数不抛、只记日志；apply() 本身仍完成
			{
				const settings = settingsOf("throw");
				const { ctx } = ctxOf({}, settings);
				let threw = null;
				try { await mod.migrateNewPanelOnce(ctx, {}, settings); } catch (err) { threw = err; }
				check("③ update 抛错时 migrateNewPanelOnce 不抛（整段 try/catch）",
					threw === null, String(threw && threw.message));
				check("③ 抛错时也只尝试 1 笔（没有重试循环，不会每启动刷日志）",
					settings.updates.length === 1, String(settings.updates.length));

				const settings2 = settingsOf("throw");
				const { ctx: ctx2, trace } = ctxOf({}, settings2);
				let threw2 = null;
				try { mod.apply(ctx2, {}); await settle(); } catch (err) { threw2 = err; }
				check("③ apply() 本身仍然完成（不因迁移失败而抛/中断）",
					threw2 === null && trace.includes("inject:settings") && trace.includes("inject:webServer"),
					String(threw2 && threw2.message));
				check("③ 失败被记进日志（异常原文 + 下次启动重试），不是静默吞掉",
					logText().includes("新面板迁移失败（不影响插件加载，下次启动重试）")
					&& logText().includes("boom-from-settings"));
			}

			// ④ 只迁一次：第二次（假配置里的标记已变 true，模拟 settings 写入后重载）零调用
			// （同样先关掉刷新频率那条迁移：`refreshMigrated: true`，见 ① 的说明）
			{
				const config = { refreshMigrated: true };
				const settings = settingsOf();
				mod.apply(ctxOf(config, settings).ctx, config);
				await settle();
				check("④ 第一次（标记缺失）：1 笔写入", settings.updates.length === 1, String(settings.updates.length));
				config.newPanelMigrated = true;          // 模拟这笔写入真的落进了配置
				mod.apply(ctxOf(config, settings).ctx, config);
				await settle();
				check("④ 第二次（标记已 true）：零新增调用 —— 用户自己关掉后永不再被覆写",
					settings.updates.length === 1, String(settings.updates.length));
			}

			// ⑤ 静态度量：void 触发（不 await）、整段 try/catch、只许写 true
			{
				const applyText = srcText.slice(srcText.indexOf("export function apply("));
				check("⑤ apply() 里是 void 触发迁移（不 await：一次配置写入不许拖慢插件加载）",
					/void migrateNewPanelOnce\(ctx, config, settingsCtx\.settings\);/.test(applyText)
					&& !/await migrateNewPanelOnce\(/.test(srcText));
				const fnAt = srcText.indexOf("async function migrateNewPanelOnce(");
				const fnEnd = fnAt >= 0 ? srcText.indexOf("\n}\n", fnAt) : -1;
				const fnText = fnAt >= 0 && fnEnd > fnAt ? srcText.slice(fnAt, fnEnd) : "";
				check("⑤ 迁移函数切片已定位（静态断言没瞎）", fnText.length > 800, String(fnText.length));
				check("⑤ 整段包在 try/catch 里（失败只记日志，绝不让插件加载失败）",
					/try \{/.test(fnText) && /\} catch \(err\) \{/.test(fnText));
				check("⑤ 只有一笔写入，字面就是 { newPanel: true, newPanelMigrated: true }（不留半状态）",
					(fnText.match(/settings\.update\(/g) || []).length === 1
					&& /await settings\.update\(ns, \{ newPanel: true, newPanelMigrated: true \}\);/.test(fnText));
				check("⑤ 标记判定读**裸值**且严格 === true（volatile 引用不解包会永远读到 undefined）",
					/if \(configValueOf\(cfg, "newPanelMigrated"\) === true\) return;/.test(fnText));
				// ⚠️ 必须滤掉注释行再扫：本函数的 JSDoc 里就写着「老用户存过 newPanel: false」这句背景，
				//    直接全文扫会把它当违规（假失败）。所以只看"非 // / * / /* 开头"的代码行。
				const srcFiles = ["src", path.join("src", "client")]
					.flatMap((d) => readdirSync(path.join(REPO, d)).filter((f) => f.endsWith(".js")).map((f) => path.join(d, f)));
				const writers = srcFiles.filter((f) => /["']?newPanel["']?\s*:\s*false/.test(
					readFileSync(path.join(REPO, f), "utf8").split("\n")
						.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")));
				check("⑤ src/ 全库没有任何地方把 newPanel 写成 false（迁移只许写 true）",
					writers.length === 0, writers.join(","));
				check("⑤ schema 默认值：newPanel=true / newPanelMigrated=false，且两者都 .volatile()（否则写入被拒）",
					/newPanel: z\.boolean\(\)\.default\(true\)\.volatile\(\)/.test(srcText)
					&& /newPanelMigrated: z\.boolean\(\)\.default\(false\)\.volatile\(\)/.test(srcText));
			}
		} catch (err) {
			check("⑨ 迁移用例整套能跑完（抛异常即视为失败，见 detail）", false, String((err && err.stack) || err));
		} finally {
			if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
			else process.env.LOCALAPPDATA = prevLocalAppData;
			try { rmSync(box, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响门禁 */ }
		}
	}
}
