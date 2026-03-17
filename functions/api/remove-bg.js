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
      const errorText = await removeBgResponse.text();
      console.error('Remove.bg API error:', errorText);
      
      if (removeBgResponse.status === 403) {
        return new Response('Invalid API key', { 
          status: 403, 
          headers: corsHeaders 
        });
      }
      
      return new Response('Failed to process image: ' + removeBgResponse.status, { 
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
    console.error('Error processing image:', error);
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
