// test/cases-uma-gt.mjs —— 赛马娘国际服：**GameTora**（2026-10-21 起卡池默认源 / 2026-11-14 起活动默认源）
//
// 覆盖五件事：
//   ① 池表选择：`coversNowBounded` 选当期 / 多池并行取"结束最晚" / 角色池优先于支援卡池
//   ② pickups → 角色名：char 池 `card_id → name_en`；支援卡池 `support_id → char_name`
//   ③ 抓取链：manifest → **仅 hash** → 2 张池表 → **当期那 1 张**名字表（4 次请求；不用名字时 3 次）
//   ④ 失败路径：manifest 缺 hash / 池表不是数组 / 名字表 404 → 抛「GameTora 数据接口失败」，不出半成品
//   ⑤ 活动侧：`events/story-events`（en/ 那套 = 国际服）→ 名称**只取** `name_zh_tw`（缺则跳过该条，
//      不拿 `name_en` 兜底）、epoch 秒 → 毫秒、覆盖 now 且结束最晚的那条作外显；
//      manifest 缺键 / 活动表不是数组 ⇒ 抛（不是 nomatch）
//
// 夹具是真实响应的**摘录**（`uma-gt-*` 2026-10-21 / 活动表 `uma-gt-story-events` 2026-11-14 原样），
// 见各 `response.txt.meta.json`；哈希放在 URL 里且随数据更新而变，所以路由用**文件名前缀**而不是完整 URL。
//
// 确定性：`now` 一律注入（卡池 2026-10-21T03:00+08:00 / 活动 2026-11-14T10:24Z），不随运行日期漂移。
// 时区：该源沿用 `UMA_GLOBAL_TZ="UTC"`（GameTora 的 unix 秒按 UTC 渲染 == 国际服官方公告原文）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { check, section, setFetchImpl, assertContract, useFixtures } from "./harness.mjs";
import { T, FIXTURES_DIR } from "./load.mjs";
import { createEngine } from "../packages/core/core.mjs";

const NOW = Date.parse("2026-10-21T03:00:00+08:00");
// 活动侧：夹具抓取时刻（实测在期 = id 1022；档期 11-09 22:00Z ~ 11-23 21:59Z）
const NOW_EV = Date.parse("2026-11-14T10:24:00Z");
const MANIFEST_URL = "https://gametora.com/data/manifests/umamusume.json";
const TZ = "UTC";

const fxText = (name) => readFileSync(path.join(FIXTURES_DIR, name, "response.txt"), "utf8");
const fx = (name) => JSON.parse(fxText(name));

/** 夹具路由：URL → 槽位（manifest / charStd / supportStd / charCards / supportCards / storyEvents）；`fail` 指定哪个槽位 404 */
function installGt({ manifest, charStd, supportStd, charCards, supportCards, storyEvents, fail } = {}) {
	const slots = {
		manifest: manifest != null ? manifest : fxText("uma-gt-manifest"),
		charStd: charStd != null ? charStd : fxText("uma-gt-char-standard"),
		supportStd: supportStd != null ? supportStd : fxText("uma-gt-support-standard"),
		charCards: charCards != null ? charCards : fxText("uma-gt-character-cards"),
		supportCards: supportCards != null ? supportCards : fxText("uma-gt-support-cards"),
		storyEvents: storyEvents != null ? storyEvents : fxText("uma-gt-story-events")
	};
	const byFile = {
		"en/gacha/char-standard": "charStd",
		"en/gacha/support-standard": "supportStd",
		"character-cards": "charCards",
		"support-cards": "supportCards",
		"events/story-events": "storyEvents"
	};
	const seen = [];
	const notFound = () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) });
	const ok = (body) => ({ ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => body, json: async () => JSON.parse(body) });
	const impl = async (url) => {
		const u = String(url);
		if (u === MANIFEST_URL) { seen.push("manifest"); return fail === "manifest" ? notFound() : ok(slots.manifest); }
		const m = u.match(/^https:\/\/gametora\.com\/data\/umamusume\/(.+)\.([0-9a-z]+)\.json$/i);
		if (!m) return notFound();
		const slot = byFile[m[1]];
		if (!slot) return notFound();
		seen.push(slot);
		return fail === slot ? notFound() : ok(slots[slot]);
	};
	setFetchImpl(impl);
	return seen;
}

