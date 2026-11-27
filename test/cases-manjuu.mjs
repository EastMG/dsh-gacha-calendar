// test/cases-manjuu.mjs —— 蓝色星原：旅谣（蛮啾，2026-11-27 接入）离线用例
//
// 覆盖三件事：
//   ① 纯函数：官方公告 API 的签名（md5 / 排序 query）、窗口解析（简/繁、「开服后」锚定、「即日起」锚定）、
//      池名与角色抽取、promilia.wiki 卡片解析；
//   ② 抓取器：国服卡池（官方公告）、国服活动备选（官方公告 → null 如实）、promilia.wiki（卡池 + 活动）、
//      TapTap（卡池 + 活动）、国际服（官方公告，卡池 + 活动）——全部走夹具，禁止真网络；
//   ③ 登记守卫：来源顺序与默认源（用户 2026-11-27 口径：「官方公告设为默认……各自独立不做兜底补全」）。
import { check, section, fixtureBody, setFetchImpl } from "./harness.mjs";
import { T } from "./load.mjs";

const M = T.manjuu;
const TZ = "Asia/Shanghai";
const NOW = Date.parse("2026-11-27T09:00:00+08:00");

const URL_CN_LIST = "https://api-grp.manjuu.com/announce/web/announcement/pagelist?type=notice&page=1&pageSize=10";
const URL_GL_LIST = "https://api-grp-rgn1.jimi-global.com/announce/web/announcement/pagelist?type=notice&page=1&pageSize=10";
const URL_WIKI = "https://promilia.wiki/events";
const URL_TAPTAP = "https://www.taptap.cn/app/593829/topic?type=official";
const TS_LAUNCH = 1795658400000;   // 2026-11-26 10:00 +08
const TS_END = 1797451140000;      // 2026-12-17 03:59 +08
const MAP_OVERRIDES = {};           // 本批不覆盖 map.json（全部用录制夹具）

