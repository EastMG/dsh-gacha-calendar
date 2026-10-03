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
		name: "女神异闻录：夜幕魅影",
		// 图标：官方商店列表（App Store 中国区，id 6466264792，卖家完美世界，bundle com.pwrd.persona5x.pw）
		icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/03/1e/f4/031ef49f-b3d0-5bdd-077b-67d213f99c86/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/200x200bb.jpg",
		// 出厂**默认不勾选展示**（用户 2026-10-03 要求）。原因：
		//   官方站的卡池/活动专栏已停更两年，唯一在更新的「游戏新闻」是**版本更新公告**；
		//   卡池只能从公告正文的「契约更新」块里抠，**多数版本只给自选复刻契约**（如"缘结之契"），
		//   本期限定池（如汐见琴音）常常连档期都没写 → 信息量明显低于其它条目。
		//   仍可在设置页勾选启用（三态判定见 60-helpers.js 的 isEntryHidden）。
		defaultHidden: true,
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
