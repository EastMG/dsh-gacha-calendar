# archive/ —— 历史原型与参考实现

**这里的代码不参与构建、也不参与运行**：`build.mjs` 不读它（不在 `ORDER` / `CORE_ORDER` / `CSS_ORDER` 里），
插件运行时也不 import 它。留档只为回看"当初怎么试的、踩过哪些坑"，**不要在这里改行为**。

## remind/ —— 到期提醒原型（2026-10-27）

- 形态：独立 CLI + Windows 计划任务 + 自带的 PowerShell toast，一条**完全绕过插件**的送达路径。
- 真正在哪（唯一真源，要改行为改这三处）：
  - 定时与送达 = `src/index.js` 的提醒定时器（`registerRemindTimer`，30 分钟一轮 + 启动后先来一轮）
    + 内联 PowerShell toast（`-EncodedCommand`，脚本由 `toastScriptOf` 生成，**不落地 .ps1、不引用 `tools/`**）；
  - 判定与文案 = `src/client/65-remind.js`（同一份源码另拼成 `lib/remind-core.mjs` 给宿主复用）；
  - 设置页 = `src/client/84-settings-page.js`。
- 保留原因：**AUMID 写入方法的经验教训** —— 给开始菜单快捷方式写 AUMID 的那条内联 C#
  （`IPropertyStore` / `PROPVARIANT`）先在这里跑通，之后才搬进 `src/index.js`；原型留作那段 P/Invoke 的出处与对照。
- ⚠️ 存档原样冻结：里面的文档与注释仍写着 `tools/remind/…` 的旧路径，没有跟着改；
  真要跑请自行换成 `archive/remind/…`。
