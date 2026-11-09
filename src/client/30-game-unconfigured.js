// src/client/30-game-unconfigured.js —— 三条「只注册条目、**来源留空未配置**」的条目
//
// 2026-11-09 与无期迷途 / 夜幕之下同一批接入，但这三款**本批没有任何可用数据源**
// （调研结论见 README_Dev 的「新接入的 5 款（2026-11-09）」一节）：
//
//   id        游戏            调研到的东西                                为什么留空
//   wd        未定事件簿       米哈游 wd.mihoyo.com 的公告接口**通**，但  数据停更（chan51 最新 2025-09-24、
//                             内容停在旧版本                             bwiki 备选停在 2024-03）⇒ 接上去只会
//                                                                       显示一份过期档期，比"未配置"更糟
//   hlr       时空中的绘旅人   官网 hlr.163.com 只有公告 HTML（SSR），   卡池只能靠公告正文抽，没有一页
//                             且无列表接口/无稳定分页                    能取到"卡池 + 起止"
//   cytq      炽焰天穹         用户写作「炽焰苍穹」；bwiki 只有 `cytq`    无任何可用源（bwiki 没有卡池/活动表，
//                             子站、无卡池表无活动表                      官网无可抓接口）
//
// ── 「未配置」在代码里到底长什么样（三处，全部**不产生 fail**）────────────────────
//   ① 刷新：`fetchEntry` 第一行 `if (!source.url && !source.eventUrl) return { ok:true, reason:"skipped" }`
//      ⇒ 不抓取、不计成功、不计失败（`test/cases-new5.mjs` 逐条钉住 reason === "skipped"）；
//   ② 自检：`engine-api.js` 的 `describe(kind, fail, data, url)` 第一行 `if (!url)` ⇒
//      `{ state:"unconfigured", text:"未配置来源" }`，进 `summary.unconfigured` 而**不是** `down`
//      （设置页一行结论会写「… / 未配置 N / 失败 0」）；
//   ③ 设置页下拉：`getDefaultSourceName(g, "url"|"eventUrl")` 两侧都返回裸「未配置」
//      （不带括号注释，2026-10-03 用户明确要求）。
//   面板（82-schedule-view.js）里这两侧没有「外显条目」⇒ 该格写「该来源无数据」（灰底），
//   底部也**不会**出现失败横条（那是 `isDown(gachaFail|eventFail)` 才有的）。
//
// ── 为什么这几款 `defaultHidden: true`（2026-11-09 用户要求）──────────────────
// 它们两侧都没配来源 ⇒ 面板上只会是两个灰格「该来源无数据」，占版面又没信息。
// 所以**出厂不勾选展示**（与 bh3 / ournotes / czn / ddlezj 同一种处理）；
// 条目仍在设置页列表里，勾上「展示」就出来；填上来源也立刻生效。
// ⚠️ 改 `defaultHidden` 必须同步 `10-config.js` 的 `DEFAULT_SETTINGS.remindGames`
// 与 `src/index.js` 的 `REMIND_GAMES_DEFAULT`（守卫见 test/cases-ticker.mjs：
// 两者必须恰等于 `defaultHidden !== true` 的集合）。

		registerSource({
			id: "wd",
			defaultHidden: true,
			tz: "Asia/Shanghai",
			name: "未定事件簿",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/bd/c8/ad/bdc8ad3c-1bd5-debe-90b9-e67ea22578de/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
			// url / eventUrl **都不给** = 未配置（见文件头 ①）
		});

		registerSource({
			id: "hlr",
			defaultHidden: true,
			tz: "Asia/Shanghai",
			name: "时空中的绘旅人",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/1d/2b/48/1d2b48c5-4cdd-ec4b-80a5-336e3574c6ca/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
		});

		registerSource({
			id: "cytq",
			defaultHidden: true,
			tz: "Asia/Shanghai",
			// 用户原话写作「炽焰苍穹」，官方/商店/条目的正式名是「炽焰天穹」（bwiki 子站目录也叫 cytq）
			// ⇒ 显示名按正式名，id 保持用户给的 `cytq`。
			name: "炽焰天穹",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/dc/98/e4/dc98e45f-29eb-d517-0ebb-77e6867fd79f/AppIcon-0-0-1x_U007epad-0-11-0-85-220.png/512x512bb.jpg",
		});
