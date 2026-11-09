// test/cases-zzz-bwiki.mjs —— 绝区零 bwiki 备选源：「起点未知 = 已开始」的**唯一**例外
//
// ── 为什么有这一批（用户当轮原话：「选 B，绝区零的 bwiki 不收录未来卡池」）──
// 2026-11-09 全仓口径改成「`startTs` 未知 ≠ 已开始」之后，绝区零的 bwiki 备选源
// （`altSources` 的「Bwiki 往期调频」，fetcher `zzz-bwiki`）整页都是 `X.Y版本更新后`（无日期）
// ⇒ 全部起点未知 ⇒ 一切到备选就恒显示「该来源无数据」（功能回归）。
// 但**该页不收录未来卡池**（只列已开的频段；2026-11-09 实测整页每行起点都写「X.Y版本更新后」、
// 终点是具体日期）⇒ 对这一条把"未知起点"当"已开始"是安全的。用户于是选了 B：
// **给这一条单独放行，其余来源一律保持严格**（开关挂在来源声明上，不是全局配置项）。
//
// ── 这一批守什么 ──
//   ① 开关只挂在**一条**来源上（注册表普查 + 静态守卫 + 它不在设置项里）；
//   ② 端到端：真实设置存储（`customUrls`）切成该备选源 → `refresh()` → 该侧**有数据**、
//      起点未知的池按"已开始"算（`scheduleCellOf` 非 null、`state === "live"` 且有倒计时）；
//   ③ 同一页换一个**没有**开关的抓取器（星铁 bwiki）⇒ 仍然严格（payload = null）
//      —— 证明放行是**按来源**生效的，不是"bwiki 一律放行"；
//   ④ 星铁 bwiki 备选（**真夹具**，那页收录未来池）仍然严格：4.6/4.7 那几口池只进悬停、
//      `state === "wait"`、不进「近期」；
//   ⑤ 默认源（绝区零官方公告）在**同样的情形**（起点未知的频段）下仍然严格 ⇒ null；
//   ⑥ 反向证明（进程内）：把开关临时改成 `false` ⇒ ② 的口径立刻变严格（payload = null）；
//      改回 `true` ⇒ 又有数据。**删掉开关这一行 ⇒ 本批 ② 与 cases-p3 的 P3d 端到端同时红。**
//
// ⚠️ 时间断言一律写**绝对毫秒**（`Date.parse` 带 `Z` / `+08:00`），UTC 与 +08 两道门禁跑同一份期望值。
// ⚠️ 本文件的"同一页喂给别的抓取器"是**刻意的交叉探针**（夹具复用），不是"这条来源的地址"。

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody } from "./harness.mjs";
import { T } from "./load.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const TZ_CN = "Asia/Shanghai";

// 夹具抓取时刻附近的"期中"时刻（2026-11-06 20:00 +08 / 12:00 UTC）：3.3上半的窗口（10-20 ~ 11-10）包住它，
// 星铁的窗口（10-21 ~ 11-10）包住它 ⇒ 两道时区门禁结果一致，不靠本机时区巧合。
const NOW = Date.parse("2026-11-06T12:00:00.000Z");
// 星铁 bwiki 那条路径的既定时刻（与 cases-hsr-official ④ 同一份，便于对照"另一侧仍严格"）
const NOW_HSR = Date.parse("2026-11-07T00:00:00.000Z");
// 绝区零官方公告的既定时刻（= 2026-10-25 12:00 +08，与 p3b-golden 的 zzzGacha 同一时刻）
const NOW_OFFICIAL = Date.parse("2026-10-25T04:00:00.000Z");

const ZZZ_BWIKI_BODY = fixtureBody("fixture:p3d-zzz-bwiki", { "fixture:p3d-zzz-bwiki": "p3d-zzz-bwiki/response.txt" });
const HSR_BWIKI_BODY = fixtureBody("fixture:p4-hsr-bwiki-warp-1107", { "fixture:p4-hsr-bwiki-warp-1107": "p4-hsr-bwiki-warp-1107/response.txt" });
const ZZZ_OFFICIAL_BODY = fixtureBody("fixture:p4-zzz-freq-official", { "fixture:p4-zzz-freq-official": "p4-zzz-freq-official/response.txt" });

