// test/cases-ournotes-global-spica.mjs —— OurNotes·国际服 卡池 + 活动：默认源 = SPICA 结构化数据 JSON
// （2026-11-11 接入；替换掉原来那条「BHK 官方公告」的空默认源）
//
// ── 本段守什么 ──
//   ① 注册：url / eventUrl **同一条** SPICA 地址（两侧复用一次抓取）、来源标签、tz 仍 Asia/Shanghai（UTC+8）、
//      defaultHidden 仍 true、BHK 那两条**备选源**没被删掉（设置页还能切回去）、宿主白名单里有 spica.wiki；
//   ② 抓取链：页面 → `window._durl` → 数据 JSON，两步都经宿主代理；缺 `_durl` ⇒ 抛（不是静默 null）；
//   ③ 卡池条目事实：23 本 / 名称取 `name.en` / picks 按 **id** 查角色（不是按 snaps 的序号键）/
//      两端墙钟按 **JST** 转绝对时刻 / `end` 为空的常驻池 ⇒ endTs=null（不冒充当期）；
//   ④ 当期载荷：banner / roles / bannerDates（UTC+8 钟面）/ bannerDatesRaw（源站 JST 原文）/ 悬停 / 数组；
//   ⑤ 活动：events[5] 的 5 条 / 当期 e5 / 只有 1 条在期 ⇒ 无悬停（不足 2 条）；
//   ⑥ 整轮刷新：**只有 2 次请求**（页面 1 次 + 数据 JSON 1 次，活动侧复用卡池那次载荷）。
//
// ── 真夹具（test/fixtures/<名>/response.txt + .meta.json 的 url/capturedAt/trim）──
//   spica-en-gachas   列表页（44 KB 原样；抓取时刻 2026-11-11T02:0x+08）
//   spica-en-data     数据 JSON（1.5 MB → 机械裁剪到 15 KB，只留解析器读到的字段，值逐字不动）
//
// ── 时间断言一律用 `Date.UTC(...)` 手算 ──
//   UTC 与 +08 两道门禁跑**同一份期望值**，不存在"本机时区对了才绿"。
//   数据里是 **JST 钟面**：`2026-11-08 15:00` = UTC 06:00 = **UTC+8 14:00**（这正是本文件要钉的那 1 小时）。
//   NOW 固定 2026-11-11 12:00 +08 = UTC 04:00。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, useFixtures } from "./harness.mjs";
import { T } from "./load.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const P = T.parsers["ournotes-global-spica"];
const PAGE_URL = P.NS_ON_GLOBAL_URL;
// 数据地址**不写死** hash：从页面夹具里现解（与抓取器同一条链，hash 变了测试也不用改）
const DATA_URL = P.ns_on_global_dataUrlOf(P.ns_on_global_durlOf(fixtureBody(PAGE_URL)));
const NOW = Date.parse("2026-11-11T12:00:00+08:00");

const FIXTURES = useFixtures();   // 全局夹具 impl（下面的 transport 直接复用它）
const makeStore = (seed) => {
	const m = new Map(Object.entries(seed || {}));
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};

// 记账 transport：`fetchViaProxy` 把**目标地址**记进 sink（与真实宿主代理同一形态），
// 再复用 harness 的夹具 impl（它认 `/api/gacha-calendar-proxy?url=…` 前缀并拆 `{status, body}`）。
function makeTransport(sink) {
	return {
		async fetchRaw(url) {
			sink.push({ url: String(url), via: "raw", referer: "" });
			throw new Error("直连不该被用到：" + String(url));
		},
		async fetchViaProxy(url, opts) {
			const referer = (opts && opts.referer) || "";
			sink.push({ url: String(url), via: "proxy", referer });
			const api = "/api/gacha-calendar-proxy?url=" + encodeURIComponent(String(url));
			const res = await FIXTURES(api);
			const wrapped = JSON.parse(await res.text());
			if (wrapped.status !== 200) throw new Error("proxy-bad:" + wrapped.status);
			return wrapped.body;
		}
	};
}
const engineAt = (now, sink, extra) => createEngine({
	transport: makeTransport(sink),
	storage: makeStore(extra),
	now: () => now,
	timer: { setTimeout, clearTimeout }
});
const proxyCallsOf = (calls) => calls.filter((c) => c.via === "proxy");

