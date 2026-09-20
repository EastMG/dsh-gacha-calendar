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
				// 2：档位改按池名判定（中坚优先）+ 外显与悬停共用同一份排序列表（v0.9.25 修）
				parserVersion: 2,
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
