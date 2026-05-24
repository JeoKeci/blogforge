'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import './test-panel.css';

interface Section {
  id: string;
  order: number;
  headingTitle: string;
  wordCount: number;
  htmlContent: string;
  createdAt: string;
}

interface OutlineItem {
  title: string;
  level: number;
}

interface ArticleStatus {
  exists: boolean;
  message?: string;
  article?: {
    id: string;
    title: string;
    state: string;
    wordCount: number;
    htmlContent: string;
    createdAt: string;
    updatedAt: string;
  };
  outline?: OutlineItem[];
  sections?: Section[];
  progress?: {
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
  const [status, setStatus] = useState<ArticleStatus | null>(null);
  const [loading, setLoading] = useState<string | null>(null); // which button is loading
  const [autoMode, setAutoMode] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [polling, setPolling] = useState(false);
  const [workerOnline, setWorkerOnline] = useState(false);
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
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/test-panel/status');
      const data: ArticleStatus = await res.json();
      setStatus(data);

      // Detect worker online from section changes
      if (data.sections && data.sections.length > 0) {
        setWorkerOnline(true);
      }

      return data;
    } catch {
      addLog('Status sorgusu başarısız.', 'error');
      return null;
    }
  }, [addLog]);

  // Initial load
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling when active
  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      const data = await fetchStatus();

      if (data?.article?.state === 'PREVIEW_READY') {
        setPolling(false);
        setLoading(null);
        addLog('✅ Tüm bölümler tamamlandı! Makale PREVIEW_READY durumunda.', 'success');
        return;
      }

      // Auto-mode: detect newly completed section and trigger next
      if (autoModeRef.current && data?.sections && data?.progress) {
        const newCount = data.sections.length;
        if (newCount > prevSectionsCountRef.current && newCount < data.progress.total) {
          prevSectionsCountRef.current = newCount;
          const lastSection = data.sections[data.sections.length - 1];
          addLog(`✅ "${lastSection.headingTitle}" tamamlandı (${lastSection.wordCount} kelime). Sıradaki tetikleniyor...`, 'success');
          // Trigger next
          triggerNext(true);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [polling, fetchStatus, addLog]);

  // ─── Actions ───

  async function handleSeed() {
    setLoading('seed');
    addLog('🔄 Veritabanı sıfırlanıp yeniden seed ediliyor...', 'info');
    try {
      const res = await fetch('/api/test-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed' }),
      });
      const data = await res.json();
      if (data.success) {
        addLog('✅ Test verisi başarıyla oluşturuldu.', 'success');
        prevSectionsCountRef.current = 0;
        await fetchStatus();
      } else {
        addLog(`❌ Seed hatası: ${data.error}`, 'error');
      }
    } catch (e: unknown) {
      addLog(`❌ Seed hatası: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error');
    }
    setLoading(null);
  }

  async function triggerNext(isAutoCall = false) {
    if (!isAutoCall) setLoading('trigger');
    if (!isAutoCall) addLog('🚀 Sıradaki bölüm Celery\'ye gönderiliyor...', 'info');

    try {
      const res = await fetch('/api/test-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_next' }),
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
      addLog(`❌ Tetikleme hatası: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error');
    }
    if (!isAutoCall) setLoading(null);
  }

  async function handleTriggerAll() {
    setAutoMode(true);
    autoModeRef.current = true;
    setLoading('triggerAll');
    addLog('🤖 Otomatik mod aktif — tüm bölümler sırayla yazılacak.', 'info');

    // Get current status to know where we are
    const data = await fetchStatus();
    if (data?.sections) {
      prevSectionsCountRef.current = data.sections.length;
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
    if (!status?.sections) return 'pending';
    const completedCount = status.sections.length;
    if (index < completedCount) return 'complete';
    if (index === completedCount && status.article?.state === 'WRITING') return 'active';
    return 'pending';
  }

  const isWriting = status?.article?.state === 'WRITING' && polling;
  const isDone = status?.article?.state === 'PREVIEW_READY';
  const hasArticle = status?.exists && status.article;

  return (
    <div className="testPanel">
      {/* ─── Header ─── */}
      <header className="header">
        <div className="headerLeft">
          <div className="logo">⚡</div>
          <div>
            <h1 className="headerTitle">BlogForge Test Panel</h1>
            <p className="headerSubtitle">Faz 1 MVP — Geliştirici Test Arayüzü</p>
          </div>
        </div>
        <div className={`headerBadge ${workerOnline ? 'badgeOnline' : 'badgeOffline'}`}>
          <span className="badgeDot" />
          {workerOnline ? 'Celery Worker Aktif' : 'Worker Bekliyor'}
        </div>
      </header>

      {/* ─── Grid ─── */}
      <div className="gridLayout">
        {/* ─── Left: Controls ─── */}
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
                  onClick={() => triggerNext(false)}
                  disabled={loading !== null || !hasArticle || isDone}
                >
                  {loading === 'trigger' ? <span className="spinner" /> : <span className="btnIcon">⏭️</span>}
                  Sıradaki Bölümü Yaz
                </button>

                <button
                  className="btn btnSuccess"
                  onClick={handleTriggerAll}
                  disabled={loading !== null || !hasArticle || isDone}
                >
                  {loading === 'triggerAll' ? <span className="spinner" /> : <span className="btnIcon">🚀</span>}
                  Tümünü Otomatik Yaz
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

              {/* Auto Mode Toggle */}
              <button
                className="autoModeToggle"
                onClick={() => {
                  setAutoMode(!autoMode);
                  addLog(autoMode ? '⏸️ Otomatik mod devre dışı.' : '▶️ Otomatik mod aktif.', 'info');
                }}
                style={{ marginTop: 12 }}
              >
                <div className={`toggleSwitch ${autoMode ? 'toggleSwitchActive' : ''}`}>
                  <div className={`toggleKnob ${autoMode ? 'toggleKnobActive' : ''}`} />
                </div>
                <div>
                  <div className="toggleLabel">Otomatik Mod</div>
                  <div className="toggleHint">Bölüm bitince sonrakini otomatik tetikle</div>
                </div>
              </button>
            </div>
          </div>

          {/* Article Status Card */}
          <div className="card">
            <div className="cardHeader">
              <span className="cardTitle">📊 Makale Durumu</span>
              {isWriting && <span className="spinner" style={{ color: 'var(--accent-amber)' }} />}
            </div>
            <div className="cardBody">
              {hasArticle ? (
                <div className="statusBox">
                  <div className="statusRow">
                    <span className="statusLabel">Durum</span>
                    {getStateBadge(status.article!.state)}
                  </div>
                  <div className="statusRow">
                    <span className="statusLabel">Toplam Kelime</span>
                    <span className="statusValue">{status.article!.wordCount.toLocaleString('tr-TR')}</span>
                  </div>
                  <div className="statusRow">
                    <span className="statusLabel">Bölümler</span>
                    <span className="statusValue">{status.progress!.completed} / {status.progress!.total}</span>
                  </div>

                  {/* Progress Bar */}
                  <div className="progressContainer">
                    <div className="progressHeader">
                      <span className="progressLabel">İlerleme</span>
                      <span className="progressPercent">{status.progress!.percentage}%</span>
                    </div>
                    <div className="progressTrack">
                      <div
                        className="progressFill"
                        style={{ width: `${status.progress!.percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  Henüz makale yok. &quot;Seed &amp; Sıfırla&quot; butonuna tıklayın.
                </div>
              )}
            </div>
          </div>

          {/* Pipeline Stepper Card */}
          {hasArticle && status.outline && (
            <div className="card">
              <div className="cardHeader">
                <span className="cardTitle">📋 Bölüm Pipeline</span>
              </div>
              <div className="cardBody">
                <div className="sectionPipeline">
                  {status.outline.map((item, index) => {
                    const stepStatus = getStepStatus(index);
                    const section = status.sections?.find((s) => s.order === index + 1);
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
                className="btn btnOutline"
                style={{ padding: '4px 10px', fontSize: 11 }}
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

        {/* ─── Right: Content Preview ─── */}
        <div className="card previewPanel">
          <div className="cardHeader">
            <span className="cardTitle">👁️ İçerik Önizleme</span>
            {hasArticle && status.article!.wordCount > 0 && (
              <span className="stateBadge statePreviewReady" style={{ fontSize: 11 }}>
                {status.article!.wordCount.toLocaleString('tr-TR')} kelime
              </span>
            )}
          </div>
          <div className="cardBody">
            {hasArticle && status.article!.htmlContent ? (
              <>
                {/* Stats Bar */}
                <div className="statsBar">
                  <div className="stat">
                    <span className="statLabel">Toplam Kelime</span>
                    <span className="statValue">{status.article!.wordCount.toLocaleString('tr-TR')}</span>
                  </div>
                  <div className="statDivider" />
                  <div className="stat">
                    <span className="statLabel">Bölüm Sayısı</span>
                    <span className="statValue">{status.sections?.length || 0}</span>
                  </div>
                  <div className="statDivider" />
                  <div className="stat">
                    <span className="statLabel">Durum</span>
                    <span className="statValue" style={{ fontSize: 14, color: isDone ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
                      {isDone ? 'Tamamlandı' : 'Devam Ediyor'}
                    </span>
                  </div>
                </div>

                {/* Rendered Article HTML */}
                <article
                  className="articleContent"
                  dangerouslySetInnerHTML={{ __html: status.article!.htmlContent }}
                />
              </>
            ) : (
              <div className="previewEmpty">
                <div className="previewEmptyIcon">📄</div>
                <div className="previewEmptyTitle">Henüz İçerik Yok</div>
                <div className="previewEmptyHint">
                  Sol panelden &quot;Seed &amp; Sıfırla&quot; yapıp ardından &quot;Sıradaki Bölümü Yaz&quot; veya &quot;Tümünü Otomatik Yaz&quot; butonlarına tıklayın.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
