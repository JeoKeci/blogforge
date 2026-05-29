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

  return (
    <div className="testPanel">
      {/* ─── Header ─── */}
      <header className="header">
        <div className="headerLeft">
          <div className="logo">⚡</div>
          <div>
            <h1 className="headerTitle">BlogForge Test Panel</h1>
            <p className="headerSubtitle">Faz 1.5 — Çoklu Kaynak Analizi & Birleşik Planlayıcı</p>
          </div>
        </div>
        <div className={`headerBadge ${workerOnline ? 'badgeOnline' : 'badgeOffline'}`}>
          <span className="badgeDot" />
          {workerOnline ? 'Celery Worker Aktif' : 'Worker Bekliyor'}
        </div>
      </header>

      {/* ─── Grid ─── */}
      <div className="gridLayout">
        {/* ─── Left: Controls & Context ─── */}
        <div className="controlPanel">
          {/* Actions Card */}
          <div className="card">
            <div className="cardHeader">
              <span className="cardTitle">🎮 Kontrol Merkezi</span>
            </div>
            <div className="cardBody">
              <div className="actionGroup">
                <button
                  className="btn btnDanger"
                  onClick={handleSeed}
                  disabled={loading !== null}
                >
                  {loading === 'seed' ? <span className="spinner" /> : <span className="btnIcon">🗑️</span>}
                  Seed & Sıfırla
                </button>

                <button
                  className="btn btnPrimary"
                  onClick={handleAnalyzeSources}
                  disabled={loading !== null || sources.length === 0}
                >
                  {loading === 'analyze' ? <span className="spinner" /> : <span className="btnIcon">🧠</span>}
                  Kaynakları Analiz Et & Planla
                </button>

                <button
                  className="btn btnOutline"
                  onClick={() => fetchStatus()}
                  disabled={loading !== null}
                >
                  <span className="btnIcon">🔄</span>
                  Durumu Yenile
                </button>

                <button
                  className="btn btnPrimary"
                  onClick={handleGenerateStrategy}
                  disabled={loading !== null || project?.knowledgeBase?.status !== 'APPROVED'}
                  style={{
                    marginTop: '8px',
                    width: '100%',
                    opacity: project?.knowledgeBase?.status === 'APPROVED' ? 1 : 0.5
                  }}
                >
                  {loading === 'generateStrategy' ? <span className="spinner" /> : <span className="btnIcon">🎯</span>}
                  {project?.knowledgeBase?.status === 'APPROVED' ? 'Strateji & İçerik Planı Üret (Faz 1.7)' : 'Strateji Üret (Anayasa Onayı Bekleniyor)'}
                </button>
                <button
                  className="btn btnOutline"
                  onClick={handleGapAnalysis}
                  disabled={loading !== null || !project?.contentPlan}
                  style={{ marginTop: '8px', width: '100%' }}
                >
                  {loading === 'gapAnalysis' ? <span className="spinner" /> : <span className="btnIcon">🕵️</span>}
                  Rakipleri Tara ve Gap Analizi Çalıştır
                </button>
              </div>
            </div>
          </div>

          {/* Strategy & Content Plan Tracker */}
          <div className="card">
            <div className="cardHeader">
              <span className="cardTitle">🗺️ Strateji & Üretim Takvimi</span>
              {strategy && <span className="badge badgeSuccess">Plan Devrede</span>}
            </div>

            {project?.contentPlan?.suggestedGaps && project.contentPlan.suggestedGaps.length > 0 && (
              <div style={{ padding: '12px 16px', background: 'rgba(52, 211, 153, 0.1)', borderBottom: '1px solid #334155' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🎯</span> Keşfedilen Kelime Fırsatları (Gap Analizi)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {project.contentPlan.suggestedGaps.map((gap: any, index: number) => (
                    <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(15, 23, 42, 0.5)', padding: '8px 12px', borderRadius: '4px' }}>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: '500', color: '#f8fafc' }}>{gap.title}</div>
                        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                          Odak: <strong style={{ color: '#38bdf8' }}>{gap.focusKeyword}</strong> • Tip: {gap.type === 'new_article' ? 'Yeni Makale' : 'LSI/Alt Başlık'}
                        </div>
                      </div>
                      <button 
                        className="btn btnPrimary btnMini" 
                        onClick={() => handleApproveGap(gap)}
                      >
                        + Plana Ekle
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="cardBody" style={{ padding: 0 }}>
              {/* Content plan tracker items will go here */}
            </div>
          </div>
          {/* Footprint Sources Manager */}
          <div className="card">
            <div className="cardHeader">
              <span className="cardTitle">🌐 Dijital Ayak İzi Kaynakları</span>
              <button 
                className="btn btnOutline btnMini"
                onClick={() => setShowAddForm(!showAddForm)}
              >
                {showAddForm ? 'Kapat' : 'Ekle'}
              </button>
            </div>
            <div className="cardBody">
              {sources.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '10px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  Kayıtlı dijital kaynak bulunamadı. "Seed & Sıfırla" yapabilir veya yeni kaynak ekleyebilirsiniz.
                </div>
              ) : (
                <div className="sourcesList">
                  {sources.map((s) => (
                    <div key={s.id} className="sourceItem">
                      <div className="sourceInfo">
                        <span className="sourceTitle">{s.displayName}</span>
                        <div className="sourceMeta">
                          <span className="sourceTypeBadge">{s.type}</span>
                          <span className="sourceStatus">
                            <span className={`statusDot ${
                              s.status === 'PENDING' ? 'statusDotPending' :
                              s.status === 'FETCHING' ? 'statusDotFetching' :
                              s.status === 'ANALYZED' ? 'statusDotAnalyzed' : 'statusDotFailed'
                            }`} />
                            {s.status === 'PENDING' && 'Bekliyor'}
                            {s.status === 'FETCHING' && 'Kazınıyor'}
                            {s.status === 'ANALYZED' && 'Analiz Edildi'}
                            {s.status === 'FAILED' && 'Hata!'}
                          </span>
                        </div>
                        {s.errorMessage && (
                          <span style={{ fontSize: 10, color: 'var(--accent-rose)', marginTop: 4 }}>
                            {s.errorMessage}
                          </span>
                        )}
                      </div>
                      <div className="sourceActions">
                        <button 
                          className="btn btnOutline btnMini"
                          style={{ padding: '2px 6px', color: 'var(--accent-rose)' }}
                          onClick={() => handleDeleteSource(s.id, s.displayName)}
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Source Form */}
              {showAddForm && (
                <form onSubmit={handleAddSource} className="addSourceForm">
                  <span className="formTitle">Yeni Kaynak Ekle</span>
                  <div className="formGrid">
                    <select 
                      className="formSelect"
                      value={newSourceType}
                      onChange={(e) => setNewSourceType(e.target.value as any)}
                    >
                      <option value="WEBSITE">Web Sitesi</option>
                      <option value="YOUTUBE">YouTube Kanalı</option>
                      <option value="INSTAGRAM">Instagram Sayfası</option>
                      <option value="CUSTOM">Özel Metin / Rehber</option>
                    </select>

                    <input 
                      type="text"
                      className="formInput"
                      placeholder="Görünüm Adı (örn: Kişisel Blog)"
                      value={newSourceDisplayName}
                      onChange={(e) => setNewSourceDisplayName(e.target.value)}
                    />

                    {newSourceType === 'WEBSITE' && (
                      <input 
                        type="text"
                        className="formInput"
                        placeholder="URL (örn: geocenter.com)"
                        required
                        value={newSourceUrl}
                        onChange={(e) => setNewSourceUrl(e.target.value)}
                      />
                    )}

                    {newSourceType === 'YOUTUBE' && (
                      <input 
                        type="text"
                        className="formInput"
                        placeholder="@kullaniciadi veya URL"
                        required
                        value={newSourceIdentifier}
                        onChange={(e) => setNewSourceIdentifier(e.target.value)}
                      />
                    )}

                    {newSourceType === 'INSTAGRAM' && (
                      <>
                        <input 
                          type="text"
                          className="formInput"
                          placeholder="Instagram Kullanıcı Adı"
                          required
                          value={newSourceIdentifier}
                          onChange={(e) => setNewSourceIdentifier(e.target.value)}
                        />
                        <textarea 
                          className="formInput"
                          placeholder="Instagram Bio ve son gönderileri buraya yapıştırın (Otomatik çekim limitli olduğu için)"
                          rows={3}
                          value={newSourceTextContent}
                          onChange={(e) => setNewSourceTextContent(e.target.value)}
                        />
                      </>
                    )}

                    {newSourceType === 'CUSTOM' && (
                      <textarea 
                        className="formInput"
                        placeholder="Marka hedefleri, tone of voice kuralları vb."
                        required
                        rows={4}
                        value={newSourceTextContent}
                        onChange={(e) => setNewSourceTextContent(e.target.value)}
                      />
                    )}

                    <button 
                      type="submit" 
                      className="btn btnPrimary btnMini"
                      disabled={loading === 'addSource'}
                    >
                      {loading === 'addSource' ? 'Ekleniyor...' : 'Kaydet'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* ─── Audit Report Card ─── */}
          {project?.siteAudit?.auditMatrix ? (() => {
            const audit = project.siteAudit!;
            const matrix = audit.auditMatrix!;
            const score = matrix.totalScore;
            const scoreClass = score >= 70 ? 'scoreHigh' : score >= 40 ? 'scoreMedium' : 'scoreLow';

            const columns: { key: keyof typeof matrix.breakdown; label: string; maxScore: number; icon: string }[] = [
              { key: 'metadata', label: 'Metadata & SEO Sağlığı', maxScore: 20, icon: '🏷️' },
              { key: 'hierarchy', label: 'Semantik Hiyerarşi', maxScore: 25, icon: '🏗️' },
              { key: 'depth', label: 'İçerik Derinliği & Bilgi Kazancı', maxScore: 30, icon: '📚' },
              { key: 'geoEntity', label: 'Varlık & GEO Hazırlığı', maxScore: 25, icon: '🌍' },
            ];

            return (
              <div className="card auditCard">
                <div className="cardHeader">
                  <span className="cardTitle">📊 Web Sitesi Sağlık Raporu</span>
                  <span className={`auditScoreBadge ${scoreClass}`}>
                    {score}/100
                  </span>
                </div>
                <div className="cardBody">
                  {/* Score bar visualization */}
                  <div className="auditScoreBar">
                    <div className="auditScoreTrack">
                      <div
                        className={`auditScoreFill ${scoreClass}`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                  </div>

                  {/* 4-column breakdown */}
                  {columns.map((col) => {
                    const item = matrix.breakdown[col.key];
                    return (
                      <div key={col.key} className="auditSectionRow">
                        <div className="auditSectionHeader">
                          <span>{col.icon} {col.label}</span>
                          <span className="auditSectionPoints">{item.score}/{col.maxScore}</span>
                        </div>
                        {item.good && (
                          <div className="auditBullet">
                            <span className="bulletGood">🟢</span>
                            <span className="bulletGood">{item.good}</span>
                          </div>
                        )}
                        {item.bad && (
                          <div className="auditBullet">
                            <span className="bulletBad">🔴</span>
                            <span className="bulletBad">{item.bad}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Action Plan */}
                  {audit.actionPlan && audit.actionPlan.length > 0 && (
                    <div className="actionPlanSection">
                      <div className="actionPlanTitle">📋 Önerilen Acil Aksiyon Planı</div>
                      {(audit.actionPlan as string[]).map((item, i) => (
                        <div key={i} className="actionItem">
                          <span className="actionCheckbox">☐</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })() : project && (
            <div className="card">
              <div className="cardHeader">
                <span className="cardTitle">📊 Web Sitesi Sağlık Raporu</span>
              </div>
              <div className="cardBody">
                <div className="auditPending">
                  <span className="auditPendingIcon">⏳</span>
                  <span>Analiz bekleniyor. Kaynakları analiz ettikten sonra sağlık raporu burada görünecektir.</span>
                </div>
              </div>
            </div>
          )}

          {/* ─── Knowledge Base (Constitution) Card ─── */}
          {project?.knowledgeBase && (
            <div className="card">
              <div className="cardHeader">
                <span className="cardTitle">📜 Kural Anayasası & Bilgi Tabanı</span>
                <span className={`kbStatusBadge ${project.knowledgeBase.status === 'DRAFT' ? 'kbDraft' : 'kbApproved'}`}>
                  {project.knowledgeBase.status}
                </span>
              </div>
              <div className="cardBody">
                {/* Verified Facts */}
                {project.knowledgeBase.verifiedFacts && project.knowledgeBase.verifiedFacts.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Doğrulanmış Teknik Veriler (Facts)</div>
                    <div className="kbTagGrid">
                      {(project.knowledgeBase.verifiedFacts as any[]).map((fact, idx) => (
                        <span key={idx} className="kbTag">
                          <span className="kbTagKey">{fact.key}:</span> {fact.value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Brand Entities */}
                {project.knowledgeBase.brandEntities && project.knowledgeBase.brandEntities.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Marka Varlıkları (Sertifika, Kurum vb.)</div>
                    <div className="kbTagGrid">
                      {(project.knowledgeBase.brandEntities as any[]).map((entity, idx) => (
                        <span key={idx} className="kbTag">
                          <span className="kbTagKey">{entity.category}:</span> {entity.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content Rules */}
                {project.knowledgeBase.rules && project.knowledgeBase.rules.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>İçerik Kalite Kuralları (Content Rules)</div>
                    <div>
                      {project.knowledgeBase.rules.map(rule => (
                        <div key={rule.id} className="ruleCardRow" style={{ opacity: rule.isActive ? 1 : 0.4 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                              <span className={`ruleTypeBadge ${
                                rule.type === 'FORBIDDEN_PHRASE' ? 'typeForbidden' :
                                rule.type === 'FACT_CORRECTION' ? 'typeFact' :
                                rule.type === 'REQUIRED' ? 'typeRequired' : ''
                              }`}>
                                {rule.type}
                              </span>
                            </div>
                            <div style={{ fontSize: 13, textDecoration: rule.isActive ? 'none' : 'line-through', color: 'var(--text-primary)' }}>
                              {rule.value}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                              <strong>Neden:</strong> {rule.reason}
                            </div>
                          </div>
                          <div>
                            <button
                              className="ruleToggleButton"
                              onClick={() => handleToggleRule(rule.id, rule.isActive)}
                              disabled={project.knowledgeBase!.status === 'APPROVED'}
                            >
                              {rule.isActive ? 'Pasife Al' : 'Aktifleştir'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Writing Instructions */}
                {project.knowledgeBase.writingInstructions && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', padding: 8, borderRadius: 4, marginBottom: 12 }}>
                    <strong>Genel Talimatlar:</strong> {JSON.stringify(project.knowledgeBase.writingInstructions)}
                  </div>
                )}

                {/* Action Buttons */}
                {project.knowledgeBase.status === 'DRAFT' && (
                  <div style={{ marginTop: 16 }}>
                    <button
                      className="btn btnPrimary"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={handleApproveKB}
                      disabled={loading === 'approveKB'}
                    >
                      {loading === 'approveKB' ? <span className="spinner" /> : '🔒 Anayasayı Onayla ve Kilitle'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Unified Strategy Card */}
          {strategy && (
            <div className="card strategyCard">
              <div className="cardHeader">
                <span className="cardTitle">🧠 Birleşik İçerik Stratejisi</span>
                <span className="stateBadge stateOutline" style={{ fontSize: 9 }}>
                  v{strategy.version}
                </span>
              </div>
              <div className="cardBody">
                <p className="strategySummary">{strategy.summary}</p>
                <div className="strategyGrid">
                  <div className="strategyMetric">
                    <span className="metricTitle">Kategoriler</span>
                    <div className="pillContainer">
                      {(strategy.contentPillars || []).map((p, i) => (
                        <span key={i} className="strategyPill">{p}</span>
                      ))}
                    </div>
                  </div>
                  <div className="strategyMetric">
                    <span className="metricTitle">Hedef Kitle</span>
                    <div className="metricValue" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {(strategy.geoTargets || []).join(', ')} odaklı kitle
                    </div>
                  </div>
                </div>

                <div className="strategyMetric">
                  <span className="metricTitle">Anahtar Kelimeler (Clusters)</span>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(strategy.targetKeywords as any[] || []).slice(0, 3).map((item, i) => (
                      <div key={i} style={{ fontSize: 11 }}>
                        <strong style={{ color: 'var(--accent-indigo)' }}>{item.cluster}:</strong>{' '}
                        <span style={{ color: 'var(--text-secondary)' }}>{(item.keywords || []).join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Content Plan / Generated Articles list */}
          {articles.length > 0 && (
            <div className="card">
              <div className="cardHeader">
                <span className="cardTitle">📅 İçerik Planı (Makaleler)</span>
              </div>
              <div className="cardBody">
                <div className="articleSelectionList">
                  {articles.map((art: any) => (
                    <div key={art.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <button
                        className={`articleSelectBtn ${art.id === selectedArticleId ? 'articleSelectBtnActive' : ''}`}
                        onClick={() => selectArticle(art.id)}
                      >
                        <div>
                          <div className="articleBtnTitle">{art.title}</div>
                          <div className="articleBtnMeta">
                            Durum: {art.state === 'PREVIEW_READY' ? 'Tamamlandı' : 'Yazım Bekliyor'} | {art.wordCount} kelime
                          </div>
                        </div>
                        {art.progress && (
                          <span className="stateBadge stateOutline" style={{ fontSize: 10 }}>
                            {art.progress.completed} / {art.progress.total}
                          </span>
                        )}
                      </button>

                      {art.outboundLinks && art.outboundLinks.length > 0 && (
                        <div style={{ paddingLeft: '14px', fontSize: '11px', color: 'var(--text-muted)' }}>
                          {art.outboundLinks.map((link: any, idx: number) => (
                            <div key={idx} style={{ marginTop: '2px' }}>
                              🔗 Link verilecek makale: <span style={{color: 'var(--accent-indigo)', fontWeight: '600'}}>{link.targetSlug}</span> (Anchor: &apos;{link.anchorText}&apos;)
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Pipeline Stepper Card (Only for selected active article) */}
          {hasArticle && activeArticle.articlePlan?.outline && (
            <div className="card">
              <div className="cardHeader">
                <span className="cardTitle">📋 Bölüm Pipeline ({activeArticle.title.substring(0, 20)}...)</span>
              </div>
              <div className="cardBody">
                <div className="sectionPipeline">
                  {(activeArticle.articlePlan.outline as any[]).map((item, index) => {
                    const stepStatus = getStepStatus(index);
                    const section = activeArticle.sections?.find((s) => s.order === index + 1);
                    return (
                      <div key={index} className="sectionStep" style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <div className={`stepIndicator ${stepStatus === 'complete' ? 'stepComplete' : stepStatus === 'active' ? 'stepActive' : 'stepPending'}`}>
                            {stepStatus === 'complete' ? '✓' : stepStatus === 'active' ? '⋯' : index + 1}
                          </div>
                          <div className="stepInfo" style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div className="stepTitle">{item.title}</div>
                              <div className="stepMeta">
                                {stepStatus === 'complete' && section
                                  ? `${section.wordCount} kelime`
                                  : stepStatus === 'active'
                                    ? 'Yazılıyor...'
                                    : 'Bekliyor'}
                              </div>
                            </div>
                            {stepStatus === 'complete' && section && !isWriting && (
                              <button 
                                className="btn btnOutline btnMini" 
                                style={{ padding: '4px 8px', fontSize: 11 }}
                                onClick={() => setRewriteSectionId(rewriteSectionId === section.id ? null : section.id)}
                              >
                                🔄 Yeniden Yazdır
                              </button>
                            )}
                          </div>
                        </div>
                        {rewriteSectionId === section?.id && (
                          <div style={{ marginTop: 8, padding: 8, backgroundColor: 'var(--surface-50)', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                            <textarea 
                              className="input" 
                              style={{ width: '100%', minHeight: 60, fontSize: 12, marginBottom: 8 }} 
                              placeholder="Ne değiştirilsin? Örn: Bu paragrafı çok jenerik buldum, Janka değerlerine vurgu yap..."
                              value={rewriteFeedback}
                              onChange={(e) => setRewriteFeedback(e.target.value)}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                              <button className="btn btnOutline btnMini" onClick={() => setRewriteSectionId(null)}>İptal</button>
                              <button className="btn btnPrimary btnMini" onClick={handleRewriteSubmit} disabled={!rewriteFeedback.trim()}>Gönder</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Log Card */}
          <div className="card">
            <div className="cardHeader">
              <span className="cardTitle">📜 İşlem Logları</span>
              <button
                className="btn btnOutline btnMini"
                onClick={() => setLogs([])}
              >
                Temizle
              </button>
            </div>
            <div className="cardBody">
              <div className="logContainer" ref={logContainerRef}>
                {logs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                    Henüz log yok.
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`logEntry ${log.type === 'success' ? 'logSuccess' : log.type === 'error' ? 'logError' : 'logInfo'}`}>
                      <span className="logTime">{log.time}</span>
                      <span>{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ─── Right: Preview & Generation controls ─── */}
        <div className="card previewPanel">
          <div className="cardHeader">
            <span className="cardTitle">👁️ İçerik Önizleme</span>
            {hasArticle && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="btn btnPrimary btnMini"
                  style={{ padding: '6px 12px' }}
                  onClick={() => triggerNext(false)}
                  disabled={loading !== null || isDone}
                >
                  Sıradaki Bölümü Yaz
                </button>
                <button
                  className="btn btnSuccess btnMini"
                  style={{ padding: '6px 12px' }}
                  onClick={handleTriggerAll}
                  disabled={loading !== null || isDone}
                >
                  Tümünü Otomatik Yaz
                </button>
                
                {activeArticle?.state === 'PREVIEW_READY' && (
                  <button
                    className="btn btnPrimary btnMini"
                    style={{ padding: '6px 12px', backgroundColor: 'var(--accent-indigo)' }}
                    onClick={async () => {
                      addLog('⏳ WordPress yayını başlatılıyor...', 'info');
                      try {
                        const res = await fetch('/api/test-panel/publish-wp', {
                          method: 'POST',
                          body: JSON.stringify({ articleId: activeArticle.id })
                        });
                        const data = await res.json();
                        if (data.success) {
                          addLog('✅ ' + data.message, 'success');
                          fetchStatus();
                        } else {
                          addLog('❌ WP Publish Hatası: ' + data.error, 'error');
                        }
                      } catch (err: any) {
                        addLog('❌ WP Publish Exception: ' + err.message, 'error');
                      }
                    }}
                    disabled={loading !== null}
                  >
                    🚀 WordPress'e Taslak Olarak Gönder (Phase 1.8)
                  </button>
                )}
                
                {/* Auto Mode Switch */}
                <button
                  className="btn btnOutline btnMini"
                  style={{ padding: '6px 8px', display: 'flex', gap: 6 }}
                  onClick={() => {
                    setAutoMode(!autoMode);
                    addLog(autoMode ? '⏸️ Otomatik mod kapatıldı.' : '▶️ Otomatik mod açıldı.', 'info');
                  }}
                >
                  <span className={`statusDot ${autoMode ? 'statusDotAnalyzed' : 'statusDotPending'}`} />
                  Oto
                </button>
              </div>
            )}
          </div>
          <div className="cardBody" style={{ opacity: isWriting ? 0.5 : 1, pointerEvents: isWriting ? 'none' : 'auto', transition: 'opacity 0.3s' }}>
            {hasArticle && activeArticle.htmlContent ? (
              <>
                {/* Stats Bar */}
                <div className="statsBar">
                  <div className="stat">
                    <span className="statLabel">Başlık</span>
                    <span className="statValue" style={{ fontSize: 14, fontFamily: 'inherit', color: 'var(--text-primary)' }}>
                      {activeArticle.title}
                    </span>
                  </div>
                  <div className="statDivider" />
                  <div className="stat">
                    <span className="statLabel">Toplam Kelime</span>
                    <span className="statValue">{activeArticle.wordCount.toLocaleString('tr-TR')}</span>
                  </div>
                  <div className="statDivider" />
                  <div className="stat">
                    <span className="statLabel">Durum</span>
                    <span className="statValue" style={{ fontSize: 13, color: isDone ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
                      {isDone ? 'Tamamlandı' : 'Yazım Devam Ediyor'}
                    </span>
                  </div>
                </div>

                {/* Rendered Article HTML */}
                <article
                  className="articleContent"
                  dangerouslySetInnerHTML={{ __html: activeArticle.htmlContent }}
                />

                {/* Phase 1.8 Structured Outputs */}
                {activeArticle.qualityGate && (
                  <div style={{ marginTop: 24, padding: 16, backgroundColor: activeArticle.qualityGate.passed ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)', border: `1px solid ${activeArticle.qualityGate.passed ? 'var(--accent-emerald)' : 'var(--accent-rose)'}`, borderRadius: 8 }}>
                    <h4 style={{ margin: '0 0 12px 0', color: activeArticle.qualityGate.passed ? 'var(--accent-emerald)' : 'var(--accent-rose)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      📊 Kalite Kapısı Denetim Sonuçları (Quality Gate)
                    </h4>
                    <div style={{ fontSize: 13, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <div><strong>Skor:</strong> {activeArticle.qualityGate.score}/100</div>
                      <div><strong>Kelime:</strong> {activeArticle.qualityGate.metrics?.wordCount}</div>
                      <div><strong>Anahtar Kelime Yoğunluğu:</strong> %{activeArticle.qualityGate.metrics?.keywordDensity}</div>
                    </div>
                    {activeArticle.qualityGate.failures && activeArticle.qualityGate.failures.length > 0 && (
                      <div style={{ marginTop: 12, padding: 8, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 4, color: 'var(--accent-rose)', fontSize: 13 }}>
                        <strong>İhlaller:</strong>
                        <ul style={{ margin: '4px 0 0 16px' }}>
                          {activeArticle.qualityGate.failures.map((f: string, i: number) => <li key={i}>{f}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {activeArticle.faq && (
                  <div style={{ marginTop: 24 }}>
                    <h4 style={{ margin: '0 0 12px 0' }}>❓ Sıkça Sorulan Sorular (FAQ)</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {activeArticle.faq.map((item: any, i: number) => (
                        <div key={i} style={{ padding: 12, backgroundColor: 'var(--surface-50)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Q: {item.question}</div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>A: {item.answer}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeArticle.schemaMarkup && (
                  <div style={{ marginTop: 24 }}>
                    <h4 style={{ margin: '0 0 12px 0' }}>🛠️ JSON-LD Schema Markup</h4>
                    <pre style={{ padding: 12, backgroundColor: 'var(--surface-50)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                      {typeof activeArticle.schemaMarkup === 'string' ? activeArticle.schemaMarkup : JSON.stringify(activeArticle.schemaMarkup, null, 2)}
                    </pre>
                  </div>
                )}

                {activeArticle.versions && activeArticle.versions.length > 0 && (
                  <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: 14 }}>📜 Versiyon Geçmişi</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {activeArticle.versions.map((v, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: 'var(--surface-50)', borderRadius: 6, fontSize: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontWeight: 600, color: 'var(--accent-indigo)' }}>v{v.versionNumber}</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{v.changeNote}</span>
                          </div>
                          <div style={{ color: 'var(--text-muted)' }}>
                            {new Date(v.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : hasArticle ? (
              <div className="previewEmpty">
                <div className="previewEmptyIcon">📄</div>
                <div className="previewEmptyTitle">{activeArticle.title}</div>
                <div className="previewEmptyHint">
                  Bu makale henüz yazılmadı. Sağ üstteki "Sıradaki Bölümü Yaz" veya "Tümünü Otomatik Yaz" butonlarına tıklayarak yazımı başlatın.
                </div>
              </div>
            ) : (
              <div className="previewEmpty">
                <div className="previewEmptyIcon">📄</div>
                <div className="previewEmptyTitle">Henüz İçerik Seçilmedi</div>
                <div className="previewEmptyHint">
                  Sol panelden "Seed &amp; Sıfırla" butonuna tıklayıp test makalesini yükleyebilir veya marka kaynaklarını analiz edip sıfırdan planlar üretebilirsiniz.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
