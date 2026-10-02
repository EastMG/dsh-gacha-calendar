// next-sources/test/cases-p5.mjs —— 批次 P5 离线夹具测试（赛马娘官方公告：日服 / 国际服）
//
// 三个原则（照 CONVENTIONS.md）：
//   ① 全程离线：`useFixtures({...})` 注入夹具 fetch；纯函数测试直接读 fixtures/*/response.txt。
//   ② 确定性：「当前时刻」一律用**夹具抓取时刻**（response.txt.meta.json 的 capturedAt）当 now，
//      不随运行日期漂移（否则一个月后"当期卡池"就变了 → 假失败）。
//   ③ 不拖垮共享门禁：每个抓取器调用都包 try/catch，失败只记 ✗ 不抛。
//
// 断言里的硬编码值全部是**夹具快照值**（2026-10-02T14:36Z 抓取）；重抓夹具后需同步更新，
// 届时以"形态与不变量"那一批断言为准。
//
// ⚠️ 国际服是 **POST**（GET 回 `{"response_code":102}`）。夹具 harness 的 fetch 是"按 url 查夹具"，
//    不看 method/body，而 `postJsonUma` 会把 payload 放进**请求体**传给代理 —— 正好被 harness 忽略，
//    所以 POST 路径可以**完全离线**验证（含 response_code / 代理包装层的错误处理）。