export default async function runOnGlobalSpica() {
	const json = JSON.parse(fixtureBody(DATA_URL));

	// ═══════════════════ ① 注册 ═══════════════════
	section("OurNotes 国际服①：注册 —— 默认源换成 SPICA（两侧同一条地址 / tz 仍是 UTC+8 / 备选源保留）");
	{
		const s = T.SOURCES.find((x) => x.id === "ournotes-global") || null;
		check("条目已存在（id = ournotes-global）", !!s, s ? s.id : "缺失");
		check("卡池默认源 = SPICA 的 SPA 页面（此前该侧**没有**默认源，只有 BHK 备选）",
			!!s && s.url === PAGE_URL && /^https:\/\/spica\.wiki\/ournotes\/en\/gachas$/.test(s.url), s && String(s.url));
		check("活动默认源 = **同一条**地址（卡池与活动一次抓全 ⇒ 刷新走复用）",
			!!s && s.eventUrl === PAGE_URL && s.eventUrl === s.url, s && String(s.eventUrl));
		check("两侧来源标签 = SPICA（社区）",
			!!s && s.source === P.NS_ON_GLOBAL_SOURCE_LABEL && s.eventSource === P.NS_ON_GLOBAL_SOURCE_LABEL,
			s && JSON.stringify([s.source, s.eventSource]));
		check("tz 仍是 Asia/Shanghai（= UTC+8；展示口径，与数据里的 JST 钟面分开）",
			!!s && s.tz === "Asia/Shanghai" && s.tz === P.NS_ON_GLOBAL_TZ, s && s.tz);
		check("defaultHidden 保持 true（出厂隐藏未变）", !!s && s.defaultHidden === true, s && String(s.defaultHidden));
		check("BHK 官方公告两条**备选源仍在**（手动切回得去，抓取器键未变）",
			!!s && (s.altSources || []).length === 1 && s.altSources[0].fetcher === "ournotes-global-gacha"
			&& (s.eventAltSources || []).length === 1 && s.eventAltSources[0].fetcher === "ournotes-global-event",
			s && JSON.stringify([(s.altSources || []).map((a) => a.fetcher), (s.eventAltSources || []).map((a) => a.fetcher)]));
		check("两个默认抓取器都登记了（GACHA_FETCHERS[id] / EVENT_FETCHERS[id].default）",
			typeof T.GACHA_FETCHERS["ournotes-global"] === "function"
			&& !!(T.EVENT_FETCHERS["ournotes-global"] && typeof T.EVENT_FETCHERS["ournotes-global"].default === "function"),
			typeof T.GACHA_FETCHERS["ournotes-global"]);
		const idx = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		check("宿主白名单已登记 spica.wiki（2026-11-11 第一批接入时加的；缺了代理 403）",
			/const PROXY_ALLOW_HOSTS = \[[\s\S]*?"spica\.wiki"[\s\S]*?\n\];/.test(idx));
	}

	// ═══════════════════ ② 抓取链：页面 → _durl → 数据 JSON ═══════════════════
	section("OurNotes 国际服②：抓取链 —— 页面里的 `window._durl` 现解（hash 写死就会碎）");
	{
		const page = fixtureBody(PAGE_URL);
		const durl = P.ns_on_global_durlOf(page);
		check("页面里解出 `window._durl`（形如 /ournotes/data/d-<hash>.json）",
			/^\/ournotes\/data\/d-[0-9a-z]+\.json$/.test(durl), JSON.stringify(durl));
		check("`_durl` 是**站内路径**，拼 origin 得绝对地址", P.ns_on_global_dataUrlOf(durl) === "https://spica.wiki" + durl,
			P.ns_on_global_dataUrlOf(durl));
		check("数据夹具的 meta.url 就是这条地址（夹具与抓取链对得上）",
			JSON.parse(readFileSync(path.join(HERE, "fixtures", "spica-en-data", "response.txt.meta.json"), "utf8")).url === DATA_URL,
			DATA_URL);
		check("页面里**没有** `_durl` ⇒ 解析成空串（不猜一个地址）",
			P.ns_on_global_durlOf(page.replace(/window\._durl/g, "window._notdurl")) === "");
		check("给绝对地址也认（`_durl` 万一改成全 URL）",
			P.ns_on_global_dataUrlOf("https://cdn.example/x.json") === "https://cdn.example/x.json");

		const calls = [];
		const e = engineAt(NOW, calls);
		let err = null;
		const broken = page.replace(/window\._durl\s*=\s*["'][^"']+["']/, "window._durl = \"\"");
		try {
			// 直接喂一份"没有 _durl"的页面：把夹具换成它再跑抓取器
			const e2 = createEngine({
				transport: {
					async fetchRaw() { throw new Error("no"); },
					async fetchViaProxy(url) {
						if (String(url) === PAGE_URL) return broken;
						throw new Error("不该继续抓：" + String(url));
					}
				},
				storage: makeStore(),
				now: () => NOW,
				timer: { setTimeout, clearTimeout }
			});
			await e2.__test.GACHA_FETCHERS["ournotes-global"](PAGE_URL, undefined, "Asia/Shanghai");
		} catch (x) { err = x; }
		check("缺 `_durl` ⇒ 抛 `ournotes-global-no-durl`（记「抓取失败」，不是冒充「未公布」）",
			!!err && err.message === "ournotes-global-no-durl", err && err.message);
		void e;
	}

	// ═══════════════════ ③ 卡池条目事实 ═══════════════════
	section("OurNotes 国际服③：卡池条目事实 —— 23 本 / name.en / picks 按 id 查角色 / JST→绝对时刻");
	{
		const items = P.ns_on_global_gachaItemsOf(json, P.NS_ON_GLOBAL_TZ);
		check("gachapages 23 本全收（含常驻池）", items.length === 23, String(items.length));
		const g5001 = items.find((x) => x.key === "g5001") || {};
		check("当期池名称逐字「Episodium of the Radiant Palace Gacha」（name.en，不是日文/中文）",
			g5001.title === "Episodium of the Radiant Palace Gacha", JSON.stringify(g5001.title));
		check("源站原文 = JST 钟面「2026-11-08 15:00 ~ 2026-11-18 14:59」",
			g5001.raw === "2026-11-08 15:00 ~ 2026-11-18 14:59", JSON.stringify(g5001.raw));
		check("startTs = 2026-11-08 15:00 **JST** = UTC 06:00（不是 07:00 —— 按 UTC+8 解就会差 1 小时）",
			g5001.startTs === Date.UTC(2026, 10, 8, 6, 0), String(g5001.startTs));
		check("endTs = 2026-11-18 14:59 JST = UTC 05:59", g5001.endTs === Date.UTC(2026, 10, 18, 5, 59), String(g5001.endTs));
		check("display = UTC+8 钟面「11-08 14:00 ~ 11-18 13:59」（= 源站原文 −1h，绝对时刻不变）",
			g5001.display === "11-08 14:00 ~ 11-18 13:59", JSON.stringify(g5001.display));
		check("条目 tz 显式 = Asia/Shanghai / source=hover",
			g5001.tz === "Asia/Shanghai" && g5001.source === "hover", JSON.stringify([g5001.tz, g5001.source]));
		check("角色 = picks 里 member 卡的角色 + snap 照片里的角色（按名去重）逐字",
			g5001.roles === "Mortis / Mutsumi Wakaba、Amoris / Nyamu Yūtenji、Oblivionis / Sakiko Togawa",
			JSON.stringify(g5001.roles));

		// picks 的引用语义：member 按 members[].id、snap 按 snaps[].id —— **不是** snaps 的序号键
		const s78 = json.snaps["78"] || null;
		const sById78 = Object.values(json.snaps).find((x) => String(x.id) === "78") || null;
		check("反证前置事实：snaps 的**序号键**与**内容 id** 不是一回事（键 78 → id=2 的 Anon 照片）",
			!!s78 && String(s78.id) === "2" && !!sById78 && sById78.char === 7,
			JSON.stringify([s78 && s78.id, sById78 && sById78.char]));
		check("按 id 查 ⇒ 5001 的角色里**没有** Anon Chihaya（按序号键查才会把 MyGO 的人塞进 Ave Mujica 池）",
			g5001.roles.indexOf("Anon Chihaya") < 0, JSON.stringify(g5001.roles));

		const perm = items.filter((x) => x.endTs === null).map((x) => x.key);
		check("`end` 为空的常驻池 7 本 ⇒ endTs=null（raw 只留起点原文）",
			PERMANENT_KEYS.every((k) => perm.includes(k)) && perm.length === PERMANENT_KEYS.length, JSON.stringify(perm));
		check("常驻池不当在期（`coversNow` 要求两端都明确）⇒ 当期载荷里查不到它们",
			perm.length === 7 && items.filter((x) => perm.includes(x.key)).every((x) => x.startTs != null && x.endTs == null));
		check("每条都有非空 title（名称取不到就不造条目）", items.every((x) => typeof x.title === "string" && x.title.trim() !== ""));
	}

	// ═══════════════════ ④ 当期卡池载荷 ═══════════════════
	section("OurNotes 国际服④：当期卡池—— banner / roles / 档期（UTC+8）/ 悬停 / 数组 / 2 次请求");
	{
		const s = T.SOURCES.find((x) => x.id === "ournotes-global");
		const calls = [];
		const e = engineAt(NOW, calls);
		const gp = await e.__test.GACHA_FETCHERS["ournotes-global"](s.url, undefined, s.tz);
		check("卡池抓取器返回对象", !!gp && typeof gp === "object");
		check("当期池 = Episodium of the Radiant Palace Gacha",
			!!gp && gp.banner === "Episodium of the Radiant Palace Gacha", JSON.stringify(gp && gp.banner));
		check("roles 逐字（3 个名字）",
			!!gp && gp.roles === "Mortis / Mutsumi Wakaba、Amoris / Nyamu Yūtenji、Oblivionis / Sakiko Togawa",
			JSON.stringify(gp && gp.roles));
		check("bannerDates =「11-08 14:00 ~ 11-18 13:59」（UTC+8 钟面）",
			!!gp && gp.bannerDates === "11-08 14:00 ~ 11-18 13:59", JSON.stringify(gp && gp.bannerDates));
		check("bannerDatesRaw =「2026-11-08 15:00 ~ 2026-11-18 14:59」（源站 JST 原文）",
			!!gp && gp.bannerDatesRaw === "2026-11-08 15:00 ~ 2026-11-18 14:59", JSON.stringify(gp && gp.bannerDatesRaw));
		check("悬停 6 池 ×「池名：角色」⏎ 档期（结束升序；同结束再按开始；常驻池不在内）逐字",
			!!gp && gp.bannerHover === HOVER_EXPECTED, JSON.stringify(gp && gp.bannerHover));
		check("`gacha[]` 6 条 / tz 全是 Asia/Shanghai / 主条按 source=primary 区分（不在第 0 位）",
			!!gp && gp.gacha.length === 6 && gp.gacha.every((x) => x.tz === "Asia/Shanghai")
			&& gp.gacha.filter((x) => x.source === "primary").length === 1
			&& gp.gacha.findIndex((x) => x.source === "primary") === 1,
			JSON.stringify(gp && gp.gacha.map((x) => [x.title.slice(0, 14), x.source])));
		check("抓取 = 页面 1 次 + 数据 JSON 1 次（共 2 次），全程经代理",
			proxyCallsOf(calls).length === 2 && calls.length === 2
			&& calls[0].url === PAGE_URL && calls[1].url === DATA_URL, JSON.stringify(calls.map((c) => c.url)));
		check("Referer：页面带 `https://spica.wiki/`、数据 JSON 带页面地址（浏览器形态）",
			calls[0].referer === "https://spica.wiki/" && calls[1].referer === PAGE_URL,
			JSON.stringify(calls.map((c) => c.referer)));
	}

	// ═══════════════════ ⑤ 活动 ═══════════════════
	section("OurNotes 国际服⑤：活动 —— events[5] / 当期 e5 / 只有 1 条在期 ⇒ 无悬停");
	{
		const items = P.ns_on_global_eventItemsOf(json, P.NS_ON_GLOBAL_TZ);
		check("events 5 条全解析（名称 name.en / 起止）", items.length === 5, String(items.length));
		const e5 = items.find((x) => x.key === "e5") || {};
		check("当期活动名称逐字「Saltatio Beneath the Shifting Moon」",
			e5.title === "Saltatio Beneath the Shifting Moon", JSON.stringify(e5.title));
		check("startTs = 2026-11-08 15:00 JST = UTC 06:00", e5.startTs === Date.UTC(2026, 10, 8, 6, 0), String(e5.startTs));
		check("endTs = 2026-11-17 14:59 JST = UTC 05:59", e5.endTs === Date.UTC(2026, 10, 17, 5, 59), String(e5.endTs));
		check("display = UTC+8 钟面「11-08 14:00 ~ 11-17 13:59」", e5.display === "11-08 14:00 ~ 11-17 13:59", JSON.stringify(e5.display));
		check("raw = 源站 JST 原文「2026-11-08 15:00 ~ 2026-11-17 14:59」",
			e5.raw === "2026-11-08 15:00 ~ 2026-11-17 14:59", JSON.stringify(e5.raw));

		const s = T.SOURCES.find((x) => x.id === "ournotes-global");
		const calls = [];
		const e = engineAt(NOW, calls);
		const ep = await e.__test.EVENT_FETCHERS["ournotes-global"].default(s.eventUrl, undefined, s.tz);
		check("活动抓取器**独立可用**（自己走完页面 + 数据 JSON 两步）", !!ep && typeof ep === "object", String(calls.length));
		check("当期活动 / 档期逐字", !!ep && ep.event === "Saltatio Beneath the Shifting Moon"
			&& ep.eventDates === "11-08 14:00 ~ 11-17 13:59"
			&& ep.eventDatesRaw === "2026-11-08 15:00 ~ 2026-11-17 14:59",
			JSON.stringify([ep && ep.event, ep && ep.eventDates, ep && ep.eventDatesRaw]));
		check("只有 1 条在期 ⇒ **不给悬停**（不足 2 条交回 UI 单条展示）",
			!!ep && ep.eventHover === void 0 && Array.isArray(ep.events) && ep.events.length === 1,
			JSON.stringify([ep && ep.eventHover, ep && ep.events && ep.events.length]));
		check("活动侧自己抓时也是 2 次请求（页面 + 数据 JSON）",
			proxyCallsOf(calls).length === 2, JSON.stringify(calls.map((c) => c.url)));
	}

	// ═══════════════════ ⑥ 整轮刷新（复用同一次抓取）═══════════════════
	section("OurNotes 国际服⑥：整轮刷新 —— 两侧同 URL ⇒ 卡池载荷带活动字段，活动侧不再抓第二次");
	{
		const calls = [];
		const allIds = engineAt(NOW, []).__test.SOURCES.map((x) => x.id);
		const e = engineAt(NOW, calls, { hidden: allIds.filter((id) => id !== "ournotes-global"), shown: ["ournotes-global"] });
		const r = await e.refresh();
		const rec = r.games["ournotes-global"] || {};
		check("整轮只有 2 次请求（页面 1 + 数据 JSON 1；活动侧复用）",
			calls.length === 2 && calls[0].url === PAGE_URL && calls[1].url === DATA_URL,
			JSON.stringify(calls.map((c) => c.url)));
		check("两侧都不 fail", rec.gachaFail == null && rec.eventFail == null, JSON.stringify([rec.gachaFail, rec.eventFail]));
		check("记录逐字：banner / roles / bannerDates / bannerDatesRaw",
			rec.banner === "Episodium of the Radiant Palace Gacha"
			&& rec.roles === "Mortis / Mutsumi Wakaba、Amoris / Nyamu Yūtenji、Oblivionis / Sakiko Togawa"
			&& rec.bannerDates === "11-08 14:00 ~ 11-18 13:59"
			&& rec.bannerDatesRaw === "2026-11-08 15:00 ~ 2026-11-18 14:59",
			JSON.stringify([rec.banner, rec.roles, rec.bannerDates, rec.bannerDatesRaw]));
		check("记录逐字：event / eventDates / eventDatesRaw",
			rec.event === "Saltatio Beneath the Shifting Moon"
			&& rec.eventDates === "11-08 14:00 ~ 11-17 13:59"
			&& rec.eventDatesRaw === "2026-11-08 15:00 ~ 2026-11-17 14:59",
			JSON.stringify([rec.event, rec.eventDates, rec.eventDatesRaw]));
		check("数组：gacha 6 条 / events 1 条，key 带 ournotes-global 前缀",
			(rec.gacha || []).length === 6 && (rec.events || []).length === 1
			&& rec.gacha[0].key.indexOf("ournotes-global:gacha:") === 0
			&& rec.events[0].key === "ournotes-global:event:0",
			JSON.stringify([(rec.gacha || []).length, (rec.events || []).length, rec.gacha[0] && rec.gacha[0].key]));
	}

	// ═══════════════════ ⑦ 反证 ═══════════════════
	section("OurNotes 国际服⑦反证：拿掉关键解析各自变红（JST 层 / id 层 / 当期层）");
	{
		// A）时区层：把「按 JST 解」换成「按 UTC+8 解」⇒ 绝对时刻差 1 小时，且展示钟面变成源站原文
		const w = P.ns_on_global_wallOf("2026-11-08 15:00");
		const jst = P.ns_on_global_instantOf(w);
		const asPlus8 = T.sourceInstant(2026, 11, 8, 15, 0, "Asia/Shanghai");
		check("反证 A：按 JST 解 = UTC 06:00；按 UTC+8 解 = UTC 07:00（差 1 小时）—— 解析层用的是 JST",
			jst === Date.UTC(2026, 10, 8, 6, 0) && asPlus8 === Date.UTC(2026, 10, 8, 7, 0) && jst !== asPlus8,
			JSON.stringify([jst, asPlus8]));
		check("反证 A：若按 UTC+8 解，UTC+8 钟面会印成 15:00（= 照抄源站原文，国际化服的 14:00 就丢了）",
			T.fmtWindow(asPlus8, asPlus8 + 864e5, "Asia/Shanghai").indexOf("11-08 15:00") === 0,
			T.fmtWindow(asPlus8, asPlus8 + 864e5, "Asia/Shanghai"));

		// B）id 层：按 snaps 的**序号键**查会得到另一个角色（证明必须按 id）
		const s78 = json.snaps["78"];
		const byKey = json.chars[String(s78 && s78.char)];
		const byId = Object.values(json.snaps).find((x) => String(x.id) === "78");
		const byIdChar = json.chars[String(byId && byId.char)];
		check("反证 B：seq 键 78 →「Anon Chihaya」；内容 id 78 →「Mortis / Mutsumi Wakaba」（两者不同 ⇒ 按错就串味）",
			!!byKey && byKey.name.en === "Anon Chihaya" && !!byIdChar && byIdChar.name.en === "Mortis / Mutsumi Wakaba",
			JSON.stringify([byKey && byKey.name.en, byIdChar && byIdChar.name.en]));

		// C）当期层：只有起点没有终点的常驻池不冒充当期
		const onlyPerm = P.ns_on_global_gachaItemsOf(json, P.NS_ON_GLOBAL_TZ).filter((x) => x.endTs === null);
		check("反证 C：把在架限时池全剔掉（只留常驻池）⇒ 当期载荷为 null（不拿「没结束」当「永远在开」）",
			onlyPerm.length === 7 && P.ns_on_global_gachaPayloadOf(onlyPerm, P.NS_ON_GLOBAL_TZ, NOW) === null,
			String(onlyPerm.length));
		// C-2：now 提前到 2026-09-25（开服第 2 天）⇒ 当期换成开服双池（证明"当期"是按 now 算的，不是写死）
		const early = P.ns_on_global_gachaPayloadOf(
			P.ns_on_global_gachaItemsOf(json, P.NS_ON_GLOBAL_TZ), P.NS_ON_GLOBAL_TZ, Date.parse("2026-09-25T12:00:00+08:00"));
		check("反证 C-2：now=2026-09-25 ⇒ 当期变成「Launch Celebration! MyGO!!!!! PickUp Gacha」（同日两池取开始最晚者）",
			!!early && early.banner === "Launch Celebration! MyGO!!!!! PickUp Gacha"
			&& early.bannerDates === "09-24 19:00 ~ 10-08 22:59",
			JSON.stringify(early && [early.banner, early.bannerDates]));

		// D）名称层：name.en 优先（把 en 摘掉才退到 ja）—— 证明国际服不吃日文名
		const en2ja = (o) => ({ name: Object.assign({}, o.name, { en: "" }) });
		check("反证 D：`name.en` 有 ⇒ 用它；en 空 ⇒ 退到 ja（不印空名、也不优先中文）",
			P.ns_on_global_nameOf(byIdChar.name) === "Mortis / Mutsumi Wakaba"
			&& P.ns_on_global_nameOf(en2ja(byIdChar).name).length > 0
			&& P.ns_on_global_nameOf(en2ja(byIdChar).name) !== "Mortis / Mutsumi Wakaba",
			JSON.stringify([P.ns_on_global_nameOf(byIdChar.name), P.ns_on_global_nameOf(en2ja(byIdChar).name)]));
	}
}

