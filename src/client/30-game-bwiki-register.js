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
				url: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/zspms/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B8%B8%E6%88%8F%E6%9B%B4%E6%96%B0%E5%85%AC%E5%91%8A%5D%5D%5B%5B%E7%B1%BB%E5%88%AB%3A%3A%E7%89%88%E6%9C%AC%5D%5D%7C%3F%E6%A0%87%E9%A2%98%7C%3F%E6%97%B6%E9%97%B4%7Csort%3D%E6%97%B6%E9%97%B4%7Corder%3Ddesc%7Climit%3D40&format=json",
				eventSource: "Bwiki",
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
		GACHA_FETCHERS["zspms"] = (url, signal, tz) => ns_bwiki_wikitext_gachaZspms(url, signal, tz);
		GACHA_FETCHERS["czn"] = (url, signal, tz) => ns_bwiki_wikitext_gachaCzn(url, signal, tz);
		GACHA_FETCHERS["kedr"] = (url, signal, tz) => ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz);
		EVENT_FETCHERS["wuhuamixin"] = Object.assign(EVENT_FETCHERS["wuhuamixin"] || {}, { default: (url, signal, tz) => ns_biligame_activity_eventsWhmxOfficial(url, signal, tz) });
		EVENT_FETCHERS["zspms"] = Object.assign(EVENT_FETCHERS["zspms"] || {}, { default: (url, signal, tz) => ns_bwiki_wikitext_eventsZspms(url, signal, tz) });
		EVENT_FETCHERS["kedr"] = Object.assign(EVENT_FETCHERS["kedr"] || {}, { default: (url, signal, tz) => ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz) });
