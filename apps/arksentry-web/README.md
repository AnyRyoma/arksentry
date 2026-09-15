# ArkSentry

ArkSentry 是为 AI 编码场景设计的本地 ArkTS 验收工具：浏览器端可扫描用户主动选择的项目目录，CLI 可只检查当前 Git 改动，并把命中项整理成可交给 Codex、Claude 或 Cursor 的最小修复任务包。

## 隐私与边界

- Web 端只在当前浏览器读取文件，不上传、不保存、不调用模型服务。
- CLI 只读取本地文件和本地 Git 状态，不自动修改、提交或发送源码。
- 它是规则验收工具，不等同于 DevEco Studio 编译、运行验证或官方认证。
- 首发版不做 API 版本存在性判断，不把规则命中包装成官方结论。

## 使用方式

```bash
npm install
npm run dev --workspace @arksentry/web
npm run build

# 安装或链接 CLI 后
arksentry scan ./entry
arksentry scan --changed --format markdown
arksentry handoff --changed
```

`--changed` 收集当前 Git 工作区中已修改、暂存、重命名和未跟踪的 `.ets` 文件。目录扫描和 Web 扫描默认跳过 `node_modules`、`oh_modules`、`build`、`.preview`、`src/test`、`src/ohosTest` 与 `.gitignore` 排除内容。

## 首发规则集

| 编号 | 验收项 |
| --- | --- |
| ARK-001 | `any` |
| ARK-002 | `unknown` |
| ARK-003 | `ESObject` |
| ARK-004 | `Record`、`Partial`、`Pick`、`Omit`、`ReturnType` |
| ARK-005 | 类型位置 `typeof` |
| ARK-006 | 非空断言与 `as const` |
| ARK-007 | 动态属性访问 |
| ARK-008 | `for...in`、`delete`、`in` |
| ARK-009 | `Object.entries`、`Object.is` |
| ARK-010 | 动态 `import()` |
| ARK-011 | 单一 ArkUI 组件中的 V1/V2 状态管理混用 |
| ARK-012 | `@ohos.*` Kit 导入 |

## 许可证

ArkSentry Web 采用 [MIT](./LICENSE) 许可证。
