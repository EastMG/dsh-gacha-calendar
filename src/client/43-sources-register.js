// src/client/43-sources-register.js —— 新增来源的「条目声明 + 抓取器登记」
//
// 三件事：
//   ① 把 20 条新增来源（17 款游戏）追加进 SOURCES（`NS_SOURCES` 数组 + push）
//   ② 登记主抓取器到 `GACHA_FETCHERS` / `EVENT_FETCHERS`
//   ③ 登记备选源抓取器，并把「米游社公告」挂成既有条目（原神/星铁/绝区零）的备选源 + 新建 `bh3`
//
// 位置说明：本文件排在 `40-fetchers.js` **之后**（ORDER），因为它要往那两张表里登记、往 SOURCES 里追加。
//
// 历史沿革：内容原为生成物 `src/client/45-next-sources.js` 的尾部（由 `next-sources/registry*.js` 生成）。
// 2026-10-03 用户要求「把 next-sources 合并进原 source，不留 next-source」后压平为普通源码，
// `next-sources/` 与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
// （备选源的「键名 → 函数」对照表仍在 `test/registry-shim.mjs`，供测试侧的注册表结构守卫使用。）

		// ===== 追加来源进 SOURCES（对齐原有格式：name=游戏名 / source=中文来源名 / tz）=====

		// 注意：米游社那 4 条（bh3 / *-official）不在此列 —— 它们只作为**备选源**挂在下方。

		const NS_SOURCES = [

			{
				id: "p5x",
				tz: "Asia/Shanghai",
				name: "女神异闻录：夜幕魅影",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/03/1e/f4/031ef49f-b3d0-5bdd-077b-67d213f99c86/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://p5x.wanmei.com/news/gamenews/index.html",
				source: "官网公告",
				eventUrl: "https://p5x.wanmei.com/news/gamenews/index.html",
				eventSource: "官网公告",
			},

			{
				id: "pjsk",
				tz: "Asia/Shanghai",
				name: "初音未来：缤纷舞台·国服",
				icon: "https://p16-sg.dailygn.com/obj/g-marketing-assets-sg/2021_12_15_07_41_24/icon_s54607.png",
				url: "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json",
				// 站点名 + 资源名（对齐本体惯例：`Bwiki 往期祈愿` / `Bwiki 活动一览`）
				// 旧值写的是「第三方数据」——那是**类别**不是站点名，用户 2026-10-03 要求改成网站名称。
				source: "Sekai World 卡池表",
				eventUrl: "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json",
				eventSource: "Sekai World 活动表",
			},

			{
				id: "wuhuamixin",
				tz: "Asia/Shanghai",
				name: "物华弥新",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/13/7f/87/137f873a-f458-678d-347e-068830a74a69/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/whmx/api.php?action=parse&page=限时招集档案&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=613&positionId=2&typeId=4&pageNum=1&pageSize=50",
				eventSource: "官方公告",
			},

			{
				id: "uma-cn",
				tz: "Asia/Shanghai",
				name: "闪耀！优俊少女",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ca/23/bc/ca23bc1f-5dff-c21a-1881-66c48d02f5b2/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				eventSource: "官方公告",
				altSources: [{"label":"Bwiki 简中卡池（社区推算，非官方）","url":"https://wiki.biligame.com/umamusume/api.php?action=parse&page=简中卡池&prop=text&format=json&formatversion=2","fetcher":"uma-cn-bwiki"}],
			},

			{
				id: "zspms",
				tz: "Asia/Shanghai",
				name: "战双帕弥什",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b2/99/ed/b299ed39-90ea-03df-c7ee-bd09548991e5/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				eventSource: "Bwiki",
			},

			{
				id: "czn",
				tz: "Asia/Shanghai",
				name: "卡厄斯梦境",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/e2/c9/48/e2c94812-11cd-2a52-445a-d67d6ae9e169/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://wiki.biligame.com/czn/api.php?action=parse&page=Module%3AGacha%2Fdata&prop=wikitext&format=json",
				source: "Bwiki",
			},

			{
				id: "gf2",
				tz: "Asia/Shanghai",
				name: "少女前线2：追放",
				icon: "https://gf2-cn.cdn.sunborngame.com/website/official_zf/mobile/image/logo.png",
				url: "https://gf2-web-preregister-api.sunborngame.com/website/news_list/4?page=1&limit=10",
				source: "官方公告",
				eventUrl: "https://gf2-web-preregister-api.sunborngame.com/website/news_list/4?page=1&limit=10",
				eventSource: "官方公告",
			},

			{
				id: "bandori",
				tz: "Asia/Shanghai",
				name: "BanG Dream！少女乐团派对·国服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cb/ae/11/cbae1132-58ee-8b5c-3016-dfd2f5e91e51/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=138&positionId=2&typeId=1&pageNum=1&pageSize=20",
				eventSource: "官方公告",
				altSources: [{"label":"Bestdori 扭蛋（社区数据库）","url":"https://bestdori.com/api/gacha/all.5.json","fetcher":"bandori-bestdori-gacha"}],
				eventAltSources: [{"label":"Bestdori 活动（社区数据库）","url":"https://bestdori.com/api/events/all.5.json","fetcher":"bandori-bestdori-event"}],
			},

			{
				id: "ournotes",
				tz: "Asia/Tokyo",
				name: "BanG Dream！OurNotes·日服",
				icon: "https://bang-dream-on.bushimo.jp/wordpress/wp-content/themes/bang-dream-on_prod/assets/images/common/apple-touch-icon-180x180.png",
				defaultHidden: true,
				eventUrl: "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1",
				// 日文站点 → 加语言括号（本体惯例，见 ba-jp 的 `官方公告（日文）`）
				eventSource: "官方公告（日文）",
			},

			{
				id: "fgo",
				tz: "Asia/Shanghai",
				name: "Fate/Grand Order",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/db/d4/19/dbd4196a-68cb-8a74-ca0b-045d0795e10c/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://fgo.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://fgo.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki",
			},

			{
				id: "uma-jp",
				tz: "Asia/Tokyo",
				name: "赛马娘·日服",
				icon: "https://umamusume.jp/apple-touch-icon.png",
				url: "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1",
				// 日文站点 → 加语言括号（本体惯例，见 ba-jp 的 `官方公告（日文）`）
				source: "官方公告（日文）",
				eventUrl: "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1",
				eventSource: "官方公告（日文）",
				altSources: [{"label":"umapyoi（第三方，无卡池名）","url":"https://api.umapyoi.net/api/v1/gacha","fetcher":"uma-jp-umapyoi"}],
				eventAltSources: [{"label":"Bwiki 活动（往期归档）","url":"https://wiki.biligame.com/umamusume/api.php?action=parse&page=活动&prop=text&format=json&formatversion=2","fetcher":"uma-jp-bwiki"}],
			},

			{
				id: "uma-global",
				tz: "UTC",
				name: "赛马娘·国际服",
				icon: "https://play-lh.googleusercontent.com/yN6cCSP7UB_2bsvlCxrtv-FUpEt1IvEFwr0Ucb3wr39QsAd5PLsueSVXuCinDbE4rifhMlX4YNtpLpkGnpsLhCQ=s64-rw",
				url: "https://umamusume.com/api/ajax/pr_info_index?format=json",
				// 英文站点 → 加语言括号（本体惯例，见 ba-jp 的 `官方公告（日文）`）
				source: "官方公告（英文）",
				eventUrl: "https://umamusume.com/api/ajax/pr_info_index?format=json",
				eventSource: "官方公告（英文）",
			},

			{
				id: "ddlezj",
				tz: "+540",
				name: "嘟嘟脸恶作剧",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/64/f0/21/64f02145-182e-857a-133c-8de0151425d9/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				url: "https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=1282&positionId=2&typeId=1&pageNum=1&pageSize=50",
				eventSource: "官方公告",
			},

			{
				id: "kedr",
				tz: "Asia/Shanghai",
				name: "雪松",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b5/8c/b6/b58cb6b2-4be3-0be0-852a-af761afaab06/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				url: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				eventSource: "Bwiki",
				altSources: [{"label":"Bwiki 卡池信息（台架测试占位）","url":"https://wiki.biligame.com/kedrgame/api.php?action=parse&page=卡池信息&prop=text&format=json&formatversion=2","fetcher":"kedr-kaxi"}],
			},

			{
				id: "stellasora",
				tz: "Asia/Shanghai",
				name: "星塔旅人",
				icon: "https://webcnstatic.yostar.net/stellasora/stellasora-cn-official-frontend/main/h5/favicon.png?x-oss-process=image/resize,w_128",
				url: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
				source: "官方公告",
				eventUrl: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
				eventSource: "官方公告",
				eventAltSources: [{"label":"Bwiki 首页活动日历（低可用）","url":"https://wiki.biligame.com/stellasora/api.php?action=parse&page=首页&prop=text&format=json&formatversion=2","fetcher":"stellasora-bwiki"}],
			},

			{
				id: "ournotes-global",
				tz: "Asia/Shanghai",
				name: "BanG Dream！OurNotes·国际服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/ca/da/3a/cada3a9a-491a-fbe5-5494-9be7390e3a9b/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
				defaultHidden: true,
				altSources: [{"label":"官方公告（BHK）","url":"https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw","fetcher":"ournotes-global-gacha"}],
				eventAltSources: [{"label":"官方公告（BHK）","url":"https://l11-web-api.biligames.com/game/news/page?game_base_id=118241&show_position=1&lang=zh-tw","fetcher":"ournotes-global-event"}],
			},

		];

		for (const s of NS_SOURCES) {

			// 同名条目已存在时不要再 push（例如 bandori/fgo 本体已有），改为**就地覆盖**

			const i = SOURCES.findIndex((x) => x.id === s.id);

			if (i >= 0) { Object.assign(SOURCES[i], s); } else { SOURCES.push(s); }

		}

		// ===== 登记抓取器（键 = 条目 id）=====

		Object.assign(GACHA_FETCHERS, {

			"p5x": (url, signal, tz) => ns_p5x_gachaP5x(url, signal, tz),

			"pjsk": (url, signal, tz) => ns_sekai_gachaSekai(url, signal, tz),

			"wuhuamixin": (url, signal, tz) => ns_bwiki_gachaWhmx(url, signal, tz),

			"uma-cn": (url, signal, tz) => ns_biligame_activity_gachaUmaCnOfficial(url, signal, tz),

			"zspms": (url, signal, tz) => ns_bwiki_wikitext_gachaZspms(url, signal, tz),

			"czn": (url, signal, tz) => ns_bwiki_wikitext_gachaCzn(url, signal, tz),

			"gf2": (url, signal, tz) => ns_gf2_gachaGf2(url, signal, tz),

			"bandori": (url, signal, tz) => ns_bandori_gachaBandori(url, signal, tz),

			"fgo": (url, signal, tz) => ns_fgo_gachaFgo(url, signal, tz),

			"uma-jp": (url, signal, tz) => ns_umamusume_official_gachaUmaJpOfficial(url, signal, tz),

			"uma-global": (url, signal, tz) => ns_umamusume_official_gachaUmaGlobal(url, signal, tz),

			"ddlezj": (url, signal, tz) => ns_biligame_announce_gachaDdlezj(url, signal, tz),

			"kedr": (url, signal, tz) => ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz),

			"stellasora": (url, signal, tz) => ns_stellasora_gachaStellasora(url, signal, tz),

		});

		Object.assign(EVENT_FETCHERS, {

			"p5x": { default: (url, signal, tz) => ns_p5x_eventsP5x(url, signal, tz) },

			"pjsk": { default: (url, signal, tz) => ns_sekai_eventsSekai(url, signal, tz) },

			"wuhuamixin": { default: (url, signal, tz) => ns_biligame_activity_eventsWhmxOfficial(url, signal, tz) },

			"uma-cn": { default: (url, signal, tz) => ns_biligame_activity_eventsUmaCnOfficial(url, signal, tz) },

			"zspms": { default: (url, signal, tz) => ns_bwiki_wikitext_eventsZspms(url, signal, tz) },

			"gf2": { default: (url, signal, tz) => ns_gf2_eventsGf2(url, signal, tz) },

			"bandori": { default: (url, signal, tz) => ns_bandori_eventsBandori(url, signal, tz) },

			"ournotes": { default: (url, signal, tz) => ns_ournotes_eventsOurNotes(url, signal, tz) },

			"fgo": { default: (url, signal, tz) => ns_fgo_eventsFgo(url, signal, tz) },

			"uma-jp": { default: (url, signal, tz) => ns_umamusume_official_eventsUmaJpOfficial(url, signal, tz) },

			"uma-global": { default: (url, signal, tz) => ns_umamusume_official_eventsUmaGlobal(url, signal, tz) },

			"ddlezj": { default: (url, signal, tz) => ns_biligame_announce_eventsDdlezj(url, signal, tz) },

			"kedr": { default: (url, signal, tz) => ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz) },

			"stellasora": { default: (url, signal, tz) => ns_stellasora_eventsStellasora(url, signal, tz) },

		});

		// ===== 登记备选源抓取器（键 = altSources/eventAltSources 的 fetcher 字段）=====

		// GACHA_FETCHERS 是**扁平**表 → 卡池备选源注册在顶层即可；

		// EVENT_FETCHERS 是**按条目 id 分组**的表 → 活动备选源必须注册进 EVENT_FETCHERS[<条目id>]。

		Object.assign(GACHA_FETCHERS, {

			"uma-jp-umapyoi": (url, signal, tz) => ns_umapyoi_gachaUmapyoi(url, signal, tz),

			"bandori-bestdori-gacha": (url, signal, tz) => ns_bestdori_gachaBestdori(url, signal, tz),

			"kedr-kaxi": (url, signal, tz) => ns_bwiki_gachaKedr(url, signal, tz),

			"uma-cn-bwiki": (url, signal, tz) => ns_bwiki_gachaUmaCn(url, signal, tz),

			"ournotes-global-gacha": (url, signal, tz) => ns_ournotes_global_gachaOurNotesGlobal(url, signal, tz),

		});

		EVENT_FETCHERS["uma-jp"] = EVENT_FETCHERS["uma-jp"] || {};

		Object.assign(EVENT_FETCHERS["uma-jp"], {

			"uma-jp-bwiki": { default: (url, signal, tz) => ns_bwiki_eventsUmaJp(url, signal, tz) },

		});

		EVENT_FETCHERS["bandori"] = EVENT_FETCHERS["bandori"] || {};

		Object.assign(EVENT_FETCHERS["bandori"], {

			"bandori-bestdori-event": { default: (url, signal, tz) => ns_bestdori_eventsBestdori(url, signal, tz) },

		});

		EVENT_FETCHERS["stellasora"] = EVENT_FETCHERS["stellasora"] || {};

		Object.assign(EVENT_FETCHERS["stellasora"], {

			"stellasora-bwiki": { default: (url, signal, tz) => ns_bwiki_eventsStellasora(url, signal, tz) },

		});

		EVENT_FETCHERS["ournotes-global"] = EVENT_FETCHERS["ournotes-global"] || {};

		Object.assign(EVENT_FETCHERS["ournotes-global"], {

			"ournotes-global-event": { default: (url, signal, tz) => ns_ournotes_global_eventsOurNotesGlobal(url, signal, tz) },

		});

		//#region 米游社公告（挂成**备选源**，不改默认主源）
		// 用户 2026-10-02 明确要求：「米游社来源全部改名米游社公告，且降级备选，恢复原默认来源」。
		// 所以这里**只加备选**：原神/星铁保持 Bwiki，绝区零保持官方公告（api-takumi-static）。
		// 命中规则 `altSourceId = (alt) => alt.url` 与当前 url 字符串相等；下面是各游戏**专属 gids URL**，不会串。

		{

			const e = SOURCES.find((s) => s.id === "genshin");

			if (!e) { console.warn("[next-sources] 找不到既有条目 genshin，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=2&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=2&type=2&page_size=20";

				GACHA_FETCHERS["genshin-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["genshin"], { "genshin-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "genshin-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "genshin-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "genshin-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "genshin-miyoushe" }];

			}

		}

		{

			const e = SOURCES.find((s) => s.id === "hsr");

			if (!e) { console.warn("[next-sources] 找不到既有条目 hsr，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=6&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=6&type=2&page_size=20";

				GACHA_FETCHERS["hsr-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["hsr"], { "hsr-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "hsr-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "hsr-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "hsr-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "hsr-miyoushe" }];

			}

		}

		{

			const e = SOURCES.find((s) => s.id === "zzz");

			if (!e) { console.warn("[next-sources] 找不到既有条目 zzz，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=8&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=8&type=2&page_size=20";

				GACHA_FETCHERS["zzz-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["zzz"], { "zzz-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "zzz-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "zzz-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "zzz-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "zzz-miyoushe" }];

			}

		}

		// 崩坏3：插件本体此前无来源 → 新建条目且**默认未配置**（用户要求）。

		// 未配置的语义（50-refresh.js）：`if (!source.url && !source.eventUrl) return { ok:true, reason:"skipped" }`

		// → 不抓取、不计成功也不计失败；UI 显示「未配置（不抓取卡池/活动）」。设置页选「米游社公告」即可启用。

		if (!SOURCES.some((s) => s.id === "bh3")) {

			const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=1&page_size=20";

			const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=2&page_size=20";

			GACHA_FETCHERS["bh3-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

			EVENT_FETCHERS["bh3"] = { default: null, "bh3-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } };

			SOURCES.push({

				id: "bh3",

				tz: "Asia/Shanghai",

				name: "崩坏3",

				icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f4/BH3_icon.png!/fw/64",

				// 出厂默认不勾选展示（用户要求）：默认未配置时面板恒空，不该占版面

				defaultHidden: true,

				// 默认**未配置**：不给 url / eventUrl

				source: "",

				eventSource: "",

				altSources: [{ label: "米游社公告", url: G, fetcher: "bh3-miyoushe" }],

				eventAltSources: [{ label: "米游社公告", url: E, fetcher: "bh3-miyoushe" }]

			});

		}

		//#endregion

		//#endregion
