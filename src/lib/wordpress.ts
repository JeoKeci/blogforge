export async function publishToWordPress(opts: {
  siteUrl: string;
  credentials: string;  // "user:app_password"
  payload: { title: string; content: string; status: string; slug?: string };
}): Promise<{ mocked: boolean; id?: number; url?: string }> {
  if ((process.env.WP_MOCK_MODE ?? 'true').toLowerCase() === 'true') {
    // SADECE mock loglama var; credential ASLA loglanmamali (güvenlik)
    console.log('[WP_MOCK] ->', opts.siteUrl, opts.payload.title);
    return { mocked: true };
  }
  
  const auth = Buffer.from(opts.credentials).toString('base64');
  const ctrl = new AbortController(); 
  const t = setTimeout(() => ctrl.abort(), 30_000);
  
  try {
    const res = await fetch(`${opts.siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST', 
      signal: ctrl.signal,
      headers: { 
        Authorization: `Basic ${auth}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(opts.payload),
    });
    
    if (![200, 201].includes(res.status)) {
      throw new Error(`WP API ${res.status}: ${await res.text()}`);
    }
    
    const j = await res.json(); 
    return { mocked: false, id: j.id, url: j.link };
  } finally { 
    clearTimeout(t); 
  }
}
