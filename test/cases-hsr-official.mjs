// test/cases-hsr-official.mjs —— 星铁卡池换官方公告 CMS + 「相对起点」锚定 + 「起点未知 ≠ 已开始」
//
// 用户 2026-11-09 拍板的三条规则（本文件逐条钉住）：
//   ① **星铁默认卡池源换成官方公告 CMS**（bwiki「历史跃迁」降为 `altSources` 备选）；
//   ② **相对起点直接锚定钟点**：星铁「X.Y版本更新后」⇒ 该日 10:00（+08）；
//      无期迷途「开服后」⇒ 该日 14:00（有维护公告就用窗口结束，取不到退常量）；
//   ③ **起点未知（只有版本标签、没有日期）≠ 已开始** ⇒ 不参与在期判定（只在悬停里列出）。
//
// ── 这个文件守什么 ──
//   ① 注册项：hsr.url / source / altSources / parserVersion，以及两条抓取器（默认 CMS / 备选 bwiki）；
//   ② 官方 CMS 解析（**真夹具** `p4-hsr-cms-list`，裁剪规则见它的 response.txt.meta.json）：
//      正文累积（其二抄其一）⇒ 全部窗口 + 按角色判重；当期窗口合并 2 个 5★；起点 10:00；
//      `gacha[]` 逐条；upcoming 分支（空档期取"下一个要开的"）；什么都没有 ⇒ null（未公布）；
//      维护预告**不**被当成卡池（正文没有「跃迁时间为」）。
//   ③ `anchorStartOf` 的三态 × 两款锚点（12 组）；
//   ④ 「起点未知 ≠ 已开始」：无期迷途 11-11 批 / 星铁 4.7 批**不以在期身份出现**
//      （外显 / 近期 / 提醒 / 24 小时计数都不认它们），并给出**反向证明**（旧口径下它们就是"在期"）。
//   ⑤ bwiki 备选仍可用（手动切源能出数据）。
//
// ⚠️ 时间断言一律写**绝对毫秒**（`Date.UTC(...)` 手算，不用 sourceInstant 自证）：
//    这样 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁跑的是同一份期望值。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, assertHoverConvention } from "./harness.mjs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const CMS_URL = "https://api-takumi-static.mihoyo.com/content_v2_user/app/1963de8dc19e461c/getContentList?iPage=1&iPageSize=200&sLangKey=zh-cn&isPreview=0&iChanId=257";
const BWIKI_URL = "https://wiki.biligame.com/sr/api.php?action=parse&page=%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81&prop=text&format=json&formatversion=2";

// 真夹具：2026-11-09 抓的一页 200 条，裁到 4 期「X.Y版本活动跃迁」+ 2 期「版本更新维护预告」
const CMS_BODY = fixtureBody(CMS_URL, { [CMS_URL]: "p4-hsr-cms-list/response.txt" });
const CMS_PAYLOAD = JSON.parse(CMS_BODY);
const BWIKI_BODY = fixtureBody("fixture:p4-hsr-bwiki-warp-1107", { "fixture:p4-hsr-bwiki-warp-1107": "p4-hsr-bwiki-warp-1107/response.txt" });

const P = T.parsers.hsr;
const P_WQMT = T.parsers.wqmt;

