// test/cases-batch5.mjs —— 第五批：第三方来源 1 条（2026-11-15）
//
// 落点：`src/client/30-game-browndust2.js` —— 棕色尘埃2（Brown Dust 2），来源 = 第三方卡池史站点
// bannerhistory.app 的 `/en/bd2-pickup-history`（**只有卡池侧**；活动侧不注册）。
// 官方 API 被 AWS WAF 按本机 IP 拦（403 CloudFront）⇒ 用户拍板改走第三方（判据见源文件头 ①）。
//
// ── 这一段守什么 ──
//   ① **注册项**：id / 名称 / tz / 来源标签（逐字「bannerhistory.app（英文）」）/ 只有卡池侧 / 颜色；
//   ② **真夹具驱动**：RSC flight 负载 → `data` 对象 → 窗口（池名 + 角色 + 绝对毫秒起止）；
//      当期 2 口池、下一批 3 口、2023 老数据、多语言名 / 多成员名拼接；
//   ③ **引擎整轮**：首轮 **1 次**请求（整页缓存 24h ⇒ 同一引擎再刷 **0 次**）、外显/悬停逐字、
//      `gacha[]` 2 条、活动侧未配置不算失败；
//   ④ **反证**：`{}` / 空串 / 没有 flight 推送 / 没有 `"data":{"game":"bd2"` ⇒ **抛错**（不是 nomatch）；
//      `sourceZone` 变了 ⇒ 抛 `zone`；`rows` 空 / 全是脏行 ⇒ 抛 `no-window`；没有覆盖 now ⇒ null。
//
// ⚠️ 时间断言一律写**绝对毫秒**（`Date.UTC(...)` 手算，不用 `sourceInstant` 自证）：
//    这样 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁跑的是同一份期望值。
//
// 夹具（真抓 + 裁剪，见 `test/fixtures/bd2-pickup-history/response.txt.meta.json`）：
//   线上整页 496,268 B → 只保留承载数据的 `<script>self.__next_f.push([1,"…"])</script>`，
//   `rows` 剪成 41 条 = 全部 38 条 2026 年 + 最早 3 条 2023 年（真实 163 条 / 245 口池）。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, assertHoverConvention } from "./harness.mjs";
import { T } from "./load.mjs";

const NOW = Date.parse("2026-11-15T16:29:00+08:00");     // 真抓时刻（+08）
const NOW_NEXT = Date.parse("2026-11-20T12:00:00+09:00"); // 下一批（11-19 09:00 KST）开池后
const NOW_EMPTY = Date.parse("2027-01-01T12:00:00+09:00"); // 全部窗口都结束过
const srcOf = (id) => T.SOURCES.find((s) => s.id === id) || null;
const allIds = () => T.SOURCES.map((s) => s.id);