const grab = async (fn) => {
	try { return { ok: true, data: await fn() }; }
	catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
};

export default async function run() {
	section("赛马娘国际服卡池：GameTora（默认源）");

	T.setCoreEnv({ now: () => NOW });

	// ── ① 当期角色池：id=30136 / UTC 2026-10-14 22:00 ~ 10-23 21:59 / Narita Brian ──
	{
		const seen = installGt();
		const r = await grab(() => T.GACHA_FETCHERS["uma-global"](MANIFEST_URL, undefined, TZ));
		check("uma-global/gametora：抓取成功（离线夹具）", r.ok, r.err);
		assertContract("赛马娘国际服 GameTora", "gacha", r.ok ? r.data : null);
		check("uma-global/gametora：当期角色池 id=30136 的档期 = UTC 10-14 22:00 ~ 10-23 21:59",
			r.ok && r.data && r.data.bannerDates === "10-14 22:00 ~ 10-23 21:59",
			JSON.stringify(r.ok && r.data && r.data.bannerDates));
		check("uma-global/gametora：时区是 UTC（不是 JST 的 10-15 07:00）",
			r.ok && r.data && !r.data.bannerDates.includes("10-15 07:00"), JSON.stringify(r.ok && r.data && r.data.bannerDates));
		check("uma-global/gametora：角色名由 pickups → character-cards 解析（Narita Brian）",
			r.ok && r.data && r.data.roles === "Narita Brian", JSON.stringify(r.ok && r.data && r.data.roles));
		check("uma-global/gametora：banner 是「（角色）」类型标签 + bannerDatesRaw 与 bannerDates 同值",
			r.ok && r.data && r.data.banner === "赛马娘国际服卡池（角色）" && r.data.bannerDatesRaw === r.data.bannerDates,
			JSON.stringify(r.ok && r.data && [r.data.banner, r.data.bannerDatesRaw]));
		check("uma-global/gametora：请求 = manifest + 2 张池表 + 当期那张名字表（4 次，共 4 个不同文件）",
			JSON.stringify(seen) === JSON.stringify(["manifest", "charStd", "supportStd", "charCards"]),
			JSON.stringify(seen));
	}

	// ── ② 当期只有支援卡池 → 走 support-cards，且**不**拉 character-cards ──
	{
		// 角色池只剩 30134（10-15 21:59 结束，已过期）→ 当期由支援卡池 30137 接手
		const charStd = JSON.stringify(fx("uma-gt-char-standard").filter((p) => p.id === 30134));
		const seen = installGt({ charStd });
		const r = await grab(() => T.GACHA_FETCHERS["uma-global"](MANIFEST_URL, undefined, TZ));
		check("uma-global/gametora：角色池无当期时由支援卡池接手（id=30137 / 同一档期）",
			r.ok && r.data && r.data.banner === "赛马娘国际服卡池（支援卡）" && r.data.bannerDates === "10-14 22:00 ~ 10-23 21:59",
			JSON.stringify(r.ok && r.data));
		check("uma-global/gametora：支援卡角色名由 support_id → char_name 解析（TM Opera O、Yamanin Zephyr）",
			r.ok && r.data && r.data.roles === "TM Opera O、Yamanin Zephyr", JSON.stringify(r.ok && r.data && r.data.roles));
		check("uma-global/gametora：支援卡池当期只拉 support-cards（不拉 character-cards）",
			JSON.stringify(seen) === JSON.stringify(["manifest", "charStd", "supportStd", "supportCards"]), JSON.stringify(seen));
	}

	// ── ③ 多池并行 → 取"结束最晚"那条；并集内同一角色只列一次 ──
	{
		const charStd = JSON.stringify([
			{ id: 90001, start: 1792015200, end: 1792792799, pickups: [[100902, 7500, true]] },   // 10-14 22:00 ~ 10-23 21:59
			{ id: 90002, start: 1792450000, end: 1793392799, pickups: [[101602, 7500, true]] }    // 10-19 22:46 ~ 10-30 20:39（更晚结束）
		]);
		installGt({ charStd });
		const r = await grab(() => T.GACHA_FETCHERS["uma-global"](MANIFEST_URL, undefined, TZ));
		check("uma-global/gametora：多池并行时取结束最晚的那条（Narita Brian 而非 Daiwa Scarlet）",
			r.ok && r.data && r.data.roles === "Narita Brian" && r.data.bannerDates === "10-19 22:46 ~ 10-30 20:39",
			JSON.stringify(r.ok && r.data));
	}

	// ── ④ 没有覆盖 now 的池 → null（该站无未来池）+ 请求只有 3 次（不拉名字表）──
	{
		const oldChar = JSON.stringify(fx("uma-gt-char-standard").filter((p) => p.id === 30124));
		const oldSup = JSON.stringify(fx("uma-gt-support-standard").filter((p) => p.id === 30125));
		const seen = installGt({ charStd: oldChar, supportStd: oldSup });
		const r = await grab(() => T.GACHA_FETCHERS["uma-global"](MANIFEST_URL, undefined, TZ));
		check("uma-global/gametora：没有覆盖 now 的池 → 返回 null（如实未公布，不硬凑过期档期）", r.ok && r.data === null, JSON.stringify(r.ok ? r.data : r.err));
		check("uma-global/gametora：未公布时只有 3 次请求（不拉名字表）",
			JSON.stringify(seen) === JSON.stringify(["manifest", "charStd", "supportStd"]), JSON.stringify(seen));
	}

	// ── ⑤ 失败路径：每一步都必须"失败"，不许产出半成品 ──
	{
		installGt({ fail: "charCards" });
		const r = await grab(() => T.GACHA_FETCHERS["uma-global"](MANIFEST_URL, undefined, TZ));
		check("uma-global/gametora：名字表 404 → 抛「GameTora 数据接口失败」（不是只有 banner 的半成品）",
			!r.ok && /^GameTora 数据接口失败（character-cards/.test(r.err), r.err);

		installGt({ manifest: JSON.stringify({ "character-cards": "d3ec4f6d" }) });
		const r2 = await grab(() => T.GACHA_FETCHERS["uma-global"](MANIFEST_URL, undefined, TZ));
		check("uma-global/gametora：manifest 缺 en/gacha/char-standard → 抛错（不猜 URL）",
			!r2.ok && /^GameTora 数据接口失败（manifest 缺/.test(r2.err), r2.err);

		installGt({ charStd: JSON.stringify({ not: "an array" }) });
		const r3 = await grab(() => T.GACHA_FETCHERS["uma-global"](MANIFEST_URL, undefined, TZ));
		check("uma-global/gametora：池表结构变化（不是数组）→ 抛错", !r3.ok && /^GameTora 数据接口失败（池表不是数组/.test(r3.err), r3.err);

		// pickups 结构变化（不再含可识别的卡 id）→ 名字解析出 0 条 → 抛
		const badPick = JSON.stringify([{ id: 30136, start: 1792015200, end: 1792792799, pickups: [["bogus"]] }]);
		installGt({ charStd: badPick });
		const r4 = await grab(() => T.GACHA_FETCHERS["uma-global"](MANIFEST_URL, undefined, TZ));
		check("uma-global/gametora：pickups 结构变化 → 名字解析 0 条 → 抛错", !r4.ok && /角色名解析出 0 条/.test(r4.err), r4.err);
	}

	// ── ⑥ 注册表：卡池 GameTora 默认 / GachaTracker 降级 / 官方公告最后兜底；活动侧 GameTora 默认 / 官方公告备选 ──
	{
		const src = T.SOURCES.find((s) => s.id === "uma-global");
		check("uma-global 默认源 = GameTora manifest，标签逐字「GameTora」（不带语言括号）",
			!!src && src.url === MANIFEST_URL && src.source === "GameTora", JSON.stringify(src && [src.url, src.source]));
		const alts = (src && src.altSources) || [];
		const gt = alts.find((a) => /gachatracker/.test(String(a.url)));
		const off = alts.find((a) => /umamusume\.com/.test(String(a.url)));
		check("GachaTracker 已降级为备选，label 注明「英文 · 不可靠」",
			!!gt && /英文/.test(gt.label) && /不可靠/.test(gt.label) && gt.fetcher === "uma-global-gt", JSON.stringify(gt));
		check("官方公告保留为最后兜底，label 注明「英文 · 不可靠」",
			!!off && /不可靠/.test(off.label), JSON.stringify(off));
		check("三个卡池抓取器都登记了（uma-global / uma-global-gt / uma-global-official）",
			typeof T.GACHA_FETCHERS["uma-global"] === "function" && typeof T.GACHA_FETCHERS["uma-global-gt"] === "function"
			&& typeof T.GACHA_FETCHERS["uma-global-official"] === "function");

		// 活动侧（2026-11-14 换源）：默认 = 同一个 GameTora manifest；官方接口逐字保留为备选。
		check("活动侧默认源：eventUrl = GameTora manifest（与 url 同一地址）、标签逐字「GameTora」",
			!!src && src.eventUrl === MANIFEST_URL && src.eventSource === "GameTora",
			JSON.stringify(src && [src.eventUrl, src.eventSource]));
		const evAlts = (src && src.eventAltSources) || [];
		check("活动侧备选 = 只有 1 条，就是原官方接口（label 逐字 / url 原样 / fetcher `uma-global-official`）",
			evAlts.length === 1 && evAlts[0].label === "官方公告（英文 · 不可靠）"
			&& evAlts[0].url === "https://umamusume.com/api/ajax/pr_info_index?format=json"
			&& evAlts[0].fetcher === "uma-global-official",
			JSON.stringify(evAlts));
		check("活动侧两个抓取器都登记了（`default` = GameTora / `uma-global-official` = 官方公告）",
			!!T.EVENT_FETCHERS["uma-global"]
			&& typeof T.EVENT_FETCHERS["uma-global"].default === "function"
			&& typeof T.EVENT_FETCHERS["uma-global"]["uma-global-official"] === "function",
			JSON.stringify(Object.keys(T.EVENT_FETCHERS["uma-global"] || {})));
		check("卡池侧 `altSources` 没被这次换源动过（仍是 GachaTracker + 官方公告 2 条）",
			alts.length === 2 && alts.every((a) => a.fetcher === "uma-global-gt" || a.fetcher === "uma-global-official"),
			JSON.stringify(alts.map((a) => a.fetcher)));
	}

	// ── ⑦ 活动侧（GameTora）：在期 = id 1022 / 名称取 `name_zh_tw` / epoch 秒 → 毫秒 ──
	{
		T.setCoreEnv({ now: () => NOW_EV });
		const seen = installGt();
		const r = await grab(() => T.EVENT_FETCHERS["uma-global"].default(MANIFEST_URL, undefined, TZ));
		check("uma-global/event/gametora：抓取成功（离线夹具）", r.ok, r.err);
		assertContract("赛马娘国际服 GameTora 活动", "event", r.ok ? r.data : null);
		check("uma-global/event/gametora：在期活动名 = `name_zh_tw` 逐字「甜蜜回憶・午茶時光」（不是 name_en）",
			r.ok && r.data && r.data.event === "甜蜜回憶・午茶時光", JSON.stringify(r.ok && r.data && r.data.event));
		check("uma-global/event/gametora：档期 = UTC 11-09 22:00 ~ 11-23 21:59（en/ 那套 = 国际服）",
			r.ok && r.data && r.data.eventDates === "11-09 22:00 ~ 11-23 21:59", JSON.stringify(r.ok && r.data && r.data.eventDates));
		check("uma-global/event/gametora：`eventDatesRaw` 与 `eventDates` 同值（源站只有 unix 秒，raw 是同一份墙钟原文）",
			r.ok && r.data && r.data.eventDatesRaw === r.data.eventDates, JSON.stringify(r.ok && r.data && [r.data.eventDates, r.data.eventDatesRaw]));
		const ev0 = r.ok && r.data && Array.isArray(r.data.events) ? r.data.events[0] : null;
		// ⚠️ 数组**主条**的 ts 是从 `eventDates` 文本反解的（分钟精度，与其它源同一口径）⇒ 秒级的源站值
		//    看条目事实（`eventHoverItems`，解析器直出、未过文本）；两者都在下面钉住。
		const facts = r.ok && r.data && Array.isArray(r.data.eventHoverItems) ? r.data.eventHoverItems[0] : null;
		check("uma-global/event/gametora：epoch **秒** → 毫秒正确（1794261600 / 1795471199 ⇒ 1794261600000 / 1795471199000）",
			!!facts && facts.startTs === 1794261600000 && facts.endTs === 1795471199000,
			JSON.stringify(facts && [facts.startTs, facts.endTs]));
		check("uma-global/event/gametora：`events` 主条 = 同一活动（名称 + tz 沿用条目 UTC + raw 同档期）",
			!!ev0 && ev0.title === "甜蜜回憶・午茶時光" && ev0.tz === "UTC" && ev0.raw === "11-09 22:00 ~ 11-23 21:59",
			JSON.stringify(ev0));
		check("uma-global/event/gametora：只有 1 条在期 ⇒ 不设悬停（交回 UI 默认两行式）",
			r.ok && r.data && !("eventHover" in r.data), JSON.stringify(r.ok && r.data && r.data.eventHover));
		check("uma-global/event/gametora：请求 = manifest + 故事活动表（2 次）",
			JSON.stringify(seen) === JSON.stringify(["manifest", "storyEvents"]), JSON.stringify(seen));
	}

	// ── ⑧ 活动侧反证：name_zh_tw 缺失 ⇒ 该条跳过（不回退 en）；manifest 缺键 / 表非数组 ⇒ 抛；start_en 空 ⇒ 不进外显 ──
	{
		T.setCoreEnv({ now: () => NOW_EV });
		// ① 删掉 id 1022 的 `name_zh_tw` ⇒ 该条**被跳过**（不拿 `name_en` 兜底）；此刻只有它覆盖 now ⇒ null
		const e1022 = fx("uma-gt-story-events").find((e) => e.id === 1022);
		check("反证①前提：id 1022 在夹具里**有** `name_en`（「跳过」= 不拿 en 兜底，不是没名可显）",
			!!e1022 && e1022.name_en === "Sweet Memories Teatime", JSON.stringify(e1022 && e1022.name_en));
		const noTw = fx("uma-gt-story-events").map((e) => {
			if (e.id !== 1022) return e;
			const o = Object.assign({}, e);
			delete o.name_zh_tw;
			return o;
		});
		installGt({ storyEvents: JSON.stringify(noTw) });
		const r1 = await grab(() => T.EVENT_FETCHERS["uma-global"].default(MANIFEST_URL, undefined, TZ));
		check("反证①：删掉该条的 `name_zh_tw` ⇒ 该条被跳过 ⇒ 返回 null（**不是**显示英文名）",
			r1.ok && r1.data === null, JSON.stringify(r1.ok ? r1.data : r1.err));

		// ② manifest 里删掉 `events/story-events` ⇒ 抛错（"抓取异常"，**不是** nomatch）
		const manifestNoEv = JSON.parse(fxText("uma-gt-manifest"));
		delete manifestNoEv["events/story-events"];
		installGt({ manifest: JSON.stringify(manifestNoEv) });
		const r2 = await grab(() => T.EVENT_FETCHERS["uma-global"].default(MANIFEST_URL, undefined, TZ));
		check("反证②：manifest 缺 `events/story-events` ⇒ 抛「GameTora 数据接口失败（manifest 缺 …）」（不是 nomatch）",
			!r2.ok && /^GameTora 数据接口失败（manifest 缺 "events\/story-events"/.test(r2.err), r2.err);

		// ③ 把该条的 `start_en` 抹成 null ⇒ 该条不进外显（此刻只有它覆盖 now ⇒ 整体 nomatch）
		const noStart = fx("uma-gt-story-events").map((e) => (e.id === 1022 ? Object.assign({}, e, { start_en: null }) : e));
		installGt({ storyEvents: JSON.stringify(noStart) });
		const r3 = await grab(() => T.EVENT_FETCHERS["uma-global"].default(MANIFEST_URL, undefined, TZ));
		check("反证③：`start_en` 抹成 null ⇒ 该条不参与外显 ⇒ 返回 null（未公布，不是抛错）",
			r3.ok && r3.data === null, JSON.stringify(r3.ok ? r3.data : r3.err));

		// ④ 活动表结构变化（不是数组）⇒ 抛错（与「没数据」分开）
		installGt({ storyEvents: JSON.stringify({ not: "an array" }) });
		const r4 = await grab(() => T.EVENT_FETCHERS["uma-global"].default(MANIFEST_URL, undefined, TZ));
		check("反证④：活动表不是数组 ⇒ 抛「GameTora 数据接口失败（活动表不是数组…）」",
			!r4.ok && /^GameTora 数据接口失败（活动表不是数组/.test(r4.err), r4.err);
	}

	// ── ⑨ 轮内复用：一轮刷新里卡池 + 活动都要 GameTora manifest ⇒ 只发 1 次请求 ──
	{
		const base = useFixtures();
		const raw = [];
		const transport = {
			async fetchRaw(url, opts) { raw.push(String(url)); return base(url, opts); },
			async fetchViaProxy(url) { throw new Error("uma-global 不该走代理：" + String(url)); }
		};
		const m = new Map();
		const storage = { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
		const allIds = createEngine({ transport, storage, now: () => NOW_EV }).__test.SOURCES.map((s) => s.id);
		await storage.set("hidden", allIds.filter((x) => x !== "uma-global"));
		const engine = createEngine({ transport, storage, now: () => NOW_EV, timer: { setTimeout, clearTimeout } });
		const res = await engine.refresh();
		const rec = (res.games || {})["uma-global"] || {};
		const manifestHits = raw.filter((u) => u === MANIFEST_URL).length;
		check("轮内复用：一轮刷新里 manifest 只发 1 次（卡池 + 活动共用；轮外现取，见下一条）",
			manifestHits === 1, `${manifestHits} 次：${raw.join(" | ")}`);
		check("轮内复用不串侧：活动侧照常拿到 id 1022 的繁中名",
			rec.event === "甜蜜回憶・午茶時光", JSON.stringify(rec.event));
		check("轮内复用不串侧：卡池侧此刻没有覆盖 now 的池（夹具停在 10-23）⇒ banner 空、活动侧不受影响",
			!rec.banner && raw.length === 4, JSON.stringify([rec.banner, raw.length]));
		// 跨轮：同一引擎再跑一轮 ⇒ manifest 再发 1 次（轮次号隔离，不吃上一轮的缓存）
		await engine.refresh();
		check("跨轮不复用：同一引擎再跑一轮 ⇒ manifest 再发 1 次（两轮共 2 次，各 1 次）",
			raw.filter((u) => u === MANIFEST_URL).length === 2,
			`${raw.filter((u) => u === MANIFEST_URL).length} 次：${raw.join(" | ")}`);
		// 轮外（直接调抓取器）不走缓存：同一个 URL 再调一次要真的再发一次请求
		const seen2 = installGt();
		await grab(() => T.EVENT_FETCHERS["uma-global"].default(MANIFEST_URL, undefined, TZ));
		check("轮外不复用：refresh 之外直接调抓取器 ⇒ manifest 现取（每侧 2 次请求）",
			JSON.stringify(seen2) === JSON.stringify(["manifest", "storyEvents"]), JSON.stringify(seen2));
	}

	// ── ⑩ 夹具可溯源：map.json 收录（前缀键对 hash 变化免疫）──
	{
		const map = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "..", "map.json"), "utf8"));
		for (const [k, v] of Object.entries({
			"https://gametora.com/data/manifests/umamusume.json": "uma-gt-manifest/response.txt",
			"https://gametora.com/data/umamusume/en/gacha/char-standard.": "uma-gt-char-standard/response.txt",
			"https://gametora.com/data/umamusume/en/gacha/support-standard.": "uma-gt-support-standard/response.txt",
			"https://gametora.com/data/umamusume/character-cards.": "uma-gt-character-cards/response.txt",
			"https://gametora.com/data/umamusume/support-cards.": "uma-gt-support-cards/response.txt",
			"https://gametora.com/data/umamusume/events/story-events.": "uma-gt-story-events/response.txt"
		})) {
			check(`map.json 收录 ${k.slice(0, 68)}…`, map[k] === v, JSON.stringify(map[k]));
		}
	}
}
