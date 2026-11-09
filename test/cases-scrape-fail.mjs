// test/cases-scrape-fail.mjs —— 底部失败横条并入刷新横幅悬停明细（2026-11-10 用户要求）
//
// ── 这一段守什么 ──
//   ① **静态**：`82-schedule-view.js` 里不再有失败横条（`gacha-cal-sched-failbar`）与「重试」
//      （`gacha-cal-sched-retry`），`styles/*.css` 里也没有它们的残留规则；只服务于横条的警示图标
//      `scheduleWarnIcon` 一并删除。底栏那个「刷新」圆按钮仍在（整轮刷新能力没丢，不另加替代按钮）。
//   ② **行为**：`buildScrapeInfo` 的**文字**（`info`）逐字不变；失败**明细**（`lines`）在该侧 down
//      且仍有可沿用旧数据时追加「（沿用上次成功数据）」，逐字形如
//      `赛马娘·日服 卡池失败：HTTP 502（沿用上次成功数据）`。
//      未命中（nomatch）/ 未配置两类**不追加**（口径与删除前一致）。
//   ③ **口径来源**：横幅的 `title` = `scrapeLines.join("\n")`（82），而 `scrapeLines` 就是这里的
//      `lines`（83 的 doRefresh / cachedBanner 两条路径都走同一个 buildScrapeInfo）⇒ 钉住 lines
//      就等于钉住了悬停明细。
//
// ⚠️ 反证（本轮实测过、不写进门禁）：把 60-helpers.js 里 `sideFailCarriedOver` 的追加段去掉，
//    本文件「含（沿用上次成功数据）」那几条立刻红 —— 说明这些断言真的在守合并后的行为。

import { readFileSync } from "node:fs";
import path from "node:path";
import { check, section } from "./harness.mjs";
import { T, REPO, readComponentsSource, readStylesSource } from "./load.mjs";

const VIEW = readFileSync(path.join(REPO, "src", "client", "82-schedule-view.js"), "utf8");

const GAME = { id: "uma-jp", name: "赛马娘·日服" };
// 两侧都配了源 ⇒ 悬停明细里不会混进「未配置有效来源」。
const SOURCES = [{ id: "uma-jp", name: "赛马娘·日服", url: "https://example.com/a", eventUrl: "https://example.com/b" }];
const GACHA_OLD = [{ key: "uma-jp:gacha:0", title: "旧卡池", startTs: 1, endTs: 2, tz: "Asia/Tokyo", raw: "旧档期", source: "primary" }];
const EVENT_OLD = [{ key: "uma-jp:event:0", title: "旧活动", startTs: 1, endTs: 2, tz: "Asia/Tokyo", raw: "旧档期", source: "primary" }];
const DOWN_502 = { kind: "down", reason: "HTTP 502" };

const runOf = (rec) => T.buildScrapeInfo([GAME], { games: { "uma-jp": rec } }, SOURCES);

