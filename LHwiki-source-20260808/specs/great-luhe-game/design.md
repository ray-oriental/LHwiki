# 合成潞河小游戏集成设计

## 宿主页面

`public/app.js` 增加 `game` 路由与 `greatLuhePage()`。侧栏在参与功能后增加“校园小玩意”分组，入口指向 `#/game`。页面使用统一的 page heading/card 样式承载 iframe，并注明本机运行与无后端属性。

iframe 指向 `/games/great-luhe/index.html?theme=system`，启用 `loading="lazy"`、稳定的 `title`、`sandbox="allow-scripts allow-same-origin"`、`allow="autoplay"` 和同源 `referrerpolicy`。宿主在 iframe load 与 `lhwiki-theme-change` 时发送 `{ type: 'lhwiki-theme-change', theme }`，离开路由时移除监听。

## 游戏端

`src/main.ts` 读取 `theme` 查询参数并监听同源父窗口消息；`GreatLuheGame.setTheme()` 同步 UI 根节点和 Canvas `Renderer` 调色板。`system` 通过 `matchMedia` 解析。生产构建仍只暴露原有生命周期引用，不接入任何网络业务。

构建后只复制 `dist/index.html` 当前引用的哈希 JS/CSS 与 `assets/schools/l01–l10.png` 到 `public/games/great-luhe`，避免 `vite.config.ts` 的保留旧产物进入网站。
