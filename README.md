# Image Background Remover

基于 Cloudflare Pages + Workers 和 Remove.bg API 的图片去背景服务。

## 技术栈

- 前端：HTML5 + TailwindCSS + Vanilla JS
- 后端：Cloudflare Workers
- API：Remove.bg
- 部署：Cloudflare Pages（原生 GitHub 集成）

## 特性

- ✅ 纯内存处理，不存储用户图片
- ✅ 拖拽上传 / 点击选择
- ✅ 实时预览原图和去背结果
- ✅ 下载透明 PNG 或更换背景色
- ✅ 响应式设计，支持移动端

## 快速开始

1. Fork 本项目到你的 GitHub
2. 在 Cloudflare Dashboard 创建 Pages 项目，连接 GitHub 仓库
3. 设置环境变量 `REMOVE_BG_API_KEY`
4. 自动部署完成

## 环境变量

| 变量名 | 说明 |
|--------|------|
| `REMOVE_BG_API_KEY` | Remove.bg API Key（https://www.remove.bg/api） |

## 合规声明

- 图片仅在内存中处理，请求结束后自动销毁
- 请勿上传敏感、侵权或违规图片
- 本服务仅供学习和个人使用

## License

MIT
