# 将 LHwiki 发布到 GitHub

推荐仓库名称：`LHwiki`。仓库可设为 Public；项目使用 MIT License。

## 方法一：网页上传发布包

1. 登录 GitHub，选择 **New repository**。
2. Repository name 填 `LHwiki`，Visibility 选 **Public**。
3. 不要勾选自动创建 README、`.gitignore` 或 License，本项目已经包含这些文件。
4. 创建仓库后点击 **uploading an existing file**。
5. 解压 `LHwiki-source-20260808.zip`，把解压目录中的文件整体拖入网页并提交。

网页方式适合第一次上传；后续维护建议使用 Git。

## 方法二：Git 命令

在解压后的源码目录打开 PowerShell：

```powershell
git init
git branch -M main
git add .
git commit -m "Initial open-source release"
git remote add origin https://github.com/<你的GitHub用户名>/LHwiki.git
git push -u origin main
```

如果 GitHub 要求认证，请使用浏览器登录、Git Credential Manager 或 Personal Access Token，不要把 Token 写入远程地址、脚本或项目文件。

## 发布前检查

```powershell
npm test
git status --short
git ls-files | Select-String -Pattern 'backup|deployment\.log|migration-data\.private|\.dev\.vars|\.clixml'
```

最后一条命令应没有输出。还应在 GitHub 仓库页面搜索 `SESSION_SECRET`、`CLOUDBASE_APIKEY`、`REVIEWER_ACCESS_CODE`，确认只有变量名或示例占位符，没有真实值。

## 不能上传的内容

- `backup/` 中的 JSON、SHA-256 和维护日志；
- `.dev.vars`、`.env`、CloudBase API Key、腾讯云密钥、GitHub Token；
- `cloudbase/cloudbaserc.json`、`migration-data.private.json`、D1 私有导出和部署日志；
- `node_modules`、Wrangler 缓存、DPAPI `.clixml` 凭据；
- 含真实学号、未公开投稿或审核记录的文件。
