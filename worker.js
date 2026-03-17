/**
 * Cloudflare Worker - Image Background Remover API
 * 
 * 环境变量:
 * - REMOVE_BG_API_KEY: Remove.bg API Key
 */

export default {
  async fetch(request, env, ctx) {
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
    if (request.url.endsWith('/api/remove-bg')) {
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
          return new Response('No image file provided', { 
            status: 400, 
            headers: corsHeaders 
          });
        }

        // Check API key
        if (!env.REMOVE_BG_API_KEY) {
          return new Response('API key not configured', { 
            status: 500, 
            headers: corsHeaders 
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
            return new Response('Invalid API key', { 
              status: 403, 
              headers: corsHeaders 
            });
          }
          
          return new Response('Failed to process image', { 
            status: removeBgResponse.status, 
            headers: corsHeaders 
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
        return new Response('Internal server error', { 
          status: 500, 
          headers: corsHeaders 
        });
      }
    }

    // Serve static files (for Cloudflare Pages)
    // This will be handled by Cloudflare Pages automatically
    return new Response('Image Background Remover API', { 
      headers: { 
        'Content-Type': 'text/plain',
        ...corsHeaders 
      } 
    });
  },
};
