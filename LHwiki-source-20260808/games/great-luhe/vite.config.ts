import { defineConfig } from "vite";

export default defineConfig({
  // 相对路径，方便未来直接挂到 LHwiki 静态托管的任意子路径
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsInlineLimit: 0,
    // 每次只保留当前入口引用的内容哈希产物，避免旧 bundle 被误带进 LHwiki。
    emptyOutDir: true
  },
  server: {
    port: 5178,
    host: "127.0.0.1"
  }
});
