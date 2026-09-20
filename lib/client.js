window.__ModuleLoader__.load({
	id: "dsh-gacha-calendar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		//#region config
		const NS = "gacha-calendar";
		// 刷新频率选项：按天（存分钟），与 host 端 Config.refreshMinutes 对应
		const REFRESH_OPTIONS = [
			{ label: "1 天", minutes: 1 * 24 * 60 },
			{ label: "5 天", minutes: 5 * 24 * 60 },
			{ label: "7 天", minutes: 7 * 24 * 60 },
			{ label: "15 天", minutes: 15 * 24 * 60 },
			{ label: "24 天", minutes: 24 * 24 * 60 },
			{ label: "30 天", minutes: 30 * 24 * 60 },
			{ label: "42 天", minutes: 42 * 24 * 60 }
		];
		const DEFAULT_SETTINGS = {
			autoRefresh: true,
			refreshMinutes: 1 * 24 * 60,
			order: null,
			lastRefresh: 0,
			lastSource: "none",
			// 最近一次联网抓取的解析结果（JSON：{ [gameId]: {banner,bannerDates,roles,event,eventDates} }）
			lastData: "",
			// 不展示的条目 id 列表（设置页开关）
			hidden: [],
			// 已删除的条目 id 列表（内置条目删除后记录，避免下次加载复活）
			removed: [],
			// 自定义爬取地址（JSON：{ [gameId]: "url" }，覆盖内置 url；空串 = 用默认）
			customUrls: "{}",
			// 自定义活动来源地址（JSON：{ [gameId]: "url" }，覆盖内置 eventUrl）
			customEventUrls: "{}",
			// 自定义条目（JSON 数组，字段与 SOURCES 一致）
			customEntries: "[]"
		};
		//#endregion

		//#region core env（环境注入缝 —— core 零宿主依赖的唯一入口）
		// core（配置 / 来源 / 解析器 / 抓取器 / 刷新 / helpers）里**不允许**直接碰宿主：
		// 不写 window / document / Node API，也不直接 fetch、不直接读时钟。
		// 所有"联网、取当前时间、计时器"一律经过本文件里的 coreEnv，由外壳注入实现：
		//   DSH 插件  → 92-dsh-env.js（transport 走宿主代理 /api/gacha-calendar-proxy）
		//   浏览器扩展 → background 消息转发
		//   Windows / Android / iOS / 鸿蒙 → 各平台原生 HTTP
		// 2b 之后 coreEnv 由 createEngine({ transport, storage, now }) 注入；当前由外壳在加载时 setCoreEnv()。
		let coreEnv = {
			transport: null,
			now: () => Date.now(),
			timer: {
				setTimeout: (fn, ms) => setTimeout(fn, ms),
				clearTimeout: (id) => clearTimeout(id)
			}
		};

		// 外壳注入（可只注入一部分，其余保持默认）
		function setCoreEnv(next) {
			if (!next) return;
			coreEnv = {
				...coreEnv,
				...next,
				timer: { ...coreEnv.timer, ...(next.timer || {}) }
			};
		}

		// 取当前时间（毫秒）。core 里判断"哪一期覆盖当前"必须用这个，不许直接 Date.now()，
		// 这样各平台能注入自己的时钟、也能在测试里固定时间。
		function nowMs() {
			return coreEnv.now();
		}

		function requireTransport() {
			if (!coreEnv.transport) throw new Error("core transport 未注入");
			return coreEnv.transport;
		}

		// 直连抓取（不需要代理的源：bwiki / PRTS 等 CORS 放行的站，调用方自行加 origin=* 等参数）。
		// 返回 WHATWG Response 形态的对象（有 ok / status / headers / text() / json()），
		// 各平台据此包装自己的 HTTP 实现即可，调用点无需改动。
		function transportFetchRaw(url, opts) {
			return requireTransport().fetchRaw(url, opts);
		}

		// 经代理抓取文本（需要绕过 CORS / Referer 反爬的源）。语义与原 host 代理调用完全一致：
		// referer / headers（可选对象）/ body（可选，提供时以 POST + JSON 发出）→ 原始 body 字符串
		async function proxyFetchText(proxyUrl, referer, extraHeaders, body) {
			return requireTransport().fetchViaProxy(proxyUrl, { referer, headers: extraHeaders, body });
		}

		// 经代理抓取 JSON。解析失败统一抛 "bad-json"（normErr 会显示成"响应格式异常"），
		// 而不是把原生 SyntaxError 漏出去（那会被归成泛化的"抓取异常"）
		async function proxyFetchJson(proxyUrl, referer, extraHeaders, body) {
			const text = await proxyFetchText(proxyUrl, referer, extraHeaders, body);
			try {
				return JSON.parse(text);
			} catch {
				throw new Error("bad-json");
			}
		}
		//#endregion

		//#region data sources
		// 数据源声明：不含任何内置快照数据（无联网抓取时对应列显示为空）。
		// 卡池来源（url/altSources）与活动来源（eventUrl/eventAltSources）完全独立、各自单独选择；
		// 默认活动源与卡池源相同时（ba-*/r1999 的公告同时含卡池与活动），仍作为独立来源存在，
		// 抓取时同 URL 单次请求复用，换用其他来源时独立抓取。
		// 明日方舟来源地址：默认=官方公告 CMS（web-news.hypergryph.com）；PRTS 卡池一览为备选（mediawiki，浏览器直连）
		const AK_OFFICIAL_BULLETIN = "https://web-news.hypergryph.com/api/bulletin";
		const ARKNIGHTS_OFFICIAL_LIST_URL = AK_OFFICIAL_BULLETIN + "?lang=zh-cn&code=arknights&page=1&pageSize=30";
		const ARKNIGHTS_PRTS_URL = "https://prts.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2";
		// 鸣潮官方公告（aki-gm-resources-back）：entrypoint.json → 目录（含 hash）→ <dir>/zh-Hans.json 全量公告，
		// 其中 recommend 组含逐期「角色/武器活动唤取」公告，正文带 ✦活动时间✦ 起止
		const WUWA_NOTICE_ENTRY = "https://aki-gm-resources-back.aki-game.com/gamenotice/G152/76402e5b20be2c39f095a152090afddc/entrypoint.json";
		const WUWA_BWIKI_URL = "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E8%A7%92%E8%89%B2%E8%BD%AE%E6%8D%A2%E6%B1%A0&prop=text&format=json&formatversion=2";
		// 绝区零官网公告（api-takumi-static content_v2_user，经 host 代理；无 CORS、无需登录）：
		// iChanId=279（公告频道）返回逐条公告正文（sIntro/sContent），其中「X.Y版本限时频段（上/下期）」
		// 含该期精确起止 + 限定 S 级代理人/音擎；起点写「版本更新后」时取同版本「更新公告」的 dtStartTime。
		const ZZZ_NEWS_LIST_URL = "https://api-takumi-static.mihoyo.com/content_v2_user/app/706fd13a87294881/getContentList?iChanId=279&iPageSize=50&iPage=1&sLangKey=zh-cn";
		const ZZZ_BWIKI_URL = "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E8%B0%83%E9%A2%91&prop=text&format=json&formatversion=2";
		// 蔚蓝档案·日服 官网新闻接口（api-web.bluearchive.jp，经 host 代理；无 CORS、无需登录）：
		// 返回 {data:{rows:[{id,title(お知らせ/イベント/メンテナンス),summary,content,publishTime}],count}}，
		// 「ピックアップ募集紹介」条目内含逐池「ピックアップ名／ピックアップ生徒／実施期間」。
		const BA_JP_NEWS_URL = "https://api-web.bluearchive.jp/api/news/list?pageIndex=1&pageNum=30";
		// 重返未来1999：默认=官方**游戏内公告**接口（noticecp），它有官网 CMS 不发布的逐期「征集时间」
		// （正文「X.X「…」版本活动一览」按段落给出【征集时间】起止与 UP 角色）；
		// 备选=官网新闻 API（只有维护时间与活动名，无逐期征集时间）。
		const R1999_NOTICE_URL = "https://notice.sl916.com/noticecp/client/query?gameId=50001&channelId=100&subChannelId=1009&serverType=4";
		const R1999_OFFICIAL_URL = "https://re.bluepoch.com/activity/official/websites/information/query";
		const SOURCES = [
			{
				id: "genshin",
				// parserVersion：该条目「解析逻辑」的版本号 —— 源站改版/规则更新后 +1。
				// 用途：无服务端分发时定位「坏了的是哪个版本的用户、哪个源」（见交接文档 §13.4）。
				parserVersion: 1,
				name: "原神",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/b/b0/%E5%8E%9F%E7%A5%9E%E5%9B%BE%E6%A0%87.png!/fw/64",
				source: "Bwiki \u5F80\u671F\u7948\u613F",
				url: "https://wiki.biligame.com/ys/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E7%A5%88%E6%84%BF&prop=text&format=json&formatversion=2",
				// 独立活动源：原神活动一览为 JS 动态加载（Dquery+SMW），经 SMW ask 查询开始/结束时间
				eventUrl: "https://wiki.biligame.com/ys/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B4%BB%E5%8A%A8%5D%5D&format=json",
				eventSource: "Bwiki \u6D3B\u52A8\u4E00\u89C8"
			},
			{
				id: "hsr",
				parserVersion: 1,
				name: "崩坏：星穹铁道",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/38/HonkaiStarRailIcon_StartingVer3.6_CHN.png!/fw/64",
				source: "Bwiki \u5386\u53F2\u8DC3\u8FC1",
				url: "https://wiki.biligame.com/sr/api.php?action=parse&page=%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81&prop=text&format=json&formatversion=2",
				// 独立活动源：星铁活动一览（api.php 带 origin=* 可浏览器直连；「活动时间」表含当期活动）
				eventUrl: "https://wiki.biligame.com/sr/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki \u6D3B\u52A8\u4E00\u89C8"
			},
			{
				id: "zzz",
				parserVersion: 2,
				name: "绝区零",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/3e/ZZZ_miYoYo_logo.jpg!/fw/64",
				source: "官方公告",
				// 默认卡池源=官网公告（api-takumi-static content_v2_user，经 host 代理，无 CORS、无需登录）：
				// 「X.Y版本限时频段（上/下期）」公告含该期精确起止与限定 S 级代理人/音擎；
				// 无当期频段公告或抓取失败时由抓取器自动回退 Bwiki 往期调频；也可在设置中手动切 Bwiki（备选）
				url: ZZZ_NEWS_LIST_URL,
				altSources: [
					{ label: "Bwiki 往期调频", url: ZZZ_BWIKI_URL, fetcher: "zzz-bwiki" }
				],
				// 独立活动源：官方公告（api-takumi-static，与卡池侧同一接口，经 host 代理）。
				// 「…活动说明」公告正文自带【活动时间】起止（含"X.Y版本更新后/版本结束"折算），
				// 官方口径最及时；Bwiki 活动一览作为备选（编辑滞后时反而无当期内容）。
				eventUrl: ZZZ_NEWS_LIST_URL,
				eventSource: "官方公告",
				eventAltSources: [
					{
						label: "Bwiki 活动一览",
						url: "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
						fetcher: "zzz-event-bwiki"
					}
				]
			},
			{
				id: "wuwa",
				parserVersion: 1,
				name: "鸣潮",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/29/WutheringWavesIcon.png!/fw/64",
				source: "官方公告",
				// 默认卡池源=官方公告（aki-gm-resources-back，经 host 代理）：逐期「角色/武器活动唤取」公告含起止时间；
				// 无当期公告或抓取失败时由抓取器自动回退 Bwiki 角色轮换池；也可在设置中手动切 Bwiki（备选）
				url: WUWA_NOTICE_ENTRY,
				altSources: [
					{ label: "Bwiki 角色轮换池", url: WUWA_BWIKI_URL, fetcher: "wuwa-bwiki" }
				],
				// 独立活动源：鸣潮活动日历页（与卡池源不同）
				eventUrl: "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E6%B4%BB%E5%8A%A8%E6%97%A5%E5%8E%86&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki 活动日历"
			},
			{
				id: "arknights",
				parserVersion: 1,
				name: "明日方舟",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/4/41/ArknightsAppIcon.png!/fw/64",
				source: "官方公告+PRTS",
				// 默认卡池源=官方公告 CMS（经 host 代理）：官方只对限时/联动类寻访发公告，
				// 无当期寻访公告（常规轮换周）时由抓取器自动回退 PRTS；也可在设置中手动切 PRTS 卡池一览（备选）
				url: ARKNIGHTS_OFFICIAL_LIST_URL,
				altSources: [
					{ label: "PRTS 卡池一览", url: ARKNIGHTS_PRTS_URL, fetcher: "arknights-prts" }
				],
				// 独立活动源：PRTS 活动一览（「活动开始时间」表 + data-time 起止时间戳）
				eventUrl: "https://prts.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "PRTS \u6D3B\u52A8\u4E00\u89C8"
			},
			{
				id: "endfield",
				parserVersion: 2,
				name: "明日方舟：终末地",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f1/ArknightsEndfieldAppIcon.png!/fw/64",
				source: "Canmoe",
				// 经 host 代理抓取（canmoe 无 CORS 头，浏览器直连会被拦截）；
				// 数据在 Next.js 组件 chunk 的 JS 里，需先抓页面定位 chunk 再抓 chunk 解析
				url: "https://end.canmoe.com/zh-CN/banner-calendar",
				// 卡池备选来源（设置页下拉可切换；GachaTracker 浏览器直连，wiki.gg 经 host 代理）
				altSources: [
					{
						label: "GachaTracker\uff08\u82F1\u6587\uff09",
						url: "https://gachatracker.app/games/endfield/banners/",
						fetcher: "endfield-gachatracker"
					},
					{
						label: "wiki.gg\uff08\u82F1\u6587\uff09",
						// wiki.gg 校验 Referer：抓取器内部经 host 代理（代理默认 Referer=目标 origin 满足要求）
						url: "https://endfield.wiki.gg/api.php?action=parse&page=Headhunting%2FBanners&prop=text&format=json&formatversion=2",
						fetcher: "endfield-wiki-gg"
					}
				],
				// 独立活动源：FZ Wiki（中文社区维护，经 host 代理抓 RSC 数据；当期并行活动选结束最晚）
				eventUrl: "https://fz.wiki/wiki/%E6%B4%BB%E5%8A%A8",
				eventSource: "FZ Wiki",
				// 活动备选来源：Game8（英文，经 host 代理）
				eventAltSources: [
					{ label: "Game8\uff08\u82F1\u6587\uff09", url: "https://game8.co/games/Arknights-Endfield/archives/535443", fetcher: "endfield-game8" }
				]
			},
			{
				id: "ba-cn",
				parserVersion: 1,
				name: "蔚蓝档案·国服",
				icon: "https://webcnstatic.yostar.net/ba_cn_web/prod/web/favicon.png?x-oss-process=image/resize,w_64",
				source: "\u5B98\u7F51\u516C\u544A",
				// 经 host 代理 POST 抓取（官网 CORS=null + 动态 SPA）；维护说明同时含当期卡池与活动
				url: "https://bluearchive-cn.com/api/news/list?pageIndex=1&pageNum=30&type=",
				// 活动默认源与卡池源相同（同一公告解析活动名），可独立切换
				eventUrl: "https://bluearchive-cn.com/api/news/list?pageIndex=1&pageNum=30&type=",
				eventSource: "\u5B98\u7F51\u516C\u544A"
			},
			{
				id: "ba-global",
				parserVersion: 1,
				name: "蔚蓝档案·国际服",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/25/AppIcon_Arona.png!/fw/64",
				source: "Nexon \u66F4\u65B0\u65E5\u8A8C",
				// 经 host 代理抓取（nexon CORS 只允许同源）；「更新日誌」board(3352) 同时含当期卡池与活动排期
				url: "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB",
				// 卡池备选：GameKee（中文标题含排期；默认仍是 Nexon 官方更新日誌）
				altSources: [
					{ label: "GameKee \u5F53\u671F\u5361\u6C60", id: "ba-global:gamekee", fetcher: "ba-global-gamekee" }
				],
				// 活动默认源与卡池源相同（更新日誌解析活动排期），可独立切换（如 GameKee）
				eventUrl: "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB",
				eventSource: "Nexon \u66F4\u65B0\u65E5\u8A8C",
				// 活动备选来源
				eventAltSources: [
					{ label: "GameKee \u5F53\u671F\u6D3B\u52A8", id: "ba-global:gamekee", fetcher: "ba-global-gamekee" }
				]
			},
			{
				id: "ba-jp",
				parserVersion: 1,
				name: "蔚蓝档案·日服",
				icon: "https://play-lh.googleusercontent.com/H975s6W1-boCSogzpF5_rIyawbjiXfG842ncgjIRiVGzhXHFTCVut0DkBhlDR4CgN1nn98OOC1fWN-LE7kUHnQ=s64",
				source: "官方公告（日文）",
				// 日服官网新闻接口（api-web.bluearchive.jp，经 host 代理）：「ピックアップ募集紹介」公告
				// 内含逐池「ピックアップ名／ピックアップ生徒」与「実施期間」，可直接得到日文官方池名与 UP 生徒
				url: BA_JP_NEWS_URL,
				// 卡池备选：GameKee 当期卡池（原标题解析，只有池名+档期、无角色名）
				altSources: [
					{ label: "GameKee 当期卡池", id: "ba-jp:gamekee", fetcher: "ba-jp-gamekee" }
				],
				// 活动源与卡池源保持独立（解耦）：默认仍是原「GameKee 当期活动」条目；
				// 官方公告的イベント条目作为**可选备选**（备选 value 用其接口地址，抓取器 ba-jp-official）
				eventUrl: "https://www.gamekee.com/ba/huodong/15",
				eventSource: "GameKee 当期活动",
				eventAltSources: [
					{ label: "官方公告（日文）", url: BA_JP_NEWS_URL, fetcher: "ba-jp-official" }
				]
			},
			{
				id: "r1999",
				parserVersion: 2,
				name: "重返未来：1999",
				icon: "https://play-lh.googleusercontent.com/LwcueZMBbLq6aELtqJVn61ToKkJUgxEO8O4KgK_5052hfYoDAglQJIzqSu8srUJeaOZwv36Qi5YKtsXZjo-JPg=s64",
				source: "\u5B98\u65B9\u6E38\u620F\u5185\u516C\u544A",
				// 经 host 代理 GET 抓取（官方游戏内公告接口）。逐期「征集时间」只在这里发布：
				// 「版本活动一览」公告正文按段落给出【征集时间】起止 + 【征集说明】里的 6★/5★ UP 角色，
				// 以及各活动的【活动时间】；一个版本上下半场两期都列在同一篇里（下期常提前公布）。
				// 接口不可用/结构变了 → 自动回退官网维护公告解析（旧行为，无逐期时间）；也可在设置里手动切备选源
				url: R1999_NOTICE_URL,
				altSources: [
					{ label: "\u5B98\u7F51\u7EF4\u62A4\u516C\u544A", url: R1999_OFFICIAL_URL, fetcher: "r1999-official" }
				],
				// 活动源与卡池源同址（同一篇「版本活动一览」同时含征集与活动），仍作为独立来源存在
				eventUrl: R1999_NOTICE_URL,
				eventSource: "\u5B98\u65B9\u6E38\u620F\u5185\u516C\u544A",
				eventAltSources: [
					{ label: "\u5B98\u7F51\u7EF4\u62A4\u516C\u544A", url: R1999_OFFICIAL_URL, fetcher: "r1999-official" }
				]
			},
			{
				id: "nte",
				parserVersion: 2,
				name: "异环",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/8/8c/YH_APP.png!/fw/64",
				source: "官网公告",
				// 经 host 代理抓取（wanmei 跨域无 CORS）；官方公告（服务端渲染）含当期限定棋盘卡池 + 限时活动起止
				url: "https://yh.wanmei.com/news/gamebroad/",
				// 活动源同官网公告（同一公告同时含卡池与活动）
				eventUrl: "https://yh.wanmei.com/news/gamebroad/",
				eventSource: "官网公告",
				// 备选：LDSHOP（静态表格，经 host 代理）
				altSources: [
					{ label: "LDSHOP", url: "https://www.ldshop.gg/tw/blog/nte/neverness-to-everness-banner.html", fetcher: "nte-ldshop" }
				]
			}
		];
		//#endregion

		//#region scrape parsers
		// 纯函数解析器：同一 HTML 输入必然产生同一输出（确定性），
		// 保证网页内容未变时手动刷新结果保持一致。
		function stripTags(s) {
			return (s || "")
				.replace(/<br\s*\/?>/gi, " ")
				.replace(/<[^>]+>/g, "")
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#91;/g, "[")
				.replace(/&#93;/g, "]")
				.replace(/&#39;/g, "'")
				.replace(/&#8211;/g, "\u2013")
				.replace(/&#160;/g, " ")
				.replace(/&nbsp;/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}

		// 解析单个时间 → {ts, text}；无法解析返回 {ts:null, text:null}
		function parseTime(s) {
			const m = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
			if (!m) return { ts: null, text: null };
			const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
			const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			return { ts: new Date(y, mo - 1, d, h, mi).getTime(), text };
		}

		// 时间段 → startTs/endTs + 统一文本 mm-dd hh:mm ~ mm-dd hh:mm（无法解析的一侧保留原文）
		function parseRange(raw) {
			const t = stripTags(raw);
			const parts = t.split(/~/).map((x) => x.trim());
			if (parts.length < 2) {
				const p = parseTime(parts[0]);
				return { startTs: p.ts, endTs: null, startText: p.text, endText: null, raw: p.text ?? t };
			}
			const a = parseTime(parts[0]);
			const b = parseTime(parts[1]);
			return {
				startTs: a.ts, endTs: b.ts,
				startText: a.text ?? parts[0], endText: b.text ?? parts[1],
				raw: `${a.text ?? parts[0]} ~ ${b.text ?? parts[1]}`
			};
		}

		// 角色名清理：去首尾方括号/空白（zzz 的 [希格莉德（强攻·冰）]）
		function cleanRoles(roles) {
			const r = stripTags(roles).replace(/^[\[【\s]+|[\]】\s]+$/g, "");
			return r;
		}

		// 主池过滤：排除武器/光锥/音擎/回响/重映等副池
		function isMainBanner(banner) {
			if (!banner) return false;
			if (/武器|光锥|音擎|回响|重映|神铸赋形|流光定影|溯回忆象/.test(banner)) return false;
			return /角色活动祈愿|角色活动跃迁|独家频段|寻访|频段/.test(banner) || banner.includes("「");
		}

		// bwiki 通用：解析所有含「时间+版本」的卡池表（原神/星铁/绝区零）
		function parseAllBwiki(html) {
			const out = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>\s*时间\s*<\/th>/i.test(body)) continue;
				if (!/<th[^>]*>\s*版本\s*<\/th>/i.test(body)) continue;
				let banner = "";
				const tc = body.match(/<th[^>]*colspan\s*=\s*"?2"?[^>]*>([\s\S]*?)<\/th>/i);
				if (tc) {
					const alt = tc[1].match(/<img[^>]*alt\s*=\s*"([^"]*)"/i);
					banner = alt ? alt[1] : stripTags(tc[1]);
				}
				if (!banner) {
					const t2 = body.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
					if (t2) banner = stripTags(t2[1]);
				}
				const timeM = body.match(/<th[^>]*>\s*时间\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				const charM = body.match(/<th[^>]*>\s*(?:5星角色|S级代理人|6星干员|5星干员)\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				if (!timeM) continue;
				const range = parseRange(timeM[1]);
				out.push({
					banner,
					roles: charM ? stripTags(charM[1]) : "",
					...range,
					isMain: isMainBanner(banner)
				});
			}
			return out;
		}

		// 方舟：解析「干员轮换卡池」（标准寻访/当期轮换池）所有数据行。
		// 该表行结构：序号 | 寻访页面(title=寻访模拟/干员轮换卡池N) | 开启时间 | 特定干员(6星) | 特定干员(5星)。
		// 兼容历史「限时寻访」表（寻访页面|开启时间|特定干员6星|特定干员5星&4星）作为兜底。
		function parseArknights(html) {
			const out = [];
			// 标准（干员轮换卡池）+ 中坚（中坚甄选）：行内 title="寻访模拟/干员轮换卡池N" 或 "寻访模拟/中坚甄选N"
			for (const rm of html.matchAll(/<tr(?:[^>]*)>([\s\S]*?)<\/tr>/g)) {
				const row = rm[1];
				const tier = /干员轮换卡池/.test(row) ? ("标准") : (/中坚甄选/.test(row) ? "中坚" : null);
				if (!tier) continue;
				const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
				if (tds.length < 3) continue;
				const titleM = (tds[1] || "").match(/title="([^"]*)"/);
				if (!titleM) continue;
				const banner = String(titleM[1]).replace(/^寻访模拟\//, ""); // 干员轮换卡池192 / 中坚甄选14
				const roles = [...((tds[3] || "") + (tds[4] || "")).matchAll(/<a[^>]*title="([^"]+)"/g)]
					.map((m) => m[1]).filter(Boolean);
				const range = parseRange(tds[2]);
				out.push({ tier, banner, roles: roles.join("、"), ...range, isMain: true });
			}
			// 限时（联合行动/限定）：解析「限时寻访」表
			const i = html.indexOf("限时寻访");
			if (i >= 0) {
				const seg = html.slice(i);
				const tableM = seg.match(/<table[^>]*>([\s\S]*?)<\/table>/);
				if (tableM) {
					const body = tableM[1];
					for (const rm of body.matchAll(/<tr>([\s\S]*?<td[\s\S]*?)<\/tr>/g)) {
						const row = rm[1];
						const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
						if (tds.length < 2) continue;
						const banner = stripTags(tds[0]);
						if (!banner) continue;
						const roles = tds.length > 2
							? [...tds[2].matchAll(/<a[^>]*href="\/w\/[^"]*"[^>]*title="([^"]*)"/g)]
								.map((m) => m[1].trim()).filter(Boolean).join("、")
							: "";
						const range = parseRange(tds[1]);
						out.push({ tier: "限时", banner, roles, ...range, isMain: true });
					}
				}
			}
			return out;
		}

		// 明日方舟当期卡池：外显按 限时 > 标准 > 中坚 优先级选一个；悬停 bannerHover 列出三种。
		function selectArknights(html, now = nowMs()) {
			const items = parseArknights(html);
			fillMissingStarts(items);
			const tiers = ["限时", "标准", "中坚"];
			const curByTier = {};
			for (const t of tiers) {
				curByTier[t] = items.filter((it) => it.tier === t && it.startTs != null && it.startTs <= now && it.endTs != null && it.endTs >= now);
			}
			let winner = null;
			for (const t of tiers) {
				if (curByTier[t].length > 0) { winner = curByTier[t][0]; break; }
			}
			if (!winner) return null;
			const lines = tiers.map((t) => {
				const arr = curByTier[t];
				if (arr.length === 0) return `${t}：（无）`;
				const it = arr.slice().sort((a, b) => b.startTs - a.startTs)[0];
				return `${t}：${it.banner}${it.roles ? `\uFF1A${it.roles}` : ""}\n${it.rawOriginal || it.raw}`;
			});
			return {
				banner: winner.banner,
				roles: winner.roles,
				bannerDates: winner.raw,
				bannerDatesRaw: winner.rawOriginal || winner.raw,
				bannerHover: lines.join("\n")
			};
		}

		// ---- 明日方舟官方公告（web-news.hypergryph.com CMS，code=arknights）----
		// 官方 CMS：列表接口的 brief 被服务端截断（只有时间与开头几个 UP），角色全量需按 cid 取详情。
		// 标题格式：[家族]【池名】限时寻访(即将)开启；brief 首段即"活动时间：X月X日 HH:mm - X月X日 HH:mm"。

		// 从公告正文/brief 提取 UP 干员（"★★★★★★：结城理（占…）★★★★★：埃癸斯 / 岳羽由加莉（…）"）
		function parseAkOfficialRoles(text) {
			const s = String(text || "")
				.replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\\/g, " ")
				.replace(/\s+/g, " ");
			const segM = s.match(/(?:出现率上升|获得概率提升)\s*([\s\S]*?)(?:注意|抽取概率公示|在本期|$)/);
			const seg = segM ? segM[1] : s;
			const names = [];
			for (const um of seg.matchAll(/(?:★{3,6})\s*[：:]\s*([^★（(\n]+)/g)) {
				for (let tok of String(um[1]).split(/[\/、,，\\\s]+/)) {
					tok = tok.replace(/\[[^\]]*\]/g, "").trim();
					if (tok && !/^[0-9.%占出率概]+$/.test(tok) && tok.length >= 2 && tok.length <= 10) names.push(tok);
				}
			}
			return [...new Set(names)].join("、");
		}

		// 列表 → 当期 限时/联动寻访池数组（bannerDates 统一为 "MM-DD HH:mm ~ MM-DD HH:mm"）
		function parseAkOfficialPools(list, now = nowMs()) {
			const nowYear = new Date(now).getFullYear();
			const out = [];
			for (const it of list || []) {
				const title = String(it.title || "");
				const brief = String(it.brief || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
				if (!/寻访/.test(title) || !/活动时间/.test(brief)) continue;
				const nameM = title.match(/【([^】]+)】\s*限时寻访/);
				if (!nameM) continue;
				const timeM = brief.match(/活动时间\s*[：:]\s*(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})\s*[-—~]\s*(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
				if (!timeM) continue;
				const mk = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
				const sm = Number(timeM[1]), sd = Number(timeM[2]);
				const em = Number(timeM[5]), ed = Number(timeM[6]);
				const startTs = mk(nowYear, sm, sd, Number(timeM[3]), Number(timeM[4]));
				const endTs = mk(em < sm ? nowYear + 1 : nowYear, em, ed, Number(timeM[7]), Number(timeM[8]));
				if (startTs > now || endTs < now) continue; // 只要当期覆盖
				const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				const startText = fmt(sm, sd, Number(timeM[3]), Number(timeM[4]));
				const endText = fmt(em, ed, Number(timeM[7]), Number(timeM[8]));
				const raw = `${startText} ~ ${endText}`;
				const familyM = title.match(/^\[([^\]]+)\]/);
				out.push({
					cid: String(it.cid || ""),
					family: familyM ? familyM[1] : "",
					banner: nameM[1],
					roles: parseAkOfficialRoles(brief),
					bannerDates: raw,
					bannerDatesRaw: raw,
					startTs, endTs, startText, endText, raw,
					tier: "限时",
					isMain: true
				});
			}
			return out;
		}

		// 官方当期限时寻访（经 host 代理：列表 + 每池详情各 1 次请求）
		async function fetchArknightsOfficialPools(signal, now = nowMs()) {
			const ref = "https://ak.hypergryph.com/";
			const listUrl = AK_OFFICIAL_BULLETIN + "?lang=zh-cn&code=arknights&page=1&pageSize=30";
			const json = await proxyFetchJson(listUrl, ref);
			const list = Array.isArray(json?.data?.list) ? json.data.list : [];
			const pools = parseAkOfficialPools(list, now);
			await Promise.all(pools.map(async (p) => {
				try {
					const d = await proxyFetchJson(`${AK_OFFICIAL_BULLETIN}/${p.cid}?lang=zh-cn&code=arknights`, ref);
					const content = typeof d?.data?.data === "string" ? d.data.data : "";
					if (content) {
						const roles = parseAkOfficialRoles(content);
						if (roles) p.roles = roles;
					}
				} catch { /* 详情失败保留 brief 解析的角色 */ }
			}));
			return pools;
		}

		// 方舟卡池默认抓取器：官方公告 CMS 优先（当期限时/联动寻访），
		// 官方无当期寻访公告（常规轮换周）或官方失败时自动回退 PRTS 卡池一览（逻辑同 selectArknights）。
		// 设置页手动切到 PRTS 备选源时则走 GACHA_FETCHERS["arknights-prts"]，不经本函数。
		async function fetchArknightsGacha(url, signal, now = nowMs()) {
			try {
				const official = await fetchArknightsOfficialPools(signal, now);
				if (official.length > 0) {
					const p = official[0];
					// 悬停：与其它游戏统一为「池名：角色」+ 时间（多池时逐池一行、同窗口合并时间、结束时间升序）
					const pools = official.map((x) => ({
						name: x.banner,
						label: `${x.banner}${x.roles ? `\uFF1A${x.roles}` : (x.family ? `\uFF1A${x.family}` : "")}`,
						startTs: x.startTs,
						endTs: x.endTs,
						raw: x.raw || x.bannerDatesRaw || x.bannerDates
					}));
					return {
						banner: p.banner,
						roles: p.roles,
						bannerDates: p.bannerDates,
						bannerDatesRaw: p.bannerDatesRaw,
						bannerHover: buildPoolHover(pools)
					};
				}
			} catch { /* 官方失败 → 回退 PRTS */ }
			const apiUrl = ARKNIGHTS_PRTS_URL + (ARKNIGHTS_PRTS_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			const d = selectArknights(html, now);
			return d ? { ...d } : null;
		}

		// 通用规则：起始时间为"版本更新后"等无具体日期的卡池，继承前一组（按结束时间分组）
		// 卡池的结束时间 —— 同一维护时间点（如星铁 4.5 上半的"4.5版本更新后" = 4.4 下半的结束时间）。
		// 不针对任何游戏特判：所有经 selectCurrent 的解析器统一受益。
		// 补全时保留源站原文（rawOriginal），供面板悬停显示原文（倒计时仍用补全后的时间）。
		function fillMissingStarts(items) {
			const byEnd = items.filter((it) => it.endTs != null).slice().sort((a, b) => a.endTs - b.endTs);
			let groupEnd = null, groupText = null;
			let i = 0;
			while (i < byEnd.length) {
				let j = i;
				while (j < byEnd.length && byEnd[j].endTs === byEnd[i].endTs) j++; // 相同结束时间成组
				if (groupEnd != null) {
					for (let k = i; k < j; k++) {
						const cur = byEnd[k];
						if (cur.startTs == null && groupText) {
							if (!cur.rawOriginal) cur.rawOriginal = cur.raw; // 保留源站原文（如"4.5版本更新后 ~ …"）
							cur.startTs = groupEnd;
							cur.startText = groupText;
							cur.raw = `${groupText} ~ ${cur.endText ?? ""}`.trim();
						}
					}
				}
				groupEnd = byEnd[i].endTs;
				groupText = byEnd[i].endText;
				i = j;
			}
		}

		// 选当期：优先"起始明确且覆盖 now"的主池；
		// 其次"起始未知（版本更新后）但结束在未来"的主池（星铁/zzz 上半，此时起始已被 fillMissingStarts 补齐）；
		// 同期多张主池（如 104期+104-2期）合并角色。返回 null 时调用方回退内置数据。
		// bannerDates 为补全后用于倒计时的文本；bannerDatesRaw 为源站原文（悬停展示）。
		function selectCurrent(items, now) {
			fillMissingStarts(items);
			const exact = items.filter((it) => it.startTs != null && it.startTs <= now && it.endTs != null && it.endTs >= now);
			const loose = items.filter((it) => it.startTs == null && it.endTs != null && it.endTs >= now);
			const pool = (exact.length > 0 ? exact : loose).filter((it) => it.isMain);
			if (pool.length === 0) return null;
			const first = pool[0];
			const sameRange = pool.filter((it) => it.startTs === first.startTs && it.endTs === first.endTs);
			const roles = [...new Set(sameRange.map((it) => cleanRoles(it.roles)).filter(Boolean))].join("、");
			return {
				banner: first.banner,
				roles,
				bannerDates: first.raw,
				bannerDatesRaw: first.rawOriginal || first.raw
			};
		}

		// MM-DD HH:MM（同年窗口用）
		function fmtMdHm(ts) {
			const d = new Date(ts);
			return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}

		// YYYY-MM-DD HH:MM（跨年窗口用：避免"05-15 16:00 ~ 05-15 03:59"看着像结束早于开始）
		function fmtYmdHm(ts) {
			const d = new Date(ts);
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}

		// 窗口起止文本：两端同一年 → MM-DD；跨年 → 两端都带年份
		function fmtWindow(startTs, endTs) {
			const sameYear = new Date(startTs).getFullYear() === new Date(endTs).getFullYear();
			return sameYear ? `${fmtMdHm(startTs)} ~ ${fmtMdHm(endTs)}` : `${fmtYmdHm(startTs)} ~ ${fmtYmdHm(endTs)}`;
		}

		// 长期/常驻玩法判定：声明窗口超过该天数的不当作"当期活动"（外显与悬停共用，①）。
		// 依据：各游戏限时活动实测最长约 84 天（原神），而常驻玩法动辄半年以上——
		// 明日方舟 PRTS 活动一览里「生息演算：重启锚点」245 天、「集成战略：沉沦者的黑流树海」179 天，
		// 两者都是常驻玩法（表内含"进行中"徽标），且因外显不带年份会被误读成"结束早于开始"。
		const EVENT_MAX_WINDOW_DAYS = 120;

		function isLongTermEvent(x) {
			return !!x && x.startTs != null && x.endTs != null && (x.endTs - x.startTs) > EVENT_MAX_WINDOW_DAYS * 864e5;
		}

		// 活动列表统一排序（③）：结束时间升序（越快结束越靠前）；结束时间无/未知/未抓到的排最后；
		// 同结束时间再按开始时间升序。同时剔除常驻/长期玩法与空名行（①）。
		// 外显取排序后的第一条，悬停按同序逐行展示 —— 两处共用本函数保证一致。
		function sortEventItems(items) {
			return (Array.isArray(items) ? items : [])
				.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
				.filter((x) => !isLongTermEvent(x))
				.sort((a, b) => {
					const ea = a.endTs == null ? Infinity : a.endTs;
					const eb = b.endTs == null ? Infinity : b.endTs;
					if (ea !== eb) return ea - eb;
					const sa = a.startTs == null ? Infinity : a.startTs;
					const sb = b.startTs == null ? Infinity : b.startTs;
					return sa - sb;
				});
		}

		// 活动类别优先级（只影响"外显"挑选，不影响悬停排序）：
		// 第一档 = 剧情/叙事类活动 + 限时高难玩法（剧情/叙事/故事、总力战/大决战、危机合约、挑战活动…）；
		// 其余为第二档。判定优先级：有类别字段（原神 SMW「类型」、星铁/绝区零表「类型」列、方舟分类前缀、
		// 终末地 tags、蔚蓝国际服 cat 列）就按类别判定；源头没有类别信息时才回退按活动名匹配关键词。
		const EVENT_TIER1_RE = /剧情|叙事|主线|故事|活动正篇|总力战|總力戰|大决战|大決戰|决战|決戰|危机合约|危機合約|制约解除|综合战术|綜合戰術|挑战|挑戰|深度巡防|极限|逆境深塔|冥歌海墟|全息/;

		function eventTier(x) {
			const cat = `${x?.cat || ""} ${x?.tags || ""}`.trim();
			const hay = cat || `${x?.name || ""}`;
			return EVENT_TIER1_RE.test(hay) ? 1 : 2;
		}

		// 外显挑选：先按类别档位（第一档优先），同档内按结束时间升序（③ 越快结束越靠前，
		// 结束时间未知排最后）；悬停仍按 endTs 升序全量展示，不受类别影响。
		function pickEventPrimary(items) {
			return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
				const t = eventTier(a) - eventTier(b);
				if (t !== 0) return t;
				const ea = a.endTs == null ? Infinity : a.endTs;
				const eb = b.endTs == null ? Infinity : b.endTs;
				if (ea !== eb) return ea - eb;
				const sa = a.startTs == null ? Infinity : a.startTs;
				const sb = b.startTs == null ? Infinity : b.startTs;
				return sa - sb;
			})[0] || null;
		}

		// 活动列悬停（鸣潮式多行）：按传入顺序（调用方已 sortEventItems）每条一行；
		// 各行窗口完全相同 → 时间只在末尾写一遍；缺起止的行原样显示该行原文；跨年窗口两端带年份（②）。
		// 兜底：只有 0/1 条时返回 ""，由 UI 退回原有"活动名 + 时间"单条展示 ——
		// 公告类单条源（蔚蓝国服/日服、1999、异环等）因此完全不受影响，也不会出现空行或半截区间。
		function buildEventHover(items) {
			const list = (Array.isArray(items) ? items : [])
				.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
				.filter((x) => !isLongTermEvent(x));
			if (list.length < 2) return "";
			const allTimed = list.every((x) => x.startTs != null && x.endTs != null);
			const same = allTimed && new Set(list.map((x) => `${x.startTs}~${x.endTs}`)).size === 1;
			const lines = list.map((x) => {
				// 有起止的行按行带时间（全部同窗口时只在末尾写一遍）；缺起止的行原样显示该行原文
				if (x.startTs != null && x.endTs != null) {
					return same ? x.name : `${x.name}   ${fmtWindow(x.startTs, x.endTs)}`;
				}
				const raw = String(x.raw || "").trim();
				return raw ? `${x.name}   ${raw}` : x.name;
			});
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs));
			return lines.join("\n");
		}

		// 卡池列悬停（统一格式，沿用方舟/面板既有"换行"排版）：
		// 每池两行 —— "池名：角色" + "起止时间"；窗口完全相同的池合并时间（只在末尾写一遍）；
		// 排序：结束时间升序（无/未知结束时间排最后）。
		// 外显不受此函数影响：仍按各源原有逻辑（同窗口角色合并）。兜底：0/1 池返回 ""，退回单条展示。
		function buildPoolHover(pools) {
			const list = (Array.isArray(pools) ? pools : [])
				.filter((p) => p && typeof p.name === "string" && p.name.trim() !== "")
				.sort((a, b) => {
					const ea = a.endTs == null ? Infinity : a.endTs;
					const eb = b.endTs == null ? Infinity : b.endTs;
					if (ea !== eb) return ea - eb;
					const sa = a.startTs == null ? Infinity : a.startTs;
					const sb = b.startTs == null ? Infinity : b.startTs;
					return sa - sb;
				});
			if (list.length < 2) return "";
			const allTimed = list.every((p) => p.startTs != null && p.endTs != null);
			const same = allTimed && new Set(list.map((p) => `${p.startTs}~${p.endTs}`)).size === 1;
			const lines = [];
			for (const p of list) {
				lines.push(p.label || p.name);
				if (same) continue;
				const t = p.startTs != null && p.endTs != null ? fmtWindow(p.startTs, p.endTs) : String(p.raw || "").trim();
				if (t) lines.push(t);
			}
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs));
			return lines.join("\n");
		}

		// 鸣潮：角色轮换池页（Bwiki 汇总页，逐期列出）→ 取"覆盖当前时刻"的那一组：
		// 每一组 = 该组 data-start/data-end 之后、到下一组之前的那段里的「共鸣者/xxx」。
		// 旧实现取页面第一组时间 + 整页前 6 个角色名 → 备选/兜底源会显示"过期档期 + 跨池混入的角色"，
		// 且不报任何失败（实测该页当前只有一组已过期计时器）。没有覆盖当前的组 → 返回 null（未公布）。
		function parseWuwaPool(html, now = nowMs()) {
			const text = String(html || "");
			const marks = [...text.matchAll(/data-start="([^"]+)"\s+data-end="([^"]+)"/g)];
			// 页面拿到了却一个计时器都没有 → 汇总页改版（抛错让面板显示"卡池失败"），
			// 而不是伪装成"新卡池未公布"（这是本条目的备选/兜底源）
			if (marks.length === 0) throw new Error("wuwa-pool-no-timer");
			for (let i = 0; i < marks.length; i++) {
				const m = marks[i];
				const start = parseTime(m[1]);
				const end = parseTime(m[2]);
				if (start.ts == null || end.ts == null) continue;
				if (!(start.ts <= now && now <= end.ts)) continue;
				const seg = text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : text.length);
				const chars = [...new Set([...seg.matchAll(/共鸣者\/([^"]+)"/g)].map((x) => x[1]))].slice(0, 6);
				if (chars.length === 0) continue;
				return {
					banner: "\u89D2\u8272\u6362\u53EC\u6C60",
					roles: chars.join("、"),
					startTs: start.ts, endTs: end.ts,
					bannerDates: `${start.text} ~ ${end.text}`
				};
			}
			return null;
		}

		// 鸣潮官方公告解析：从全量公告（game/activity/recommend）中取"覆盖当前时刻"的「角色活动唤取」
		// 公告形如：tabTitle="[身赴三途]角色活动唤取"，content 内含"✦活动时间✦ 2026年9月10日10:00 ~ 2026年9月29日11:59"
		function parseWuwaNotice(list, now = nowMs()) {
			const groups = [list?.game, list?.activity, list?.recommend].filter(Array.isArray);
			const stripH = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&hellip;/g, "…")
				.replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			const pools = [];
			for (const arr of groups) {
				for (const it of arr) {
					const title = stripH(it.tabTitle || it.title || "");
					if (!/活动唤取/.test(title)) continue;
					const text = stripH(it.content || "");
					const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～-]\s*(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
					if (!m) continue;
					const sTs = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
					const eTs = new Date(+(m[6] || m[1]), +m[7] - 1, +m[8], +m[9], +m[10]).getTime();
					if (sTs > now || eTs < now) continue; // 只要当期覆盖
					const name = title
						.replace(/\s*(?:角色|武器)活动唤取\s*$/, "")
						.replace(/^[\[【「]\s*/, "")
						.replace(/\s*[\]】」]$/, "")
						.trim();
					const upPart = text.split(/✦\s*活动时间/)[0] || "";
					const ups = [...upPart.matchAll(/[「【]([^」】]+)[」】]/g)].map((x) => x[1].trim()).filter(Boolean);
					pools.push({ name, isChar: /角色活动唤取/.test(title), roles: ups.join("、"), startTs: sTs, endTs: eTs });
				}
			}
			const cur = pools.filter((p) => p.isChar && p.name);
			if (cur.length === 0) return null;
			const first = cur[0];
			const roles = [...new Set(cur.flatMap((p) => p.roles.split("、")).filter(Boolean))].join("、");
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			const raw = fmtWindow(first.startTs, first.endTs);
			// 悬停：每池"池名：角色"一行 + 时间一行；各池窗口相同则时间只在末尾写一遍；按结束时间升序
			const bannerHover = buildPoolHover(cur.map((p) => ({
				name: p.name,
				label: `${p.name}\uFF1A${p.roles || "-"}`,
				startTs: p.startTs,
				endTs: p.endTs
			})));
			return { banner: first.name, roles, bannerDates: raw, bannerDatesRaw: raw, startTs: first.startTs, endTs: first.endTs, bannerHover };
		}

		// 鸣潮卡池默认抓取器：官方公告（entrypoint → 目录 → zh-Hans.json 全量）优先；
		// 无当期公告 / 抓取失败 → 自动回退 Bwiki 角色轮换池（逻辑同 parseWuwaPool）
		async function fetchWuwaGacha(entryUrl, signal, now = nowMs()) {
			try {
				const ref = "https://aki-gm-resources.aki-game.com/";
				const ej = await proxyFetchJson(entryUrl, ref);
				const contentUrl = Array.isArray(ej?.contentUrl) ? ej.contentUrl[0] : "";
				const dir = contentUrl ? contentUrl.replace(/[^/]*$/, "") : String(entryUrl).replace(/[^/]*$/, "");
				let list = null;
				try { list = await proxyFetchJson(dir + "zh-Hans.json", ref); } catch { list = null; }
				if (!list || typeof list !== "object") list = await proxyFetchJson(dir + "notice.json", ref);
				const d = parseWuwaNotice(list, now);
				if (d) return d;
			} catch { /* 官方失败 → Bwiki 备选 */ }
			const apiUrl = WUWA_BWIKI_URL + (WUWA_BWIKI_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return parseWuwaPool(html);
		}

		// 绝区零官网公告解析：从公告频道（iChanId=279）取「X.Y版本限时频段（上/下期）」，选覆盖当前时刻的一期。
		// 公告形如：sIntro="本期代理人与音擎调频活动时间为：3.2版本更新后 ~ 2026/09/30 11:59"，
		// sContent 内含「活动期间，限定S级代理人[克拉蕾(电·锋御)]、[南宫羽(以太·击破)]…」。
		// 起点为"版本更新后"时，用同版本「更新公告」的 dtStartTime 补全；「独家重映/音擎回响」自选段跳过。
		function parseZzzFreq(payload, now = nowMs()) {
			const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
			const clean = (s) => stripTags(s);
			// 版本更新公告 → "X.Y版本更新后"的起点；同时抽取「S级代理人[X] → 「Y」频段」对应表
			// （频段名只写在更新公告里，逐期频段公告不含频段名，故用它回填卡池标题）
			// 注意：必须排除「X.Y版本…预下载开启&更新通知」——它比正式更新早 1~2 天发布，
			// 若当成版本起点，下一期频段会被提前判成"覆盖当前"、把真实在跑的上一期挤掉
			// （与活动侧 parseZzzEventsOfficial 同一口径）。
			const verStart = {};
			const poolOf = {};
			for (const it of list) {
				const t = clean(it?.sTitle);
				const vm = t.match(/(\d+\.\d+)\s*版本/);
				if (!vm) continue;
				if (/更新(?:公告|通知)/.test(t) && !/预下载|预约|前瞻|预抽/.test(t)) {
					const p = parseTime(it.dtStartTime);
					if (p.ts != null && verStart[vm[1]] == null) verStart[vm[1]] = p;
				}
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				for (const m of text.matchAll(/S级代理人\s*[\[【]([^\]】]+)[\]】][^「]{0,40}?「([^」]{2,14})」频段/g)) {
					const name = m[1].replace(/[（(].*$/, "").trim();
					if (name && poolOf[name] == null) poolOf[name] = m[2].trim();
				}
			}
			// 角色名统一为「职业·属性」全角括号（与 Bwiki 显示一致）：克拉蕾(电·锋御) → 克拉蕾（锋御·电）
			const normRole = (name) => {
				const m = name.match(/^([^（()]+)[（(]([^）)]+)[）)]\s*$/);
				if (!m) return name;
				const bits = m[2].split("·");
				return bits.length === 2 ? `${m[1]}（${bits[1]}·${bits[0]}）` : `${m[1]}（${m[2]}）`;
			};
			const pools = [];
			for (const it of list) {
				const title = clean(it?.sTitle);
				const vm = title.match(/(\d+\.\d+)\s*版本限时频段\s*((?:（[上下]期）)?)/);
				if (!vm) continue;
				const ver = vm[1];
				const part = vm[2] || "";
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				const re = /((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本更新后))\s*[~～]\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})/g;
				const marks = [];
				let m;
				while ((m = re.exec(text)) !== null) {
					marks.push({ start: m[1], end: m[2], from: m.index, to: m.index + m[0].length, after: /版本更新后/.test(m[1]) });
				}
				const created = parseTime(it.dtCreateTime).ts ?? 0;
				for (let i = 0; i < marks.length; i++) {
					const seg = text.slice(marks[i].to, i + 1 < marks.length ? marks[i + 1].from : text.length);
					// 该时间窗对应的「限定S级代理人」句（排除独家重映/音擎回响的自选说明）
					const sentence = seg.split(/[。！；]/).find((s) => /限定S级代理人/.test(s) && !/重映|回响|可自选/.test(s));
					if (!sentence) continue;
					const roleM = sentence.match(/限定S级代理人\s*((?:[\[【][^\]】]+[\]】][、，,及和与\s]*)+)/);
					if (!roleM) continue;
					const roles = [...roleM[1].matchAll(/[\[【]([^\]】]+)[\]】]/g)].map((x) => normRole(x[1].trim())).join("、");
					if (!roles) continue;
					const sp = marks[i].after ? (verStart[ver] || { ts: null, text: null }) : parseTime(marks[i].start);
					const ep = parseTime(marks[i].end);
					if (ep.ts == null) continue;
					pools.push({
						ver, part, roles,
						startTs: sp.ts, endTs: ep.ts,
						startText: sp.text, endText: ep.text,
						raw: `${marks[i].after ? `${ver}版本更新后` : sp.text} ~ ${ep.text}`,
						created,
						isMain: true
					});
				}
			}
			if (pools.length === 0) return null;
			const cover = pools.filter((p) => p.startTs != null && p.startTs <= now && p.endTs >= now);
			// 起点未知（同版本更新公告未收录）但结束在未来 → 仍作为当期（与 selectCurrent 的宽松分支一致）
			const loose = pools.filter((p) => p.startTs == null && p.endTs >= now);
			const picked = (cover.length > 0 ? cover : loose).sort((a, b) => (b.created - a.created) || (a.endTs - b.endTs));
			if (picked.length === 0) return null;
			const first = picked[0];
			const same = picked.filter((p) => p.ver === first.ver && p.part === first.part);
			const roles = [...new Set(same.flatMap((p) => p.roles.split("、")).filter(Boolean))].join("、");
			// 卡池名：优先用更新公告里的「频段名」（当期名单命中的新代理人）；复刻期无名时退回版本期名称
			let poolName = "";
			for (const r of roles.split("、")) {
				const base = r.replace(/[（(].*$/, "").trim();
				if (base && poolOf[base]) { poolName = poolOf[base]; break; }
			}
			return {
				banner: poolName ? `「${poolName}」频段` : `${first.ver}版本限时频段${first.part}`,
				roles,
				bannerDates: first.startText && first.endText ? `${first.startText} ~ ${first.endText}` : first.raw,
				bannerDatesRaw: first.raw,
				startTs: first.startTs,
				endTs: first.endTs
			};
		}

		// 绝区零卡池默认抓取器：官网公告优先；无当期频段公告 / 抓取失败 → 自动回退 Bwiki 往期调频
		async function fetchZzzGacha(listUrl, signal, now = nowMs()) {
			try {
				const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
				const d = parseZzzFreq(payload, now);
				if (d) return d;
			} catch { /* 官方失败 → Bwiki 备选 */ }
			const apiUrl = ZZZ_BWIKI_URL + (ZZZ_BWIKI_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return selectCurrent(parseAllBwiki(html), now);
		}

		// 绝区零：官方公告列表（api-takumi-static，与卡池侧同一接口，经 host 代理）→ 当期活动。
		// 活动时间就写在公告正文里（【活动时间】A ~ B），**不需要再抓详情页**；
		// A/B 可能是绝对时间，也可能是"X.Y版本更新后" / "X.Y版本结束"——用「X.Y版本更新公告」的发布时间折算：
		//   版本起点 = 该版本更新公告发布时间；版本结束 = 下一个已知版本起点 − 1 分钟。
		// 当前版本还没有下一版本公告 → 结束时间未知：这类活动**保留**（endTs=null），
		// 由 sortEventItems / pickEventPrimary 的既有规则自然沉到外显与悬停的最后，不跳过、不丢弃。
		const ZZZ_EVENT_WINDOW_RE = /((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本更新后))\s*[~～\-—]\s*((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本结束))/g;

		function parseZzzEventsOfficial(payload, now = nowMs()) {
			const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
			const clean = (s) => stripTags(s);
			// 版本起点表：取该版本的「更新公告」发布时间。
			// 必须排除「X.Y版本…预下载开启&更新通知」——它比正式更新早 1~2 天发布，
			// 若当成版本起点，会把上一版本"版本结束"型活动提前判死、并让新版本活动提前出现。
			const verStart = {};
			for (const it of list) {
				const title = clean(it?.sTitle);
				const vm = title.match(/(\d+\.\d+)\s*版本/);
				if (!vm || !/更新(?:公告|通知)/.test(title)) continue;
				if (/预下载|预约|前瞻|预抽/.test(title)) continue;
				const ts = parseTime(it.dtStartTime).ts;
				if (ts != null && verStart[vm[1]] == null) verStart[vm[1]] = ts;
			}
			const versions = Object.keys(verStart).sort((a, b) => verStart[a] - verStart[b]);
			// 折算一个窗口的两个端点；返回 null 表示**窗口此刻不成立**（含"该版本还没开始/无法判定"）。
			// 规则：绝对时间直接用；"X.Y版本更新后"要求该版本已开始（版本更新公告已发布）；
			//      "X.Y版本结束" = 下一个已知版本起点 − 1 分钟；若 X.Y 已是最新版本 → 结束时间未知（endTs=null，
			//      仍算成立：活动在跑，只是没有绝对结束日）→ 由排序规则沉底，不跳过、不丢弃。
			const windowAt = (startText, endText) => {
				let startTs = null;
				const sv = startText.match(/(\d+\.\d+)\s*版本更新后/);
				if (sv) {
					if (verStart[sv[1]] == null) return null;   // 该版本尚未开始 → 活动还没上线
					startTs = verStart[sv[1]];
				} else {
					const p = parseTime(startText);
					if (p.ts == null) return null;
					startTs = p.ts;
				}
				if (startTs > now) return null;
				let endTs = null;
				const ev = endText.match(/(\d+\.\d+)\s*版本结束/);
				if (ev) {
					if (verStart[ev[1]] == null) return null;   // 版本未知 → 无法判定，保守略过
					const later = versions.find((v) => verStart[v] > verStart[ev[1]]);
					if (later != null) endTs = verStart[later] - 60000;
				} else {
					const p = parseTime(endText);
					if (p.ts == null) return null;
					endTs = p.ts;
				}
				if (endTs != null && endTs < now) return null;
				return { startTs, endTs };
			};
			// 标题筛选用「活动说明」：正文里带活动时间的都是这类；商城/城募/剧情/频段公告不在此列
			const byName = new Map();
			for (const it of list) {
				const title = clean(it?.sTitle);
				if (!/活动说明/.test(title)) continue;
				const name = (title.match(/^「([^」]+)」/) || [])[1] || title.replace(/活动说明$/, "").trim();
				if (!name || byName.has(name)) continue;
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				for (const m of text.matchAll(ZZZ_EVENT_WINDOW_RE)) {
					const w = windowAt(m[1], m[2]);
					if (!w) continue;                                  // 这个窗口此刻不成立 → 看下一个窗口
					byName.set(name, { banner: name, name, cat: "", ...w, raw: `${m[1]} ~ ${m[2]}` });
					break;                                             // 一篇公告只取第一个成立的窗口
				}
			}
			const active = sortEventItems([...byName.values()]);
			if (active.length === 0) return null;
			const primary = pickEventPrimary(active) || active[0];
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs) : (primary.raw || "");
			return {
				event: primary.name,
				eventDates: dates,
				eventDatesRaw: primary.raw || "",
				// 只有 1 条时 buildEventHover 返回 ""，由 UI 退回单条展示（与其它源一致）
				eventHover: buildEventHover(active)
			};
		}

		async function fetchZzzEventsOfficial(listUrl, signal) {
			const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
			return parseZzzEventsOfficial(payload);
		}

		// 鸣潮：活动日历页 → font-size:17px 标题 + font-size:11px 时间，选当期
		// 注意：复用 selectCurrent 需要 isMain 字段（该函数按 isMain 过滤主池）
		function parseWuwaCalendar(html) {
			const items = [];
			const re = /font-size:17px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>([\s\S]*?)(?=font-size:17px|$)/g;
			let m;
			while ((m = re.exec(html)) !== null) {
				const name = stripTags(m[1]);
				if (!name) continue;
				const timeM = m[2].match(/font-size:11px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>/);
				const timeText = timeM ? stripTags(timeM[1]) : "";
				if (!/20\d{2}\//.test(timeText)) continue;
				const range = parseRange(timeText);
				items.push({ banner: name, name, ...range, isMain: true });
			}
			const now = nowMs();
			const active = sortEventItems(items
				.filter((it) => it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now))
				.map((it) => ({ name: it.name || it.banner, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw })));
			if (active.length === 0) return null;
			// 外显：类别优先（战斗/高难类优先），同级内结束时间升序（③）；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs) : (primary.raw || "");
			return { banner: primary.name, roles: "", bannerDates: dates, bannerDatesRaw: primary.raw || dates, eventHover: buildEventHover(active) };
		}

		// 解 HTML 数字实体（wiki.gg 的区间分隔符写成 &#8211; = en dash、&#8722; = 减号）+
		// 常见具名实体。stripTags 不解实体，所以需要它才能把时间串拆干净。
		function decodeHtmlEntities(s) {
			return String(s)
				.replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ""; } })
				.replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
				.replace(/&nbsp;/g, " ").replace(/&minus;/g, "\u2212").replace(/&ndash;/g, "\u2013").replace(/&mdash;/g, "\u2014").replace(/&amp;/g, "&");
		}

		// 英文月份日期 → { ts, text }（如 "Sep 02, 2026, 12:00"、"September 2, 2026"）。
		// 英文源站（wiki.gg / Game8 等）用这种写法，而 parseTime 只认纯数字日期，需要单独一支。
		// 与插件其余来源同一口径：按"源站墙钟时间"直接构造（CN 用户本地即 UTC+8）。
		const EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
		function parseEnDate(raw) {
			const m = String(raw).match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/);
			if (!m) return null;
			const mo = EN_MONTHS[m[1].slice(0, 3).toLowerCase()];
			if (!mo) return null;
			const d = Number(m[2]), y = Number(m[3]);
			const h = m[4] ? Number(m[4]) : 0, mi = m[5] ? Number(m[5]) : 0;
			const pad = (n) => String(n).padStart(2, "0");
			return { ts: new Date(y, mo - 1, d, h, mi).getTime(), text: `${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}` };
		}

		// 终末地（wiki.gg）：Headhunting/Banners 页 Current 分节 → 当期卡池
		// 该源经 host 代理抓取（fetchEndfieldWikiGg → proxyFetchText 设 Referer=wiki.gg origin），
		// 满足 Wiki.gg 的 Referer 校验，不会触发 403；本解析器仅处理代理返回的 HTML。
		// 线上真实标记（2026-09 实测）：Asia 行是 "Sep 02, 2026, 12:00 &#8211; Sep 30, 2026, 11:59 (UTC+8)"，
		// 同一格里还有 AM/EU 行（UTC−5）；旧实现用 parseTime + split(/[–-]/) 解不了英文月份与实体，恒返回 null
		// → 该备选源长期"抓得到但解析不出"。现在：解实体 + 只取 Asia 行 + 英文月份解析。
		function parseEndfieldCurrent(html) {
			const i = html.indexOf('id="Current"');
			// 页面拿到了却没有 Current 分节 → wiki 页改版（抛错，别伪装成"未公布"）
			if (i < 0) throw new Error("endfield-current-no-section");
			const seg = html.slice(i);
			const tableEnd = seg.indexOf("</table>");
			const table = tableEnd >= 0 ? seg.slice(0, tableEnd) : seg;
			const nameM = table.match(/class="header"[^>]*>([^<]+)</);
			const asiaM = table.match(/Asia:<\/b>([\s\S]*?)<\/span>/);
			const upM = [...table.matchAll(/<li>[\s\S]*?title="([^"]+)"[\s\S]*?\(Drop Rate-UP\)/g)];
			const banner = nameM ? nameM[1].trim() : "";
			let startTs = null, endTs = null, startText = null, endText = null;
			if (asiaM) {
				// 只取 Asia 行（非贪婪已停在 Asia span 结束处）；解实体后按 en/em dash 或"带空格的短横线"切两段
				const asiaText = decodeHtmlEntities(stripTags(asiaM[1]));
				const parts = asiaText.split(/[\u2013\u2014\u2212]|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
				const a = parseEnDate(parts[0] || "");
				const b = parseEnDate(parts[1] || "");
				if (a) { startTs = a.ts; startText = a.text; }
				if (b) { endTs = b.ts; endText = b.text; }
			}
			// 分节在、但卡池名/Asia 档期读不出来 → 表结构变了（抛错）；读得出但不覆盖当前 → null（未公布）
			if (!banner) throw new Error("endfield-current-no-banner");
			if (startTs == null || endTs == null) throw new Error("endfield-current-no-dates");
			if (!(startTs <= nowMs() && endTs >= nowMs())) return null;
			return {
				banner,
				roles: [...new Set(upM.map((m) => m[1]))].join("、"),
				bannerDates: startText && endText ? `${startText} ~ ${endText}` : ""
			};
		}

		// 终末地（GachaTracker）：banners 表格 → 当期卡池（卡池名/干员/起止）
		// GachaTracker 提供 CORS=[*]，浏览器端可直接抓取（替代被 Referer 反爬拦截的 wiki.gg）
		function parseGachaTracker(html) {
			const rows = [...html.matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g)];
			const items = [];
			for (const rm of rows) {
				const body = rm[2];
				if (!body.includes("date-cell")) continue;
				const nameM = body.match(/banner-name-cell">[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
				const dateM = [...body.matchAll(/date-cell">([\d-]+)<\/td>/g)];
				const charM = [...body.matchAll(/\/games\/endfield\/characters\/[^"]+" title="([^"]+)"/g)];
				if (!nameM || dateM.length < 2) continue;
				const start = dateM[0][1];
				const end = dateM[1][1];
				items.push({
					banner: stripTags(nameM[1]),
					roles: [...new Set(charM.map((m) => m[1]))].join("、"),
					startTs: new Date(start + "T00:00:00+08:00").getTime(),
					endTs: new Date(end + "T23:59:59+08:00").getTime()
				});
			}
			const now = nowMs();
			const cur = items.find((it) => it.startTs <= now && it.endTs >= now) || null;
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: cur.banner,
				roles: cur.roles,
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
			};
		}

		// 通用：从 Next.js flight payload HTML 中定位指定组件引用的 JS chunk URL 列表。
		// 适用于"HTML 无数据、数据编译在组件 chunk 里"的 Next.js 站点（如 canmoe）。
		// componentName 形如 "BannerCalendar"；baseUrl 用于把相对路径补全为绝对 URL。
		function nextJsChunkUrls(html, componentName, baseUrl) {
			const i = html.indexOf(componentName);
			if (i < 0) return [];
			const seg = html.slice(Math.max(0, i - 1500), i);
			const br = seg.lastIndexOf("[");
			if (br < 0) return [];
			// flight payload 内 chunk 路径是双重转义（\\\"），还原一层后提取
			const raw = seg.slice(br).replace(/\\\\"/g, '"').replace(/\\"/g, '"');
			const names = [...raw.matchAll(/\/_next\/static\/chunks\/([A-Za-z0-9_.~-]+\.js)/g)].map((x) => x[1]);
			// 补全为绝对 URL：优先页面 origin（chunk 路径是站内相对路径）
			let origin = "";
			try { origin = new URL(baseUrl || "").origin; } catch { /* 无 baseUrl 时保持相对 */ }
			return [...new Set(names)].map((n) => origin + "/_next/static/chunks/" + n);
		}

		// 从 canmoe chunk JS 提取当期卡池：
		// ① 当期角色窗口形如 d={梨诺:{windows:[{start,end,version,period,isRerun}]}},u=[...]
		//   （注意：d 在 canmoe 侧可能长期不更新，只能当"覆盖当前时刻才采信"的快速路径）
		// ② 期次列表形如 <变量>=[{id,title,subtitle,version,periodStart,periodEnd,featured:[...]}]，
		//   变量名随构建变化（曾见 p= / 现为 f=），由 extractCanmoePeriods 按内容定位。
		// 只采用"时间窗口覆盖当前时刻"的条目。
		// 返回值三态：数据对象 / null（**结构在**但没有覆盖当前时刻的期次 → 未公布）/ undefined
		// （这份 JS 里**根本没有**卡池数据结构 → 交给调用方决定：多 chunk 时继续找下一个，
		//  全部 chunk 都没有则说明页面改版 → 报错，而不是伪装成"未公布"）。
		function currentFromCanmoe(js, now) {
			now = now || nowMs();
			let sawStructure = false;
			const fmt = (iso) => {
				const d = new Date(iso);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			// 1) 当期 d：windows 覆盖当前 → 直接用
			const curM = js.match(/\bd=\{(.+?)\},\s*u=\[/);
			if (curM) {
				sawStructure = true;
				const inner = curM[1];
				const featuredM = inner.match(/([^:{}]+):\{windows:/);
				const roles = featuredM ? featuredM[1].trim() : "";
				for (const w of inner.matchAll(/windows\s*:\s*\[\s*\{\s*start\s*:\s*"([^"]+)"\s*,\s*end\s*:\s*"([^"]+)"\s*,\s*version\s*:\s*"([^"]+)"\s*,\s*period\s*:\s*(\d+)\s*,\s*isRerun\s*:\s*(!0|!1|true|false)\s*\}\s*\]/g)) {
					const a = new Date(w[1]).getTime(), b = new Date(w[2]).getTime();
					if (a <= now && now <= b) return { banner: `\u3010${w[3]}\u3011${roles}`, roles, bannerDates: `${fmt(w[1])} ~ ${fmt(w[2])}` };
				}
			}
			// 2) p 数组中的"当前进行中"条目（过期当期后以此为兜底）
			const arr = extractCanmoePeriods(js);
			if (arr) {
				sawStructure = true;
				for (const e of arr) {
					const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
					const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
					if (!ps || !pe) continue;
					const a = new Date(ps).getTime(), b = new Date(pe).getTime();
					if (a <= now && now <= b) {
						const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
						const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
						const version = (e.match(/version\s*:\s*"([^"]*)"/) || [])[1] || "";
						const roles = subtitle || title;
						return { banner: title || `\u3010${version}\u3011${subtitle}`, roles, bannerDates: `${fmt(ps)} ~ ${fmt(pe)}`, bannerDatesRaw: `${fmt(ps)} ~ ${fmt(pe)}` };
					}
				}
			}
			// 结构在但没覆盖当前时刻 → null（未公布）；连结构都没有 → undefined（页面改版，交上层决定）
			return sawStructure ? null : void 0;
		}

		// 提取 canmoe chunk 里的"卡池期次数组"（元素含 periodStart/periodEnd 的那个），返回元素子串数组。
		// 数组的变量名是压缩产物的一部分：canmoe 每次重新构建都可能改名（曾见 p=[…]，现为 f=[…]），
		// 所以按"任意 `名字=[` 且数组体里有 periodStart"来定位，不写死变量名
		// （曾因写死 p= 而在 canmoe 改版后静默抓不到当期卡池）。
		function extractCanmoePeriods(js) {
			const re = /[A-Za-z_$][\w$]*\s*=\s*\[/g;
			for (let m = re.exec(js); m; m = re.exec(js)) {
				const start = js.indexOf("[", m.index);
				// 便宜预筛：数组开头不远处就有 periodStart 字段，省掉对每个数组都做括号平衡扫描
				if (!/periodStart\s*:/.test(js.slice(start, start + 4000))) continue;
				let depth = 0, inStr = false, q = "", end = -1;
				for (let i = start; i < js.length; i++) {
					const ch = js[i];
					if (inStr) { if (ch === "\\") i++; else if (ch === q) inStr = false; continue; }
					if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
					if (ch === "[") depth++;
					else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
				}
				if (end < 0) continue;
				const body = js.slice(start + 1, end);
				if (!/periodStart\s*:/.test(body)) continue;
				const out = [];
				let d2 = 0, s2 = false, q2 = "", st = 0;
				for (let k = 0; k < body.length; k++) {
					const ch = body[k];
					if (s2) { if (ch === "\\") k++; else if (ch === q2) s2 = false; continue; }
					if (ch === '"' || ch === "'") { s2 = true; q2 = ch; continue; }
					if (ch === "{" || ch === "[") d2++;
					else if (ch === "}" || ch === "]") d2--;
					else if (ch === "," && d2 === 0) { out.push(body.slice(st, k)); st = k + 1; }
				}
				out.push(body.slice(st));
				return out;
			}
			return null;
		}

		// 兼容旧调用：parseCanmoe / parseCanmoeLoose 均走统一的"当期选择"逻辑（now 可注入）。
		// 这两个是**给通用解析（自定义条目/自定义地址）用的宽松包装**：把 undefined 归一成 null，
		// 即"读不出来 → 未公布"，不在这里抛错（用户自定义地址读不出内容是常态，不该报成源站故障）。
		function parseCanmoe(js, now = nowMs()) { const d = currentFromCanmoe(js, now); return d === void 0 ? null : d; }
		function parseCanmoeLoose(js, now = nowMs()) { return parseCanmoe(js, now); }

		// 终末地（canmoe 经 host 代理）：页面 HTML → 定位 BannerCalendar chunk → 抓 chunk JS → 窗口匹配当期
		// canmoe 无 CORS 头，两步都经 host 代理（referer 用页面 origin 满足反爬）
		// 数据在某一组件的 chunk 里（含当期 d={...} 与历史期次数组），currentFromCanmoe(js, now) 做窗口匹配
		//
		// 三态（这是本条目的**默认来源**，必须把"源站改版"和"没公布"分开，否则会重演长期静默失灵）：
		//   · 有覆盖当前时刻的期次 → 返回数据；
		//   · 拿到 JS 且里面有卡池结构、但没有覆盖当前的期次 → return null（未公布）；
		//   · 页面/所有 chunk 里都找不到卡池结构（或 chunk 全抓失败）→ **抛错**（面板显示"卡池失败"）。
		async function fetchCanmoeEndfield(pageUrl, now = nowMs()) {
			const html = await proxyFetchText(pageUrl, "https://end.canmoe.com/");
			const chunks = nextJsChunkUrls(html, "BannerCalendar", pageUrl);
			if (chunks.length === 0) throw new Error("canmoe-no-chunk");   // 页面拿到了但没有数据块链接 = 改版
			let fetchedAny = false, sawStructure = false, lastErr = null;
			for (const c of chunks) {
				let js = null;
				try {
					js = await proxyFetchText(c, "https://end.canmoe.com/");
				} catch (err) {
					lastErr = err;      // 单个 chunk 抓失败：继续试下一个（错误留着，全失败时抛出去）
					continue;
				}
				fetchedAny = true;
				const d = currentFromCanmoe(js, now);
				if (d === void 0) continue;      // 这份 chunk 里没有卡池结构 → 看下一个
				sawStructure = true;
				if (d) {
					const hover = canmoePoolHover(js, now);
					if (hover) d.bannerHover = hover;
					return d;
				}
			}
			if (!fetchedAny) throw (lastErr || new Error("canmoe-chunk-fetch-failed"));
			if (!sawStructure) throw new Error("canmoe-layout-changed");
			return null;   // 结构在、但当期没有覆盖现在的期次 → 未公布
		}

		// 终末地卡池列悬停：canmoe 卡池日历 chunk 内同期全部卡池条目（特许寻访 / 重构寻访 等），
		// 每池"卡池名：角色"一行 + 时间；窗口相同则合并时间；结束时间升序（0/1 池返回 "" 走单条兜底）
		function canmoePoolHover(js, now) {
			const arr = extractCanmoePeriods(js);
			if (!arr) return "";
			const pools = [];
			for (const e of arr) {
				const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
				const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
				if (!ps || !pe) continue;
				const a = new Date(ps).getTime(), b = new Date(pe).getTime();
				if (!(a <= now && now <= b)) continue;
				const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
				const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
				if (!title && !subtitle) continue;
				pools.push({
					name: title || subtitle,
					label: title && subtitle ? `${title}\uFF1A${subtitle}` : (title || subtitle),
					startTs: a,
					endTs: b
				});
			}
			return buildPoolHover(pools);
		}

		// 异环（ldshop 繁体）：解析「項目/資訊」卡池表（含 期間/角色/棋盤 行），返回全部卡池
		// 表格行结构：<td><p>期間</p></td><td><p>8月19日－9月9日</p></td>
		function parseLdshopPools(html) {
			const out = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
			for (const tb of tables) {
				const body = tb[1];
				if (!/期間/.test(body.replace(/<[^>]+>/g, "|"))) continue;
				let info = {};
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
					const tds = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]).trim());
					if (tds.length >= 2 && tds[0] && tds[0] !== "項目") info[tds[0]] = tds[1];
				}
				if (!info["期間"]) continue;
				const range = parseLdshopRange(info["期間"]);
				if (!range) continue;
				const chars = [info["全新S級角色"], info["復刻S級角色"]].filter(Boolean).join("/");
				out.push({
					banner: info["角色棋盤"] || "异环卡池",
					roles: chars,
					...range,
					isMain: true
				});
			}
			return out;
		}

		// 中文明期间 → startTs/endTs/bannerDates（如 "8月19日－9月9日"；跨年自动+1年）
		function parseLdshopRange(raw, now) {
			const s = String(raw).trim();
			const m = s.match(/(\d{1,2})月(\d{1,2})日\s*[－\-]\s*(\d{1,2})月(\d{1,2})日/);
			if (!m) return null;
			const base = now || new Date(nowMs());   // 缺省走注入时钟（core 不得直接读宿主时钟）
			const y = base.getFullYear();
			const a = new Date(y, Number(m[1]) - 1, Number(m[2]), 0, 0);
			let b = new Date(y, Number(m[3]) - 1, Number(m[4]), 23, 59);
			if (b < a) b = new Date(y + 1, Number(m[3]) - 1, Number(m[4]), 23, 59);
			const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			return { startTs: a.getTime(), endTs: b.getTime(), startText: fmt(a), endText: fmt(b), raw: `${fmt(a)} ~ ${fmt(b)}` };
		}

		// 异环（ldshop 经 host 代理）：抓页面 → 解析卡池表 → 选当期
		async function fetchLdshopNte(pageUrl) {
			const html = await proxyFetchText(pageUrl, "https://www.ldshop.gg/");
			const pools = parseLdshopPools(html);
			if (pools.length === 0) return null;
			return selectCurrent(pools, nowMs());
		}

		// 异环（官网 yh.wanmei.com 公告，经 host 代理）：抓游戏公告列表 → 取最新维护/更新公告 → 解析当期限定棋盘卡池与限时活动
		// 官网公告列表条目：<a href="/news/gamebroad/YYYYMMDD/N.html">…<h2 class="title">标题</h2>
		const NTE_ITEM_RE = /<a href="(\/news\/gamebroad\/\d+\/\d+\.html)"[\s\S]*?<h2 class="title">([^<]+)<\/h2>/g;
		// 带新卡池的公告标题：停服维护/版本更新；"1.3版本「…」更新公告"这类版本名夹在中间，所以"更新公告"也要算
		const NTE_MAINT_RE = /停服维护|停服更新|维护公告|版本更新|更新公告/;
		// 逐页向下的上限：维护公告会随新公告发布被挤到第 2、3 页，只看第 1 页会把"进行中的卡池"误判成未公布
		const NTE_MAX_LIST_PAGES = 3;
		// 每次最多试几篇公告正文（按从新到旧），避免某篇规则失效时白抓一堆
		const NTE_MAX_DETAILS = 3;

		// 取分页控件里的后续页地址（相对当前页）：<ul class="pagination"> … <a href="index1.html">2</a>
		function nteNextPageUrls(listUrl, html, seen) {
			const pg = String(html || "").match(/<ul class="pagination">[\s\S]*?<\/ul>/);
			if (!pg) return [];
			const dir = listUrl.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
			const out = [];
			for (const m of pg[0].matchAll(/href="(index\d+\.html)"/g)) {
				const u = dir + m[1];
				if (u !== listUrl && !seen.has(u) && !out.includes(u)) out.push(u);
			}
			return out;
		}

		// 逐页（index.html → index1.html → index2.html …）从新到旧找"带新卡池"的维护/版本更新公告，
		// 取第一篇能解析出当期卡池/活动的正文；"不停服更新"不含新卡池，跳过。
		// 三态：有当期内容 → 数据；列表页有公告但都不含当期内容（或"不停服更新"）→ null（未公布）；
		//      列表页**一条公告链接都没有** → 抛错（官网列表改版，让面板显示"卡池失败"而不是"未公布"）。
		async function fetchNteWanmei(listUrl, signal) {
			const ref = "https://yh.wanmei.com/";
			const seen = new Set();
			const queue = [listUrl];
			let details = 0;
			let sawAnyLink = false;
			while (queue.length && seen.size < NTE_MAX_LIST_PAGES) {
				const url = queue.shift();
				if (seen.has(url)) continue;
				seen.add(url);
				const html = await proxyFetchText(url, ref);
				if (/\/news\/gamebroad\/\d+\/\d+\.html/.test(html)) sawAnyLink = true;
				// 列表条目本身从新到旧：边收集边试，命中当期内容立刻返回
				for (const m of html.matchAll(NTE_ITEM_RE)) {
					if (!NTE_MAINT_RE.test(m[2]) || /不停服/.test(m[2])) continue;
					if (details >= NTE_MAX_DETAILS) return null;   // 试读额度用完（此时必然已见到公告链接）
					details++;
					const data = parseNteWanmei(await proxyFetchText("https://yh.wanmei.com" + m[1], ref));
					if (data) return data;
				}
				for (const u of nteNextPageUrls(listUrl, html, seen)) if (!queue.includes(u)) queue.push(u);
			}
			if (!sawAnyLink) throw new Error("nte-list-shape-changed");
			return null;
		}

		// 解析官网公告正文 → 当期卡池（全新限定S级角色所属限定棋盘）+ 当期活动（限时活动）
		function parseNteWanmei(html) {
			const text = String(html || "")
				.replace(/<script[\s\S]*?<\/script>/gi, " ")
				.replace(/<style[\s\S]*?<\/style>/gi, " ")
				.replace(/<[^>]+>/g, "\n")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\n\s*\n+/g, "\n").trim();
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			const data = { banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", event: "", eventDates: "", eventDatesRaw: "" };
			// 当期卡池：全新限定S级角色「X」→「Y」限定棋盘, 开放时间 M月D日维护更新后-M月D日05:59
			const newRole = text.match(/全新限定S级角色「([^」]+)」[\s\S]{0,400}?可通过「([^」]+)」限定棋盘获得[\s\S]{0,300}?开放时间：(\d+)月(\d+)日维护更新后-(\d+)月(\d+)日05:59/);
			if (newRole) {
				const mo = +newRole[3], d = +newRole[4], emo = +newRole[5], ed = +newRole[6];
				data.banner = `「${newRole[2]}」限定棋盘`;
				data.roles = newRole[1];
				data.bannerDates = `${fmt(mo, d, 11, 0)} ~ ${fmt(emo, ed, 5, 59)}`;
				data.bannerDatesRaw = data.bannerDates;
			}
			// 当期活动：「X」限时活动 活动时间：M月D日(维护更新后|hh:mm)-M月D日hh:mm
			const ev = text.match(/「([^」]+)」限时活动[\s\S]{0,200}?活动时间：(\d+)月(\d+)日(?:维护更新后|(\d{2}):(\d{2}))-(\d+)月(\d+)日(\d{2}):(\d{2})/);
			if (ev) {
				const sMo = +ev[2], sD = +ev[3], sH = ev[4] ? +ev[4] : 11, sMi = ev[5] ? +ev[5] : 0;
				const eMo = +ev[6], eD = +ev[7], eH = +ev[8], eMi = +ev[9];
				data.event = ev[1];
				data.eventDates = `${fmt(sMo, sD, sH, sMi)} ~ ${fmt(eMo, eD, eH, eMi)}`;
				data.eventDatesRaw = data.eventDates;
			}
			if (!data.banner) return null;
			return data;
		}

		// 通用抓取网页文本：MediaWiki api.php（action=parse）→ JSON 的 parse.text；其它 URL → 原始 HTML
		async function fetchHtmlText(url, signal) {
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error("http-" + res.status);
			if (/action\s*=\s*parse/i.test(url)) {
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return text;
			}
			return res.text();
		}

		// 通用卡池解析（新增自定义条目的"卡池来源"地址用）：
		// 依次尝试 bwiki 式「时间+版本」表、方舟式「限时寻访」表、GachaTracker 式日期表、
		// Next.js SPA（canmoe 等，页面无表格、数据在组件 chunk 里），选当期；
		// 全部失败返回 null（调用方按解析失败处理，不做可达性健康检查）
		async function tryParseGenericGacha(url, signal) {
			const html = await fetchHtmlText(url, signal);
			const now = nowMs();
			const cur = selectCurrent(parseAllBwiki(html), now) || selectCurrent(parseArknights(html), now);
			if (cur && cur.banner && cur.bannerDates) return cur;
			const gt = parseGachaTracker(html);
			if (gt && gt.banner && gt.bannerDates) return gt;
			// Next.js SPA：HTML 无表格数据，定位组件 chunk 后抓 chunk JS 解析。
			// chunk 与页面同源：页面能直连（CORS 允许）时 chunk 直连，否则经 host 代理。
			const chunks = nextJsChunkUrls(html, "BannerCalendar", url);
			for (const c of chunks) {
				try {
					const js = await fetchHtmlText(c, signal);
					// 只调一次：parseCanmoe 与 parseCanmoeLoose 是同一实现，旧写法 a || a 在最重的解析
					// （chunk 的括号平衡扫描）上白跑两遍，而"没命中当期"恰恰是最常见的情况
					const d = parseCanmoe(js);
					if (d && d.banner && d.bannerDates) return d;
				} catch { /* 下一个 chunk */ }
			}
			return null;
		}

		// 通用活动解析：扫描含「时间」（或「活动时间」）表头的表格，行内找时间与名称列，选当期
		// 起始为"版本更新后"等无日期文本时保留 startTs=null，由 selectCurrent 的 fillMissingStarts 补全
		function collectGenericEvents(html) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				// 「类型」列（如 版本活动/常规活动/剧情活动）→ 用于活动外显的类别优先级
				const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim());
				const catIdx = heads.findIndex((h) => /类型|類型/.test(h));
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/<td/i.test(row)) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]).trim());
					if (tds.length < 2) continue;
					// 时间列（含日期/区间）与名称列分开
					let name = "", time = "";
					for (const td of tds) {
						if (!time && /20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|[~～]/.test(td)) time = td;
						else if (td && !name) name = td;
					}
					if (!time || !name) continue;
					// 名字里偶发混进图片文件名残渣（如「文件:巡星之礼第二十六期.png 」）→ 去掉该前缀
					name = name.replace(/^文件:[^\s]*?\.(?:png|jpe?g|gif|webp|svg)\s*/i, "").trim();
					if (!name) continue;
					const range = parseRange(time);
					// 起始可为 null（"版本更新后"），结束时间必须有效
					if (range.endTs == null) continue;
					items.push({ banner: name, cat: catIdx >= 0 ? (tds[catIdx] || "") : "", ...range, isMain: true });
				}
			}
			return items;
		}

		// 当期活动（外显取 selectCurrent 的那条，行为同旧版）
		function parseGenericEvents(html) {
			return selectCurrent(collectGenericEvents(html), nowMs());
		}

		// Bwiki 卡池列载荷（原神/星铁）：外显沿用 selectCurrent（同窗口主池角色合并、武器/光锥池不入选）；
		// bannerHover 列出同期全部主池（每池"池名：角色"+时间；窗口相同则合并时间；结束时间升序）
		function bwikiGachaPayload(html) {
			const items = parseAllBwiki(html);
			// 页面拿到了却连一行候选都没有 → wiki 表结构变了（抛错，面板显示"卡池失败"）；
			// 有候选但都不覆盖当前时刻 → 下面返回 null（未公布）。这两件事必须分开。
			if (items.length === 0) throw new Error("bwiki-gacha-no-table");
			// selectCurrent 会就地补全缺失起点（fillMissingStarts），故先取快照
			const snapshot = items.map((it) => ({ banner: it.banner, roles: it.roles, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw, isMain: it.isMain }));
			const cur = selectCurrent(items, nowMs());
			if (!cur) return null;
			const now = nowMs();
			const pools = snapshot
				.filter((it) => it.isMain && it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now))
				.map((it) => ({
					name: it.banner,
					label: `${it.banner}${it.roles ? `\uFF1A${cleanRoles(it.roles)}` : ""}`,
					startTs: it.startTs,
					endTs: it.endTs,
					raw: it.raw
				}));
			return { ...cur, bannerHover: buildPoolHover(pools) };
		}

		// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）。
		// 注意 selectCurrent 会就地补全缺失起点（fillMissingStarts），故这里只取快照自行排序，
		// 避免"版本更新后 ~ 未来"这类起点未给的行被补成未来起点而漏掉。
		// 只有 1 条时 buildEventHover 返回 ""，由 UI 退回单条展示（兜底）。
		function genericEventPayload(html) {
			const items = collectGenericEvents(html);
			// 页面拿到了却连一行候选都没有 → 活动表结构变了（抛错 = "活动失败"）；
			// 有候选但当期没有覆盖现在的 → 下面返回 null（未公布）
			if (items.length === 0) throw new Error("bwiki-event-no-table");
			const snapshot = items.map((it) => ({ name: it.banner, cat: it.cat || "", startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw }));
			const now = nowMs();
			const active = sortEventItems(snapshot.filter((it) => it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now)));
			if (active.length === 0) return null;
			// 外显：类别优先（剧情/叙事、限时高难），同级内结束时间升序；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			return {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: buildEventHover(active)
			};
		}

		// 明日方舟（PRTS 活动一览）：表格含「活动开始时间」列 + 隐藏 data-time="开始秒,结束秒"（Unix 秒）。
		// 开始时间用第一列文本（"2026-08-22 04:00"），结束时间用 data-time 第二个值（UTC 秒 → +08）。
		// 注意 data-time 第一个值是页面缓存时刻（非开始时间），故开始以文本列为准。
		// 活动名带核心分类前缀（"支线故事：墟·复刻"）：分类取第三列 <a title="分类:XXX"> 链接，
		// 核心分类 = 排除"复刻活动"（修饰词）后的第一个。
		function collectPrtsEvents(html) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/data-time="(\d+),(\d+)"/.test(row)) continue;
					const tm = row.match(/data-time="(\d+),(\d+)"/);
					if (!tm) continue;
					const endTs = Number(tm[2]) * 1000; // 结束（UTC 秒 → ms）
					if (!endTs) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
					if (tds.length < 3) continue;
					// 名称：第二列第一个 <a> 的文本（"墟·复刻"），避开状态徽章与 <script> 内容
					const aM = tds[1].match(/<a[^>]*>([\s\S]*?)<\/a>/);
					const name = aM ? stripTags(aM[1]).trim() : "";
					if (!name) continue;
					// 分类：第三列所有 <a title="分类:XXX">；核心分类排除"复刻活动"修饰后取第一个
					const catLinks = [...tds[2].matchAll(/title="分类:([^"]+)"/g)].map((m) => m[1]);
					let coreCat = "";
					if (catLinks.length > 0) {
						coreCat = catLinks.find((c) => c !== "\u590D\u523B\u6D3B\u52A8") || catLinks[0];
					} else {
						coreCat = stripTags(tds[2]).replace(/\s+/g, " ").trim();
					}
					const label = coreCat ? `${coreCat}\uFF1A${name}` : name;
					// 开始：第一列文本（"2026-08-22 04:00"）
					const st = parseTime(stripTags(tds[0]).trim());
					items.push({
						banner: label,
						cat: coreCat,
						...range2(st, endTs),
						isMain: true
					});
				}
			}
			return items;
		}

		// 当期活动（外显取 selectCurrent 的那条，行为同旧版）
		function parsePrtsEvents(html) {
			return selectCurrent(collectPrtsEvents(html), nowMs());
		}

		// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）
		function prtsEventPayload(html) {
			const items = collectPrtsEvents(html);
			const snapshot = items.map((it) => ({ name: it.banner, cat: it.cat || "", startTs: it.startTs, endTs: it.endTs, raw: it.raw }));
			const now = nowMs();
			const active = sortEventItems(snapshot.filter((it) => it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now)));
			if (active.length === 0) return null;
			// 外显：类别优先（支线故事/危机合约等 vs 登录活动），同级内结束时间升序
			const primary = pickEventPrimary(active) || active[0];
			return {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: buildEventHover(active)
			};
		}
		// PRTS 起止 → 统一文本（parsePrtsEvents 内部用）
		function range2(st, endTs) {
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			const startTs = st && st.ts != null ? st.ts : null;
			return {
				startTs,
				endTs,
				startText: st && st.text ? st.text : "",
				endText: fmt(endTs),
				raw: `${st && st.text ? st.text : ""} ~ ${fmt(endTs)}`.trim()
			};
		}

		// 终末地（Game8 英文站）：活动排期表，条目形如
		// <a class="a-link" href="...">Bedazzling Dawnstar Sign-In</a><br>(Version 1.4)<br>08/09/26 - 09/02/26
		// 日期为美式 MM/DD/YY；多个并行当期活动时选"结束最晚"（覆盖全部当期窗口）。
		// 无起止区间（只有开始日，如 "07/16"）的条目跳过。
		function parseGame8Events(html) {
			const items = [];
			for (const m of html.matchAll(/<a class="a-link"[^>]*>([^<]+)<\/a><br>\((Version[^)]*)\)<br>([^<]*)/g)) {
				const period = m[3].trim();
				if (!/^\d{1,2}\/\d{1,2}\/\d{2}\s*-\s*\d{1,2}\/\d{1,2}\/\d{2}/.test(period)) continue;
				const mm = period.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2})/);
				if (!mm) continue;
				const y = 2000 + Number(mm[3]);
				const a = new Date(y, Number(mm[1]) - 1, Number(mm[2]), 0, 0);
				let b = new Date(y, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				if (b < a) b = new Date(y + 1, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				items.push({
					banner: m[1].trim(),
					roles: "",
					startTs: a.getTime(),
					endTs: b.getTime(),
					isMain: true
				});
			}
			if (items.length === 0) return null;
			const now = nowMs();
			// 当期（进行中）选结束最晚；无当期时返回 null
			const cur = items
				.filter((it) => it.startTs <= now && it.endTs >= now)
				.sort((x, y) => y.endTs - x.endTs)[0];
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: cur.banner,
				roles: "",
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`,
				bannerDatesRaw: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
			};
		}

		// parseGame8Events 的宽松回退：容忍 <a> 属性顺序/空白变化。仅在主解析未命中时使用。
		function parseGame8EventsLoose(html) {
			const items = [];
			for (const m of html.matchAll(/<a[^>]*>\s*([^<]+?)\s*<\/a>[\s\S]*?\(Version[^)]*\)[\s\S]*?(\d{1,2}\/\d{1,2}\/\d{2,4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{2,4})/g)) {
				const period = m[2].trim();
				const mm = period.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
				if (!mm) continue;
				const y = mm[3].length === 2 ? 2000 + Number(mm[3]) : Number(mm[3]);
				const a = new Date(y, Number(mm[1]) - 1, Number(mm[2]), 0, 0);
				let b = new Date(y, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				if (b < a) b = new Date(y + 1, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				items.push({ banner: m[1].trim(), roles: "", startTs: a.getTime(), endTs: b.getTime(), isMain: true });
			}
			if (items.length === 0) return null;
			const now = nowMs();
			const cur = items.filter((it) => it.startTs <= now && it.endTs >= now).sort((x, y) => y.endTs - x.endTs)[0];
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: cur.banner,
				roles: "",
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`,
				bannerDatesRaw: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
			};
		}

		// 终末地（Game8 经 host 代理，无 CORS）：活动排期页
		async function fetchGame8Endfield(pageUrl) {
			const html = await proxyFetchText(pageUrl, "https://game8.co/");
			return parseGame8Events(html) || parseGame8EventsLoose(html);
		}

		// 从 fz.wiki 页面（Next.js App Router）内联 RSC flight payload 中抽取 contentJson 的 JSON 字符串。
		// 数据被序列化为 self.__next_f.push([1,"..."])；拼接后按引号转义还原，再按大括号平衡取 contentJson 对象。
		function extractFzContentJson(html) {
			const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
			let full = "";
			let m;
			while ((m = re.exec(html))) {
				try { full += JSON.parse('"' + m[1] + '"'); } catch { full += m[1]; }
			}
			if (!full.includes('"contentJson"')) return null;
			const ci = full.indexOf('"contentJson"');
			let start = full.indexOf("{", ci);
			if (start < 0) return null;
			let depth = 0, i = start, inStr = false, esc = false;
			for (; i < full.length; i++) {
				const c = full[i];
				if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
				if (c === '"') { inStr = true; continue; }
				if (c === "{") depth++;
				else if (c === "}") { depth--; if (depth === 0) break; }
			}
			try { return JSON.parse(full.slice(start, i + 1)); } catch { return null; }
		}

		// 终末地（FZ Wiki /wiki/活动）：页面 RSC payload → 覆盖当前时刻的活动列表。
		// 活动节点有三种历史结构，全部兼容：
		//   ① endfieldCardActivityIndex.attrs.activities[]（最早）
		//   ② 独立子节点 type=*endfieldCardActivityIndex__activities（字段在自身 attrs）
		//   ③ endfieldCardActivityIndex.content[] → wikiCardItem.attrs.data（当前线上结构）
		// 只收"有明确起止"的活动（timeRanges 末段的 open+close 都非空），
		// 与旧行为一致——无 close 的是新手/每周/引导等常驻活动，不当作当期活动。
		// 时间格式 "2026/9/2 7:00:00"；外显=排序第一条（结束最早的），悬停按同序逐行。
		function parseFzWikiActivities(html, now) {
			const obj = extractFzContentJson(html);
			if (!obj) return null;
			const acts = [];
			const pushAct = (name, tags, trs) => {
				if (typeof name !== "string" || !name) return;
				if (!Array.isArray(trs) || trs.length === 0) return;
				const tr = trs[trs.length - 1];
				if (!tr || !tr.open || !tr.close) return;
				acts.push({ name, tags: tags || [], open: tr.open, close: tr.close });
			};
			(function walk(n) {
				if (!n || typeof n !== "object") return;
				if (Array.isArray(n)) { n.forEach(walk); return; }
				// ① 旧结构：活动在父节点 attrs.activities
				if (n.type === "endfieldCardActivityIndex" && Array.isArray(n.attrs?.activities)) {
					for (const a of n.attrs.activities) pushAct(a.name, a.tags, a.timeRanges);
				}
				// ② 旧结构：独立的 __activities 子节点，字段在各自 attrs 上
				if (n.attrs && typeof n.type === "string" && n.type.includes("endfieldCardActivityIndex__activities")) {
					pushAct(n.attrs.name, n.attrs.tags, n.attrs.timeRanges);
				}
				// ③ 当前结构：endfieldCardActivityIndex.content[] → wikiCardItem.attrs.data
				if (n.type === "endfieldCardActivityIndex" && Array.isArray(n.content)) {
					for (const c of n.content) {
						const d = c && c.attrs && c.attrs.data;
						if (d) pushAct(d.name, d.tags, d.timeRanges);
					}
				}
				for (const k of Object.keys(n)) walk(n[k]);
			})(obj);
			// 一条活动都没解析出来 → 页面结构变了（不是"当期没活动"）：抛错让该侧记 down，
			// 面板会显示"活动失败"，而不是伪装成"新活动未公布"（历史教训：源站改版长期静默失灵）。
			if (acts.length === 0) throw new Error("fz-wiki-no-activities");
			const parseT = (s) => new Date(String(s).replace(/\//g, "-")).getTime();
			const t0 = now || nowMs();
			// 覆盖当前时刻的活动统一排序（③ 结束时间升序）供悬停；外显另按类别优先挑选
			const activeActs = sortEventItems(acts
				.filter((a) => parseT(a.open) <= t0 && parseT(a.close) >= t0)
				.map((a) => ({ name: a.name, tags: (a.tags || []).join("/"), startTs: parseT(a.open), endTs: parseT(a.close) })));
			// 解析到活动、但当期没有覆盖当前时刻的 → 返回 null（这一侧记 nomatch = "新活动未公布"）
			if (activeActs.length === 0) return null;
			const primary = pickEventPrimary(activeActs) || activeActs[0]; // 叙事活动/挑战活动优先于签到类
			const win = fmtWindow(primary.startTs, primary.endTs);
			return {
				banner: primary.name,
				bannerDatesRaw: win,
				bannerDates: win,
				eventHover: buildEventHover(activeActs)
			};
		}

		// 终末地（FZ Wiki 经 host 代理，无 CORS）：活动排期页。
		// 三态口径：有当期活动 → 数据；解析到活动但没有当期 → null（nomatch）；
		// 页面结构变了/一条都解析不出 → parseFzWikiActivities 抛错（down）。
		async function fetchFzWikiEndfield(pageUrl, now = nowMs()) {
			const html = await proxyFetchText(pageUrl, "https://fz.wiki/");
			return parseFzWikiActivities(html, now);
		}

		// 通用活动源解析（自定义条目/自定义活动来源地址用）：抓取页面 → parseGenericEvents → {event, eventDates}
		async function tryParseGenericEvent(url, signal) {
			const html = await fetchHtmlText(url, signal);
			const cur = parseGenericEvents(html);
			if (cur && cur.banner) return {
				event: cur.banner,
				eventDates: cur.bannerDates || "",
				eventDatesRaw: cur.bannerDatesRaw || cur.bannerDates || ""
			};
			return null;
		}

		// 原神（bwiki SMW 语义查询）：活动一览页数据在 JS 动态加载（Dquery + SMW），
		// 改用 api.php?action=ask 直接查询「分类:活动」的开始/结束时间，选当期。
		// 属性：名称/开始时间/结束时间/所属版本；结束时间 9999/01/01 为永久活动占位（跳过）。
		// 查询 URL 由 fetchYsActivity 构造，浏览器直连（api.php 带 origin=* 有 CORS）。
		function parseSmwActivity(json) {
			const results = json?.query?.results || {};
			const now = nowMs();
			const covering = [];
			// SMW timestamp 是 UTC 秒，raw 形如 "1/2026/8/28/10/0/0/0"（服务器本地时间 +08）。
			// 用 raw 直接构造本地时间，避免 UTC 秒被本地时区再偏移。
			const parseRaw = (v) => {
				if (!v) return null;
				if (v.raw != null) {
					const p = String(v.raw).split("/");
					if (p.length >= 8) {
						const y = Number(p[1]), mo = Number(p[2]), d = Number(p[3]), h = Number(p[4]), mi = Number(p[5]);
						if (y && mo && d) return new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
					}
				}
				// 回退：value 若是严格 ISO 本地时间则用之（避免把展示文本误判为时间）
				const iso = v.value != null ? String(v.value) : "";
				if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}/.test(iso)) {
					const t = new Date(iso.replace(" ", "T")).getTime();
					if (!Number.isNaN(t)) return t;
				}
				return null;
			};
			for (const [title, r] of Object.entries(results)) {
				const p = r.printouts || {};
				const nameArr = p["名称"] || [];
				const name = Array.isArray(nameArr) && nameArr[0] ? String(nameArr[0]) : title;
				const startTs = parseRaw(p["开始时间"]?.[0]);
				const endTs = parseRaw(p["结束时间"]?.[0]);
				if (startTs == null || endTs == null) continue;
				// 永久活动占位（9999 年）跳过
				if (endTs > 4102444800000) continue; // 2100-01-01
				if (startTs <= now && endTs >= now) {
					// 类型属性（如 剧情活动/常规活动/版本活动）→ 活动外显的类别优先级。
					// 注意 SMW 这里返回的是字符串数组（不是 {fulltext} 值对象），两种形态都兼容。
					const catArr = p["类型"] || [];
					const cat = catArr
						.map((x) => (typeof x === "string" ? x : String((x && (x.fulltext || x.value)) || "")))
						.filter(Boolean)
						.join("/");
					covering.push({ name, cat, startTs, endTs });
				}
			}
			if (covering.length === 0) return null;
			// 悬停按结束时间升序；外显按类别优先（剧情活动/挑战类优先于常规/网页类）
			const ordered = sortEventItems(covering);
			const best = pickEventPrimary(ordered) || ordered[0];
			const win = fmtWindow(best.startTs, best.endTs);
			return {
				banner: best.name,
				roles: "",
				bannerDates: win,
				bannerDatesRaw: win,
				eventHover: buildEventHover(ordered)
			};
		}

		// 原神 SMW 活动查询（经 origin=* 直连）
		// 返回 EVENT_FETCHERS 契约格式 {event, eventDates, eventDatesRaw}（parseSmwActivity 产出卡池格式，这里转换）
		async function fetchYsActivity(signal) {
			const nowYear = new Date(nowMs()).getFullYear();   // 走注入时钟（core 不得直接读宿主时钟）
			const q = "[[\u5206\u7C7B:\u6D3B\u52A8]][[\u7ED3\u675F\u65F6\u95F4::>" + nowYear + "/01/01]]|?\u540D\u79F0|?\u5F00\u59CB\u65F6\u95F4|?\u7ED3\u675F\u65F6\u95F4|?\u7C7B\u578B|sort=\u5F00\u59CB\u65F6\u95F4|order=desc|limit=60";
			const apiUrl = "https://wiki.biligame.com/ys/api.php?action=ask&query=" + encodeURIComponent(q) + "&format=json&origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const d = parseSmwActivity(json);
			if (!d) return null;
			return {
				event: d.banner,
				eventDates: d.bannerDates || "",
				eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "",
				eventHover: d.eventHover || ""
			};
		}

		// ---- 抓取器工厂 ----
		// mkMediaWiki：MediaWiki api.php JSON 源（追加 &origin=* 绕过 CORS）
		// mkRaw：直接抓取原始 HTML（非 MediaWiki 源，如 GachaTracker）
		// 经 host 同源代理的来源（蔚蓝系列 / 终末地 wiki.gg / 1999 等）不用工厂包装：
		// 其抓取器内部自行调用 proxyFetchText / proxyFetchJson（绕过 CORS 与 Referer 反爬）。
		// 抓取器签名：async (url, signal) → 数据对象 | null
		function mkMediaWiki(parse) {
			return async (url, signal) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: { Accept: "application/json" } });
				if (!res.ok) throw new Error("http-" + res.status);
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return parse(text);
			};
		}
		function mkRaw(parse) {
			return async (url, signal) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: { Accept: "application/json" } });
				if (!res.ok) throw new Error("http-" + res.status);
				return parse(await res.text());
			};
		}
		// bwiki 通用"选当期"包装（原神/星铁/绝区零/方舟）
		const pickCurrent = (parse) => (html) => selectCurrent(parse(html), nowMs());
		//#endregion

		//#region proxy fetchers（经 host 代理）与统一来源注册表
		// 中文时间解析（繁体/简体共用）：
		// "8月18日(二)維護後" / "9月1日(二)上午9點59分" / "晚間10點59分" / "08月20日 14:00"
		function parseZhTime(raw, nowYear) {
			const s = String(raw).trim();
			const md = s.match(/(\d{1,2})月(\d{1,2})日/);
			if (!md) return null;
			const mo = Number(md[1]), d = Number(md[2]);
			let h = 0, mi = 0;
			const tm = s.match(/(上午|下午|中午|凌晨|晚上|晚間)?\s*(\d{1,2})[點点](\d{1,2})?[分]?/);
			if (tm) {
				let hh = Number(tm[2]);
				const mm = tm[3] ? Number(tm[3]) : 0;
				const period = tm[1] || "";
				if ((period === "下午" || period === "晚上" || period === "晚間") && hh < 12) hh += 12;
				if (period === "中午" && hh < 12) hh += 12;
				if (period === "凌晨" && hh === 12) hh = 0;
				h = hh; mi = mm;
			}
			const ts = new Date(nowYear, mo - 1, d, h, mi).getTime();
			return { ts, text: `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
		}

		// 经 host 代理抓取文本 / JSON 两个函数的**实现**已移到外壳（92-dsh-env.js），
		// core 侧只在 15-env.js 保留同名薄封装（转调 coreEnv.transport）——这是 core 零宿主依赖的接缝之一。

		// 解析繁体时间段："8月18日(二)維護後 ~ 9月1日(二)上午9點59分"
		// 跨年（如 12月30日 ~ 1月5日）：结束月份小于开始月份 → 结束端按"下一年"解析；
		// 否则 end 会早于 start，当期会被误判成"未公布"（每年 12 月底~1 月初复发）。
		function parseBaZhRange(raw, nowYear) {
			const s = stripTags(raw);
			const parts = s.split(/[~～]/).map((x) => x.trim());
			if (parts.length < 2) return null;
			const moOf = (x) => { const m = String(x).match(/(\d{1,2})月/); return m ? Number(m[1]) : null; };
			const am = moOf(parts[0]), bm = moOf(parts[1]);
			const a = parseZhTime(parts[0], nowYear);
			const b = parseZhTime(parts[1], am != null && bm != null && bm < am ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
		}

		// 解析更新日誌正文的日程表 → 行数组 {cat, name, range, dateRaw}
		function parseBaLogRows(content, nowYear) {
			const rows = [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
			const items = [];
			for (const row of rows) {
				const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
				if (cells.length < 3) continue;
				const cat = cells[1] || "";
				const name = cells[2] || "";
				if (!cat || !name) continue;
				let range = parseBaZhRange(cells[0], nowYear);
				let relStart = false;
				let openEnded = false;
				if (!range && /維護(?:結束)?後|維護後/.test(cells[0])) {
					// 起点写"維護結束後"的日程行：先解析结束端，起点留待按本期维护结束时间补全（fetchBaGlobal）
					const parts = stripTags(cells[0]).split(/[~～]/).map((x) => x.trim());
					if (parts.length >= 2) {
						const b = parseZhTime(parts[parts.length - 1], nowYear);
						if (b) { range = { startTs: null, endTs: b.ts, startText: null, endText: b.text, raw: stripTags(cells[0]) }; relStart = true; }
					} else {
						// 只有「維護後」、官方未给结束端（如常駐化活動）：保留该行，结束端留空、时间按原文展示，不做推算
						range = { startTs: null, endTs: null, startText: null, endText: null, raw: stripTags(cells[0]) };
						relStart = true;
						openEnded = true;
					}
				}
				items.push({ cat, name, range, dateRaw: cells[0], relStart, openEnded });
			}
			return items;
		}

		// 蔚蓝档案·国际服：nexon 官方「更新日誌」board(3352) → 当期卡池 + 当期活动
		// 一次请求拿到更新日誌正文，从日程表同时提取 特選招募（卡池）与 活動劇情/總力戰（活动）
		async function fetchBaGlobal(logListUrl, signal, now = nowMs()) {
			const ref = "https://forum.nexon.com/bluearchiveTW/";
			const list = await proxyFetchJson(logListUrl, ref);
			const threads = Array.isArray(list?.threads) ? list.threads : [];
			// 每篇日志的维护日取标题日期（"8/18(二) 更新日誌"）；日期跨年按当前年推断
			const y = new Date(now).getFullYear();
			const threadDate = (t) => {
				const m = String(t.title || "").match(/(\d{1,2})\/(\d{1,2})\(/);
				if (!m) return null;
				let d = new Date(y, Number(m[1]) - 1, Number(m[2]), 0, 0);
				if (d.getTime() > now + 45 * 864e5) d = new Date(y - 1, Number(m[1]) - 1, Number(m[2]), 0, 0);
				return d.getTime();
			};
			const dated = threads
				.map((t) => ({ t, ts: threadDate(t) }))
				.filter((x) => x.ts != null && /更新日誌/.test(String(x.t.title || "")))
				.sort((a, b) => b.ts - a.ts);
			// 窗口匹配：日志 i 覆盖 [其维护日, 下一篇(更早)日志维护日)；取"最新且不晚于 now"的一篇
			const pick = dated.find((x) => x.ts <= now);
			if (!pick?.t?.threadId) return null;
			const detail = await proxyFetchJson(`https://forum.nexon.com/api/v1/thread/${pick.t.threadId}?alias=bluearchiveTW&countryCode=KR`, ref);
			const content = typeof detail?.content === "string" ? detail.content : "";
			if (!content) return null;
			const nowYear = new Date(now).getFullYear();
			const rows = parseBaLogRows(content, nowYear);
			// 维护结束时刻：从正文维护段"日期…上午10點～下午2點"取结束钟点，
			// 用于把日程表里起点为"維護結束後"的行补成显式起点
			const logTxt = String(content).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
			const mEnd = logTxt.match(/日期\s*[：:]\s*\d{1,2}月\d{1,2}日(?:[^。\n]{0,60}?)[～~-]\s*(上午|下午|中午|晚上)(\d{1,2})點(?:\s*(\d{1,2})分?)?/);
			let maintEndTs = null, maintEndText = "";
			const dayBase = new Date(pick.ts);
			if (mEnd) {
				let hh = Number(mEnd[2]);
				if ((mEnd[1] === "下午" || mEnd[1] === "晚上") && hh < 12) hh += 12;
				if (mEnd[1] === "中午" && hh < 12) hh += 12;
				const mi = mEnd[3] ? Number(mEnd[3]) : 0;
				maintEndTs = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), hh, mi).getTime();
				maintEndText = `${String(dayBase.getMonth() + 1).padStart(2, "0")}-${String(dayBase.getDate()).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			}
			if (maintEndTs == null) { // 兜底：维护日 14:00
				maintEndTs = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), 14, 0).getTime();
				maintEndText = `${String(dayBase.getMonth() + 1).padStart(2, "0")}-${String(dayBase.getDate()).padStart(2, "0")} 14:00`;
			}
			for (const r of rows) {
				if (r.relStart && r.range && r.range.startTs == null) {
					r.range.startTs = maintEndTs;
					r.range.startText = maintEndText;
					// 结束端缺失的行不改写 raw：保留日程原文，避免出现"09-08 14:00 ~"这种半个区间
					if (!r.openEnded) r.range.raw = `${maintEndText} ~ ${r.range.endText ?? ""}`.trim();
				}
			}
			// 当期卡池：特別特選招募 / 特選招募（时间覆盖 now）
			const bannerRow = rows.find((r) => /特選招募/.test(r.cat) && r.range && r.range.startTs <= now && r.range.endTs >= now);
			// 当期活动候选：活動劇情 > 迷你活動 > 總力戰/大決戰/制約解除決戰/綜合戰術考試；
			// 常駐化活動（名稱含「常駐」）优先级最低；只有起点、官方未给结束端的行同样纳入候选
			const activeRow = (r) => !!r.range && r.range.startTs != null && r.range.startTs <= now &&
				(r.openEnded || (r.range.endTs != null && r.range.endTs >= now));
			const evTier = (r) => {
				if (/活動劇情/.test(r.cat)) return 1;
				if (/迷你活動/.test(r.cat)) return 2;
				if (/總力戰|大決戰|制約解除決戰|綜合戰術考試/.test(r.cat)) return 3;
				return 9;
			};
			const evCandidates = rows.filter((r) => evTier(r) < 9 && activeRow(r));
			// ③ 统一排序：结束时间升序（常驻/未给结束端的行 endTs 为空，自然排最后）；
			// 外显取排序第一条，悬停按同序逐行；长期/常驻玩法由 sortEventItems 一并剔除
			const evOrdered = sortEventItems(evCandidates.map((r) => ({
				name: r.name,
				cat: r.cat,
				startTs: r.openEnded ? null : r.range.startTs,
				endTs: r.openEnded ? null : r.range.endTs,
				raw: r.openEnded ? r.dateRaw : r.range.raw
			})));
			// 外显：类别优先（活動劇情/總力戰/大決戰 优先于 迷你活動/常駐类），同级内结束时间升序
			const eventRow = pickEventPrimary(evOrdered) || null;
			const evDates = eventRow
				? (eventRow.startTs != null && eventRow.endTs != null ? fmtWindow(eventRow.startTs, eventRow.endTs) : (eventRow.raw || ""))
				: "";
			const eventHover = buildEventHover(evOrdered);
			const data = {
				banner: "",
				roles: "",
				bannerDates: "",
				event: "",
				eventDates: ""
			};
			if (bannerRow) {
				data.banner = bannerRow.cat; // 如「特別特選招募」「特選招募」
				data.roles = baRoleName(bannerRow.name); // 蔚蓝三服角色名：保留括号后缀 + 全角括号转半角
				data.bannerDates = bannerRow.range.raw;
			} else if (eventRow) {
				// 无卡池行时至少给出活动
				data.banner = eventRow.name;
				data.bannerDates = evDates;
			}
			// 卡池列悬停：日程表里同期所有招募行（特選招募/特別特選招募 等），每池"类别：成员"一行 + 时间
			const recRows = rows.filter((r) => /招募/.test(r.cat) && r.range && r.range.startTs != null && r.range.endTs != null && r.range.startTs <= now && r.range.endTs >= now);
			const poolHover = buildPoolHover(recRows.map((r) => ({
				name: r.cat,
				label: `${r.cat}\uFF1A${baRoleName(r.name)}`,
				startTs: r.range.startTs,
				endTs: r.range.endTs,
				raw: r.range.raw
			})));
			if (poolHover) data.bannerHover = poolHover;
			if (eventRow) {
				data.event = eventRow.name; // 活动名（去掉"活動劇情："类类别前缀，精简展示）
				data.eventDates = evDates;
				if (eventRow.openEnded) data.eventDatesRaw = eventRow.dateRaw;
			}
			if (eventHover) data.eventHover = eventHover;
			if (!data.banner || !data.bannerDates) return null;
			return data;
		}

		// 终末地（wiki.gg 经 host 代理）：抓取 Headhunting/Banners HTML → parseEndfieldCurrent
		// wiki.gg 校验 Referer（非 wiki.gg 域名 403），经代理后 Referer=目标 origin 满足要求。
		// 注意：这个地址是 MediaWiki 的 **api.php**，返回的是 JSON（`{"parse":{"text":"<html>"}}`）——
		// 必须取 parse.text 再解析。旧实现直接把原始 JSON 串喂给解析器，于是 id="Current" 在 JSON 里是
		// 转义形式（id=\"Current\"）永远匹配不到 → 该备选源长期"抓得到但解析不出"（这才是真根因）。
		async function fetchEndfieldWikiGg(proxyUrl) {
			const json = await proxyFetchJson(proxyUrl, "https://endfield.wiki.gg/");
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return parseEndfieldCurrent(html);
		}

		// ---- 蔚蓝档案·日服 官方公告（api-web.bluearchive.jp）----
		// 「ピックアップ募集紹介」条目结构（同一公告内多池、逐池给出）：
		//   ▼ピックアップ対象
		//   ピックアップ名： 「そして夏は爆破で終わる！」
		//   ピックアップ生徒：★3「カスミ(水着)」
		//   ▼実施期間 2026年9月9日(水) メンテナンス後 ~ 2026年9月23日(水・祝) 10:59
		// 时间按 JST(+09:00) 解析（展示时转本地）；起点写「メンテナンス後」时取同期维护公告
		// 「▼実施時間 … ～ … 17:00前後」的结束时刻。活动取同期「イベント」条目的開催期間。
		function parseBaJpNews(json, now = nowMs()) {
			const rows = Array.isArray(json?.data?.rows) ? json.data.rows : [];
			const clean = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\s+/g, " ").trim();
			// JST 时间戳（JST = UTC+9）
			const jstTs = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);
			const jpDate = (s) => {
				const m = String(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日[^0-9]{0,8}(\d{1,2}):(\d{2})/);
				return m ? jstTs(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
			};
			const afterMaint = (s) => /メンテナンス後/.test(String(s));
			// 维护结束时刻（"メンテナンス後"的起点）：最新一篇维护公告的実施時間 结束端
			let maintEnd = null;
			for (const it of rows) {
				const m = clean(it.content).match(/実施時間\s*([^~～]{4,48})[~～]\s*([^前]{4,48})/);
				if (!m) continue;
				const e = jpDate(m[2]);
				if (e != null) { maintEnd = e; break; }
			}
			// 当期卡池：最新一篇含「ピックアップ名／ピックアップ生徒」的募集公告
			let pools = null;
			for (const it of rows) {
				const text = clean(it.content);
				if (!/ピックアップ募集/.test(text) || !/ピックアップ名/.test(text)) continue;
				const found = [...text.matchAll(/ピックアップ名：\s*「([^」]+)」\s*ピックアップ生徒：\s*(?:★\d)?「([^」]+)」/g)]
					.map((m) => ({ name: m[1], student: m[2] }));
				if (found.length === 0) continue;
				const windows = [...text.matchAll(/実施期間\s*([^~～]{4,64})[~～]\s*([^▼]{4,48})/g)].map((m) => {
					const a = m[1].trim(), b = m[2].trim();
					const startTs = afterMaint(a) ? maintEnd : jpDate(a);
					const endTs = jpDate(b);
					return { startTs: startTs ?? null, endTs: endTs ?? null, raw: `${afterMaint(a) ? "メンテナンス後" : a} ~ ${b}` };
				});
				const fallback = windows[0] || { startTs: null, endTs: null, raw: "" };
				pools = found.map((f, i) => Object.assign({ name: f.name, student: f.student }, windows[i] || fallback));
				break;
			}
			if (!pools) return null;
			// 只保留覆盖当前时刻的池（起点缺省时按"结束在未来"宽松判定）
			const cur = pools.filter((p) => p.endTs != null && p.endTs >= now && (p.startTs == null || p.startTs <= now));
			if (cur.length === 0) return null;
			// 展示用的档期必须取"被选中的那个池"自己的窗口（cur[0]）—— 旧实现固定取 windows[0]，
			// 一旦当期命中的不是第一个池，就会显示"B 池名字 + A 池时间"，倒计时按错档期跑。
			const win0 = cur[0];
			const dates = win0.startTs != null && win0.endTs != null ? fmtWindow(win0.startTs, win0.endTs) : (win0.raw || "");
			const data = {
				banner: cur[0].name,
				roles: [...new Set(cur.map((p) => p.student))].join("、"),
				bannerDates: dates,
				bannerDatesRaw: win0.raw || dates,
				startTs: cur[0].startTs,
				endTs: cur[0].endTs
			};
			// 卡池列悬停：每池「池名：生徒」一行 + 时间（同窗口合并，结束时间升序）
			const hover = buildPoolHover(cur.map((p) => ({
				name: p.name,
				label: `${p.name}\uFF1A${p.student}`,
				startTs: p.startTs,
				endTs: p.endTs,
				raw: p.raw
			})));
			if (hover) data.bannerHover = hover;
			// 活动：同期「イベント」条目的開催期間
			for (const it of rows) {
				const sum = clean(it.summary);
				const text = clean(it.content);
				const m = (sum || text).match(/【(復刻)?イベント】「([^」]+)」/);
				if (!m) continue;
				const pr = text.match(/開催期間\s*([^~～]{4,64})[~～]\s*([^▼]{4,48})/);
				if (!pr) continue;
				const a = pr[1].trim(), b = pr[2].trim();
				const startTs = afterMaint(a) ? maintEnd : jpDate(a);
				const endTs = jpDate(b);
				if (startTs == null || endTs == null || startTs > now || endTs < now) continue;
				data.event = m[1] ? `${m[2]}（復刻）` : m[2];
				data.eventDates = fmtWindow(startTs, endTs);
				data.eventDatesRaw = `${afterMaint(a) ? "メンテナンス後" : a} ~ ${b}`;
				break;
			}
			return data;
		}

		// 日服卡池默认抓取器：官网新闻接口优先；失败或无当期募集 → 回退 GameKee 当期卡池（仅池名+档期）。
		// 只返回卡池字段：活动字段由活动源单独负责（卡池/活动解耦，避免活动源失败时静默混入官方活动）
		async function fetchBaJpGacha(url, signal, now = nowMs()) {
			try {
				const json = await proxyFetchJson(url, "https://bluearchive.jp/");
				const d = parseBaJpNews(json, now);
				if (d) {
					delete d.event;
					delete d.eventDates;
					delete d.eventDatesRaw;
					return d;
				}
			} catch { /* 官方失败 → GameKee 兜底 */ }
			return fetchGameKeeBa("jp");
		}

		// 日服活动备选抓取器：同一个官方接口的「イベント」条目（只取 event 字段）
		async function fetchBaJpOfficialEvent(url, signal, now = nowMs()) {
			const json = await proxyFetchJson(url, "https://bluearchive.jp/");
			const d = parseBaJpNews(json, now);
			if (!d || !d.event) return null;
			return { event: d.event, eventDates: d.eventDates || "", eventDatesRaw: d.eventDatesRaw || d.eventDates || "" };
		}

		// ---- GameKee（蔚蓝档案）----
		// 解析标题里的排期：【8/18~9/01】 / 【8月26日 ~ 9月9日】 → {startText, endText, startTs, endTs}
		function parseGkRange(title, nowYear) {
			const m = String(title).match(/【([^】]+)】/);
			if (!m) return null;
			const inner = m[1].replace(/\s+/g, "");
			const parts = inner.split(/[~～\-—]/);
			if (parts.length < 2) return null;
			const moOf = (p) => { const md = p.match(/(\d{1,2})[\/月](\d{1,2})日?/); return md ? Number(md[1]) : null; };
			const parseGkTime = (p, year) => {
				// 8/18 或 8月18日（日服可能带 日）
				const md = p.match(/(\d{1,2})[\/月](\d{1,2})日?/);
				if (!md) return null;
				const mo = Number(md[1]), d = Number(md[2]);
				const ts = new Date(year, mo - 1, d, 0, 0).getTime();
				return { ts, text: `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} 00:00` };
			};
			// 跨年（如 【12/28~1/5】）：结束月份小于开始月份 → 结束端按"下一年"解析
			const am = moOf(parts[0]), bm = moOf(parts[1]);
			const a = parseGkTime(parts[0], nowYear);
			const b = parseGkTime(parts[1], am != null && bm != null && bm < am ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
		}

		// GameKee：按服务器拉当期卡池+活动（标题含排期）
		// serverKey: "jp"|"global"；返回 {banner, roles, bannerDates, event, eventDates}
		async function fetchGameKeeBa(serverKey) {
			const ref = "https://www.gamekee.com/ba/huodong/15";
			const headers = { "game-alias": "ba" };
			// 1. 目录树 → 找"当期活动 | 当期卡池"子条目
			const tree = await proxyFetchJson("https://www.gamekee.com/v1/wiki/entry?id=15", ref, headers);
			const list = tree?.data?.entry_list || [];
			let currentCat = null;
			const find = (nodes) => {
				for (const n of nodes || []) {
					// 名称可能含隐藏字符，用 includes 匹配
					if (String(n.name || "").includes("\u5F53\u671F\u6D3B\u52A8") && String(n.name || "").includes("\u5361\u6C60")) { currentCat = n; return; }
					if (n.child) find(n.child);
				}
			};
			find(list);
			if (!currentCat?.child) return null;
			const child = currentCat.child;
			// 找该服条目：日服(jp) 活动/卡池；国际服(global) 活动/卡池
			const isJp = serverKey === "jp";
			const kw = isJp ? "日服" : "国际服";
			const eventEntry = child.find((c) => c.name.includes(kw + "活动"));
			const bannerEntry = child.find((c) => c.name.includes(kw + "当期卡池"));
			// 2. 拉标题（含排期）
			const getTitle = async (entry) => {
				if (!entry?.content_id) return null;
				const d = await proxyFetchJson(`https://www.gamekee.com/v1/content/detail/${entry.content_id}`, ref, headers);
				return typeof d?.data?.title === "string" ? d.data.title : "";
			};
			const bannerTitle = bannerEntry ? await getTitle(bannerEntry) : "";
			const eventTitle = eventEntry ? await getTitle(eventEntry) : "";
			const nowYear = new Date(nowMs()).getFullYear();   // 走注入时钟（core 不得直接读宿主时钟）
			const data = { banner: "", roles: "", bannerDates: "", event: "", eventDates: "" };
			if (bannerTitle) {
				const rng = parseGkRange(bannerTitle, nowYear);
				if (rng) {
					// 卡池名：只去「(蔚蓝档案)(日服/国际服)当期卡池(评测)：」这类表头与末尾日期括号，
					// 池名里的标点（! ~ ！ 等）一律保留
					data.banner = String(bannerTitle)
						.replace(/^(?:蔚蓝档案)?\s*(?:日服|国际服|国服)?\s*(?:当期)?\s*(?:卡池|招募|评测)[^：:]*[:：]\s*/, "")
						.replace(/【[^】]*\d[^】]*】/g, "")
						.trim();
					data.bannerDates = rng.raw;
				}
			}
			if (eventTitle) {
				const rng = parseGkRange(eventTitle, nowYear);
				if (rng) {
					// 活动名：只删可识别的游戏/服别前缀与"活动攻略整理"类后缀 + 末尾日期括号；
					// 名字里的标点（! ~ ！ ～ 等）与「复刻」都保留
					// 如 "蔚蓝档案国际服 比赛开始~目标！满贯全垒打！~ 复刻活动攻略整理【09/01~09/15】"
					//    → "比赛开始~目标！满贯全垒打！~ 复刻"
					const cleaned = String(eventTitle)
						.replace(/【[^】]*\d[^】]*】/g, "")
						.replace(/^蔚蓝档案\s*/, "")
						.replace(/^(?:日服|国际服|国服)?\s*(?:当期)?\s*(?:活动|卡池)(?:攻略|评测)?[^：:]*[:：]\s*/, "")
						.replace(/^(?:日服|国际服|国服)\s*(?:当期)?\s*(?:活动|卡池)\s*/, "")
						.replace(/^(?:日服|国际服|国服)\s*[:：]?\s*/, "")
						.replace(/活动一图攻略整理|活动攻略整理|攻略整理$/, "")
						.trim();
					data.event = cleaned || String(eventTitle).replace(/【[^】]*\d[^】]*】/g, "").trim();
					data.eventDates = rng.raw;
				}
			}
			if (!data.banner || !data.bannerDates) return null;
			return data;
		}

		// 蔚蓝国服（官网 bluearchive-cn.com）：news/list → 最新维护更新说明 → 当期卡池/活动名 + 维护起止
		// 时间：维护日 14:00 ~ 下次维护前（约 +14 天，取维护日开始、预加载下一期预告前）
		async function fetchBaCn(listUrl, now = nowMs()) {
			const H = { "game-alias": "ba" };
			const ref = "https://bluearchive-cn.com/";
			const nowYear = new Date(now).getFullYear();
			const list = await proxyFetchJson(listUrl, ref, H);
			const rows = list?.data?.rows || [];
			const clean = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			// 窗口匹配：对最新的若干篇"维护更新说明"，按其正文首个维护时间（起）+14 天（卡池窗口）判定是否覆盖 now；
			// 列表 content 被截断时按 id 取详情补齐再判定；选覆盖 now 的那一篇（不再无条件取最新）
			const mains = rows.filter((n) => /维护更新说明/.test(n.title || ""));
			let maintTitle = null;
			let maintRaw = null;      // 选中那篇的**原始正文**：循环里已经为它抓过详情时直接复用，不再重复请求
			for (const it of mains.slice(0, 8)) {
				let raw = String(it.content || "");
				let txt = clean(raw);
				let first = txt.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
				if (!first && it.id) {
					try {
						const det = await proxyFetchJson(`https://bluearchive-cn.com/api/news/detail?id=${it.id}`, ref, H);
						raw = String(det?.data?.news?.content || "");
						txt = clean(raw);
						first = txt.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
					} catch { /* 跳过该候选 */ }
				}
				if (!first) continue;
				const mo = Number(first[1]), d = Number(first[2]);
				const startTs = new Date(nowYear, mo - 1, d, Number(first[3]), Number(first[4])).getTime();
				const endTs = new Date(nowYear, mo - 1, d + 14, 13, 59).getTime();
				if (startTs <= now && now <= endTs) { maintTitle = it; maintRaw = raw; break; }
			}
			if (!maintTitle?.id) return null;
			// 选中那篇若已经在上面抓过详情（列表 content 被截断的情况）→ 直接复用，省掉一次代理往返
			const content = maintRaw || String((await proxyFetchJson(`https://bluearchive-cn.com/api/news/detail?id=${maintTitle.id}`, ref, H))?.data?.news?.content || "");
			if (!content) return null;
			// HTML → 文本
			const text = String(content)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&ldquo;/g, "「").replace(/&rdquo;/g, "」")
				.replace(/&hellip;/g, "…").replace(/&times;/g, "×").replace(/&bull;/g, "·")
				.replace(/\n\s*\n+/g, "\n").trim();
			// 当期卡池名（第一个"更新限时招募【X】"或复刻）
			const bannerM = text.match(/更新限时招募【([^】]+)】/);
			const bannerR = text.match(/更新限时复刻招募【([^】]+)】/);
			// 当期活动名（第一个"更新限时活动【X】"）
			const eventM = text.match(/更新限时活动【([^】]+)】/);
			// 维护开始时间 "08月20日 14:00"
			const maintM = text.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			let bannerDates = "", eventDates = "";
			if (maintM) {
				const mo = Number(maintM[1]), d = Number(maintM[2]);
				const start = fmt(mo, d, Number(maintM[3]), Number(maintM[4]));
				// 卡池结束：约 14 天后（下一期维护）
				const end = new Date(nowYear, mo - 1, d + 14, 13, 59);
				bannerDates = `${start} ~ ${fmt(end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes())}`;
				// 活动结束：约 28 天后（蓝档国服活动通常比卡池多一期，如和乐庆典到 09-17 13:59）
				const eEnd = new Date(nowYear, mo - 1, d + 28, 13, 59);
				eventDates = `${start} ~ ${fmt(eEnd.getMonth() + 1, eEnd.getDate(), eEnd.getHours(), eEnd.getMinutes())}`;
			}
			// 公告里同期全部招募池（更新限时招募 / 更新限时限定复刻招募 / 更新限时复刻招募）：
			// 池名 + 该行成员名，如
			// 2、更新限时招募【夏日思绪长…】，…全新3★成员「桔梗（泳装）」、2★成员「莲华（泳装）」登场
			const recPools = [];
			for (const m of text.matchAll(/更新限时(?:限定复刻|复刻|)招募【([^】]+)】([^\n]*)/g)) {
				const members = [...new Set([...m[2].matchAll(/(?:\d★)?(?:限定)?成员\s*[「“"]([^」”"]+)[」”"]/g)].map((x) => baRoleName(x[1].trim())).filter(Boolean))];
				recPools.push({ name: m[1], members });
			}
			// 外显：合并同期各池成员（与其它游戏"同窗口角色合并"一致；此前只取第一个池的成员，导致外显不全）
			const roleNames = [...new Set(recPools.flatMap((p) => p.members))];
			const data = {
				banner: bannerM ? bannerM[1] : (bannerR ? `复刻·${bannerR[1]}` : ""),
				roles: roleNames.join("、"),
				bannerDates,
				event: eventM ? eventM[1] : "",
				eventDates
			};
			// 卡池列悬停：每池"池名：成员"一行；公告只给整期维护窗口 → 各池窗口相同，时间按"相同窗口合并"只在末尾写一遍
			if (maintM) {
				const mo = Number(maintM[1]), d = Number(maintM[2]);
				const sTs = new Date(nowYear, mo - 1, d, Number(maintM[3]), Number(maintM[4])).getTime();
				const eTs = new Date(nowYear, mo - 1, d + 14, 13, 59).getTime();
				const hover = buildPoolHover(recPools.map((p) => ({
					name: p.name,
					label: `${p.name}${p.members.length ? `\uFF1A${p.members.join("、")}` : ""}`,
					startTs: sTs,
					endTs: eTs,
					raw: bannerDates
				})));
				if (hover) data.bannerHover = hover;
			}
			if (!data.banner) return null;
			return data;
		}

		// 重返未来：1999 征集名增强源（小米游戏中心官方资讯流，SSR 页免登录可抓）
		// 官网资讯接口不发布征集名；小米游戏中心游戏页（game.xiaomi.com/game/62346241）的 SSR 数据
		// 含官方账号「神秘学研究员」最新 3 条资讯全文，其中「活动征集」公告带真实征集名与征集时间
		// （如【烈火悬流无尽】8/13 10:00-9/3 4:59、【湖的馈赠】自选六星 8/28 5:00-9/14 4:59）。
		// 主池优先：只认"征集时间覆盖当前时刻"且带定向 UP 的征集公告，且 UP 角色属于官网「新增角色」
		// （官方 SixStar 列表，如 赫多涅/纳西索斯）——自选六星池（无定向 UP）不作为主池；
		// 无主池匹配返回 null（由官网解析兜底显示角色名）。多条主池匹配取最新发布者。
		async function fetchXiaomiR99Gacha(gamePageUrl, officialSixStars) {
			const html = await proxyFetchText(gamePageUrl, "https://game.xiaomi.com/");
			const start = html.indexOf('"official":{"viewpoints":{"infos":[');
			if (start < 0) return null;
			const raw = html.slice(start);
			const marks = [...raw.matchAll(/\{"viewpointId":"/g)].map((x) => x.index);
			if (marks.length === 0) return null;
			const now = nowMs();
			const nowYear = new Date(now).getFullYear();   // 复用同一注入时钟（core 不得直接读宿主时钟）
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			let best = null;
			for (let i = 0; i < marks.length; i++) {
				const seg = raw.slice(marks[i], i + 1 < marks.length ? marks[i + 1] : raw.length);
				const title = (seg.match(/"title":"([^"]*)"/) || [])[1] || "";
				const texts = [...seg.matchAll(/"contentType":1,"positionIndex":\d+,"content":"([\s\S]*?)"/g)].map((x) => x[1]);
				const content = texts.join(" ").replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u002F/g, "/").replace(/\\n/g, " ");
				if (!/征集/.test(title + content)) continue;
				const nameM = title.match(/【([^】]+)】活动征集/) || content.match(/【([^】]+)】活动征集/);
				if (!nameM) continue;
				// 征集时间："8/28 5:00-9/14 4:59" / "8/13 10:00 - 9/3 4:59"
				const timeM = content.match(/征集(?:开放)?时间[◀◀:：\s]*(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\s*[-—~]\s*(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
				if (!timeM) continue;
				const sm = Number(timeM[1]), sd = Number(timeM[2]), sh = timeM[3] ? Number(timeM[3]) : 0, smi = timeM[4] ? Number(timeM[4]) : 0;
				const em = Number(timeM[5]), ed = Number(timeM[6]), eh = timeM[7] ? Number(timeM[7]) : 0, emi = timeM[8] ? Number(timeM[8]) : 0;
				const startTs = new Date(nowYear, sm - 1, sd, sh, smi).getTime();
				// 跨年（如 12/28-1/5）结束补下一年
				const endTs = new Date(em < sm ? nowYear + 1 : nowYear, em - 1, ed, eh, emi).getTime();
				if (startTs > now || endTs < now) continue; // 只取覆盖当期的征集
				// 主池判定：带定向 UP（【X】受邀概率UP）且 UP 角色属于官网新增角色
				const upM = title.match(/【([^】]+)】受邀概率UP/) || content.match(/【([^】]+)】受邀概率UP/);
				const upName = upM ? cleanRoles(upM[1]).replace(/[（）()].*$/, "") : "";
				const isMain = upName !== "" && Array.isArray(officialSixStars) && officialSixStars.includes(upName);
				if (!isMain) continue; // 自选六星池等非主池不作为当期卡池
				const cand = {
					banner: nameM[1],
					bannerDates: `${fmt(sm, sd, sh, smi)} ~ ${fmt(em, ed, eh, emi)}`,
					roles: upName,
					order: i
				};
				// 多条主池覆盖当期时取最新发布（feed 靠前者更新）
				if (!best || cand.order < best.order) best = cand;
			}
			return best ? { banner: best.banner, bannerDates: best.bannerDates, roles: best.roles } : null;
		}

		// ---- 重返未来：1999 官方游戏内公告（noticecp）----
		// 官网 CMS 公告只发布维护时间与活动名，**逐期征集起止**只出现在官方游戏内公告的
		// 「X.X「…」版本活动一览」里：正文是块状富文本（content 为 JSON 字符串），按
		// `「名称」类型` 分段 —— 征集段含【征集时间】+【征集说明】(6★/5★ UP)，活动段含【活动时间】。
		// 接口归属：notice.sl916.com 证书主体=广州深蓝互动网络科技有限公司（与官网 re.bluepoch.com
		// 同主体、同 EdgeOne CDN），免登录/无 CORS，经 host 代理读取；开源项目 MAA1999/M9A 长期使用
		// 同一接口（见 README 致谢）。一版本上下半场两期都列在同一篇里，下期常提前公布。
		// 征集类别 → 外显优先级（同类内先结束者优先，与其它游戏"越快结束越靠前"一致）
		const R99_POOL_TIERS = ["活动征集", "巡游限定征集", "限定复刻自选征集", "巡游限定复刻征集", "联动征集", "限定征集", "限时征集", "轮换征集"];

		// 块状富文本 → 纯文本行数组（保持原顺序）；content 不是预期的 JSON 数组时返回 null
		function r99NoticeLines(item) {
			const raw = item && item.contentMap && item.contentMap["zh-CN"] && item.contentMap["zh-CN"].content;
			if (typeof raw !== "string" || raw === "") return null;
			let blocks;
			try { blocks = JSON.parse(raw); } catch { return null; }
			if (!Array.isArray(blocks)) return null;
			return blocks.map((b) => stripTags(String((b && b.content) || ""))).filter((x) => x !== "");
		}

		// "8/13 10:00 - 9/3 4:59" → 时间戳；年份用公告自身的 beginTime 锚定（避免跨年误判）
		function r99ParseWindow(text, year) {
			const m = String(text).match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*[-\u2014~]\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
			if (!m) return null;
			const sm = Number(m[1]), sd = Number(m[2]), sh = Number(m[3]), smi = Number(m[4]);
			const em = Number(m[5]), ed = Number(m[6]), eh = Number(m[7]), emi = Number(m[8]);
			const startTs = new Date(year, sm - 1, sd, sh, smi).getTime();
			const endYear = em < sm || (em === sm && ed < sd) ? year + 1 : year;   // 跨年（如 12/28 - 1/5）
			return { startTs, endTs: new Date(endYear, em - 1, ed, eh, emi).getTime() };
		}

		// 解析一篇「版本活动一览」→ { pools, events, rotations }
		function parseR99Overview(item, now = nowMs()) {
			const lines = r99NoticeLines(item);
			if (!lines) return null;
			const year = new Date(Number(item.beginTime) || now).getFullYear();
			// 段：`「名称」类型` 开一段，其后各行归该段（直至下一个段标题）
			const sections = [];
			let cur = null;
			for (const line of lines) {
				const head = line.match(/^\u300c([^\u300d]{1,40})\u300d([^\u3010\u203b\uff1a:]{1,16})[\uff1a:]?$/);
				if (head) { cur = { name: head[1], kind: head[2].trim(), lines: [] }; sections.push(cur); continue; }
				if (cur) cur.lines.push(line);
			}
			const pools = [], events = [];
			const seenEvent = new Set();
			for (const sec of sections) {
				const body = sec.lines.join("\n");
				// UP 角色：6★ 单个；5★ 常写成「阿夫西维（木）」、「X（智）」连列 → 取标记后的整串
				const six = [...body.matchAll(/6\u661f\u89d2\u8272\s*\u300c([^\u300d]+)\u300d/g)].map((m) => cleanRoles(m[1]));
				const five = [];
				for (const m of body.matchAll(/5\u661f\u89d2\u8272\s*((?:\u300c[^\u300d]+\u300d[\u3001\s]*)+)/g)) {
					for (const x of String(m[1]).matchAll(/\u300c([^\u300d]+)\u300d/g)) five.push(cleanRoles(x[1]));
				}
				const roles = six.concat(five).filter((x) => x !== "").join("\u3001");
				if (/\u5f81\u96c6/.test(sec.kind)) {
					// 征集段：只认【征集时间】（活动段才有【活动时间】）
					const line = sec.lines.find((l) => /^\u3010\u5f81\u96c6\u65f6\u95f4\u3011/.test(l));
					const w = line ? r99ParseWindow(line, year) : null;
					if (!w) continue;   // 该段没有可解析的征集时间 → 跳过（整篇都没有则由上层按结构异常处理）
					pools.push({
						name: `\u300c${sec.name}\u300d${sec.kind}`, kind: sec.kind, roles,
						startTs: w.startTs, endTs: w.endTs,
						raw: (line.match(/\u3010\u5f81\u96c6\u65f6\u95f4\u3011\s*(.+)$/) || [])[1] || "",
						display: fmtWindow(w.startTs, w.endTs)
					});
					continue;
				}
				// 活动段：取该段全部【…时间】/【…模式】窗口的整体跨度
				// （如「活动正篇」＝故事模式起 → 商店兑换止；段落内没有时间的不算活动）
				const wins = [];
				for (const l of sec.lines) {
					if (!/^\u3010[^\u3011]{1,12}\u3011/.test(l)) continue;
					const w = r99ParseWindow(l, year);
					if (w) wins.push(w);
				}
				if (wins.length === 0) continue;
				const startTs = Math.min.apply(null, wins.map((w) => w.startTs));
				const endTs = Math.max.apply(null, wins.map((w) => w.endTs));
				// 同一活动在一篇里可能出现多次（同名同窗口，如两处「衣着风尚」）→ 去重
				const key = `${sec.name}|${startTs}|${endTs}`;
				if (seenEvent.has(key)) continue;
				seenEvent.add(key);
				events.push({ name: sec.name, cat: sec.kind, startTs, endTs, raw: fmtWindow(startTs, endTs) });
			}
			// 轮换征集：一览以「X月X日更新：角色、角色」逐期公布（14 天一期，末日 04:59）
			const rotations = [];
			for (const line of lines) {
				const m = line.match(/^(\d{1,2})\u6708(\d{1,2})\u65e5\u66f4\u65b0[\uff1a:]\s*(.+)$/);
				if (!m) continue;
				const startTs = new Date(year, Number(m[1]) - 1, Number(m[2]), 5, 0).getTime();
				const endTs = startTs + 14 * 864e5 - 6e4;
				rotations.push({
					name: "\u300c\u8f6e\u6362\u5f81\u96c6\u300d", kind: "\u8f6e\u6362\u5f81\u96c6", roles: cleanRoles(m[3]),
					startTs, endTs, raw: `\u3010${m[1]}\u6708${m[2]}\u65e5\u66f4\u65b0\u3011${cleanRoles(m[3])}`,
					display: fmtWindow(startTs, endTs)
				});
			}
			return { pools, events, rotations };
		}

		// 官方游戏内公告 → 当期征集（含真实起止、悬停列全部并行）+ 当期活动（同其它游戏的活动列规则）。
		// 结构异常（接口改版 / 正文不再可解析）→ 抛错，由上层回退官网公告；
		// 结构正常但没有覆盖当前时刻的征集/活动 → 返回 null（该侧按"未公布"）。
		async function fetchR99Notice(now = nowMs()) {
			const json = await proxyFetchJson(R1999_NOTICE_URL, "https://www.sl916.com/");
			const items = json && Array.isArray(json.data) ? json.data : null;
			if (!items) throw new Error("r1999-notice-no-section");
			const titleOf = (it) => String((it.contentMap && it.contentMap["zh-CN"] && it.contentMap["zh-CN"].title) || "");
			const overviews = items.filter((it) => /\u7248\u672c\u6d3b\u52a8\u4e00\u89c8/.test(titleOf(it)));
			if (overviews.length === 0) throw new Error("r1999-notice-no-section");
			const pools = [], events = [], rotations = [];
			let parsed = 0;
			for (const it of overviews) {
				const o = parseR99Overview(it, now);
				if (!o) continue;
				parsed++;
				pools.push.apply(pools, o.pools);
				events.push.apply(events, o.events);
				rotations.push.apply(rotations, o.rotations);
			}
			if (parsed === 0) throw new Error("r1999-notice-no-dates");
			const data = {};
			const active = pools.concat(rotations).filter((p) => p.startTs <= now && p.endTs >= now);
			if (active.length > 0) {
				const rank = (p) => {
					const i = R99_POOL_TIERS.indexOf(p.kind);
					return i < 0 ? R99_POOL_TIERS.length : i;
				};
				const win = active.slice().sort((a, b) => (rank(a) - rank(b)) || (a.endTs - b.endTs))[0];
				data.banner = win.name;
				data.roles = win.roles || "";
				data.bannerDates = win.display;
				data.bannerDatesRaw = win.raw || win.display;
				const hover = buildPoolHover(active.map((p) => ({
					name: p.name,
					label: `${p.name}${p.roles ? `\uFF1A${p.roles}` : ""}`,
					startTs: p.startTs, endTs: p.endTs, raw: p.raw
				})));
				if (hover) data.bannerHover = hover;
			}
			const activeEvents = sortEventItems(events.filter((e) => e.startTs <= now && e.endTs >= now));
			const primary = pickEventPrimary(activeEvents);
			if (primary) {
				data.event = primary.name;
				data.eventDates = fmtWindow(primary.startTs, primary.endTs);
				data.eventDatesRaw = primary.raw || data.eventDates;
				const hover = buildEventHover(activeEvents);
				if (hover) data.eventHover = hover;
			}
			return (data.banner || data.event) ? data : null;
		}

		// 重返未来：1999 入口：默认源＝官方游戏内公告（逐期征集时间）；
		// 来源被切到官网维护公告（备选源）或自定义地址时直接走官网解析（旧行为）。
		async function fetchR99(url, signal, now = nowMs()) {
			if (!/noticecp/.test(String(url || ""))) return fetchR99Official(url, signal, now);
			try {
				return await fetchR99Notice(now);
			} catch {
				// 游戏内公告接口不可用/结构变了 → 回退官网维护公告（宁可少时间信息，也不要整格报错）
				return fetchR99Official(R1999_OFFICIAL_URL, signal, now);
			}
		}

		// 重返未来：1999（官网 re.bluepoch.com 新闻 API，POST 经 host 代理）
		// 列表接口（informationType=2 资讯）按上线时间倒序返回含全文的公告，
		// 取最新一期「版本更新维护公告」：当期卡池（首位6星角色名，官网无征集名）/ 当期活动 / 维护起止 + 下一期维护日
		async function fetchR99Official(listUrl, signal, now = nowMs()) {
			const ref = "https://re.bluepoch.com/";
			const list = await proxyFetchJson(listUrl, ref, {}, { current: 1, pageSize: 30, informationType: 2 });
			const items = list?.data?.pageData || [];
			const nowYear = new Date(now).getFullYear();
			const cleanText = (raw) => String(raw)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&ldquo;/g, "「").replace(/&rdquo;/g, "」")
				.replace(/&hellip;/g, "…").replace(/&times;/g, "×").replace(/&bull;/g, "·")
				.replace(/\n\s*\n+/g, "\n").trim();
			// 单条版本公告的"版本窗口"（仅用于判断哪一期覆盖当前，不再用于展示）：
			// 起点 = 本篇维护结束时刻；结束端 = **比本篇更新的一期维护公告的维护开始时间**；
			// 若还没有更新的一期（下一版本公告未发布）→ 按"维护起 + 42 天"兜底（1999 版本实测 21~42 天）。
			// 注意：不再使用公告里「可在X月X日上午5点之后」——实测那是**心相观测商店兑换**说明，
			// 曾据此把版本判成提前结束，导致版本中后期整格空白。
			const maintWindow = (text, olderThanIdx) => {
				const maintM = text.match(/【维护时间】\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
				if (!maintM) return null;
				const mk = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
				const sm = Number(maintM[1]), mm = Number(maintM[2]), md = Number(maintM[3]);
				const startTs = mk(Number(maintM[6]), Number(maintM[7]), Number(maintM[8]), Number(maintM[9]), Number(maintM[10]));
				let endTs = null;
				// 列表按发布时间倒序：下标更小的一期更新 → 取其维护开始时间作为本篇结束端
				for (let i = olderThanIdx - 1; i >= 0; i--) {
					const t2 = cleanText(versions[i].content);
					const m2 = t2.match(/【维护时间】\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
					if (!m2) continue;
					const cand = mk(Number(m2[1]), Number(m2[2]), Number(m2[3]), Number(m2[4]), Number(m2[5]));
					if (cand > startTs) { endTs = cand; break; }
				}
				if (endTs == null) endTs = new Date(sm, mm - 1, md + 42, 4, 59).getTime();
				return { maintM, startTs, endTs };
			};
			// 窗口匹配：选"版本更新维护公告"中版本窗口覆盖 now 的那一期（不再无条件取最新）
			const versions = items.filter((n) => /版本更新维护公告/.test(n.title || "") && n.content);
			let maint = null, win = null, text = "";
			for (let i = 0; i < versions.length; i++) {
				const n = versions[i];
				const t = cleanText(n.content);
				const w = maintWindow(t, i);
				if (w && w.startTs <= now && w.endTs >= now) { maint = n; win = w; text = t; break; }
			}
			if (!maint) {
				// 官方无当期覆盖 → 小米资讯流当期主池兜底（UP 名单取最新版本公告）
				let sixStars = [];
				if (versions[0]) {
					sixStars = [...cleanText(versions[0].content).matchAll(/6星角色「([^」]+)」/g)]
						.map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, ""))
						.filter(Boolean);
				}
				try {
					const xiaomi = await fetchXiaomiR99Gacha("https://game.xiaomi.com/game/62346241", sixStars);
					if (xiaomi && xiaomi.banner && xiaomi.bannerDates) {
						return {
							banner: xiaomi.banner,
							roles: xiaomi.roles || "",
							bannerDates: xiaomi.bannerDates,
							bannerDatesRaw: xiaomi.bannerDates,
							event: ""
						};
					}
				} catch { /* 兜底失败 → 返回空，由上层"失败沿用上次成功数据"保留展示原数据 */ }
				return null;
			}
			// —— 官方当期公告解析（text 已清洗）——
			// 当期新增角色（当期多池）：只取「版本全新内容一览 → 新增角色」段内的 6 星角色，
			// 避免把复刻/心相/其它段的角色也算进来；多池外显合并角色（如 赫多涅、纳西索斯）
			const newSeg = text.match(/新增角色([\s\S]{0,220}?)(?=\d+\s*[.、]\s*新增|【|$)/);
			const newSix = (newSeg ? [...newSeg[1].matchAll(/6星角色「([^」]+)」/g)] : [])
				.map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, ""))
				.filter(Boolean);
			const sixStars = newSix.length > 0
				? newSix
				: [...text.matchAll(/6星角色「([^」]+)」/g)].map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, "")).filter(Boolean);
			const bannerName = sixStars[0] || "";
			// 卡池时间：官网不发布逐池征集时间，靠"下一期维护/版本周期"推算并不可靠 →
			// 外显暂时固定为简短文案（等有可靠时间源再显示真实起止）
			const bannerDates = "暂无时间信息";
			// 当期活动：新增活动列表第 2 项（首位6星角色剧情活动，"「赫多涅·凡人或英雄」"）
			const actM = text.match(/活动正篇[，,]\s*「([^」]+)」/);
			const eventName = actM ? String(actM[1]).replace(/^[^·]+·/, "") : "";
			// 活动时间与卡池同一规则：官网不发布可靠起止，外显固定为同一文案
			const eventDates = bannerDates;
			const data = {
				banner: bannerName,
				roles: sixStars.join("、"),
				bannerDates,
				event: eventName,
				eventDates
			};
			if (!data.banner || !data.bannerDates) return null;
			// 征集名增强：小米官方资讯流有"主池"征集公告（UP 属于官网新增角色）时，
			// 用真实征集名/征集时间/UP 角色覆盖卡池字段；无主池匹配则保持官网"角色名"显示
			try {
				const xiaomi = await fetchXiaomiR99Gacha("https://game.xiaomi.com/game/62346241", sixStars);
				if (xiaomi && xiaomi.banner && xiaomi.bannerDates) {
					data.banner = xiaomi.banner;
					data.bannerDates = xiaomi.bannerDates;
					data.roles = xiaomi.roles || "";
				}
			} catch { /* 增强源失败不影响官网解析结果 */ }
			return data;
		}

		// ---- 统一来源注册表 ----
		// 卡池来源与活动来源完全独立，契约如下：
		// - GACHA_FETCHERS[id]：卡池字段抓取器（async (url, signal) → 数据对象 | null），
		//   数据对象形如 {banner, roles?, bannerDates, event?, eventDates?}；
		//   当活动源与卡池源同 URL 时，event/eventDates 由卡池载荷复用（避免重复请求）。
		// - EVENT_FETCHERS[id]：活动源注册表（{ 默认抓取器, 备选抓取器... }），
		//   抓取器同 GACHA_FETCHERS 契约；fetchEntry 只取其中的 event/eventDates 字段。
		//   活动源与卡池源不同 URL 时独立抓取（来源选择互不影响）。
		// - altSources / eventAltSources：备选源列表，字段为 { label, fetcher, url? , id? }
		//   （url = 该来源的地址；id = 抓取器自带地址的内部来源标识）。
		//   设置页选中后按 url ?? id 路由到对应抓取器；是否走 host 代理由抓取器自己决定。见 normalizeSourceId。
		const GACHA_FETCHERS = {
			genshin: mkMediaWiki(bwikiGachaPayload),
			hsr: mkMediaWiki(bwikiGachaPayload),
			zzz: (url, signal) => fetchZzzGacha(url, signal),
			"zzz-bwiki": mkMediaWiki(pickCurrent(parseAllBwiki)),
			arknights: (url, signal) => fetchArknightsGacha(url, signal),
			"arknights-prts": mkMediaWiki(selectArknights),
			wuwa: (url, signal) => fetchWuwaGacha(url, signal),
			"wuwa-bwiki": mkMediaWiki(parseWuwaPool),
			// 终末地默认：Canmoe（中文，Next.js 数据经 host 代理两步抓取）
			endfield: (url, signal) => fetchCanmoeEndfield(url),
			// 终末地备选：GachaTracker（英文，浏览器直连）/ wiki.gg（英文，经 host 代理）
			"endfield-gachatracker": mkRaw(parseGachaTracker),
			"endfield-wiki-gg": (url, signal) => fetchEndfieldWikiGg(url),
			// 异环：ldshop（繁体，静态表格经 host 代理）
			nte: (url, signal) => fetchNteWanmei(url, signal),
			"nte-ldshop": (url, signal) => fetchLdshopNte(url),
			"ba-cn": (url, signal) => fetchBaCn(url),
			"ba-global": (url, signal) => fetchBaGlobal(url, signal),
			"ba-global-gamekee": () => fetchGameKeeBa("global"),
			"ba-jp": (url, signal) => fetchBaJpGacha(url, signal),
			"ba-jp-gamekee": () => fetchGameKeeBa("jp"),
			"r1999": (url, signal) => fetchR99(url, signal),
			// 重返未来1999 备选：官网维护公告（只有维护时间与活动名，无逐期征集时间）
			"r1999-official": (url, signal) => fetchR99Official(url, signal)
		};
		// 活动源注册表：条目 → { 默认 + 备选抓取器 }。没有独立活动源的条目活动来源显示"未配置"。
		const EVENT_FETCHERS = {
			// 原神：活动一览为 JS 动态加载（Dquery+SMW），走 SMW ask 查询（fetchYsActivity 忽略 URL 参数）
			genshin: {
				default: (url, signal) => fetchYsActivity(signal)
			},
			// 星铁：活动一览（静态「活动时间」表，api.php 可直连）→ 外显当期 + 悬停列出全部并行活动
			hsr: {
				default: mkMediaWiki(genericEventPayload)
			},
			// 绝区零：默认=官方公告（api-takumi-static，与卡池侧同一接口；活动时间写在公告正文里，
			// 含"X.Y版本更新后/版本结束"的换算；结束时间未知的活动保留并沉底）→ 备选=Bwiki 活动一览
			zzz: {
				default: (url, signal) => fetchZzzEventsOfficial(url, signal),
				"zzz-event-bwiki": mkMediaWiki(genericEventPayload)
			},
			// 异环：活动源就是同一篇官网公告（与卡池侧同址，fetchNteWanmei 一个函数同时解析两者）。
			// 注册成独立活动源的意义：卡池侧本轮抓挂、或用户把**卡池**来源改成自定义/备选时，
			// 活动侧仍能自己抓、自己报错，而不是整列空掉（同址复用只是"能省一次请求"的优化，不是它的腿）。
			nte: {
				default: (url, signal) => fetchNteWanmei(url, signal)
			},
			// 明日方舟：PRTS 活动一览（「活动开始时间」表 + data-time 起止时间戳）→ 同上
			arknights: {
				default: mkMediaWiki(prtsEventPayload)
			},
			// 终末地：FZ Wiki（中文，经 host 代理、抓 RSC 数据；外显当期=结束最晚，悬停列出全部并行）
			endfield: {
				default: (url, signal) => fetchFzWikiEndfield(url).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "", eventHover: d.eventHover || "" } : null
				),
				"endfield-game8": (url, signal) => fetchGame8Endfield(url).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null
				)
			},
			// 鸣潮：活动日历页（独立 eventUrl 源）→ 外显当期 + 悬停列出全部并行活动
			wuwa: {
				default: mkMediaWiki((html) => {
					const d = parseWuwaCalendar(html);
					return d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "", eventHover: d.eventHover || "" } : null;
				})
			},
			// 蔚蓝国服：默认与卡池同 URL（维护公告含活动名），也可独立配置其他来源
			"ba-cn": {
				default: (url, signal) => fetchBaCn(url)
			},
			// 蔚蓝国际服：默认与卡池同 URL（更新日誌含活动排期）；备选 GameKee
			"ba-global": {
				default: (url, signal) => fetchBaGlobal(url, signal),
				"ba-global-gamekee": () => fetchGameKeeBa("global")
			},
			// 蔚蓝日服：活动源与卡池源独立——默认 GameKee 当期活动条目（原行为不变）；
			// 备选 = 日服官方公告里的イベント条目（抓取器复用官方解析，仅取 event/eventDates）
			"ba-jp": {
				default: () => fetchGameKeeBa("jp"),
				"ba-jp-official": (url, signal) => fetchBaJpOfficialEvent(url, signal)
			},
			// 重返未来：默认与卡池同 URL（同一篇「版本活动一览」同时含征集与活动）；
			// 备选＝官网维护公告（只有维护时间与活动名）
			"r1999": {
				default: (url, signal) => fetchR99(url, signal),
				"r1999-official": (url, signal) => fetchR99Official(url, signal)
			}
		};

		// —— 备选源（altSources / eventAltSources）的字段约定与 altSourceId / normalizeSourceId，
		//    以及下面的 gachaFetcherFor / eventFetcherFor 用到的标识归一，都在 60-helpers.js ——
		//    （设置页也要用这两个纯函数，所以放在 core 与外壳共用的 helpers 里，而不是 core 内部）
		// 取条目当前卡池源的抓取器：命中的备选源 > 默认抓取器（无 → null）
		function gachaFetcherFor(source, url) {
			const want = normalizeSourceId(url);
			const alt = (source.altSources || []).find((a) => altSourceId(a) === want && GACHA_FETCHERS[a.fetcher]);
			return alt ? GACHA_FETCHERS[alt.fetcher] : GACHA_FETCHERS[source.id] || null;
		}

		// 取条目当前活动源的抓取器：命中的活动备选源 > 默认活动抓取器（无 → null）
		function eventFetcherFor(source, url) {
			const table = EVENT_FETCHERS[source.id];
			if (!table) return null;
			const want = normalizeSourceId(url);
			const alt = (source.eventAltSources || []).find((a) => altSourceId(a) === want && table[a.fetcher]);
			return alt ? table[alt.fetcher] : table.default || null;
		}
		//#endregion

		//#region refresh
		// 两侧各自只允许写自己的字段：某些来源的载荷同时含卡池与活动字段（如 GameKee），
		// 若把整对象直接合并，活动源的数据会污染卡池列（反之亦然）——解耦契约的一部分。
		const GACHA_FIELDS = ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover"];
		const EVENT_FIELDS = ["event", "eventDates", "eventDatesRaw", "eventHover"];
		function pickFields(src, fields) {
			const out = {};
			if (!src) return out;
			for (const k of fields) if (src[k] !== void 0) out[k] = src[k];
			return out;
		}
		// 抓取单侧字段：自带解析器优先；**用户自己填的地址**（自定义条目 / 自带条目的自定义网址）
		// 才允许通用解析兜底——内置默认源不兜底：代理源直连必被 CORS 拦，那个错误不该算到来源头上。
		// 返回 { data, fail }：fail=null 表示该侧成功，否则 { kind: "down"|"nomatch", reason }。
		// data 一律原样带回（未命中时也可能附带可供同 URL 复用的其它字段）。
		async function resolveSide(side, { fetcher, url, allowGeneric, signal }) {
			const emptyOf = (d) => (side === "gacha" ? !d || !d.banner : !d || !d.event);
			const parseGeneric = () => (side === "gacha"
				? tryParseGenericGacha(url, signal)
				: tryParseGenericEvent(url, signal));
			let data = null;
			let fail = null;
			if (fetcher) {
				try {
					data = await fetcher(url, signal);
				} catch (err) {
					if (err && err.name === "AbortError") throw err;
					fail = { kind: "down", reason: normErr(err) };
				}
			}
			if (emptyOf(data) && allowGeneric) {
				try {
					const g = await parseGeneric();
					if (!emptyOf(g)) { data = g; fail = null; } // 兜底成功 → 该侧按成功算
				} catch (err) {
					if (err && err.name === "AbortError") throw err;
					if (!fail) fail = { kind: "down", reason: normErr(err) };
				}
			}
			// 有地址、但既没注册抓取器、也不允许通用解析 → 这一侧根本没有可用来源：
			// 如实记"无可用来源"（既不冒充"未公布"，也不去发注定被 CORS 拦的直连——历史 bug）
			if (emptyOf(data) && !fetcher && !allowGeneric) return { data: data || null, fail: { kind: "down", reason: "无可用来源" } };
			if (emptyOf(data)) return { data: data || null, fail: fail || { kind: "nomatch" } };
			return { data, fail: null };
		}
		// 抓取单个条目：卡池字段与活动字段分别由各自来源产出（见"统一来源注册表"契约）。
		// 两个来源独立选择：同 URL 且载荷已带活动字段 → 单次请求复用；否则各自独立抓取。
		// 返回 { ok, data, gachaFail, eventFail }：ok = 两侧都没有 down（只有 nomatch 仍算 ok）。
		async function fetchEntry(source, signal) {
			// 无任何来源的条目：跳过（不计成功也不计失败）
			if (!source.url && !source.eventUrl) return { ok: true, reason: "skipped" };
			// 来源标识统一归一（老配置的 proxy:/gk-*: 写法 → 真实地址 / 内部来源 id）：
			// 抓取器一律只拿到"干净地址"，不再需要在抓取层剥前缀
			const gachaUrl = normalizeSourceId(source.url);
			const eventUrl = normalizeSourceId(source.eventUrl);
			try {
				let g = { data: null, fail: null };
				if (source.url) {
					g = await resolveSide("gacha", {
						fetcher: gachaFetcherFor(source, gachaUrl),
						url: gachaUrl,
						allowGeneric: !!(source.custom || source.allowGenericGacha),
						signal
					});
				}
				let evData = null;
				let eventFail = null;
				if (source.eventUrl) {
					// 活动侧自己的抓取器（与卡池侧各自独立选择，来源可以完全不同）
					const evFetcher = eventFetcherFor(source, eventUrl);
					if (eventUrl === gachaUrl && g.data && g.data.event) {
						// 同 URL：活动字段就在卡池载荷里，不重复抓
						evData = {
							event: g.data.event,
							eventDates: g.data.eventDates || "",
							eventDatesRaw: g.data.eventDatesRaw || g.data.bannerDatesRaw || "",
							eventHover: g.data.eventHover || ""
						};
					} else if (eventUrl === gachaUrl && !evFetcher) {
						// 同 URL 且活动侧**没有自己的抓取器**（该条目就只有这一份载荷可用）：
						//  · 卡池那次已抓成功但载荷里没有活动字段 → 该侧就是"未公布"；
						//  · 卡池那次本身失败 → 沿用它的失败原因（同一次请求的结果，不该另起一个"无可用来源"）。
						// 只在这一种情况下短路：若活动侧有自己的抓取器（如绝区零/异环），照旧独立抓取，解耦不变。
						eventFail = g.data ? { kind: "nomatch" } : (g.fail || { kind: "nomatch" });
					} else {
						const ev = await resolveSide("event", {
							fetcher: evFetcher,
							url: eventUrl,
							allowGeneric: !!(source.custom || source.allowGenericEvent),
							signal
						});
						evData = ev.data;
						eventFail = ev.fail;
					}
				}
				const data = pickFields(g.data, GACHA_FIELDS);
				if (evData) Object.assign(data, pickFields(evData, EVENT_FIELDS));
				const gachaFail = g.fail;
				return {
					ok: !isDown(gachaFail) && !isDown(eventFail),
					reason: "ok",
					data,
					gachaFail,
					eventFail
				};
			} catch (err) {
				// 顶层异常（含 12 秒超时中断）：两侧按"报错"记，面板照实提示
				const aborted = !!err && err.name === "AbortError";
				const reason = aborted ? "超时" : normErr(err);
				const fail = { kind: "down", reason };
				return {
					ok: false,
					reason,
					gachaFail: source.url ? fail : null,
					eventFail: source.eventUrl ? fail : null
				};
			}
		}

		// 合并本轮抓取结果与上次缓存（统一机制，不针对任何游戏）：
		// - 展示字段按列兜底：本次某列没拿到就沿回旧值，并标记该列"显示的是旧值"（gachaStale/eventStale）
		// - 抓取状态（gachaFail/eventFail）永远来自本轮，既不继承也不删除
		// - okAt = 最近一次"两侧都拿到新数据"的时间；有任一侧没拿到就不刷新
		function mergeEntryRecord(r, prevRec, nowTs) {
			const gachaFail = (r && r.gachaFail) || null;
			const eventFail = (r && r.eventFail) || null;
			const rec = { ...((r && r.data) || {}), gachaFail, eventFail };
			if (prevRec) {
				if (!rec.banner && prevRec.banner) {
					rec.banner = prevRec.banner;
					rec.roles = prevRec.roles || "";
					if (!rec.bannerDates) rec.bannerDates = prevRec.bannerDates || "";
					if (!rec.bannerDatesRaw) rec.bannerDatesRaw = prevRec.bannerDatesRaw || prevRec.bannerDates || "";
					if (!rec.bannerHover) rec.bannerHover = prevRec.bannerHover || "";
					rec.gachaStale = true;
				}
				if (!rec.event && prevRec.event) {
					rec.event = prevRec.event;
					if (!rec.eventDates) rec.eventDates = prevRec.eventDates || "";
					if (!rec.eventDatesRaw) rec.eventDatesRaw = prevRec.eventDatesRaw || prevRec.eventDates || "";
					if (!rec.eventHover) rec.eventHover = prevRec.eventHover || "";
					rec.eventStale = true;
				}
			}
			// "两侧都拿到新数据"才算 okAt；被跳过的条目（两侧都没配来源）本轮根本没抓，不能算新数据
			const skipped = !!(r && r.reason === "skipped");
			rec.okAt = (!skipped && !gachaFail && !eventFail) ? nowTs : (prevRec && prevRec.okAt) || 0;
			return rec;
		}

		// 一轮刷新的总预算（毫秒）。注意：这只是"到点收尾"的兜底——被掐断的前提是 transport 理会 signal；
		// 宿主代理等不理会 signal 的实现靠 runEntriesWithDeadline 的兜底收尾，不会让调用方永远等下去。
		const REFRESH_TIMEOUT_MS = 12000;

		// 跑一批 fetchEntry，并施加"到点即超时"的兜底：
		// · 到点时**已经回来**的条目保留自己的结果；
		// · 还没回来的条目按该条目"有哪一侧来源"记成 {kind:"down", reason:"超时"}（与 fetchEntry 顶层 catch 同口径）；
		// 这样即使 transport 完全不理会 signal（宿主代理就是这样），刷新也一定会结束、面板不会永远"刷新中"。
		async function runEntriesWithDeadline(targets, timeoutMs) {
			const ms = timeoutMs || REFRESH_TIMEOUT_MS;
			const controller = typeof AbortController === "function" ? new AbortController() : null;
			const signal = controller ? controller.signal : void 0;
			const timeoutResult = (t) => {
				const fail = { kind: "down", reason: "超时" };
				return { ok: false, reason: "超时", gachaFail: t.url ? fail : null, eventFail: t.eventUrl ? fail : null };
			};
			let timer = 0;
			const deadline = new Promise((resolve) => {
				timer = coreEnv.timer.setTimeout(() => {
					if (controller) { try { controller.abort(); } catch { /* ignore */ } }
					resolve(null);
				}, ms);
			});
			try {
				const raced = targets.map(async (t) => {
					const r = await Promise.race([fetchEntry(t, signal), deadline]);
					return r || timeoutResult(t);   // null ⇒ 到点时这条还没回来
				});
				return await Promise.all(raced);
			} finally {
				coreEnv.timer.clearTimeout(timer);
			}
		}

		async function refreshAll(entries, s, timeoutMs) {
			// 自定义爬取地址覆盖默认；克隆避免污染原始对象（卡池源+活动源分别覆盖）
			// allowGeneric*：只有"用户自己填的地址"（custom:<url>）或自定义条目才允许通用解析兜底
			const targets = entries.map((e) => ({
				...e,
				url: getEntryUrl(s, e.id, e.url),
				eventUrl: getEntryUrl(s, e.id, e.eventUrl, "eventUrl"),
				allowGenericGacha: !!e.custom || isCustomSource(s, e.id),
				allowGenericEvent: !!e.custom || isCustomSource(s, e.id, "eventUrl")
			}));
			const results = await runEntriesWithDeadline(targets, timeoutMs);
			// 被跳过的条目（两侧都没配来源）不算成功——与外壳 buildScrapeInfo 的口径一致
			const okCount = results.filter((r) => r.ok && r.reason !== "skipped").length;
			return {
				okCount,
				total: entries.length,
				at: nowMs(),
				status: okCount > 0 ? "ok" : "unreachable",
				results
			};
		}
		//#endregion

		//#region helpers（core 与外壳共用：纯函数、零宿主依赖）
		// —— 抓取状态与错误归一（统一机制，不做任何游戏特判）——
		// 每一侧（卡池/活动）只有三种状态：
		//   ok      ：本次抓到当期内容
		//   down    ：抓取器报错（网络错误 / CORS 被拦 / 超时 / HTTP 非 2xx / 解析崩，都算）
		//   nomatch ：请求成功，但源站里没有当期内容（"未命中"，不是失败）
		// 判定口径：任一侧 down → 整条 ok=false；只有 nomatch → 仍算 ok（面板提示"未公布"）。
		// 环境原文（fetch failed / Failed to fetch / NetworkError…）一律归一成简短中文，不再外显。
		// 放在 helpers（而非 core 内部）是因为**外壳也要用**：面板要在列悬停里显示失败原因、
		// 要在顶部拼"成功 N/M + 五类归类"，这些都只依赖失败对象本身，与抓取无关。
		const SIDE_TEXT = {
			gacha: { fail: "卡池失败", nomatch: "新卡池未公布", nomatchUser: "未解析出内容" },
			event: { fail: "活动失败", nomatch: "新活动未公布", nomatchUser: "未解析出内容" }
		};
		function normErr(err) {
			const name = String((err && err.name) || "");
			const msg = String((err && err.message) || err || "");
			if (name === "AbortError" || /abort/i.test(msg)) return "超时";
			if (/^proxy-bad:/.test(msg)) return "代理响应异常";
			const m = msg.match(/^(?:proxy-http|http)-(\d{3})$/);
			if (m) return "HTTP " + m[1];
			if (/^bad-json$/.test(msg)) return "响应格式异常";
			if (/fetch failed|Failed to fetch|NetworkError|net::|Load failed|network error/i.test(msg)) return "网络不通";
			if (/^no-source$/.test(msg)) return "无可用来源";
			// 解析器用 throw 表达"页面结构变了/一条都没解析出来"（哨兵错误名见各解析器，统一带
			// shape-changed / layout-changed / no-table / no-timer / no-chunk / no-section 这类后缀）：
			// 给一句比"抓取异常"更有信息量的归因 —— 让"源站改版"在面板上**看得见**，
			// 而不是伪装成"新卡池未公布"（终末地上次长期静默失灵就是这么来的）
			if (/shape-changed|layout-changed|no-table|no-timer|no-chunk|no-section|no-banner|no-dates|no-activities|parse-empty/.test(msg)) {
				return "页面结构变了（解析出 0 条）";
			}
			return "抓取异常";
		}
		const isDown = (f) => !!f && f.kind === "down";
		const isNomatch = (f) => !!f && f.kind === "nomatch";
		// 兼容老版本缓存：旧 lastData 里 eventFail 是**字符串**（"event-down" / "no-match" / 错误原文），
		// 读到时升级成 { kind, reason }；新格式原样返回（否则老缓存会把"失败"错显成"未公布"）。
		function normalizeFail(f) {
			if (!f) return null;
			if (typeof f === "string") {
				return /nomatch|no-match/i.test(f) ? { kind: "nomatch" } : { kind: "down", reason: normErr(f) };
			}
			return f.kind === "down" || f.kind === "nomatch" ? f : null;
		}
		// 一侧状态的单行文案：down → "卡池失败：网络不通"；nomatch → "新卡池未公布"；ok → ""
		// opts.userSupplied：该侧地址由用户自己填（自定义条目 / 自定义网址）时，"未命中"多半意味着
		// "你填的这个地址读不出卡池内容"，而不是"官方还没公布"——文案换一句更贴切的，状态仍是"未公布"
		function sideFailText(side, fail, opts) {
			const f = normalizeFail(fail);
			if (!f) return "";
			if (f.kind === "down") return SIDE_TEXT[side].fail + "：" + (f.reason || "抓取异常");
			return (opts && opts.userSupplied) ? SIDE_TEXT[side].nomatchUser : SIDE_TEXT[side].nomatch;
		}
		// 逐条归类（固定顺序：卡池在前、活动在后；每侧至多一条）
		function entryFailParts(r) {
			const parts = [];
			const gf = normalizeFail(r && r.gachaFail);
			const ef = normalizeFail(r && r.eventFail);
			if (gf) parts.push({ side: "gacha", kind: gf.kind, text: sideFailText("gacha", gf) });
			if (ef) parts.push({ side: "event", kind: ef.kind, text: sideFailText("event", ef) });
			return parts;
		}
		// —— 备选源（altSources / eventAltSources）字段约定 ——
		//   label   设置页显示名
		//   fetcher 抓取器键名（GACHA_FETCHERS / EVENT_FETCHERS[条目 id] 里注册）
		//   url     该来源要抓的地址（大多数备选源）
		//   id      抓取器自带地址的内部来源（如 GameKee）的稳定标识
		// 设置页持久化的"当前来源"就是 url ?? id（不再用伪地址或前缀编码语义）。
		// 老配置里的两种旧写法在读取时自动翻译，无需迁移脚本：
		//   "proxy:<url>"（旧版本用前缀标记"经 host 代理"）、"gk-jp:" / "gk-global:"（旧伪地址）
		const altSourceId = (alt) => alt.url || alt.id || "";
		const LEGACY_ALT_IDS = { "gk-jp:": "ba-jp:gamekee", "gk-global:": "ba-global:gamekee" };
		function normalizeSourceId(v) {
			const s = String(v ?? "");
			const mapped = Object.prototype.hasOwnProperty.call(LEGACY_ALT_IDS, s) ? LEGACY_ALT_IDS[s] : s;
			return mapped.startsWith("proxy:") ? mapped.slice("proxy:".length) : mapped;
		}
		// 顶部提示（**只读 Result JSON**，不碰抓取内部状态）：行内给"分类 + 条目名"（段间空格，
		// 零项不显示），悬停明细逐条分行给原因。games 为按显示顺序排列的条目元信息（含 name）。
		function buildScrapeInfo(games, result) {
			const list = Array.isArray(games) ? games : [];
			const rec = (result && result.games) || {};
			// "成功"口径 = 两侧都没有**报错**（down）；只有 nomatch（未命中）仍算成功
			const okCount = list.filter((g) => {
				const r = rec[g.id];
				if (!r || r.skipped) return false;
				return !isDown(r.gachaFail) && !isDown(r.eventFail);
			}).length;
			// 无任何来源的条目（skipped）既不算成功也不算失败，单独给一句"（跳过 k 个）"
			const skippedCount = list.filter((g) => rec[g.id] && rec[g.id].skipped).length;
			const skippedNote = skippedCount > 0 ? `（跳过 ${skippedCount} 个）` : "";
			// 固定类别顺序：卡池失败 / 活动失败 / 新卡池未公布 / 新活动未公布
			const CATS = [
				["gachaFail", "down", SIDE_TEXT.gacha.fail],
				["eventFail", "down", SIDE_TEXT.event.fail],
				["gachaFail", "nomatch", SIDE_TEXT.gacha.nomatch],
				["eventFail", "nomatch", SIDE_TEXT.event.nomatch]
			];
			const groups = CATS.map(([field, kind, label]) => ({
				label,
				names: list.filter((g) => {
					const f = normalizeFail(rec[g.id] && rec[g.id][field]);
					return f && f.kind === kind;
				}).map((g) => g.name)
			})).filter((grp) => grp.names.length > 0);
			let info = `成功 ${okCount}/${list.length}${skippedNote}`;
			groups.forEach((grp) => { info += ` ${grp.label}：${grp.names.join("、")}`; });
			const lines = list.map((g) => {
				const parts = entryFailParts(rec[g.id] || {});
				return parts.length > 0 ? `${g.name} ${parts.map((p) => p.text).join("、")}` : "";
			}).filter(Boolean);
			return { info, lines };
		}

		// 按设置中的排序（order: id 数组）重排；未设置时保持 SOURCES 顺序
		function applyOrder(sources, order) {
			if (!Array.isArray(order) || order.length === 0) return sources;
			const byId = new Map(sources.map((s) => [s.id, s]));
			const out = [];
			for (const id of order) if (byId.has(id)) out.push(byId.get(id));
			for (const s of sources) if (!out.includes(s)) out.push(s);
			return out;
		}

		// 安全解析 JSON 字符串
		function parseJsonStr(str, fallback) {
			try { return JSON.parse(str || "") ?? fallback; } catch { return fallback; }
		}

		// 全部条目 = 内置(去除已删除) + 自定义条目
		function getAllEntries(s) {
			const removed = Array.isArray(s.removed) ? s.removed : [];
			const base = SOURCES.filter((x) => !removed.includes(x.id));
			const customs = parseJsonStr(s.customEntries, []);
			if (!Array.isArray(customs)) return base;
			const out = base.slice();
			for (const c of customs) {
				if (!c || typeof c.id !== "string") continue;
				out.push({
					id: c.id,
					name: c.name || c.id,
					banner: c.banner || "",
					bannerDates: c.bannerDates || "",
					event: c.event || "",
					eventDates: c.eventDates || "",
					next: c.next || "",
					icon: c.icon || "",
					source: c.source || "",
					url: c.url || "",
					eventUrl: c.eventUrl || "",
					custom: true
				});
			}
			return out;
		}

		// 蔚蓝档案三服角色名特例（一处规则、两个效果合并）：
		// 1) 括号后缀是换装版本标识（桔梗（泳装）、椿(導覽員)、Shiroko (Cycling)），不去除——去掉会与基础版撞名；
		// 2) 括号一律归一为半角（全角（）、半角() 都写成 ()），与日服/国际服源站写法对齐。
		// 其它游戏仍按原规则删掉（属性/职业）后缀（如 克拉蕾（锋御·电）→ 克拉蕾）。
		const BA_ROLE_IDS = ["ba-cn", "ba-global", "ba-jp"];

		function baRoleName(name) {
			return String(name || "").replace(/（/g, "(").replace(/）/g, ")");
		}

		// 角色名精简（面板外显用）：去「」装饰、去（属性/职业）后缀；
		// 「称号·名字」按分隔符去称号（· U+00B7 不限字数；• U+2022 仅 4 字前缀）。
		// 悬停全文仍用原始 roles。
		function cleanRoleNames(roles, gameId) {
			const isBa = BA_ROLE_IDS.includes(gameId);
			return String(roles || "")
				.split(/[、,，]/)
				.map((n) => {
					let s = n.replace(/[「」【】]/g, "");
					if (isBa) s = baRoleName(s); // 蔚蓝三服：保留括号后缀 + 统一半角
					else s = s.replace(/[（(][^）)]*[）)]/g, "");
					s = s.trim();
					// 称号去前缀，按分隔符区分（避免误删角色名）：
					// ·  U+00B7 居中点 = 称号分隔（原神「轰隆雷鸣波·伊涅芙」→ 伊涅芙），不限称号字数；
					// •  U+2022 间隔号 = 角色·变体（星铁「砂金•戏浪」→ 保留），仅在旧规则（4 字前缀）下才去
					const mDot = s.match(/^([\u4e00-\u9fff]{2,10})[\u00B7](.+)$/);
					if (mDot && mDot[2].trim()) {
						s = mDot[2].trim();
					} else {
						const mBullet = s.match(/^([\u4e00-\u9fff]{4})[\u2022](.+)$/);
						if (mBullet) s = mBullet[2].trim();
					}
					return s;
				})
				.filter(Boolean)
				.join("、");
		}

		// 默认爬取源显示名（设置页下拉默认项）
		// urlField: "url"（卡池源）或 "eventUrl"（活动源）
		// 卡池源：source 字段，否则域名/未配置
		// 活动源：eventSource 标签（或域名）；无活动源 → "未配置"
		function getDefaultSourceName(g, urlField) {
			const isEvent = urlField === "eventUrl";
			const u = isEvent ? g.eventUrl : g.url;
			if (isEvent) {
				if (g.eventSource && g.eventSource.trim() !== "") return g.eventSource.trim();
				if (u && u.trim() !== "") {
					try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
				}
				return "未配置";
			}
			if (g.source && g.source.trim() !== "") return g.source.trim();
			if (u && u.trim() !== "") {
				try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.trim(); }
			}
			return "未配置";
		}

		// 可见条目 = 全部条目 - 隐藏条目
		function getVisibleEntries(s) {
			const hidden = Array.isArray(s.hidden) ? s.hidden : [];
			return getAllEntries(s).filter((x) => !hidden.includes(x.id));
		}

		// 某条目的实际爬取地址：自定义覆盖默认；urlField 区分卡池源(customUrls)/活动源(customEventUrls)
		// 存储值约定：custom:<url>（用户自定义输入，剥前缀返回 url）；其它值经 normalizeSourceId 归一
		// （备选源的标识就是它的 url 或 id，老配置的 proxy:/gk-*: 写法在这里翻译）
		function getEntryUrl(s, id, fallbackUrl, urlField) {
			const urls = parseJsonStr(urlField === "eventUrl" ? s.customEventUrls : s.customUrls, {});
			const u = urls && typeof urls === "object" ? urls[id] : undefined;
			if (typeof u !== "string" || u.trim() === "") return fallbackUrl;
			if (u.startsWith("custom:")) {
				const v = u.slice("custom:".length).trim();
				return v !== "" ? v : fallbackUrl;
			}
			const normalized = normalizeSourceId(u.trim());
			return normalized !== "" ? normalized : fallbackUrl;
		}
		// 该条目的来源地址是否由用户自己填的（设置里存的是 custom:<url>）：
		// 自定义网址允许通用解析兜底（用户在设置页粘 api.php 等页面时，内置解析器可能吃不下）
		function isCustomSource(s, id, urlField) {
			const urls = parseJsonStr(urlField === "eventUrl" ? s.customEventUrls : s.customUrls, {});
			const u = urls && typeof urls === "object" ? urls[id] : undefined;
			return typeof u === "string" && u.startsWith("custom:");
		}

		// 解析面板展示的时间段（mm-dd hh:mm ~ mm-dd hh:mm，无年份，如 "08-12 06:00 ~ 09-01 17:59"）
		// → { startTs, endTs }；无法解析返回 null。年份按当前年补全，跨年（end 月份 < start 月份）自动 +1 年。
		function parseDisplayRange(str, now) {
			if (typeof str !== "string") return null;
			const parts = str.split(/~/).map((x) => x.trim());
			if (parts.length < 2) return null;
			const parsePart = (p) => {
				const m = p.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
				if (!m) return null;
				const mo = Number(m[1]), d = Number(m[2]);
				if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
				const h = m[3] ? Number(m[3]) : 0;
				const mi = m[4] ? Number(m[4]) : 0;
				return { mo, d, h, mi, base: new Date(now.getFullYear(), mo - 1, d, h, mi).getTime() };
			};
			const a = parsePart(parts[0]);
			const b = parsePart(parts[1]);
			if (!a || !b) return null;
			const startTs = a.base;
			let endTs = b.base;
			// 跨年：结束月份小于开始月份（如 12-20 ~ 01-05）→ 结束端按"下一年的同月同日同时刻"重算。
			// 注意不能用 +365 天近似：闰年会差 1 天（实测 2028-12-31 看 "12-30 ~ 01-05" 会少 1 天）。
			if (b.mo < a.mo) endTs = new Date(now.getFullYear() + 1, b.mo - 1, b.d, b.h, b.mi).getTime();
			return { startTs, endTs };
		}

		// 游戏名/图标悬停：这行数据的刷新时间（= 最近一次整行都拿到新数据的时间；
		// 有列沿用旧值时保持旧时间，不谎报新时间）；没有成功记录则只显示名称
		function buildRowTitle(g) {
			return g._okAt ? g.name + "\n刷新时间 " + new Date(g._okAt).toLocaleString() : g.name;
		}

		// 剩余时间文本："X 天 X 小时 X 分钟"；负数（已过）返回 null 由调用方处理
		function formatRemaining(ts, now) {
			const diff = ts - now.getTime();
			if (diff < 0) return null;
			const days = Math.floor(diff / 86400000);
			const hours = Math.floor((diff % 86400000) / 3600000);
			const mins = Math.floor((diff % 3600000) / 60000);
			return `${days}\u5929${hours}\u5C0F\u65F6${mins}\u5206\u949F`;
		}

		// 面板时间列展示：未开始→"还有 X 天 X 小时 X 分钟开始"；进行中→"还剩 X 天 X 小时 X 分钟"；已结束→"已结束"
		function displayTimeCell(raw, now) {
			const r = parseDisplayRange(raw, now);
			if (!r) return raw || "";
			if (now.getTime() < r.startTs) {
				const t = formatRemaining(r.startTs, now);
				return t === null ? raw : `\u8FD8\u6709 ${t} \u5F00\u59CB`;
			}
			if (now.getTime() > r.endTs) return "\u5DF2\u7ED3\u675F";
			const t = formatRemaining(r.endTs, now);
			return t === null ? raw : `\u8FD8\u6709 ${t}`;
		}
		//#endregion
		//#endregion

		//#region engine（core 对外唯一入口：createEngine）
		// core = 环境无关的"抓取 + 解析 + 缓存合并"逻辑。宿主（DSH 插件 / 浏览器扩展 / Windows /
		// Android / iOS / 鸿蒙）只需注入三样东西，然后读它返回的 Result JSON 画界面：
		//   transport: { fetchRaw(url, opts), fetchViaProxy(url, { referer, headers, body }) }
		//   storage:   { get(key), set(key, value) }      —— 配置与缓存都走它（键名见 CONFIG_KEYS）
		//   now:       () => 毫秒时间戳（可注入 → 单测能固定时间）
		//   timer:     { setTimeout, clearTimeout }（可选；不传就用宿主全局的）
		// 硬约束（交接文档 §13.3）：core 内部不得出现 window / document / Node API / 直接 fetch /
		// 直接 Date.now —— 全部经 15-env.js 的 coreEnv。违反此约束会让 Android/iOS/鸿蒙 无法嵌入。
		const ENGINE_SCHEMA_VERSION = 1;

		function createEngine(env) {
			const engineEnv = env || {};
			// 各平台自己实现这两个方法；缺省实现只保证"不崩"，不联网、不落盘
			const storage = engineEnv.storage || {
				async get() { return undefined; },
				async set() { /* 无存储：算完就返回，不持久化 */ }
			};
			// engine 会读取的存储键（宿主按自己的方式实现即可；读不到就用 DEFAULT_SETTINGS 的默认值）
			//   order / hidden / removed / customEntries / customUrls / customEventUrls  —— 配置
			//   lastData / lastRefresh / lastSource                                    —— 缓存
			const CONFIG_KEYS = [
				"order", "hidden", "removed", "customEntries", "customUrls", "customEventUrls",
				"autoRefresh", "refreshMinutes", "lastData", "lastRefresh", "lastSource"
			];

			// 读取配置（缺失项回落到 10-config.js 的 DEFAULT_SETTINGS）
			async function readSettings() {
				const out = { ...DEFAULT_SETTINGS };
				for (const k of CONFIG_KEYS) {
					const v = await storage.get(k);
					if (v !== undefined && v !== null) out[k] = v;
				}
				return out;
			}

			// 解析器版本号（代码元信息，不随缓存走）：无服务端分发时用来定位
			// 「坏了的是哪个版本的用户、哪个源」（交接文档 §13.4）。自定义条目没有维护中的解析器，故不出现在这里。
			function parserVersionsOf(entries) {
				const out = {};
				for (const e of entries) if (typeof e.parserVersion === "number") out[e.id] = e.parserVersion;
				return out;
			}

			// 记录归一：**Result JSON 的形状必须固定**（这才是"冻结契约"）——
			// 内容字段无论抓没抓到都存在（缺就是空串），消费方不必到处 `?? ""`；
			// 状态字段永远在（gachaFail / eventFail / okAt，可选 gachaStale / eventStale / skipped）。
			// 判断"是没抓到还是源站没内容"要把内容字段与 gachaFail/gachaStale 一起看。
			const CONTENT_FIELDS = [
				"banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover",
				"event", "eventDates", "eventDatesRaw", "eventHover"
			];
			function normalizeRecord(rec, name) {
				const src = rec || {};
				const out = { name: name || src.name || "" };
				for (const f of CONTENT_FIELDS) out[f] = typeof src[f] === "string" ? src[f] : "";
				// 老缓存的 fail 是**字符串**（"event-down" / "no-match" / 错误原文）：必须在这里就归一成
				// { kind, reason }，否则按契约实现的其它消费者（扩展/CLI）用 isDown() 会把字符串判成成功
				// （"失败被错显成未公布"）。键名与值域不变，不需要升 schemaVersion。
				out.gachaFail = normalizeFail(src.gachaFail);
				out.eventFail = normalizeFail(src.eventFail);
				out.gachaStale = !!src.gachaStale;
				out.eventStale = !!src.eventStale;
				if (src.skipped) out.skipped = true;
				out.okAt = typeof src.okAt === "number" ? src.okAt : 0;
				return out;
			}

			// 上次结果（Result JSON 形态；没有缓存时 games 为空对象，UI 直接显示静态默认值即可）
			async function getCached() {
				const raw = await storage.get("lastData");
				const parsed = raw ? parseJsonStr(raw, {}) : {};
				const byId = parsed && typeof parsed === "object" ? parsed : {};
				const games = {};
				// 老缓存也补齐成同一形状（缺字段填空串）——消费方只需认一种形状
				for (const [id, rec] of Object.entries(byId)) games[id] = normalizeRecord(rec, rec && rec.name);
				const at = await storage.get("lastRefresh");
				const entries = getAllEntries(await readSettings());
				return {
					schemaVersion: ENGINE_SCHEMA_VERSION,
					refreshedAt: Number(at) || 0,
					parserVersions: parserVersionsOf(entries),
					games
				};
			}

			// 条目元信息（名字 / 图标 / 来源标签 / 可选来源清单 / 静态默认值 / 是否隐藏）。
			// 各平台 UI 用它画列表；**不含抓取结果**（结果在 getCached() / refresh() 里）。
			async function listGames() {
				const s = await readSettings();
				const hidden = Array.isArray(s.hidden) ? s.hidden : [];
				return getAllEntries(s).map((g) => ({
					id: g.id,
					name: g.name,
					icon: g.icon,
					source: g.source,
					eventSource: g.eventSource,
					altSources: (g.altSources || []).map((a) => ({ label: a.label, value: altSourceId(a) })),
					eventAltSources: (g.eventAltSources || []).map((a) => ({ label: a.label, value: altSourceId(a) })),
					custom: !!g.custom,
					hidden: hidden.includes(g.id),
					defaults: {
						banner: g.banner || "",
						roles: g.roles || "",
						bannerDates: g.bannerDates || "",
						event: g.event || "",
						eventDates: g.eventDates || ""
					}
				}));
			}

			// —— 环境注入：把宿主给的三样东西接到 coreEnv（15-env.js）——
			// 必须放在 core 段之后：coreEnv 是 let 声明，提前调用会踩 TDZ。
			// 保存成本引擎自己的一份（含**完整的** timer 默认实现），并在每个公开方法入口重新注入：
			// coreEnv 是模块级单例，同一进程里建第二个引擎会把它覆盖；不重注入就会出现
			// "第一个引擎的时钟/传输/计时器被第二个引擎偷走"（安静串台，最难查）。
			const DEFAULT_TIMER = {
				setTimeout: (fn, ms) => setTimeout(fn, ms),
				clearTimeout: (id) => clearTimeout(id)
			};
			const ENGINE_ENV = {
				transport: engineEnv.transport,
				now: engineEnv.now || (() => Date.now()),
				// 补全默认实现：宿主只注入 setTimeout 时，clearTimeout 也必须是配套的那一个
				timer: { ...DEFAULT_TIMER, ...(engineEnv.timer || {}) }
			};
			function useEnv() {
				setCoreEnv(ENGINE_ENV);
			}
			useEnv();

			// 抓取一轮：读配置 → 逐条抓取（卡池/活动各自独立）→ 与上次缓存按列合并 →
			// 写回缓存 → 返回 Result JSON（这就是"产品接口"，各平台 UI 只读它）。
			// 在途保护：同一引擎并发调用时复用同一轮（否则两轮各自无条件写缓存，慢的那轮会用更旧的数据
			// 盖掉快的那轮，而 lastRefresh 却是更晚的时间戳 = "旧内容配新时间"）。
			let refreshInFlight = null;
			function refresh() {
				useEnv();
				if (refreshInFlight) return refreshInFlight;
				refreshInFlight = (async () => {
					const s = await readSettings();
				// 用"全部条目"（含隐藏）抓取：隐藏再显示时立刻有数据，与既有行为一致
				const entries = getAllEntries(s);
				const result = await refreshAll(entries, s);
				const prev = await getCached();
				const games = {};
				entries.forEach((e, i) => {
					const rec = mergeEntryRecord(result.results[i], prev.games[e.id], nowMs());
					if (result.results[i].reason === "skipped") rec.skipped = true;
					// 统一成固定形状（内容字段缺失填空串）——见 engine-head.js 的 normalizeRecord
					games[e.id] = normalizeRecord(rec, e.name);
				});
				await storage.set("lastData", JSON.stringify(games));
				await storage.set("lastRefresh", result.at);
				await storage.set("lastSource", result.status === "ok" ? "web" : "none");
				return {
					schemaVersion: ENGINE_SCHEMA_VERSION,
					refreshedAt: result.at,
					parserVersions: parserVersionsOf(entries),
					games
				};
				})();
				return refreshInFlight.finally(() => { refreshInFlight = null; });
			}

			// 解析器自检（交接文档 §13.4）：对每个条目的两侧来源各跑一次，报告「解析出什么 / 报错原因」。
			// 用途：源站改版时快速定位「哪个源解析出 0 条、哪个源 403/超时」——各平台都能调用
			// （将来扩展里做「自检」按钮、CLI、CI 都行）。**只读**：不写缓存、不动设置。
			async function selfCheck(options) {
				useEnv();
				const timeoutMs = (options && options.timeoutMs) || REFRESH_TIMEOUT_MS;
				const s = await readSettings();
				const entries = getAllEntries(s);
				const targets = entries.map((e) => ({
					...e,
					url: getEntryUrl(s, e.id, e.url),
					eventUrl: getEntryUrl(s, e.id, e.eventUrl, "eventUrl"),
					allowGenericGacha: !!e.custom || isCustomSource(s, e.id),
					allowGenericEvent: !!e.custom || isCustomSource(s, e.id, "eventUrl")
				}));
				// 与刷新同一套"到点收尾"兜底：transport 不理会 signal 时，自检也不会永远转圈
				const results = await runEntriesWithDeadline(targets, timeoutMs);
				// 一侧的结论：ok=有内容；nomatch=抓到页面但没当期内容（这才是"解析出 0 条"）；down=抓取/解析报错
				const describe = (kind, fail, data, url) => {
					// 该侧压根没配来源（如自定义条目只填了卡池地址）：自检的意义就是指出"哪个源没内容/报错"，
					// 这里必须报出来，不能因为"从没抓过"而显示成正常（fail 恒为 null 的假 ok）
					if (!url) return { state: "down", reason: "未配置来源", text: "未配置来源" };
					const f = normalizeFail(fail);
					if (!f) {
						const text = kind === "gacha"
							? [data.roles || data.banner, data.bannerDates].filter(Boolean).join(" / ")
							: [data.event, data.eventDates].filter(Boolean).join(" / ");
						return { state: "ok", reason: "", text: text || "（抓到了，但内容为空）" };
					}
					if (f.kind === "nomatch") return { state: "nomatch", reason: "", text: "解析出 0 条（源站无当期内容）" };
					return { state: "down", reason: f.reason || "抓取异常", text: "抓取失败：" + (f.reason || "抓取异常") };
				};
				const games = {};
				const summary = { ok: 0, nomatch: 0, down: 0 };
				entries.forEach((e, i) => {
					const r = results[i] || {};
					const d = r.data || {};
					const t = targets[i] || {};
					const gacha = describe("gacha", r.gachaFail, d, t.url);
					const event = describe("event", r.eventFail, d, t.eventUrl);
					games[e.id] = { name: e.name, parserVersion: e.parserVersion, gacha, event };
					for (const side of [gacha, event]) summary[side.state]++;
				});
				const problems = [];
				for (const [id, v] of Object.entries(games)) {
					const bad = [];
					if (v.gacha.state !== "ok") bad.push("卡池 " + v.gacha.text);
					if (v.event.state !== "ok") bad.push("活动 " + v.event.text);
					if (bad.length) problems.push(`${v.name}(${id}): ${bad.join("；")}`);
				}
				return { at: nowMs(), total: entries.length, summary, problems, games };
			}

			// 测试出口：给回归脚本用。**如实暴露**（不做隐藏门控/环境变量开关）：
			// 它只是内部函数的引用、不含任何数据，而"测试看得见、生产看不见"两套行为反而更容易埋坑；
			// 各平台的 UI 只应使用 createEngine 返回的公开方法。
			const __test = {
				fetchEntry,
				resolveSide,
				mergeEntryRecord,
				buildScrapeInfo,
				entryFailParts,
				sideFailText,
				normalizeFail,
				normErr,
				isDown,
				isNomatch,
				refreshAll,
				gachaFetcherFor,
				eventFetcherFor,
				normalizeSourceId,
				altSourceId,
				getEntryUrl,
				isCustomSource,
				readSettings,
				getCached,
				listGames,
				GACHA_FETCHERS,
				EVENT_FETCHERS,
				SOURCES,
				DEFAULT_SETTINGS
			};

			return {
				schemaVersion: ENGINE_SCHEMA_VERSION,
				listGames,
				getCached,
				refresh,
				selfCheck,
				__test
			};
		}
		//#endregion

		//#region styles
		const STYLE = `
			.gacha-cal-btn{display:flex;align-items:center;gap:8px;width:calc(100% + 4px);min-height:42px;padding:0 10px 0 8px;margin:4px -2px;border:none;background:transparent;color:var(--dsw-alias-label-primary);border-radius:12px;font-size:14px;line-height:22px;font-weight:400;cursor:pointer;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-align:left}
			.gacha-cal-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn:active{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn svg{flex:none;width:16px;height:16px}
			.hHd-Xa_footerActions{flex-wrap:wrap;align-content:flex-start;align-items:stretch}
			.gacha-cal-pop{position:fixed;z-index:9999;width:690px;max-height:72vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-primary)}
			.gacha-cal-title{font-size:13px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:center;gap:8px}
			.gacha-cal-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
			/* flex-basis 用 0（不是 auto）：长文案不会整块掉到下一行，而是留在本行被省略号截断；
			   cursor:help + title 引导用户悬停看逐条原因 */
			.gacha-cal-scrape{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;min-width:0;flex:1 1 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
			.gacha-cal-refresh{padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1}
			.gacha-cal-refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-refresh:disabled{opacity:.5;cursor:default}
			.gacha-cal-spin{animation:gacha-cal-rotate 0.8s linear infinite}
			@keyframes gacha-cal-rotate{to{transform:rotate(360deg)}}
			.gacha-cal-row{display:grid;grid-template-columns:22px 96px 1fr 150px 1.3fr 150px;gap:6px;align-items:center;padding:5px 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}
			.gacha-cal-row:last-child{border-bottom:none}
			/* 所有列居中：图标列水平居中，文本列 text-align:center，时间列等宽数字 */
			.gacha-cal-row > *{text-align:center}
			.gacha-cal-row > :first-child{justify-self:center}
			.gacha-cal-row img{width:20px;height:20px;border-radius:5px;object-fit:cover}
			.gacha-cal-name{font-weight:600;white-space:nowrap;overflow:hidden}
			.gacha-cal-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.gacha-cal-cell b{color:var(--dsw-alias-state-business-primary)}
			/* 截断文字悬停自动滚动显示全文（marquee）：
			   统一由 JS 计算超宽与精确距离（gacha-cal-marq + --gacha-marq-d），仅超宽才滚动；
			   面板保持原速 3.5s，设置页单独慢速 6s */
			.gacha-cal-inner{display:inline-block;white-space:nowrap;will-change:transform}
			.gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee 3.5s ease-in-out infinite}
			@keyframes gacha-cal-marquee{0%,10%{transform:translateX(0)}45%,75%{transform:translateX(var(--gacha-marq-d,-80px))}100%{transform:translateX(0)}}
			.gacha-cal-settings-name.gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee-slow 6s ease-in-out infinite}
			@keyframes gacha-cal-marquee-slow{0%,14%{transform:translateX(0)}40%,72%{transform:translateX(var(--gacha-marq-d,-80px))}93%,100%{transform:translateX(0)}}
			/* 时间列（卡池起止/活动起止，第 4/6 列）：等宽数字，不同位数倒计时左右对齐 */
			.gacha-cal-row > :nth-child(4), .gacha-cal-row > :nth-child(6) { font-variant-numeric: tabular-nums }
			.gacha-cal-h{display:grid;grid-template-columns:22px 96px 1fr 150px 1.3fr 150px;gap:6px;align-items:center;padding:6px 4px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px}
			.gacha-cal-h > *{text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sort-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
			.gacha-cal-sort-row img{width:22px;height:22px;border-radius:5px;object-fit:cover}
			.gacha-cal-sort-name{flex:1;font-size:13px}
			.gacha-cal-sort-btn{padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:11px;cursor:pointer}
			.gacha-cal-sort-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-sort-btn:disabled{opacity:.35;cursor:default}
			.gacha-cal-del-btn{color:#e5484d;padding:1px 6px}
			.gacha-cal-del-btn:hover{background:rgba(229,72,77,.12)}
		`;
		//#endregion

		//#region components
		// engine：core 引擎（抓取/解析/缓存合并都在里面）。面板只读它返回的 Result JSON。
		function CalendarPanel({ wide, scope, engine }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [scrapeInfo, setScrapeInfo] = (0, react.useState)("");
			// 顶部提示的悬停明细：逐条分行（分类只在行内，原因放这里）
			const [scrapeLines, setScrapeLines] = (0, react.useState)([]);
			// 当前时间：每分钟刷新一次，驱动"还剩 X 天 X 小时 X 分钟"倒计时
			const [now, setNow] = (0, react.useState)(() => new Date());
			const triggerRef = (0, react.useRef)(null);
			const popRef = (0, react.useRef)(null);
			const [anchor, setAnchor] = (0, react.useState)();

			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => setNow(new Date()), 60000);
				return () => window.clearInterval(timer);
			}, []);

			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);

			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };
			// 最近一次抓取结果按游戏 id 索引；解析失败/未联网时为 {}
			let scrapedById = {};
			try { scrapedById = JSON.parse(s.lastData || "{}") || {}; } catch { scrapedById = {}; }
			// 清理历史抓取数据中残留的版本号字段（新版解析器已不产出）
			for (const k of Object.keys(scrapedById)) {
				const v = scrapedById[k];
				if (v && typeof v === "object" && "version" in v) delete v.version;
			}
			// 可见条目（隐藏/已删除的不显示）；抓取成功的数据覆盖卡池/活动列
			const visible = getVisibleEntries(s);
			const games = applyOrder(visible, s.order).map((g) => {
				const sc = scrapedById[g.id];
				if (!sc) return g;
				return {
					...g,
					// 悬停游戏名/图标：显示这行数据的更新时间（见 buildRowTitle）
					_okAt: sc.okAt || 0,
					// 本次抓取状态：失败（down）或未命中（nomatch）时，在该列悬停里补一行说明；
					// gachaStale/eventStale 表示该列显示的是沿回的旧值（决定说明是否另起一行）
					gachaFail: sc.gachaFail || null,
					eventFail: sc.eventFail || null,
					gachaStale: !!(sc.gachaStale || sc.stale),
					eventStale: !!(sc.eventStale || sc.stale),
					// 卡池名与角色名分开保留：卡池列外显角色名、悬停显示卡池全名
					banner: sc.banner || g.banner,
					roles: sc.roles || g.roles || "",
					bannerDates: sc.bannerDates || g.bannerDates,
					// 源站原文（补全前）：悬停起止列时显示原文而非补全后的时间
					bannerDatesRaw: sc.bannerDatesRaw || "",
					// 逐池悬停文本（如鸣潮并行多池：每池一行）
					bannerHover: sc.bannerHover || "",
					event: sc.event || g.event,
					eventDates: sc.eventDates || g.eventDates,
					eventDatesRaw: sc.eventDatesRaw || "",
					// 活动列逐条悬停文本（并行活动：每条一行；仅 1 条时为空 → UI 退回单条展示）
					eventHover: sc.eventHover || ""
				};
			});

			// 在途锁用 ref 而不是 state：state 更新是异步的，"自动刷新与手动点击落在同一 tick"时
			// 两次调用可能都看到 refreshing=false 而并发跑两轮（请求翻倍，且慢的那轮会用更旧的数据盖掉新的）
			const refreshLock = (0, react.useRef)(false);
			const doRefresh = (0, react.useCallback)(async () => {
				if (refreshLock.current) return;
				refreshLock.current = true;
				setRefreshing(true);
				try {
					// 抓取/解析/合并/写缓存全部交给 core 引擎（面板不再自己编排）
					const result = await engine.refresh();
					// 顶部提示：只读 Result JSON（按游戏顺序取 name，交给共用提示函数分类）
					const games = Object.entries(result.games).map(([id, g]) => ({ id, name: g.name || id }));
					const { info, lines } = buildScrapeInfo(games, result);
					setScrapeInfo(info);
					setScrapeLines(lines);
					// 引擎已把 lastData/lastRefresh/lastSource 写进 settings，刷新快照即可重渲染
					setSnapshot(scope.getSnapshot());
				} catch (err) {
					// 刷新失败必须说出来：否则顶部还挂着上一次的"成功 N/M"，看起来像是刷新成功了
					const msg = String((err && err.message) || err || "未知错误");
					setScrapeInfo("\u5237\u65B0\u5931\u8D25\uFF1A" + msg);
					setScrapeLines([msg]);
				} finally {
					refreshLock.current = false;
					setRefreshing(false);
				}
			}, [scope, engine]);

			// 定时自动刷新（按设置频率）。
			// 注意：setTimeout/setInterval 的 delay 上限为 2^31-1 ms（约 24.86 天），
			// 42 天选项会溢出并变成 1ms 疯狂触发，故用"目标时间 + 递归 setTimeout"实现精确周期。
			(0, react.useEffect)(() => {
				if (!(s.autoRefresh ?? DEFAULT_SETTINGS.autoRefresh)) return;
				const minutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
				if (!Number.isFinite(minutes) || minutes <= 0) return;
				const MAX_DELAY = 2147483647;
				const intervalMs = minutes * 60 * 1000;
				let disposed = false;
				let timer = 0;
				let last = Date.now();
				const tick = () => {
					if (disposed) return;
					const now = Date.now();
					if (now - last >= intervalMs) {
						last = now;
						doRefresh();
					}
					timer = window.setTimeout(tick, Math.min(Math.max(last + intervalMs - Date.now(), 1000), MAX_DELAY));
				};
				timer = window.setTimeout(tick, Math.min(intervalMs, MAX_DELAY));
				return () => {
					disposed = true;
					window.clearTimeout(timer);
				};
			}, [s.autoRefresh, s.refreshMinutes, doRefresh]);

			// 锚定面板到 trigger 上方
			(0, react.useLayoutEffect)(() => {
				if (!open) return;
				const place = () => {
					const rect = triggerRef.current?.getBoundingClientRect();
					if (rect !== void 0) setAnchor({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 8 });
				};
				place();
				window.addEventListener("resize", place);
				return () => window.removeEventListener("resize", place);
			}, [open]);

			// 点击 dismiss：仅当点击既不在 trigger 也不在 pop 内部时关闭（修复弹层内按钮点不到的问题）
			(0, react.useEffect)(() => {
				if (!open) return;
				const onDown = (e) => {
					const t = e.target;
					if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
					setOpen(false);
				};
				document.addEventListener("pointerdown", onDown);
				return () => document.removeEventListener("pointerdown", onDown);
			}, [open]);

			const lastRefreshText = s.lastRefresh ? new Date(s.lastRefresh).toLocaleString() : "\u2014";
			const dataStatus = s.lastSource === "web" ? "\u8054\u7F51\u6570\u636E" : "\u2014";
			const label = "\u4E8C\u6E38\u6392\u671F";

			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					(0, react_jsx_runtime.jsx)("button", {
						ref: triggerRef,
						type: "button",
						className: "gacha-cal-btn",
						"aria-label": label,
						onClick: () => setOpen((v) => !v),
						children: [
							(0, react_jsx_runtime.jsx)("svg", { "aria-hidden": "true", width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
								children: [
									(0, react_jsx_runtime.jsx)("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }),
									(0, react_jsx_runtime.jsx)("line", { x1: "16", y1: "2", x2: "16", y2: "6" }),
									(0, react_jsx_runtime.jsx)("line", { x1: "8", y1: "2", x2: "8", y2: "6" }),
									(0, react_jsx_runtime.jsx)("line", { x1: "3", y1: "10", x2: "21", y2: "10" })
								]
							}) }),
							wide === false ? null : (0, react_jsx_runtime.jsx)("span", { children: label })
						]
					}),
					open && anchor !== void 0 ? (0, react_jsx_runtime.jsx)("div", {
						ref: popRef,
						className: "gacha-cal-pop",
						style: { left: anchor.left, bottom: anchor.bottom },
						children: [
							(0, react_jsx_runtime.jsx)("p", { className: "gacha-cal-title", children: "\u4E8C\u6E38\u6392\u671F" }),
							(0, react_jsx_runtime.jsxs)("p", { className: "gacha-cal-meta", children: [
								(0, react_jsx_runtime.jsx)("span", { children: "\u6570\u636E\uFF1A" + dataStatus }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5237\u65B0\uFF1A" + lastRefreshText }),
								// 刷新按钮（SVG 图标：循环箭头）
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-refresh",
									disabled: refreshing,
									title: refreshing ? "\u5237\u65B0\u4E2D..." : "\u5237\u65B0",
									"aria-label": refreshing ? "\u5237\u65B0\u4E2D..." : "\u5237\u65B0",
									onClick: doRefresh,
									children: (0, react_jsx_runtime.jsx)("svg", {
										className: refreshing ? "gacha-cal-spin" : "",
										width: "13",
										height: "13",
										viewBox: "0 0 24 24",
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2.2",
										strokeLinecap: "round",
										strokeLinejoin: "round",
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [
												(0, react_jsx_runtime.jsx)("path", { d: "M21 12a9 9 0 1 1-2.64-6.36L21 8" }),
												(0, react_jsx_runtime.jsx)("polyline", { points: "21 3 21 8 16 8" })
											]
										})
									})
								}),
								// 设置按钮：跳转到 DSH 设置页并关闭本面板。
								// DSH 设置面板是 modal、打开状态组件私有（无官方跳转 API），只能触发侧边栏那个
								// 设置触发器（aria-haspopup="dialog" 是它的契约属性）。注意 DSH 自身有 6+ 个元素
								// 带这个属性，旧写法直接取文档序第一个（恰好排在最前才碰对）——这里按
								// "可见 + 无障碍名匹配 设置/Settings" 挑，挑不到才退回第一个。
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "gacha-cal-refresh",
									title: "\u8BBE\u7F6E",
									"aria-label": "\u8BBE\u7F6E",
									onClick: () => {
										setOpen(false);
										const all = [...document.querySelectorAll('[aria-haspopup="dialog"]')];
										const visible = all.filter((el) => typeof el.getClientRects === "function" && el.getClientRects().length > 0);
										const named = visible.find((el) => {
											const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim();
											return /\u8BBE\u7F6E|\u8A2D\u5B9A|Settings/i.test(label);
										});
										const t = named || visible[0] || all[0];
										if (t && typeof t.click === "function") t.click();
									},
									children: (0, react_jsx_runtime.jsx)("svg", {
										width: "13",
										height: "13",
										viewBox: "0 0 24 24",
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2",
										strokeLinecap: "round",
										strokeLinejoin: "round",
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [
												(0, react_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
												(0, react_jsx_runtime.jsx)("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" })
											]
										})
									})
								}),
								// 抓取提示：放在设置按钮右边（行内只给分类，悬停分行看原因）
								scrapeInfo ? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-scrape", title: scrapeLines.join("\n"), children: scrapeInfo }) : null
							] }),
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-h", children: [
								(0, react_jsx_runtime.jsx)("span", {}),
								(0, react_jsx_runtime.jsx)("span", { children: "\u6E38\u620F" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5F53\u524D\u5361\u6C60" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5361\u6C60\u8D77\u6B62" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u5F53\u524D\u6D3B\u52A8" }),
								(0, react_jsx_runtime.jsx)("span", { children: "\u6D3B\u52A8\u8D77\u6B62" })
							] }),
							games.map((g) => {
								// 卡池列：外显纯角色名（cleanRoleNames 去称号·前缀/属性后缀；蔚蓝档案三服保留括号换装后缀；
								// 无角色名时显示卡池名），悬停弹出卡池全名+角色；无数据时显示占位符 "—"
								const gachaVisible = g.roles ? cleanRoleNames(g.roles, g.id) : (g.banner || "—");
								const gachaTitle = (g.roles ? `${g.banner}\uFF1A${g.roles}` : (g.banner || "")) + (g.bannerDates ? `\n${g.bannerDatesRaw || g.bannerDates}` : "");
								// 活动列：外显活动名称，悬停弹出活动全名+起止（起止显示源站原文）；无数据时显示 "—"
								const eventName = g.event || "—";
								const eventTitle = g.event
									? (g.eventDates ? `${g.event}\n${g.eventDatesRaw || g.eventDates}` : g.event)
									: (g.eventDatesRaw || g.eventDates || "");
								// 该列本次没拿到新内容（失败/未命中）时，把它补进悬停：
								// 括号包住；若该列显示的是沿回的旧值，则另起一行补在旧内容下面
								const withFailNote = (base, side, fail, stale, userSupplied) => {
									const text = sideFailText(side, fail, { userSupplied });
									const note = text ? "（" + text + "）" : "";
									if (!note) return base || "";
									return stale && base ? base + "\n" + note : note;
								};
								// 该侧地址是否由用户自己填（自定义条目 / 自定义网址）：是的话"未命中"多半意味着
								// "你填的这个地址读不出内容"，文案换一句更贴切的（状态仍是"未公布"，不改三态语义）
								const gachaUser = !!g.custom || isCustomSource(s, g.id);
								const eventUser = !!g.custom || isCustomSource(s, g.id, "eventUrl");
								// 游戏名/图标悬停：这行数据的"上次成功"时间（+ 哪列沿用了旧数据）
								const rowTitle = buildRowTitle(g);
								return (0, react_jsx_runtime.jsxs)("div", {
									className: "gacha-cal-row",
									key: g.id,
									title: rowTitle,
									children: [
										(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, loading: "lazy" }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name", title: rowTitle, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.bannerHover || gachaTitle, "gacha", g.gachaFail, g.gachaStale, gachaUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: gachaVisible }) }),
										// 起止列：倒计时用补全后的时间；悬停显示源站原文（如"4.5版本更新后 ~ …"）
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.bannerDatesRaw || g.bannerDates, "gacha", g.gachaFail, g.gachaStale, gachaUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: (0, react_jsx_runtime.jsx)("b", { children: displayTimeCell(g.bannerDates || "", now) }) }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventHover || eventTitle, "event", g.eventFail, g.eventStale, eventUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: eventName }) }),
										(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-cell", title: withFailNote(g.eventDatesRaw || g.eventDates, "event", g.eventFail, g.eventStale, eventUser), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: displayTimeCell(g.eventDates || "", now) }) })
									]
								});
							})
						]
					}) : null
				]
			});
		}

		// engine：core 引擎（设置页的「解析器自检」用它跑 selfCheck()）
		function CalendarSettingsPage({ scope, engine }) {
			const [snapshot, setSnapshot] = (0, react.useState)(() => scope.getSnapshot());
			const [adding, setAdding] = (0, react.useState)(false);
			// 添加表单临时值（名称/图标手动填；卡池与活动内容由链接解析产出）
			const [form, setForm] = (0, react.useState)({ name: "", icon: "", url: "", eventUrl: "" });
			const [customInputs, setCustomInputs] = (0, react.useState)({});
			const [eventCustomInputs, setEventCustomInputs] = (0, react.useState)({});
			// 解析器自检（只读）：运行中标记 + 上一次的报告
			const [selfChecking, setSelfChecking] = (0, react.useState)(false);
			const [selfReport, setSelfReport] = (0, react.useState)(null);
			// 逐个来源跑一遍，报告「解析出 0 条 / 抓取报错」；不改动设置与缓存
			const runSelfCheck = async () => {
				if (selfChecking) return;
				setSelfChecking(true);
				try {
					const started = Date.now();
					const report = await engine.selfCheck();
					setSelfReport({ ...report, elapsedMs: Date.now() - started });
				} catch (err) {
					setSelfReport({ error: String((err && err.message) || err) });
				} finally {
					setSelfChecking(false);
				}
			};
			(0, react.useEffect)(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
			const s = { ...DEFAULT_SETTINGS, ...(snapshot.value ?? {}) };

			const allEntries = getAllEntries(s);
			const hidden = Array.isArray(s.hidden) ? s.hidden : [];
			const removed = Array.isArray(s.removed) ? s.removed : [];
			const urls = parseJsonStr(s.customUrls, {});
			const customs = parseJsonStr(s.customEntries, []);

			const order = Array.isArray(s.order) && s.order.length > 0 ? s.order : allEntries.map((x) => x.id);
			const sorted = applyOrder(allEntries, order);
			const currentMinutes = Number(s.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes);
			// 旧配置可能存了分钟值（不在按天选项里），额外补一个"自定义"选项避免 select 空白
			const inOptions = REFRESH_OPTIONS.some((o) => o.minutes === currentMinutes);

			// 保存失败必须可见：旧实现只 await 不 catch，写被宿主拒绝时控件弹回原值、
			// 用户只会觉得"点了没反应"（「恢复默认顺序」写 null 被拒就是这种病的极端例子）
			const [saveError, setSaveError] = (0, react.useState)("");
			const commit = async (key, value) => {
				try {
					await scope.set(key, value);
					setSaveError("");
				} catch (err) {
					setSaveError("\u4FDD\u5B58\u5931\u8D25\uFF1A" + String((err && err.message) || err || "未知错误"));
				}
				setSnapshot(scope.getSnapshot());
			};

			const setOrder = async (nextIds) => { await commit("order", nextIds); };
			const move = async (id, delta) => {
				// order 可能缺少新条目的 id（如新增的 ba-jp），按默认顺序补齐后再移动
				let base = order;
				const allIds = allEntries.map((x) => x.id);
				if (allIds.some((x) => !base.includes(x))) {
					base = base.slice();
					for (const x of allIds) if (!base.includes(x)) base.push(x);
				}
				const idx = base.indexOf(id);
				const target = idx + delta;
				if (idx < 0 || target < 0 || target >= base.length) return;
				const next = base.slice();
				next.splice(idx, 1);
				next.splice(target, 0, id);
				await setOrder(next);
			};
			// 恢复默认顺序：写空数组而不是 null —— 宿主 settings schema 是 z.array(z.string())，
			// 写 null 会被校验拒绝（旧实现因此永久点不动，还抛未捕获 rejection）；applyOrder 对空数组等价"未设置"
			const resetOrder = async () => { await commit("order", []); };

			// 展示开关
			const toggleHidden = async (id) => {
				const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
				await commit("hidden", next);
			};
			// 删除条目：内置条目记入 removed；自定义条目从 customEntries 移除
			const removeEntry = async (g) => {
				if (g.custom) {
					const next = customs.filter((c) => c.id !== g.id);
					await commit("customEntries", JSON.stringify(next));
				} else {
					await commit("removed", [...removed, g.id]);
				}
			};
			// 恢复默认条目：清空删除记录与自定义条目
			const restoreAll = async () => {
				await commit("removed", []);
				await commit("customEntries", "[]");
			};
			// 爬取地址：默认/备选源/自定义。customUrls[id] 存选中值：
			// - 无 key → 默认源；- 值 === "custom:<用户输入>" → 自定义输入；- 其它（如 "proxy:https://..."）→ 备选源值
			const entryUrlMode = (id, g) => {
				const urls = parseJsonStr(s.customUrls, {});
				if (!urls || typeof urls !== "object" || !Object.prototype.hasOwnProperty.call(urls, id)) return "default";
				const v = urls[id];
				if (typeof v === "string" && v.startsWith("custom:")) return "custom";
				return normalizeSourceId(v); // 备选源标识（老配置的 proxy:/gk-*: 在这里翻译成新标识）
			};
			const setUrlMode = async (id, mode, g) => {
				const next = { ...(urls || {}) };
				if (mode === "default") delete next[id];
				else if (mode === "custom") next[id] = "custom:" + (customInputs[id] ?? "");
				else next[id] = mode; // 备选源标识（url 或 id）
				await commit("customUrls", JSON.stringify(next));
			};
			const setCustomUrl = async (id, value) => {
				setCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(urls || {}) };
				next[id] = "custom:" + value;
				await commit("customUrls", JSON.stringify(next));
			};
			// 活动来源地址：默认/自定义（存 customEventUrls），判定同上（custom: 前缀）
			const eventUrls = parseJsonStr(s.customEventUrls, {});
			const eventUrlMode = (id) => {
				const eu = parseJsonStr(s.customEventUrls, {});
				if (!eu || typeof eu !== "object" || !Object.prototype.hasOwnProperty.call(eu, id)) return "default";
				const v = eu[id];
				return String(v ?? "").startsWith("custom:") ? "custom" : normalizeSourceId(v);
			};
			const setEventUrlMode = async (id, mode) => {
				const next = { ...(eventUrls || {}) };
				if (mode === "custom") next[id] = "custom:" + (eventCustomInputs[id] ?? "");
				else delete next[id];
				await commit("customEventUrls", JSON.stringify(next));
			};
			const setCustomEventUrl = async (id, value) => {
				setEventCustomInputs((p) => ({ ...p, [id]: value }));
				const next = { ...(eventUrls || {}) };
				next[id] = "custom:" + value;
				await commit("customEventUrls", JSON.stringify(next));
			};
			// 添加自定义条目：名称/图标手动填，卡池与活动内容由链接解析产出
			const addEntry = async () => {
				if (!form.name.trim() || !form.url.trim()) return;
				const id = "custom-" + Date.now().toString(36);
				const entry = {
					id,
					name: form.name.trim(),
					icon: form.icon.trim(),
					url: form.url.trim(),
					eventUrl: form.eventUrl.trim()
				};
				await commit("customEntries", JSON.stringify([...customs, entry]));
				setForm({ name: "", icon: "", url: "", eventUrl: "" });
				setAdding(false);
			};
			const updateForm = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

			// 选择器/输入框统一样式；textOverflow/overflow 让长选项文本省略截断，避免与下拉箭头重叠
			const inputStyle = { padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", borderRadius: 6, fontSize: 12, maxWidth: "100%", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" };
			const labelStyle = { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "none" };

			return (0, react_jsx_runtime.jsxs)("div", {
				style: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 720, fontSize: 13, padding: "2px 0 8px" },
				children: [
					(0, react_jsx_runtime.jsxs)("div", { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600 }, children: "\u4E8C\u6E38\u6392\u671F" }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, marginTop: 2 }, children: "\u5361\u6C60\u65E5\u5386\u63D2\u4EF6\u8BBE\u7F6E" })
					] }),
					saveError ? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary, #d4380d)", fontSize: 12 }, children: saveError }) : null,
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [
							(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !!s.autoRefresh, onChange: (e) => commit("autoRefresh", e.target.checked) }),
							(0, react_jsx_runtime.jsx)("span", { children: "\u81EA\u52A8\u5237\u65B0\u6392\u671F\u6570\u636E" })
						] }),
						(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { flex: "none" }, children: "\u5237\u65B0\u9891\u7387" }),
							(0, react_jsx_runtime.jsxs)("select", { value: String(currentMinutes), onChange: (e) => commit("refreshMinutes", Number(e.target.value)), children: [
								!inOptions ? (0, react_jsx_runtime.jsx)("option", { value: String(currentMinutes), children: "\u81EA\u5B9A\u4E49 (" + currentMinutes + " \u5206\u949F)" }) : null,
								REFRESH_OPTIONS.map((o) => (0, react_jsx_runtime.jsx)("option", { value: String(o.minutes), children: o.label }, o.minutes))
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "\u5728\u4FA7\u8FB9\u680F\u9762\u677F\u6253\u5F00\u671F\u95F4\uFF0C\u6309\u6B64\u9891\u7387\u81EA\u52A8\u5237\u65B0\u6E90\u6570\u636E\u3002" })
					] }),
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "\u6761\u76EE\u7BA1\u7406" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: resetOrder, children: "\u6062\u590D\u9ED8\u8BA4\u987A\u5E8F" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: restoreAll, children: "\u6062\u590D\u9ED8\u8BA4\u6761\u76EE" })
							] })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "「展示」控制面板是否显示；「↑↓」调整顺序；「自定义」可覆盖来源地址；卡池来源与活动来源各自独立选择；删除后可恢复默认。" }),
						// 表头行（与数据行同 grid 列；全部居中，与下方各列边界对齐）
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-tertiary)", fontSize: 11 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6E38\u620F" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5C55\u793A" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u5361\u6C60\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u6D3B\u52A8\u6765\u6E90" }),
							(0, react_jsx_runtime.jsx)("span", { style: { justifySelf: "center" }, children: "\u64CD\u4F5C" })
						] }),
						sorted.map((g, i) => {
							const mode = entryUrlMode(g.id, g);
							const evMode = eventUrlMode(g.id);
							const showGachaInput = mode === "custom";
							const showEventInput = evMode === "custom";
							return (0, react_jsx_runtime.jsxs)("div", {
								key: g.id,
								style: { borderBottom: "1px solid var(--dsw-alias-border-l1)" },
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "grid", gridTemplateColumns: "minmax(90px,1fr) auto minmax(130px,1.2fr) minmax(130px,1.2fr) auto", gap: 10, alignItems: "center", padding: "4px 0" },
										children: [
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 }, children: [
												(0, react_jsx_runtime.jsx)("img", { src: g.icon, alt: g.name, style: { width: 22, height: 22, borderRadius: 5, objectFit: "cover", flex: "none" } }),
												(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-name gacha-cal-settings-name", style: { flex: "1 1 auto", minWidth: 0 }, children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: g.name }) })
											] }),
											(0, react_jsx_runtime.jsxs)("label", { style: { ...labelStyle, cursor: "pointer", justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("input", { type: "checkbox", checked: !hidden.includes(g.id), onChange: () => toggleHidden(g.id) }),
												(0, react_jsx_runtime.jsx)("span", { children: "\u5C55\u793A" })
											] }),
											// 卡池来源选择器
											(0, react_jsx_runtime.jsxs)("select", {
												value: mode,
												style: { ...inputStyle, textAlign: "center" },
												onChange: (e) => setUrlMode(g.id, e.target.value, g),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g) }),
													(g.altSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: altSourceId(a), children: a.label }, a.label)),
													(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "\u81EA\u5B9A\u4E49" })
												]
											}),
											// 活动来源选择器（未配置活动源默认项为"未配置"，选择"自定义"后展开输入行）
											(0, react_jsx_runtime.jsxs)("select", {
												value: evMode,
												style: { ...inputStyle, textAlign: "center" },
												onChange: (e) => setEventUrlMode(g.id, e.target.value),
												children: [
													(0, react_jsx_runtime.jsx)("option", { value: "default", children: getDefaultSourceName(g, "eventUrl") }),
													(g.eventAltSources || []).map((a) => (0, react_jsx_runtime.jsx)("option", { value: altSourceId(a), children: a.label }, a.fetcher)),
													(0, react_jsx_runtime.jsx)("option", { value: "custom", children: "自定义" })
												]
											}),
											(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 4, justifySelf: "center" }, children: [
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", title: "\u4E0A\u79FB", disabled: i === 0, onClick: () => move(g.id, -1), children: "\u2191" }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", title: "\u4E0B\u79FB", disabled: i === sorted.length - 1, onClick: () => move(g.id, 1), children: "\u2193" }),
												(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn gacha-cal-del-btn", title: "\u5220\u9664", onClick: () => removeEntry(g), children: (0, react_jsx_runtime.jsx)("svg", {
													width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
													children: [
														(0, react_jsx_runtime.jsx)("path", { d: "M3 6h18" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }),
														(0, react_jsx_runtime.jsx)("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }),
														(0, react_jsx_runtime.jsx)("line", { x1: "10", y1: "11", x2: "10", y2: "17" }),
														(0, react_jsx_runtime.jsx)("line", { x1: "14", y1: "11", x2: "14", y2: "17" })
													]
												}) })
											] })
										]
									}),
									// 自定义输入行：选择"自定义"后整行展开（全宽，不挤压列）
									showGachaInput || showEventInput ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "0 4px 6px" }, children: [
										showGachaInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "卡池来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "MediaWiki api.php URL",
												value: customInputs[g.id] ?? (urls && typeof urls === "object" ? String(urls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null,
										showEventInput ? (0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, flex: "1 1 280px", minWidth: 220 }, children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", flex: "none" }, children: "活动来源地址" }),
											(0, react_jsx_runtime.jsx)("input", {
												type: "text",
												placeholder: "MediaWiki api.php URL",
												value: eventCustomInputs[g.id] ?? (eventUrls && typeof eventUrls === "object" ? String(eventUrls[g.id] ?? "").replace(/^custom:/, "") : "") ?? "",
												onChange: (e) => setCustomEventUrl(g.id, e.target.value),
												style: { ...inputStyle, flex: "1 1 160px" }
											})
										] }) : null
									] }) : null
								]
							});
						}),
						adding ? (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px dashed var(--dsw-alias-border-l2)", borderRadius: 8, padding: 10, marginTop: 6 }, children: [
							(0, react_jsx_runtime.jsx)("div", { style: { fontWeight: 600 }, children: "\u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" }),
							(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11, marginBottom: 2 }, children: "名称/图标手动填写；卡池与活动内容由链接解析产出（MediaWiki api.php 或含排期的网页），刷新时自动解析。" }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u540D\u79F0 *", value: form.name, onChange: updateForm("name"), style: { ...inputStyle, flex: "1 1 140px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u56FE\u6807 URL", value: form.icon, onChange: updateForm("icon"), style: { ...inputStyle, flex: "1 1 240px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u5361\u6C60\u6765\u6E90\u94FE\u63A5 * (MediaWiki api.php)", value: form.url, onChange: updateForm("url"), style: { ...inputStyle, flex: "1 1 300px" } }),
								(0, react_jsx_runtime.jsx)("input", { type: "text", placeholder: "\u6D3B\u52A8\u6765\u6E90\u94FE\u63A5 (\u53EF\u9009)", value: form.eventUrl, onChange: updateForm("eventUrl"), style: { ...inputStyle, flex: "1 1 300px" } })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", disabled: !form.name.trim() || !form.url.trim(), onClick: addEntry, children: "\u6DFB\u52A0" }),
								(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", onClick: () => setAdding(false), children: "\u53D6\u6D88" })
							] })
						] }) : (0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-sort-btn", style: { alignSelf: "flex-start", marginTop: 6 }, onClick: () => setAdding(true), children: "+ \u6DFB\u52A0\u81EA\u5B9A\u4E49\u6761\u76EE" })
					] }),
					// 解析器自检：逐源检查「没内容 / 报错」，源站改版后用来定位问题。只读（core 的 selfCheck() 保证）
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 10, padding: "12px 14px", background: "var(--dsw-alias-bg-layer-1)" }, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: "解析器自检" }),
							(0, react_jsx_runtime.jsx)("button", { type: "button", className: "gacha-cal-refresh", disabled: selfChecking, onClick: runSelfCheck, children: selfChecking ? "自检中…" : (selfReport ? "重新自检" : "开始自检") })
						] }),
						(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "逐个来源检查：哪个源没内容、哪个源报错。只读，不改动设置与缓存。" }),
						selfReport ? (selfReport.error
							? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-primary)", fontSize: 12 }, children: "自检失败：" + selfReport.error })
							: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }, children: [
								(0, react_jsx_runtime.jsx)("div", { children: "共 " + selfReport.total + " 条 · 来源结论 " + (selfReport.summary.ok + selfReport.summary.nomatch + selfReport.summary.down) + " 个：正常 " + selfReport.summary.ok + " / 未公布 " + selfReport.summary.nomatch + " / 报错 " + selfReport.summary.down + " · 用时 " + (selfReport.elapsedMs / 1000).toFixed(1) + "s" }),
								selfReport.problems.length === 0
									? (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-business-primary)" }, children: "✓ 所有来源都能解析出当期内容，没有发现问题" })
									: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: [
										(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)" }, children: "需要关注：" }),
										selfReport.problems.map((p, i) => (0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-primary)" }, children: "· " + p }, i))
									] })
							] })) : null
					] }),
					(0, react_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: "数据来源：官方公告 / 官方Wiki（bwiki、PRTS 等）；无联网抓取数据时对应列显示为空。自定义条目的链接会尝试解析（MediaWiki/常见卡池与活动表格），解析失败时该列显示为空。" })
				]
			});
		}
		//#endregion

		//#region plugin
		const inject = ["slots", "settingsScope", "locale"];
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-gacha-calendar";
				style.textContent = STYLE;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-gacha-calendar: styles");

			// DSH 设置页左侧导航的 section 图标由 navIcon 硬编码（未知 id 一律默认齿轮），
			// 插件无法通过 settings.section 配置图标；这里在设置面板打开后，把
			// "二游排期" 导航项的齿轮图标替换为日历图标（Lucide 风格 16px，幂等）。
			// 性能：MutationObserver 回调只置脏标记，用 requestAnimationFrame 合并执行；
			// patch 先查 dialog 是否存在，不存在立即返回（Web 端高频 DOM 变化时开销极小）。
			ctx.effect(() => {
				const LABEL = "\u4E8C\u6E38\u6392\u671F";
				const CAL_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
				let raf = 0;
				const patch = () => {
					raf = 0;
					const dialog = document.querySelector('[role="dialog"]');
					if (!dialog) return;
					const buttons = dialog.querySelectorAll("nav button");
					for (const btn of buttons) {
						const labelEl = btn.querySelector("span");
						if (!labelEl || labelEl.textContent.trim() !== LABEL) continue;
						if (btn.dataset.gachaCalIcon === "1") continue;
						const icon = btn.querySelector("svg");
						if (icon) {
							icon.style.display = "none"; // 隐藏 DSH 默认齿轮
							const wrap = document.createElement("span");
							wrap.setAttribute("aria-hidden", "true");
							wrap.innerHTML = CAL_ICON_SVG;
							// 插到按钮第一个子元素位置（与 DSH 图标同级，flex 子项对齐一致）
							btn.insertBefore(wrap.firstChild, btn.firstChild);
							btn.dataset.gachaCalIcon = "1";
						}
					}
				};
				const schedule = () => {
					if (raf) return;
					raf = requestAnimationFrame(patch);
				};
				schedule();
				const mo = new MutationObserver(schedule);
				mo.observe(document.body, { childList: true, subtree: true });
				return () => {
					mo.disconnect();
					if (raf) cancelAnimationFrame(raf);
				};
			}, "dsh-gacha-calendar: settings nav icon");

			// 全局截断文字悬停 marquee（面板 + 设置页共用）：内容超出容器时加
			// gacha-cal-marq 并计算滚动距离，让内层 span 来回滚动显示全文（未超宽不加）。
			ctx.effect(() => {
				const onOver = (e) => {
					const cell = e.target.closest(".gacha-cal-name, .gacha-cal-cell");
					if (!cell) return;
					const inner = cell.querySelector(".gacha-cal-inner");
					if (!inner) return;
					const dist = inner.scrollWidth - cell.clientWidth;
					if (dist > 0) {
						cell.style.setProperty("--gacha-marq-d", `-${dist + 8}px`);
						cell.classList.add("gacha-cal-marq");
					}
				};
				const onOut = (e) => {
					const cell = e.target.closest(".gacha-cal-name, .gacha-cal-cell");
					if (!cell) return;
					// mouseout 会在"从格子移到它内部的 span"时也触发（并冒泡到这里）：
					// 只有真的离开这整块区域才停滚动，否则悬停滚动会在格子里抖一下/被打断
					if (e.relatedTarget && cell.contains(e.relatedTarget)) return;
					cell.classList.remove("gacha-cal-marq");
				};
				document.addEventListener("mouseover", onOver);
				document.addEventListener("mouseout", onOut);
				return () => {
					document.removeEventListener("mouseover", onOver);
					document.removeEventListener("mouseout", onOut);
				};
			}, "dsh-gacha-calendar: marquee");

			const scope = ctx.settingsScope.bind({ namespace: NS });
			// core 引擎：抓取/解析/缓存合并都在 engine 里（面板只读它返回的 Result JSON）。
			// 存储适配（settings scope）与传输适配（直连 + 宿主代理）见 92-dsh-env.js。
			const engine = createDshEngine(scope);

			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-gacha-calendar",
				priority: -10,
				locale: NS,
				inject: () => ({ scope, engine })
			}, CalendarPanel));

			// 设置页单开一个 section（左侧导航独立页面，参照 dsh-cost-meter 的 settings.section 用法）
			// 也把 engine 注入进去：设置页的「解析器自检」要调 engine.selfCheck()
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "gacha-calendar",
				order: 25,
				label: "\u4E8C\u6E38\u6392\u671F",
				locale: NS,
				inject: () => ({ scope, engine })
			}, CalendarSettingsPage));
		}
		//#endregion

		//#region DSH 环境适配（外壳专属，不进 core）
		// 把 DSH 的运行环境注入上一步定义的 core env：
		//   fetchRaw      → 浏览器原生 fetch（bwiki / PRTS 等 CORS 放行的源直接抓）
		//   fetchViaProxy → 宿主代理 /api/gacha-calendar-proxy（绕过 CORS 与 Referer 反爬）
		// 换到浏览器扩展 / 原生平台时，只需替换本文件的内容，core 一行都不用改。
		const DSH_PROXY_PREFIX = "/api/gacha-calendar-proxy";

		// 直连抓取：原样转发浏览器的 fetch（response 形态不变，调用点无需改）
		async function dshFetchRaw(url, opts) {
			return fetch(url, opts);
		}

		// 经宿主代理抓取：GET/POST + referer + 可选额外请求头 → 返回目标站原始 body 字符串。
		// 宿主侧会做白名单校验（见 lib/index.js 的 PROXY_ALLOW_HOSTS），未列入白名单的主机一律拒绝。
		async function dshFetchViaProxy(proxyUrl, { referer, headers: extraHeaders, body } = {}) {
			let api = DSH_PROXY_PREFIX + "?url=" + encodeURIComponent(proxyUrl) + "&referer=" + encodeURIComponent(referer || "");
			if (extraHeaders) api += "&headers=" + encodeURIComponent(JSON.stringify(extraHeaders));
			const opts = { headers: { "Accept": "application/json" } };
			if (body !== void 0) {
				opts.method = "POST";
				opts.headers["Content-Type"] = "application/json; charset=utf-8";
				opts.body = JSON.stringify(body);
			}
			const res = await fetch(api, opts);
			if (!res.ok) throw new Error("proxy-http-" + res.status);
			const j = await res.json();
			if (!j || j.status !== 200 || typeof j.body !== "string") throw new Error("proxy-bad:" + (j?.error || j?.status));
			return j.body;
		}

		// 默认注入一次（供直接调用 core 内部函数的场景，如回归脚本）；正式路径由 createDshEngine 注入
		const DSH_TRANSPORT = { fetchRaw: dshFetchRaw, fetchViaProxy: dshFetchViaProxy };
		setCoreEnv({ transport: DSH_TRANSPORT });

		// DSH 的存储适配：settings scope（settings.yaml 的 gacha-calendar 命名空间）→ engine 的 storage 接口。
		// engine 只认 get(key)/set(key, value)，键名沿用既有设置键，所以设置页与历史缓存都不用迁移。
		function dshStorage(scope) {
			return {
				async get(key) {
					const snap = scope.getSnapshot();
					const value = snap && snap.value ? snap.value : {};
					return value[key];
				},
				async set(key, value) {
					await scope.set(key, value);
				}
			};
		}

		// 组装 DSH 侧的 core 引擎（面板只通过它拿 Result JSON，不再自己抓取/合并）
		function createDshEngine(scope) {
			return createEngine({
				transport: DSH_TRANSPORT,
				storage: dshStorage(scope),
				now: () => Date.now()
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
