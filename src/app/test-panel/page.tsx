'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import './test-panel.css';

interface Source {
  id: string;
  type: string;
  url?: string;
  identifier?: string;
  displayName: string;
  status: string;
  errorMessage?: string;
  extractedData?: any;
}

interface Strategy {
  id: string;
  summary: string;
  targetKeywords: any; // Array of { cluster, keywords }
  contentPillars: string[];
  geoTargets: string[];
  contentMix: Record<string, number>;
  monthlyTarget: number;
  version: number;
}

interface AuditBreakdownItem {
  score: number;
  good: string;
  bad: string;
}

interface SiteAuditData {
  id: string;
  seoScore: number | null;
  auditMatrix: {
    totalScore: number;
    breakdown: {
      metadata: AuditBreakdownItem;
      hierarchy: AuditBreakdownItem;
      depth: AuditBreakdownItem;
      geoEntity: AuditBreakdownItem;
    };
  } | null;
  actionPlan: string[] | null;
}

interface KBContentRule {
  id: string;
  type: 'FORBIDDEN_PHRASE' | 'FACT_CORRECTION' | 'REQUIRED' | 'STYLE';
  value: string;
  reason: string | null;
  isActive: boolean;
  origin: 'AI_DERIVED' | 'USER_ADDED' | 'USER_OVERRIDE';
}

interface KBContentPillar {
  id: string;
  name: string;
  scope: string;
}

interface KBOutboundLink {
  id: string;
  url: string;
  title: string;
  usageArea: string | null;
}

interface KnowledgeBaseData {
  id: string;
  status: 'DRAFT' | 'APPROVED' | 'REVISION';
  verifiedFacts: any;
  brandEntities: any;
  writingInstructions: any;
  generatedChecklist: any;
  rules: KBContentRule[];
  pillars: KBContentPillar[];
  outboundLinks: KBOutboundLink[];
}

interface Project {
  id: string;
  name: string;
  state: string;
  siteUrl: string;
  siteAudit?: SiteAuditData | null;
  lastError?: string | null;
  knowledgeBase?: KnowledgeBaseData | null;
  contentPlan?: any;
}

interface ArticleInfo {
  id: string;
  title: string;
  state: string;
  wordCount: number;
  progress: { completed: number; total: number } | null;
}

interface ActiveArticle {
  id: string;
  title: string;
  state: string;
  wordCount: number;
  htmlContent: string;
  articlePlan: any;
  sections: Array<{
    id: string;
    order: number;
    headingTitle: string;
    wordCount: number;
    htmlContent: string;
  }>;
  qualityGate?: any;
  faq?: any;
  schemaMarkup?: any;
  wpInstructions?: any;
  versions?: Array<{
    versionNumber: number;
    changeNote: string | null;
    createdAt: string;
  }>;
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
}

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

