// next-sources/registry-p5x.js —— Lead 参考实现的注册表条目（P5X 国服）
//
// 与各批次 `registry-b*.js` 同契约，单独一个文件是为了让 `registry.js` 的聚合保持整齐。
import { gachaP5x, eventsP5x } from "./parsers/p5x.js";

const TZ_CN = "Asia/Shanghai";

// ⚠️ 官方 /news/gamebroad/（卡池）与 /news/gameevent/（活动）**均已停更 2 年**
//    （实测最后一条分别 2024-10-10 / 2024-09-27）；只有 /news/gamenews/（版本更新公告）
//    仍在更新（实测最新 2026-09-24「5.4.1版本今日上线」）。故两侧统一读 gamenews。
// 时区：国服 UTC+8。**源站未见显式标注**（原文只有「2026年9月24日—10月22日」），属推测。
// 时刻：公告只给日期 → 按国服惯例补 04:00 开 / 03:59 收（**推算**，非源站给定值）。
export const NEXT_SOURCES = [
	{
		id: "p5x",
		name: "P5X 国服（女神异闻录：夜幕魅影）",
		tz: TZ_CN,
		gacha: {
			url: "https://p5x.wanmei.com/news/gamenews/index.html",
			fetcher: gachaP5x,
			kind: "official-html",
			mode: "proxy"
		},
		event: {
			url: "https://p5x.wanmei.com/news/gamenews/index.html",
			fetcher: eventsP5x,
			kind: "official-html",
			mode: "proxy"
		}
	}
];

export function findSource(id) { return NEXT_SOURCES.find((s) => s.id === id) || null; }
