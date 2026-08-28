# dsh-gacha-calendar

二游（Gacha / Anime Game）活动·卡池排期速查插件 —— 为 DeepSeek Harness 桌面端侧边栏底部添加「📅 二游排期」按钮，点击即可展开已安装二游的当前版本、卡池与活动起止。

## 功能

- 侧边栏**底部**（设置按钮上方）常驻「二游排期」按钮，注册于 `sidebar.footer.action` 插槽
- 点击弹出悬浮面板，展示 9 款二游的 **版本 / 当前卡池 / 卡池起止 / 当前活动 / 活动起止**
- 每行带 **64px 官方方形图标**（萌娘百科 / 悠星官网 / Google Play 直链）
- **联网自动刷新**（v0.2.0）：从官方 Wiki（bwiki / PRTS 等 MediaWiki API）抓取排期数据，抓取失败自动回退内置数据
- **真实抓取驱动面板**（v0.3.0 / v0.3.8）：点击刷新后，原神/星铁/绝区零/明日方舟/**鸣潮** 的**卡池名与起止时间直接来自 wiki 实时解析**（确定性纯函数解析，同一网页内容每次刷新结果一致），日期统一为 `mm-dd hh:mm ~ mm-dd hh:mm`；鸣潮的活动列也实时抓取（bwiki 活动日历）；其余游戏无公开可抓源，保持内置数据
- **悬停提示**（v0.3.0）：所有超出格子的单元格悬停显示完整内容
- **设置页独立页面**（v0.2.4）：设置 → 左侧导航「二游排期」独立页面（参照 dsh-cost-meter 的 `settings.section` 用法），可开关自动刷新、调节刷新频率（1/5/7/15/24/30/42 天）、调整展示顺序，设置持久化
- **条目管理**（v0.3.2 / v0.3.3 / v0.3.5）：设置页「条目管理」卡片整合**展示顺序与条目管理**——带**表头**（游戏/展示/卡池来源/活动来源/操作），每行可勾选「展示」控制面板显隐、↑↓ 调整顺序、**卡池来源与活动来源分列**选择（显示源名如 Bwiki / PRTS Wiki / 内置数据，或自定义 MediaWiki 地址）、红色 🗑 SVG 图标删除条目（内置条目记入删除列表可一键恢复）；并支持**添加自定义条目**（填名称/版本/卡池/活动/图标/卡池来源/活动来源）
- 面板内可直接**手动刷新**，并显示当前数据来源（联网 / 内置）与上次刷新时间
- 内置数据兜底（参考日 2026-08-28），即使断网也能查看

覆盖游戏：

| 游戏 | 服务器 |
|---|---|
| 原神 | 国服 |
| 崩坏：星穹铁道 | 国服 |
| 绝区零 | 国服 |
| 鸣潮 | 国服 |
| 明日方舟 | 国服 |
| 明日方舟：终末地 | 国服（正式服） |
| 蔚蓝档案 | 国服 |
| 蔚蓝档案 | 国际服 |
| 重返未来：1999 | 国服 |

## 安装

### 方式一：直接放入 profile（本地开发）

将 `dsh-gacha-calendar` 目录复制到 profile 的 `node_modules`：

```
# Windows 桌面 profile 示例
C:\Users\<you>\.dsh\profiles\desktop\node_modules\dsh-gacha-calendar\
```

并在 profile 的 `package.json` 中注册：

```json
{
  "dependencies": {
    "dsh-gacha-calendar": "0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-gacha-calendar"
      ]
    }
  }
}
```

重启 DSH Desktop 后生效。

### 方式二：通过 dshmarket / `dsh plugin` 安装（发布后）

```bash
dsh plugin --profile desktop add dsh-gacha-calendar
```

## 开发

```bash
# 类型检查
npm run typecheck

# 构建（tsdown）
npm run build
```

## 插件结构

```
dsh-gacha-calendar/
├── package.json          # dsh.bundle.patch + dsh.client.inject（DSH 加载规范）
├── cordis.patch.yml      # bundle patch：insert gacha-calendar entry
├── lib/
│   ├── index.js          # host 端入口（纯 UI 插件，无宿主行为）
│   └── client.js         # web 端：__ModuleLoader__.load + sidebar.footer.action 槽注册
└── README.md
```

## 数据来源

排期数据取自各游戏**官方公告 / 官方 wiki**（PRTS、bwiki、Fandom、bluearchive.wiki、GameKee 千里眼、官网），核心条目经直读核验；无法精确到日的条目按版本周期推算并标注。数据为**静态内置**，后续版本将支持联网刷新。

## License

MIT
