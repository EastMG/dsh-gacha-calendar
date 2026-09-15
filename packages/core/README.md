# gacha-calendar-core

二游活动/卡池排期的**抓取核心**：11 款游戏的来源注册表 + 解析器 + 刷新编排 + 缓存降级。

- **零依赖**：`package.json` 里没有任何 `dependencies`。
- **零宿主依赖**：不用 `window` / `document` / Node API；联网、时钟、计时常量都由调用方注入。
  因此同一个文件可以跑在浏览器扩展的 background、Tauri/Electron、iOS JavaScriptCore、鸿蒙 ArkTS 等环境里。
- 它是从 [`dsh-gacha-calendar`](https://github.com/EastMG/dsh-gacha-calendar)（DSH 桌面端插件）里抽出来的**同一份源码**：
  插件与各平台共用这一份核心，源站改版只需修一处。

> 包名刻意**不含 `dsh`**：这是给所有平台用的核心，不是某个宿主的附属品。

## 安装

```bash
npm i gacha-calendar-core
# 中国大陆网络若拉取慢/抖动，可临时换镜像：
# npm i gacha-calendar-core --registry=https://registry.npmmirror.com
```

## 用法

```js
import { createEngine } from "gacha-calendar-core";

const engine = createEngine({
  // 怎么联网（各平台自己实现这两个方法）
  transport: {
    // 直连：CORS 放行的源（bwiki / PRTS / api-web.bluearchive.jp …）；返回 WHATWG Response 形态即可
    async fetchRaw(url, opts) { return fetch(url, opts); },
    // 经代理：需要绕过 CORS / Referer 反爬的源（返回目标站原始 body 字符串）
    // 浏览器扩展里通常是 chrome.runtime.sendMessage 转给 background 代发
    async fetchViaProxy(url, { referer, headers, body }) { /* … */ }
  },
  // 怎么存配置与缓存（键名见下）
  storage: {
    async get(key) { /* chrome.storage.local.get(key) 的封装 */ },
    async set(key, value) { /* chrome.storage.local.set(…) 的封装 */ }
  },
  now: () => Date.now() // 可注入 → 单测能固定时间
});

await engine.listGames();   // 条目元信息（名字/图标/来源标签/可选来源/默认值/是否隐藏）
await engine.getCached();   // 上次结果（可立即渲染，不等网络）
await engine.refresh();     // 抓一轮 → 返回 Result JSON（下面这个形状）
await engine.selfCheck();   // 解析器自检：哪个源解析出 0 条、哪个源 403/超时（只读）
```

### Result JSON（`schemaVersion: 1`）

```jsonc
{
  "schemaVersion": 1,
  "refreshedAt": 1757900000000,
  "parserVersions": { "genshin": 1, "nte": 1 },   // 各条目解析逻辑版本，源站改版后 +1
  "games": {
    "genshin": {
      "name": "原神",
      "banner": "…", "bannerDates": "…", "roles": "…",
      "bannerDatesRaw": "…", "bannerHover": "…",   // Hover 系列 = 多行明细（触摸端可点开查看）
      "event": "…", "eventDates": "…", "eventDatesRaw": "…", "eventHover": "…",
      "gachaFail": null,                            // null=正常；{kind:"down"|"nomatch", reason}
      "eventFail": null,
      "gachaStale": false, "eventStale": false,     // true=该列显示的是上次沿用的旧值
      "okAt": 1757890000000                         // 最近一次「两侧都拿到新数据」的时间
    }
  }
}
```

`gachaFail` / `eventFail` 的三态语义是本项目的核心约定：

| 状态 | 含义 | 显示口径 |
|---|---|---|
| `null` | 抓到了当期内容 | 正常显示 |
| `{kind:"nomatch"}` | 请求成功，但源站**没有当期内容** | 「新卡池/新活动未公布」 |
| `{kind:"down", reason}` | 抓取或解析**报错**（reason 是归一后的短原因：网络不通 / 超时 / HTTP 403 / 响应格式异常…） | 「卡池/活动失败：<原因>」 |

### storage 用到的键

配置（各平台照抄键名，或在没有时使用内置默认值）：`order`、`hidden`、`removed`、
`customEntries`、`customUrls`、`customEventUrls`；缓存：`lastData`、`lastRefresh`、`lastSource`。

## 与其他平台的关系

| 消费者 | 依赖 |
|---|---|
| DSH 桌面端插件 | [`dsh-gacha-calendar`](https://github.com/EastMG/dsh-gacha-calendar)（插件包里已内联同一份 core） |
| 浏览器扩展 / Windows / Android / iOS / 鸿蒙 | 本包 |

> **注意**：`core.mjs` 与 `package.json` 由仓库的 `build.mjs` 生成（版本号跟随根包），**请勿手改**；
> 发现问题请到主仓库提 issue。
