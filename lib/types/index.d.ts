/**
 * Host-side entry types for dsh-gacha-calendar.
 *
 * 手写静态文件：`build.mjs --check` 只校验它存在、不生成内容 ⇒ 这里要手工跟着
 * `src/index.js` 末尾的 `export { Config, inject }` 走。
 */

/** 插件入口：由 cordis loader 调用，`config` = 持久化设置（schema 见下面的 `Config`）。 */
export declare function apply(ctx: unknown, config?: Record<string, unknown>): void;

/** 宿主半边要注入的服务名（运行时 = `src/index.js` 的 `const inject = ["webServer"]`，是字符串数组）。 */
export declare const inject: string[];

/**
 * Cordis 持久化设置 schema —— 运行时是 schemastery 的 `z.object({...})`（见 `src/index.js` 的 `Config`；
 * 必须具名导出，否则 `settings.describe()` 拿不到它，设置页恒为 unavailable）。
 *
 * 类型未细化成 schemastery 的 Schema：`@deepseek-ai/schemastery` 只是 peerDependency（本仓库不安装、
 * CI 也不装），且本机 DSH 装的那份 3.18.5 里 `lib/types/` 只有 `index.d.ts.map`、`index.d.ts` 缺失
 * ⇒ 拿不到可用的类型导出，故声明为 `unknown`，不写一个解析不到的 `import type`。
 */
export declare const Config: unknown;