export default function run() {
	section("刷新横幅 ①：底部失败横条 + 重试已删除（静态守卫）");
	{
		const comp = readComponentsSource();
		const css = readStylesSource();
		check("82 里不再出现 `gacha-cal-sched-failbar`（失败横条 DOM）",
			!comp.includes("sched-failbar"), "仍出现在组件源里");
		check("82 里不再出现 `gacha-cal-sched-retry`（「重试」按钮 DOM）",
			!comp.includes("sched-retry"), "仍出现在组件源里");
		check("CSS 里没有失败横条 / 重试按钮 / 警示图标的残留类",
			!/sched-failbar|sched-failtext|sched-retry|sched-fic/.test(css),
			css.split("\n").filter((l) => /sched-failbar|sched-failtext|sched-retry|sched-fic/.test(l)).join(" ⏎ ").slice(0, 200));
		check("只服务于横条的警示图标 `scheduleWarnIcon` 已删除",
			!comp.includes("scheduleWarnIcon"), "仍出现在组件源里");
		check("刷新横幅仍是失败信息出口（82 的 title = scrapeLines.join(\"\\n\")）",
			/className: "gacha-cal-sched-scrape", title: \(scrapeLines \|\| \[\]\)\.join\("\\n"\)/.test(VIEW));
		check("底栏「刷新」按钮仍在（整轮刷新能力不因删横条而丢失）",
			/className: "gacha-cal-sched-btn"/.test(VIEW));
	}

	section("刷新横幅 ②：失败明细进悬停，文字口径逐字不变（含沿用判定）");
	{
		// ── ① 某侧 down + 有旧数据 ⇒ 明细追加「（沿用上次成功数据）」，info 一个字不多 ──
		const carried = runOf({ name: "赛马娘·日服", gacha: GACHA_OLD, events: [], gachaFail: DOWN_502, eventFail: null, gachaStale: true });
		check("横幅文字逐字不变：长原因不进这一行（成功 N/M + 分类）",
			carried.info === "成功 0/1 卡池失败：赛马娘·日服", carried.info);
		check("悬停明细逐字 = `赛马娘·日服 卡池失败：HTTP 502（沿用上次成功数据）`",
			carried.lines.length === 1 && carried.lines[0] === "赛马娘·日服 卡池失败：HTTP 502（沿用上次成功数据）",
			JSON.stringify(carried.lines));

		// ── ② 全新失败（上一轮没有任何数据）⇒ 不写「沿用」（格子写的是「该来源无数据」）──
		const fresh = runOf({ name: "赛马娘·日服", gacha: [], events: [], gachaFail: DOWN_502, eventFail: null });
		check("down 但这一侧没有可沿用旧数据 ⇒ 明细只有失败原因，不追加「沿用」",
			fresh.lines.length === 1 && fresh.lines[0] === "赛马娘·日服 卡池失败：HTTP 502", JSON.stringify(fresh.lines));
		check("…… 且 info 同样逐字不变", fresh.info === "成功 0/1 卡池失败：赛马娘·日服", fresh.info);

		// ── ③ 未命中（nomatch）即使还留着旧数组，也不追加（它不算失败）──
		const nomatch = runOf({ name: "赛马娘·日服", gacha: GACHA_OLD, events: [], gachaFail: { kind: "nomatch" }, eventFail: null });
		check("未命中明细保持原口径（新卡池未公布），不追加「沿用」",
			nomatch.lines.length === 1 && nomatch.lines[0] === "赛马娘·日服 新卡池未公布", JSON.stringify(nomatch.lines));
		check("未命中仍算成功（info 逐字 = 成功 1/1 新卡池未公布：赛马娘·日服）",
			nomatch.info === "成功 1/1 新卡池未公布：赛马娘·日服", nomatch.info);

		// ── ④ 活动侧用复数数组键 `events`：漏了它这一条只会静默丢「沿用」──
		const ev = runOf({ name: "赛马娘·日服", gacha: GACHA_OLD, events: EVENT_OLD, gachaFail: null, eventFail: { kind: "down", reason: "网络不通" }, eventStale: true });
		check("活动侧 down + 有旧数据 ⇒ 明细走 `events` 数组判定并追加「沿用」",
			ev.lines.length === 1 && ev.lines[0] === "赛马娘·日服 活动失败：网络不通（沿用上次成功数据）", JSON.stringify(ev.lines));

		// ── ⑤ 两侧都失败且都有旧数据 ⇒ 每项各自的「沿用」跟在各自原因后面，用「、」分隔 ──
		const both = runOf({ name: "赛马娘·日服", gacha: GACHA_OLD, events: EVENT_OLD, gachaFail: DOWN_502, eventFail: { kind: "down", reason: "网络不通" }, gachaStale: true, eventStale: true });
		check("两侧都沿用 ⇒ 逐项追加，排版仍是「名字 + 空格 + 项目、项目」",
			both.lines.length === 1 && both.lines[0] === "赛马娘·日服 卡池失败：HTTP 502（沿用上次成功数据）、活动失败：网络不通（沿用上次成功数据）",
			JSON.stringify(both.lines));

		// ── ⑥ 面板打开时读的是 lastData（JSON 往返后的记录）⇒ 同一份判定必须同样生效 ──
		const cached = JSON.parse(JSON.stringify({ "uma-jp": { name: "赛马娘·日服", gacha: GACHA_OLD, events: [], gachaFail: DOWN_502, eventFail: null, gachaStale: true } }));
		const fromCache = T.buildScrapeInfo([GAME], { games: cached }, SOURCES);
		check("cachedBanner 路径（lastData JSON 往返）得到同一行明细",
			fromCache.lines[0] === "赛马娘·日服 卡池失败：HTTP 502（沿用上次成功数据）", JSON.stringify(fromCache.lines));

		// ── ⑦ 老缓存可能 stale=true 而数组为空（格子写「该来源无数据」）⇒ 不能说「沿用」──
		const staleEmpty = runOf({ name: "赛马娘·日服", gacha: [], events: [], gachaFail: DOWN_502, eventFail: null, gachaStale: true });
		check("stale 标记但数组为空 ⇒ 不追加「沿用」（判据是「有旧值可显示」，不是 stale 标志本身）",
			staleEmpty.lines[0] === "赛马娘·日服 卡池失败：HTTP 502", JSON.stringify(staleEmpty.lines));

		// ── ⑧ 别的行不受影响：未配置项照旧、不加「沿用」──
		const half = T.buildScrapeInfo([GAME], { games: { "uma-jp": {} } }, [{ id: "uma-jp", name: "赛马娘·日服", url: "", eventUrl: "https://example.com/b" }]);
		check("未配置行逐字不变（卡池未配置有效来源，无「沿用」）",
			half.lines.length === 1 && half.lines[0] === "赛马娘·日服 卡池未配置有效来源", JSON.stringify(half.lines));
	}
}
