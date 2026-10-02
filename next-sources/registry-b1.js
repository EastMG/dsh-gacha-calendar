// next-sources/registry-b1.js —— 批次 B1 注册表片段（3 个 JSON 型来源）
//
// 与插件 `src/client/40-fetchers.js` 契约一致；将来由 Lead 汇总进 registry.js。
// id 沿用 registry.js 里预留的 stub 名：uma-jp-umapyoi / bandori-bestdori / pjsk
// （⚠️ 备注：registry.js 的注释把 `bandori-bestdori` 列在"批次 A"下，但 task-5 把
//   Bestdori 分给了本批次；若批次 A 也建同名 id，汇总时需二选一，别让 id 撞了。）
//
// 时区取值与依据（详见各解析器文件头）：
//   · umapyoi 日服 = Asia/Tokyo —— bwiki 硬标注「日服卡池时间记录统一为日本时间」，
//     且夹具里所有 start_date 落在 03:00Z（=12:00 JST）、end_date 落在 02:59:59Z（=11:59:59 JST）。
//   · Bestdori 简中服 = Asia/Shanghai —— UTC 毫秒本身即绝对时刻，tz 只用于渲染；
//     官方 displayTime 2026-09-29 10:00 ↔ 简中服 startAt 02:00Z 完全吻合（调研文档 + 夹具复验）。
//   · sekai cn-diff = Asia/Shanghai —— GitHub Pages 静态 JSON，epoch 毫秒；
//     夹具自洽证据：生日池落在 UTC+8 的 00:00（UTC+9 会变 01:00）、月卡池落在 04:00、常规池轮换 12:00。
//     ⚠️ 服区存疑：仓库是 `cn-diff`，但首条事件 2021-10-09 15:00(UTC+8) 更像**繁中服**上线期，
//        且部分条目名是繁体 → 只写"中文服数据"，**不要**当成国服专属源（简中/繁中同为 UTC+8，时区不受影响）。

import { gachaSekai, eventsSekai } from "./parsers/sekai.js";

const TZ_CN = "Asia/Shanghai";

export const SOURCES_B1 = [
	// ⚠️ 原 `uma-jp-umapyoi`（赛马娘 日服 umapyoi）**已被吸收**进 `registry-p5.js` 的 `uma-jp` 作为**卡池备选源**；
	//   原 `bandori-bestdori`（BanG Dream 国服 Bestdori）**已被吸收**进 `registry-b3.js` 的 `bandori` 作为**两侧备选源**。
	//   原因：插件既有设计是「一游戏一条目，多来源走 altSources 在设置页切换」，
	//   不该为同一游戏并行列出两条（用户在 review 时明确指出）。
	//   两个抓取器仍在本仓库（`parsers/umapyoi.js` / `parsers/bestdori.js`），由各自条目的 altSources 引用。
	{
		id: "pjsk",
		name: "初音未来：缤纷舞台",
		tz: TZ_CN,
		// GitHub Pages 静态 master DB：epoch 毫秒，可直接读。
		// ⚠️ 服区存疑（见文件头）：只声明"中文服"，不写成国服专属源。
		// ⚠️ events.json **无 endAt**：活动结束取 aggregateAt（活动游玩期结束）。
		gacha: {
			url: "https://sekai-world.github.io/sekai-master-db-cn-diff/gachas.json",
			fetcher: gachaSekai,
			kind: "third-party",
			mode: "direct"   // GitHub Pages 静态资源
		},
		event: {
			url: "https://sekai-world.github.io/sekai-master-db-cn-diff/events.json",
			fetcher: eventsSekai,
			kind: "third-party",
			mode: "direct"
		}
	}
];

// 便捷查询（与 registry.js 同名同义，便于 cases-b1.mjs 独立运行）
export function findSource(id) { return SOURCES_B1.find((s) => s.id === id) || null; }
export function listIds() { return SOURCES_B1.map((s) => s.id); }
