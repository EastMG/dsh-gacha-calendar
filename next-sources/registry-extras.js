// next-sources/registry-extras.js —— 备选源抓取器登记
//
// ── 为什么要单独一个文件 ──
// 插件契约（见 `src/client/40-fetchers.js`）：
//   · `GACHA_FETCHERS` 是**扁平**表 → 卡池备选源注册在顶层即可；
//   · `EVENT_FETCHERS` 是**按条目 id 分组**的表 → 活动备选源必须注册进 `EVENT_FETCHERS[条目id]`；
//   而 `altSourceId(alt) = alt.url`，命中还要 **URL 字符串完全相等**。
//
// 本模块把这些备选源**集中登记**（而不是散在各 registry-p*.js 里各注册一次），
// 这样 `altSources.fetcher` 引用的键名全局唯一、一眼可查，也避免多个批次抢同一个键。
//
// ── 被吸收进 altSources 的原独立条目（用户 review 指出"不该同游戏列两条"）──
//   · `uma-jp-umapyoi`（B1）  → uma-jp.altSources              （卡池备选）
//   · `uma-jp-bwiki`  （B2）  → uma-jp.eventAltSources         （活动备选）
//   · `bandori-bestdori`（B1）→ bandori.altSources/eventAlt…   （两侧备选）
//   · `kedrgame`      （B2）  → kedr.altSources                （卡池备选）
//   · `stellasora-bwiki`（B2）→ stellasora.eventAltSources     （活动备选）
import { gachaUmapyoi } from "./parsers/umapyoi.js";
import { gachaBestdori, eventsBestdori } from "./parsers/bestdori.js";
import { gachaKedr, eventsUmaJp, eventsStellasora } from "./parsers/bwiki.js";
// P9 自带一组备选抓取器（`uma-cn-bwiki` / `ournotes-global-*`），并入本文件统一登记
import { EXTRA_GACHA_FETCHERS_P9, EXTRA_EVENT_FETCHERS_P9 } from "./registry-p9.js";

/** 卡池侧备选抓取器（键 = 各条目 `altSources[].fetcher` 里写的名字，注册在扁平表顶层） */
export const EXTRA_GACHA_FETCHERS = {
	"uma-jp-umapyoi": gachaUmapyoi,
	"bandori-bestdori-gacha": gachaBestdori,
	"kedr-kaxi": gachaKedr,
	...EXTRA_GACHA_FETCHERS_P9
};

/** 活动侧备选抓取器：**按条目 id 分组**（键 = 条目 id，内层键 = `eventAltSources[].fetcher`） */
export const EXTRA_EVENT_FETCHERS = {
	"uma-jp": {
		"uma-jp-bwiki": eventsUmaJp
	},
	bandori: {
		"bandori-bestdori-event": eventsBestdori
	},
	stellasora: {
		"stellasora-bwiki": eventsStellasora
	},
	...EXTRA_EVENT_FETCHERS_P9
};
