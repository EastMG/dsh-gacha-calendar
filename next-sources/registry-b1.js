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
//     ✅ 服区**已确认 = 国服**（2026-10-03 复核，推翻了此前"存疑"的判断）：
//        仓库 description/README 都写 Simplified Chinese / CN server，且 events、cards、cardEpisodes、
//        characterProfiles **全为简体**（对照 tc-diff 同结构全繁体）。
//        此前"存疑"的两条理由都不成立：
//          ① 「首条事件 2021-10-09 早于国服公测 2025-03-27」→ 是**上游回填历史记录**（CN/TW 共用
//             Nuverse 6.4.0 结构），**不代表国服真实开放时间**（该时间线确实会失真，已在 name 处注明）；
//          ② 「部分条目名是繁体」→ 同为回填残留（59 条卡池里 18 条含繁体，2024-05 之后全简体）。

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
		// ── 区服已确认（2026-10-03）：**国服**（简体中文，Nuverse / 朝夕光年发行）──
		// 为什么加「·国服」后缀：此前只写「初音未来：缤纷舞台」，与其它多区服条目
		// （`蔚蓝档案·国服` / `赛马娘·日服`）不一致，区服不可辨。
		// `sekai-master-db-cn-diff` 的判定证据：
		//   · 仓库 description = "Project Sekai (**Simplified Chinese**) Master DB Difference"、
		//     README = "Sekai Master Data Diff for **CN** server"（GitHub 原文）
		//   · 同库 events/cards/cardEpisodes/characterProfiles **全为简体**
		//     （`雨过天晴的启明星` / `卡牌剧情（上篇）` / `宫益坂女子学园`）；
		//     对照 `tc-diff` 同结构全繁体（`雨後的第一顆星` / `支線劇情（前篇）` / `宮益坂女子學園`）
		//   · 官网 pjsk.nvsgames.cn 页脚：published by Nuverse；国服公测 2025-03-27
		// ⚠️ 但该源**混有繁体**：59 条卡池里 18 条含繁体用字（`新手應援起跑衝刺招募`）。
		//   这是**上游国服客户端回填 2020–2024 历史记录时沿用了繁中串**（CN/TW 共用 Nuverse
		//   6.4.0 结构），2024-05 之后的记录全部是简体。故"繁体名"不代表区服标错。
		//   不做机械繁转简：实测同一概念在两岸的官方译法本就不同（`[新手应援]必定获得1名★4成员10连招募券招募`
		//   vs 繁中服 `[新手應援]必中1名★4成員10連票券招募`），机械转换会产出**第三种、非官方**的字符串。
		name: "初音未来：缤纷舞台·国服",
		// 图标：国服官网 pjsk.nvsgames.cn 的 rel=shortcut icon（Nuverse/朝夕光年自家 CDN）
		icon: "https://p16-sg.dailygn.com/obj/g-marketing-assets-sg/2021_12_15_07_41_24/icon_s54607.png",
		tz: TZ_CN,
		// GitHub Pages 静态 master DB：epoch 毫秒，可直接读。
		// 区服已确认 = 国服（见上方 name 处的证据链）。
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
