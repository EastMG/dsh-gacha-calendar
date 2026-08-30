# dsh-gacha-calendar

DeepSeek Harness 桌面端侧边栏插件：一键查看主流二游的**当期卡池与活动起止**，支持联网自动刷新，支持手动添加或删除条目。
全程使用 DeepSeek Harness 进行 Vibe Coding 开发。

## 截图

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-1.png" width="32%" alt="排期面板">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-2.png" width="32%" alt="面板详情">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-3.png" width="32%" alt="设置页">
</p>

## 功能

- 侧边栏底部「📅 二游排期」按钮 → 悬浮面板，按行展示每款游戏的当期卡池、卡池起止、当期活动、活动起止
- **倒计时显示**剩余时间，悬停查看卡池/活动全名原始文本
- **联网抓取**：各游戏来源独立（官网公告 / Wiki / 第三方站），失败自动降级；来源可在设置页切换或自定义地址
- **设置页**：自动刷新开关与频率（1–42 天）、展示顺序、条目显隐/删除、新增自定义条目（名称+图标+来源链接，内容由链接解析产出）

内置覆盖 11 款游戏：

| 游戏 | 服务器 |
|---|---|
| 原神 | 国服 |
| 崩坏：星穹铁道 | 国服 |
| 绝区零 | 国服 |
| 鸣潮 | 国服 |
| 明日方舟 | 国服 |
| 明日方舟：终末地 | 国服 |
| 蔚蓝档案 | 国服 |
| 蔚蓝档案 | 国际服 |
| 蔚蓝档案 | 日服 |
| 重返未来：1999 | 国服 |
| 异环 | 国服 |

## 数据来源

排期数据实时抓取自各游戏**官方公告 / Wiki / 第三方站**（非内置静态数据）。

## 安装

```bash
dsh plugin --profile desktop add dsh-gacha-calendar
```

或将仓库复制到 profile 的 `node_modules` 后重启 DSH Desktop。

## 开发

```bash
npm run typecheck   # 类型检查
npm run build       # 构建（tsdown）
```

## 插件结构

```
dsh-gacha-calendar/
├── package.json     # dsh.bundle.patch + dsh.client.inject（DSH 加载规范）
├── cordis.patch.yml # bundle patch
├── lib/
│   ├── index.js     # host 端：配置 schema + 同源代理（CORS/Referer 反爬绕行，白名单域名）
│   └── client.js    # web 端：面板 + 设置页 + 各游戏解析器与来源注册表
└── README.md
```

## License

MIT
