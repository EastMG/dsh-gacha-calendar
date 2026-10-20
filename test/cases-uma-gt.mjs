// test/cases-uma-gt.mjs —— 赛马娘国际服卡池：**GameTora**（2026-10-21 起的默认源）
//
// 覆盖四件事：
//   ① 池表选择：`coversNowBounded` 选当期 / 多池并行取"结束最晚" / 角色池优先于支援卡池
//   ② pickups → 角色名：char 池 `card_id → name_en`；支援卡池 `support_id → char_name`
//   ③ 抓取链：manifest → **仅 hash** → 2 张池表 → **当期那 1 张**名字表（4 次请求；不用名字时 3 次）
//   ④ 失败路径：manifest 缺 hash / 池表不是数组 / 名字表 404 → 抛「GameTora 数据接口失败」，不出半成品
//
// 夹具是真实响应的**摘录**（2026-10-21 抓取，见各 `response.txt.meta.json`）；
// 哈希放在 URL 里且随数据更新而变，所以路由用**文件名前缀**而不是完整 URL。
//
// 确定性：`now` 一律注入（2026-10-21T03:00+08:00），不随运行日期漂移。
// 时区：该源沿用 `UMA_GLOBAL_TZ="UTC"`（GameTora 的 unix 秒按 UTC 渲染 == 国际服官方公告原文）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { check, section, setFetchImpl, assertContract } from "./harness.mjs";
import { T, FIXTURES_DIR } from "./load.mjs";

const NOW = Date.parse("2026-10-21T03:00:00+08:00");
const MANIFEST_URL = "https://gametora.com/data/manifests/umamusume.json";
const TZ = "UTC";

const fxText = (name) => readFileSync(path.join(FIXTURES_DIR, name, "response.txt"), "utf8");
const fx = (name) => JSON.parse(fxText(name));

/** 夹具路由：URL → 槽位（manifest / charStd / supportStd / charCards / supportCards）；`fail` 指定哪个槽位 404 */
function installGt({ manifest, charStd, supportStd, charCards, supportCards, fail } = {}) {
	const slots = {
		manifest: manifest != null ? manifest : fxText("uma-gt-manifest"),
		charStd: charStd != null ? charStd : fxText("uma-gt-char-standard"),
		supportStd: supportStd != null ? supportStd : fxText("uma-gt-support-standard"),
		charCards: charCards != null ? charCards : fxText("uma-gt-character-cards"),
		supportCards: supportCards != null ? supportCards : fxText("uma-gt-support-cards")
	};
	const byFile = {
		"en/gacha/char-standard": "charStd",
		"en/gacha/support-standard": "supportStd",
		"character-cards": "charCards",
		"support-cards": "supportCards"
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

	// ── ⑥ 注册表：GameTora 默认 / GachaTracker 降级 / 官方公告最后兜底 ──
	{
		const src = T.SOURCES.find((s) => s.id === "uma-global");
		check("uma-global 默认源 = GameTora manifest，label 标注 GameTora",
			!!src && src.url === MANIFEST_URL && /GameTora/.test(src.source), JSON.stringify(src && [src.url, src.source]));
		const alts = (src && src.altSources) || [];
		const gt = alts.find((a) => /gachatracker/.test(String(a.url)));
		const off = alts.find((a) => /umamusume\.com/.test(String(a.url)));
		check("GachaTracker 已降级为备选，label 注明「英文 · 不可靠」",
			!!gt && /英文/.test(gt.label) && /不可靠/.test(gt.label) && gt.fetcher === "uma-global-gt", JSON.stringify(gt));
		check("官方公告保留为最后兜底，label 注明「英文 · 不可靠」",
			!!off && /不可靠/.test(off.label), JSON.stringify(off));
		check("三个抓取器都登记了（uma-global / uma-global-gt / uma-global-official）",
			typeof T.GACHA_FETCHERS["uma-global"] === "function" && typeof T.GACHA_FETCHERS["uma-global-gt"] === "function"
			&& typeof T.GACHA_FETCHERS["uma-global-official"] === "function");
		check("活动侧不动（默认仍是官网公告）",
			!!src && /umamusume\.com\/api\/ajax\/pr_info_index/.test(String(src.eventUrl)) && T.EVENT_FETCHERS["uma-global"] && typeof T.EVENT_FETCHERS["uma-global"].default === "function",
			JSON.stringify(src && src.eventUrl));
	}

	// ── ⑦ 夹具可溯源：map.json 收录（前缀键对 hash 变化免疫）──
	{
		const map = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "..", "map.json"), "utf8"));
		for (const [k, v] of Object.entries({
			"https://gametora.com/data/manifests/umamusume.json": "uma-gt-manifest/response.txt",
			"https://gametora.com/data/umamusume/en/gacha/char-standard.": "uma-gt-char-standard/response.txt",
			"https://gametora.com/data/umamusume/en/gacha/support-standard.": "uma-gt-support-standard/response.txt",
			"https://gametora.com/data/umamusume/character-cards.": "uma-gt-character-cards/response.txt",
			"https://gametora.com/data/umamusume/support-cards.": "uma-gt-support-cards/response.txt"
		})) {
			check(`map.json 收录 ${k.slice(0, 68)}…`, map[k] === v, JSON.stringify(map[k]));
		}
	}
}
