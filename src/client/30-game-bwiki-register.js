		// ── 条目 ──
		registerSource({
				id: "wuhuamixin",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "物华弥新",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/13/7f/87/137f873a-f458-678d-347e-068830a74a69/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://wiki.biligame.com/whmx/api.php?action=parse&page=限时招集档案&prop=text&format=json&formatversion=2",
				source: "Bwiki",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=613&positionId=2&typeId=4&pageNum=1&pageSize=50",
				eventSource: "官方公告",
		});

		registerSource({
				id: "zspms",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "战双帕弥什",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b2/99/ed/b299ed39-90ea-03df-c7ee-bd09548991e5/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
				// 2026-11-10：卡池侧改以 `Test4/活动旗帜` 为准（结构化当期池、更新更快）。
				// 2026-11-11：活动侧改以**官方 CDN「版本更新公告」**为准（`ArticleMenu` → 最近 3 篇详情；
				// 官方比 bwiki 新一版：11-05 版本更新那批档期到 12-17，而 bwiki 两个页面都止于 11-05）。
				// 两个 bwiki 页面（`Test4/活动日历` / 旧「版本更新公告」）都降为**手动备选**，解析器与回归全部保留。
				url: ns_bwiki_wikitext_ZSPMS_FLAGS_URL,
				source: "Bwiki 活动旗帜",
				eventUrl: ns_zspms_cdn_MENU_URL,
				eventSource: "官方公告",
				altSources: [{
					label: "Bwiki 更新公告",
					url: ns_bwiki_wikitext_ZSPMS_ASK_URL,
					fetcher: "zspms-bwiki-notice"
				}],
				eventAltSources: [{
					label: "Bwiki 活动日历",
					url: ns_bwiki_wikitext_ZSPMS_CALENDAR_URL,
					fetcher: "zspms-bwiki-calendar"
				}, {
					label: "Bwiki 更新公告",
					url: ns_bwiki_wikitext_ZSPMS_ASK_URL,
					fetcher: "zspms-bwiki-notice"
				}]
		});

		registerSource({
				id: "czn",
				defaultHidden: true,
				tz: "Asia/Shanghai",
				name: "卡厄斯梦境",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/e2/c9/48/e2c94812-11cd-2a52-445a-d67d6ae9e169/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
				url: "https://wiki.biligame.com/czn/api.php?action=parse&page=Module%3AGacha%2Fdata&prop=wikitext&format=json",
				source: "Bwiki",
		});

		registerSource({
				id: "kedr",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "雪松",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b5/8c/b6/b58cb6b2-4be3-0be0-852a-af761afaab06/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				eventSource: "Bwiki",
		});

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["wuhuamixin"] = (url, signal, tz) => ns_bwiki_gachaWhmx(url, signal, tz);
		// 卡池侧默认 = 活动旗帜；旧公告路径保留为 altSources 的抓取器键
		// （第 4 参 `now` 是测试专用契约，生产路径引擎只传 3 参 ⇒ 默认 nowMs()）
		GACHA_FETCHERS["zspms"] = (url, signal, tz, now) => ns_bwiki_wikitext_gachaZspmsFlags(url, signal, tz, now);
		GACHA_FETCHERS["zspms-bwiki-notice"] = (url, signal, tz, now) => ns_bwiki_wikitext_gachaZspms(url, signal, tz, now);
		GACHA_FETCHERS["czn"] = (url, signal, tz) => ns_bwiki_wikitext_gachaCzn(url, signal, tz);
		GACHA_FETCHERS["kedr"] = (url, signal, tz) => ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz);
		EVENT_FETCHERS["wuhuamixin"] = Object.assign(EVENT_FETCHERS["wuhuamixin"] || {}, { default: (url, signal, tz) => ns_biligame_activity_eventsWhmxOfficial(url, signal, tz) });
		// 活动侧默认 = **官方 CDN**（`ArticleMenu` → 最近 3 篇「版本更新公告」详情，见 30-game-zspms-official.js）；
		// 两个 bwiki 页面保留为 eventAltSources 的抓取器键（设置页可手动切）
		EVENT_FETCHERS["zspms"] = Object.assign(EVENT_FETCHERS["zspms"] || {}, {
			default: (url, signal, tz, now) => ns_zspms_cdn_events(url, signal, tz, now),
			"zspms-bwiki-calendar": (url, signal, tz, now) => ns_bwiki_wikitext_eventsZspmsCalendar(url, signal, tz, now),
			"zspms-bwiki-notice": (url, signal, tz, now) => ns_bwiki_wikitext_eventsZspms(url, signal, tz, now)
		});
		EVENT_FETCHERS["kedr"] = Object.assign(EVENT_FETCHERS["kedr"] || {}, { default: (url, signal, tz) => ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz) });
