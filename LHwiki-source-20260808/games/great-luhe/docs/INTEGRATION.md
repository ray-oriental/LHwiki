# 《合成潞河 GreatLuhe》LHwiki 集成指南

> 目标读者：负责把本游戏并入 LHwiki 的 agent / 开发者。
> 读完本文件即可完成集成，无需阅读游戏源码。
> 游戏本体零后端、零外部资源依赖（校徽/音效全部内置），与 LHwiki 同域部署即可。

---

## 0. 交付物

| 内容 | 位置 | 说明 |
|---|---|---|
| 静态产物 | `dist/` | `npm run build` 生成：`index.html` + `assets/index-*.js`（gzip ≈ 39KB）+ `assets/index-*.css` + `assets/schools/l01–l10.png`（10 张真实校徽） |
| 部署基准路径 | 相对路径 | 构建 `base: "./"`，dist 可放到任意子路径，无需改配置 |
| 运行依赖 | 无 | 无网络请求（除自身静态文件）、无 Cookie、无第三方服务 |

## 1. 两种集成方式

### 方式 A：iframe 嵌入（**强烈推荐**）

隔离最彻底：CSS/JS/生命周期零冲突，永远不怕影响 LHwiki 主站。

1. 把 `dist/` 整个上传到 LHwiki 静态托管，例如路径 `games/great-luhe/`（与主站同域，天然无跨域问题）。
2. 在彩蛋页面/入口插入：

```html
<iframe
  src="/games/great-luhe/index.html?theme=system"
  style="width:100%;max-width:520px;aspect-ratio:480/740;border:0;border-radius:14px;display:block;margin:0 auto"
  title="合成潞河"
  loading="lazy"
></iframe>
```

- 宽度 ≤ 520px 时游戏内部自动缩放；`aspect-ratio` 可按需微调（HUD+场地 ≈ 480×740）。
- iframe 内游戏自己处理触摸滚动，不会带动主站页面滚动。
- `theme` 可取 `light`、`dark` 或 `system`。宿主切换主题时，可向 iframe 发送
  `{ type: "lhwiki-theme-change", theme: "light" | "dark" | "system" }`；游戏只接受同源消息。
- 收工。不需要做第 2、3 节任何事。

### 方式 B：直接嵌入 LHwiki 页面（DOM 级集成）

适合想让彩蛋"长在"页面里的场景。

1. 上传 dist 静态文件到例如 `/games/great-luhe/`。
2. 在页面中放入容器与资源引用：

```html
<link rel="stylesheet" href="/games/great-luhe/assets/index-XXXX.css" />
<div id="great-luhe" data-asset-base="/games/great-luhe/"></div>
<script type="module" src="/games/great-luhe/assets/index-XXXX.js"></script>
```

- **`data-asset-base` 必填**：校徽路径前缀。游戏内所有校徽引用为相对路径
  `assets/schools/lXX.png`，嵌入到 LHwiki 页面后必须加此前缀才能正确加载
  （结尾要有 `/`）。
- 页面加载后 bundle 会自动寻找 `#great-luhe` 并挂载（幂等：无容器则静默跳过）。
- 同一页面只能有一个 `#great-luhe` 实例。

## 2. 生命周期 API（方式 B 的 SPA/动态场景）

bundle 挂载后会在 window 暴露两个引用（这是仅有的两个全局写入点）：

```js
window.GreatLuheGame          // 构造函数
window.__greatLuheInstance    // 当前实例
```

```js
// 手动挂载（例如 LHwiki 路由切换后重新挂载）
const game = new GreatLuheGame(document.querySelector("#great-luhe"), {
  assetBase: "/games/great-luhe/"
});
game.mount();

// 卸载（路由离开/关闭彩蛋时务必调用）
game.destroy();
```

`destroy()` 会：取消 RAF 主循环、销毁 Matter 引擎、移除全部事件监听、
移除所有 DOM（含挂在 body 上的特效层/压暗层）、清理粒子池。
**可以安全地 mount → destroy → 再 mount。**

## 3. 集成注意点（逐条核对）

| # | 事项 | 说明 |
|---|---|---|
| 1 | CSS 隔离 | 全部样式带 `gluhe-` 前缀且限定 `.gluhe-root`；不改 body/全局样式 |
| 2 | 全屏特效层 | 潞河彩蛋会临时创建 `position:fixed` 层（`.gluhe-dim` z-index 9998、`.gluhe-fx-layer` 9999、`.gluhe-heavy-text` 10000），事件结束即移除。若 LHwiki 有更高 z-index 的全局元素（如顶部导航 >10000），彩蛋高潮会被部分遮挡，不影响功能 |
| 3 | localStorage | 仅两个 key：`gluhe_best`（最高分）、`gluhe_muted`（静音）。无冲突风险，请勿清除 |
| 4 | 音频 | WebAudio 实时合成，无音频文件；AudioContext 在首次点击/触摸后才创建（符合浏览器 autoplay 策略） |
| 5 | 移动端 | 游戏画布 `touch-action:none`，手指拖动不会滚动宿主页面；竖屏设计，无需横屏 |
| 6 | CSP | 无 eval、无内联脚本、无外部请求；`script-src 'self'`、`img-src 'self' data:` 即可通过 |
| 7 | 性能 | 固定 120Hz 物理步长 + 对象池粒子（上限 420）；长时间游玩无泄漏 |
| 8 | 调试钩子 | 生产构建**不含** `window.__gluhe`（仅 dev server 存在）；生产包无作弊入口 |

## 4. 集成验收清单（集成方执行）

- [ ] 页面加载后游戏出现，控制台无 error
- [ ] 桌面鼠标拖动投放正常；手机触摸投放正常且页面不跟随滚动
- [ ] 10 个等级校徽均显示（无裂图）
- [ ] 同级球碰撞合成、分数增加
- [ ] 合成潞河中学后：潞河 × N 计数 +1，出现"好……沉……"，潞河压碎球堆、
      击穿地板、砸到浏览器视口底部并炸裂，随后游戏继续（可重复触发）
- [ ] 顶部死亡线稳定堆压约 1.6 秒后 Game Over，可"再来一次"
- [ ] 刷新页面后最高分保留
- [ ] 方式 B：离开页面调用 `destroy()` 后无 DOM/特效层残留

## 5. 维护入口（以后改内容改哪里）

| 需求 | 位置 |
|---|---|
| 换学校/调等级/半径/分数/校徽路径与来源 | `src/data/schools.ts`（唯一数据源） |
| 替换校徽图片 | `public/assets/schools/lXX.png`（512×512 PNG，真实校徽，禁止虚构） |
| 物理手感 | `src/game/Physics.ts`（gravity/步长）+ `createBallBody`（按等级插值参数） |
| 潞河彩蛋节奏/文案 | `src/game/LuheEvent.ts`（FSM 各状态时长、TEXT_STAGES、奖励常量） |
| 改完验证 | `npm run build`（含 tsc 检查）+ `npm run qa`（22 项浏览器自动化测试） |

## 6. 红线（来自产品需求，改动时不得违反）

潞河中学必须是最高等级；校徽必须真实且本地化；不引入任何后端/数据库/登录；
生产构建不得保留作弊/调试入口；物理手感优先级高于视觉花哨。
