// test/cases-core.mjs —— core 产物（packages/core/core.mjs）守卫
//
// ── 为什么需要它 ──
// 2026-10-03 用户选方案 C2：把另外 17 款游戏的解析器也纳入 `CORE_ORDER`，并把
// `43-sources-register.js` 并进 `40-fetchers.js`。这带来一条**很容易踩、且症状隐蔽**的约束：
//
//   · `20-source-core.js`（含 `SOURCES` 数组）在 core 里位于**模块顶层** → 所有引擎共享同一份；
//   · `22-fetcher-core.js` 在 **`createEngine` 内部** → **每建一个引擎就重跑一遍**；
//   · 而并进来的那段会往 `SOURCES` 里**追加**条目（17 条 + `bh3`）并给既有条目挂备选源。
//
//   于是只要有一处不是幂等的，**多建几个引擎就会让来源表越堆越长** ——
//   表现为"同一个游戏在面板里出现两次""备选源列表越来越长"，而**不会报任何错**。
//   本文件就是这条约束的回归守卫（恰好建了两个引擎；它是软断言、退出码恒 0）。
//
// 顺带守一件事：core 必须**零宿主依赖**（build.mjs 有静态检查，这里再用运行时行为兜一层——
// 在纯 Node 环境里建引擎并跑一次 listGames/getCached，不碰 window/document）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { createEngine } from "../packages/core/core.mjs";
import { check, section, useFixtures } from "./harness.mjs";
import { T, REPO } from "./load.mjs";

