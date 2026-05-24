const main = async () => {
  console.log('=== Phase 1.5 Verification Script ===');

  // 1. Seed & Reset
  console.log('1. Seeding database...');
  const seedRes = await fetch('http://localhost:3000/api/test-panel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'seed' })
  });
  const seedData = await seedRes.json();
  console.log('Seed Result:', seedData);

  // 2. Fetch Status
  console.log('2. Checking initial status...');
  const statusRes = await fetch('http://localhost:3000/api/test-panel/status');
  const statusData = await statusRes.json();
  console.log('Project State:', statusData.project?.state);
  console.log('Sources count:', statusData.sources?.length);
  console.log('Sources:', statusData.sources?.map(s => `${s.displayName} (${s.type}) - Status: ${s.status}`));

  // 3. Trigger Analyze Sources
  console.log('3. Analyzing sources and generating strategy & plan...');
  const analyzeRes = await fetch('http://localhost:3000/api/test-panel/analyze-sources', {
    method: 'POST'
  });
  const analyzeData = await analyzeRes.json();
  console.log('Analyze success:', analyzeData.success);
  if (!analyzeData.success) {
    console.error('Analysis Failed:', analyzeData.error);
    process.exit(1);
  }
  console.log('Analysis Summary:', analyzeData.analysisSummary);
  console.log('Strategy Summary:', analyzeData.strategy?.summary);
  console.log('Pillars:', analyzeData.strategy?.contentPillars);
  console.log('Generated Articles count:', analyzeData.articles?.length);
  console.log('Articles:', analyzeData.articles?.map(a => a.articlePlan?.title));

  // 4. Test section writing on first article
  const firstArticle = analyzeData.articles?.[0]?.article;
  if (!firstArticle) {
    console.error('No article generated!');
    process.exit(1);
  }

  console.log(`4. Triggering writing for article: ${firstArticle.title}`);
  // Wait a moment for Next.js DB states to settle
  await new Promise(r => setTimeout(r, 1000));

  const triggerRes = await fetch('http://localhost:3000/api/test-panel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'trigger_next', articleId: firstArticle.id })
  });
  const triggerData = await triggerRes.json();
  console.log('Trigger Result:', triggerData);

  // Let's poll for a few seconds to see if the Celery worker writes the section
  console.log('Polling for section completion (max 25s)...');
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const pollRes = await fetch(`http://localhost:3000/api/test-panel/status?selectedArticleId=${firstArticle.id}`);
    const pollData = await pollRes.json();
    const active = pollData.activeArticle;
    console.log(`Poll #${i+1}: State = ${active?.state}, Sections Written = ${active?.sections?.length || 0}/${pollData.outline?.length || 0}`);
    if (active?.sections?.length > 0) {
      console.log('✅ Successfully verified section was written by Celery!');
      break;
    }
  }

  console.log('=== Verification Complete! ===');
};

main().catch(console.error);
