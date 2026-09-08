# 合成潞河小游戏集成任务

- [x] 核对游戏交接、构建入口、资源清单与无后端边界。
- [x] 增加 LHwiki 次级侧栏入口与 `#/game` 页面。
- [x] 使用同源懒加载 iframe 与 sandbox 隔离，补充主题通信和监听清理。
- [x] 增加游戏端 light/dark/system 主题解析、postMessage 接收和深色 Canvas/UI 样式。
- [x] 复制当前构建引用的 JS/CSS 与十张校徽，排除旧 bundle。
- [x] 增加静态安全、资源清单、主题和入口回归测试。
- [x] `kimi_game npm run build`、`kimi_game npm run qa`、`LHwiki npm test` 通过。
- [ ] 由主线程完成备份、部署与线上 iframe/主题/资源 smoke 验证。
