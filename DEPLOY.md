# GitHub 仓库创建指南

## 自动创建（推荐）

如果已配置 GitHub CLI，运行以下命令：

```bash
cd /root/git/image-background-remover

# 创建 GitHub 仓库
gh repo create image-background-remover --public --source=. --remote=origin --push
```

## 手动创建

### 步骤 1: 在 GitHub 上创建仓库

1. 访问 https://github.com/new
2. 仓库名称：`image-background-remover`
3. 描述：`AI-powered image background removal tool with FastAPI backend and Vue 3 frontend`
4. 选择 **Public** 或 **Private**
5. **不要** 勾选 "Initialize this repository with a README"
6. 点击 "Create repository"

### 步骤 2: 关联远程仓库并推送

```bash
cd /root/git/image-background-remover

# 添加远程仓库（替换 YOUR_USERNAME 为你的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USERNAME/image-background-remover.git

# 推送到 GitHub
git push -u origin main
```

### 步骤 3: 验证推送

访问 https://github.com/YOUR_USERNAME/image-background-remover 确认代码已成功推送。

## 后续开发

### 后端开发

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

访问 http://localhost:8000/docs 查看 API 文档。

### 前端开发

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:3000 查看前端界面。

### 生产部署

#### Docker 部署（推荐）

创建 `Dockerfile` 和 `docker-compose.yml` 后运行：

```bash
docker-compose up -d
```

#### 直接部署

**后端:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

**前端:**
```bash
cd frontend
npm install
npm run build
# 将 dist/ 目录部署到 Nginx 或其他静态文件服务器
```

## 环境变量

生产环境建议配置以下环境变量：

- `ALLOWED_ORIGINS`: 允许的 CORS 源（逗号分隔）
- `MAX_FILE_SIZE`: 最大上传文件大小（字节）
- `API_RATE_LIMIT`: API 速率限制

## 许可证

MIT License - 详见 LICENSE 文件
