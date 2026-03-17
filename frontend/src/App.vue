<template>
  <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
    <div class="container mx-auto px-4 py-16">
      <!-- 标题 -->
      <div class="text-center mb-12">
        <h1 class="text-5xl font-bold text-gray-800 mb-4">
          🖼️ 图像背景移除工具
        </h1>
        <p class="text-xl text-gray-600">
          基于 AI 技术，一键移除图像背景
        </p>
      </div>

      <!-- 上传区域 -->
      <div class="max-w-2xl mx-auto">
        <div 
          class="bg-white rounded-2xl shadow-xl p-8 mb-8"
          @dragover.prevent="isDragging = true"
          @dragleave="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <div 
            class="border-2 border-dashed rounded-xl p-12 text-center transition-colors"
            :class="isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300'"
          >
            <input
              type="file"
              ref="fileInput"
              @change="handleFileSelect"
              accept="image/*"
              class="hidden"
            />
            
            <div v-if="!selectedFile" @click="$refs.fileInput.click()" class="cursor-pointer">
              <svg class="mx-auto h-16 w-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p class="text-lg text-gray-600 mb-2">点击或拖拽上传图像</p>
              <p class="text-sm text-gray-500">支持 PNG, JPG, JPEG, WEBP 格式</p>
            </div>

            <div v-else class="space-y-4">
              <div class="flex items-center justify-center space-x-4">
                <svg class="h-12 w-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div class="text-left">
                  <p class="text-lg font-medium text-gray-800">{{ selectedFile.name }}</p>
                  <p class="text-sm text-gray-500">{{ formatFileSize(selectedFile.size) }}</p>
                </div>
              </div>
              
              <button
                @click="removeBackground"
                :disabled="isProcessing"
                class="px-8 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {{ isProcessing ? '处理中...' : '移除背景' }}
              </button>
              
              <button
                @click="reset"
                class="ml-4 px-6 py-3 text-gray-600 hover:text-gray-800 transition-colors"
              >
                重新选择
              </button>
            </div>
          </div>
        </div>

        <!-- 处理结果 -->
        <div v-if="resultUrl" class="bg-white rounded-2xl shadow-xl p-8">
          <h2 class="text-2xl font-bold text-gray-800 mb-4">处理结果</h2>
          <div class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p class="text-sm font-medium text-gray-600 mb-2">原图</p>
                <img :src="originalPreview" alt="Original" class="w-full rounded-lg border" />
              </div>
              <div>
                <p class="text-sm font-medium text-gray-600 mb-2">移除背景后</p>
                <img :src="resultUrl" alt="Result" class="w-full rounded-lg border bg-checkered" />
              </div>
            </div>
            
            <a
              :href="resultUrl"
              :download="downloadFilename"
              class="block w-full text-center px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              ⬇️ 下载结果
            </a>
          </div>
        </div>

        <!-- 错误信息 -->
        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
          {{ error }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import axios from 'axios'

const selectedFile = ref(null)
const isProcessing = ref(false)
const resultUrl = ref(null)
const error = ref(null)
const isDragging = ref(false)
const originalPreview = ref(null)

const downloadFilename = computed(() => {
  if (!selectedFile.value) return 'result.png'
  return selectedFile.value.name.replace(/\.[^/.]+$/, '') + '_no_bg.png'
})

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const handleFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    selectedFile.value = file
    originalPreview.value = URL.createObjectURL(file)
    error.value = null
    resultUrl.value = null
  }
}

const handleDrop = (event) => {
  isDragging.value = false
  const file = event.dataTransfer.files[0]
  if (file && file.type.startsWith('image/')) {
    selectedFile.value = file
    originalPreview.value = URL.createObjectURL(file)
    error.value = null
    resultUrl.value = null
  } else {
    error.value = '请上传有效的图像文件'
  }
}

const removeBackground = async () => {
  if (!selectedFile.value) return
  
  isProcessing.value = true
  error.value = null
  resultUrl.value = null
  
  try {
    const formData = new FormData()
    formData.append('file', selectedFile.value)
    
    const response = await axios.post('/api/remove-background', formData, {
      responseType: 'blob'
    })
    
    resultUrl.value = URL.createObjectURL(response.data)
  } catch (err) {
    error.value = err.response?.data?.detail || '处理失败，请重试'
    console.error('Error:', err)
  } finally {
    isProcessing.value = false
  }
}

const reset = () => {
  selectedFile.value = null
  resultUrl.value = null
  error.value = null
  originalPreview.value = null
  if (originalPreview.value) {
    URL.revokeObjectURL(originalPreview.value)
  }
}
</script>

<style>
.bg-checkered {
  background-image: 
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}
</style>
