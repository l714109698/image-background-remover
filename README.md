# Image Background Remover

一个基于 Python FastAPI 和 rembg 的图像背景移除工具，提供 Vue 3 前端界面。

## 功能特性

- 🖼️ 自动移除图像背景
- ⚡ 基于 AI 的高精度抠图
- 🌐 RESTful API 接口
- 🎨 简洁的 Vue 3 前端界面
- 📦 支持批量处理

## 技术栈

### 后端
- **Python 3.9+**
- **FastAPI** - 高性能 Web 框架
- **rembg** - AI 背景移除库
- **Pillow** - 图像处理
- **uvicorn** - ASGI 服务器

### 前端
- **Vue 3** - 渐进式 JavaScript 框架
- **Vite** - 下一代前端构建工具
- **Axios** - HTTP 客户端
- **Tailwind CSS** - 实用优先的 CSS 框架

## 快速开始

### 后端安装

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 前端安装

```bash
cd frontend
npm install
npm run dev
```

## API 接口

### POST /api/remove-background
移除图像背景

**请求参数:**
- `file`: 上传的图像文件 (PNG, JPG, JPEG, WEBP)

**响应:**
- 返回处理后的 PNG 图像（透明背景）

**示例:**
```bash
curl -X POST "http://localhost:8000/api/remove-background" \
  -F "file=@image.jpg" \
  -o output.png
```

## 项目结构

```
image-background-remover/
├── backend/
│   ├── main.py          # FastAPI 应用入口
│   ├── requirements.txt # Python 依赖
│   └── ...
├── frontend/
│   ├── src/
│   ├── package.json
│   └── ...
├── README.md
├── .gitignore
└── LICENSE
```

## 许可证

MIT License

## 作者

Lovery Full-Stack Engineer
