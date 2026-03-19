/**
 * Cloudflare Worker - Image Background Remover
 * 同时处理静态文件服务和 API 请求
 * 
 * 环境变量:
 * - REMOVE_BG_API_KEY: Remove.bg API Key
 */

// HTML 文件内容（压缩版）
const indexHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Background Remover - 智能图片去背景</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        .checkerboard{background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0px}
        .upload-area:hover{border-color:#3b82f6;background-color:#eff6ff}
        .upload-area.dragover{border-color:#2563eb;background-color:#dbeafe}
        .loading-spinner{border:3px solid #e5e7eb;border-top:3px solid #3b82f6;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite}
        @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
    </style>
</head>
<body class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
    <header class="bg-white shadow-sm">
        <div class="max-w-6xl mx-auto px-4 py-6">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-3">
                    <div class="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                        <i class="fas fa-magic text-white text-xl"></i>
                    </div>
                    <div>
                        <h1 class="text-2xl font-bold text-gray-900">Image Background Remover</h1>
                        <p class="text-sm text-gray-500">智能图片去背景工具</p>
                    </div>
                </div>
            </div>
        </div>
    </header>
    <main class="max-w-6xl mx-auto px-4 py-8">
        <div id="uploadSection" class="bg-white rounded-2xl shadow-xl p-8 mb-8">
            <div class="text-center mb-6">
                <h2 class="text-2xl font-bold text-gray-900 mb-2">上传图片</h2>
                <p class="text-gray-500">支持 JPG、PNG、WebP 格式，最大 10MB</p>
            </div>
            <div id="uploadArea" class="upload-area border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer transition-all">
                <input type="file" id="fileInput" accept="image/*" class="hidden">
                <div class="space-y-4">
                    <div class="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                        <i class="fas fa-cloud-upload-alt text-blue-600 text-3xl"></i>
                    </div>
                    <div>
                        <p class="text-lg font-medium text-gray-900">拖拽图片到此处，或点击上传</p>
                        <p class="text-sm text-gray-500 mt-1">图片仅在内存中处理，不会存储</p>
                    </div>
                    <button class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors">选择图片</button>
                </div>
            </div>
            <div id="previewSection" class="hidden mt-8">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-semibold text-gray-900">原图预览</h3>
                    <button id="removeBgBtn" class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium transition-all shadow-lg hover:shadow-xl flex items-center space-x-2">
                        <i class="fas fa-magic"></i><span>去除背景</span>
                    </button>
                </div>
                <div class="relative rounded-xl overflow-hidden shadow-lg checkerboard">
                    <img id="previewImage" class="w-full max-h-96 object-contain" alt="Preview">
                </div>
            </div>
        </div>
        <div id="loadingSection" class="hidden bg-white rounded-2xl shadow-xl p-12 text-center">
            <div class="loading-spinner mx-auto mb-4"></div>
            <h3 class="text-xl font-semibold text-gray-900 mb-2">正在处理中...</h3>
            <p class="text-gray-500">请稍候，通常需要 3-5 秒</p>
        </div>
        <div id="resultSection" class="hidden bg-white rounded-2xl shadow-xl p-8">
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-2xl font-bold text-gray-900">处理结果</h2>
                <button id="startOverBtn" class="text-gray-600 hover:text-gray-900 flex items-center space-x-2">
                    <i class="fas fa-redo"></i><span>重新开始</span>
                </button>
            </div>
            <div class="grid md:grid-cols-2 gap-6 mb-8">
                <div>
                    <h3 class="text-lg font-semibold text-gray-900 mb-3 text-center">原图</h3>
                    <div class="rounded-xl overflow-hidden shadow-lg checkerboard">
                        <img id="originalImage" class="w-full h-64 object-contain bg-white" alt="Original">
                    </div>
                </div>
                <div>
                    <h3 class="text-lg font-semibold text-gray-900 mb-3 text-center">去背后</h3>
                    <div class="rounded-xl overflow-hidden shadow-lg checkerboard">
                        <img id="resultImage" class="w-full h-64 object-contain" alt="Result">
                    </div>
                </div>
            </div>
            <div class="mb-6">
                <h3 class="text-lg font-semibold text-gray-900 mb-3">更换背景色</h3>
                <div class="flex flex-wrap gap-3">
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300 checkerboard" data-color="transparent" title="透明"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color: #ffffff;" data-color="#ffffff" title="白色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color: #000000;" data-color="#000000" title="黑色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color: #ef4444;" data-color="#ef4444" title="红色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color: #22c55e;" data-color="#22c55e" title="绿色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color: #3b82f6;" data-color="#3b82f6" title="蓝色"></button>
                    <button class="bg-color-btn w-12 h-12 rounded-full border-2 border-gray-300" style="background-color: #fbbf24;" data-color="#fbbf24" title="黄色"></button>
                </div>
            </div>
            <div class="flex flex-wrap gap-4 justify-center">
                <button id="downloadPngBtn" class="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium transition-colors flex items-center space-x-2">
                    <i class="fas fa-download"></i><span>下载透明 PNG</span>
                </button>
                <button id="downloadWithBgBtn" class="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-lg font-medium transition-colors flex items-center space-x-2">
                    <i class="fas fa-download"></i><span>下载带背景图</span>
                </button>
            </div>
        </div>
        <div id="errorSection" class="hidden bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-exclamation-triangle text-red-600 text-2xl"></i>
            </div>
            <h3 class="text-lg font-semibold text-red-900 mb-2">处理失败</h3>
            <p id="errorMessage" class="text-red-600 mb-4"></p>
            <button id="retryBtn" class="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors">重试</button>
        </div>
    </main>
    <footer class="bg-white border-t mt-12">
        <div class="max-w-6xl mx-auto px-4 py-6 text-center text-gray-500 text-sm">
            <p>⚠️ 免责声明：请勿上传敏感、侵权或违规图片。图片仅在内存中处理，请求结束后自动销毁。</p>
            <p class="mt-2">Powered by Remove.bg API • Built with ❤️</p>
        </div>
    </footer>
    <script>
        const uploadArea=document.getElementById('uploadArea'),fileInput=document.getElementById('fileInput'),previewSection=document.getElementById('previewSection'),previewImage=document.getElementById('previewImage'),removeBgBtn=document.getElementById('removeBgBtn'),loadingSection=document.getElementById('loadingSection'),resultSection=document.getElementById('resultSection'),originalImage=document.getElementById('originalImage'),resultImage=document.getElementById('resultImage'),errorSection=document.getElementById('errorSection'),errorMessage=document.getElementById('errorMessage'),retryBtn=document.getElementById('retryBtn'),startOverBtn=document.getElementById('startOverBtn'),downloadPngBtn=document.getElementById('downloadPngBtn'),downloadWithBgBtn=document.getElementById('downloadWithBgBtn'),bgColorBtns=document.querySelectorAll('.bg-color-btn');
        let currentFile=null,resultBlob=null,selectedBgColor='transparent';
        uploadArea.addEventListener('click',()=>fileInput.click());
        fileInput.addEventListener('change',e=>{if(e.target.files.length>0)handleFile(e.target.files[0])});
        uploadArea.addEventListener('dragover',e=>{e.preventDefault();uploadArea.classList.add('dragover')});
        uploadArea.addEventListener('dragleave',()=>{uploadArea.classList.remove('dragover')});
        uploadArea.addEventListener('drop',e=>{e.preventDefault();uploadArea.classList.remove('dragover');if(e.dataTransfer.files.length>0)handleFile(e.dataTransfer.files[0])});
        function handleFile(file){if(!file.type.startsWith('image/')){showError('请上传图片文件（JPG、PNG、WebP）');return}if(file.size>10*1024*1024){showError('图片大小不能超过 10MB');return}currentFile=file;const reader=new FileReader();reader.onload=e=>{previewImage.src=e.target.result;previewSection.classList.remove('hidden');uploadArea.classList.add('hidden')};reader.readAsDataURL(file)}
        removeBgBtn.addEventListener('click',async()=>{if(!currentFile)return;previewSection.classList.add('hidden');loadingSection.classList.remove('hidden');errorSection.classList.add('hidden');try{const formData=new FormData();formData.append('image_file',currentFile);formData.append('size','auto');const response=await fetch('/api/remove-bg',{method:'POST',body:formData});if(!response.ok)throw new Error('处理失败，请重试');resultBlob=await response.blob();const resultUrl=URL.createObjectURL(resultBlob);originalImage.src=previewImage.src;resultImage.src=resultUrl;loadingSection.classList.add('hidden');resultSection.classList.remove('hidden')}catch(error){loadingSection.classList.add('hidden');showError(error.message||'处理失败，请检查网络连接')}});
        bgColorBtns.forEach(btn=>{btn.addEventListener('click',()=>{bgColorBtns.forEach(b=>b.classList.remove('border-blue-600','border-4'));btn.classList.add('border-blue-600','border-4');selectedBgColor=btn.dataset.color;if(selectedBgColor==='transparent'){resultImage.style.background='transparent'}else{resultImage.style.background=selectedBgColor}})});
        bgColorBtns[0].click();
        downloadPngBtn.addEventListener('click',()=>{if(!resultBlob)return;const url=URL.createObjectURL(resultBlob);const a=document.createElement('a');a.href=url;a.download='background-removed.png';a.click();URL.revokeObjectURL(url)});
        downloadWithBgBtn.addEventListener('click',()=>{if(!resultBlob)return;const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d');const img=new Image();img.onload=()=>{canvas.width=img.width;canvas.height=img.height;if(selectedBgColor!=='transparent'){ctx.fillStyle=selectedBgColor;ctx.fillRect(0,0,canvas.width,canvas.height)}ctx.drawImage(img,0,0);canvas.toBlob(blob=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='image-with-background.png';a.click();URL.revokeObjectURL(url)},'image/png')};img.src=URL.createObjectURL(resultBlob)});
        startOverBtn.addEventListener('click',()=>{resultSection.classList.add('hidden');uploadArea.classList.remove('hidden');previewSection.classList.add('hidden');fileInput.value='';currentFile=null;resultBlob=null;resultImage.style.background='transparent'});
        retryBtn.addEventListener('click',()=>{errorSection.classList.add('hidden');previewSection.classList.remove('hidden')});
        function showError(message){errorMessage.textContent=message;errorSection.classList.remove('hidden')}
    </script>
</body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Handle API endpoint
    if (url.pathname === '/api/remove-bg') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { 
          status: 405, 
          headers: corsHeaders 
        });
      }

      try {
        const formData = await request.formData();
        const imageFile = formData.get('image_file');

        if (!imageFile) {
          return new Response(JSON.stringify({ error: 'No image file provided' }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Check API key
        if (!env.REMOVE_BG_API_KEY) {
          return new Response(JSON.stringify({ error: 'API key not configured' }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Call Remove.bg API
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
          const errorData = await removeBgResponse.text();
          console.error('Remove.bg API error:', errorData);
          
          if (removeBgResponse.status === 403) {
            return new Response(JSON.stringify({ error: 'Invalid API key' }), { 
              status: 403, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          
          return new Response(JSON.stringify({ error: 'Failed to process image', details: errorData }), { 
            status: removeBgResponse.status, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Return processed image
        const processedImage = await removeBgResponse.arrayBuffer();
        
        return new Response(processedImage, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'image/png',
            'Content-Disposition': 'attachment; filename="background-removed.png"',
          },
        });

      } catch (error) {
        console.error('Error processing image:', error);
        return new Response(JSON.stringify({ error: 'Internal server error', message: error.message }), { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Serve index.html for GET requests to root
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return new Response(indexHTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...corsHeaders
        }
      });
    }

    // 404 for other paths
    return new Response('Not Found', { 
      status: 404, 
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  },
};
