# LHwiki

LHwiki 是面向潞河校园的轻量共建手册：公开阅读、校内学号投稿、人工审核发布。内容聚焦教师、课程、社团、校园生活与备考经验，强调具体、真诚和可追溯的分享。

- 在线网站：[LHwiki · CloudBase 上海](https://lhwiki-d9g6r8vfzc7be1c0a-1465088461.ap-shanghai.app.tcloudbase.com/)
- 当前线上版本：**v0.8.8**
- 技术栈：原生 JavaScript、Node.js 20 HTTP 云函数、CloudBase 静态托管、PostgreSQL、RLS
- 源码目录：[`LHwiki-source-20260808/`](LHwiki-source-20260808/)
- 完整版本记录：[`CHANGELOG.md`](CHANGELOG.md)

## 最近更新

- 新增次级“校园小玩意”入口和纯前端“合成潞河”；游戏跟随深浅色，只在本机计算和保存偏好，不访问云函数或数据库。
- 编辑内容继续自动保存在本机；只有手动保存或提交审核才同步云端，不再存在后台自动上传与失败续传。
- 普通登入与个人中心合并重复数据库/函数调用，访问统计上传永久停用。
- 公开目录使用六小时缓存和白名单批量读取；审核批准后的内容可正常公开，数据库异常时回退部署快照。
- 新版草稿协议会在数据库访问前拦截旧编辑页，避免旧页面重新触发高频保存。

## 本地测试

```powershell
cd LHwiki-source-20260808
pnpm install
pnpm test
```

生产部署说明见 [`cloudbase/README.md`](LHwiki-source-20260808/cloudbase/README.md)。项目采用 MIT License。请勿将生产 API Key、学生学号、未公开投稿、审核记录或 `backup/` 数据上传到公开仓库。
