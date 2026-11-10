// src/client/30-game-unconfigured.js —— 只剩「炽焰天穹」一条：只注册条目、**来源留空未配置**
//
// 2026-11-09 与无期迷途 / 夜幕之下同一批接入；本批调研确认：
//
//   id     游戏       调研到的东西                                    结论
//   cytq   炽焰天穹   用户写作「炽焰苍穹」；bwiki 只有 `cytq` 子站，   仍需留空
//                     但**没有卡池表、没有活动表**；官网无可抓接口      （见下）
//
// ⚠️ 2026-11-09 晚已接入、并从本文件**移走**的两条（别再按老注释把她们当"未配置"）：
//   · `wd`  未定事件簿 → `30-game-miyoushe-bbs.js`（米游社公告 forum_id=33，卡池 + 活动）
//   · `hlr` 时空中的绘旅人 → `30-game-netease.js`（官网 hlr.163.com 新闻列表 + 详情，卡池 + 活动）
//   两款的 `defaultHidden` 仍是 true（2026-11-09 用户要求出厂不勾选展示），
//   所以本文件头原先「三款都没源 ⇒ 灰格占版面」的理由对她们已不成立。
//
// ── 「未配置」在代码里到底长什么样（三处，全部**不产生 fail**）────────────────────
//   ① 刷新：`fetchEntry` 第一行 `if (!source.url && !source.eventUrl) return { ok:true, reason:"skipped" }`
//      ⇒ 不抓取、不计成功、不计失败（`test/cases-new5.mjs` 钉住 reason === "skipped"）；
//   ② 自检：`engine-api.js` 的 `describe(kind, fail, data, url)` 第一行 `if (!url)` ⇒
//      `{ state:"unconfigured", text:"未配置来源" }`，进 `summary.unconfigured` 而**不是** `down`
//      （设置页一行结论会写「… / 未配置 N / 失败 0」）；
//   ③ 设置页下拉：`getDefaultSourceName(g, "url"|"eventUrl")` 两侧都返回裸「未配置」
//      （不带括号注释，2026-10-03 用户明确要求）。
//   面板（82-schedule-view.js）里这两侧没有「外显条目」⇒ 该格写「该来源无数据」（灰底），
//   刷新横幅的悬停明细里也**不会**出现失败项（要 `isDown(gachaFail|eventFail)` 才报；
//   2026-11-10 起底部失败横条已删，失败信息只走刷新横幅悬停）。
//
// ── 为什么 `defaultHidden: true`（2026-11-09 用户要求）──────────────────────────
//   两侧都没配来源 ⇒ 面板上只会是两个灰格「该来源无数据」，占版面又没信息。
//   条目仍在设置页列表里，勾上「展示」就出来；将来填上来源也立刻生效。
//   ⚠️ 改 `defaultHidden` 必须同步 `65-remind.js` 的 `REMIND_DEFAULT_HIDDEN_IDS`
//   （宿主读不到 SOURCES，提醒侧的「展示中」判定只能带一份副本过去；守卫见 test/cases-remind.mjs：
//   那张表必须恰等于 `defaultHidden === true` 的集合）。

		registerSource({
			id: "cytq",
			defaultHidden: true,
			tz: "Asia/Shanghai",
			// 用户原话写作「炽焰苍穹」，官方/商店/条目的正式名是「炽焰天穹」（bwiki 子站目录也叫 cytq）
			// ⇒ 显示名按正式名，id 保持用户给的 `cytq`。
			name: "炽焰天穹",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/dc/98/e4/dc98e45f-29eb-d517-0ebb-77e6867fd79f/AppIcon-0-0-1x_U007epad-0-11-0-85-220.png/512x512bb.jpg"
			// url / eventUrl **都不给** = 未配置（见文件头 ①）
		});