export default async function runCore() {
	section("core 产物（零宿主依赖 + 注册幂等）");

	const noopTransport = {
		async fetchRaw() { throw new Error("no-network"); },
		async fetchViaProxy() { throw new Error("no-network"); }
	};
	const makeStorage = () => {
		const m = new Map();
		return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
	};

	// ① 模块顶层的 SOURCES 在多次建引擎后**不得增长**（幂等）
	{
		const e1 = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		const n1 = e1.__test.SOURCES.length;
		const ids1 = e1.__test.SOURCES.map((s) => s.id);
		const e2 = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		const n2 = e2.__test.SOURCES.length;
		const ids2 = e2.__test.SOURCES.map((s) => s.id);
		check("多次 createEngine 不会让 SOURCES 变长（注册必须幂等）", n1 === n2, `第一次=${n1} 第二次=${n2}`);
		check("多次 createEngine 后来源 id 集合完全一致", JSON.stringify(ids1) === JSON.stringify(ids2),
			`${ids1.length} vs ${ids2.length}；多出来的：${ids2.filter((i) => !ids1.includes(i)).join(",") || "无"}`);
		check("来源 id 无重复（堆叠会直接体现为重复 id）", new Set(ids1).size === ids1.length,
			ids1.filter((i, k) => ids1.indexOf(i) !== k).join(","));
		// 备选源也不能堆叠（并进来的那段会给 genshin/hsr/zzz 挂米游社备选源）
		const altMax = Math.max(...e1.__test.SOURCES.map((s) => (s.altSources || []).length), 0);
		const e3 = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		const altMax3 = Math.max(...e3.__test.SOURCES.map((s) => (s.altSources || []).length), 0);
		check("多次 createEngine 不会让 altSources 变长", altMax === altMax3, `${altMax} vs ${altMax3}`);
	}

	// ② core 覆盖全部 28 款（C2 之后的范围），且内置 11 款仍在
	{
		const e = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		const ids = e.__test.SOURCES.map((s) => s.id);
		check("core 来源总数 = 28（内置 11 + 另外 17）", ids.length === 28, String(ids.length));
		const builtin = ["genshin", "hsr", "zzz", "wuwa", "arknights", "endfield", "ba-cn", "ba-global", "ba-jp", "r1999", "nte"];
		check("内置 11 款都还在", builtin.every((i) => ids.includes(i)), builtin.filter((i) => !ids.includes(i)).join(","));
		const extra = ["p5x", "zspms", "czn", "kedr", "ddlezj", "bh3", "stellasora", "fgo", "gf2", "bandori", "pjsk"];
		check("另外 17 款的代表条目也在（C2 后 core 不再只有内置）", extra.every((i) => ids.includes(i)), extra.filter((i) => !ids.includes(i)).join(","));
	}

	// ③ 纯 Node 环境可用（没有 window / document）
	{
		const e = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		let ok = true, err = "";
		try {
			const games = await e.listGames();
			ok = Array.isArray(games) && games.length > 0;
			await e.getCached();
		} catch (e2) { ok = false; err = String((e2 && e2.message) || e2); }
		check("纯 Node 下 listGames / getCached 可用（core 零宿主依赖）", ok, err);
		check("本测试环境确实没有 window/document（否则上面那条不算数）", typeof window === "undefined" && typeof document === "undefined");
	}

	// ④ 数据层数组（P1，2026-11-07）：`gacha` / `events`
	//
	// ── 为什么需要它 ──
	// 用户定的方向：数据核心只放**事实**，"谁排第一"是**纯展示决策**（P2 才下移到显示层），
	// 表格与探头最终共用同一份数组。P1 只做数据层：两个数组 **从现有字符串字段合成**，
	// 旧字段一个不删、值一字不改（所以面板行为必须**逐字不变**）。
	//
	// 这一段守四件事，任何一件错了都不会报错、只会"看起来正常"：
	//   ① **条数与顺序**：数组 = 每口池/每条活动一条，顺序 = 结束时间升序（与悬停同一口径），
	//      且**数据层不挑选**外显那条（`events[0]` 可以不是面板显示的那条 —— 赛马娘国服就是）；
	//   ② **与旧字段一致**：把改造前（HEAD）跑出来的 12 个字符串字段逐字钉在这里 ——
	//      合成过程要是顺手改写了任何旧字段，这几条就会红；
	//   ③ **持久化**：数组经 `createEngine().getCached()` 往返后仍在（含 `phase`），
	//      白名单漏一处就会静默变空数组；归一还做最少校验（非对象丢弃、ts 非 number ⇒ null）；
	//   ④ **白名单六处**（任务书点名）：GACHA_FIELDS / EVENT_FIELDS / CONTENT_FIELDS 的数组分支 /
	//      渲染层逐字段拷贝 / listGames().defaults —— 用静态断言钉住，免得下次"加了字段忘了登记"。
	{
		const fixture = useFixtures();
		// 夹具 transport（与 cases-health 的 fgoTransport 同一套包装：直连 + 宿主代理）
		const transport = {
			async fetchRaw(url, opts) {
				const r = await fixture(url, opts);
				return { ok: r.ok, status: r.status, text: () => r.text(), json: () => r.json() };
			},
			async fetchViaProxy(url, opts) {
				const o = opts || {};
				let api = "/api/gacha-calendar-proxy?url=" + encodeURIComponent(String(url));
				api += "&referer=" + encodeURIComponent(o.referer || "");
				if (o.headers) api += "&headers=" + encodeURIComponent(JSON.stringify(o.headers));
				const r = await fixture(api);
				if (!r.ok) throw new Error("proxy-http-" + r.status);
				const wrapped = JSON.parse(await r.text());
				if (wrapped.status !== 200) throw new Error("proxy-bad:" + wrapped.status);
				return wrapped.body;
			}
		};
		const makeStore = (seed) => {
			const m = new Map(Object.entries(seed || {}));
			return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
		};
		const ids = createEngine({ transport, storage: makeStore(), now: () => 0 }).__test.SOURCES.map((s) => s.id);
		// 只让目标游戏「可见」（其余全部隐藏）⇒ 一轮 refresh 只发该游戏的两侧请求
		const only = (id) => ({ hidden: ids.filter((x) => x !== id) });
		// 真跑一轮 refresh（夹具 fetch + 固定时钟 = 夹具抓取时刻），返回归一后的记录
		const runGame = async (id, now, extra) => {
			const storage = makeStore(Object.assign(only(id), extra || {}));
			const engine = createEngine({ transport, storage, now: () => now, timer: { setTimeout, clearTimeout } });
			const result = await engine.refresh();
			return { rec: result.games[id] || {}, engine, storage };
		};
		const isNum = (v) => typeof v === "number" && isFinite(v);
		const ascending = (list) => list.every((x, i) => i === 0 || (x.endTs == null ? Infinity : x.endTs) >= (list[i - 1].endTs == null ? Infinity : list[i - 1].endTs));
		// 各游戏的固定时钟 = 夹具的抓取时刻（不随跑测日期漂移；与 cases-p4 / cases-b3 同一口径）
		const NOW_ARK = Date.parse("2026-11-07T00:00:00.000Z");   // 明日方舟：墟 已进**兑换期**
		const NOW_FGO = Date.parse("2026-10-01T17:26:29.000Z");
		const NOW_UMA = Date.parse("2026-10-01T17:26:14.153Z");
		const NOW_GEN = Date.parse("2026-10-02T14:37:53.720Z");

		// ── ④-0 改造前的 12 个字符串字段（**逐字基线**，取自 HEAD 39d41a5 跑同一批夹具的结果）──
		// 值一个都不许变：数组是**新增**的事实，不是"顺手重写旧字段"的借口。
		const OLD_FIELDS = [
			"banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover",
			"event", "eventDates", "eventDatesRaw", "eventShow", "eventClaimDates", "eventHover", "eventHoverExtra"
		];
		const BASE_ARK = {
			banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", bannerHover: "",
			event: "支线故事：墟",
			eventDates: "11-07 03:59 ~ 11-10 03:59",
			eventDatesRaw: "11-07 03:59 ~ 11-10 03:59",
			eventShow: "支线故事：墟 兑换截止",
			eventClaimDates: "11-07 03:59 ~ 11-10 03:59",
			eventHover: "支线故事：墟 兑换截止   11-07 03:59 ~ 11-10 03:59\n危机合约：尖灭测试作战   11-01 04:00 ~ 11-15 03:59\n支线故事：火山旅梦   11-05 04:00 ~ 11-19 03:59",
			eventHoverExtra: "支线故事：火山旅梦\n支线故事：火山旅梦 兑换截止   11-22 03:59"
		};
		const BASE_FGO = {
			banner: "「OVER THE SAME SKY-SEPTEMBER-」推荐召唤",
			roles: "阿蒂拉 罗摩 兰斯洛特(Saber) 魁札尔·科亚特尔 反抗军的Rider 弗兰肯斯坦 谜之女主角X〔Alter〕 阿尔托莉雅·潘德拉贡(Ruler) 芦屋道满 妖精骑士兰斯洛特 库库尔坎 大和武尊 堤丰·厄斐墨洛斯",
			bannerDates: "09-22 19:00 ~ 10-06 13:59",
			bannerDatesRaw: "2026年9月22日(周二) 19:00 ~ 2026年10月6日(周二) 13:59",
			bannerHover: "「OVER THE SAME SKY-SEPTEMBER-」推荐召唤\n09-22 19:00 ~ 10-06 13:59\n唠唠叨叨新选组 THE END推荐召唤2：土方岁三、冲田总司、斋藤一、山南敬助、永仓新八\n09-26 19:00 ~ 10-15 13:59\n唠唠叨叨新选组 THE END 近藤勇推荐召唤：藤堂平助、近藤勇\n09-30 19:00 ~ 10-15 13:59\n唠唠叨叨新选组 THE END 河上彦斋推荐召唤：河上彦斋、藤堂平助\n09-24 19:00 ~ 10-22 13:59",
			event: "幕末武斗神话 唠唠叨叨新选组 THE END REVENGE OF MAKOTO",
			eventDates: "09-24 19:00 ~ 10-15 13:59",
			eventDatesRaw: "2026年9月24日(周四)19:00 ~ 2026年10月15日(周四)13:59",
			eventShow: "", eventClaimDates: "",
			eventHover: "幕末武斗神话 唠唠叨叨新选组 THE END REVENGE OF MAKOTO   09-24 19:00 ~ 10-15 13:59\nFinal Order Project [Lostbelt No.1]通关应援纪念活动   08-11 19:00 ~ 10-31 13:59\nFinal Order Project [Lostbelt No.2]通关应援纪念活动   08-18 19:00 ~ 10-31 13:59\nFinal Order Project [Lostbelt No.3]通关应援纪念活动   08-25 19:00 ~ 10-31 13:59\nFinal Order Project [Lostbelt No.4]通关应援纪念活动   09-01 19:00 ~ 10-31 13:59\nFinal Order Project [Lostbelt No.5]通关应援纪念活动   09-08 19:00 ~ 10-31 13:59\nFinal Order Project [Lostbelt No.6]通关应援纪念活动   09-15 19:00 ~ 10-31 13:59\nFinal Order Project [Lostbelt No.7]通关应援纪念活动   09-22 19:00 ~ 10-31 13:59\nFinal Order Project [Ordeal Call Ⅰ]通关应援纪念活动   09-29 19:00 ~ 12-20 13:59",
			eventHoverExtra: ""
		};
		const BASE_UMA = {
			banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", bannerHover: "",
			event: "赛事活动“群英联赛 中距离”",
			eventDates: "10-01 12:00 ~ 10-07 11:59",
			eventDatesRaw: "10/1 12:00 ～ 10/711:59",
			eventShow: "", eventClaimDates: "",
			eventHover: "第1轮   10-01 12:00 ~ 10-03 11:59\n联赛报名期间   09-28 12:00 ~ 10-05 11:59\n活动期间   10-01 12:00 ~ 10-07 11:59",
			eventHoverExtra: ""
		};

		// ── ④-1 原神（米游社夹具）：卡池侧**没有内容** ⇒ 空数组；活动侧 1 条 ──────────
		// 为什么走"抓取器 → mergeEntryRecord"而不是 refresh()：原神的默认卡池源是
		// 「Bwiki 往期祈愿」（仓库里没有它的夹具），而米游社祈愿公告**正文无日期**（p4 已钉住 ⇒ null）。
		// 活动侧同理用米游社那条真实请求（它的备选源表是嵌套表，走 source 路径取不到 —— 与本次改造无关）。
		{
			const probe = createEngine({ transport, storage: makeStore(), now: () => NOW_GEN, timer: { setTimeout, clearTimeout } });
			const gf = probe.__test.GACHA_FETCHERS, ef = probe.__test.EVENT_FETCHERS;
			const miyoushe = (gids, type) => "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=" + gids + "&type=" + type + "&page_size=20";
			const genGacha = await gf["genshin-miyoushe"](miyoushe(2, 1), undefined, "Asia/Shanghai");
			const genEvent = await ef["genshin"]["genshin-miyoushe"].default(miyoushe(2, 2), undefined, "Asia/Shanghai");
			const meta = { id: "genshin", tz: "Asia/Shanghai" };
			const recG = probe.__test.mergeEntryRecord({ data: genGacha || {} }, null, NOW_GEN, meta);
			const recE = probe.__test.mergeEntryRecord({ data: genEvent || {} }, null, NOW_GEN, meta);
			check("原神：卡池侧无内容（祈愿公告正文无日期）⇒ `gacha` 是**空数组**（固定形状，不是 undefined/空串）",
				Array.isArray(recG.gacha) && recG.gacha.length === 0, JSON.stringify(recG.gacha));
			check("原神：活动侧 = 1 条（当期只有这一条活动）",
				Array.isArray(recE.events) && recE.events.length === 1, JSON.stringify(recE.events && recE.events.length));
			const ev = (recE.events || [])[0] || {};
			check("原神：活动条第 1 条的 title / show / raw 逐字（title 是源站名，show 与显示层一致）",
				ev.title === "【有奖活动】10月生日会话题活动开启！"
				&& ev.show === "【有奖活动】10月生日会话题活动开启！"
				&& ev.raw === "2026年10月2日-2026年10月31日23:59",
				JSON.stringify([ev.title, ev.show, ev.raw]));
			check("原神：活动条的 key / tz / startTs / endTs 类型齐备（key 带游戏 id，ts 是 number）",
				ev.key === "genshin:event:0" && ev.tz === "Asia/Shanghai" && isNum(ev.startTs) && isNum(ev.endTs) && ev.startTs < ev.endTs,
				JSON.stringify([ev.key, ev.tz, ev.startTs, ev.endTs]));
			check("原神：没有兑换期 ⇒ 事件条上**没有** `phase` 这个键（不是空对象）",
				!("phase" in ev), JSON.stringify(Object.keys(ev)));
		}

		// ── ④-2 明日方舟：`phase`（奖励领取/兑换截止）+ 主行去重 ───────────────────
		const ark = await runGame("arknights", NOW_ARK);
		{
			const ev = ark.rec.events || [];
			check("明日方舟：`events` = 3 条（墟 / 危机合约 / 火山旅梦；悬停里那条「墟 兑换截止」不另算一条）",
				Array.isArray(ev) && ev.length === 3, JSON.stringify(ev.map((x) => x.title)));
			check("明日方舟：兑换期在 `phase` 里（kind = claim，show = 面板事项名），且两端是 number",
				!!ev[0] && !!ev[0].phase && ev[0].phase.kind === "claim"
				&& ev[0].phase.show === "支线故事：墟 兑换截止"
				&& isNum(ev[0].phase.startTs) && isNum(ev[0].phase.endTs),
				JSON.stringify(ev[0] && ev[0].phase));
			check("明日方舟：兑换期的主条目 show = `eventShow`（与显示层同一串），且 startTs/endTs 与 phase 一致",
				!!ev[0] && ev[0].show === "支线故事：墟 兑换截止"
				&& ev[0].startTs === ev[0].phase.startTs && ev[0].endTs === ev[0].phase.endTs,
				JSON.stringify(ev[0] && [ev[0].show, ev[0].startTs, ev[0].endTs]));
			check("明日方舟：顺序 = 结束时间升序（自然顺序，不按「谁更重要」挑）", ascending(ev),
				JSON.stringify(ev.map((x) => x.endTs)));
			check("明日方舟：卡池侧没有夹具（默认源 404）⇒ `gacha` 空数组，不硬造",
				Array.isArray(ark.rec.gacha) && ark.rec.gacha.length === 0, JSON.stringify(ark.rec.gacha));
			// 旧字段逐字不变
			const changed = OLD_FIELDS.filter((f) => ark.rec[f] !== BASE_ARK[f]);
			check("明日方舟：12 个旧字符串字段与改造前（HEAD）**逐字相同**（一个都没被顺手改写）",
				changed.length === 0, JSON.stringify(changed));
			// 与显示层同一份：面板外显那条的 show 必须能在数组里逐字找到
			const it = T.scheduleNormalize(Object.assign({ id: "arknights", name: "明日方舟" }, ark.rec), "event", new Date(NOW_ARK));
			check("明日方舟：数组里能找到显示层现算的那一条（title + show 逐字相同）",
				!!it && ev.some((x) => x.title === it.title && x.show === it.show),
				JSON.stringify([it && it.title, it && it.show]));
		}

		// ── ④-3 FGO：并列卡池真的展开成多条（4 口池 = 主条 + 悬停里 3 口）───────
		const fgo = await runGame("fgo", NOW_FGO);
		{
			const g = fgo.rec.gacha || [];
			check("FGO：`gacha` = 4 条（主条 + 悬停解析出的 3 口并列池）",
				Array.isArray(g) && g.length === 4, JSON.stringify(g.map((x) => x.title)));
			const it = T.scheduleNormalize(Object.assign({ id: "fgo", name: "FGO" }, fgo.rec), "gacha", new Date(NOW_FGO));
			check("FGO：主条 title = 池名原文、show = 显示层现算的外显名（去修饰的角色名）逐字相同",
				!!g[0] && g[0].title === it.title && g[0].show === it.show && it.show !== it.title,
				JSON.stringify([g[0] && g[0].title, g[0] && g[0].show, it.title, it.show]));
			check("FGO：roles 是 string[]（原始角色名，不做去修饰），startTs/endTs 是 number 且起点早于终点",
				!!g[0] && Array.isArray(g[0].roles) && g[0].roles.length === 1
				&& /\(Saber\)|\(Ruler\)/.test(g[0].roles[0]) && isNum(g[0].startTs) && isNum(g[0].endTs) && g[0].startTs < g[0].endTs,
				JSON.stringify(g[0] && [g[0].roles, g[0].startTs, g[0].endTs]));
			check("FGO：并列池那条的 raw 是悬停里那行档期原文（facts 到行级），roles 为空数组",
				!!g[1] && g[1].raw === "09-26 19:00 ~ 10-15 13:59" && Array.isArray(g[1].roles) && g[1].roles.length === 0,
				JSON.stringify(g[1] && [g[1].raw, g[1].roles]));
			check("FGO：`gacha` 顺序 = 结束时间升序", ascending(g), JSON.stringify(g.map((x) => x.endTs)));
			check("FGO：key 逐个唯一且按最终下标编号（`fgo:gacha:<i>`）",
				g.every((x, i) => x.key === "fgo:gacha:" + i), JSON.stringify(g.map((x) => x.key)));
			const hoverTitles = T.scheduleHoverItems(fgo.rec.bannerHover, it.title, true).map((x) => x.title);
			check("FGO：每一条并列池都能在悬停解析结果里找到同名行（展开没有凭空造条目）",
				g.slice(1).every((x) => hoverTitles.indexOf(x.title) >= 0), JSON.stringify([hoverTitles, g.map((x) => x.title)]));
			check("FGO：外显那条（悬停首行就是它自己）没有被重复列成并列池",
				g.filter((x) => x.title === it.title).length === 1, JSON.stringify(g.map((x) => x.title)));
			const changed = OLD_FIELDS.filter((f) => fgo.rec[f] !== BASE_FGO[f]);
			check("FGO：12 个旧字符串字段与改造前（HEAD）逐字相同", changed.length === 0, JSON.stringify(changed));
		}

		// ── ④-4 赛马娘国服：「数据层**不挑选**外显那条」的反证 ──────────────────────
		// 这份夹具里外显那条（赛事活动…，10-07 结束）在悬停里排第 3 行，而"第1轮"10-03 就结束
		// ⇒ 按结束时间升序，数组第 1 条**不是**面板显示的那条。这正是"数据层只放事实、不挑选"的证据。
		const uma = await runGame("uma-cn", NOW_UMA);
		{
			const ev = uma.rec.events || [];
			const it = T.scheduleNormalize(Object.assign({ id: "uma-cn", name: "闪耀！优俊少女" }, uma.rec), "event", new Date(NOW_UMA));
			check("赛马娘国服：`events` = 4 条（活动本身 + 悬停里 3 个阶段）",
				Array.isArray(ev) && ev.length === 4, JSON.stringify(ev.map((x) => x.title)));
			check("赛马娘国服：外显那条（10-07 结束）**不是**数组第 1 条（数据层没有「把显示那条提到最前」）",
				!!it && ev[0].title !== it.title && ev.some((x) => x.title === it.title && x.show === it.show),
				JSON.stringify([ev[0] && ev[0].title, it && it.title, ev.map((x) => x.title)]));
			check("赛马娘国服：数组第 1 条就是结束最早的那条（10-03「第1轮」）—— 顺序只由 endTs 决定",
				ev[0].title === "第1轮" && ev.every((x) => x.endTs >= ev[0].endTs),
				JSON.stringify([ev[0] && ev[0].title, ev.map((x) => x.endTs)]));
			check("赛马娘国服：主条的 raw 用 `eventDatesRaw`（源站原文 `10/1 12:00 ～ 10/711:59`，与显示用的 dates 不同串）",
				ev.some((x) => x.raw === "10/1 12:00 ～ 10/711:59"), JSON.stringify(ev.map((x) => x.raw)));
			check("赛马娘国服：顺序 = 结束时间升序", ascending(ev), JSON.stringify(ev.map((x) => x.endTs)));
			const changed = OLD_FIELDS.filter((f) => uma.rec[f] !== BASE_UMA[f]);
			check("赛马娘国服：12 个旧字符串字段与改造前（HEAD）逐字相同", changed.length === 0, JSON.stringify(changed));
		}

		// ── ④-5 持久化往返：`getCached()` 之后数组仍在（含 phase）────────────────────
		{
			const storage = makeStore({ lastData: JSON.stringify({
				arknights: Object.assign({ name: "明日方舟" }, ark.rec),
				fgo: Object.assign({ name: "FGO" }, fgo.rec)
			}) });
			const cached = (await createEngine({ storage, now: () => 0 }).getCached()).games;
			const arkBack = cached.arknights || {}, fgoBack = cached.fgo || {};
			check("往返：明日方舟的 `events` 仍是数组、3 条、顺序与内容不变",
				Array.isArray(arkBack.events) && arkBack.events.length === 3
				&& JSON.stringify(arkBack.events) === JSON.stringify(ark.rec.events),
				JSON.stringify(arkBack.events && arkBack.events.length));
			check("往返：`phase` 也原样读回（kind / show / 两端 ts 一个不落）",
				!!(arkBack.events || [])[0] && JSON.stringify(arkBack.events[0].phase) === JSON.stringify(ark.rec.events[0].phase),
				JSON.stringify((arkBack.events || [])[0] && arkBack.events[0].phase));
			check("往返：FGO 的 `gacha` 4 条原样读回（并列池不会在缓存这一层被削成 1 条）",
				Array.isArray(fgoBack.gacha) && fgoBack.gacha.length === 4
				&& JSON.stringify(fgoBack.gacha) === JSON.stringify(fgo.rec.gacha),
				JSON.stringify(fgoBack.gacha && fgoBack.gacha.map((x) => x.title)));
			check("往返：旧字符串字段同时也在（数组没有「顶替」它们）",
				arkBack.event === BASE_ARK.event && fgoBack.banner === BASE_FGO.banner,
				JSON.stringify([arkBack.event, fgoBack.banner]));
		}

		// ── ④-6 归一的最少校验 + 老缓存的固定形状 ────────────────────────────────
		{
			const storage = makeStore({ lastData: JSON.stringify({
				dirty: {
					name: "脏数据",
					banner: "池",
					gacha: [null, "x", 7, { title: 5, startTs: "123", endTs: Infinity, roles: "a、b", key: 1 }],
					events: [{ title: "活动", startTs: 5, endTs: 6, phase: { kind: "claim", startTs: NaN, endTs: "9" } }, []]
				},
				old: { name: "老缓存", banner: "旧池", event: "旧活动" }
			}) });
			const games = (await createEngine({ storage, now: () => 0 }).getCached()).games;
			const dirty = games.dirty || {}, old = games.old || {};
			check("归一：非对象元素被丢弃（null / 字符串 / 数字 / 数组只留下那一个对象）",
				Array.isArray(dirty.gacha) && dirty.gacha.length === 1 && Array.isArray(dirty.events) && dirty.events.length === 1,
				JSON.stringify([dirty.gacha && dirty.gacha.length, dirty.events && dirty.events.length]));
			check("归一：ts **不是 number** ⇒ null（`\"123\"` / `Infinity` / NaN / 字符串都归一成 null）",
				dirty.gacha[0].startTs === null && dirty.gacha[0].endTs === null
				&& dirty.events[0].phase.startTs === null && dirty.events[0].phase.endTs === null,
				JSON.stringify([dirty.gacha[0].startTs, dirty.gacha[0].endTs, dirty.events[0].phase.startTs, dirty.events[0].phase.endTs]));
			check("归一：非字符串的文本字段 → 空串；roles 非数组 → []（形状固定，消费方不用到处 `??`）",
				dirty.gacha[0].title === "" && dirty.gacha[0].key === "" && dirty.gacha[0].roles.length === 0,
				JSON.stringify(dirty.gacha[0]));
			check("归一：合法的 number 原样保留（不缺省成 null）", dirty.events[0].startTs === 5 && dirty.events[0].endTs === 6,
				JSON.stringify([dirty.events[0].startTs, dirty.events[0].endTs]));
			check("归一：老缓存（改造前写的 lastData，没有这两个键）⇒ 空数组，形状固定",
				Array.isArray(old.gacha) && old.gacha.length === 0 && Array.isArray(old.events) && old.events.length === 0,
				JSON.stringify([old.gacha, old.events]));
			check("归一：老缓存的旧字段照旧读回（数组分支没有牵连字符串字段）",
				old.banner === "旧池" && old.event === "旧活动", JSON.stringify([old.banner, old.event]));
		}

		// ── ④-7 布局：listGames().defaults 里登记了这两个字段 ──────────────────────
		{
			const games = await createEngine({ transport, storage: makeStore(), now: () => 0 }).listGames();
			const g = games[0] || {};
			check("listGames().defaults 里有 gacha / events（恒空数组；条目的出厂值里没有池/活动）",
				Array.isArray(g.defaults.gacha) && g.defaults.gacha.length === 0
				&& Array.isArray(g.defaults.events) && g.defaults.events.length === 0,
				JSON.stringify(g.defaults));
		}

		// ── ④-8 白名单静态守卫：六处点名的地方逐处钉住 ────────────────────────────
		{
			const read = (rel) => readFileSync(path.join(REPO, "src", "client", rel), "utf8");
			const refreshSrc = read("50-refresh.js");
			const headSrc = read("engine-head.js");
			const shellSrc = read("83-panel-shell.js");
			check("白名单①：50-refresh.js 的 GACHA_FIELDS 里登记了 `gacha`（否则结构化来源会被 pickFields 削掉）",
				/const GACHA_FIELDS = \[[^\]]*"gacha"/.test(refreshSrc), refreshSrc.match(/const GACHA_FIELDS = \[[^\]]*\]/) ? refreshSrc.match(/const GACHA_FIELDS = \[[^\]]*\]/)[0] : "");
			check("白名单②：50-refresh.js 的 EVENT_FIELDS 里登记了 `events`",
				/const EVENT_FIELDS = \[[^\]]*"events"/.test(refreshSrc), refreshSrc.match(/const EVENT_FIELDS = \[[^\]]*\]/) ? refreshSrc.match(/const EVENT_FIELDS = \[[^\]]*\]/)[0] : "");
			check("白名单③：engine-head.js 的 normalizeRecord 有**数组分支**（CONTENT_FIELDS 只收字符串 ⇒ 漏了就是空数组）",
				/out\.gacha = dataArrayGachaListOf\(src\.gacha\);/.test(headSrc) && /out\.events = dataArrayEventListOf\(src\.events\);/.test(headSrc));
			check("白名单④：83-panel-shell.js 的渲染层逐字段拷贝带上了这两个数组（漏了 = P2 永远读到空数组）",
				/gacha: Array\.isArray\(sc\.gacha\)/.test(shellSrc) && /events: Array\.isArray\(sc\.events\)/.test(shellSrc));
			check("白名单⑤：engine-head.js 的 listGames().defaults 登记了两个字段",
				/defaults: \{[\s\S]{0,400}?gacha: \[\][\s\S]{0,200}?events: \[\]/.test(headSrc));
			// ⑥（60-helpers.js 的 customEntries 白名单）刻意**不**登记：那张表重建的是"条目定义"
			// （抓什么/按哪个时区读），数组是**抓取结果**（住在 lastData 里）。这里钉住"确实没有"，
			// 免得有人以为漏了又补进去（那会让每个自定义条目都多出两个恒空数组，纯噪音）。
			const helpersSrc = read("60-helpers.js");
			check("白名单⑥：60-helpers.js 的 customEntries 白名单**不含**数组字段（它是条目定义，不是抓取结果）",
				!/\bgacha:/.test(helpersSrc.slice(helpersSrc.indexOf("function getAllEntries"), helpersSrc.indexOf("function baRoleName")))
			);
		}
	}
}
