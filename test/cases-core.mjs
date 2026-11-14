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
import { check, section, useFixtures, fixtureBody } from "./harness.mjs";
import { legacyHoverItemsOf } from "./lib-text.mjs";
import { T, REPO } from "./load.mjs";
import { LEGACY } from "./legacy-golden.mjs";
// ── 改造前老路的 **字面量 golden**（P5 清理，2026-11-08）────────────────────────────────
// 这里原本是逐字复刻进测试的 `legacyCellOf` / `legacyHoverOnes`（P3c 从产品删掉后冻结的 oracle）。
// 它们依赖产品里的两段死代码 —— `scheduleHoverItems` 与 `dataArrayExtrasFromEntriesOf` 的 `win` 分支 ——
// 所以 P5 清理时先把 oracle 的**输出**固化成字面量（`test/fixtures/legacy-oracle-golden.json`），
// 再删实现；断言改成"**当前实现 == 该字面量**"，等价性证据不依赖任何被删的代码。
// ⚠️ 字面量由 HEAD `d3e9d35` 的 oracle 原样采出（采集方式与重采步骤见 test/legacy-golden.mjs 顶部）。
// ⚠️ `coreRows` 的每个值 = `[[name, meta], …]`（null = 该侧无数据）；键 = `<id>:<side>`。
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

	// ② core 覆盖全部来源（C2 之后 28 款 + 2026-11-09 新接入 5 款 + 2026-11-11 的 uma-tw
	//    + 2026-11-14 的 pjsk 繁中服/韩服 = 36），且内置 11 款仍在
	{
		const e = createEngine({ transport: noopTransport, storage: makeStorage(), now: () => 0 });
		const ids = e.__test.SOURCES.map((s) => s.id);
		check("core 来源总数 = 41（内置 11 + 另外 17 + 2026-11-09 的 5 + 2026-11-11 的 uma-tw + 2026-11-14 的 pjsk-tc/pjsk-kr/fgo-jp + 2026-11-15 的 bjhl/yys/dhmmr/bh2）", ids.length === 41, String(ids.length));		const builtin = ["genshin", "hsr", "zzz", "wuwa", "arknights", "endfield", "ba-cn", "ba-global", "ba-jp", "r1999", "nte"];
		check("内置 11 款都还在", builtin.every((i) => ids.includes(i)), builtin.filter((i) => !ids.includes(i)).join(","));
		const extra = ["p5x", "zspms", "czn", "kedr", "ddlezj", "bh3", "stellasora", "fgo", "gf2", "bandori", "pjsk"];
		check("另外 17 款的代表条目也在（C2 后 core 不再只有内置）", extra.every((i) => ids.includes(i)), extra.filter((i) => !ids.includes(i)).join(","));
		// 2026-11-09：有源的 2 款 + 只注册条目的 3 款，一个都不许漏
		const added = ["wqmt", "pengpeng", "wd", "hlr", "cytq"];
		check("2026-11-09 新接入的 5 款都在（wqmt / pengpeng / wd / hlr / cytq）",
			added.every((i) => ids.includes(i)), added.filter((i) => !ids.includes(i)).join(","));
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
		// ⚠️ 2026-11-07：活动侧夹具换成 PRTS SMW 真实响应（`arknights-smw-events`，原来那份手造的
		// 「一览 HTML + 批量 wikitext」夹具已随链路删除）⇒ 下面这 12 个字段的**基线值**跟着换了，
		// 但这几条断言的性质没变：合成数组时旧字符串字段**一个都不许被顺手改写**。
		const BASE_ARK = {
			banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", bannerHover: "",
			event: "视相博物馆：演化",
			eventDates: "11-07 03:59 ~ 11-10 03:59",
			eventDatesRaw: "11-07 03:59 ~ 11-10 03:59",
			eventShow: "视相博物馆：演化 兑换截止",
			eventClaimDates: "11-07 03:59 ~ 11-10 03:59",
			eventHover: "视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59\n登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59",
			eventHoverExtra: "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59"
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
			check("明日方舟：`events` = 3 条（视相博物馆 / 登录活动 / 支线故事；悬停里那条「视相博物馆：演化 兑换截止」不另算一条）",
				Array.isArray(ev) && ev.length === 3, JSON.stringify(ev.map((x) => x.title)));
			check("明日方舟：兑换期在 `phase` 里（kind = claim，show = 面板事项名），且两端是 number",
				!!ev[0] && !!ev[0].phase && ev[0].phase.kind === "claim"
				&& ev[0].phase.show === "视相博物馆：演化 兑换截止"
				&& isNum(ev[0].phase.startTs) && isNum(ev[0].phase.endTs),
				JSON.stringify(ev[0] && ev[0].phase));
			check("明日方舟：兑换期的主条目 show = `eventShow`（与显示层同一串），且 startTs/endTs 与 phase 一致",
				!!ev[0] && ev[0].show === "视相博物馆：演化 兑换截止"
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
			// 悬停解析（`legacyHoverItemsOf` = P5 起冻结在 test/lib-text.mjs 的改造前判据）
			const hoverTitles = legacyHoverItemsOf(fgo.rec.bannerHover, it.title, true).map((x) => x.title);
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
				old: { name: "老缓存", banner: "旧池", event: "旧活动" },
				// P2 收尾新增的**事实字段**：category / tags / preview / source —— 归一必须原样保留
				// （数组是持久化白名单里唯一"不是字符串"的东西，漏登记就是静默丢字段）。
				facts: {
					name: "事实字段",
					gacha: [{ title: "池", show: "池", roles: [], startTs: 1, endTs: 2, tz: "Asia/Shanghai", raw: "", source: "primary", category: "Event", tags: ["限定", "联动"], preview: true },
						{ title: "无事实", show: "无事实", startTs: 3, endTs: 4, tz: "Asia/Shanghai", raw: "", source: "hover", category: "", tags: [], preview: false }],
					events: [{ title: "予告活动", show: "予告活动", startTs: 3, endTs: 4, tz: "Asia/Tokyo", raw: "", source: "hover", preview: true }]
				}
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

			// ── 事实字段往返（P2 收尾）：category / tags / preview / source 归一后**一个不少** ──
			const facts = games.facts || {};
			const fg = (facts.gacha || [])[0] || {}, fe = (facts.events || [])[0] || {};
			check("事实字段往返：`source` / `category` / `tags` / `preview` 在 getCached() 归一后原样读回",
				fg.source === "primary" && fg.category === "Event"
				&& JSON.stringify(fg.tags) === JSON.stringify(["限定", "联动"]) && fg.preview === true
				&& fe.source === "hover" && fe.preview === true,
				JSON.stringify([fg, fe]));
			check("事实字段：没给的事实**没有这个键**（不写空串/空数组/false；`source` 恒为字符串）",
				!("category" in (dirty.gacha || [])[0]) && !("tags" in (dirty.gacha || [])[0])
				&& !("preview" in (dirty.gacha || [])[0]) && typeof (dirty.gacha || [])[0].source === "string"
				&& !("category" in fe) && !("tags" in fe) && (dirty.gacha || [])[0].source === "",
				JSON.stringify([dirty.gacha && dirty.gacha[0], fe]));
			check("事实字段：`preview:false` / `category:\"\"` / `tags:[]` 都**不产生这个键**（可选事实的\"留空\"口径）",
				(facts.gacha || []).length === 2
				&& !("category" in (facts.gacha || [])[1]) && !("tags" in (facts.gacha || [])[1])
				&& !("preview" in (facts.gacha || [])[1]) && (facts.gacha || [])[1].source === "hover",
				JSON.stringify(facts.gacha));
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

		// ── ④-9 星穹铁道真机（2026-11-07）：② 角色名重复 / ③ 同池两条 / ④ 事件标题拼档期 ──
		//
		// 输入 = 用户机器快照里的 hsr 记录（bwiki「历史跃迁」+「活动一览」按线上结构裁剪的夹具）。
		// 三个 bug 都**只在数据层可见**：面板显示层会把读不出窗口的并列条目丢掉，所以真机上
		// 只看面板不会发现，只有 `gacha` / `events` 数组留着半截错误（这正是 P1 要修的）。
		{
			// 夹具按"名字"取（不写进 map.json：那会改变其它批次对 hsr 默认源的期望）
			const FIX = (dir) => fixtureBody("fixture:" + dir, { ["fixture:" + dir]: dir + "/response.txt" });
			const warpBody = FIX("p4-hsr-bwiki-warp-1107");
			const eventsBody = FIX("p4-hsr-bwiki-events-1107");
			let hsrHtml = "";
			// 只为这两个夹具服务的 transport：fetcher 拿到的永远是当前 hsrHtml。
			// ⚠️ 2026-11-07 起 bwiki 在 transportFetchRaw 里被**强制改走宿主代理**（DSH 页面源是
			//    `dsh-app://app`，bwiki 对它不回 ACAO，直连必被 CORS 拦；见 src/client/15-env.js），
			//    所以两条出口都必须能供同一份 body —— 否则这里的 hsr 抓取会直接打空。
			const hsrTransport = {
				async fetchRaw() { const t = hsrHtml; return { ok: true, status: 200, headers: { get: () => null }, text: async () => t, json: async () => JSON.parse(t) }; },
				async fetchViaProxy() { return hsrHtml; }   // 代理出口的契约 = 直接返回 body 字符串
			};
			const NOW_HSR = Date.parse("2026-11-07T00:00:00.000Z");
			const probe = createEngine({ transport: hsrTransport, storage: makeStore(), now: () => NOW_HSR, timer: { setTimeout, clearTimeout } });
			const metaHsr = { id: "hsr", tz: "Asia/Shanghai" };
			hsrHtml = warpBody;
			const hsrGachaPayload = await probe.__test.GACHA_FETCHERS["hsr-bwiki"]("https://wiki.biligame.com/sr/api.php?action=parse&page=warp", undefined, "Asia/Shanghai");
			const hsrGacha = probe.__test.mergeEntryRecord({ data: hsrGachaPayload || {} }, null, NOW_HSR, metaHsr).gacha || [];
			hsrHtml = eventsBody;
			const hsrEventPayload = await probe.__test.EVENT_FETCHERS["hsr"].default("https://wiki.biligame.com/sr/api.php?action=parse&page=events", undefined, "Asia/Shanghai");
			const hsrEvents = probe.__test.mergeEntryRecord({ data: hsrEventPayload || {} }, null, NOW_HSR, metaHsr).events || [];

			// ② 角色名重复：`roles` / `show` 里同一角色出现两次（真机 `星神★阿哈 星神★阿哈（欢愉•量子）`）
			// 判重口径 = **去掉括号属性后缀后的角色名**（与修复实现的规则一致）。
			const roleBase = (s) => String(s).replace(/[（(][^）)]*[）)]/g, "").trim();
			const roleTokens = (roles) => String(roles || "").split(/[、,，]/).flatMap((g) => g.split(/\s+/)).filter(Boolean);
			const hsrRoles = (hsrGachaPayload && hsrGachaPayload.roles) || "";
			const tokens = roleTokens(hsrRoles);
			check("星铁②：roles 里不存在重复角色名（去括号属性后判重，保留第一次出现的形式）",
				tokens.length > 0 && new Set(tokens.map(roleBase)).size === tokens.length,
				JSON.stringify(tokens));
			// ⚠️ 2026-11-09「起点未知 ≠ 已开始」：外显角色只剩**两端明确且覆盖 now** 的那口池
			// （「我身即刃」10-21~11-10）。「沧海萃珠」与两口 4.7 池的起点在 bwiki 里只写
			// 「4.6/4.7版本更新后」（无日期）⇒ 不再并进外显，仍留在悬停里（见下面 ③ 的悬停断言）。
			// 判重规则本身（同一角色写两遍只留一次）由上一行 + 悬停断言继续覆盖。
			check("星铁②：roles 逐字（起点未知的池不并入；同一角色只出现一次）",
				hsrRoles === "千冶•刃（虚无•火）",
				JSON.stringify(hsrRoles));
			const hsrMain = hsrGacha[0] || {};
			const showTokens = roleTokens(hsrMain.show);
			check("星铁②：show（外显）里同样没有重复角色名",
				showTokens.length > 0 && new Set(showTokens.map(roleBase)).size === showTokens.length,
				JSON.stringify(hsrMain.show));
			check("星铁②：悬停的「池名：角色」也一起去重（同一份 roles 出来的，不另写一套规则）",
				!!hsrGachaPayload && hsrGachaPayload.bannerHover.split("\n").some((l) => l === "「愚戏众星」角色活动跃迁：星神★阿哈"),
				JSON.stringify(hsrGachaPayload && hsrGachaPayload.bannerHover));

			// ③ 同池两条（**P2 收尾改了判重口径，2026-11-07**）：不再按「起止时间 + 池名」把同一口池
			//    并成一条 —— 旧探头本来就同时显示「合并角色的主行」与「池名：角色」，数据层只该放事实。
			//    新口径：**引擎主行一条 + 悬停并列行各一条**，用 `source` 区分（"primary" / "hover"）；
			//    只有内容完全一样（同标题 + 同区间）才去掉一条，且**优先保 `source:"primary"`** 那条。
			// ⚠️ 2026-11-09：行数 5 → 4。两条原因都来自"起点未知 ≠ 已开始"：
			//   ① 外显只剩「我身即刃」一口池（其余三口起点是「版本更新后」且无日期）；
			//   ② 主行与那条悬停行**归一后同名**（主行 show = 千冶•刃 = 悬停行「…：千冶•刃」的尾部）
			//      ⇒ 按既有判重口径去掉悬停那条（`dataArrayExtrasFromEntriesOf` 的 shown 规则）。
			check("星铁③：gacha 数组 = 4 条（引擎主行 1 + 悬停并列行 3）",
				hsrGacha.length === 4, JSON.stringify(hsrGacha.map((x) => [x.title, x.source])));
			check("星铁③：`source` 恰好一条 primary（外显那条），其余全是 hover",
				hsrGacha.filter((x) => x.source === "primary").length === 1
				&& hsrGacha.filter((x) => x.source === "hover").length === 3
				&& (hsrGacha.find((x) => x.source === "primary") || {}).title === "「我身即刃」角色活动跃迁",
				JSON.stringify(hsrGacha.map((x) => [x.title, x.source])));
			check("星铁③：起点未知的三口池**仍在悬停/数组里**（判重没有把事实删掉）",
				["沧海萃珠", "铭心之萃", "愚戏众星"].every((n) => hsrGacha.some((x) => x.title.indexOf(`「${n}」角色活动跃迁：`) === 0)),
				JSON.stringify(hsrGacha.map((x) => x.title)));
			// ③-bis 判重口径的边界：**内容完全一样**（同标题 + 同区间）才去掉一条，且优先保 primary。
			// ⚠️ P3c（2026-11-07）：数据层不再从 `bannerHover` 合成数组（合成器已删），所以这里改成
			//    直接给**条目事实** —— 判重仍走 `dataArrayExtrasFromEntriesOf` 同一份实现，
			//    再让 `mergeEntryRecord` 做归一/发 key（这一段守的是那三条判据，不是入口形状）。
			const samePayload = { banner: "同名池", roles: "", bannerDates: "10-21 12:00 ~ 11-10 15:00", bannerDatesRaw: "10-21 12:00 ~ 11-10 15:00" };
			const sameEntries = [
				{ title: "同名池", startTs: null, endTs: null, raw: "10-21 12:00 ~ 11-10 15:00" },
				{ title: "另一池", startTs: null, endTs: null, raw: "10-30 12:00 ~ 12-01 15:00" }
			];
			const sameRec = probe.__test.mergeEntryRecord({ data: Object.assign({}, samePayload, {
				gacha: T.dataArrayProducedGachaOf(samePayload, sameEntries, { id: "hsr", tz: "Asia/Shanghai" }, NOW_HSR),
				gachaHoverItems: sameEntries
			}) }, null, NOW_HSR, metaHsr);
			check("星铁③：内容完全相同的行只留一条（同名同区间 ⇒ 只剩 source=primary 的主行）",
				(sameRec.gacha || []).length === 2
				&& (sameRec.gacha || [])[0].source === "primary" && (sameRec.gacha || [])[0].title === "同名池"
				&& (sameRec.gacha || [])[1].source === "hover" && (sameRec.gacha || [])[1].title === "另一池",
				JSON.stringify((sameRec.gacha || []).map((x) => [x.title, x.source])));
			// 补：主条**自己**就是「版本更新后」池时（startTs 被 fillMissingStarts 补过、条目里读不出 ts），
			// 判重键必须靠该行原生 raw 认出"起点未折算"，否则同一口池仍会留两条。
			const openPayload = { banner: "「甲」角色活动跃迁", roles: "甲角色（火）", bannerDates: "11-10 15:00 ~ 12-02 11:59", bannerDatesRaw: "4.7版本更新后 ~ 12-02 11:59" };
			const openEntries = [
				{ title: "「甲」角色活动跃迁：甲角色（火）", startTs: null, endTs: null, raw: "4.7版本更新后 ~ 12-02 11:59" },
				{ title: "「乙」角色活动跃迁：乙角色（冰）", startTs: null, endTs: null, raw: "4.7版本更新后 ~ 12-22 15:00" }
			];
			const openStartRec = probe.__test.mergeEntryRecord({ data: Object.assign({}, openPayload, {
				gacha: T.dataArrayProducedGachaOf(openPayload, openEntries, { id: "hsr", tz: "Asia/Shanghai" }, NOW_HSR),
				gachaHoverItems: openEntries
			}) }, null, NOW_HSR, metaHsr);
			check("星铁③：主条自己就是「版本更新后」池（ts 被补过）时，悬停里同一池仍判成同一条",
				(openStartRec.gacha || []).length === 2,
				JSON.stringify((openStartRec.gacha || []).map((x) => [x.title, x.startTs, x.endTs, x.raw])));

			// ④ 事件标题被拼上档期：`「巡星之礼」第二十七期   4.6版本更新后 ~ 11-11 03:59`
			const SCHEDULE_TAIL_RE = [/版本更新后/, /~ \d{2}-\d{2}/, /\d{2}-\d{2} \d{2}:\d{2}/];
			check("星铁④：事件标题不含档期文本（无『版本更新后』/『~ MM-DD』/『MM-DD HH:MM』）",
				hsrEvents.length > 0 && hsrEvents.every((e) => SCHEDULE_TAIL_RE.every((re) => !re.test(e.title))),
				JSON.stringify(hsrEvents.map((e) => e.title)));
			check("星铁④：标题逐字 = 「巡星之礼」第二十七期（档期原文留在 raw 里，没有丢）",
				hsrEvents.some((e) => e.title === "「巡星之礼」第二十七期" && e.raw === "4.6版本更新后 ~ 11-11 03:59"),
				JSON.stringify(hsrEvents.map((e) => [e.title, e.raw])));
			// 针对性断言：修复落在**悬停逆解析**（唯一真源），所以直接钉住那条规则本身。
			// （悬停契约：<2 行返回 ""，所以这里给两行；第一行就是真机里被拼脏的那一行。）
			// P5 起该规则**冻结在 test/lib-text.mjs**（`legacyHoverItemsOf`）：产品里那条路已随数组化删除。
			const split = legacyHoverItemsOf("「巡星之礼」第二十七期   4.6版本更新后 ~ 11-11 03:59\n「爱，幽灵与机器人」   10-21 12:00 ~ 12-02 11:59", "", false);
			check("星铁④：悬停行「名称 + 3 空格 + 版本标签起端的档期」能拆成 名称 / 档期",
				split.length === 2 && split[0].title === "「巡星之礼」第二十七期" && split[0].win === "4.6版本更新后 ~ 11-11 03:59"
				&& split[1].title === "「爱，幽灵与机器人」" && split[1].win === "10-21 12:00 ~ 12-02 11:59",
				JSON.stringify(split));
			// 证据：**只有星铁**会产出这种悬停行。其它游戏的「X.Y版本更新后」都在各自解析器里
			// 折算成绝对时刻了，悬停原文里不会出现版本标签（否则下面这条会红）。
			const others = [
				["FGO", fgo.rec], ["明日方舟", ark.rec], ["赛马娘国服", uma.rec]
			];
			check("星铁④：只有星铁会产出带版本标签的悬停档期（其它游戏悬停原文不含『版本更新后』）",
				others.every(([, rec2]) => !/版本更新后/.test((rec2.bannerHover || "") + "\n" + (rec2.eventHover || ""))),
				JSON.stringify(others.map(([n, rec2]) => [n, /版本更新后/.test((rec2.bannerHover || "") + (rec2.eventHover || ""))])));
		}

		// ── ④-10 其它游戏的 `gacha` 数组 / roles / show 逐字不变 ────────────────────
		// 数据层的其它修改（角色名判重、悬停逆解析认版本标签、P2 收尾的事实字段）都只有个别游戏
		// 会踩到；下面把改造前（HEAD + 新事实字段）跑同一批夹具的数组**整段 JSON** 钉住，
		// 任何"顺手也改了别家"的行为都会红（`source` 是 P2 收尾新增的必填事实：primary / hover）。
		// ⚠️ `startTs`/`endTs` 只比**类型**（number）：P1 的口径是"本机时刻"（见 README_Dev 的已知不等价①），
		//    同一份夹具在 `TZ=UTC` 下比 +08 少 8 小时 —— 把数字钉死会让门禁在 UTC 下假红（2026-11-07 实测过）。
		{
			const NOW_BD = Date.parse("2026-10-01T17:26:29.000Z");
			const bandori = await runGame("bandori", NOW_BD);
			const zzz = await runGame("zzz", NOW_GEN);
			const sansTs = (arr) => JSON.stringify((arr || []).map((x) => Object.assign({}, x, {
				startTs: x.startTs == null ? "null" : typeof x.startTs,
				endTs: x.endTs == null ? "null" : typeof x.endTs
			})));
			const GOLDEN = {
				fgo: '[{"key":"fgo:gacha:0","title":"「OVER THE SAME SKY-SEPTEMBER-」推荐召唤","show":"阿蒂拉 罗摩 兰斯洛特 魁札尔·科亚特尔 反抗军的Rider 弗兰肯斯坦 谜之女主角X〔Alter〕 阿尔托莉雅·潘德拉贡 芦屋道满 妖精骑士兰斯洛特 库库尔坎 大和武尊 堤丰·厄斐墨洛斯","roles":["阿蒂拉 罗摩 兰斯洛特(Saber) 魁札尔·科亚特尔 反抗军的Rider 弗兰肯斯坦 谜之女主角X〔Alter〕 阿尔托莉雅·潘德拉贡(Ruler) 芦屋道满 妖精骑士兰斯洛特 库库尔坎 大和武尊 堤丰·厄斐墨洛斯"],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"2026年9月22日(周二) 19:00 ~ 2026年10月6日(周二) 13:59","source":"primary"},{"key":"fgo:gacha:1","title":"唠唠叨叨新选组 THE END推荐召唤2：土方岁三、冲田总司、斋藤一、山南敬助、永仓新八","show":"唠唠叨叨新选组 THE END推荐召唤2：土方岁三、冲田总司、斋藤一、山南敬助、永仓新八","roles":[],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"09-26 19:00 ~ 10-15 13:59","source":"hover"},{"key":"fgo:gacha:2","title":"唠唠叨叨新选组 THE END 近藤勇推荐召唤：藤堂平助、近藤勇","show":"唠唠叨叨新选组 THE END 近藤勇推荐召唤：藤堂平助、近藤勇","roles":[],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"09-30 19:00 ~ 10-15 13:59","source":"hover"},{"key":"fgo:gacha:3","title":"唠唠叨叨新选组 THE END 河上彦斋推荐召唤：河上彦斋、藤堂平助","show":"唠唠叨叨新选组 THE END 河上彦斋推荐召唤：河上彦斋、藤堂平助","roles":[],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"09-24 19:00 ~ 10-22 13:59","source":"hover"}]',
				bandori: '[{"key":"bandori:gacha:0","title":"黄金周纪念·前篇Dream＆KIRAMEKI Festival招募","show":"丸山彩、CHU²、二叶筑紫、山吹沙绫、宇田川巴、大和麻弥","roles":["丸山彩","CHU²","二叶筑紫","山吹沙绫","宇田川巴","大和麻弥"],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"9月29日维护后~10月11日12:59","source":"primary"}]',
				zzz: '[{"key":"zzz:gacha:0","title":"「烬夜安眠」频段","show":"洛克茜、普罗米娅","roles":["洛克茜（击破·风）","普罗米娅（异常·冰）"],"startTs":"number","endTs":"number","tz":"Asia/Shanghai","raw":"09-30 12:00 ~ 10-20 14:59","source":"primary"}]'
			};
			check("FGO：`gacha` 数组逐字不变（4 条并列池 + `source` 事实：主条 primary、其余 hover）",
				sansTs(fgo.rec.gacha) === GOLDEN.fgo, sansTs(fgo.rec.gacha));
			check("FGO：`roles` / 主条 `show` 逐字不变",
				fgo.rec.roles === "阿蒂拉 罗摩 兰斯洛特(Saber) 魁札尔·科亚特尔 反抗军的Rider 弗兰肯斯坦 谜之女主角X〔Alter〕 阿尔托莉雅·潘德拉贡(Ruler) 芦屋道满 妖精骑士兰斯洛特 库库尔坎 大和武尊 堤丰·厄斐墨洛斯"
				&& ((fgo.rec.gacha || [])[0] || {}).show === "阿蒂拉 罗摩 兰斯洛特 魁札尔·科亚特尔 反抗军的Rider 弗兰肯斯坦 谜之女主角X〔Alter〕 阿尔托莉雅·潘德拉贡 芦屋道满 妖精骑士兰斯洛特 库库尔坎 大和武尊 堤丰·厄斐墨洛斯",
				JSON.stringify([fgo.rec.roles, ((fgo.rec.gacha || [])[0] || {}).show]));
			check("BanG Dream：`gacha` 数组逐字不变（1 条，roles/show 一字不差）",
				sansTs(bandori.rec.gacha) === GOLDEN.bandori, sansTs(bandori.rec.gacha));
			check("绝区零：`gacha` 数组逐字不变（1 条，roles 带（属性）后缀也不被当成重复清掉）",
				sansTs(zzz.rec.gacha) === GOLDEN.zzz, sansTs(zzz.rec.gacha));
		}
	}

	// ⑤ 派生层（P2，2026-11-07）：`sideViewOf` / `scheduleItemOf` / `scheduleCellOf`
	//
	// ── 为什么需要它 ──
	// P1 已把数据层收敛成"事实"（`gacha` / `events` 按结束时间升序、**不挑选**）。P2 把"谁排第一"
	// 下移到显示层：表格那一行 = `sideViewOf(...).primary`、探头 = `.rest`，两处**共用同一份数组**
	// （探头只是一个会动的 UI 组件，零数据语义）。这一段守三件事：
	//   ① 纯函数本身：空数组 / 单条 / 多条 / claim 优先 / 类别档位 / 在期里结束最早 / 顺序稳定 / 不改输入；
	//   ② **等价性（本阶段硬验收）**：同一份夹具下，"数组派生"渲染出的「名称 / 档期文本 / 探头行数 /
	//      行顺序」与**改造前的老路**逐字相等 —— 老路 = 82 里 `[it].concat(extras)` 那几行（P2 搬进 81，
	//      P3c **又从产品里删掉**）。P5 清理时老路的 oracle 也删了：它的**输出**已固化成字面量
	//      （`test/fixtures/legacy-oracle-golden.json` 的 `coreRows`），断言因此是
	//      "**当前数组派生 == 冻结的字面量**"—— 证据仍然独立、且不再依赖任何被删的代码。
	//   ③ 兼容退化（P3c 起）：老 lastData（没有 `gacha` / `events`）⇒ `scheduleCellOf` 返回 **null**
	//      （该侧显示「无数据」），**不抛错**、也不再有"解析悬停文本"的兜底渲染。
	//
	// ⚠️ 2026-11-07（P2 收尾）：原来这里钉着 6 处「已知差异」（数组没有 category/tags、判重键并掉
	//    "同池"那一行）。现在数据层补了事实（`category` / `tags` / `preview` / `source`）并按
	//    "引擎主行 + 悬停并列行各一条"改判重，显示层加了**按游戏分派的规则表** ⇒ 34 个侧
	//    **全部逐字相等**（⑤-5 硬断言 diffs = 0），并且有"还原成通用规则 ⇒ 对应侧必红"的反向证明。
	{
		const NOW = new Date(Date.parse("2026-10-02T00:00:00.000Z"));
		const at = (s) => Date.parse(s + "T00:00:00.000Z");
		const mk = (o) => Object.assign({ key: "k", title: "", show: "", roles: [], startTs: null, endTs: null, raw: "" }, o);
		// ⚠️ 2026-11-07（P4）`scheduleMeta` 多了第 3 参 `tz`：显示层按**条目自己的源站时区**渲染
		// 档期文本（数组条目的 ts 现在是绝对时刻，按本机渲染会把海外源显示错 1~9 小时）。
		// 这里的 oracle 行也必须用**同一个渲染口径**（`x.tz`），否则比的是"两种渲染"而不是"两条数据路径"；
		// 老路（oracle）的行没有 `tz` 键 ⇒ 退回本机时区 ⇒ 文本仍是同一串源站原文（本地解析 + 本地渲染）。
		const rowOf = (x, now) => ({ name: x.show || x.title || x.raw || "—", meta: T.scheduleMeta(x, now, x.tz) });
		const rowsOf = (cell, now) => (cell ? [cell.primary].concat(cell.rest.slice().sort(T.schedulePickItem)).map((x) => rowOf(x, now)) : null);
		const rowText = (rows) => (rows ? rows.map((r) => r.name + " ⏎ " + r.meta) : rows);
		const sortedRowText = (rows) => (rows ? rows.map((r) => r.name + " ⏎ " + r.meta).sort() : rows);



		// ── ⑤-1 纯函数：空 / 单条 / 顺序稳定 ──────────────────────────────
		let v = T.sideViewOf([], NOW, "gacha");
		check("sideViewOf：空数组 ⇒ primary = null、rest = []（两侧、脏值也一样）",
			v.primary === null && v.rest.length === 0
			&& T.sideViewOf(null, NOW, "event").primary === null && T.sideViewOf(undefined, NOW, "gacha").rest.length === 0,
			JSON.stringify(v));
		const one = mk({ title: "唯一", startTs: at("2026-10-01"), endTs: at("2026-10-05") });
		v = T.sideViewOf([one], NOW, "gacha");
		check("sideViewOf：单条 ⇒ primary 就是它、rest 为空（两侧）",
			v.primary === one && v.rest.length === 0 && T.sideViewOf([one], NOW, "event").primary === one);
		const gLate = mk({ key: "late", title: "晚结束", startTs: at("2026-10-01"), endTs: at("2026-10-09") });
		const gSoon = mk({ key: "soon", title: "早结束", startTs: at("2026-09-28"), endTs: at("2026-10-04") });
		const gEnded = mk({ key: "ended", title: "已结束", startTs: at("2026-09-01"), endTs: at("2026-09-20") });
		const gOpen = mk({ key: "open", title: "版本更新后", startTs: null, endTs: at("2026-10-06") });
		v = T.sideViewOf([gEnded, gSoon, gLate], NOW, "gacha");
		check("sideViewOf(gacha)：只在**在期**的池里挑，取结束最早的那条（= 24-parser-window.js selectCurrent）",
			v.primary === gSoon, v.primary && v.primary.title);
		check("sideViewOf(gacha)：rest = 其余条目，**保持数组原顺序**（派生层不重排）",
			JSON.stringify(v.rest.map((x) => x.title)) === JSON.stringify(["已结束", "晚结束"]),
			JSON.stringify(v.rest.map((x) => x.title)));
		// ⚠️ 2026-11-09 口径反转（用户拍板「起点未知 ≠ 已开始」）：`startTs == null` 的池**不再**参选；
		// 结果退回 `list[0]`（= 数组首条，结束最早的那条），绝不因为"起点读不出"就当它已经在开。
		check("sideViewOf(gacha)：起点未知（源站写「X.Y 版本更新后」）的在期池**不参选**（startTs == null 不算已开始）",
			T.sideViewOf([gLate, gOpen], NOW, "gacha").primary === gLate,
			JSON.stringify(T.sideViewOf([gLate, gOpen], NOW, "gacha").primary && T.sideViewOf([gLate, gOpen], NOW, "gacha").primary.title));
		const gTieA = mk({ key: "tieA", title: "并列后", startTs: at("2026-10-02"), endTs: at("2026-10-08") });
		const gTieB = mk({ key: "tieB", title: "并列先", startTs: at("2026-09-30"), endTs: at("2026-10-08") });
		check("sideViewOf(gacha)：同 endTs ⇒ 起点早的优先（selectCurrent 的稳定排序 + endTs 单键）",
			T.sideViewOf([gTieA, gTieB], NOW, "gacha").primary === gTieB);
		check("sideViewOf(gacha)：一条都不在期 ⇒ 取数组首条（= 结束最早的那条），不凭 now 另造一条",
			T.sideViewOf([gEnded], NOW, "gacha").primary === gEnded);

		// ⚠️ 2026-11-09（用户拍板 B，全局规则）：在期里**有角色的池优先**，同档再比「结束最早 → 起点升序」。
		// 卡池侧常见的无角色池：星塔秘纹池 / 星铁光锥池 / 原神武器池 —— 它们结束得更早也不该抢首行。
		// `roles` 两种形状都要认：`string[]`（P1 之后的数据层）与 `string`（旧缓存 / 手工数据）。
		const gRoleLate = mk({ key: "roleLate", title: "角色池", roles: ["火垂"], startTs: at("2026-10-01"), endTs: at("2026-10-20") });
		const gPlainSoon = mk({ key: "plainSoon", title: "无角色池", roles: [], startTs: at("2026-09-28"), endTs: at("2026-10-04") });
		check("sideViewOf(gacha)：在期里**有角色的池优先**（无角色池结束更早也不抢首行；roles = string[]）",
			T.sideViewOf([gPlainSoon, gRoleLate], NOW, "gacha").primary === gRoleLate,
			JSON.stringify(T.sideViewOf([gPlainSoon, gRoleLate], NOW, "gacha").primary && T.sideViewOf([gPlainSoon, gRoleLate], NOW, "gacha").primary.title));
		const gRoleStr = mk({ key: "roleStr", title: "旧缓存角色池", roles: "火垂、缇莉娅", startTs: at("2026-10-01"), endTs: at("2026-10-20") });
		check("sideViewOf(gacha)：`roles` 是**字符串**（旧缓存形状）也照样认",
			T.sideViewOf([gPlainSoon, gRoleStr], NOW, "gacha").primary === gRoleStr);
		check("sideViewOf(gacha)：在期里一个带角色的都没有 ⇒ 退回旧口径（结束最早），行为与改动前一字不差",
			T.sideViewOf([gSoon, gLate], NOW, "gacha").primary === gSoon);
		const gRoleEnded = mk({ key: "roleEnded", title: "已结束角色池", roles: ["火垂"], startTs: at("2026-09-01"), endTs: at("2026-09-20") });
		check("sideViewOf(gacha)：角色优先只在**在期**里生效（已结束的角色池不参选）",
			T.sideViewOf([gRoleEnded, gPlainSoon], NOW, "gacha").primary === gPlainSoon);
		const srcList = [gLate, gSoon];
		T.sideViewOf(srcList, NOW, "gacha");
		check("sideViewOf：纯函数 —— 不改输入数组（内容与顺序都不动）",
			srcList.length === 2 && srcList[0] === gLate && srcList[1] === gSoon);

		// ── ⑤-2 纯函数：event 侧 = pickEventPrimary（claim → 档位 → endTs → startTs）──
		const evTier1 = mk({ key: "t1", title: "剧情活动", startTs: at("2026-10-01"), endTs: at("2026-10-20") });
		const evTier2 = mk({ key: "t2", title: "签到活动", startTs: at("2026-10-01"), endTs: at("2026-10-04") });
		check("sideViewOf(event)：完全复用 pickEventPrimary —— 类别档位（第一档）压过结束时间",
			T.sideViewOf([evTier2, evTier1], NOW, "event").primary === evTier1);
		const evClaim = mk({ key: "claim", title: "兑换截止", phase: { kind: "claim" }, startTs: at("2026-10-01"), endTs: at("2026-10-30") });
		check("sideViewOf(event)：奖励领取期（phase.kind = claim）压过类别档位（2026-11-07 明日方舟真机口径）",
			T.sideViewOf([evTier1, evClaim], NOW, "event").primary === evClaim);
		const evEarly = mk({ key: "e1", title: "甲", startTs: at("2026-10-01"), endTs: at("2026-10-05") });
		const evLate = mk({ key: "e2", title: "乙", startTs: at("2026-10-01"), endTs: at("2026-10-09") });
		check("sideViewOf(event)：同档位按结束时间升序（越快结束越靠前）",
			T.sideViewOf([evLate, evEarly], NOW, "event").primary === evEarly);

		// ── ⑤-3 scheduleItemOf：数组条目 → 与 scheduleNormalize 同形 ──────────────
		const recEv = {
			id: "g1", name: "某游戏",
			event: "剧情活动", eventDates: "10-01 12:00 ~ 10-20 23:59",
			eventDatesRaw: "2026年10月1日 12:00 ~ 10月20日 23:59", tz: "Asia/Shanghai"
		};
		const mainItem = {
			key: "g1:event:0", title: "剧情活动", show: "剧情活动",
			startTs: at("2026-10-01"), endTs: at("2026-10-20"), tz: "Asia/Shanghai", raw: recEv.eventDatesRaw
		};
		const norm = T.scheduleNormalize(recEv, "event", NOW);
		const mainView = T.scheduleItemOf(recEv, "event", mainItem, NOW);
		check("scheduleItemOf：记录自己那条外显 ⇒ 直接走 scheduleNormalize（title / show / raw / rawSrc / state / ts 逐字相同）",
			!!mainView && !!norm && ["title", "show", "raw", "rawSrc", "state", "startTs", "endTs", "remain"].every((f) => mainView[f] === norm[f]),
			JSON.stringify(mainView && [mainView.raw, mainView.rawSrc, mainView.state]));
		const extraItem = { key: "g1:event:1", title: "支线故事", show: "支线故事", startTs: at("2026-10-01"), endTs: at("2026-10-31"), raw: "10-01 12:00 ~ 10-31 23:59" };
		const extraView = T.scheduleItemOf(recEv, "event", extraItem, NOW);
		check("scheduleItemOf：并列条目 ⇒ 与 scheduleNormalize 同形（名称/原文来自数组条目，state/remain 由 ts 算）",
			!!extraView && extraView.title === "支线故事" && extraView.show === "支线故事"
			&& extraView.raw === extraItem.raw && extraView.rawSrc === extraItem.raw
			&& extraView.state === "live" && extraView.fail === null);
		check("scheduleItemOf：读不出绝对档期的并列条目 ⇒ null（与今天 scheduleHoverOnes 的 if (!r) continue 一致）",
			T.scheduleItemOf(recEv, "event", { title: "版本更新后", raw: "4.6版本更新后 ~ 11-10 15:00", startTs: null, endTs: null }, NOW) === null);

		// ── ⑤-4 scheduleCellOf：**只读数组**；没有数组 ⇒ null（不抛错）────────────────
		// P3c 之前这里还有一条 `fromArray === false` 的兼容分支。删掉之后：
		//   · 老 lastData（`gacha` / `events` 是空数组）⇒ `scheduleCellOf` 返回 null，
		//     显示层据此写「该来源无数据」—— 不抛错、不猜（这是任务书要求的老缓存退化行为）。
		//   · 有数组 ⇒ 正常派生；与老路（oracle）的输出逐字相同。
		const legacyRec = Object.assign({}, recEv, { gacha: [], events: [] });
		let cellLegacy = null, legacyThrew = null;
		try { cellLegacy = T.scheduleCellOf(legacyRec, "event", NOW); } catch (e) { legacyThrew = String((e && e.message) || e); }
		check("老 lastData（没有 gacha / events ⇒ 空数组）⇒ scheduleCellOf = null，且**不抛错**",
			legacyThrew === null && cellLegacy === null, JSON.stringify([legacyThrew, cellLegacy]));
		const cellArray = T.scheduleCellOf(Object.assign({}, recEv, { events: [mainItem] }), "event", NOW);
		check("有数组 ⇒ 正常派生出主条（primary 来自数组，不再解析悬停文本）",
			!!cellArray && cellArray.primary.title === "剧情活动" && !("fromArray" in cellArray));
		// 老路的输出 = **字面量 golden**（`[[name, meta], …]`，由 d3e9d35 的 `legacyCellOf` 采出）
		const oldRows = LEGACY.coreSyntheticRows || null;
		check("老路（oracle 字面量）的输出 = 数组派生的输出（同一条记录、数组只有主条 ⇒ 逐字相同）",
			JSON.stringify(rowText(oldRows)) === JSON.stringify(rowText(rowsOf(cellArray, NOW))),
			JSON.stringify([rowText(oldRows), rowText(rowsOf(cellArray, NOW))]));
	}

	// ⑤-5 等价性（硬验收）：同一份夹具，**老路 vs 数组派生**逐字比对
	//       覆盖 17 款（15 款端到端刷新 + 星铁 / 原神 两条 payload 级），比较「名称 / 档期文本 /
	//       探头行数 / 行顺序」。**34 个侧全部逐字相等**（diffs = 0）—— P2 收尾把原来那 6 处
	//       已知差异靠"补事实 + 按游戏分派规则"消掉了，断言不再留任何"允许不等"的口子。
	{
		const fixture = useFixtures();
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
		const only = (id) => ({ hidden: ids.filter((x) => x !== id) });
		// 来源声明的源站时区（P4 的 oracle 口径修正要用：把老路读出的"本机墙钟"换成绝对时刻、
		// 并把行文本按源站墙钟渲染 —— 与显示层 `x.tz` 同一口径）。
		const tzOfSource = (id) => {
			const s = T.SOURCES.find((x) => x.id === id);
			return (s && s.tz) || null;
		};
		const runGame = async (id, nowMs, seeds) => {
			const store = makeStore(only(id));
			// 2026-11-10：战双卡池默认源换成 bwiki `Test4/活动旗帜`；2026-11-11（晚）：活动默认源换成
			// **官方 CDN**「版本更新公告」（先前是 bwiki `Test4/活动日历`）。这条等价性 golden 是
			// **bwiki 版本更新公告**那版的存档 ⇒ 用真实设置存储把两侧都切到该备选源（与设置页写的是
			// 同一种值）；产物逐字仍是公告那版。
			for (const [k, v] of Object.entries(seeds || {})) await store.set(k, v);
			const engine = createEngine({ transport, storage: store, now: () => nowMs, timer: { setTimeout, clearTimeout } });
			const r = await engine.refresh();
			return r.games[id] || {};
		};
		// 战双备选源（版本更新公告）的标识 = altSourceId（这里就是 url）—— 卡池侧 / 活动侧各一条
		// ⚠️ 活动侧**按抓取器键查**，不要写 `eventAltSources[0]`：2026-11-11 起战双活动默认源是
		// 官方 CDN，第 0 项是「Bwiki 活动日历」，而这份 golden 钉的是「版本更新公告」那版存档。
		const ZSPMS_SRC = T.SOURCES.find((s) => s.id === "zspms") || {};
		const ZSPMS_NOTICE_SRC = (ZSPMS_SRC.altSources || []).find((a) => a.fetcher === "zspms-bwiki-notice");
		const ZSPMS_EVENT_NOTICE_SRC = (ZSPMS_SRC.eventAltSources || []).find((a) => a.fetcher === "zspms-bwiki-notice");
		// 赛马娘国际服活动侧（2026-11-14：默认源换成 **GameTora**，官方接口整站 403 降为备选）——
		// 这份 golden 是**官方公告**那版（10-02 夹具里没有覆盖当期的活动 ⇒ 空载荷）。与 zspms 同一手法：
		// 用设置存储把活动侧切回备选源 `uma-global-official`，产物逐字仍是公告那版空载荷。
		// GameTora 活动侧的有数据路径由 `test/cases-uma-gt.mjs` 单独钉（那里不走这份等价性 golden）。
		const UMA_GLOBAL_EVENT_ALT = ((T.SOURCES.find((s) => s.id === "uma-global") || {}).eventAltSources || [])
			.find((a) => a.fetcher === "uma-global-official");
		// 各游戏的 now = 夹具的抓取时刻（probe 实测过：这一组时刻每款都至少一侧有数据）
		const CASES = [
			["zzz", "2026-08-25T00:00:00.000Z"],
			["arknights", "2026-10-25T00:00:00.000Z"],
			["ba-cn", "2026-09-25T00:00:00.000Z"],
			["bandori", "2026-08-25T00:00:00.000Z"],
			["wuhuamixin", "2026-08-25T00:00:00.000Z"],
			["zspms", "2026-09-25T00:00:00.000Z"],
			["kedr", "2026-09-01T00:00:00.000Z"],
			["uma-cn", "2026-10-02T00:00:00.000Z"],
			["uma-jp", "2026-10-02T00:00:00.000Z"],
			["uma-global", "2026-10-02T00:00:00.000Z"],
			["p5x", "2026-09-25T00:00:00.000Z"],
			["nte", "2026-10-20T00:00:00.000Z"],
			["gf2", "2026-08-25T00:00:00.000Z"],
			["fgo", "2026-08-25T00:00:00.000Z"],
			["stellasora", "2026-09-01T00:00:00.000Z"]
		];
		const records = [];
		for (const [id, iso] of CASES) {
			const now = new Date(Date.parse(iso));
			const seeds = id === "zspms" && ZSPMS_NOTICE_SRC && ZSPMS_EVENT_NOTICE_SRC
				? {
					customUrls: JSON.stringify({ zspms: ZSPMS_NOTICE_SRC.url }),
					customEventUrls: JSON.stringify({ zspms: ZSPMS_EVENT_NOTICE_SRC.url })
				}
				: (id === "uma-global" && UMA_GLOBAL_EVENT_ALT
					? { customEventUrls: JSON.stringify({ "uma-global": UMA_GLOBAL_EVENT_ALT.url }) }
					: null);
			records.push({ id, now, rec: await runGame(id, now.getTime(), seeds) });
		}
		// 星铁（bwiki 历史跃迁 / 活动一览，形状与线上一致的真机夹具；与 ④-9 同一份）
		{
			const FIX = (dir) => fixtureBody("fixture:" + dir, { ["fixture:" + dir]: dir + "/response.txt" });
			const warpBody = FIX("p4-hsr-bwiki-warp-1107");
			const eventsBody = FIX("p4-hsr-bwiki-events-1107");
			let body = "";
			const hsrTransport = {
				async fetchRaw() { return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) }; },
				async fetchViaProxy() { return body; }
			};
			const now = new Date(Date.parse("2026-11-07T00:00:00.000Z"));
			const probe = createEngine({ transport: hsrTransport, storage: makeStore(), now: () => now.getTime(), timer: { setTimeout, clearTimeout } });
			const meta = { id: "hsr", tz: "Asia/Shanghai" };
			body = warpBody;
			const gp = await probe.__test.GACHA_FETCHERS["hsr-bwiki"]("https://wiki.biligame.com/sr/api.php?action=parse&page=warp", undefined, "Asia/Shanghai");
			const recG = probe.__test.mergeEntryRecord({ data: gp || {} }, null, now.getTime(), meta);
			body = eventsBody;
			const ep = await probe.__test.EVENT_FETCHERS["hsr"].default("https://wiki.biligame.com/sr/api.php?action=parse&page=events", undefined, "Asia/Shanghai");
			const recE = probe.__test.mergeEntryRecord({ data: ep || {} }, null, now.getTime(), meta);
			// 两侧记录合并：卡池字段取 recG、活动字段取 recE，**两个数组各自保留**（recE 里的 gacha 是空数组）
			records.push({ id: "hsr", now, rec: Object.assign({}, recG, recE, { gacha: recG.gacha, events: recE.events }) });
		}
		// 原神（米游社；卡池侧正文无日期 ⇒ gacha 空数组，只比活动侧；与 ④-1 同一份）
		{
			const now = new Date(Date.parse("2026-10-02T14:37:53.720Z"));
			const probe = createEngine({ transport, storage: makeStore(), now: () => now.getTime(), timer: { setTimeout, clearTimeout } });
			const miyoushe = (gids, type) => "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=" + gids + "&type=" + type + "&page_size=20";
			const ev = await probe.__test.EVENT_FETCHERS["genshin"]["genshin-miyoushe"].default(miyoushe(2, 2), undefined, "Asia/Shanghai");
			const rec = probe.__test.mergeEntryRecord({ data: ev || {} }, null, now.getTime(), { id: "genshin", tz: "Asia/Shanghai" });
			records.push({ id: "genshin", now, rec });
		}

		// ⚠️ 2026-11-07（P4）`scheduleMeta` 多了第 3 参 `tz`：显示层按**条目自己的源站时区**渲染
		// 档期文本（数组条目的 ts 现在是绝对时刻，按本机渲染会把海外源显示错 1~9 小时）。
		// 这里的 oracle 行也必须用**同一个渲染口径**（`x.tz`），否则比的是"两种渲染"而不是"两条数据路径"；
		// 老路（oracle）的行没有 `tz` 键 ⇒ 退回本机时区 ⇒ 文本仍是同一串源站原文（本地解析 + 本地渲染）。
		const rowOf = (x, now) => ({ name: x.show || x.title || x.raw || "—", meta: T.scheduleMeta(x, now, x.tz) });
		const rowsOf = (cell, now) => (cell ? [cell.primary].concat(cell.rest.slice().sort(T.schedulePickItem)).map((x) => rowOf(x, now)) : null);
		const text = (rows) => (rows ? rows.map((r) => r.name + " ⏎ " + r.meta) : rows);

		const got = new Map();          // "id:side" → { old, next }
		const fallback = [];            // 有数组却派生不出条目（或又长出一条 fromArray 分支）的一侧
		const goldenMiss = [];          // 字面量 golden 里缺这个键（覆盖不足 ⇒ 等价性就成了空话）
		const diffs = [];
		for (const { id, now, rec } of records) {
			// `tz` = 来源声明的源站时区（与 CalendarPanel 传给 `scheduleNormalize` 的对象同形）——
			// 显示层按它渲染源站墙钟，等价性两边都用同一口径。
			const g = Object.assign({ id, name: id, tz: tzOfSource(id) }, rec);
			for (const side of ["gacha", "event"]) {
				const key = id + ":" + side;
				const hasArray = ((side === "gacha" ? g.gacha : g.events) || []).length > 0;
				const nextCell = T.scheduleCellOf(g, side, now);
				// P3c：`fromArray` 字段已不存在（兼容分支删了）—— 现在守"有数组的一侧必须派生得出条目"，
				// 且返回对象里**不许**再冒出 `fromArray`（防止有人把兼容分支偷偷加回来）。
				if (hasArray && (!nextCell || "fromArray" in nextCell)) fallback.push(key);
				// 老路 = 改造前的兼容分支（P3c 从产品删除；P5 清理把它的**输出**冻结成字面量）：
				// 记录字符串 → scheduleNormalize 出外显 + 悬停文本逆解析补并列条目。
				const old = (LEGACY.coreRows || {})[key];
				if (!(key in (LEGACY.coreRows || {}))) goldenMiss.push(key);
				const next = rowsOf(nextCell, now);
				got.set(key, { old, next });
				if (JSON.stringify(old) !== JSON.stringify(next)) diffs.push(key);
			}
		}
		check("等价性前置：有数组的一侧都派生出条目、且没有偷偷长回 `fromArray` 兼容字段；golden 覆盖 34 个侧",
			fallback.length === 0 && goldenMiss.length === 0, JSON.stringify([fallback, goldenMiss]));
		// 硬验收（P2 收尾）：34 个侧**一个不差**地逐字相等 —— 不再有"允许不等"的白名单
		// ⚠️ 2026-11-09 用户口径变更（「起点未知 ≠ 已开始」）：星铁 bwiki 侧（`hsr:gacha` / `hsr:event`）
		// 的外显**有意不再等于改造前** —— 改造前把「X.Y版本更新后」（无日期）当成已开始，星铁活动
		// 夹具里的「巡星之礼」就是这么当上外显的。这是**已批准的差异**，不是回归；
		// ⚠️ 2026-11-09 另一处（「活动名去掉尾部『活动说明』」）：星塔旅人活动侧（`stellasora:event`）
		// 的名称行里不再有那个体裁尾巴（改造前是 `「联合讨伐」活动说明`）⇒ 同样是有意变更。
		// 白名单只有这 3 个键（下面单独守长度），逐字期望分别由 cases-p4 / cases-hsr-official 与 cases-p7 钉住。
		const APPROVED_DIFF = new Set(["hsr:gacha", "hsr:event", "stellasora:event"]);
		// ⚠️ 2026-11-10（用户要求）：p5x 的「只有日期、没有时刻」窗口改成 00:00 起 / 23:59 止
		// （仓库通用约定，见 `ns_bwiki_windowsFromCell` 注释）。golden 是改造前 04:00 / 03:59 的存档
		// ⇒ 这两侧登记为**已批准差异**，并由下面的专项断言逐行证明"差异只是这条时间口径"。
		const DAY_ONLY_KEYS = new Set(["p5x:gacha", "p5x:event"]);
		const unapproved = diffs.filter((k) => !APPROVED_DIFF.has(k) && !DAY_ONLY_KEYS.has(k));
		check("等价性：17 款游戏（34 个侧）**全部逐字相等**（diffs = 0；名称 / 档期文本 / 探头行数 / 行顺序）",
			unapproved.length === 0, JSON.stringify(unapproved));
		check("等价性白名单 = 3 个已批准（星铁 2 + 星塔 1）+ p5x 2 个纯日期时间口径（这些键都必须真的变了）",
			diffs.length === APPROVED_DIFF.size + DAY_ONLY_KEYS.size
			&& [...APPROVED_DIFF].every((k) => diffs.indexOf(k) >= 0)
			&& [...DAY_ONLY_KEYS].every((k) => diffs.indexOf(k) >= 0),
			JSON.stringify(diffs));
		// p5x 专项：名称 / 行数 / 顺序逐字相同；老路（04:00 起 / 03:59 止）按同一条规则换算后与新值逐字相等
		const p5xDayShift = (meta) => String(meta == null ? "" : meta)
			.replace(/(\d{2}-\d{2}) 04:00/g, "$1")
			.replace(/(\d{2}-\d{2}) 03:59/g, "$1 23:59")
			.replace(/还剩 (?:(\d+)天)?(\d+)时/g, (m, d, h) => {
				const total = (+(d || 0)) * 24 + (+h) + 20;           // 终点 03:59 → 23:59 ⇒ +20h
				return `还剩 ${Math.floor(total / 24)}天${total % 24}时`;
			});
		for (const key of DAY_ONLY_KEYS) {
			const d = got.get(key);
			const want = (d && d.old ? d.old : []).map((r) => ({ name: r.name, meta: p5xDayShift(r.meta) }));
			check(`等价性（${key}）**已批准差异**：名称/行数/顺序逐字相同，档期只是「纯日期 ⇒ 00:00 / 23:59」`,
				!!d && JSON.stringify(want) === JSON.stringify(d.next), JSON.stringify([want, d && d.next]));
		}
		const STRICT = ["zzz", "arknights", "ba-cn", "bandori", "wuhuamixin", "zspms", "kedr", "uma-cn", "uma-jp", "uma-global", "p5x", "nte", "gf2", "fgo", "stellasora", "hsr", "genshin"];
		const strictBad = [];
		for (const id of STRICT) {
			for (const side of ["gacha", "event"]) {
				const key = id + ":" + side;
				if (APPROVED_DIFF.has(key) || DAY_ONLY_KEYS.has(key)) continue;   // 已批准差异（见上）
				const d = got.get(key);
				if (!d || JSON.stringify(d.old) !== JSON.stringify(d.next)) strictBad.push(key);
			}
		}
		check("等价性：17 款游戏（34 个侧）逐侧再钉一遍同一条不变量（含「这一侧没有数据」的那些）",
			strictBad.length === 0, JSON.stringify(strictBad));
		// 反向证明：那 2 个"已批准差异"确实**真的变了**（不是白名单把没变的键也放过）
		check("反向证明：那 2 个星铁侧的老路与数组派生**确实不再相等**（口径变更真的生效了）",
			[...APPROVED_DIFF].every((k) => {
				const d = got.get(k);
				return !!d && JSON.stringify(d.old) !== JSON.stringify(d.next);
			}),
			JSON.stringify([...APPROVED_DIFF].map((k) => {
				const d = got.get(k);
				return [k, !!d && JSON.stringify(d.old) === JSON.stringify(d.next)];
			})));

		// ── 原来那 6 处「已知差异」：现在是**严格相等** ─────────────────────────────
		// 断言从"老路 N 行 / 新路 M 行"改成"两侧逐字相等 + 行数 + 外显名"，并额外钉住
		// "回来的是哪一行" —— 特化规则或判重口径被改坏时这里会直接红，而不是"反正还是 34 侧"。
		const strictSide = (key, first, rows) => {
			const d = got.get(key);
			check(`已知差异已清零（${key}）：老路与数组派生**逐字相等**（${rows} 行，外显「${first}」）`,
				!!d && !!d.old && !!d.next && d.old.length === rows && d.next.length === rows
				&& d.old[0].name === first && d.next[0].name === first
				&& JSON.stringify(d.old) === JSON.stringify(d.next),
				JSON.stringify([d && text(d.old), d && text(d.next)]));
			return d;
		};
		const wmG = strictSide("wuhuamixin:gacha", "李小孩项链、王氏书翰卷", 3);
		check("判重口径：物华弥新卡池「繁霜春落：李小孩项链」回来了（引擎主行之外多一条，source = hover）",
			!!wmG && wmG.next[1].name === "繁霜春落：李小孩项链",
			JSON.stringify(wmG && wmG.next.map((r) => r.name)));
		// ⚠️ 2026-11-07（P4 单边窗口）：星铁这一格里 3 口池的源站原文是「4.6/4.7版本更新后 ~ …」——
		// 起点读不出、终点明确。以前两端一起判 null ⇒ 这 3 行**数组里有、探头与「近期」里没有**；
		// P4 起两端各自解析 ⇒ 行数 2 → 5（"同一游戏的多个在期条目各占一行"正是本阶段的目标）。
		// ⚠️ 2026-11-09：这一侧是**已批准差异**（见上面 APPROVED_DIFF）—— 老路拿改造前的
		// 记录字符串合成（roles 里含真珠等"起点未知"的池），新口径只认两端明确的那口池。
		// 所以这里不再用 `strictSide`（它要求 old == next），改为**直接钉新口径的逐字形状**；
		// 老的 12 字段/数组 golden 仍在 P3b 里（作为"改造前长什么样"的存档）。
		const hsrG = (() => {
			const d = got.get("hsr:gacha");
			check("已知差异（hsr:gacha）：新口径 = 4 行（主行 + 3 条悬停行），外显「千冶•刃」",
				!!d && !!d.next && d.next.length === 4 && d.next[0].name === "千冶•刃",
				JSON.stringify([d && text(d.old), d && text(d.next)]));
			return d;
		})();
		check("判重口径：星铁卡池「「沧海萃珠」…：真珠」仍在（不在期不代表事实被删）",
			!!hsrG && hsrG.next[1].name.indexOf("「沧海萃珠」角色活动跃迁：") === 0,
			JSON.stringify(hsrG && hsrG.next.map((r) => r.name)));
		check("单边窗口：星铁那 3 口「版本更新后」的池也列出来了 —— 行文本写「至 <终点> · 开始时间未知」，不编造开始时刻",
			!!hsrG && hsrG.next.slice(1).length === 3
			&& hsrG.next.slice(1).every((r) => r.meta.indexOf("至 ") === 0 && r.meta.indexOf("开始时间未知") > 0),
			JSON.stringify(hsrG && hsrG.next.slice(1).map((r) => r.meta)));
		strictSide("wuhuamixin:event", "「寂夜长生」限时活动", 6);
		strictSide("zspms:event", "回路演算", 9);
		strictSide("uma-cn:event", "赛事活动“群英联赛 中距离”", 4);
		strictSide("uma-jp:gacha", "【予告】トゥインクルコレクション プリティーダービーガチャとSSR確定スピードガチャ開催決定！", 2);

		// ── 反向证明：把特化规则还原成通用规则 ⇒ 对应侧必须变（"零可见变化"靠的是规则表）──
		// 入口就是 `sideViewOf` 的 **gameId 省略**（= 通用规则）：同一份数组、同一个 now，
		// 通用规则选出来的外显与老实现不一致 ⇒ 说明那条特化规则是**承重的**，删不得。
		const recOf = (id) => records.find((r) => r.id === id);
		const genericNameOf = (id, side) => {
			const r = recOf(id);
			const g = Object.assign({ id, name: id }, r.rec);
			const p = T.sideViewOf(side === "gacha" ? g.gacha : g.events, r.now, side);
			return p.primary ? (p.primary.show || p.primary.title) : null;
		};
		for (const [key, oldFirst] of [
			["uma-jp:gacha", "【予告】トゥインクルコレクション プリティーダービーガチャとSSR確定スピードガチャ開催決定！"],
			["zspms:event", "回路演算"],
			["uma-cn:event", "赛事活动“群英联赛 中距离”"],
			["wuhuamixin:event", "「寂夜长生」限时活动"]
		]) {
			const [id, side] = key.split(":");
			const generic = genericNameOf(id, side);
			check(`反向证明（${key}）：特化规则换回通用规则 ⇒ 外显变成「${generic}」，不再等于老实现「${oldFirst}」`,
				generic !== oldFirst, JSON.stringify([generic, oldFirst]));
		}

		// ── FGO 的**另一侧**（2026-09-05）：档位来自源站「类型」列（Event 压过 Campaign）──
		// 这一侧 08-25 时恰好通用规则也对，所以上面那条 34/34 覆盖不到真正的差异；这里用
		// 09-05 复跑：通用规则会选「3200万下载突破纪念活动（Campaign，结束最早）」，老实现选
		// 「失落的创世…（Event）」⇒ `category` 事实 + 特化规则**缺一不可**（反向证明也钉在这里）。
		{
			const now = new Date(Date.parse("2026-09-05T00:00:00.000Z"));
			const rec = await runGame("fgo", now.getTime());
			const g = Object.assign({ id: "fgo", name: "fgo", tz: tzOfSource("fgo") }, rec);
			const nextCell = T.scheduleCellOf(g, "event", now);
			const old = LEGACY.coreFgo0905Rows || null;   // P5 清理：老路的输出已冻结成字面量
			const next = rowsOf(nextCell, now);
			check("等价性（FGO 09-05）：老路（oracle 字面量）与数组派生逐字相等（外显 = 「失落的创世(Vanished Beginning) 来自未来的方舟」）",
				JSON.stringify(old) === JSON.stringify(next)
				&& !!old && old[0].name === "失落的创世(Vanished Beginning) 来自未来的方舟",
				JSON.stringify([text(old), text(next)]));
			const ev = g.events || [];
			check("事实（FGO 09-05）：`events` 每条都带 `category`（源站类型列 Event / Campaign，取不到才留空）",
				ev.length > 0 && ev.every((x) => typeof x.category === "string" && x.category.length > 0),
				JSON.stringify(ev.map((x) => [x.title, x.category])));
			const generic = T.sideViewOf(ev, now, "event");
			check("反向证明（fgo:event @09-05）：通用规则（无 gameId）会选成「3200万下载突破纪念活动」",
				!!generic.primary && generic.primary.title === "3200万下载突破纪念活动",
				JSON.stringify(generic.primary && generic.primary.title));
		}
	}
}