// 常驻池（`end` 为空）的 7 个 key —— 实测 2026-11-11：开服期的 SSR 确定券 / 每日免费 / CM 观看之类，
// 源站本身就没有结束时刻。列在这里是为了让"7 本"这条断言可核对，而不是写一个 `length === 7` 的魔法数。
const PERMANENT_KEYS = ["g3", "g4", "g5", "g6", "g7", "g8", "g9"];

// 悬停逐字（6 池；结束升序 → 同结束按开始升序；常驻池不出现）。
// 「池名：角色」里的角色 = picks 的成员卡 + 照片里出现的角色（见文件头）。
const HOVER_EXPECTED = [
	"A day〜#HalloweenSnap〜 Item Gacha",
	"10-28 11:00 ~ 11-18 13:59",
	"Episodium of the Radiant Palace Gacha：Mortis / Mutsumi Wakaba、Amoris / Nyamu Yūtenji、Oblivionis / Sakiko Togawa",
	"11-08 14:00 ~ 11-18 13:59",
	"Halloween SSR Guaranteed Gacha：Taki Shiina、Doloris / Uika Misumi、Soyo Nagasaki、Anon Chihaya、Timoris / Umiri Yahata、Mortis / Mutsumi Wakaba、Amoris / Nyamu Yūtenji",
	"10-27 23:00 ~ 12-08 13:59",
	"Shadowed Nightwalkers Limited-Time SSR Guaranteed Gacha",
	"10-27 23:00 ~ 12-08 13:59",
	"GEKISO ARENA Season 1 SR+ Guaranteed Ticket Gacha",
	"10-27 23:00 ~ 12-28 13:59",
	"GEKISO ARENA Season 1 SSR Guaranteed Ticket Gacha",
	"10-27 23:00 ~ 12-28 13:59"
].join("\n");