const makeStore = (seed) => {
	const m = new Map(Object.entries(seed || {}));
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
// CMS 走宿主代理（`fetchViaProxy`）；bwiki 也要两条出口都能供 body（mkMediaWiki 走 fetchRaw）
const proxyTransport = (getBody) => ({
	async fetchRaw() {
		const t = getBody();
		return { ok: true, status: 200, headers: { get: () => null }, text: async () => t, json: async () => JSON.parse(t) };
	},
	async fetchViaProxy() { return getBody(); }
});

export default async function run() {
	// ───────────────────────── ① 注册项 ─────────────────────────
	section("星铁换官方源 ①：条目与抓取器（默认 = 官方公告 CMS，bwiki 降为备选）");
	{
		const s = T.SOURCES.find((x) => x.id === "hsr");
		check("hsr.url = 官方公告 CMS（iChanId=257，iPageSize=200）",
			!!s && s.url === CMS_URL, s && s.url);
		check("hsr.source = 「官方公告」（设置页下拉的默认项文案）", !!s && s.source === "官方公告", s && s.source);
		const alt = (s && s.altSources && s.altSources[0]) || null;
		check("hsr.altSources[0] = 「Bwiki 历史跃迁」备选（url 为旧 bwiki 地址、fetcher = hsr-bwiki）",
			!!alt && alt.label === "Bwiki 历史跃迁" && alt.url === BWIKI_URL && alt.fetcher === "hsr-bwiki",
			JSON.stringify(alt));
		check("解析逻辑改过 ⇒ parserVersion = 2", !!s && s.parserVersion === 2, String(s && s.parserVersion));
		check("两条抓取器都在，且不是同一个函数（默认 / 备选各走各的解析）",
			typeof T.GACHA_FETCHERS["hsr"] === "function"
			&& typeof T.GACHA_FETCHERS["hsr-bwiki"] === "function"
			&& T.GACHA_FETCHERS["hsr"] !== T.GACHA_FETCHERS["hsr-bwiki"]);
		check("活动侧没动（仍是 bwiki 活动一览）",
			!!s && /wiki\.biligame\.com\/sr\/api\.php/.test(s.eventUrl) && s.eventSource === "Bwiki 活动一览",
			JSON.stringify([s && s.eventUrl, s && s.eventSource]));
	}

	// ───────────────────── ② 官方 CMS 解析（真夹具） ─────────────────────
	section("星铁换官方源 ②：正文累积 + 角色合并 + 10:00 锚点 + upcoming 分支（真夹具 6 条公告）");
	const WINDOWS = P.hsrWarpWindowsOf(CMS_PAYLOAD.data.list, TZ_CN);
	{
		check("夹具里有 6 条公告（4 期跃迁 + 2 期维护预告）", CMS_PAYLOAD.data.list.length === 6,
			String(CMS_PAYLOAD.data.list.length));
		// 5 条窗口 = 4.6其二(真珠/千冶) + 4.6其一(真珠/绯英) + 4.4其二(姬子/刻律德菈)；「真珠」被抄两遍 ⇒ 判重后只留 1 条
		check("窗口去重后 5 条：4.6其二 2 条 + 4.6其一 2 条 + 4.4其二 2 条，其中「真珠」被后一期抄过 ⇒ 只留 1 条",
			WINDOWS.length === 5, JSON.stringify(WINDOWS.map((w) => [w.ver, w.part, w.role])));
		check("「真珠」在窗口里只出现一次（正文累积被 (角色,起点,终点) 判重吃掉）",
			WINDOWS.filter((w) => w.base === "真珠").length === 1,
			JSON.stringify(WINDOWS.map((w) => w.base)));
		check("维护预告**不**产出窗口（正文没有「跃迁时间为」，只靠标题白名单就会误收）",
			WINDOWS.every((w) => !/维护/.test(w.annTitle)), JSON.stringify(WINDOWS.map((w) => w.annTitle)));
		check("卡池名从 ▌/● 行回填（角色 → 卡池名）：真珠 → 沧海萃珠 / 千冶•刃 → 我身即刃",
			WINDOWS.find((w) => w.base === "真珠").pool === "沧海萃珠"
			&& WINDOWS.find((w) => w.base === "千冶•刃").pool === "我身即刃",
			JSON.stringify(WINDOWS.map((w) => [w.base, w.pool])));

		// 当期：2026-11-09 12:00 +08（4.6其二窗口内）
		const NOW = Date.UTC(2026, 10, 9, 4, 0);
		const d = P.parseHsrWarp(CMS_PAYLOAD, NOW, TZ_CN);
		check("当期载荷非空（有覆盖 now 的窗口）", !!d && typeof d === "object");
		check("当期窗口**合并 2 个 5★**（真珠 + 千冶•刃，按起点升序）",
			!!d && d.roles === "真珠（欢愉•冰）、千冶•刃（虚无•火）", d && d.roles);
		check("外显池名 = 结束最早那口池的卡池名「沧海萃珠」角色活动跃迁",
			!!d && d.banner === "「沧海萃珠」角色活动跃迁", d && d.banner);
		check("档期 = 「09-28 10:00 ~ 11-10 15:00」（起点「4.6版本更新后」⇒ 该日 10:00）",
			!!d && d.bannerDates === "09-28 10:00 ~ 11-10 15:00", d && d.bannerDates);
		check("startTs = 2026-09-28 10:00 +08（UTC 02:00）/ endTs = 2026-11-10 15:00 +08（UTC 07:00）",
			!!d && d.startTs === Date.UTC(2026, 8, 28, 2, 0) && d.endTs === Date.UTC(2026, 10, 10, 7, 0),
			JSON.stringify(d && [d.startTs, d.endTs]));
		check("bannerDatesRaw = 源站原文（两端 token 逐字，分隔符统一成 ~）",
			!!d && d.bannerDatesRaw === "2026/09/28 4.6版本更新后 ~ 2026/11/10 15:00",
			d && d.bannerDatesRaw);
		const g = (d && d.gacha) || [];
		check("gacha[] = 3 条（主条 + 2 口池的悬停行）", g.length === 3, JSON.stringify(g.map((x) => x.title)));
		check("gacha[] 逐条标题（池名 / 池名：角色）",
			g.map((x) => x.title).join(" | ") === "「沧海萃珠」角色活动跃迁 | 「沧海萃珠」角色活动跃迁：真珠（欢愉•冰） | 「我身即刃」角色活动跃迁：千冶•刃（虚无•火）",
			g.map((x) => x.title).join(" | "));
		check("gacha[] 的 key / source / tz",
			g.map((x) => x.source).join(",") === "primary,hover,hover"
			&& g.map((x) => x.key).join(",") === "hsr:gacha:0,hsr:gacha:1,hsr:gacha:2"
			&& g.every((x) => x.tz === TZ_CN),
			JSON.stringify(g.map((x) => [x.key, x.source, x.tz])));
		check("悬停 = 2 口池（每口「池名：角色 ⏎ 档期」）",
			!!d && d.bannerHover === "「沧海萃珠」角色活动跃迁：真珠（欢愉•冰）\n09-28 10:00 ~ 11-10 15:00\n"
				+ "「我身即刃」角色活动跃迁：千冶•刃（虚无•火）\n10-21 12:00 ~ 11-10 15:00",
			d && d.bannerHover);
		check("悬停 == hoverTextFromItems(同一份条目事实)（生成器唯一实现）",
			!!d && T.hoverTextFromItems(d.gachaHoverItems, "gacha", TZ_CN) === d.bannerHover);
		assertHoverConvention("星铁官方卡池", d && d.bannerHover, { requireSet: true });

		// upcoming 分支：2026-09-10（4.4 已收池、4.6 还没开）⇒ 取"下一个要开的"那一批
		const GAP = Date.UTC(2026, 8, 10, 4, 0);
		const up = P.parseHsrWarp(CMS_PAYLOAD, GAP, TZ_CN);
		check("空档期（09-10）：upcoming 分支取「下一批」= 4.6 上线那两池（绯英 + 真珠）",
			!!up && up.roles === "绯英（欢愉•物理）、真珠（欢愉•冰）", up && up.roles);
		check("空档期：档期 = 最早收池那口的窗口「09-28 10:00 ~ 10-21 11:59」",
			!!up && up.bannerDates === "09-28 10:00 ~ 10-21 11:59", up && up.bannerDates);
		check("空档期：startTs = 2026-09-28 10:00 +08（预告也有绝对起点 ⇒ 面板能写「还有 N 天」）",
			!!up && up.startTs === Date.UTC(2026, 8, 28, 2, 0), String(up && up.startTs));

		// 全部收池之后（12-01）：没有覆盖、没有下一个 ⇒ null（如实未公布，不硬凑）
		const AFTER = Date.UTC(2026, 11, 1, 4, 0);
		check("全部收池后（12-01）：返回 null（未公布，不硬凑过期档期）",
			P.parseHsrWarp(CMS_PAYLOAD, AFTER, TZ_CN) === null);

		// 结构异常必须抛错（不是"未公布"）
		let err = null;
		try { P.parseHsrWarp({ data: {} }, NOW, TZ_CN); } catch (e) { err = e; }
		check("payload 没有 data.list（接口改版）⇒ 抛 hsr-official-no-section",
			!!err && /hsr-official-no-section/.test(err.message), err && err.message);

		// 起点只有版本标签（合成一条 4.7 公告）：不参与在期判定，但仍作为事实列出
		const OPEN = {
			data: {
				list: [{
					sTitle: "4.7版本活动跃迁（其一）",
					sIntro: "",
					sContent: "<p>限定5星角色「测试角色（欢愉•冰）」跃迁成功概率限时提升，跃迁时间为 4.7版本更新后 - 2026/12/22 15:00。</p>"
				}]
			}
		};
		const op = P.parseHsrWarp(OPEN, Date.UTC(2026, 10, 11, 4, 0), TZ_CN);
		check("起点只有「4.7版本更新后」（无日期）⇒ startTs = null（起点未知，不编 10:00）",
			!!op && op.startTs === null, String(op && op.startTs));
		check("起点未知时档期文本保留源站写法「4.7版本更新后 ~ 12-22 15:00」",
			!!op && op.bannerDates === "4.7版本更新后 ~ 12-22 15:00", op && op.bannerDates);
		check("起点未知的窗口仍进 gacha[]（作为事实列出、startTs 仍是 null，只是不算在期）",
			!!op && (op.gacha || []).length === 1 && op.gacha[0].startTs === null,
			JSON.stringify(op && (op.gacha || []).map((x) => [x.title, x.startTs])));
	}

	// ───────────────────── ③ anchorStartOf（纯函数，12 组） ─────────────────────
	section("「相对起点」锚定 ③：anchorStartOf 三态 × 两款锚点（星铁 10:00 / 无期迷途 14:00）");
	{
		const A = T.anchorStartOf;
		// 态 ①：日期 + 版本标签 → 该日锚点整点
		check("星铁·态①「2026/09/28 4.6版本更新后」+ 锚 10 ⇒ 09-28 10:00 +08（UTC 02:00）",
			A("2026/09/28 4.6版本更新后", 10, TZ_CN) === Date.UTC(2026, 8, 28, 2, 0),
			String(A("2026/09/28 4.6版本更新后", 10, TZ_CN)));
		check("无期迷途·态①「2026-10-27 开服后」+ 锚 14 ⇒ 10-27 14:00 +08（UTC 06:00）",
			A("2026-10-27 开服后", 14, TZ_CN) === Date.UTC(2026, 9, 27, 6, 0),
			String(A("2026-10-27 开服后", 14, TZ_CN)));
		// 态 ②：只有日期（没有版本/开服标签）→ 同样按锚点整点
		check("星铁·态②「2026/09/28」（只有日期）+ 锚 10 ⇒ 09-28 10:00",
			A("2026/09/28", 10, TZ_CN) === Date.UTC(2026, 8, 28, 2, 0), String(A("2026/09/28", 10, TZ_CN)));
		check("无期迷途·态②「10月27日」+ 锚 14 + 年份线索 2026 ⇒ 10-27 14:00",
			A("10月27日", 14, TZ_CN, { y: 2026, mo: 11 }) === Date.UTC(2026, 9, 27, 6, 0),
			String(A("10月27日", 14, TZ_CN, { y: 2026, mo: 11 })));
		// 态 ③：只有版本标签 / 什么都没有 → null（起点未知）
		check("星铁·态③「4.7版本更新后」（无日期）⇒ null（起点未知，绝不猜）",
			A("4.7版本更新后", 10, TZ_CN) === null, String(A("4.7版本更新后", 10, TZ_CN)));
		check("无期迷途·态③「开服后」（连日期都没有）⇒ null",
			A("开服后", 14, TZ_CN, { y: 2026, mo: 11 }) === null, String(A("开服后", 14, TZ_CN, { y: 2026, mo: 11 })));
		check("空文本 ⇒ null", A("", 10, TZ_CN) === null);
		// 已写绝对时刻的文本：原样返回（锚点不覆盖明确时刻）
		check("「2026/10/21 12:00」+ 锚 10 ⇒ 12:00（已有明确时刻时锚点不生效）",
			A("2026/10/21 12:00", 10, TZ_CN) === Date.UTC(2026, 9, 21, 4, 0),
			String(A("2026/10/21 12:00", 10, TZ_CN)));
		// 中文年月日写法
		check("「2026年10月27日 开服后」+ 锚 14 ⇒ 10-27 14:00（`年月日` 也认）",
			A("2026年10月27日 开服后", 14, TZ_CN) === Date.UTC(2026, 9, 27, 6, 0),
			String(A("2026年10月27日 开服后", 14, TZ_CN)));
		// 年份线索跨年（线索 1 月、日期写 12 月 ⇒ 上一年）
		check("「12月28日」+ 线索 2026-01 ⇒ 2025-12-28 10:00（共用 inferYear 的跨年规则）",
			A("12月28日", 10, TZ_CN, { y: 2026, mo: 1 }) === Date.UTC(2025, 11, 28, 2, 0),
			String(A("12月28日", 10, TZ_CN, { y: 2026, mo: 1 })));
		// 时区：锚的是**源站墙钟**，换 tz 只是换成另一个绝对时刻，钟点不变
		check("同一个「2026/09/28 4.6版本更新后」+ 锚 10：tz=UTC 得 10:00Z、tz=+08 得 02:00Z（墙钟都是 10:00）",
			A("2026/09/28 4.6版本更新后", 10, "UTC") === Date.UTC(2026, 8, 28, 10, 0)
			&& A("2026/09/28 4.6版本更新后", 10, TZ_CN) === Date.UTC(2026, 8, 28, 2, 0),
			JSON.stringify([A("2026/09/28 4.6版本更新后", 10, "UTC"), A("2026/09/28 4.6版本更新后", 10, TZ_CN)]));
		// 非法锚点：不猜、不崩
		check("anchorHour 非法（NaN / 24）⇒ null（调用方据此退常量或留 null）",
			A("2026/09/28", NaN, TZ_CN) === null && A("2026/09/28", 24, TZ_CN) === null);
	}

	// ───────────────── ④ 「起点未知 ≠ 已开始」（无期迷途 + 星铁） ─────────────────
	section("起点未知 ≠ 已开始 ④：未来池不以在期身份出现（外显 / 近期 / 提醒 / 24 小时计数）");
	{
		// 无期迷途：真夹具 + 2026-11-09 04:23（10-27 那批在期、11-11 那批未来）
		const NOW_W = Date.parse("2026-11-09T04:23:18+08:00");
		const WQMT_BODY = fixtureBody("fixture:wqmt-bwiki", { "fixture:wqmt-bwiki": "wqmt-bwiki/response.txt" });
		const NEWS_BODY = fixtureBody("fixture:wqmt-news-list", { "fixture:wqmt-news-list": "wqmt-news-list/response.txt" });
		const DETAIL_2099 = fixtureBody("fixture:wqmt-news-2099", { "fixture:wqmt-news-2099": "wqmt-news-2099/response.txt" });
		const wqmtBody = (u) => {
			if (/api\/news\/2099$/.test(u)) return DETAIL_2099;
			if (/api\/news$/.test(u)) return NEWS_BODY;
			return WQMT_BODY;
		};
		// bwiki 走代理、资讯接口走直连 ⇒ 一个 transport 里按 URL 分派
		const splitTransport = {
			async fetchRaw(u) {
				const t = wqmtBody(u);
				return { ok: true, status: 200, headers: { get: () => null }, text: async () => t, json: async () => JSON.parse(t) };
			},
			async fetchViaProxy() { return WQMT_BODY; }
		};
		const eW = createEngine({ transport: splitTransport, storage: makeStore(), now: () => NOW_W, timer: { setTimeout, clearTimeout } });
		const payW = await eW.__test.GACHA_FETCHERS["wqmt"](`https://wiki.biligame.com/wqmt/api.php?action=parse&page=追踪一览`, undefined, TZ_CN);
		const recW = eW.__test.mergeEntryRecord({ data: payW || {} }, null, NOW_W, { id: "wqmt", tz: TZ_CN });
		const gameW = Object.assign({ id: "wqmt", name: "无期迷途", tz: TZ_CN }, recW);
		const cellW = T.scheduleCellOf(gameW, "gacha", new Date(NOW_W));
		check("无期迷途：外显是 10-27 那批（绛夜流光），**不是** 11-11 那批",
			!!cellW && !!cellW.primary && cellW.primary.title.indexOf("绛夜流光") === 0,
			JSON.stringify(cellW && cellW.primary && cellW.primary.title));
		check("无期迷途：11-11 那批（4 口池）不在数组里（它们是未来 ⇒ 不算在期）",
			(recW.gacha || []).every((x) => String(x.title).indexOf("往迹重寻") < 0 && String(x.title).indexOf("隐秘深渊") < 0),
			JSON.stringify((recW.gacha || []).map((x) => x.title)));
		const flatW = T.scheduleFlattenOf([gameW], new Date(NOW_W)).all;
		check("无期迷途：flatten 里没有一条 state=live 的行属于 11-11 批",
			flatW.filter((x) => x.state === "live").every((x) => x.startTs == null || x.startTs <= NOW_W),
			JSON.stringify(flatW.map((x) => [x.title, x.state, x.startTs])));
		check("无期迷途：11-11 那批也不在「近期」候选里（它连数组条目都没有）",
			T.scheduleFlattenOf([gameW], new Date(NOW_W)).all.every((x) => String(x.title).indexOf("往迹重寻") < 0));
		const remW = T.remindItemsOf({ wqmt: gameW }, NOW_W, null);
		check("无期迷途：提醒里没有 11-11 那批的任何一条（start 时刻在未来的不派生提醒）",
			remW.every((x) => String(x.title || "").indexOf("往迹重寻") < 0 && String(x.title || "").indexOf("隐秘深渊") < 0),
			JSON.stringify(remW.map((x) => [x.title, x.kind])));

		// 星铁 4.7 批（bwiki 备选：整页都是「4.7版本更新后」）⇒ 不以在期身份出现
		const NOW_H = Date.parse("2026-11-07T00:00:00.000Z");
		const eH = createEngine({ transport: proxyTransport(() => BWIKI_BODY), storage: makeStore(), now: () => NOW_H, timer: { setTimeout, clearTimeout } });
		const payH = await eH.__test.GACHA_FETCHERS["hsr-bwiki"](BWIKI_URL, undefined, TZ_CN);
		const recH = eH.__test.mergeEntryRecord({ data: payH || {} }, null, NOW_H, { id: "hsr", tz: TZ_CN });
		const gameH = Object.assign({ id: "hsr", name: "崩坏：星穹铁道", tz: TZ_CN }, recH);
		const cellH = T.scheduleCellOf(gameH, "gacha", new Date(NOW_H));
		check("星铁 bwiki 备选：外显 = 唯一两端明确的「我身即刃」（不是 4.7 那两池）",
			!!cellH && !!cellH.primary && cellH.primary.title === "「我身即刃」角色活动跃迁",
			JSON.stringify(cellH && cellH.primary && cellH.primary.title));
		const liveH = (recH.gacha || []).filter((x) => x.startTs != null && x.endTs != null
			&& x.startTs <= NOW_H && x.endTs >= NOW_H);
		check("星铁 bwiki 备选：按「两端明确且在期」筛，只剩 1 条（4.7 两池与沧海萃珠都不算）",
			liveH.length === 1, JSON.stringify(liveH.map((x) => x.title)));
		const flatH = T.scheduleFlattenOf([gameH], new Date(NOW_H)).all;
		check("星铁 bwiki 备选：4.7 两池的 state 是 wait（不是 live），且带「开始时间未知」",
			flatH.filter((x) => String(x.title).indexOf("4.7") >= 0 || String(x.title).indexOf("愚戏众星") === 0
				|| String(x.title).indexOf("铭心之萃") === 0).every((x) => x.state === "wait"),
			JSON.stringify(flatH.map((x) => [x.title, x.state])));
		check("星铁 bwiki 备选：「近期」里没有 4.7 那两池（wait + startTs=null ⇒ 不进 7 天窗口）",
			T.scheduleFlattenOf([gameH], new Date(NOW_H)).all
				.filter((x) => x.state === "wait" && x.startTs != null && x.startTs - NOW_H <= 7 * 864e5)
				.every((x) => String(x.title).indexOf("愚戏众星") < 0 && String(x.title).indexOf("铭心之萃") < 0));

		// ── 反向证明（在测试里就地复现旧口径，证明"这条断言对口径敏感"）──
		// 旧口径：`endTs >= now && (startTs == null || startTs <= now)` —— 把 null 起点当已开始。
		// 旧实现（24-parser-window.js 的 coversNow、81 的 sideViewOf、scheduleItemOf 的 else 分支）
		// 都是这一句；把这几处改回去，下面两条就会红。
		const legacyCoversNow = (x, now) => !!x && x.endTs != null && x.endTs >= now && (x.startTs == null || x.startTs <= now);
		const nullStarts = (recH.gacha || []).filter((x) => x.startTs == null);
		const strictLive = (recH.gacha || []).filter((x) => x.startTs != null && x.startTs <= NOW_H && x.endTs >= NOW_H);
		check("反向证明①：旧口径把这 3 条「起点未知」的行全判成在期（legacyCoversNow = true）",
			nullStarts.length === 3 && nullStarts.every((x) => legacyCoversNow(x, NOW_H)),
			JSON.stringify(nullStarts.map((x) => [x.title, legacyCoversNow(x, NOW_H)])));
		check("反向证明②：旧口径覆盖 4 条 / 新口径只覆盖 1 条 —— 差的正是那 3 条起点未知的行",
			(recH.gacha || []).filter((x) => legacyCoversNow(x, NOW_H)).length === 4 && strictLive.length === 1,
			JSON.stringify([
				(recH.gacha || []).filter((x) => legacyCoversNow(x, NOW_H)).map((x) => x.title),
				strictLive.map((x) => x.title)
			]));
		check("反向证明③（显示层）：这 3 条现在是 state=wait（旧口径会算 live 并给出倒计时）",
			nullStarts.every((x) => {
				const it = T.scheduleItemOf(gameH, "gacha", x, new Date(NOW_H));
				return !!it && it.state === "wait";
			}),
			JSON.stringify(nullStarts.map((x) => {
				const it = T.scheduleItemOf(gameH, "gacha", x, new Date(NOW_H));
				return [x.title, it && it.state];
			})));
	}

	// ───────────────────── ⑤ bwiki 备选仍可用 + 默认抓取器端到端 ─────────────────────
	section("星铁换官方源 ⑤：默认抓取器端到端（经宿主代理）+ bwiki 备选（手动切源）仍能出数据");
	{
		// 默认抓取器：`GACHA_FETCHERS["hsr"](url, signal, tz)` → proxyFetchJson → parseHsrWarp
		const NOW_E2E = Date.UTC(2026, 10, 9, 4, 0);
		const eCms = createEngine({ transport: proxyTransport(() => CMS_BODY), storage: makeStore(), now: () => NOW_E2E, timer: { setTimeout, clearTimeout } });
		const payCms = await eCms.__test.GACHA_FETCHERS["hsr"](CMS_URL, undefined, TZ_CN);
		check("默认抓取器端到端（经代理拿 CMS 列表）：当期载荷齐全（池名 / 2 个 5★ / 档期）",
			!!payCms && payCms.banner === "「沧海萃珠」角色活动跃迁"
			&& payCms.roles === "真珠（欢愉•冰）、千冶•刃（虚无•火）"
			&& payCms.bannerDates === "09-28 10:00 ~ 11-10 15:00",
			JSON.stringify(payCms && [payCms.banner, payCms.roles, payCms.bannerDates]));
		const eAfter = createEngine({ transport: proxyTransport(() => CMS_BODY), storage: makeStore(), now: () => Date.UTC(2026, 11, 1, 4, 0), timer: { setTimeout, clearTimeout } });
		check("默认抓取器端到端：窗口全过期 ⇒ null（未公布，不硬凑；也**不**自动回退 bwiki）",
			await eAfter.__test.GACHA_FETCHERS["hsr"](CMS_URL, undefined, TZ_CN) === null);
		let errCms = null;
		try {
			const eBad = createEngine({
				transport: { async fetchRaw() { throw new Error("no"); }, async fetchViaProxy() { return "{\"retcode\":0,\"data\":{}}"; } },
				storage: makeStore(), now: () => NOW_E2E, timer: { setTimeout, clearTimeout }
			});
			await eBad.__test.GACHA_FETCHERS["hsr"](CMS_URL, undefined, TZ_CN);
		} catch (e) { errCms = e; }
		check("默认抓取器：结构异常（没有 data.list）⇒ 抛 hsr-official-no-section（改版要看得见）",
			!!errCms && /hsr-official-no-section/.test(errCms.message), errCms && errCms.message);

		// 备选：bwiki 历史跃迁
		const NOW_H = Date.parse("2026-11-07T00:00:00.000Z");
		const eH = createEngine({ transport: proxyTransport(() => BWIKI_BODY), storage: makeStore(), now: () => NOW_H, timer: { setTimeout, clearTimeout } });
		const pay = await eH.__test.GACHA_FETCHERS["hsr-bwiki"](BWIKI_URL, undefined, TZ_CN);
		check("备选抓取器：返回对象（banner / 角色 / 档期都在）",
			!!pay && typeof pay === "object" && typeof pay.banner === "string" && typeof pay.bannerDates === "string",
			JSON.stringify(pay && [pay.banner, pay.bannerDates]));
		check("备选抓取器：仍按旧口径解析 bwiki 表（外显「我身即刃」、档期 10-21 12:00 ~ 11-10 15:00）",
			!!pay && pay.banner === "「我身即刃」角色活动跃迁" && pay.bannerDates === "10-21 12:00 ~ 11-10 15:00",
			JSON.stringify(pay && [pay.banner, pay.bannerDates]));
		check("备选抓取器：起点未知的 3 口池仍在悬停里（事实不丢）",
			!!pay && String(pay.bannerHover || "").split("\n").filter((l) => /版本更新后/.test(l)).length === 3,
			JSON.stringify(pay && pay.bannerHover));
	}
}
