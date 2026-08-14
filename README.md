# LHwiki

LHwiki 是面向潞河校园的轻量共建手册：公开阅读、校内学号投稿、人工审核发布。内容聚焦教师、课程、社团、校园生活与备考经验，强调具体、真诚和可追溯的分享。

- 在线网站：[LHwiki · CloudBase 上海](https://lhwiki-d9g6r8vfzc7be1c0a-1465088461.ap-shanghai.app.tcloudbase.com/)
- 当前版本：**v0.8.0**
- 技术栈：原生 JavaScript、Node.js 20 HTTP 云函数、CloudBase 静态托管、PostgreSQL、RLS
- 源码目录：[`LHwiki-source-20260808/`](LHwiki-source-20260808/)
- 完整版本记录：[`CHANGELOG.md`](CHANGELOG.md)

## 最近更新

- 编辑器新增 H4、纯文本表格、二/三栏、折叠标题、块级公式与分隔线。
- 新增统一的可搜索命令面板，支持顶部、块旁、斜杠入口与中英文别名。
- 表格支持键盘导航和行列增删；分栏在窄屏自动堆叠。
- 公式采用无外部请求的 MathML 渲染，并保留 LaTeX 源文本。
- 加强递归内容限制、安全渲染、草稿兼容保护和重复块 ID 防护。
- 新增站内更新日志，以倒序方式记录主要版本变化。

## 本地测试

```powershell
cd LHwiki-source-20260808
pnpm install
pnpm test
```

生产部署说明见 [`cloudbase/README.md`](LHwiki-source-20260808/cloudbase/README.md)。项目采用 MIT License。请勿将生产 API Key、学生学号、未公开投稿、审核记录或 `backup/` 数据上传到公开仓库。
