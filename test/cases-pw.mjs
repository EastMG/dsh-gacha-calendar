// test/cases-pw.mjs —— 完美世界·异环（官网公告 yh.wanmei.com）离线夹具用例
//
// 为什么单独一批：异环（`id: "nte"`）自接入起**一行用例都没有**（test/fixtures 里也没有任何 nte 夹具），
// 于是 2026-10 源站把公告的段落锚点从 `一、/二、` 改成 `【更新内容】/【新增/修复内容】` 时，
// 没有任何门禁报错 —— 面板只是安静地一直显示"未公布"。本批把这条链路的每一环都钉住。
//
// 2026-10-21 实测到的现场（用户报「异环卡池+活动两侧都 nomatch」）：
//   · 抓取链是通的：列表第 1 页 3 条公告，第 3 条就是「10月15日停服维护公告」；
//   · 那篇公告里明写着  `开放时间：10月15日维护更新后-11月5日05:59`
//     + `棋盘说明：可通过「灿烂的星」限定棋盘获得S级角色「明音凛」`  → 确实覆盖当时（10-21）；
//   · 但 `parseNteBoards` 先找 `^一、` 来定位"一、全新角色&弧盘"段 —— 全文**一行都没有** → 直接 `[]`
//     → `data.banner` 空 → `parseNteWanmei` 返回 null（连同一篇里的限时活动一起丢掉）。
//   本批夹具 `pw-nte-*` 是 2026-10-21 真抓的（meta.capturedAt 可追溯），不是合成。
//
// 四条约定（照 cases-b1/b3/p6/p9）：
//   ① 全程离线：useFixtures() 注入夹具 fetch；纯函数测试直接读 fixtures/*/response.txt。
//   ② 确定性：「当前时刻」一律**显式注入**（fetchNteWanmei / parseNteWanmei 都有 now 形参），
//      绝不用 Date.now() —— 否则一个月后"当期"变了会假失败。
//   ③ 每个抓取器调用都包 try/catch，失败只记 ✗，不抛出中断 test/all.mjs。
//   ④ 断言里的硬编码值都是**夹具快照值**。
//
// 本地直接跑：node test/cases-pw.mjs

import { readFileSync } from "node:fs";
import { useFixtures, setFetchImpl, check, section, assertContract, summary } from "./harness.mjs";
import { T } from "./load.mjs";

const { sourceInstant } = T;
const {
	NTE_ITEM_RE, NTE_MAINT_RE, NTE_MAX_LIST_PAGES, NTE_MAX_LOOKBACK_DAYS, NTE_MAX_DETAILS,
	fetchNteWanmei, nteContentBounds, nteNextPageUrls, ntePlainText, ntePostDate,
	parseNteBoards, parseNteWanmei
} = T.parsers["nte"];

const LIST_URL = "https://yh.wanmei.com/news/gamebroad/";
const DETAIL_URL = "https://yh.wanmei.com/news/gamebroad/20261014/264537.html";
const TZ = "Asia/Shanghai";

// ── 夹具读取 ──
const fixtureText = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");
const meta = (p) => JSON.parse(fixtureText(p + ".meta.json"));
const LIST_FX = "pw-nte-list/response.txt";
const INDEX1_FX = "pw-nte-index1/response.txt";
const DETAIL_FX = "pw-nte-detail-264537/response.txt";

// ── 关键时间点（都用源站时区 +08 表述；断言只看"覆盖/不覆盖"，离边界很远，故与跑测机器的时区无关）──
const NOW_IN = sourceInstant(2026, 10, 21, 5, 30, TZ);      // 用户报障那一刻：池子在开
const NOW_BEFORE = sourceInstant(2026, 10, 1, 0, 0, TZ);    // 10-15 之前：还没开
const NOW_AFTER = sourceInstant(2026, 11, 6, 0, 0, TZ);     // 11-05 结束之后：已经关了
const NOW_FAR = sourceInstant(2027, 6, 1, 0, 0, TZ);        // 远到连"回看窗口"都够不着

