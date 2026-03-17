# 部署指南 - Cloudflare Pages 原生 GitHub 集成

## 前置准备

### 1. 获取 Remove.bg API Key

1. 访问 https://www.remove.bg/api
2. 注册/登录账号
3. 在 Dashboard 中获取 API Key
4. 免费额度：每月 50 张免费图片（标准分辨率）

### 2. Fork 项目到 GitHub

```bash
# 在 GitHub 上点击 Fork 按钮
# 或克隆你的 fork 仓库
git clone https://github.com/YOUR_USERNAME/image-background-remover.git
cd image-background-remover
```

## 部署步骤

### 方案 A：Cloudflare Pages + Functions（推荐）

#### 步骤 1：连接 GitHub 仓库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** > **Create Application** > **Pages**
3. 点击 **Connect to Git**
4. 选择你的 `image-background-remover` 仓库
5. 点击 **Begin Setup**

#### 步骤 2：配置构建设置

- **Framework preset**: `None`
- **Build command**: (留空)
- **Build output directory**: (留空)
- **Root Directory**: (留空)

#### 步骤 3：设置环境变量

1. 点击 **Environment Variables (advanced)**
2. 添加变量：
   - **Variable name**: `REMOVE_BG_API_KEY`
   - **Value**: 你的 Remove.bg API Key
   - **Branch**: `main` (或你的主分支)
3. 点击 **Save and Deploy**

#### 步骤 4：配置 Functions

创建 `functions/api/remove-bg.js` 文件（或使用 worker.js 内容）：

```javascript
// functions/api/remove-bg.js
export async function onRequestPost({ env, request }) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get('image_file');

    if (!imageFile) {
      return new Response('No image file provided', { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    const removeBgFormData = new FormData();
    removeBgFormData.append('image_file', imageFile);
    removeBgFormData.append('size', 'auto');

    const removeBgResponse = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': env.REMOVE_BG_API_KEY,
      },
      body: removeBgFormData,
    });

    if (!removeBgResponse.ok) {
      return new Response('Failed to process image', { 
        status: removeBgResponse.status, 
        headers: corsHeaders 
      });
    }

    const processedImage = await removeBgResponse.arrayBuffer();
    
    return new Response(processedImage, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/png',
      },
    });

  } catch (error) {
    return new Response('Internal server error', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
```

#### 步骤 5：完成部署

1. Cloudflare Pages 会自动构建并部署
2. 部署完成后，你会获得一个 `*.pages.dev` 域名
3. 访问网站测试功能

### 方案 B：Cloudflare Workers（独立部署）

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 部署 Worker
wrangler deploy

# 设置环境变量
wrangler secret put REMOVE_BG_API_KEY
# 按提示输入你的 API Key
```

## 自定义域名（可选）

1. 在 Cloudflare Pages Dashboard 进入你的项目
2. 点击 **Custom domains**
3. 输入你的域名
4. 按照提示配置 DNS

## 测试

1. 打开部署后的网站
2. 上传一张测试图片
3. 点击「去除背景」按钮
4. 下载处理后的图片

## 故障排查

### 问题：API 返回 403 错误

**原因**: API Key 无效或未配置

**解决**: 
- 检查 Cloudflare Pages 环境变量是否正确设置
- 确认 Remove.bg API Key 有效且有剩余额度

### 问题：图片处理超时

**原因**: 图片过大或网络问题

**解决**:
- 限制上传图片大小（当前为 10MB）
- 检查网络连接
- Remove.bg API 响应时间通常 3-5 秒

### 问题：CORS 错误

**原因**: 跨域请求被阻止

**解决**:
- 确保 Worker 代码包含 CORS headers
- 检查前端请求的 URL 是否正确

## 成本估算

- **Cloudflare Pages**: 免费（包含 100k 请求/天）
- **Remove.bg API**: 
  - 免费：50 张/月（标准分辨率）
  - 付费：$0.2/张（标准）或 $0.9/张（高清）

## 安全建议

1. **添加访问限制**: 使用 Cloudflare Access 限制访问
2. **设置使用限额**: 在前端添加用户级别的调用限制
3. **监控 API 使用**: 定期检查 Remove.bg Dashboard 的使用量
4. **添加验证码**: 防止自动化滥用（可选）

## 后续优化

- [ ] 添加用户登录系统
- [ ] 实现批量处理功能
- [ ] 添加图片编辑器（裁剪、滤镜等）
- [ ] 支持更多 AI 模型（人像分割、物体识别等）
- [ ] 添加使用统计和计费系统

---

**祝你部署成功！** 🎉
