export async function generateContent(prompt: string, jsonMode: boolean = false): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables.');
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  
  const body: any = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  };
  
  if (jsonMode) {
    body.generationConfig = {
      responseMimeType: 'application/json'
    };
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let lastErr: unknown;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetch(url, { 
          method: 'POST', 
          headers: { 
            'Content-Type': 'application/json', 
            'x-goog-api-key': apiKey 
          }, 
          body: JSON.stringify(body), 
          signal: controller.signal 
        });
      } catch (err: any) {
        if (err.name === 'AbortError') throw new Error('Gemini API request timed out after 60 seconds.');
        lastErr = err;
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      
      if (response.ok) { 
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) throw new Error('Gemini API returned an empty response.');
          return text;
      }
      
      if (response.status === 429 || response.status >= 500) { 
          await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); 
          lastErr = new Error(`Gemini ${response.status}`); 
          continue; 
      }
      
      const t = await response.text(); 
      throw new Error(`Gemini API error: ${response.status} - ${t}`);
    }
    throw lastErr ?? new Error('Gemini: retries exhausted');
  } finally { 
    clearTimeout(timeout); 
  }
}