const makeStore = (seed) => {
	const m = new Map(Object.entries(seed || {}));
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
/** 夹具 transport：默认按 map.json 取夹具原文；`overrides` 里按 URL 覆盖（反证用）。 */
const makeTransport = (sink, overrides) => ({
	async fetchRaw(url) {
		if (sink) sink.push(String(url));
		throw new Error("本批来源走宿主代理（mode=proxy）：" + url);
	},
	async fetchViaProxy(url) {
		const u = String(url);
		if (sink) sink.push(u);
		if (overrides && overrides[u] != null) return overrides[u];
		return fixtureBody(u);
	}
});
const engineAt = (now, shownId, sink, overrides) => {
	const others = allIds().filter((x) => x !== shownId);
	return createEngine({
		transport: makeTransport(sink, overrides),
		storage: makeStore({ hidden: others, shown: [shownId] }),
		now: () => now,
		timer: { setTimeout, clearTimeout }
	});
};

export default async function run() {
	const B = T.parsers.browndust2;
	const URL = B.BROWNDUST2_URL;
	const HTML = fixtureBody(URL);
	const data = B.browndust2DataOf(HTML);
	const windows = B.browndust2WindowsOf(data, B.BROWNDUST2_TZ);
	const errOf = (fn) => { try { fn(); return ""; } catch (e) { return e && e.message; } };
	const kst = (ts) => new Date(ts + 9 * 3600e3).toISOString();
	// 合成一页「最小 RSC flight」：与线上同形（`self.__next_f.push([1,"…"])` 里的 `"data":{…}`），
	// 用来做「只坏一处」的反证（真夹具里的引号是转义过的，直接 replace 容易改不到点上）。
	const pageWithData = (dataText) =>
		'<html><body><script>self.__next_f.push([1,'
		+ JSON.stringify('8:[[{"data":' + dataText + '}]]')
		+ "])</script></body></html>";

	// ═════════ ① 注册项 ═════════
	section("第五批 ①：注册项（id / 名称 / tz / 第三方标签 / 只有卡池侧 / 颜色）");
	{
		const s = srcOf("browndust2");
		check("browndust2 已注册（name / tz / 标签逐字）",
			!!s && s.name === "棕色尘埃2·国际服" && s.tz === "Asia/Seoul" && s.source === "bannerhistory.app（英文）",
			s ? JSON.stringify([s.name, s.tz, s.source]) : "缺失");
		check("来源地址逐字 = bannerhistory.app 的 BD2 卡池史页",
			!!s && s.url === URL && URL === "https://bannerhistory.app/en/bd2-pickup-history",
			s && s.url);
		check("**只有卡池侧**（活动侧不注册 ⇒ 设置页显示未配置、不请求、不抛错）",
			!!s && !s.eventUrl && !s.eventSource, s ? JSON.stringify([s.eventUrl, s.eventSource]) : "缺失");
		check("出厂不展示（defaultHidden = true，缺活动侧；用户 2026-11-19 口径）", !!s && s.defaultHidden === true, s && String(s.defaultHidden));
		check("有配色（面板「颜色 = 游戏」）", !!s && /^#[0-9A-F]{6}$/i.test(String(s.color)), s && String(s.color));
		check("图标取自该站（bannerhistory.app 的 bd2 图标）",
			!!s && s.icon === "https://bannerhistory.app/icons/apps/bd2.png", s && s.icon);
		check("id 全局唯一（没和既有来源撞 id）", new Set(allIds()).size === allIds().length, String(allIds().length));
		check("常量与实现一致（tz / 时区声明 / 标签逐字 / 缓存 24h）",
			B.BROWNDUST2_TZ === "Asia/Seoul" && B.BROWNDUST2_SOURCE_ZONE === "Asia/Seoul"
			&& B.BROWNDUST2_SOURCE_LABEL === "bannerhistory.app（英文）"
			&& B.BROWNDUST2_CACHE_TTL_MS === 24 * 60 * 60 * 1000,
			JSON.stringify([B.BROWNDUST2_TZ, B.BROWNDUST2_SOURCE_ZONE, B.BROWNDUST2_SOURCE_LABEL, B.BROWNDUST2_CACHE_TTL_MS]));
	}

	// ═════════ ② 纯解析（真夹具）═════════
	section("第五批 ②：真夹具 —— RSC flight 负载 → data 对象 → 窗口（池名 + 角色 + 绝对毫秒起止）");
	{
		check("data 对象：game = bd2 / sourceZone = Asia/Seoul / 裁剪后 41 条 row",
			data.game === "bd2" && data.sourceZone === "Asia/Seoul" && data.rows.length === 41,
			JSON.stringify([data.game, data.sourceZone, data.rows.length]));
		check("窗口：76 口池（= 裁剪后 groups 总数），每条起止都齐全且 endTs > startTs",
			windows.length === 76 && windows.every((w) => w.startTs > 0 && w.endTs > w.startTs),
			JSON.stringify([windows.length, windows.filter((w) => !(w.endTs > w.startTs)).length]));
		check("起止 = 站点自算的绝对毫秒（KST 起 09:00 / 止 08:59，245 口池在线上全部如此）",
			windows.every((w) => kst(w.startTs).endsWith("T09:00:00.000Z") && kst(w.endTs).endsWith("T08:59:00.000Z")),
			JSON.stringify(windows.slice(0, 2).map((w) => [kst(w.startTs), kst(w.endTs)])));

		const cur = windows.filter((w) => w.startTs <= NOW && NOW <= w.endTs);
		check("当期（2026-11-15 16:29 +08）= 2 口池，按 row 顺序：Night of Betrayal / Maid Name R",
			cur.length === 2 && cur.map((w) => w.banner).join("|") === "Night of Betrayal|Maid Name R",
			JSON.stringify(cur.map((w) => [w.banner, w.roles])));
		check("当期起止逐字：11-05 09:00 ~ 11-19 08:59 / 11-05 09:00 ~ 12-03 08:59（+09 渲染）",
			cur[0].display === "11-05 09:00 ~ 11-19 08:59"
			&& cur[0].startTs === Date.UTC(2026, 10, 5, 0, 0) && cur[0].endTs === Date.UTC(2026, 10, 18, 23, 59)
			&& cur[1].display === "11-05 09:00 ~ 12-03 08:59"
			&& cur[1].startTs === Date.UTC(2026, 10, 5, 0, 0) && cur[1].endTs === Date.UTC(2026, 11, 2, 23, 59),
			JSON.stringify(cur.map((w) => [w.display, w.startTs, w.endTs])));
		check("raw = 源站原文日期对（只到日）/ roles = 角色名（`sub`）",
			cur[0].raw === "2026-11-05 ~ 2026-11-19" && cur[0].roles === "Valze"
			&& cur[1].raw === "2026-11-05 ~ 2026-12-03" && cur[1].roles === "Liatris",
			JSON.stringify(cur.map((w) => [w.raw, w.roles])));

		const nx = windows.filter((w) => w.startTs === Date.UTC(2026, 10, 19, 0, 0));
		check("下一批（2026-11-19 09:00 KST）3 口池：Last Hope / Bittersweet Bunny / Shadow Bunny",
			nx.length === 3 && nx.map((w) => `${w.banner}(${w.roles})`).join("|")
			=== "Last Hope(Loen)|Bittersweet Bunny(Darian)|Shadow Bunny(Eleaneer)",
			JSON.stringify(nx.map((w) => [w.banner, w.roles])));
		check("跨天/跨年判据：2023 老数据两条逐字（06-22 09:00 ~ 07-05 08:59）",
			windows.filter((w) => w.id.startsWith("BD2_20230622_")).length === 2
			&& windows.find((w) => w.banner === "Kendo Club").roles === "Justia"
			&& windows.find((w) => w.banner === "Kendo Club").startTs === Date.UTC(2023, 5, 22, 0, 0)
			&& windows.find((w) => w.banner === "Kendo Club").display === "06-22 09:00 ~ 07-05 08:59",
			JSON.stringify(windows.filter((w) => w.id.startsWith("BD2_20230622_")).map((w) => [w.banner, w.display])));

		check("多语言字段：en 优先，缺 en 依次回退 zh → tw → ja → ko，全空 = 空串",
			B.browndust2LangOf({ en: "A", zh: "甲" }) === "A"
			&& B.browndust2LangOf({ zh: "甲" }) === "甲"
			&& B.browndust2LangOf({ tw: "甲T" }) === "甲T"
			&& B.browndust2LangOf({ ja: "あ" }) === "あ"
			&& B.browndust2LangOf({ ko: "가" }) === "가"
			&& B.browndust2LangOf({}) === "" && B.browndust2LangOf(null) === "",
			JSON.stringify([B.browndust2LangOf({ zh: "甲" }), B.browndust2LangOf({})]));
		check("池名/角色分开取：多成员 ⇒ 池名 ` · ` 连接、角色 `、` 连接；全空 ⇒ 用 group id 去掉日期前缀兜底",
			(() => {
				const multi = B.browndust2LabelOf({ id: "BD2_20260101_A_B", members: [
					{ name: { en: "Cost A" }, sub: { en: "Role A" } },
					{ name: { en: "Cost B" }, sub: { en: "Role B" } }
				] });
				const bare = B.browndust2LabelOf({ id: "BD2_20260101_Some_Costume", members: [] });
				return multi.name === "Cost A · Cost B" && multi.role === "Role A、Role B"
					&& bare.name === "Some Costume" && bare.role === "";
			})(),
			JSON.stringify(B.browndust2LabelOf(data.rows[0].groups[0])));

		const items = B.browndust2ItemsOf(windows);
		check("条目事实：与窗口一一对应、_i 连续、isMain = true（喂共用载荷生成器）",
			items.length === windows.length && items.every((it, i) => it._i === i && it.isMain === true
				&& it.banner === windows[i].banner && it.roles === windows[i].roles
				&& it.startTs === windows[i].startTs && it.endTs === windows[i].endTs),
			JSON.stringify(items[0]));
	}

	// ═════════ ③ 引擎整轮（请求数 / 外显 / 悬停 / 缓存）═════════
	section("第五批 ③：引擎整轮 —— 首轮 1 次请求 / 24h 内 0 次 / 外显与悬停逐字");
	{
		B.browndust2ResetCache();
		const calls = [];
		const e = engineAt(NOW, "browndust2", calls);
		const rec = (await e.refresh()).games.browndust2 || {};
		check("首轮请求数 = 1（整页 496 KB 只取一次，走宿主代理，URL 逐字）",
			calls.length === 1 && calls[0] === URL, "requests=" + calls.length + " " + JSON.stringify(calls));
		check("外显：卡池 = Night of Betrayal / 角色 Valze / 11-05 09:00 ~ 11-19 08:59（结束最早的在期池）",
			rec.banner === "Night of Betrayal" && rec.roles === "Valze"
			&& rec.bannerDates === "11-05 09:00 ~ 11-19 08:59"
			&& rec.bannerDatesRaw === "2026-11-05 ~ 2026-11-19" && rec.gachaFail === null,
			JSON.stringify([rec.banner, rec.roles, rec.bannerDates, rec.bannerDatesRaw, rec.gachaFail]));
		check("活动侧：未配置（event 空串 / eventFail = null，未配置不算失败）",
			rec.event === "" && rec.eventFail === null && rec.eventDates === "",
			JSON.stringify([rec.event, rec.eventFail, rec.eventDates]));
		check("悬停逐字 4 行（2 口池，名称：角色 ⏎ 档期，结束升序）",
			rec.bannerHover === "Night of Betrayal：Valze\n11-05 09:00 ~ 11-19 08:59\n"
				+ "Maid Name R：Liatris\n11-05 09:00 ~ 12-03 08:59",
			JSON.stringify(rec.bannerHover));
		if (rec.bannerHover) assertHoverConvention("browndust2 卡池悬停", rec.bannerHover, { requireSet: true });
		check("gacha 数组 2 条（key 前缀 browndust2:gacha，primary / hover 各一，tz = Asia/Seoul）",
			Array.isArray(rec.gacha) && rec.gacha.length === 2
			&& rec.gacha[0].key === "browndust2:gacha:0" && rec.gacha[0].source === "primary"
			&& rec.gacha[1].key === "browndust2:gacha:1" && rec.gacha[1].source === "hover"
			&& rec.gacha.every((x) => x.tz === "Asia/Seoul"),
			JSON.stringify((rec.gacha || []).map((x) => [x.key, x.source])));

		// 同一引擎 24h 内再刷 ⇒ 解析结果按 URL 缓存 ⇒ 0 次请求
		const before = calls.length;
		const rec2 = (await e.refresh()).games.browndust2 || {};
		check("同一引擎再刷一次：0 次新请求（24h 缓存），外显不变",
			calls.length === before && rec2.banner === rec.banner && rec2.bannerHover === rec.bannerHover,
			"new requests=" + (calls.length - before));

		// 下一批开池后：外显换成结束最早的那口（Last Hope，12-03 08:59）
		B.browndust2ResetCache();
		const callsN = [];
		const recN = (await engineAt(NOW_NEXT, "browndust2", callsN).refresh()).games.browndust2 || {};
		check("2026-11-20 12:00 +09：外显 = Last Hope / Loen / 11-19 09:00 ~ 12-03 08:59（新一期 4 口在期取结束最早）",
			recN.banner === "Last Hope" && recN.roles === "Loen"
			&& recN.bannerDates === "11-19 09:00 ~ 12-03 08:59"
			&& recN.bannerDatesRaw === "2026-11-19 ~ 2026-12-03" && recN.gachaFail === null,
			JSON.stringify([recN.banner, recN.roles, recN.bannerDates]));
		check("2026-11-20 12:00 +09：悬停 8 行（4 口在期，按结束时间升序：Maid Name R 与 Last Hope 同窗）",
			recN.bannerHover === "Maid Name R：Liatris\n11-05 09:00 ~ 12-03 08:59\n"
				+ "Last Hope：Loen\n11-19 09:00 ~ 12-03 08:59\n"
				+ "Bittersweet Bunny：Darian\n11-19 09:00 ~ 12-17 08:59\n"
				+ "Shadow Bunny：Eleaneer\n11-19 09:00 ~ 12-17 08:59",
			JSON.stringify(recN.bannerHover));

		// 全部窗口都结束过 ⇒ null（当期没有，不是失败）
		B.browndust2ResetCache();
		const recE = (await engineAt(NOW_EMPTY, "browndust2", []).refresh()).games.browndust2 || {};
		check("2027-01-01：当期没有 ⇒ banner 空串 + gachaFail.kind = nomatch（不硬凑过期档期）",
			recE.banner === "" && String((recE.gachaFail || {}).kind) === "nomatch",
			JSON.stringify([recE.banner, recE.gachaFail]));
	}

	// ═════════ ④ 反证（结构变 ⇒ 抛错；脏数据 ⇒ 丢弃；当期没有 ⇒ null）═════════
	section("第五批 ④：反证 —— `{}` / 空串 / 没有 flight / 没有 data 锚 ⇒ 抛错（不是 nomatch）");
	{
		check("反证：空串 ⇒ `browndust2-page-changed:empty`",
			errOf(() => B.browndust2DataOf("")) === "browndust2-page-changed:empty",
			errOf(() => B.browndust2DataOf("")));
		check("反证：`{}` / 没有 flight 推送 ⇒ `browndust2-payload-changed:no-data`",
			errOf(() => B.browndust2DataOf("{}")) === "browndust2-payload-changed:no-data"
			&& errOf(() => B.browndust2DataOf("<html><body>no push here</body></html>")) === "browndust2-payload-changed:no-data",
			errOf(() => B.browndust2DataOf("{}")));
		check("反证：有 flight 推送但没有 `\"data\":{\"game\":\"bd2\"` 锚 ⇒ `no-data`",
			errOf(() => B.browndust2DataOf('<script>self.__next_f.push([1,"8:[[\\"$\\",1]]"])</script>'))
			=== "browndust2-payload-changed:no-data",
			"no anchor");
		check("反证：负载 JSON 坏（rows 的数组括号被换）⇒ `browndust2-payload-changed:bad-data`",
			errOf(() => B.browndust2DataOf(pageWithData('{"game":"bd2","sourceZone":"Asia/Seoul","rows":{')))
			=== "browndust2-payload-changed:bad-data",
			errOf(() => B.browndust2DataOf(pageWithData('{"game":"bd2","sourceZone":"Asia/Seoul","rows":{'))));
		check("反证：页面声明的时区变了（Asia/Seoul → UTC）⇒ `browndust2-payload-changed:zone`",
			errOf(() => B.browndust2DataOf(pageWithData(JSON.stringify({ ...data, sourceZone: "UTC" }))))
			=== "browndust2-payload-changed:zone",
			"zone changed");
		check("反证：`game` 不是 bd2（`\"data\":{\"game\":\"bd2\"` 这个锚也就没了）⇒ `no-data`",
			errOf(() => B.browndust2DataOf(pageWithData(JSON.stringify({ ...data, game: "zzz" }))))
			=== "browndust2-payload-changed:no-data",
			"game changed");

		check("反证：rows 为空 / 一条合法窗口都没有 ⇒ `browndust2-payload-changed:no-window`（结构变，不是未公布）",
			errOf(() => B.browndust2WindowsOf({ rows: [] }, B.BROWNDUST2_TZ)) === "browndust2-payload-changed:no-window"
			&& errOf(() => B.browndust2WindowsOf({ rows: [{ groups: [{ id: "x", startAt: 2, endAt: 1 }] }] }, B.BROWNDUST2_TZ))
			=== "browndust2-payload-changed:no-window",
			errOf(() => B.browndust2WindowsOf({ rows: [] }, B.BROWNDUST2_TZ)));

		check("反证：脏行（起止倒挂 / 非数字）**丢弃**，不清空整批（另一条合法窗口照出）",
			(() => {
				const ws = B.browndust2WindowsOf({
					rows: [{ groups: [
						{ id: "BD2_20260101_Bad", startAt: 100, endAt: 50, members: [{ name: { en: "Bad" } }] },
						{ id: "BD2_20260101_Good", startAt: 100, endAt: 200, members: [{ name: { en: "Good" } }] },
						{ id: "BD2_20260101_NaN", startAt: "x", endAt: 200, members: [{ name: { en: "NaN" } }] }
					] }]
				}, B.BROWNDUST2_TZ);
				return ws.length === 1 && ws[0].banner === "Good" && ws[0].startTs === 100 && ws[0].endTs === 200;
			})(),
			"dirty rows dropped");

		check("反证：引擎里整页回 `{}` ⇒ 卡池侧失败（gachaFail 有值），**不是**静默成「未公布」",
			await (async () => {
				B.browndust2ResetCache();
				const e = engineAt(NOW, "browndust2", [], { [URL]: "{}" });
				const r = (await e.refresh()).games.browndust2 || {};
				return r.banner === "" && !!(r.gachaFail && r.gachaFail.kind) && r.gachaFail.kind !== "nomatch";
			})(),
			"engine `{}`");
		check("反证：抹掉 `\"data\":{\"game\":\"bd2\"` 锚 ⇒ 引擎同样判失败（不是首页空）",
			await (async () => {
				B.browndust2ResetCache();
				const e = engineAt(NOW, "browndust2", [], { [URL]: pageWithData(JSON.stringify({ ...data, game: "zzz" })) });
				const r = (await e.refresh()).games.browndust2 || {};
				return r.banner === "" && !!(r.gachaFail && r.gachaFail.kind) && r.gachaFail.kind !== "nomatch";
			})(),
			"anchor removed");
		check("反证：`browndust2Gacha` 直调（纯函数 + 夹具）在 2027 年 ⇒ null（覆盖不到 now 就返回 null）",
			await (async () => {
				B.browndust2ResetCache();
				const e = engineAt(NOW_EMPTY, "browndust2", []);
				const s = e.__test.SOURCES.find((x) => x.id === "browndust2");
				const out = await e.__test.GACHA_FETCHERS["browndust2"](s.url, undefined, s.tz, NOW_EMPTY);
				return out === null;
			})(),
			"null at 2027");
	}
}