function getTimeString(): string {
  return new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function TestPanelPage() {
  const [statusExists, setStatusExists] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [articles, setArticles] = useState<ArticleInfo[]>([]);
  const [activeArticle, setActiveArticle] = useState<ActiveArticle | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string>('');

  const [loading, setLoading] = useState<string | null>(null); // which button/action is loading
  const [autoMode, setAutoMode] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [polling, setPolling] = useState(false);
  const [workerOnline, setWorkerOnline] = useState(false);
  const [viewStep, setViewStep] = useState<number | null>(null);
  
  // Form State for new source
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSourceType, setNewSourceType] = useState<'WEBSITE' | 'YOUTUBE' | 'INSTAGRAM' | 'CUSTOM'>('WEBSITE');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceIdentifier, setNewSourceIdentifier] = useState('');
  const [newSourceDisplayName, setNewSourceDisplayName] = useState('');
  const [newSourceTextContent, setNewSourceTextContent] = useState('');

  // Rewrite state
  const [rewriteSectionId, setRewriteSectionId] = useState<string | null>(null);
  const [rewriteFeedback, setRewriteFeedback] = useState<string>('');

  const logContainerRef = useRef<HTMLDivElement>(null);
  const autoModeRef = useRef(autoMode);
  const prevSectionsCountRef = useRef(0);

  // Keep ref in sync
  useEffect(() => {
    autoModeRef.current = autoMode;
  }, [autoMode]);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs((prev) => [...prev.slice(-50), { time: getTimeString(), message, type }]);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Fetch status
  const fetchStatus = useCallback(async (forcedArticleId?: string) => {
    try {
      const targetArticleId = forcedArticleId || selectedArticleId;
      const url = `/api/test-panel/status${targetArticleId ? `?selectedArticleId=${targetArticleId}` : ''}`;
      
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.exists) {
        setStatusExists(true);
        setProject(data.project);
        setSources(data.sources || []);
        setStrategy(data.strategy || null);
        setArticles(data.articles || []);
        setActiveArticle(data.activeArticle || null);
        
        if (data.activeArticle && !selectedArticleId && !forcedArticleId) {
          setSelectedArticleId(data.activeArticle.id);
        }
        
        // Detect worker online from active sections
        if (data.activeArticle?.sections && data.activeArticle.sections.length > 0) {
          setWorkerOnline(true);
        }
      } else {
        setStatusExists(false);
        setProject(null);
        setSources([]);
        setStrategy(null);
        setArticles([]);
        setActiveArticle(null);
      }

      return data;
    } catch {
      addLog('Durum sorgusu başarısız.', 'error');
      return null;
    }
  }, [selectedArticleId, addLog]);

  // Initial load
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling when active
  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      const data = await fetchStatus();

      if (data?.activeArticle?.state === 'PREVIEW_READY') {
        setPolling(false);
        setLoading(null);
        addLog(`✅ "${data.activeArticle.title}" makalesinin tüm bölümleri tamamlandı!`, 'success');
        return;
      }

      // Auto-mode: detect newly completed section and trigger next
      if (autoModeRef.current && data?.activeArticle?.sections && data?.activeArticle?.progress) {
        const newCount = data.activeArticle.sections.length;
        if (newCount > prevSectionsCountRef.current && newCount < data.activeArticle.progress.total) {
          prevSectionsCountRef.current = newCount;
          const lastSection = data.activeArticle.sections[data.activeArticle.sections.length - 1];
          addLog(`✅ "${lastSection.headingTitle}" tamamlandı (${lastSection.wordCount} kelime). Sıradaki tetikleniyor...`, 'success');
          // Trigger next
          triggerNext(true);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [polling, fetchStatus, addLog]);

  // Select another article
  const selectArticle = (id: string) => {
    setSelectedArticleId(id);
    fetchStatus(id);
    addLog(`Önizleme makalesi değiştirildi.`, 'info');
  };

  // ─── Actions ───

  async function handleSeed() {
    if (!confirm('Tüm test verileri silinecektir. Emin misiniz?')) return;
    setLoading('seed');
    addLog('🔄 Veritabanı sıfırlanıp test verileri ve varsayılan kaynaklar kuruluyor...', 'info');
    try {
      const res = await fetch('/api/test-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed' }),
      });
      const data = await res.json();
      if (data.success) {
        addLog('✅ Test veritabanı başarıyla seed edildi. Varsayılan kaynaklar eklendi.', 'success');
        prevSectionsCountRef.current = 0;
        setSelectedArticleId('');
        await fetchStatus();
      } else {
        addLog(`❌ Seed hatası: ${data.error}`, 'error');
      }
    } catch (e: unknown) {
      addLog(`❌ Seed hatası: ${e instanceof Error ? e.message : 'Bilinmeyen hata'}`, 'error');
    }
    setLoading(null);
  }

  async function handleAddSource(e: React.FormEvent) {
    e.preventDefault();
    setLoading('addSource');
    try {
      const res = await fetch('/api/test-panel/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newSourceType,
          url: newSourceUrl,
          identifier: newSourceIdentifier,
          displayName: newSourceDisplayName,
          textContent: newSourceTextContent
        })
      });
      const data = await res.json();
      if (data.success) {
        addLog(`✅ Kaynak eklendi: ${data.source.displayName}`, 'success');
        setNewSourceUrl('');
        setNewSourceIdentifier('');
        setNewSourceDisplayName('');
        setNewSourceTextContent('');
        setShowAddForm(false);
        await fetchStatus();
      } else {
        addLog(`❌ Kaynak ekleme hatası: ${data.error}`, 'error');
      }
    } catch (e: any) {
      addLog(`❌ Kaynak ekleme hatası: ${e.message}`, 'error');
    }
    setLoading(null);
  }

  async function handleDeleteSource(id: string, name: string) {
    if (!confirm(`"${name}" kaynağını silmek istediğinize emin misiniz?`)) return;
    try {
      const res = await fetch(`/api/test-panel/sources?id=${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        addLog(`🗑️ Kaynak silindi: ${name}`, 'info');
        await fetchStatus();
      } else {
        addLog(`❌ Kaynak silme hatası: ${data.error}`, 'error');
      }
    } catch (e: any) {
      addLog(`❌ Kaynak silme hatası: ${e.message}`, 'error');
    }
  }

  async function handleAnalyzeSources() {
    setLoading('analyze');
    addLog('🔄 Dijital kaynaklar analiz ediliyor ve birleşik plan oluşturuluyor (Gemini + Scrapers)...', 'info');
    try {
      const res = await fetch('/api/test-panel/analyze-sources', {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        addLog('✅ Tüm kaynaklar başarıyla analiz edildi!', 'success');
        addLog('✅ Yeni birleşik içerik stratejisi ve makale taslakları oluşturuldu.', 'success');
        
        // Load the first new article
        const firstNewArticle = data.articles?.[0]?.article;
        if (firstNewArticle) {
          setSelectedArticleId(firstNewArticle.id);
          await fetchStatus(firstNewArticle.id);
        } else {
          await fetchStatus();
        }
      } else {
        addLog(`❌ Analiz Hatası: ${data.error}`, 'error');
        await fetchStatus();
      }
    } catch (e: any) {
      addLog(`❌ Analiz Hatası: ${e.message}`, 'error');
      await fetchStatus();
    }
    setLoading(null);
  }

  async function handleToggleRule(ruleId: string, currentStatus: boolean) {
    try {
      const res = await fetch('/api/test-panel/knowledge-base/toggle-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleId, isActive: !currentStatus })
      });
      const data = await res.json();
      if (data.success) {
        addLog(`✅ Kural durumu güncellendi.`, 'success');
        await fetchStatus();
      } else {
        addLog(`❌ Kural güncellenemedi: ${data.error}`, 'error');
      }
    } catch (e: any) {
      addLog(`❌ Kural güncellenemedi: ${e.message}`, 'error');
    }
  }

  async function handleApproveKB() {
    if (!confirm('Tüm kuralları onaylıyor musunuz? (Bu işlemden sonra strateji üretilecektir.)')) return;
    setLoading('approveKB');
    addLog('🔄 Anayasa onaylanıyor...', 'info');
    try {
      const res = await fetch('/api/test-panel/knowledge-base/approve', {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        addLog('✅ Kural Anayasası başarıyla onaylandı ve kilitlendi!', 'success');
        await fetchStatus();
      } else {
        addLog(`❌ Onay hatası: ${data.error}`, 'error');
      }
    } catch (e: any) {
      addLog(`❌ Onay hatası: ${e.message}`, 'error');
    }
    setLoading(null);
  }

  async function handleGenerateStrategy() {
    setLoading('generateStrategy');
    addLog('🔄 İçerik stratejisi ve planı üretiliyor (Faz 1.7)...', 'info');
    try {
      const res = await fetch('/api/test-panel/generate-strategy', {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        addLog('✅ Birleşik içerik stratejisi ve makale taslakları başarıyla oluşturuldu!', 'success');
        const firstNewArticle = data.articles?.[0]?.article;
        if (firstNewArticle) {
          setSelectedArticleId(firstNewArticle.id);
          await fetchStatus(firstNewArticle.id);
        } else {
          await fetchStatus();
        }
      } else {
        addLog(`❌ Strateji Üretim Hatası: ${data.error}`, 'error');
      }
    } catch (e: any) {
      addLog(`❌ Strateji Üretim Hatası: ${e.message}`, 'error');
    }
    setLoading(null);
  }

  async function handleGapAnalysis() {
    setLoading('gapAnalysis');
    addLog('🕵️ Rakip ve Gap Analizi Celery\'ye gönderiliyor...', 'info');
    try {
      const res = await fetch('/api/test-panel/competitors/analyze', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog('✅ Rakip & Gap Analizi başlatıldı. Arka planda Celery işleyecek.', 'success');
        setPolling(true);
      } else {
        addLog(`❌ Gap Analizi Hatası: ${data.error}`, 'error');
      }
    } catch (e: any) {
      addLog(`❌ Gap Analizi Hatası: ${e.message}`, 'error');
    }
    setLoading(null);
  }

  async function handleApproveGap(gap: any) {
    addLog(`➕ "${gap.title}" makale planlarına ekleniyor...`, 'info');
    try {
      const res = await fetch('/api/test-panel/articles/approve-gap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gap }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`✅ "${gap.title}" başarıyla plana eklendi.`, 'success');
        await fetchStatus();
      } else {
        addLog(`❌ Ekleme Hatası: ${data.error}`, 'error');
      }
    } catch (e: any) {
      addLog(`❌ Ekleme Hatası: ${e.message}`, 'error');
    }
  }

  async function triggerNext(isAutoCall = false) {
    if (!activeArticle) {
      addLog('❌ Aktif seçili makale yok.', 'error');
      return;
    }
    if (!isAutoCall) setLoading('trigger');
    if (!isAutoCall) addLog(`🚀 "${activeArticle.title}" için sıradaki bölüm Celery'ye gönderiliyor...`, 'info');

    try {
      const res = await fetch('/api/test-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_next', articleId: activeArticle.id }),
      });
      const data = await res.json();
      if (data.success) {
        addLog(`📝 "${data.section}" (${data.order}/${data.totalSections}) Celery'ye gönderildi. Task ID: ${data.taskId.slice(0, 8)}...`, 'info');
        setPolling(true);
        setWorkerOnline(true);
      } else if (data.completed) {
        addLog('ℹ️ Tüm bölümler zaten yazılmış.', 'info');
      } else {
        addLog(`❌ Tetikleme hatası: ${data.error}`, 'error');
      }
    } catch (e: unknown) {
      addLog(`❌ Tetikleme hatası: ${e instanceof Error ? e.message : 'Bilinmeyen hata'}`, 'error');
    }
    if (!isAutoCall) setLoading(null);
  }

  async function handleTriggerAll() {
    if (!activeArticle) {
      addLog('❌ Aktif seçili makale yok.', 'error');
      return;
    }
    setAutoMode(true);
    autoModeRef.current = true;
    setLoading('triggerAll');
    addLog(`🤖 Otomatik mod aktif — "${activeArticle.title}" bölümleri sırayla yazılacak.`, 'info');

    const data = await fetchStatus();
    if (data?.activeArticle?.sections) {
      prevSectionsCountRef.current = data.activeArticle.sections.length;
    }

    await triggerNext(true);
    setPolling(true);
    setLoading(null);
  }

  async function handleRewriteSubmit() {
    if (!activeArticle || !rewriteSectionId || !rewriteFeedback.trim()) return;
    
    setLoading('rewrite');
    addLog('🔄 Bölüm yeniden yazım talebi gönderiliyor...', 'info');
    
    try {
      const res = await fetch('/api/test-panel/articles/rewrite-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId: activeArticle.id,
          sectionId: rewriteSectionId,
          feedback: rewriteFeedback
        })
      });
      const data = await res.json();
      if (data.success) {
        addLog('✅ Yeniden yazım Celery\'ye başarıyla gönderildi, makale kilitlendi.', 'success');
        setRewriteSectionId(null);
        setRewriteFeedback('');
        setPolling(true);
        setWorkerOnline(true);
        await fetchStatus();
      } else {
        addLog(`❌ Yeniden yazım hatası: ${data.error}`, 'error');
      }
    } catch (e: any) {
      addLog(`❌ Yeniden yazım hatası: ${e.message}`, 'error');
    }
    setLoading(null);
  }

  // ─── Render Helpers ───

  function getStateBadge(state: string) {
    const map: Record<string, { className: string; label: string }> = {
      WRITING: { className: 'stateWriting', label: 'Yazılıyor' },
      PREVIEW_READY: { className: 'statePreviewReady', label: 'Önizleme Hazır' },
      OUTLINE_DRAFT: { className: 'stateOutline', label: 'Taslak' },
      OUTLINE_APPROVED: { className: 'stateOutline', label: 'Onaylandı' },
    };
    const config = map[state] || { className: 'stateDefault', label: state };
    return <span className={`stateBadge ${config.className}`}>{config.label}</span>;
  }

  function getStepStatus(index: number): 'complete' | 'active' | 'pending' {
    if (!activeArticle?.sections) return 'pending';
    const completedCount = activeArticle.sections.length;
    if (index < completedCount) return 'complete';
    if (index === completedCount && activeArticle.state === 'WRITING') return 'active';
    return 'pending';
  }

  const isWriting = activeArticle?.state === 'WRITING' && polling;
  const isDone = activeArticle?.state === 'PREVIEW_READY';
  const hasArticle = statusExists && activeArticle;

  // Stepper logic
  const STEPPER_STAGES = [
    { id: 'sources', label: 'Kaynaklar', states: ['CREATED', 'FAILED'] },
    { id: 'audit', label: 'Audit & Analiz', states: ['SOURCES_ANALYZING', 'SITE_AUDIT_RUNNING', 'SOURCES_ANALYZED'] },
    { id: 'kb', label: 'Bilgi Tabanı', states: ['KNOWLEDGE_BASE_REVIEW'] },
    { id: 'strategy', label: 'Strateji', states: ['STRATEGY_GENERATING', 'STRATEGY_REVIEW'] },
    { id: 'production', label: 'Üretim', states: ['CONTENT_PRODUCTION', 'PLAN_APPROVED', 'WRITING', 'PREVIEW_READY', 'PUBLISHED'] }
  ];

  const currentProjectState = project?.state || 'CREATED';
  let activeStepIndex = 0;
  if (['SOURCES_ANALYZING', 'SITE_AUDIT_RUNNING', 'SOURCES_ANALYZED'].includes(currentProjectState)) activeStepIndex = 1;
  else if (['KNOWLEDGE_BASE_REVIEW'].includes(currentProjectState)) activeStepIndex = 2;
  else if (['STRATEGY_GENERATING', 'STRATEGY_REVIEW'].includes(currentProjectState)) activeStepIndex = 3;
  else if (['CONTENT_PRODUCTION', 'PLAN_APPROVED', 'WRITING', 'PREVIEW_READY', 'PUBLISHED'].includes(currentProjectState) || articles.length > 0) activeStepIndex = 4;
  
  const displayStep = viewStep !== null ? viewStep : activeStepIndex;



  return (
    <div className="testPanel">
      <header className="header" style={{ borderBottom: 'none' }}>
        <div className="headerLeft">
          <div className="logo">⚡</div>
          <div>
            <h1 className="headerTitle">BlogForge Test Panel</h1>
            <p className="headerSubtitle">Adım Adım Üretim Takibi</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btnDanger btnMini" onClick={handleSeed} disabled={loading !== null}>
            {loading === 'seed' ? <span className="spinner" /> : '🔴 Seed & Sıfırla'}
          </button>
          <button className="btn btnOutline btnMini" onClick={() => fetchStatus()} disabled={loading !== null}>
            🔄 Yenile
          </button>
        </div>
      </header>

      {/* Persistent Status Bar */}
      <div className="statusBar" style={{ display: 'flex', gap: 16, padding: '12px 24px', backgroundColor: 'var(--surface-50)', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className={`statusDot ${workerOnline ? 'statusDotAnalyzed' : 'statusDotFailed'}`} />
            <span style={{ fontSize: 13, fontWeight: 500, color: workerOnline ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}>
              {workerOnline ? 'Celery Worker Online' : 'Worker Offline'}
            </span>
         </div>
         <div style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
            {loading && <span className="spinner" style={{ marginRight: 8, width: 14, height: 14 }} />}
            {loading ? `Devam ediyor: ${loading}...` : 'Sistem Rölantide'}
         </div>
         {project?.lastError && (
           <div style={{ color: 'var(--accent-rose)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.1)', padding: '6px 12px', borderRadius: 6, fontWeight: 500 }}>
              <span>⚠️</span>
              {project.lastError}
           </div>
         )}
      </div>

      <div className="mainContainer" style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
         {/* Stepper */}
         <div className="stepper" style={{ display: 'flex', marginBottom: 24, gap: 8, background: 'var(--surface-50)', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            {STEPPER_STAGES.map((step, idx) => {
               const isComplete = idx < activeStepIndex;
               const isActive = idx === activeStepIndex;
               const isViewing = idx === displayStep;
               
               let borderColor = 'transparent';
               if (isActive) borderColor = 'var(--accent-indigo)';
               else if (isComplete) borderColor = 'var(--accent-emerald)';
               
               return (
                 <div key={step.id} onClick={() => setViewStep(idx)} style={{ flex: 1, padding: '12px 16px', cursor: 'pointer', borderBottom: `3px solid ${borderColor}`, background: isViewing ? 'var(--surface-100)' : 'transparent', transition: 'all 0.2s', borderRadius: '6px' }}>
                   <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Adım {idx + 1}</div>
                   <div style={{ fontSize: 14, fontWeight: isActive ? 600 : 500, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', marginTop: 4 }}>
                     {isComplete ? '✓ ' : ''}{step.label}
                   </div>
                 </div>
               )
            })}
         </div>

         {/* Step 1: Sources */}
         {displayStep === 0 && (
           <div className="stepContent">
             <div className="card">
               <div className="cardHeader">
                 <span className="cardTitle">🌐 Dijital Ayak İzi Kaynakları</span>
                 <button className="btn btnOutline btnMini" onClick={() => setShowAddForm(!showAddForm)}>
                   {showAddForm ? 'Kapat' : 'Ekle'}
                 </button>
               </div>
               <div className="cardBody">
                 {sources.length === 0 ? (
                   <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)' }}>
                     Kaynak bulunamadı. Yeni bir websitesi veya YouTube kanalı ekleyin.
                   </div>
                 ) : (
                   <div className="sourcesList">
                     {sources.map((s) => (
                       <div key={s.id} className="sourceItem" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                         <div>
                           <div style={{ fontWeight: 500 }}>{s.displayName}</div>
                           <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                             <span style={{ padding: '2px 6px', background: 'var(--surface-100)', borderRadius: 4, marginRight: 8 }}>{s.type}</span>
                             {s.url || s.identifier}
                           </div>
                         </div>
                         <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                           <span style={{ fontSize: 12, color: s.status === 'ANALYZED' ? 'var(--accent-emerald)' : s.status === 'FAILED' ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>
                             {s.status}
                           </span>
                           <button className="btn btnOutline btnMini" onClick={() => handleDeleteSource(s.id, s.displayName)}>Sil</button>
                         </div>
                       </div>
                     ))}
                   </div>
                 )}

                 {showAddForm && (
                    <form onSubmit={handleAddSource} style={{ marginTop: 16, padding: 16, background: 'var(--surface-50)', borderRadius: 8 }}>
                      <h4 style={{ margin: '0 0 12px 0' }}>Yeni Kaynak Ekle</h4>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <select className="formSelect" value={newSourceType} onChange={(e) => setNewSourceType(e.target.value as any)} style={{ flex: 1 }}>
                          <option value="WEBSITE">Web Sitesi</option>
                          <option value="YOUTUBE">YouTube Kanalı</option>
                        </select>
                        <input type="text" className="formInput" placeholder="Görünüm Adı" value={newSourceDisplayName} onChange={(e) => setNewSourceDisplayName(e.target.value)} style={{ flex: 2 }} required />
                        {newSourceType === 'WEBSITE' ? (
                           <input type="text" className="formInput" placeholder="URL" value={newSourceUrl} onChange={(e) => setNewSourceUrl(e.target.value)} style={{ flex: 3 }} required />
                        ) : (
                           <input type="text" className="formInput" placeholder="Identifier (@handle)" value={newSourceIdentifier} onChange={(e) => setNewSourceIdentifier(e.target.value)} style={{ flex: 3 }} required />
                        )}
                        <button type="submit" className="btn btnPrimary btnMini" disabled={loading === 'addSource'}>Kaydet</button>
                      </div>
                    </form>
                 )}

                 <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
                   <button className="btn btnPrimary" onClick={handleAnalyzeSources} disabled={loading !== null || sources.length === 0}>
                     {loading === 'analyze' ? <span className="spinner" /> : '🚀 Kaynakları Analiz Et'}
                   </button>
                 </div>
               </div>
             </div>
           </div>
         )}

         {/* Step 2: Audit */}
         {displayStep === 1 && (
           <div className="stepContent">
              {project?.siteAudit?.auditMatrix ? (() => {
                 const audit = project.siteAudit!;
                 const matrix = audit.auditMatrix! as any;
                 const score = matrix.totalScore;
                 const scoreClass = score >= 70 ? 'scoreHigh' : score >= 40 ? 'scoreMedium' : 'scoreLow';
                 return (
                   <div className="card auditCard">
                     <div className="cardHeader">
                       <span className="cardTitle">📊 Web Sitesi Sağlık Raporu</span>
                       <span className={`auditScoreBadge ${scoreClass}`}>{score}/100</span>
                     </div>
                     <div className="cardBody">
                        <div className="auditScoreBar"><div className="auditScoreTrack"><div className={`auditScoreFill ${scoreClass}`} style={{ width: `${score}%` }} /></div></div>
                        <div style={{ marginTop: 16 }}>
                          {audit.actionPlan && (audit.actionPlan as string[]).length > 0 && (
                            <div className="actionPlanSection">
                              <div className="actionPlanTitle">📋 Önerilen Acil Aksiyon Planı</div>
                              {(audit.actionPlan as string[]).map((item, i) => (
                                <div key={i} className="actionItem"><span className="actionCheckbox">☐</span><span>{item}</span></div>
                              ))}
                            </div>
                          )}
                        </div>
                     </div>
                   </div>
                 );
              })() : (
                 <div className="card"><div className="cardBody" style={{ textAlign: 'center', padding: 40 }}><span className="spinner" style={{ width: 24, height: 24, marginBottom: 16 }} /><div>Analiz devam ediyor veya henüz başlamadı...</div></div></div>
              )}
           </div>
         )}

         {/* Step 3: KB Review */}
         {displayStep === 2 && (
           <div className="stepContent">
             {project?.knowledgeBase ? (
               <div className="card">
                 <div className="cardHeader">
                   <span className="cardTitle">📜 Kural Anayasası Onayı</span>
                   <span className={`kbStatusBadge ${project.knowledgeBase.status === 'DRAFT' ? 'kbDraft' : 'kbApproved'}`}>{project.knowledgeBase.status}</span>
                 </div>
                 <div className="cardBody">
                    {project.knowledgeBase.rules && project.knowledgeBase.rules.length > 0 && (
                      <div style={{ marginBottom: 24 }}>
                        <h4 style={{ margin: '0 0 12px 0' }}>İçerik Kalite Kuralları</h4>
                        {project.knowledgeBase.rules.map(rule => (
                          <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 12, background: 'var(--surface-50)', marginBottom: 8, borderRadius: 6, opacity: rule.isActive ? 1 : 0.5 }}>
                            <div>
                              <div style={{ fontWeight: 500, fontSize: 13 }}>{rule.value}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{rule.type} • {rule.reason}</div>
                            </div>
                            <button className="btn btnOutline btnMini" onClick={() => handleToggleRule(rule.id, rule.isActive)} disabled={project.knowledgeBase!.status === 'APPROVED'}>
                              {rule.isActive ? 'Kapat' : 'Aç'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {project.knowledgeBase.status === 'DRAFT' ? (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
                        <button className="btn btnPrimary" onClick={handleApproveKB} disabled={loading !== null}>
                          {loading === 'approveKB' ? <span className="spinner" /> : '🔒 Anayasayı Onayla ve Strateji Üret'}
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
                        <button className="btn btnPrimary" onClick={handleGenerateStrategy} disabled={loading !== null}>
                          {loading === 'generateStrategy' ? <span className="spinner" /> : '🎯 Strateji & İçerik Planı Üret'}
                        </button>
                      </div>
                    )}
                 </div>
               </div>
             ) : (
               <div className="card"><div className="cardBody">Anayasa henüz türetilmedi.</div></div>
             )}
           </div>
         )}

         {/* Step 4: Strategy */}
         {displayStep === 3 && (
           <div className="stepContent">
              {strategy ? (
                 <div className="card">
                   <div className="cardHeader"><span className="cardTitle">🧠 Birleşik İçerik Stratejisi</span></div>
                   <div className="cardBody">
                     <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>{strategy.summary}</p>
                     
                     <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                        <button className="btn btnOutline" onClick={handleGapAnalysis} disabled={loading !== null || !project?.contentPlan}>
                          {loading === 'gapAnalysis' ? <span className="spinner" /> : '🕵️ Gap Analizi Çalıştır'}
                        </button>
                     </div>

                     {project?.contentPlan?.suggestedGaps && project.contentPlan.suggestedGaps.length > 0 && (
                        <div style={{ marginTop: 24, padding: 16, background: 'rgba(52, 211, 153, 0.1)', borderRadius: 8 }}>
                          <h4 style={{ margin: '0 0 12px 0', color: '#34d399' }}>🎯 Gap Fırsatları (Onay Bekliyor)</h4>
                          {project.contentPlan.suggestedGaps.map((gap: any, index: number) => (
                             <div key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: 12, background: 'rgba(15, 23, 42, 0.5)', marginBottom: 8, borderRadius: 6 }}>
                               <div>
                                 <div style={{ fontWeight: 500, color: '#f8fafc' }}>{gap.title}</div>
                                 <div style={{ fontSize: 12, color: '#94a3b8' }}>Odak: {gap.focusKeyword}</div>
                               </div>
                               <button className="btn btnPrimary btnMini" onClick={() => handleApproveGap(gap)}>+ Plana Ekle</button>
                             </div>
                          ))}
                        </div>
                     )}
                   </div>
                 </div>
              ) : (
                 <div className="card"><div className="cardBody">Strateji henüz üretilmedi.</div></div>
              )}
           </div>
         )}

         {/* Step 5: Production */}
         {displayStep === 4 && (
           <div className="stepContent">
             <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
               {/* Left: Articles List */}
               <div style={{ flex: '0 0 300px' }}>
                 <div className="card">
                   <div className="cardHeader"><span className="cardTitle">Makaleler</span></div>
                   <div className="cardBody" style={{ padding: 0 }}>
                     {articles.map((art: any) => (
                       <div key={art.id} onClick={() => selectArticle(art.id)} style={{ padding: 16, cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', background: art.id === selectedArticleId ? 'var(--surface-100)' : 'transparent' }}>
                         <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>{art.title}</div>
                         <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                           <span>{art.state === 'PREVIEW_READY' ? 'Tamamlandı' : 'Bekliyor'}</span>
                           <span>{art.wordCount} kelime</span>
                         </div>
                       </div>
                     ))}
                     {articles.length === 0 && (
                       <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>Henüz makale yok.</div>
                     )}
                   </div>
                 </div>
               </div>

               {/* Right: Active Article Pipeline & Quality Gate */}
               <div style={{ flex: 1 }}>
                 {hasArticle ? (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                     <div className="card">
                       <div className="cardHeader" style={{ justifyContent: 'space-between' }}>
                         <span className="cardTitle">{activeArticle.title} Pipeline</span>
                         <div style={{ display: 'flex', gap: 8 }}>
                           <button className="btn btnPrimary btnMini" onClick={() => triggerNext(false)} disabled={loading !== null || isDone}>Sıradaki Bölüm</button>
                           <button className="btn btnSuccess btnMini" onClick={handleTriggerAll} disabled={loading !== null || isDone}>Tümünü Yaz</button>
                         </div>
                       </div>
                       <div className="cardBody">
                         {(activeArticle.articlePlan?.outline as any[])?.map((item, index) => {
                           const stepStatus = getStepStatus(index);
                           const section = activeArticle.sections?.find((s) => s.order === index + 1);
                           return (
                             <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                               <div style={{ fontSize: 16, width: 24, textAlign: 'center' }}>
                                 {stepStatus === 'complete' ? '✅' : stepStatus === 'active' ? '✍️' : '⏳'}
                               </div>
                               <div style={{ flex: 1 }}>
                                 <div style={{ fontWeight: 500, fontSize: 14 }}>{item.title}</div>
                                 <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                   {stepStatus === 'complete' ? `${section?.wordCount} kelime` : stepStatus === 'active' ? 'Yazılıyor...' : 'Bekliyor'}
                                 </div>
                               </div>
                               {stepStatus === 'complete' && section && !isWriting && (
                                 <button className="btn btnOutline btnMini" onClick={() => setRewriteSectionId(rewriteSectionId === section.id ? null : section.id)}>
                                   🔄 Düzelt
                                 </button>
                               )}
                             </div>
                           );
                         })}
                         
                         {/* Rewrite Box */}
                         {rewriteSectionId && (
                           <div style={{ marginTop: 16, padding: 16, background: 'var(--surface-50)', borderRadius: 8 }}>
                             <textarea className="formInput" rows={2} placeholder="Neyi değiştirmek istersiniz?" value={rewriteFeedback} onChange={e => setRewriteFeedback(e.target.value)} />
                             <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                               <button className="btn btnOutline btnMini" onClick={() => setRewriteSectionId(null)}>İptal</button>
                               <button className="btn btnPrimary btnMini" onClick={handleRewriteSubmit}>Gönder</button>
                             </div>
                           </div>
                         )}
                       </div>
                     </div>

                     {/* Quality Gate UI */}
                     {activeArticle.qualityGate && (
                        <div className="card" style={{ border: `1px solid ${activeArticle.qualityGate.passed ? 'var(--accent-emerald)' : 'var(--accent-rose)'}` }}>
                           <div className="cardHeader" style={{ background: activeArticle.qualityGate.passed ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)' }}>
                             <span className="cardTitle" style={{ color: activeArticle.qualityGate.passed ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                               {activeArticle.qualityGate.passed ? '✅ Quality Gate: Geçti' : '❌ Quality Gate: İhlaller Var'}
                             </span>
                             <span style={{ fontWeight: 600 }}>{activeArticle.qualityGate.score}/100</span>
                           </div>
                           <div className="cardBody">
                              <div style={{ display: 'flex', gap: 24, fontSize: 13, marginBottom: 16 }}>
                                <div><strong>Kelime:</strong> {activeArticle.qualityGate.metrics?.wordCount}</div>
                                <div><strong>Density:</strong> %{activeArticle.qualityGate.metrics?.keywordDensity}</div>
                              </div>
                              {activeArticle.qualityGate.failures?.length > 0 && (
                                <div style={{ background: 'rgba(239,68,68,0.1)', padding: 12, borderRadius: 6 }}>
                                  <div style={{ fontWeight: 600, color: 'var(--accent-rose)', marginBottom: 8 }}>Tespit Edilen İhlaller:</div>
                                  <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--accent-rose)', fontSize: 13 }}>
                                    {activeArticle.qualityGate.failures.map((f: string, i: number) => <li key={i}>{f}</li>)}
                                  </ul>
                                  {/* Auto Rewrite Action for Quality Gate */}
                                  <button className="btn btnPrimary btnMini" style={{ marginTop: 12, background: 'var(--accent-rose)', color: 'white', border: 'none' }} onClick={() => {
                                      setRewriteSectionId(activeArticle.sections?.[0]?.id || null);
                                      setRewriteFeedback('Quality gate hatalarını gider: ' + activeArticle.qualityGate.failures.join(', '));
                                  }}>
                                    🔄 İhlalleri Gider (Yeniden Yaz)
                                  </button>
                                </div>
                              )}
                           </div>
                        </div>
                     )}
                   </div>
                 ) : (
                   <div className="card"><div className="cardBody" style={{ textAlign: 'center', padding: 40 }}>Sol taraftan bir makale seçin.</div></div>
                 )}
               </div>
             </div>
           </div>
         )}
         
         {/* Collapsible Log Panel at bottom */}
         <details style={{ marginTop: 40, background: 'var(--surface-50)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
           <summary style={{ padding: 16, cursor: 'pointer', fontWeight: 500, userSelect: 'none' }}>📜 Detaylı İşlem Logları</summary>
           <div className="logContainer" ref={logContainerRef} style={{ padding: 16, maxHeight: 300, overflowY: 'auto', borderTop: '1px solid var(--border-subtle)' }}>
             {logs.length === 0 ? <div style={{color: 'var(--text-muted)'}}>Log yok.</div> : logs.map((log, i) => (
                <div key={i} className={`logEntry ${log.type === 'success' ? 'logSuccess' : log.type === 'error' ? 'logError' : 'logInfo'}`}>
                  <span className="logTime">{log.time}</span><span>{log.message}</span>
                </div>
             ))}
           </div>
         </details>
      </div>
    </div>
  );
}