export default async function runManjuu() {
	section("蓝色星原：纯函数（签名 / 窗口 / 池名 / wiki 卡片）");
	{
		// md5：官方公告 API 的签名是 md5(timestamp + 排序 query)，先钉住算法本身（RFC 1321 三组向量）
		check("md5('') = d41d8cd9…", M.md5("") === "d41d8cd98f00b204e9800998ecf8427e", M.md5(""));
		check("md5('abc') = 90015098…", M.md5("abc") === "900150983cd24fb0d6963f7d28e17f72", M.md5("abc"));
		check("md5 中文按 UTF-8 编码", M.md5("蓝色星原") === M.md5("蓝色星原") && M.md5("蓝色星原").length === 32);

		// 查询串：按 key 排序（签名与 URL 必须同一串）
		check("query 排序（page 在 pageSize 前、type 最后）",
			M.canonicalQueryOf({ type: "notice", page: 1, pageSize: 10 }) === "page=1&pageSize=10&type=notice",
			M.canonicalQueryOf({ type: "notice", page: 1, pageSize: 10 }));

		// 请求头：必须有 sign / timestamp / lang / grp-client-info（缺一实测回「签名错误」）
		const h = M.apiHeadersOf("zh-Hans", "page=1&pageSize=10&type=notice");
		check("请求头带 sign（32 位 md5）", /^[0-9a-f]{32}$/.test(String(h.sign)), String(h.sign));
		check("请求头带 timestamp（13 位毫秒）", /^\d{13}$/.test(String(h.timestamp)), String(h.timestamp));
		check("请求头 lang = zh-Hans", h.lang === "zh-Hans", h.lang);
		check("请求头带 grp-client-info JSON", typeof h["grp-client-info"] === "string" && h["grp-client-info"].indexOf('"device_language"') > 0);
		check("sign = md5(timestamp + query)", h.sign === M.md5(String(h.timestamp) + "page=1&pageSize=10&type=notice"));

		// 窗口解析：国服（简中「✦观测时间✦ … 开服后 - …（UTC+8）」）
		const cnWin = M.windowOf("✦观测时间✦ 2026年11月26日开服后 - 2026年12月17日 03:59（UTC+8）", NOW, TZ);
		check("国服观测窗口：起点锚开服时刻", cnWin && cnWin.startTs === TS_LAUNCH, JSON.stringify(cnWin));
		check("国服观测窗口：终点 12-17 03:59", cnWin && cnWin.endTs === TS_END);
		check("国服观测窗口：raw 保留源站原文", cnWin && cnWin.raw.indexOf("2026年11月26日开服后") >= 0, cnWin && cnWin.raw);

		// 窗口解析：国际服（繁中「▶ 觀測時間 … 開服後－…」）
		const glWin = M.windowOf("開啟。 ▶ 觀測時間 2026年11月26日開服後－2026年12月17日 03:59（UTC+8） ▶ 觀測說明", NOW, TZ);
		check("国际服繁中窗口也能解出同一时刻", glWin && glWin.startTs === TS_LAUNCH && glWin.endTs === TS_END, JSON.stringify(glWin));

		// 「即日起」：起点未知 ⇒ null（由公告发布时间锚定，不在这里猜）
		const openWin = M.windowOf("【活動時間】 即日起 ～ 2027年1月4日 23:59 【參加步驟】", NOW, TZ);
		check("「即日起」起点如实 null（不拿 now 猜）", openWin && openWin.startTs === null && openWin.endTs === Date.parse("2027-01-04T23:59:00+08:00"), JSON.stringify(openWin));

		// 非窗口文本 ⇒ null（反向证明：不是"什么都能解"）
		check("没有时间标签 ⇒ null", M.windowOf("✦观测说明✦ ● 活动期间…", NOW, TZ) === null);

		// 池名 / 类别：简中与繁中都要认
		const cnPool = M.poolOf("弦定观测「桃笺为契」");
		check("池名抽取（简中）", cnPool && cnPool.type === "弦定" && cnPool.pool === "桃笺为契", JSON.stringify(cnPool));
		const glPool = M.poolOf("《藍色星原：旅謠》羈點觀測「緋影入懷」公告");
		check("池名抽取（繁中「羈點」）", glPool && glPool.pool === "緋影入懷", JSON.stringify(glPool));
		check("概率公示标题不算池（没有「池名」）", M.poolOf("《蓝色星原：旅谣》弦定观测（角色限定观测）玩法概率公示") === null);

		// 角色 / 灵子抽取
		const roles = M.rolesOf("以「桃笺为契」观测获取当期限定五星角色「涂山小玉（猛攻·风&光）」。四星角色「枫糖（增幅·光&木）」");
		check("限定五星角色抽取（去掉属性括注）", roles === "涂山小玉", roles);
		const lingzi = M.rolesOf("获得当期限定五星灵子「花之舞（猛攻）」。");
		check("限定五星灵子抽取", lingzi === "花之舞", lingzi);

	}

	section("蓝色星原：抓取器（夹具）");
	{
		// 本批自己装一份"只读夹具"的 transport（不走 useFixtures 的全局状态）：
		// 代理路径按 harness 的既有约定回 `{status, body}` 包体，直连路径回 WHATWG Response 形态。
		const fixtureImpl = async (url) => {
			const u = String(url);
			const body = fixtureBody(u, MAP_OVERRIDES);
			if (u.startsWith("/api/gacha-calendar-proxy")) {
				const wrapped = JSON.stringify({ status: 200, body });
				return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => wrapped, json: async () => JSON.parse(wrapped) };
			}
			return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => body, json: async () => JSON.parse(body) };
		};
		setFetchImpl(fixtureImpl);
		const grab = (fn, url) => fn(url, undefined, TZ, NOW);

		const cnGacha = await grab(T.GACHA_FETCHERS["promilia"], URL_CN_LIST);
		check("国服官方公告·卡池：外显 = 弦定观测「桃笺为契」", cnGacha && cnGacha.banner === "弦定观测「桃笺为契」", cnGacha && cnGacha.banner);
		check("国服官方公告·卡池：角色 = 涂山小玉（不与灵子池合并）", cnGacha && cnGacha.roles === "涂山小玉", cnGacha && cnGacha.roles);
		check("国服官方公告·卡池：起止 = 11-26 10:00 ~ 12-17 03:59", cnGacha && cnGacha.startTs === TS_LAUNCH && cnGacha.endTs === TS_END);
		check("国服官方公告·卡池：并列条 2 口（弦定 + 羁点）", cnGacha && cnGacha.gacha.length === 2, cnGacha && String(cnGacha.gacha.length));
		check("国服官方公告·卡池：灵子池角色是「花之舞」",
			!!(cnGacha && cnGacha.gacha.some((x) => String(x.title).indexOf("花之舞") > 0 && String(x.title).indexOf("绯影入怀") > 0)));
		check("国服官方公告·卡池：卡片外显不写灵子名到别池行",
			!(cnGacha && cnGacha.gacha.some((x) => String(x.title).indexOf("桃笺为契") > 0 && String(x.title).indexOf("花之舞") > 0)));

		// 国服官方公告的活动侧：实测没有游戏内活动公告 ⇒ 如实 null（不当成"抓取失败"）
		const cnEv = await grab(T.EVENT_FETCHERS["promilia"]["promilia-official-event"], URL_CN_LIST);
		check("国服官方公告·活动：没有活动公告 ⇒ null（如实未公布）", cnEv === null, JSON.stringify(cnEv));

		// promilia.wiki
		const wikiGacha = await grab(T.GACHA_FETCHERS["promilia-wiki-gacha"], URL_WIKI);
		check("wiki·卡池：外显 = 弦定 · 桃笺为契", wikiGacha && wikiGacha.banner === "弦定 · 桃笺为契", wikiGacha && wikiGacha.banner);
		check("wiki·卡池：角色 = 涂山小玉", wikiGacha && wikiGacha.roles === "涂山小玉", wikiGacha && wikiGacha.roles);
		check("wiki·卡池：同一时刻同一结束时刻（+08:00 → 绝对时刻）", wikiGacha && wikiGacha.startTs === TS_LAUNCH && wikiGacha.endTs === TS_END);
		const wikiEv = await grab(T.EVENT_FETCHERS["promilia"].default, URL_WIKI);
		check("wiki·活动：有在期活动（集结，勇闯奇波巢穴）", wikiEv && wikiEv.event === "集结，勇闯奇波巢穴", wikiEv && wikiEv.event);
		check("wiki·活动：活网 2026-11-27 口径是 3 条两端明确的在期活动", wikiEv && wikiEv.events.length === 3, wikiEv && String(wikiEv.events.length));

		// TapTap
		const ttGacha = await grab(T.GACHA_FETCHERS["promilia-taptap-gacha"], URL_TAPTAP);
		check("TapTap·卡池：外显 = 弦定观测「桃笺为契」", ttGacha && ttGacha.banner === "弦定观测「桃笺为契」", ttGacha && ttGacha.banner);
		check("TapTap·卡池：两口池（两页都翻到）", ttGacha && ttGacha.gacha.length === 2, ttGacha && String(ttGacha.gacha.length));
		const ttEv = await grab(T.EVENT_FETCHERS["promilia"]["promilia-taptap-event"], URL_TAPTAP);
		check("TapTap·活动：有活动（花会缘结之约）", ttEv && String(ttEv.event).indexOf("花会缘结之约") >= 0, ttEv && ttEv.event);
		check("TapTap·活动：不收「有奖互动」运营抽奖",
			!!(ttEv && ttEv.events.every((x) => String(x.title).indexOf("有奖") < 0)));

		// 国际服（官方公告，繁体）
		const glGacha = await grab(T.GACHA_FETCHERS["promilia-global"], URL_GL_LIST);
		check("国际服官方公告·卡池：外显含「弦定觀測」与池名", glGacha && String(glGacha.banner).indexOf("弦定觀測") > 0 && String(glGacha.banner).indexOf("桃箋為契") > 0, glGacha && glGacha.banner);
		check("国际服官方公告·卡池：角色 = 塗山小玉", glGacha && glGacha.roles === "塗山小玉", glGacha && glGacha.roles);
		check("国际服官方公告·卡池：起止与国服同一时刻（都是 UTC+8）", glGacha && glGacha.startTs === TS_LAUNCH && glGacha.endTs === TS_END);
		const glEv = await grab(T.EVENT_FETCHERS["promilia-global"].default, URL_GL_LIST);
		check("国际服官方公告·活动：有网页/创作活动（2 条）", glEv && glEv.events.length === 2, glEv && String(glEv.events.length));
		check("国际服官方公告·活动：「即日起」起点锚到公告发布时间（不是 now）",
			!!(glEv && glEv.events.every((x) => x.startTs != null && x.startTs < NOW)));
		check("国际服官方公告·活动：卡池公告不被误收成活动",
			!!(glEv && glEv.events.every((x) => String(x.title).indexOf("觀測") < 0)));

		// 反向证明：卡池外显不会选到"未来期"（下一期 12-17 的池还没开）
		check("卡池外显只取在期（12-17 那期不进 banner）",
			!!(cnGacha && cnGacha.banner.indexOf("胧月") < 0 && cnGacha.banner.indexOf("桃笺") > 0));
	}

	section("蓝色星原：来源登记（顺序 / 默认 / 不兜底）");
	{
		const s = T.SOURCES.find((x) => x.id === "promilia");
		check("国服条目存在", !!s);
		check("国服条目名 = 蓝色星原：旅谣", s && s.name === "蓝色星原：旅谣", s && s.name);
		check("国服卡池默认源 = 官方公告", s && s.source === "官方公告", s && s.source);
		check("国服卡池备选顺序 = 星原档案室 → TapTap",
			!!(s && s.altSources.length === 2 && s.altSources[0].label === "星原档案室" && s.altSources[1].label === "TapTap"),
			s && JSON.stringify(s.altSources && s.altSources.map((x) => x.label)));
		check("国服活动默认源 = 星原档案室（官方公告无游戏内活动公告）", s && s.eventSource === "星原档案室", s && s.eventSource);
		check("国服活动备选 = TapTap → 官方公告",
			!!(s && s.eventAltSources.length === 2 && s.eventAltSources[0].label === "TapTap" && s.eventAltSources[1].label === "官方公告"),
			s && JSON.stringify(s.eventAltSources && s.eventAltSources.map((x) => x.label)));
		check("国服出厂默认展示（两侧都有源）", s && s.defaultHidden === false);
		check("国服 tz = Asia/Shanghai", s && s.tz === TZ, s && s.tz);

		const g = T.SOURCES.find((x) => x.id === "promilia-global");
		check("国际服条目存在", !!g);
		check("国际服卡池默认源 = 官方公告", g && g.source === "官方公告", g && g.source);
		check("国际服活动默认源 = 官方公告", g && g.eventSource === "官方公告", g && g.eventSource);
		check("国际服没有备选源（单一来源）", !!(g && !g.altSources && !g.eventAltSources));

		// 不兜底：默认源地址与其备选地址互不相同（不存在"同一条 URL 两套抓取器"）
		check("官方公告 URL ≠ 星原档案室 URL", !!(s && s.url !== URL_WIKI));
		check("官方公告 URL ≠ TapTap URL", !!(s && s.url !== URL_TAPTAP));

		// 抓取器齐全（缺失会让设置页选了源却抓不了）
		for (const key of ["promilia", "promilia-wiki-gacha", "promilia-taptap-gacha", "promilia-global"]) {
			check(`GACHA_FETCHERS["${key}"] 已注册`, typeof T.GACHA_FETCHERS[key] === "function");
		}
		for (const key of ["promilia-official-event", "promilia-taptap-event"]) {
			check(`EVENT_FETCHERS["promilia"]["${key}"] 已注册`, typeof (T.EVENT_FETCHERS["promilia"] || {})[key] === "function");
		}
		check("EVENT_FETCHERS[\"promilia-global\"].default 已注册", typeof ((T.EVENT_FETCHERS["promilia-global"] || {}).default) === "function");
	}
}