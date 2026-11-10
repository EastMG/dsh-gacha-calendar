// next-sources/test/cases-p5x.mjs —— P5X 国服（Lead 参考实现）的离线用例
// 从 run.mjs 抽出，便于被 test/all.mjs 统一组合。
import { useFixtures, fixtureBody, check, section, assertContract, setFetchImpl } from "./harness.mjs";
import { findSource } from "./registry-shim.mjs";
import { T } from "./load.mjs";
const { parseP5xList, parseP5xWindows } = T.parsers["p5x"];

// 固定"当前时刻"＝ 2026-10-02 01:27 (UTC+8)，即夹具覆盖的 2026-09-24 ~ 2026-10-22 更新前窗口内
// （与 cases-b3.mjs 的 NOW 同一约定、同一取值）。必须注入而不是用真实时钟：
//   抓取器"选当期档期"依赖当前时刻，夹具窗口一过期就会返回 null → 断言**假红**
//   （不是解析器坏了，是"今天"跑到窗口外面去了）。第 4 参 now 是测试专用契约，见抓取器签名。
const NOW = Date.UTC(2026, 9, 1, 17, 27);

export default async function run() {
	useFixtures();

	section("P5X 国服 —— 列表解析");
	{
		// ⚠️ 必须走夹具（fixtureBody，同步返回文本），**不许** `fetch(url)`：
		//    useFixtures() 只装 transport，不覆盖 globalThis.fetch —— 这里写 fetch 就是真联网，
		//    CI（非中国出口）连不上 p5x.wanmei.com ⇒ fetch failed ⇒ 整批 0 断言（2026-10-28 红过）。
		const t = fixtureBody("https://p5x.wanmei.com/news/gamenews/index.html");
		const list = parseP5xList(t);
		check("列表解析出条目", list.length > 0, String(list.length));
		check("条目带 href/title", list.every((x) => x.href && x.title), JSON.stringify(list[0] || null));
		check("href 形如 /news/gamenews/YYYYMMDD/<id>.html",
			list.every((x) => /^\/news\/[a-z]+\/\d{8}\/\d+\.s?html$/.test(x.href)), JSON.stringify(list.map((x) => x.href).slice(0, 3)));
		check("dateKey 是 8 位日期", list.every((x) => /^\d{8}$/.test(x.dateKey)), JSON.stringify(list.map((x) => x.dateKey).slice(0, 3)));
		check("标题已去掉站点尾巴（不含「手游官网」）", list.every((x) => !/手游官网/.test(x.title)), JSON.stringify(list[0] && list[0].title));
		check("无重复 href（去重生效）", new Set(list.map((x) => x.href)).size === list.length);

		// ── 兜底自检（2026-10-28）：挡住"再用全局 fetch 打真网络"的回潮 ──────────────
		// ① 全局 fetch 兜底必须**拒绝**（离线门禁里它就是闸门）；`--live` 抽检时放行，故跳过。
		if (!process.argv.includes("--live")) {
			let guardErr = null;
			try { await fetch("https://p5x.wanmei.com/news/gamenews/index.html"); } catch (e) { guardErr = e; }
			const msg = String((guardErr && guardErr.message) || "");
			check("全局 fetch 兜底：离线时拒绝真网络", !!guardErr && msg.includes("测试里不许走真网络"), msg || "没有抛错（真的联网了）");
			check("全局 fetch 兜底的错误带 URL", msg.includes("p5x.wanmei.com"), msg);
		}
		// ② fixtureBody 找不到映射时必须抛明确错误，不许返回空串（空串会让解析器空数组 → 假绿）
		let fxErr = null;
		try { fixtureBody("https://example.invalid/not-in-map.html"); } catch (e) { fxErr = e; }
		const fxMsg = String((fxErr && fxErr.message) || "");
		check("fixtureBody：无映射 → 抛错且带 URL 与修复提示",
			!!fxErr && fxMsg.includes("https://example.invalid/not-in-map.html") && fxMsg.includes("map.json") && fxMsg.includes("改用例"),
			fxMsg || "没有抛错");
	}

	section("P5X 国服 —— 档期窗口解析（含跨年 / 双年份）");
	{
		const tz = "Asia/Shanghai";
		const w = parseP5xWindows("2026年9月24日—10月22日更新前", tz);
		check("同年窗口：解析出 1 条", w.length === 1, JSON.stringify(w));
		if (w[0]) {
			// 2026-11-10 统一口径：只有日期 ⇒ 起 00:00 / 止 23:59（原 04:00 / 03:59 是国服换日推算）
			check("起点 = 09-24 00:00 (UTC+8)", w[0].startTs === Date.UTC(2026, 8, 24, 0, 0) - 8 * 3600e3, String(w[0].startTs));
			check("终点 = 10-22 23:59 (UTC+8)", w[0].endTs === Date.UTC(2026, 9, 22, 23, 59) - 8 * 3600e3, String(w[0].endTs));
			check("endTs > startTs", w[0].endTs > w[0].startTs);
		}
		const cross = parseP5xWindows("2025年12月30日—1月15日", tz);
		check("跨年窗口：结束年份自动 +1",
			cross.length === 1 && new Date(cross[0].endTs).getUTCFullYear() === 2026,
			JSON.stringify(cross.map((x) => new Date(x.endTs).toISOString())));
		const withYear = parseP5xWindows("2026年10月5日—2026年10月22日更新前", tz);
		check("两端都带年份也能解", withYear.length === 1, JSON.stringify(withYear));
		check("无日期 → 空数组（不硬造）", parseP5xWindows("没有任何日期的文本", tz).length === 0);
	}

	section("P5X 国服 —— 卡池侧 / 活动侧契约");
	{
		const src = findSource("p5x");
		const g = await src.gacha.fetcher(src.gacha.url, undefined, src.tz, NOW);
		assertContract("P5X", "gacha", g);
		check("卡池 banner 非空", !!(g && g.banner), JSON.stringify(g && g.banner));
		check("卡池 bannerDatesRaw 保留源站原文", !!(g && g.bannerDatesRaw), JSON.stringify(g && g.bannerDatesRaw));
		const e = await src.event.fetcher(src.event.url, undefined, src.tz, NOW);
		assertContract("P5X", "event", e);
		check("活动 eventHover 是多行（逐行列出当期窗口）",
			typeof e.eventHover === "string" && e.eventHover.includes("\n"), JSON.stringify((e.eventHover || "").slice(0, 80)));
		check("两侧共用同一份 gamenews（P5X 无独立卡池栏目）", src.gacha.url === src.event.url);
		check("P5X 声明 mode=proxy（wanmei 实测无 ACAO）",
			src.gacha.mode === "proxy" && src.event.mode === "proxy");
	}

	section("P5X 国服 —— 「不覆盖当前时刻则返回 null」语义");
	{
		// 夹具是 2026-09-24 起的档期。用一个**远早于它**的时刻跑不出覆盖 → 应得 null。
		// 用 Date 打桩太侵入；这里直接验 parseP5xWindows + 覆盖判定逻辑本身：
		const tz = "Asia/Shanghai";
		const wins = parseP5xWindows("2020年1月1日—2020年2月1日", tz);
		check("解析出过期窗口", wins.length === 1);
		const now = Date.now();
		check("过期窗口不覆盖当前时刻（→ 抓取器会返回 null，而不是显示旧档期）",
			!(wins[0].startTs <= now && wins[0].endTs >= now));
	}

	// ───────────────────── 2026-11-10：真机 5.4.2 公告（只有日期、没有时分）─────────────────────
	section("P5X 国服 —— 真机 5.4.2 公告：`活动时间：2026年10月22日-2026年11月19日`（无时分）");
	const NOW_1110 = Date.parse("2026-11-10T02:50:00+08:00");
	const LIST_URL = "https://p5x.wanmei.com/news/gamenews/index.html";
	const DETAIL_URL = "https://p5x.wanmei.com/news/gamenews/20261022/264741.html";
	const detailBody = fixtureBody(DETAIL_URL);
	{
		const text = T.parsers.p5x.p5xBodyText(detailBody);
		const blocks = T.parsers.p5x.parseP5xBlocks(text);
		const bessa = blocks.find((b) => b.title === "贝萨出品");
		check("真机详情解析出「活动更新-贝萨出品」块，windowRaw = 「2026年10月22日-2026年11月19日」",
			!!bessa && bessa.category === "活动更新" && bessa.windowRaw === "2026年10月22日-2026年11月19日",
			JSON.stringify(bessa));
		const w = parseP5xWindows(bessa.windowRaw, "Asia/Shanghai");
		check("纯日期窗口 ⇒ 起 00:00 / 止 23:59（UTC+8；与 bwiki 通用层同一约定）",
			w.length === 1
			&& w[0].startTs === Date.UTC(2026, 9, 21, 16, 0)      // 2026-10-22 00:00 +08
			&& w[0].endTs === Date.UTC(2026, 10, 19, 15, 59),     // 2026-11-19 23:59 +08
			JSON.stringify(w));

		// 抓取器：列表换成 2026-10-22 那版真夹具；详情用真响应（/ 可用 stripped 版本做反向证明）
		const listBody = fixtureBody(LIST_URL, { [LIST_URL]: "p5x-list-20261022/response.txt" });
		const makeImpl = (detail) => async (url) => {
			const raw = String(url);
			const isApi = raw.startsWith("/api/gacha-calendar-proxy");
			const target = isApi ? new URL("http://x" + raw).searchParams.get("url") : raw;
			const body = target === LIST_URL ? listBody : target === DETAIL_URL ? detail : "";
			// 代理形态要回信封 { status, body }（与 useFixtures 的 impl 同形）；直连形态回正文
			const text = isApi ? JSON.stringify({ status: body ? 200 : 404, body }) : body;
			return { ok: !!body, status: body ? 200 : 404, headers: { get: () => null }, text: async () => text, json: async () => JSON.parse(text) };
		};
		setFetchImpl(makeImpl(detailBody));
		const src = findSource("p5x");
		const g = await src.gacha.fetcher(src.gacha.url, undefined, src.tz, NOW_1110);
		const e = await src.event.fetcher(src.event.url, undefined, src.tz, NOW_1110);
		check("活动侧：当期 = 贝萨出品，档期「10-22 00:00 ~ 11-19 23:59」，原文逐字",
			!!e && e.event === "贝萨出品" && e.eventDates === "10-22 00:00 ~ 11-19 23:59"
			&& e.eventDatesRaw === "2026年10月22日-2026年11月19日",
			JSON.stringify(e && [e.event, e.eventDates, e.eventDatesRaw]));
		check("活动悬停含 3 条当期（贝萨出品 / 统统创飞 / 怪盗幻像的试炼）",
			!!e && e.eventHover === "贝萨出品   10-22 00:00 ~ 11-19 23:59\n「统统创飞」活动开启   11-05 00:00 ~ 11-19 23:59\n怪盗幻像的试炼   11-05 00:00 ~ 11-19 23:59",
			JSON.stringify(e && e.eventHover));
		// 2026-11-10 修（任务 4）：卡池区块候选从「只认契约」扩到「契约 | 扭蛋」，且「契约更新」的档期是
		// **裸行**（`2026年9月24日-2026年11月19日`，没有「活动时间：」前缀）也要认。两处都改后：
		//   · 本期在期的「限定扭蛋复刻」（10-22 ~ 12-24，公告里排在契约更新之前）成为当期卡池；
		//   · 「缘结之契」的裸行也进了 windowRaw（旧实现是空串 ⇒ 那一块永远不产出）。
		const contract = blocks.find((b) => b.category === "契约更新");
		check("`契约更新` 块的**裸档期行**（无「活动时间：」前缀）也解析成 windowRaw",
			!!contract && contract.windowRaw === "2026年9月24日-2026年11月19日", JSON.stringify(contract && contract.windowRaw));
		const tuandan = blocks.find((b) => b.title === "限定扭蛋复刻");
		check("「都市更新 / 限定扭蛋复刻」块解析出在期档期 10-22 ~ 12-24",
			!!tuandan && tuandan.windowRaw === "2026年10月22日-2026年12月24日", JSON.stringify(tuandan && tuandan.windowRaw));
		check("卡池侧：当期 = 限定扭蛋复刻，档期「10-22 00:00 ~ 12-24 23:59」，原文逐字",
			!!g && g.banner === "限定扭蛋复刻" && g.bannerDates === "10-22 00:00 ~ 12-24 23:59"
			&& g.bannerDatesRaw === "2026年10月22日-2026年12月24日",
			JSON.stringify(g && [g.banner, g.bannerDates, g.bannerDatesRaw]));

		// 两条修法各自**单独**都能产出卡池（互不依赖，反证有区分力）：
		//   · now=10-01：扭蛋还没开（10-22 起）⇒ 在期的只有「缘结之契」⇒ 只靠裸行修法；
		//   · now=12-01：契约已结束（11-19 止）⇒ 在期的只有「限定扭蛋复刻」⇒ 只靠候选扩容。
		const gOct = await src.gacha.fetcher(src.gacha.url, undefined, src.tz, Date.parse("2026-10-01T12:00:00+08:00"));
		check("裸行修法单独生效：now=10-01（扭蛋 10-22 才开）⇒ 当期 = 缘结之契持续开启 / 09-24 00:00 ~ 11-19 23:59",
			!!gOct && gOct.banner === "缘结之契持续开启" && gOct.bannerDates === "09-24 00:00 ~ 11-19 23:59"
			&& gOct.bannerDatesRaw === "2026年9月24日-2026年11月19日",
			JSON.stringify(gOct && [gOct.banner, gOct.bannerDates, gOct.bannerDatesRaw]));
		const gDec = await src.gacha.fetcher(src.gacha.url, undefined, src.tz, Date.parse("2026-12-01T12:00:00+08:00"));
		check("扭蛋候选单独生效：now=12-01（契约 11-19 已结束）⇒ 当期 = 限定扭蛋复刻 / 10-22 00:00 ~ 12-24 23:59",
			!!gDec && gDec.banner === "限定扭蛋复刻" && gDec.bannerDates === "10-22 00:00 ~ 12-24 23:59",
			JSON.stringify(gDec && [gDec.banner, gDec.bannerDates]));
		check("反证：两段都过期（now=2026-12-25）⇒ 卡池侧 null（不残留上一期）",
			(await src.gacha.fetcher(src.gacha.url, undefined, src.tz, Date.parse("2026-12-25T12:00:00+08:00"))) === null);

		// 反向证明（活动侧）：把**所有日期区间**从正文里删掉 ⇒ 区块不再带窗口 ⇒ 活动侧 null
		const stripped = detailBody.replace(/\d{4}年\d{1,2}月\d{1,2}日\s*[-—–~～至]\s*(?:\d{4}年)?\d{1,2}月\d{1,2}日/g, "");
		const blocks2 = T.parsers.p5x.parseP5xBlocks(T.parsers.p5x.p5xBodyText(stripped));
		check("反证：删掉正文里所有日期区间 ⇒ 所有区块 windowRaw 为空、解析不出窗口",
			blocks2.every((b) => b.windowRaw === "") && blocks2.every((b) => parseP5xWindows(b.windowRaw, "Asia/Shanghai").length === 0),
			JSON.stringify(blocks2.map((b) => [b.title, b.windowRaw])));
		setFetchImpl(makeImpl(stripped));
		const e2 = await src.event.fetcher(src.event.url, undefined, src.tz, NOW_1110);
		check("反证：源站有公告但没有日期区间 ⇒ 活动侧如实 null（不是编一条）", e2 === null, JSON.stringify(e2));
		useFixtures();   // 还原全局夹具（后面的用例还要用）
	}
}
