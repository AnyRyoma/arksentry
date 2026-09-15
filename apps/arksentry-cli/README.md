# ArkSentry CLI

ArkSentry 在本地批量验收 AI 修改过的 ArkTS 文件，不上传、保存或写回源码。

```bash
arksentry scan ./entry
arksentry scan --changed --format markdown
arksentry handoff --changed
```

`--changed` 只读取当前 Git 工作区中已修改、暂存、重命名和未跟踪的 `.ets` 文件。它不是编译器，也不替代 DevEco Studio 的 Code Linter。