// 包一层记账：数一数一次抓取到底发了几个请求（代理路径 == 真实请求数）
async function counting(overrides, fn) {
	const impl = useFixtures(overrides || {});
	const seen = [];
	setFetchImpl(async (url, opts) => { seen.push(String(url)); return impl(url, opts); });
	try { const data = await fn(); return { data, requests: seen }; }
	catch (e) { return { data: undefined, requests: seen, error: e }; }
}
const grab = async (fn) => { try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, error: e }; } };

export default async function run() {
	section("异环（官网公告 / 限定棋盘卡池）");

	// ── 一、夹具形态：先证明"源站上真的有覆盖 now 的窗口" ────────────────────────
	{
		const listHtml = fixtureText(LIST_FX);
		const items = [...listHtml.matchAll(NTE_ITEM_RE)].map((m) => ({ href: m[1], title: m[2] }));
		check("列表夹具解析出 3 条公告（每页 3 条 —— 这正是「翻页深度」必须够深的原因）",
			items.length === 3, String(items.length));
		check("列表第 1 条/第 2 条是「不停服更新公告」（解析器会跳过它们）",
			/不停服/.test(items[0].title) && /不停服/.test(items[1].title), JSON.stringify(items.map((x) => x.title)));
		check("列表第 3 条是「10月15日停服维护公告」= 唯一带新卡池的那条",
			items[2].title === "《异环》10月15日停服维护公告" && items[2].href === "/news/gamebroad/20261014/264537.html",
			JSON.stringify(items[2]));
		check("三条标题里只有 1 条不会被 `不停服` 过滤（其余都是热更公告）",
			items.filter((x) => NTE_MAINT_RE.test(x.title) && !/不停服/.test(x.title)).length === 1,
			String(items.filter((x) => NTE_MAINT_RE.test(x.title) && !/不停服/.test(x.title)).length));

		const detailHtml = fixtureText(DETAIL_FX);
		const text = ntePlainText(detailHtml);
		const lines = text.split("\n").map((s) => s.trim());
		// ⚠️ 这一条就是 2026-10-21 那个 bug 的现场证据：旧锚点 `一、` 一条都没有
		check("⚠️ 公告正文里 **一行 `一、` 都没有**（旧锚点失效的现场证据）",
			lines.filter((l) => /^一、/.test(l)).length === 0,
			JSON.stringify(lines.filter((l) => /^一、/.test(l)).slice(0, 2)));
		check("公告正文用的是 `【更新内容】` / `【新增/修复内容】` 两段",
			lines.includes("【更新内容】") && lines.includes("【新增/修复内容】"),
			JSON.stringify(lines.filter((l) => /^【/.test(l))));
		check("公告正文含当期限定棋盘窗口原文 `开放时间：10月15日维护更新后-11月5日05:59`",
			/开放时间：10月15日维护更新后-11月5日05:59/.test(text));
		check("公告正文含角色卡池独有的锚点 `棋盘说明：可通过「灿烂的星」限定棋盘获得`",
			/棋盘说明：可通过「灿烂的星」限定棋盘获得/.test(text));
		check("同一篇公告还含限时活动 `「咔滋！黄金双脆」限时活动`（活动侧同源）",
			/「咔滋！黄金双脆」限时活动/.test(text));

		check("夹具 meta.url 与线上地址一致（列表）", meta(LIST_FX).url === LIST_URL, meta(LIST_FX).url);
		check("夹具 meta.url 与线上地址一致（详情）", meta(DETAIL_FX).url === DETAIL_URL, meta(DETAIL_FX).url);
		check("夹具是 HTTP 200 真抓（capturedAt 可追溯）",
			meta(LIST_FX).status === 200 && meta(DETAIL_FX).status === 200
			&& !Number.isNaN(Date.parse(meta(DETAIL_FX).capturedAt)),
			JSON.stringify([meta(LIST_FX).status, meta(DETAIL_FX).capturedAt]));
	}

	// ── 二、段落锚点：旧 `一、/二、` 与新 `【更新内容】` 都必须认 ──────────────────
	{
		const oldLines = [
			"二、 其他内容",            // 干扰项：出现在起点之前，不能被当成起点
			"一、 全新角色&弧盘",
			"● 全新限定S级角色「旧格式」",
			"开放时间：9月1日维护更新后-9月20日05:59",
			"棋盘说明：可通过「旧锚点」限定棋盘获得S级角色「旧格式」",
			"二、 新增/修复内容",
			"● 与卡池无关的一行"
		];
		const b1 = nteContentBounds(oldLines);
		check("nteContentBounds：旧格式 `一、/二、` 认出 [1,5)",
			!!b1 && b1.start === 1 && b1.end === 5, JSON.stringify(b1));

		const newLines = [
			"【维护时间&补偿说明】",
			"● 维护补偿：环石*300",
			"【更新内容】",
			"● 全新限定S级角色「新格式」",
			"棋盘说明：可通过「新锚点」限定棋盘获得",
			"【新增/修复内容】",
			"● 与卡池无关的一行"
		];
		const b2 = nteContentBounds(newLines);
		check("nteContentBounds：新格式 `【…更新内容】` 认出 [2,5)",
			!!b2 && b2.start === 2 && b2.end === 5, JSON.stringify(b2));

		check("nteContentBounds：两种锚点都没有 → null（不硬扫全文）",
			nteContentBounds(["随便一段话", "● 某条目"]) === null);

		const noAnchor = parseNteBoards("● 全新限定S级角色「X」\n开放时间：10月1日维护更新后-10月9日05:59\n棋盘说明：可通过「Y」限定棋盘获得", 2026);
		check("parseNteBoards：没有段落锚点时返回 []（保持「不硬扫」的克制，不被别处的『开放时间』骗）",
			Array.isArray(noAnchor) && noAnchor.length === 0, JSON.stringify(noAnchor));

		// 真实公告：段落边界落在「【更新内容】」与「【新增/修复内容】」上
		const realLines = ntePlainText(fixtureText(DETAIL_FX)).split("\n").map((s) => s.trim());
		const rb = nteContentBounds(realLines);
		check("真实公告的段落边界 = 【更新内容】…【新增/修复内容】",
			!!rb && realLines[rb.start] === "【更新内容】" && realLines[rb.end] === "【新增/修复内容】",
			JSON.stringify(rb && [rb.start, rb.end, realLines[rb.start], realLines[rb.end]]));

		// 返场池（`限定S级角色「X」返场`，没有"全新"二字）也要解出来 —— 那同样是一张在开的角色池
		const returnText = [
			"【更新内容】",
			"● 限定S级角色「安魂曲」返场",
			"开放时间：10月1日10:00-10月20日05:59",
			"棋盘说明：可通过「回声」限定棋盘获得S级角色「安魂曲」",
			"【新增/修复内容】"
		].join("\n");
		const ret = parseNteBoards(returnText, 2026);
		check("parseNteBoards：返场池 → 类型「返场限定棋盘」且角色名取到",
			ret.length === 1 && ret[0].type === "返场限定棋盘" && ret[0].roles === "安魂曲",
			JSON.stringify(ret));
	}

	// ── 三、parseNteWanmei：覆盖 now → 两侧都有数据 ────────────────────────────
	{
		const detailHtml = fixtureText(DETAIL_FX);
		const inWin = parseNteWanmei(detailHtml, TZ, NOW_IN);
		check("覆盖 now：卡池侧非空（这正是修之前返回 null 的地方）", !!inWin, JSON.stringify(inWin));
		if (inWin) {
			assertContract("异环 卡池侧", "gacha", inWin);
			check("卡池类型外显 = 限定棋盘", inWin.banner === "限定棋盘", inWin.banner);
			check("卡池角色外显 = 明音凛（弧盘「月的对跖点」不算角色池）", inWin.roles === "明音凛", inWin.roles);
			check("卡池档期 = 10-15 11:00 ~ 11-05 05:59（维护 11:00 结束 → 开始按 11:00 计）",
				inWin.bannerDates === "10-15 11:00 ~ 11-05 05:59", inWin.bannerDates);
			check("悬停原文与外显同值（两侧都走 bannerDatesRaw）",
				inWin.bannerDatesRaw === inWin.bannerDates);
			check("活动侧外显 = 咔滋！黄金双脆", inWin.event === "咔滋！黄金双脆", inWin.event);
			check("活动档期与卡池同窗口（同一篇公告的两个 10/15-11/05）",
				inWin.eventDates === "10-15 11:00 ~ 11-05 05:59", inWin.eventDates);
			check("活动侧也带 eventDatesRaw", inWin.eventDatesRaw === inWin.eventDates);
			// 活动侧不许被"噗卡翻翻乐 10/23 起""夺金大作战 10/19 起"抢走（取文本里**第一个**命中的）
			check("活动侧取到的是当期在开的那一个（不是 10/23 才开的翻翻乐）",
				!/翻翻乐|夺金/.test(inWin.event || ""), inWin.event);
		}

		check("池子还没开（10-01）→ null（未公布）", parseNteWanmei(detailHtml, TZ, NOW_BEFORE) === null);
		check("池子已结束（11-06）→ null（未公布）", parseNteWanmei(detailHtml, TZ, NOW_AFTER) === null);
		check("不带 now 也能跑（默认取当前时刻，类型仍是 null 或对象）",
			parseNteWanmei(detailHtml, TZ) === null || typeof parseNteWanmei(detailHtml, TZ) === "object");
	}

	// ── 四、抓取器端到端：列表 → 第 3 条维护公告 → 详情 ────────────────────────
	{
		const r = await counting({}, () => fetchNteWanmei(LIST_URL, undefined, TZ, NOW_IN));
		check("fetchNteWanmei 不抛错", !r.error, r.error && r.error.message);
		check("两侧都有数据（修之前这里是 null → 面板两侧都报「未公布」）",
			!!r.data && r.data.banner === "限定棋盘" && r.data.event === "咔滋！黄金双脆",
			JSON.stringify(r.data));
		check("请求数 = 2（1 个列表页 + 1 篇维护公告详情；两条不停服公告被跳过，没白抓）",
			r.requests.length === 2, String(r.requests.length));
		check("详情请求落在 264537 那篇上",
			r.requests.some((u) => decodeURIComponent(u).includes("20261014/264537.html")),
			r.requests.map((u) => u.slice(0, 90)).join(" | "));
	}

	// ── 五、翻页深度：维护公告被热更挤到第 2 页也要翻到 ─────────────────────────
	{
		check("翻页上限已从 3 放宽（列表每页 3 条、热更公告一天数条）",
			NTE_MAX_LIST_PAGES >= 12, String(NTE_MAX_LIST_PAGES));
		check("回看窗口覆盖「公测卡池最长 3 周」（40 天）",
			NTE_MAX_LOOKBACK_DAYS >= 35, String(NTE_MAX_LOOKBACK_DAYS));
		check("详情试读上限仍是 3（不因为翻页变深就多抓正文）", NTE_MAX_DETAILS === 3, String(NTE_MAX_DETAILS));

		// 把第 1 页换成"全是热更公告"的第 2 页夹具：第 3 条维护公告必须靠翻页才看得到。
		// ⚠️ 必须显式把 index2.html 也指回真正的第 1 页夹具 —— 只覆盖 LIST_URL 的话，
		//    map 的前缀兜底（`/news/gamebroad/` 是子页的前缀键）会把所有子页都解析成同一份内容。
		const deep = await counting({ [LIST_URL]: INDEX1_FX, [LIST_URL + "index2.html"]: LIST_FX },
			() => fetchNteWanmei(LIST_URL, undefined, TZ, NOW_IN));
		check("第 1 页全是热更公告时，翻到下一页仍能找到当期卡池",
			!!deep.data && deep.data.banner === "限定棋盘", JSON.stringify(deep.data));
		check("深翻请求数 = 3（2 个列表页 + 1 篇详情）", deep.requests.length === 3, String(deep.requests.length));

		// 日期收手：now 远到"某页最新一条都超过回看窗口"时，只翻 1 页就停（省掉一串白请求）
		const far = await counting({}, () => fetchNteWanmei(LIST_URL, undefined, TZ, NOW_FAR));
		check("远未来（2027-06）→ null（未公布）", far.data === null, JSON.stringify(far.data));
		check("日期收手生效：只抓了 1 个列表页 + 1 篇详情 = 2 个请求（没有把 12 页全翻一遍）",
			far.requests.length === 2, String(far.requests.length));
	}

	// ── 六、三态口径：列表页一条公告链接都没有 → 抛错（"抓取失败"而不是"未公布"）──
	{
		// 夹具换成一份 JSON（没有 /news/gamebroad/N/N.html 链接）→ 必须报错，不能安静地返回 null
		const bad = await counting({ [LIST_URL]: "uma-gt-manifest/response.txt" },
			() => fetchNteWanmei(LIST_URL, undefined, TZ, NOW_IN));
		check("列表页结构变了 → 抛 `nte-list-shape-changed`（面板该显示「抓取失败」）",
			!!bad.error && /nte-list-shape-changed/.test(String(bad.error.message)),
			bad.error ? String(bad.error.message) : "did not throw");
	}

	// ── 七、纯函数：公告链接日期 / 分页地址 ─────────────────────────────────
	{
		check("ntePostDate 解出公告发布日期（2026-10-16 00:00 +08）",
			ntePostDate("/news/gamebroad/20261016/264655.html") === sourceInstant(2026, 10, 16, 0, 0, TZ),
			new Date(ntePostDate("/news/gamebroad/20261016/264655.html")).toISOString());
		check("ntePostDate 解不出时返回 0（当作「不知道」，不触发提前收手）",
			ntePostDate("/news/gamebroad/index2.html") === 0
			&& ntePostDate("/news/gamebroad/2026101/1.html") === 0 && ntePostDate("") === 0,
			JSON.stringify([ntePostDate("/news/gamebroad/index2.html"), ntePostDate("/news/gamebroad/2026101/1.html")]));

		const nexts = nteNextPageUrls(LIST_URL, fixtureText(LIST_FX), new Set([LIST_URL]));
		check("分页地址按相对路径拼成绝对 URL（index1..index17）",
			nexts.includes("https://yh.wanmei.com/news/gamebroad/index1.html")
			&& nexts.every((u) => /^https:\/\/yh\.wanmei\.com\/news\/gamebroad\/index\d+\.html$/.test(u)),
			nexts.slice(0, 3).join(","));
		check("分页地址不会把当前页/已看过的页再排进来",
			!nexts.includes(LIST_URL) && new Set(nexts).size === nexts.length);
	}

	// ── 八、注册表：来源选项名一个都没动 ─────────────────────────────────────
	{
		const src = T.SOURCES.find((s) => s.id === "nte");
		check("nte 条目在来源表里", !!src);
		if (src) {
			check("两侧 URL 仍是官网公告列表", src.url === LIST_URL && src.eventUrl === LIST_URL,
				JSON.stringify([src.url, src.eventUrl]));
			check("两侧来源名仍是「官网公告」（未改来源选项名）",
				src.source === "官网公告" && src.eventSource === "官网公告",
				JSON.stringify([src.source, src.eventSource]));
			check("备选源 label 仍是「LDSHOP」（未改来源选项名）",
				(src.altSources || []).length === 1 && src.altSources[0].label === "LDSHOP",
				JSON.stringify((src.altSources || []).map((x) => x.label)));
			check("tz 仍是 Asia/Shanghai", src.tz === TZ, src.tz);
			check("parserVersion 升到 3（解析规则变了：段落锚点 + 翻页深度）",
				src.parserVersion === 3, String(src.parserVersion));
		}
		check("卡池侧抓取器已登记", typeof T.GACHA_FETCHERS["nte"] === "function");
		check("活动侧抓取器已登记（同一个函数，各报各的错）",
			!!T.EVENT_FETCHERS["nte"] && typeof T.EVENT_FETCHERS["nte"].default === "function");
		check("nte 与 p5x 共用同一套 perfectworld 模块导出（互不覆盖）",
			typeof T.parsers["p5x"].gachaP5x === "function" && typeof T.parsers["nte"].fetchNteWanmei === "function");
	}
}

// run.mjs / all.mjs 会调用 summary()；直接 `node test/cases-pw.mjs` 时也自报结果
if (process.argv[1] && process.argv[1].endsWith("cases-pw.mjs")) summary();
