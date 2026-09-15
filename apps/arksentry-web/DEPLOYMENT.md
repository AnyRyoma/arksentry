# 发布 ArkSentry Web

静态产物为 `apps/arksentry-web/dist`。发布工作流使用 Cloudflare Pages，并只在 `main` 分支的 ArkSentry 代码变更后运行；也可在 GitHub Actions 中手动触发。

在 GitHub 仓库的 production Environment 中配置以下 secrets：

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 具备 Cloudflare Pages 编辑权限的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `CLOUDFLARE_PAGES_PROJECT` | 已创建的 Pages 项目名称，例如 `arksentry` |

首次操作：

1. 在 Cloudflare Pages 创建一个空项目，名称与 `CLOUDFLARE_PAGES_PROJECT` 一致。
2. 在 GitHub 的 Actions secrets 中添加上述三个值。
3. 推送到 `main`，或手动运行 **Publish ArkSentry Web**。
4. 打开 Cloudflare 返回的 `*.pages.dev` 地址，选择内置样例和一个本地目录，确认报告与复制按钮可用。

工作流在发布前会执行规则夹具和 Web 构建。任何测试或构建失败都会阻止部署。
