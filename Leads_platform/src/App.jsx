import { useState, useEffect, useCallback } from 'react'
import { Zap } from 'lucide-react'
import Sidebar from './components/Sidebar'
import MobileNav from './components/MobileNav'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import Agents from './pages/Agents'
import Settings from './pages/Settings'
import { mockLeads, mockChannels } from './data/mockData'
import { api } from './api'

const API_BASE = import.meta.env.PROD ? '' : '/api'

async function agentsApi(method, path) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { method, signal: AbortSignal.timeout(15000) })
    return res.ok ? res.json() : null
  } catch {
    return null
  }
}

export default function App() {
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentToggling, setAgentToggling] = useState(false)
  const [leads, setLeads] = useState([])
  const [channels, setChannels] = useState(mockChannels)
  const [expandedChannels, setExpandedChannels] = useState(true)
  const [isLive, setIsLive] = useState(false)
  const [loading, setLoading] = useState(true)

  const [uptimeSec, setUptimeSec] = useState(null)

  // agentRunning reflects the REAL backend parsers, not just local UI state
  useEffect(() => {
    const check = async () => {
      const st = await agentsApi('GET', '/agents/status')
      if (st) {
        setAgentRunning(st.any_running)
        setUptimeSec(st.uptime_seconds ?? null)
      }
    }
    check()
    const iv = setInterval(check, 5000)
    return () => clearInterval(iv)
  }, [])

  const fmtUptime = (s) => {
    if (s == null) return ''
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} мин`
    if (s < 86400) return `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин`
    return `${Math.floor(s / 86400)} д ${Math.floor((s % 86400) / 3600)} ч`
  }

  const toggleAgents = async () => {
    if (agentToggling) return
    setAgentToggling(true)
    if (agentRunning) {
      const res = await agentsApi('POST', '/agents/stop-all')
      if (res?.ok) setAgentRunning(false)
    } else {
      const res = await agentsApi('POST', '/agents/start-all')
      if (res?.ok) {
        setAgentRunning(true)
        const problems = Object.values(res.results || {}).filter(m => m && !m.includes('запущен'))
        if (problems.length) console.info('Agents start:', res.results)
      }
    }
    setAgentToggling(false)
  }

  const loadLeads = useCallback(async () => {
    try {
      const live = await api.ping()
      if (live) {
        const data = await api.getLeads({ limit: 200 })
        setLeads(data)
        setIsLive(true)
      } else {
        setLeads(mockLeads)
        setIsLive(false)
      }
    } catch {
      setLeads(mockLeads)
      setIsLive(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLeads()
    // Retry every 10s until connected
    const iv = setInterval(async () => {
      if (isLive) return
      const live = await api.ping()
      if (live) {
        setLoading(true)
        await loadLeads()
      }
    }, 10000)
    return () => clearInterval(iv)
  }, [loadLeads, isLive])

  const hotCount = leads.filter(l => l.isHot).length
  const newCount = leads.filter(l => l.status === 'found' || l.status === 'messaged').length
  const repliedCount = leads.filter(l => l.status === 'replied' || l.status === 'interested').length
  const convertedCount = leads.filter(l => l.status === 'converted').length
  const conversionRate = leads.length > 0 ? Math.round((convertedCount / leads.length) * 100) : 0

  const updateLeadStatus = async (id, status) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status, updatedAt: new Date().toISOString() } : l))
    if (isLive) {
      try { await api.updateLead(id, { status }) } catch {}
    }
  }

  const updateLeadNotes = async (id, notes) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, notes } : l))
    if (isLive) {
      try { await api.updateLead(id, { notes }) } catch {}
    }
  }

  const deleteLead = async (id) => {
    setLeads(prev => prev.filter(l => l.id !== id))
    if (isLive) {
      try { await api.deleteLead(id) } catch {}
    }
  }

  const updateChannel = (key, updates) => {
    setChannels(prev => ({ ...prev, [key]: { ...prev[key], ...updates } }))
  }

  return (
    <div className="flex h-screen overflow-hidden bg-main">
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        channels={channels}
        expandedChannels={expandedChannels}
        onToggleChannels={() => setExpandedChannels(v => !v)}
        leadsTotal={leads.length}
        hotCount={hotCount}
        agentRunning={agentRunning}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header — phones only */}
        <div
          className="md:hidden flex items-center justify-between px-4 py-2.5"
          style={{ background: '#111412', borderBottom: '1px solid #1e211e' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #7A8B69 0%, #4d5e40 100%)' }}>
              <Zap size={14} className="text-white" />
            </div>
            <span className="text-text-p font-semibold text-sm">BaiTech Lead Hub</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${agentRunning ? 'bg-accent pulse-dot' : 'bg-text-m'}`} />
            <span className={`text-[10px] ${agentRunning ? 'text-accent' : 'text-text-m'}`}>
              {agentRunning ? 'Агенты работают' : 'Остановлены'}
            </span>
          </div>
        </div>

        {/* Status Banner */}
        <div
          className="flex items-center justify-center gap-2 py-1.5 text-xs font-medium"
          style={{ background: 'rgba(212, 198, 185, 0.06)', borderBottom: '1px solid rgba(212,198,185,0.08)' }}
        >
          {loading ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-text-m pulse-dot" />
              <span className="text-beige/50">Подключение к базе данных...</span>
            </>
          ) : isLive ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ boxShadow: '0 0 6px #7A8B69' }} />
              <span className="text-accent/80">
                LIVE — данные из Supabase · бэкенд активен
                {uptimeSec != null && ` · сервер онлайн ${fmtUptime(uptimeSec)} без перерыва`}
              </span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 pulse-dot" />
              <span className="text-beige/70">DEMO MODE — бэкенд недоступен</span>
              <button
                onClick={() => { setLoading(true); loadLeads() }}
                className="ml-2 text-[10px] px-2 py-0.5 rounded text-beige/60 hover:text-beige transition-colors"
                style={{ background: 'rgba(212,198,185,0.08)', border: '1px solid rgba(212,198,185,0.15)' }}
              >
                Переподключить
              </button>
            </>
          )}
        </div>

        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {currentPage === 'dashboard' && (
            <Dashboard
              leads={leads}
              channels={channels}
              agentRunning={agentRunning}
              onToggleAgent={toggleAgents}
              newCount={newCount}
              repliedCount={repliedCount}
              hotCount={hotCount}
              conversionRate={conversionRate}
              onNavigate={setCurrentPage}
            />
          )}
          {currentPage === 'leads' && (
            <Leads
              leads={leads}
              onUpdateStatus={updateLeadStatus}
              onUpdateNotes={updateLeadNotes}
              onDeleteLead={deleteLead}
              isLive={isLive}
              onLoadMessages={isLive ? api.getMessages : null}
            />
          )}
          {currentPage === 'agents' && (
            <Agents channels={channels} onUpdateChannel={updateChannel} />
          )}
          {currentPage === 'settings' && (
            <Settings channels={channels} onUpdateChannel={updateChannel} />
          )}
        </main>
      </div>

      <MobileNav currentPage={currentPage} onNavigate={setCurrentPage} leadsTotal={leads.length} />
    </div>
  )
}
