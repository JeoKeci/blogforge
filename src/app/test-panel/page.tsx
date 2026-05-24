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

interface Project {
  id: string;
  name: string;
  state: string;
  siteUrl: string;
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
              </div>
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
                  {articles.map((art) => (
                    <button
                      key={art.id}
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
                      <div key={index} className="sectionStep">
                        <div className={`stepIndicator ${stepStatus === 'complete' ? 'stepComplete' : stepStatus === 'active' ? 'stepActive' : 'stepPending'}`}>
                          {stepStatus === 'complete' ? '✓' : stepStatus === 'active' ? '⋯' : index + 1}
                        </div>
                        <div className="stepInfo">
                          <div className="stepTitle">{item.title}</div>
                          <div className="stepMeta">
                            {stepStatus === 'complete' && section
                              ? `${section.wordCount} kelime`
                              : stepStatus === 'active'
                                ? 'Yazılıyor...'
                                : 'Bekliyor'}
                          </div>
                        </div>
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
          <div className="cardBody">
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