import { readFileSync } from "node:fs";
import { useFixtures, check, section, assertContract, summary } from "./harness.mjs";
import { sourceWallParts, fmtWindow } from "../lib/env.js";
import { SOURCES_P5, findSource } from "../registry-p5.js";
import {
	classifyUmaTitle, parseUmaIndex, parseUmaInstant, parseUmaDetail, parseUmaWindows,
	extractUmaRangePlates, pickUmaWindow, umaHoverLines, umaJpPageUrl, proxyUrlFor, postJsonUma,
	gachaUmaJpOfficial, eventsUmaJpOfficial, gachaUmaGlobal, eventsUmaGlobal,
	UMA_JP_TZ, UMA_GLOBAL_TZ, UMA_GLOBAL_INDEX_URL, UMA_GLOBAL_DETAIL_URL, UMA_JP_DETAIL_URL,
	UMA_JP_INDEX_URL
} from "../parsers/umamusume-official.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}/response.txt`, import.meta.url), "utf8"));
const fixtureText = (name) => readFileSync(new URL(`../fixtures/${name}/response.txt`, import.meta.url), "utf8");
const fixtureMeta = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}/response.txt.meta.json`, import.meta.url), "utf8"));

// 夹具抓取时刻 = 「当前时刻」（确定性）
const SNAP = Date.parse(fixtureMeta("p5-uma-jp-index").capturedAt);
const SNAP_GL = Date.parse(fixtureMeta("p5-uma-global-index").capturedAt);

// 离线 URL → 夹具 映射（显式写死，不依赖共享 map.json 是否被别的批次写坏）
const P5_FIXTURE_URLS = {
	"https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1": "p5-uma-jp-index/response.txt",
	"https://umamusume.jp/api/ajax/pr_info_index?format=json&page=2": "p5-uma-jp-index-p2/response.txt",
	"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=3468": "p5-uma-jp-detail-3468/response.txt",
	"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=3469": "p5-uma-jp-detail-3469/response.txt",
	"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=3470": "p5-uma-jp-detail-3470/response.txt",
	"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=3472": "p5-uma-jp-detail-3472/response.txt",
	"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=3477": "p5-uma-jp-detail-3477/response.txt",
	"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=3481": "p5-uma-jp-detail-3481/response.txt",
	"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=3483": "p5-uma-jp-detail-3483/response.txt",
	"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=3487": "p5-uma-jp-detail-3487/response.txt",
	"https://umamusume.com/api/ajax/pr_info_index?format=json": "p5-uma-global-index/response.txt",
	"https://umamusume.com/api/ajax/pr_info_detail?format=json": "p5-uma-global-detail-100109/response.txt"
};
// 国际服详情是 POST，URL 全都一样 → 需要**按 announce_id 分派**（harness 只看 url，所以这里覆盖 fetch）
const GL_DETAIL_BY_ID = {
	100109: "p5-uma-global-detail-100109/response.txt",
	1024: "p5-uma-global-detail-1024/response.txt",
	1039: "p5-uma-global-detail-1039/response.txt",
	1040: "p5-uma-global-detail-1040/response.txt",
	1051: "p5-uma-global-detail-1051/response.txt",
	1052: "p5-uma-global-detail-1052/response.txt",
	1055: "p5-uma-global-detail-1055/response.txt",
	1065: "p5-uma-global-detail-1065/response.txt",
	1072: "p5-uma-global-detail-1072/response.txt",
	1073: "p5-uma-global-detail-1073/response.txt",
	1077: "p5-uma-global-detail-1077/response.txt",
	1079: "p5-uma-global-detail-1079/response.txt"
};

/** 夹具 fetch：先按 (url) 查 P5 表，再处理"国际服详情按 body.announce_id 分派" */
function installP5Fixtures() {
	// ⚠️ 必须在 P5-5 的"假 fetch 注入"**之前**把夹具 fetch 存下来：那是全局唯一的 globalThis.fetch，
	//    P5-5 测完 restore 成真 fetch 后，P5-6 若还去读 globalThis.fetch 拿到的是**真** fetch
	//    （实测症状：`Failed to parse URL from /api/gacha-calendar-proxy…`）。
	const fixtureFetch = useFixtures(P5_FIXTURE_URLS);
	const FIX = new URL("../fixtures/", import.meta.url);
	globalThis.fetch = async (url, opts) => {
		const u = String(url);
		if (u.startsWith("/api/gacha-calendar-proxy")) {
			let target = "";
			try { target = new URL("http://x" + u).searchParams.get("url") || ""; } catch { target = ""; }
			if (target === UMA_GLOBAL_DETAIL_URL && opts && typeof opts.body === "string") {
				let id = null;
				try { id = JSON.parse(opts.body).announce_id; } catch { id = null; }
				const file = GL_DETAIL_BY_ID[id];
				// ⚠️ 必须**包成代理信封** `{status, body}`：真实代理返回的就是这个形态
				//    （早期版本这里直接回原始 body，`postJsonUma` 会因 `j.status !== 200` 抛 proxy 错 →
				//     实测症状是国际服两侧全都静默变成 null）。
				const envelope = file
					? { status: 200, body: readFileSync(new URL(file, FIX), "utf8") }
					: { status: 404, body: "" };
				const text = JSON.stringify(envelope);
				return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => text, json: async () => JSON.parse(text) };
			}
		}
		return fixtureFetch(url, opts);
	};
	// 供 P5-5 测完恢复（保持夹具模式，而不是真网络）
	return fixtureFetch;
}

/** 抓取器包装：失败只记 ✗（不抛，避免中断共享 runner） */
async function grab(fn) {
	try { return { ok: true, data: await fn() }; }
	catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}
function throws(fn) { try { fn(); return false; } catch { return true; } }
const jst = (ts) => sourceWallParts(ts, "Asia/Tokyo");
const utc = (ts) => sourceWallParts(ts, "UTC");
const pad = (n) => String(n).padStart(2, "0");
const wall = (w) => `${w.y}-${pad(w.mo)}-${pad(w.d)} ${pad(w.h)}:${pad(w.mi)}`;
const isoMin = (ts) => new Date(ts).toISOString().slice(0, 16).replace("T", " ");

export default async function run() {
	const fixtureFetch = installP5Fixtures();

	// ───────────────────────── P5-0 注册表 / 夹具映射 ─────────────────────────
	section("P5-0 注册表片段 + 夹具映射");
	{
		check("SOURCES_P5 有 2 条（uma-jp / uma-global）", SOURCES_P5.length === 2, String(SOURCES_P5.length));
		check("id = [uma-jp, uma-global]（uma-jp 吸收原 umapyoi/bwiki 两条为备选源）",
		JSON.stringify(SOURCES_P5.map((s) => s.id)) === JSON.stringify(["uma-jp", "uma-global"]),
		SOURCES_P5.map((s) => s.id).join(","));
		check("两个来源都是**双侧**", SOURCES_P5.every((s) => s.gacha && s.event));
		check("日服 tz = Asia/Tokyo / 国际服 tz = UTC（实测两者不同）",
			findSource("uma-jp").tz === "Asia/Tokyo" && findSource("uma-global").tz === "UTC");
		check("mode 全部是 proxy（实测两域名无 ACAO，direct 会被 CORS 拦）",
			SOURCES_P5.every((s) => s.gacha.mode === "proxy" && s.event.mode === "proxy"));
		check("kind = official-api（在 test/all.mjs 白名单内）",
			SOURCES_P5.every((s) => s.gacha.kind === "official-api" && s.event.kind === "official-api"));
		// 共享 test/map.json 必须收录本批次 URL（否则合并进 all.mjs 后 useFixtures() 会 404）
		const map = JSON.parse(readFileSync(new URL("./map.json", import.meta.url), "utf8"));
		for (const url of Object.keys(P5_FIXTURE_URLS)) {
			check(`map.json 收录 ${url.slice(0, 62)}…`, typeof map[url] === "string" && map[url].length > 0, JSON.stringify(map[url]));
		}
	}

	// ───────────────────────── P5-1 分类（标题关键词）─────────────────────────
	section("P5-1 标题分流（日文 ガチャ / イベント・キャンペーン；英文 scout / event）");
	{
		check("日服 ガチャ → gacha", classifyUmaTitle("トゥインクルコレクション プリティーダービーガチャとSSR確定スピードガチャ開催！", "jp") === "gacha");
		check("日服 イベント → event", classifyUmaTitle("ストーリーイベント「Banquet of Shadows」開催！", "jp") === "event");
		check("日服 キャンペーン → event", classifyUmaTitle("「覚醒Lv6/7追加記念キャンペーン」開催！", "jp") === "event");
		check("日服 两者同题时卡池优先（ガチャ 赢）", classifyUmaTitle("…ガチャと…キャンペーン開催決定！", "jp") === "gacha");
		check("日服 无关标题 → null（**不硬凑**，如不具合/功能更新）",
			classifyUmaTitle("現在確認している不具合について", "jp") === null
			&& classifyUmaTitle("一部育成ウマ娘に進化スキル追加！", "jp") === null
			&& classifyUmaTitle("「ルームマッチ」機能アップデートのお知らせ", "jp") === null);
		check("国际服 scout → gacha", classifyUmaTitle("Spotlight Pretty Derby and Spotlight Support Card Scouts out now!", "global") === "gacha");
		check("国际服 story event → event", classifyUmaTitle("The story event Illuminate the Heart is here!", "global") === "event");
		check("国际服 campaign → event", classifyUmaTitle("Holiday Celebration Part 1 now available!", "global") === "event");
		check("国际服 无关标题 → null", classifyUmaTitle("Bonus Star Piece rewards in Career!", "global") === null);
		check("同一标题在不同 mode 下都命中（分类只靠关键词，不靠公告 label）",
			classifyUmaTitle("Aim for the Stars! Dream Team Event", "global") === "event");
	}

	// ───────────────────────── P5-2 日服列表 / 详情（纯函数）───────────────────
	section("P5-2 赛马娘 日服官网公告 —— 夹具形态 + 纯函数解析");
	const jpIndexRaw = fixture("p5-uma-jp-index");
	let jpIndex = null;
	{
		check("夹具是 JSON 对象且 response_code=1", jpIndexRaw.response_code === 1 && Array.isArray(jpIndexRaw.information_list), JSON.stringify(jpIndexRaw.response_code));
		check("列表 10 条 / total_page_count=32（夹具快照）",
			jpIndexRaw.information_list.length === 10 && jpIndexRaw.total_page_count === 32,
			`${jpIndexRaw.information_list.length} / ${jpIndexRaw.total_page_count}`);
		check("列表项字段 = {announce_id,title,post_at,update_at,announce_label,image…}（**没有** from_date/to_date）",
			!jpIndexRaw.information_list.some((x) => "from_date" in x || "to_date" in x)
			&& jpIndexRaw.information_list.every((x) => x.announce_id != null && typeof x.title === "string" && typeof x.post_at === "string"),
			JSON.stringify(Object.keys(jpIndexRaw.information_list[0])));
		check("夹具快照：post_at 最早那条是 2021-02-24（置顶的「不具合」公告，分类应为 null）",
			jpIndexRaw.information_list[0].announce_id === 155 && jpIndexRaw.information_list[0].post_at === "2021-02-24 10:40:00",
			JSON.stringify([jpIndexRaw.information_list[0].announce_id, jpIndexRaw.information_list[0].post_at]));

		jpIndex = parseUmaIndex(jpIndexRaw, "jp", UMA_JP_TZ);
		check("parseUmaIndex 保留源站顺序与 id", jpIndex.length === 10 && jpIndex[0].id === 155 && jpIndex[1].id === 3470, jpIndex.slice(0, 3).map((x) => x.id).join(","));
		check("post_at 按 Asia/Tokyo 解释（3470 → 2026-10-01 12:00 JST = 03:00Z）",
			jpIndex[1].postTs === Date.UTC(2026, 9, 1, 3, 0)
			&& wall(jst(jpIndex[1].postTs)) === "2026-10-01 12:00",
			wall(jst(jpIndex[1].postTs)));
		check("同一 post_at 在 UTC 下是 03:00（反证 tz 不能写 UTC）", wall(utc(jpIndex[1].postTs)) === "2026-10-01 03:00", wall(utc(jpIndex[1].postTs)));
		check("分类命中数：page1 = 3 条 gacha（3470/3468/3469）+ 3 条 event（3481/3483/3472），其余 4 条为 null（夹具快照）",
			jpIndex.filter((x) => x.kind === "gacha").length === 3 && jpIndex.filter((x) => x.kind === "event").length === 3
			&& jpIndex.filter((x) => !x.kind).length === 4,
			`gacha=${jpIndex.filter((x) => x.kind === "gacha").length} event=${jpIndex.filter((x) => x.kind === "event").length} null=${jpIndex.filter((x) => !x.kind).length}`);
		check("page2 夹具同样是 10 条且 total_page_count 仍是 32（分页参数就是 page）",
			fixture("p5-uma-jp-index-p2").information_list.length === 10 && fixture("p5-uma-jp-index-p2").total_page_count === 32);
		check("umaJpPageUrl 覆盖 page（不改其它 query）",
			umaJpPageUrl(UMA_JP_INDEX_URL, 3) === "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=3"
			&& umaJpPageUrl("https://umamusume.jp/api/ajax/pr_info_index?format=json&page=2", 5) === "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=5",
			umaJpPageUrl(UMA_JP_INDEX_URL, 3));
		check("列表结构损坏/未成功 → 抛错",
			throws(() => parseUmaIndex({ response_code: 1 }, "jp", UMA_JP_TZ))
			&& throws(() => parseUmaIndex({ response_code: 102, information_list: [] }, "jp", UMA_JP_TZ))
			&& throws(() => parseUmaIndex(null, "jp", UMA_JP_TZ)));
	}

	// ───────────────────────── P5-3 日服详情：档期来自**正文** ────────────────
	section("P5-3 日服详情档期解析（正文，而非 from_date/to_date）");
	{
		const raw3470 = fixture("p5-uma-jp-detail-3470").detail;
		const d3470 = parseUmaDetail(fixture("p5-uma-jp-detail-3470"), UMA_JP_TZ, "jp");
		// 这条断言是本文件的核心：from/to 是"公告展示期"，正文里的「開催期間」才是真档期
		check("⚠️ from_date/to_date 与真实档期**不同**（夹具实证：from 10-01→to 2027-01-31，正文 10/1→11/2）",
			raw3470.from_date === "2026-10-01 12:00:00" && raw3470.to_date === "2027-01-31 23:59:59"
			&& d3470.windows[0].raw === "10/1 12:00 ～ 11/2 11:59",
			JSON.stringify([raw3470.from_date, raw3470.to_date, d3470.windows[0].raw]));
		check("3470 source=body（档期取自正文）", d3470.source === "body", d3470.source);
		check("3470 窗口 = 2026-10-01 12:00 ~ 2026-11-02 11:59（JST）",
			d3470.windows.length === 1
			&& isoMin(d3470.windows[0].startTs) === "2026-10-01 03:00" && isoMin(d3470.windows[0].endTs) === "2026-11-02 02:59",
			JSON.stringify(d3470.windows.map((w) => [isoMin(w.startTs), isoMin(w.endTs)])));
		check("3470 标签取到「開催期間」", d3470.windows[0].label === "開催期間", JSON.stringify(d3470.windows[0].label));
		check("3470 fmtWindow = 10-01 12:00 ~ 11-02 11:59（JST 渲染、同年不带年）",
			fmtWindow(d3470.windows[0].startTs, d3470.windows[0].endTs, UMA_JP_TZ) === "10-01 12:00 ~ 11-02 11:59",
			fmtWindow(d3470.windows[0].startTs, d3470.windows[0].endTs, UMA_JP_TZ));

		const d3469 = parseUmaDetail(fixture("p5-uma-jp-detail-3469"), UMA_JP_TZ, "jp");
		check("3469（予告）与 3470 同窗口（预告与正式公告同一档期）",
			d3469.windows.length === 1 && d3469.windows[0].startTs === d3470.windows[0].startTs && d3469.windows[0].endTs === d3470.windows[0].endTs,
			JSON.stringify(d3469.windows.map((w) => [isoMin(w.startTs), isoMin(w.endTs)])));

		const d3468 = parseUmaDetail(fixture("p5-uma-jp-detail-3468"), UMA_JP_TZ, "jp");
		check("3468（ピックアップガチャ）窗口 = 09-30 12:00 ~ 10-13 11:59",
			d3468.windows.length === 1 && fmtWindow(d3468.windows[0].startTs, d3468.windows[0].endTs, UMA_JP_TZ) === "09-30 12:00 ~ 10-13 11:59",
			JSON.stringify(d3468.windows.map((w) => fmtWindow(w.startTs, w.endTs, UMA_JP_TZ))));

		const d3481 = parseUmaDetail(fixture("p5-uma-jp-detail-3481"), UMA_JP_TZ, "jp");
		check("3481（ストーリーイベント）正文有 **两段** 区间：活动期 + 报酬领取期",
			d3481.windows.length === 2
			&& fmtWindow(d3481.windows[0].startTs, d3481.windows[0].endTs, UMA_JP_TZ) === "09-30 12:00 ~ 10-13 11:59"
			&& fmtWindow(d3481.windows[1].startTs, d3481.windows[1].endTs, UMA_JP_TZ) === "10-13 12:00 ~ 10-16 11:59",
			JSON.stringify(d3481.windows.map((w) => fmtWindow(w.startTs, w.endTs, UMA_JP_TZ))));
		check("3481 第一段标签 = イベント開催期間", d3481.windows[0].label === "イベント開催期間", JSON.stringify(d3481.windows[0].label));

		const d3472 = parseUmaDetail(fixture("p5-uma-jp-detail-3472"), UMA_JP_TZ, "jp");
		check("3472（キャンペーン）正文有 3 段小期间（販売期 / ストーリー解放期 / デイリーレース期）",
			d3472.windows.length === 3
			&& d3472.windows.some((w) => fmtWindow(w.startTs, w.endTs, UMA_JP_TZ) === "09-30 12:00 ~ 10-13 04:59")
			&& d3472.windows.some((w) => fmtWindow(w.startTs, w.endTs, UMA_JP_TZ) === "10-01 05:00 ~ 10-13 04:59"),
			JSON.stringify(d3472.windows.map((w) => fmtWindow(w.startTs, w.endTs, UMA_JP_TZ))));

		const d3477 = parseUmaDetail(fixture("p5-uma-jp-detail-3477"), UMA_JP_TZ, "jp");
		check("3477（进化技能追加）正文**没有**区间 → 如实退化为 from_date～to_date 并标注 source=fallback",
			d3477.source === "fallback" && /正文无区间/.test(d3477.windows[0].label),
			JSON.stringify([d3477.source, d3477.windows[0].label]));
		check("fallback 窗口 = from_date ~ to_date（2026-10-01 12:00 ~ 2027-01-31 23:59 JST，**跨年**）",
			fmtWindow(d3477.windows[0].startTs, d3477.windows[0].endTs, UMA_JP_TZ) === "2026-10-01 12:00 ~ 2027-01-31 23:59",
			fmtWindow(d3477.windows[0].startTs, d3477.windows[0].endTs, UMA_JP_TZ));
		check("详情结构损坏 → 抛错",
			throws(() => parseUmaDetail({ response_code: 102, detail: {} }, UMA_JP_TZ))
			&& throws(() => parseUmaDetail({ response_code: 1 }, UMA_JP_TZ)));
	}

	// ───────────────────────── P5-4 日服：选当期 / 未公布 ─────────────────────
	section("P5-4 日服选当期（覆盖 now 的最新窗口）+ 无覆盖 → null");
	{
		const jpDetails = [3470, 3468, 3469, 3472, 3477, 3481, 3483, 3487].map((id) => parseUmaDetail(fixture(`p5-uma-jp-detail-${id}`), UMA_JP_TZ, "jp"));
		const gachaEntries = jpDetails.filter((d) => d.kind === "gacha");
		const eventEntries = jpDetails.filter((d) => d.kind === "event");
		check("详情分类：gacha 有 3470/3468/3469 三条，event 有 3481/3483/3472 三条",
			gachaEntries.length === 3 && eventEntries.length === 3,
			`gacha=${gachaEntries.map((d) => d.id).join(",")} event=${eventEntries.map((d) => d.id).join(",")}`);
		const pg = pickUmaWindow(gachaEntries, SNAP);
		check("日服卡池当期 = 3470（10-01 12:00 起；3469 是同一窗口的【予告】稿 → 被排后）",
			pg && pg.e.id === 3470 && pg.e.title.includes("トゥインクルコレクション"),
			JSON.stringify(pg && [pg.e.id, isoMin(pg.w.startTs)]));
		check("预告稿 3469 与正式稿 3470 的窗口完全相同（所以必须靠标题偏好分先后）",
			gachaEntries.find((d) => d.id === 3469).windows[0].startTs === gachaEntries.find((d) => d.id === 3470).windows[0].startTs);
		// 3483「10月～3月対戦レースイベント」正文没有区间 → 走 from_date～to_date（到 12-31）；
		// 3472 有 3 段：販売期 09-30 12:00、ストーリー解放期 09-30 12:00、デイリーレース期 10-01 05:00。
		// 「覆盖 now 且 startTs 最新」→ 3472 的第 3 段（10-01 05:00 JST = 09-30 20:00Z），比 3481 的 09-30 12:00 更晚。
		const pe = pickUmaWindow(eventEntries, SNAP);
		check("日服活动当期 = 3472 里 startTs 最新的那段（10-01 05:00 ~ 10-13 04:59 JST）",
			pe && pe.e.id === 3472 && isoMin(pe.w.startTs) === "2026-09-30 20:00" && fmtWindow(pe.w.startTs, pe.w.endTs, UMA_JP_TZ) === "10-01 05:00 ~ 10-13 04:59",
			JSON.stringify(pe && [pe.e.id, isoMin(pe.w.startTs), fmtWindow(pe.w.startTs, pe.w.endTs, UMA_JP_TZ)]));
		check("3481 的活动期（09-30 12:00 ~ 10-13 11:59）确实覆盖 now（只是 startTs 不如 3472 第 3 段晚）",
			eventEntries.find((d) => d.id === 3481).windows.some((w) => w.startTs <= SNAP && w.endTs >= SNAP));
		// 只有 3481 一条在候选里（模拟"新公告还没发"）→ 选中 3481
		const pe2 = pickUmaWindow(eventEntries.filter((d) => d.id === 3481), SNAP);
		check("只有 3481 候选时 → 选中 3481（Banquet of Shadows，09-30 12:00 ~ 10-13 11:59）",
			pe2 && pe2.e.id === 3481 && pe2.e.title.includes("Banquet of Shadows") && fmtWindow(pe2.w.startTs, pe2.w.endTs, UMA_JP_TZ) === "09-30 12:00 ~ 10-13 11:59",
			JSON.stringify(pe2 && [pe2.e.id, fmtWindow(pe2.w.startTs, pe2.w.endTs, UMA_JP_TZ)]));
		// 构造"更新的公告但正文没有区间（fallback 到 12-31）"→ 不应压过真正的当期活动
		const synEvent = [
			...eventEntries,
			{ id: 9999, title: "新着イベントのお知らせ", source: "fallback", windows: [{ startTs: Date.UTC(2026, 8, 30, 3, 0), endTs: Date.UTC(2026, 11, 31, 14, 59), raw: "x", label: "y" }] }
		];
		const pe3 = pickUmaWindow(synEvent, SNAP);
		check("起点更新的 fallback 公告（09-30 12:00 起）会与真活动并列 → 仍按 id/预告偏好收敛（不产生崩溃）",
			!!pe3 && typeof pe3.e.id === "number", JSON.stringify(pe3 && pe3.e.id));
		check("⚠️ 全窗口都不覆盖 now → **null**（未公布），绝不硬凑过期档期",
			pickUmaWindow(gachaEntries, Date.UTC(2030, 0, 1)) === null
			&& pickUmaWindow(eventEntries, Date.UTC(2030, 0, 1)) === null
			&& pickUmaWindow(gachaEntries, Date.UTC(2019, 0, 1)) === null);
		check("hover = 表头 + 3 行（3470/3469 同窗口 + 3468 ピックアップ 都覆盖 now）；3477 的窗口不覆盖 now 所以不进 hover",
			umaHoverLines(gachaEntries, SNAP, UMA_JP_TZ, "H").split("\n").length === 4
			&& /10-01 12:00 ~ 11-02 11:59/.test(umaHoverLines(gachaEntries, SNAP, UMA_JP_TZ, "H"))
			&& !/3477/.test(umaHoverLines(gachaEntries, SNAP, UMA_JP_TZ, "H")),
			umaHoverLines(gachaEntries, SNAP, UMA_JP_TZ, "H").split("\n").slice(0, 4).join(" / "));
		check("hover 直接列出 fallback 退化条目（窗口覆盖 now 时才会出现退化注记）",
			/3477/.test(umaHoverLines([...gachaEntries, { id: 3477, title: "fallback 条目", source: "fallback", windows: [{ startTs: Date.UTC(2026, 9, 1, 3), endTs: Date.UTC(2027, 0, 31, 14, 59), raw: "x", label: "from_date～to_date（正文无区间，退化；**非**真实档期）" }] }], SNAP, UMA_JP_TZ, "H")));
		check("hover 第一行是正式稿 3470（预告 3469 排后）",
			umaHoverLines(gachaEntries, SNAP, UMA_JP_TZ, "H").split("\n")[1].includes("[3470]"),
			umaHoverLines(gachaEntries, SNAP, UMA_JP_TZ, "H").split("\n")[1]);
	}

	// ───────────────────────── P5-5 国际服（POST + UTC）───────────────────────
	section("P5-5 赛马娘 国际服官网公告 —— POST + UTC + response_code:102");
	const glIndexRaw = fixture("p5-uma-global-index");
	let glIndex = null;
	{
		check("夹具是 POST 响应且 response_code=1（170KB 真实数据）", glIndexRaw.response_code === 1 && Array.isArray(glIndexRaw.information_list), String(glIndexRaw.response_code));
		check("夹具快照：50 条 + show_more_button=1", glIndexRaw.information_list.length === 50 && glIndexRaw.show_more_button === 1, `${glIndexRaw.information_list.length}/${glIndexRaw.show_more_button}`);
		check("meta 记录 method=POST + body（说明夹具是真 POST 抓的）",
			fixtureMeta("p5-uma-global-index").method === "POST" && fixtureMeta("p5-uma-global-index").body.announce_label === 1,
			JSON.stringify(fixtureMeta("p5-uma-global-index").body));
		glIndex = parseUmaIndex(glIndexRaw, "global", UMA_GLOBAL_TZ);
		check("post_at 按 **UTC** 解释（1073 → 2026-09-28 22:00Z）",
			glIndex.find((x) => x.id === 1073).postTs === Date.UTC(2026, 8, 28, 22, 0)
			&& wall(utc(glIndex.find((x) => x.id === 1073).postTs)) === "2026-09-28 22:00",
			wall(utc(glIndex.find((x) => x.id === 1073).postTs)));
		check("同一 post_at 在 JST 下是 09-29 07:00（反证国际服 tz 不是 Asia/Tokyo）",
			wall(jst(glIndex.find((x) => x.id === 1073).postTs)) === "2026-09-29 07:00",
			wall(jst(glIndex.find((x) => x.id === 1073).postTs)));

		const d1073 = parseUmaDetail(fixture("p5-uma-global-detail-1073"), UMA_GLOBAL_TZ, "global");
		check("国际服详情 to_date 是 **年终哨兵** 2026-12-31（不能当档期）",
			fixture("p5-uma-global-detail-1073").detail.to_date === "2026-12-31 23:59:59",
			fixture("p5-uma-global-detail-1073").detail.to_date);
		check("1073（Spotlight Scout）真实档期取自正文：09-28 22:00Z ~ 10-12 21:59Z（英文语序：时刻在日期前）",
			d1073.source === "body" && d1073.windows.length === 1
			&& isoMin(d1073.windows[0].startTs) === "2026-09-28 22:00" && isoMin(d1073.windows[0].endTs) === "2026-10-12 21:59",
			JSON.stringify(d1073.windows.map((w) => [isoMin(w.startTs), isoMin(w.endTs), w.raw])));
		check("英文标签取到 Spotlight Scout Availability Period（不是 `10:00 p.m.,`）",
			/Spotlight·Scout·Availability·Period/.test(d1073.windows[0].label), JSON.stringify(d1073.windows[0].label));
		const d1077 = parseUmaDetail(fixture("p5-uma-global-detail-1077"), UMA_GLOBAL_TZ, "global");
		check("1077（story event）两段：活动期 09-28~10-12 + 报酬期 10-12~10-15",
			d1077.windows.length === 2
			&& fmtWindow(d1077.windows[0].startTs, d1077.windows[0].endTs, UMA_GLOBAL_TZ) === "09-28 22:00 ~ 10-12 21:59"
			&& fmtWindow(d1077.windows[1].startTs, d1077.windows[1].endTs, UMA_GLOBAL_TZ) === "10-12 22:00 ~ 10-15 21:59",
			JSON.stringify(d1077.windows.map((w) => fmtWindow(w.startTs, w.endTs, UMA_GLOBAL_TZ))));
		const d100109 = parseUmaDetail(fixture("p5-uma-global-detail-100109"), UMA_GLOBAL_TZ, "global");
		check("100109（Affected Period 含 12 小时制 9:45 a.m.）→ 09-27 22:00Z ~ 09-29 09:45Z",
			d100109.source === "body" && isoMin(d100109.windows[0].startTs) === "2026-09-27 22:00" && isoMin(d100109.windows[0].endTs) === "2026-09-29 09:45",
			JSON.stringify(d100109.windows.map((w) => [isoMin(w.startTs), isoMin(w.endTs)])));

		// POST 封装：成功路径 + 结构错误路径（用假 fetch 注入，不走网络）
		const savedFetch = globalThis.fetch;
		let seen = null;
		globalThis.fetch = async (u, o) => {
			seen = { u: String(u), method: o && o.method, body: o && o.body };
			const body = JSON.stringify({ status: 200, body: JSON.stringify({ response_code: 1, detail: { announce_id: 1, title: "t", message: "", post_at: "2026-10-01 00:00:00" } }) });
			return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => body, json: async () => JSON.parse(body) };
		};
		const okRes = await grab(() => postJsonUma(UMA_GLOBAL_DETAIL_URL, { announce_id: 1 }, { label: "t" }));
		check("postJsonUma 走代理 + method=POST + body 传 announce_id",
			okRes.ok && seen && seen.method === "POST" && /gacha-calendar-proxy/.test(seen.u) && JSON.parse(seen.body).announce_id === 1,
			JSON.stringify(seen && [seen.method, JSON.parse(seen.body)]));
		globalThis.fetch = async () => {
			const body = JSON.stringify({ status: 200, body: JSON.stringify({ response_code: 102 }) });
			return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => body, json: async () => JSON.parse(body) };
		};
		const r102 = await grab(() => postJsonUma(UMA_GLOBAL_DETAIL_URL, { announce_id: 1 }, { label: "t" }));
		check("⚠️ response_code:102（GET/缺 body 的实测形态）**不被当成成功**（返回对象交给上层判定）",
			r102.ok && r102.data && r102.data.response_code === 102, JSON.stringify(r102.ok && r102.data));
		const r102b = await grab(async () => parseUmaDetail(await postJsonUma(UMA_GLOBAL_DETAIL_URL, {}, { label: "t" }), UMA_GLOBAL_TZ, "global"));
		check("⚠️ response_code:102 经 parseUmaDetail → **抛错**（该侧算抓取失败，不是「未公布」）",
			!r102b.ok && /uma-bad-response:102/.test(r102b.err), r102b.err);
		globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => "<html>567 challenge</html>", json: async () => { throw new Error("bad"); } });
		const rHtml = await grab(() => postJsonUma(UMA_GLOBAL_DETAIL_URL, {}, { label: "t" }));
		check("⚠️ 代理返回非 JSON（EdgeOne WAF 567 挑战页形态）→ 抛 bad-json，不会静默当成功",
			!rHtml.ok && /bad-json/.test(rHtml.err), rHtml.err);
		globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ status: 403, error: "host not allowed: umamusume.com" }), json: async () => ({}) });
		const r403 = await grab(() => postJsonUma(UMA_GLOBAL_DETAIL_URL, {}, { label: "t" }));
		check("代理白名单拒绝（403 host not allowed）→ 抛错并带上原因",
			!r403.ok && /proxy:host not allowed/.test(r403.err), r403.err);
		globalThis.fetch = savedFetch;
		// proxyUrlFor 形态（与 lib/env.js 同前缀，夹具 harness 才能取回被代理 url）
		const pu = proxyUrlFor("https://umamusume.com/x", "https://umamusume.com/");
		check("proxyUrlFor 前缀与 env.js 一致", pu.startsWith("/api/gacha-calendar-proxy?url=") && pu.includes("referer="), pu.slice(0, 60));
	}

	// ───────────────────────── P5-6 抓取器端到端（离线夹具）───────────────────
	section("P5-6 抓取器端到端（夹具 fetch；now = 夹具抓取时刻）");
	{
		const jpSrc = findSource("uma-jp");
		const r1 = await grab(() => jpSrc.gacha.fetcher(jpSrc.gacha.url, undefined, jpSrc.tz, SNAP));
		check("uma-jp.gacha 抓取成功", r1.ok, r1.err);
		assertContract("赛马娘日服官网", "gacha", r1.ok ? r1.data : null);
		check("日服卡池 banner = 3470 标题 / 窗口 10-01 12:00 ~ 11-02 11:59",
			r1.ok && r1.data && r1.data.banner.includes("トゥインクルコレクション")
			&& r1.data.bannerDates === "10-01 12:00 ~ 11-02 11:59",
			JSON.stringify(r1.ok && r1.data && [r1.data.banner, r1.data.bannerDates]));
		check("bannerDatesRaw = 源站墙钟原文（正文里的那段）",
			r1.ok && r1.data && r1.data.bannerDatesRaw === "10/1 12:00 ～ 11/2 11:59",
			JSON.stringify(r1.ok && r1.data && r1.data.bannerDatesRaw));
		check("日服卡池 startTs/endTs 与夹具快照一致（JST 12:00 / 11:59）",
			r1.ok && r1.data && r1.data.startTs === Date.UTC(2026, 9, 1, 3, 0) && r1.data.endTs === Date.UTC(2026, 10, 2, 2, 59),
			JSON.stringify(r1.ok && r1.data && [r1.data.startTs, r1.data.endTs]));

		const r2 = await grab(() => jpSrc.event.fetcher(jpSrc.event.url, undefined, jpSrc.tz, SNAP));
		check("uma-jp.event 抓取成功", r2.ok, r2.err);
		assertContract("赛马娘日服官网", "event", r2.ok ? r2.data : null);
		check("日服活动 = 开始最晚的那段的所属公告（3472「覚醒Lv6/7追加記念キャンペーン」）/ 10-01 05:00 ~ 10-13 04:59",
			r2.ok && r2.data && /覚醒Lv6\/7追加記念キャンペーン/.test(r2.data.event) && r2.data.eventDates === "10-01 05:00 ~ 10-13 04:59",
			JSON.stringify(r2.ok && r2.data && [r2.data.event, r2.data.eventDates]));

		// 「未公布」路径：now 取很远（2030）→ 当期没有覆盖 now 的档期 → null（不是硬凑）
		const r1far = await grab(() => jpSrc.gacha.fetcher(jpSrc.gacha.url, undefined, jpSrc.tz, Date.UTC(2030, 0, 1)));
		check("日服卡池：now=2030 时**如实返回 null**（未公布），不硬凑过期档期", r1far.ok && r1far.data === null, JSON.stringify(r1far.ok ? r1far.data : r1far.err));
		const r2far = await grab(() => jpSrc.event.fetcher(jpSrc.event.url, undefined, jpSrc.tz, Date.UTC(2030, 0, 1)));
		check("日服活动：now=2030 时也返回 null", r2far.ok && r2far.data === null, JSON.stringify(r2far.ok ? r2far.data : r2far.err));

		const glSrc = findSource("uma-global");
		const r3 = await grab(() => glSrc.gacha.fetcher(glSrc.gacha.url, undefined, glSrc.tz, SNAP_GL));
		check("uma-global.gacha 抓取成功（POST 路径离线跑通）", r3.ok, r3.err);
		assertContract("赛马娘国际服官网", "gacha", r3.ok ? r3.data : null);
		check("国际服当期卡池 = 1073（Spotlight…Scouts out now!）/ 09-28 22:00 ~ 10-12 21:59",
			r3.ok && r3.data && r3.data.banner.includes("Spotlight Pretty Derby") && r3.data.bannerDates === "09-28 22:00 ~ 10-12 21:59",
			JSON.stringify(r3.ok && r3.data && [r3.data.banner, r3.data.bannerDates]));
		check("国际服 bannerDatesRaw 是英文原文（时刻在日期前）",
			r3.ok && r3.data && r3.data.bannerDatesRaw === "10:00 p.m., Sep 28–9:59 p.m., Oct 12, 2026",
			JSON.stringify(r3.ok && r3.data && r3.data.bannerDatesRaw));

		const r4 = await grab(() => glSrc.event.fetcher(glSrc.event.url, undefined, glSrc.tz, SNAP_GL));
		check("uma-global.event 抓取成功", r4.ok, r4.err);
		assertContract("赛马娘国际服官网", "event", r4.ok ? r4.data : null);
		check("国际服当期活动 = The story event Illuminate the Heart is here! / 09-28 22:00 ~ 10-12 21:59",
			r4.ok && r4.data && /Illuminate the Heart/.test(r4.data.event) && r4.data.eventDates === "09-28 22:00 ~ 10-12 21:59",
			JSON.stringify(r4.ok && r4.data && [r4.data.event, r4.data.eventDates]));
		const r3far = await grab(() => glSrc.gacha.fetcher(glSrc.gacha.url, undefined, glSrc.tz, Date.UTC(2030, 0, 1)));
		check("国际服卡池：now=2030 时返回 null", r3far.ok && r3far.data === null, JSON.stringify(r3far.ok ? r3far.data : r3far.err));

		// 分类为 null 的公告**不会**被当成卡池（155「不具合」）
		const bad = await grab(() => gachaUmaJpOfficial(UMA_JP_INDEX_URL, undefined, UMA_JP_TZ, Date.UTC(2021, 1, 24, 1, 40), { maxDetails: 1 }));
		check("分类 null 的公告不参与（155 不具合：maxDetails=1 时拿不到任何卡池详情 → null）",
			bad.ok && bad.data === null, JSON.stringify(bad.ok ? bad.data : bad.err));

		// 明确对比：不传 now（默认 Date.now）时，用夹具跑会因"夹具快照已过期/未到"而…这里只验证 now 是第 4 参
		const rNow = await grab(() => gachaUmaJpOfficial(UMA_JP_INDEX_URL, undefined, UMA_JP_TZ, SNAP, { maxDetails: 2, maxPages: 1, pageSize: 1 }));
		check("now 是第 4 参：显式传 SNAP 能拿到当期（pageSize=1 只取 3470）",
			rNow.ok && rNow.data && rNow.data.bannerDates === "10-01 12:00 ~ 11-02 11:59",
			JSON.stringify(rNow.ok && rNow.data && rNow.data.bannerDates));
	}

	// run.mjs/all.mjs 会调用 summary()；直接 `node test/cases-p5.mjs` 时也自报结果
	if (process.argv[1] && process.argv[1].endsWith("cases-p5.mjs")) summary();
}

// 直接执行时自动跑；被 all.mjs import 时不自动跑
if (process.argv[1] && process.argv[1].endsWith("cases-p5.mjs")) await run();