const makeStore = (seed) => {
	const m = new Map(Object.entries(seed || {}));
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
// 同一份 body 同时供两条出口：bwiki 走 `fetchRaw`（mkMediaWiki 直连 + origin=*），官方公告走 `fetchViaProxy`。
const mkTransport = (getBody) => ({
	async fetchRaw() {
		const t = getBody();
		return { ok: true, status: 200, headers: { get: () => null }, text: async () => t, json: async () => JSON.parse(t) };
	},
	async fetchViaProxy() { return getBody(); }
});

export default async function run() {
	const engine0 = createEngine({ transport: mkTransport(() => ZZZ_BWIKI_BODY), storage: makeStore(), now: () => NOW, timer: { setTimeout, clearTimeout } });
	const SRC = engine0.__test.SOURCES.find((s) => s.id === "zzz");
	const ALT = ((SRC && SRC.altSources) || []).find((a) => a.fetcher === "zzz-bwiki");
	if (!ALT) throw new Error("绝区零没有登记 zzz-bwiki 备选源（本批的前提没了）");
	const WIKI_URL = ALT.url;

	// ───────────────────── ① 开关只挂在这一条来源上 ─────────────────────
	section("zzz bwiki ①：开关只挂在绝区零「Bwiki 往期调频」这一条备选源上");
	{
		check("zzz.altSources 的「Bwiki 往期调频」显式声明了 `unknownStartIsActive: true`",
			ALT.unknownStartIsActive === true && ALT.label === "Bwiki 往期调频" && ALT.fetcher === "zzz-bwiki",
			JSON.stringify(ALT));

		// 注册表普查：**所有**条目、所有备选源里，带这个开关的只能有这 1 条
		const flagged = [];
		for (const s of engine0.__test.SOURCES) {
			for (const a of [].concat(s.altSources || [], s.eventAltSources || [])) {
				if (a && a.unknownStartIsActive === true) flagged.push(s.id + "/" + a.fetcher);
			}
		}
		check("33 款里带这个开关的来源**恰好 1 条**（= zzz/zzz-bwiki），其余一律没有",
			flagged.length === 1 && flagged[0] === "zzz/zzz-bwiki", JSON.stringify(flagged));

		// 星铁 bwiki 备选**必须没有**这个开关（那页收录未来池，放行会重现"未来池假在期"）
		const hsr = engine0.__test.SOURCES.find((s) => s.id === "hsr");
		const hsrAlt = ((hsr && hsr.altSources) || []).find((a) => a.fetcher === "hsr-bwiki");
		check("星铁 bwiki 备选**没有**这个开关（收录未来池，放行会假在期）",
			!!hsrAlt && hsrAlt.unknownStartIsActive === void 0, JSON.stringify(hsrAlt));
		// 默认源（官方公告）不是备选源，压根不该有这个字段
		check("默认源（zzz 官方公告 / hsr 官方公告 CMS）条目本身没有这个开关",
			SRC.unknownStartIsActive === void 0 && hsr.unknownStartIsActive === void 0,
			JSON.stringify([SRC.unknownStartIsActive, hsr.unknownStartIsActive]));

		// 静态守卫：源码里这个开关只有一个**声明点**（非注释行 `<字段>: true` 只出现在 30-game-hoyoverse.js）
		const srcDir = path.join(REPO, "src", "client");
		const declarers = readdirSync(srcDir).filter((f) => f.endsWith(".js")).filter((f) => {
			const lines = readFileSync(path.join(srcDir, f), "utf8").split("\n");
			return lines.some((l) => !/^\s*(\/\/|\*)/.test(l) && /unknownStartIsActive\s*:\s*true/.test(l));
		});
		check("源码里 `unknownStartIsActive: true` 只出现在 30-game-hoyoverse.js（别处没人偷偷打开它）",
			declarers.length === 1 && declarers[0] === "30-game-hoyoverse.js", JSON.stringify(declarers));

		// 它不是设置项：不进配置 schema / DEFAULT_SETTINGS / CONFIG_KEYS
		const cfgFiles = [path.join(REPO, "src", "index.js"), path.join(srcDir, "10-config.js"), path.join(srcDir, "engine-head.js")];
		const inCfg = cfgFiles.filter((f) => readFileSync(f, "utf8").includes("unknownStartIsActive"));
		check("它不是配置项（src/index.js 的 schema / 10-config.js 的 DEFAULT_SETTINGS / engine-head.js 的 CONFIG_KEYS 都没有它）",
			inCfg.length === 0 && !("unknownStartIsActive" in T.DEFAULT_SETTINGS), JSON.stringify(inCfg));
	}

	// ───────────────────── ② 端到端：切成该备选源 ⇒ 有数据 + state=live ─────────────────────
	section("zzz bwiki ②：端到端手动切源 —— 该侧有数据，且起点未知的池按「已开始」算");
	const e2e = await (async () => {
		const allIds = engine0.__test.SOURCES.map((s) => s.id);
		const store = makeStore();
		await store.set("hidden", allIds.filter((x) => x !== "zzz"));
		// 设置页写的就是这个值：备选源的 `url`（见 altSourceId / getEntryUrl），与用户点一下下拉等价
		await store.set("customUrls", JSON.stringify({ zzz: WIKI_URL }));
		const e = createEngine({ transport: mkTransport(() => ZZZ_BWIKI_BODY), storage: store, now: () => NOW, timer: { setTimeout, clearTimeout } });
		const res = await e.refresh();
		const rec = (res.games || {}).zzz || {};
		return { rec, arr: rec.gacha || [], view: T.scheduleCellOf(Object.assign({ id: "zzz" }, rec), "gacha", new Date(NOW)) };
	})();
	{
		check("切源后卡池侧真的取到数据（数组非空，不是「该来源无数据」）",
			e2e.arr.length > 0 && e2e.rec.gachaFail === null,
			JSON.stringify([e2e.arr.length, e2e.rec.gachaFail]));
		check("外显条目能派生出来（`scheduleCellOf(...) !== null`）",
			!!e2e.view && !!e2e.view.primary, JSON.stringify(e2e.view && e2e.view.primary && e2e.view.primary.title));
		check("外显 = 「倾掷浮生」039-1期独家频段（该页当期那口主池）",
			!!e2e.view && e2e.view.primary.title === "「倾掷浮生」039-1期独家频段",
			JSON.stringify(e2e.view && e2e.view.primary && e2e.view.primary.title));
		check("起点未知的池按「已开始」算：`state === \"live\"` 且有倒计时（旧严格口径这里是 long/wait）",
			!!e2e.view && e2e.view.primary.state === "live" && e2e.view.primary.remain > 0,
			JSON.stringify(e2e.view && [e2e.view.primary.state, e2e.view.primary.remain]));
		// 放行只影响"算不算在期"，**不改源站原文**：档期原文仍是「X.Y版本更新后」那串
		check("源站原文没被改写：`bannerDatesRaw` 仍是「3.3版本更新后 ~ 11-10 11:59」",
			e2e.rec.bannerDatesRaw === "3.3版本更新后 ~ 11-10 11:59",
			JSON.stringify(e2e.rec.bannerDatesRaw));
	}

	// ───────────────────── ③ 同一页 + 没有开关的抓取器 ⇒ 仍然严格 ─────────────────────
	section("zzz bwiki ③：放行是**按来源**的 —— 同一页换成没有开关的抓取器（星铁 bwiki）⇒ 严格 null");
	{
		const on = await engine0.__test.GACHA_FETCHERS["zzz-bwiki"](WIKI_URL, undefined, TZ_CN);
		const off = await engine0.__test.GACHA_FETCHERS["hsr-bwiki"](WIKI_URL, undefined, TZ_CN);
		check("带开关的 zzz-bwiki：同一页 ⇒ 有载荷（当期频段 + 档期）",
			!!on && on.banner === "「倾掷浮生」039-1期独家频段" && !!on.bannerDates,
			JSON.stringify(on && [on.banner, on.bannerDates]));
		check("**不带**开关的 hsr-bwiki：同一页 ⇒ null（起点未知仍不算已开始，放行没有外溢）",
			off === null, JSON.stringify(off));
	}

	// ───────────────────── ④ 星铁 bwiki 备选（真夹具）仍然严格 ─────────────────────
	section("zzz bwiki ④：星铁 bwiki 备选仍严格 —— 收录未来池的那页不因本批松动");
	{
		const eH = createEngine({ transport: mkTransport(() => HSR_BWIKI_BODY), storage: makeStore(), now: () => NOW_HSR, timer: { setTimeout, clearTimeout } });
		const pay = await eH.__test.GACHA_FETCHERS["hsr-bwiki"]("https://wiki.biligame.com/sr/api.php?action=parse&page=%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81&prop=text&format=json&formatversion=2", undefined, TZ_CN);
		const rec = eH.__test.mergeEntryRecord({ data: pay || {} }, null, NOW_HSR, { id: "hsr", tz: TZ_CN });
		const game = Object.assign({ id: "hsr", name: "崩坏：星穹铁道", tz: TZ_CN }, rec);
		const cell = T.scheduleCellOf(game, "gacha", new Date(NOW_HSR));
		const flat = T.scheduleFlattenOf([game], new Date(NOW_HSR)).all;
		check("星铁 bwiki 备选：外显仍是唯一两端明确的「我身即刃」（4.6/4.7 那几口池不参选）",
			!!cell && cell.primary.title === "「我身即刃」角色活动跃迁",
			JSON.stringify(cell && cell.primary && cell.primary.title));
		check("星铁 bwiki 备选：起点未知的池 `state === \"wait\"`（不是 live）",
			(rec.gacha || []).filter((x) => x.startTs == null)
				.every((x) => { const it = T.scheduleItemOf(game, "gacha", x, new Date(NOW_HSR)); return !!it && it.state === "wait"; }),
			JSON.stringify((rec.gacha || []).filter((x) => x.startTs == null).map((x) => [x.title, (T.scheduleItemOf(game, "gacha", x, new Date(NOW_HSR)) || {}).state])));
		check("星铁 bwiki 备选：那几口池**仍在悬停/数组里**（事实不丢，只是不冒充在期）",
			(rec.gacha || []).some((x) => x.startTs == null) && flat.length > 0,
			JSON.stringify((rec.gacha || []).map((x) => x.title)));
	}

	// ───────────────────── ⑤ 默认源（官方公告）在同样情形下仍然严格 ─────────────────────
	section("zzz bwiki ⑤：默认源（绝区零官方公告）在**同样情形**下仍然严格 ⇒ null");
	{
		// 同样的情形 = 「起点只有一个版本标签、没有日期」。官方公告靠版本更新公告把起点锚到 06:00；
		// 锚不到（这一版没有更新公告）时，2026-11-09 之后**不再**把它当成在期（loose 分支已删）。
		const poisoned = {
			data: {
				list: [{
					sTitle: "9.9版本限时频段（上期）",
					sIntro: "本期代理人与音擎调频活动时间为：9.9版本更新后 ~ 2026/11/20 11:59",
					sContent: "活动期间，限定S级代理人[测试甲(火·强攻)]、[测试乙(冰·异常)]参与调频。",
					dtCreateTime: "2026-11-01 10:00:00"
				}]
			}
		};
		check("默认源解析：起点锚不到（无更新公告）⇒ `parseZzzFreq` 返回 null（不冒充在期）",
			T.parseZzzFreq(poisoned, NOW, TZ_CN) === null,
			JSON.stringify(T.parseZzzFreq(poisoned, NOW, TZ_CN)));
		// 真夹具（官方公告，起点锚得到）：值与改造前 golden 逐字相同 ⇒ 本批没碰默认源
		const eO = createEngine({ transport: mkTransport(() => ZZZ_OFFICIAL_BODY), storage: makeStore(), now: () => NOW_OFFICIAL, timer: { setTimeout, clearTimeout } });
		const official = await eO.__test.GACHA_FETCHERS["zzz"]("https://api-takumi-static.mihoyo.com/content_v2_user/app/706fd13a87294881/getContentList?iChanId=279&iPageSize=50&iPage=1&sLangKey=zh-cn", undefined, TZ_CN);
		check("默认源（官方公告，真夹具）：池名 / 角色 / 档期与改造前 golden 逐字相同（起点 10-21 06:00 由更新公告锚定）",
			!!official
			&& official.banner === "3.3版本限时频段（上期）"
			&& official.roles === "菲欧妮（异常·火）、维琳娜（异常·风）"
			&& official.bannerDates === "10-21 06:00 ~ 11-11 11:59"
			&& official.bannerDatesRaw === "3.3版本更新后 ~ 11-11 11:59",
			JSON.stringify(official && [official.banner, official.roles, official.bannerDates, official.bannerDatesRaw]));
	}

	// ───────────────────── ⑥ 反向证明（进程内）：拿掉开关 ⇒ 立刻严格 ─────────────────────
	section("zzz bwiki ⑥：反向证明 —— 把开关改成 false，同一页同一抓取器立刻变严格");
	{
		// ⚠️ `SOURCES` 在 core 产物里是**跨引擎共享**的模块级容器，而每次 `createEngine` 都会用
		// `Object.assign` 把 `altSources`（字面量数组 ⇒ 新对象）重新写进去 ⇒ 上面拿到的 `ALT`
		// 可能已经是**上一代**对象。改旗标前必须重新取一次"当前生效的那一条"，否则改的是影子。
		const liveAlt = () => engine0.__test.SOURCES.find((s) => s.id === "zzz").altSources.find((a) => a.fetcher === "zzz-bwiki");
		const before = liveAlt().unknownStartIsActive;
		let strict = null, relaxed = null;
		try {
			liveAlt().unknownStartIsActive = false;
			strict = await engine0.__test.GACHA_FETCHERS["zzz-bwiki"](WIKI_URL, undefined, TZ_CN);
			liveAlt().unknownStartIsActive = true;
			relaxed = await engine0.__test.GACHA_FETCHERS["zzz-bwiki"](WIKI_URL, undefined, TZ_CN);
		} finally {
			liveAlt().unknownStartIsActive = before;   // 一定还原（不留脏状态）
		}
		check("开关 = false ⇒ payload = null（整页起点未知 ⇒ 如实「该来源无数据」）",
			strict === null, JSON.stringify(strict));
		check("开关 = true ⇒ 同一份页面立刻又有载荷（放行完全由这一行决定）",
			!!relaxed && relaxed.banner === "「倾掷浮生」039-1期独家频段", JSON.stringify(relaxed && relaxed.banner));
		check("反向证明的挂钩仍在：生效条目的开关已还原成声明的值（`true`）",
			liveAlt().unknownStartIsActive === true);
	}
}
