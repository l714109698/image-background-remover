"""
Image Background Remover - FastAPI Backend
提供图像背景移除的 RESTful API 服务
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from rembg import remove
from PIL import Image
import io

app = FastAPI(
    title="Image Background Remover API",
    description="基于 AI 的图像背景移除服务",
    version="1.0.0"
)

# 配置 CORS，允许前端访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """API 根路径"""
    return {
        "message": "Image Background Remover API",
        "version": "1.0.0",
        "endpoints": {
            "remove_background": "POST /api/remove-background"
        }
    }


@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy"}


@app.post("/api/remove-background")
async def remove_background(file: UploadFile = File(...)):
    """
    移除图像背景
    
    Args:
        file: 上传的图像文件 (支持 PNG, JPG, JPEG, WEBP)
    
    Returns:
        处理后的 PNG 图像（透明背景）
    """
    # 验证文件类型
    allowed_types = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型：{file.content_type}。支持的类型：{', '.join(allowed_types)}"
        )
    
    try:
        # 读取上传的文件
        contents = await file.read()
        
        # 使用 rembg 移除背景
        output = remove(contents)
        
        # 验证输出是否为有效图像
        img = Image.open(io.BytesIO(output))
        img.verify()  # 验证图像完整性
        
        # 返回处理后的图像
        return Response(
            content=output,
            media_type="image/png",
            headers={
                "Content-Disposition": f'attachment; filename="{file.filename.rsplit(".", 1)[0]}_no_bg.png"'
            }
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"处理图像时出错：{str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
