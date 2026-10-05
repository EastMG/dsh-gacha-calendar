# dsh-gacha-calendar

DeepSeek Harness 桌面端侧边栏插件：一键查看主流二游的**当期卡池与活动起止日历**，支持联网自动刷新，支持手动添加或删除条目。
全程使用 DeepSeek Harness 进行 Vibe Coding 开发。

## 截图

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-1.png" width="32%" alt="排期面板">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-2.png" width="32%" alt="面板详情">
  <img src="https://cdn.jsdelivr.net/gh/EastMG/dsh-gacha-calendar@main/assets/screenshot-3.png" width="32%" alt="设置页">
</p>

## 功能

- 侧边栏底部「📅 二游日历」按钮 → 悬浮面板，按行展示每款游戏的当期卡池、卡池起止、当期活动、活动起止
- **倒计时**显示剩余时间；悬停看卡池/活动的完整名称与源站原文
- **刷新提示**：按「成功 / 卡池失败 / 活动失败 / 新卡池未公布 / 新活动未公布」归类，悬停看逐条原因；"来源报错"计入失败、"源站还没收录当期"不算失败；某列沿用上次缓存时，悬停里另起一行说明。游戏名悬停可看**上次完全成功的时间**
- **自动刷新**：按设置间隔（1–42 天）进行自动刷新，间隔从**上次成功刷新**起算
- **来源可换**：各游戏来源独立（官方公告 / 官方 Wiki / 第三方站），失败自动回退备选源；设置页可切换来源或填自定义地址
- **设置页**：自动刷新开关与频率、展示顺序、条目显隐/删除、新增自定义条目（名称+图标+来源链接，内容由链接解析产出）
- **解析器自检**：逐个来源跑一遍，报告「哪个源解析不出当期内容 / 哪个源抓取报错」——源站改版后一键定位问题；只读，不改动设置与缓存

目前已覆盖 **28 款游戏**：

| 游戏 | 服务器 | 注释 |
|---|---|---|
| 原神 | 国服 |  |
| 崩坏：星穹铁道 | 国服 |  |
| 绝区零 | 国服 |  |
| 崩坏3 | 国服 | 暂不可用 |
| 鸣潮 | 国服 |  |
| 明日方舟 | 国服 |  |
| 明日方舟：终末地 | 国服 |  |
| 蔚蓝档案 | 国服 |  |
| 蔚蓝档案 | 国际服 |  |
| 蔚蓝档案 | 日服 |  |
| BanG Dream！少女乐团派对 | 国服 |  |
| BanG Dream！OurNotes | 日服 | 暂不可用 |
| BanG Dream！OurNotes | 国际服 | 暂不可用 |
| 物华弥新 | 国服 |  |
| 战双帕弥什 | 国服 |  |
| 卡厄斯梦境 | 国服 | 暂不可用 |
| 雪松 | 国服 |  |
| 嘟嘟脸恶作剧 | 国服 | 暂不可用 |
| 闪耀！优俊少女 | 国服 |  |
| 赛马娘 | 日服 |  |
| 赛马娘 | 国际服 |  |
| 女神异闻录：夜幕魅影 | 国服 |  |
| 异环 | 国服 |  |
| 少女前线2：追放 | 国服 |  |
| Fate/Grand Order | 国服 |  |
| 初音未来：缤纷舞台 | 国服 |  |
| 星塔旅人 | 国服 |  |
| 重返未来：1999 | 国服 |  |

## 数据来源

排期数据实时抓取自各游戏**官方公告 / 官方 Wiki / 第三方站**——bwiki、PRTS、wiki.gg、Game8、GameKee、Canmoe、GachaTracker、ldshop、小米游戏中心等。采用**克制的抓取策略**设计，普通用户正常使用时的抓取请求不会影响网站正常运行。

## 安装

```bash
dsh plugin --profile desktop add dsh-gacha-calendar
```

或将仓库复制到 profile 的 `node_modules` 后重启 DSH Desktop。

> 适用于 DSH Desktop：`@deepseek-ai/dsh*` 的 peer 范围为 `>=0.1.1-rc.2 <0.3.0`
> （覆盖 0.1.x 与 0.2.x 两条运行时线；`cordis ^4.0.1`、`schemastery >=3.18.0 <4`）；
> 插件本身零运行时依赖。

> 源码结构 / 构建与发布：[README_Dev.md](README_Dev.md)

## 致谢

- [MAA1999/M9A](https://github.com/MAA1999/M9A)——对《重返未来：1999》逐期「征集时间」的获取手段受到**M9A**的启发。
- [yoimiya-kokomi/miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin)——对 miHoYo/HoYoverse 公告接口的获取手段受到**miao-plugin**的启发。
- [jacket-sikaha/game-schedule](https://github.com/jacket-sikaha/game-schedule)——对 miHoYo/HoYoverse 公告接口的获取手段受到**game-schedule**的启发。
- [BTMuli/ShufflePlay](https://github.com/BTMuli/ShufflePlay)——对 miHoYo/HoYoverse 公告接口的获取手段受到**ShufflePlay**的启发。
- [UIGF-org/mihoyo-api-collect](https://github.com/UIGF-org/mihoyo-api-collect)——对 miHoYo/HoYoverse 的 `appId` 与公告接口的查证受到**mihoyo-api-collect**的启发。
- [Sekai-World/sekai-master-db-cn-diff](https://github.com/Sekai-World/sekai-master-db-cn-diff)——《初音未来：缤纷舞台》国服卡池与活动排期的**数据来源**。

## 免责声明

- 本项目为非营利性质的个人项目，与各游戏厂商、发行商及官方/社区 Wiki 均不存在隶属或合作关系。
- 卡池、活动等排期数据均取自各游戏**公开的官方公告与社区 Wiki、第三方站**，图标与截图的版权同样归原权利方所有；本项目仅作信息聚合展示，不提供亦不存储任何游戏资源。
- **图标资源使用外链**，来自游戏官网自有静态资源或应用商店列表图标。
- **如权利人认为本项目展示的内容侵犯其合法权益，请通过 [Issue](https://github.com/EastMG/dsh-gacha-calendar/issues) 告知，核实后将尽快删除相关内容。**

## License

MIT
