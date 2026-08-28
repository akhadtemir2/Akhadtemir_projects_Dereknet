import { useState, useEffect } from 'react'
import { Search, X, MessageCircle, MapPin, Send, Camera, CheckCircle, UserCheck, ChevronRight, Clock, Phone, Globe, Trash2 } from 'lucide-react'

const channelMeta = {
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle size={13} className="text-emerald-400" /> },
  '2gis': { label: '2GIS', icon: <MapPin size={13} className="text-blue-400" /> },
  telegram: { label: 'Telegram', icon: <Send size={13} className="text-sky-400" /> },
  instagram: { label: 'Instagram', icon: <Camera size={13} className="text-pink-400" /> },
}

// Unknown channel must not crash the whole CRM page
const fallbackChannel = { label: '—', icon: <Globe size={13} className="text-text-m" /> }

const statusLabel = {
  found: 'Найден',
  messaged: 'Написан',
  replied: 'Ответил',
  interested: 'Заинтересован',
  converted: 'Клиент',
}

const statusColor = {
  found: 'text-text-m bg-sidebar-hover',
  messaged: 'text-blue-300 bg-blue-900/20',
  replied: 'text-accent bg-accent/10',
  interested: 'text-yellow-300 bg-yellow-900/20',
  converted: 'text-emerald-300 bg-emerald-900/20',
}

const funnelSteps = ['found', 'messaged', 'replied', 'interested', 'converted']

const API = import.meta.env.PROD ? '' : '/api'

function extractOpener(notes) {
  if (!notes) return ''
  const line = notes.split('\n').find(l => l.startsWith('opener:'))
  return line ? line.slice(7).trim() : ''
}

export default function Leads({ leads, onUpdateStatus, onUpdateNotes, onDeleteLead, isLive, onLoadMessages }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedLead, setSelectedLead] = useState(null)
  const [notesInput, setNotesInput] = useState('')
  const [messages, setMessages] = useState([])
  const [openerText, setOpenerText] = useState('')
  const [dmLoading, setDmLoading] = useState(false)
  const [dmResult, setDmResult] = useState(null) // { ok, msg }

  const filters = [
    { id: 'all', label: 'Все', count: leads.length },
    { id: 'new', label: 'Новые', count: leads.filter(l => l.status === 'found' || l.status === 'messaged').length },
    { id: 'replied', label: 'Ответили', count: leads.filter(l => l.status === 'replied' || l.status === 'interested').length },
    { id: 'hot', label: '🔥 Горячие', count: leads.filter(l => l.isHot).length },
    { id: 'converted', label: 'Клиенты', count: leads.filter(l => l.status === 'converted').length },
  ]

  const filtered = leads.filter(l => {
    if (filter === 'new') return l.status === 'found' || l.status === 'messaged'
    if (filter === 'replied') return l.status === 'replied' || l.status === 'interested'
    if (filter === 'hot') return l.isHot
    if (filter === 'converted') return l.status === 'converted'
    return true
  }).filter(l =>
    !search || l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.businessType.toLowerCase().includes(search.toLowerCase())
  )

  const openLead = async (lead) => {
    setSelectedLead(lead)
    setNotesInput(lead.notes || '')
    setOpenerText(extractOpener(lead.notes))
    setDmResult(null)
    if (onLoadMessages) {
      try {
        const msgs = await onLoadMessages(lead.id)
        setMessages(msgs)
      } catch {
        setMessages(lead.messages || [])
      }
    } else {
      setMessages(lead.messages || [])
    }
  }

  const closeLead = () => { setSelectedLead(null); setMessages([]); setDmResult(null) }

  // Keep the open card in sync — otherwise the funnel/status buttons look dead
  const updateStatus = (id, status) => {
    onUpdateStatus(id, status)
    setSelectedLead(prev => prev && prev.id === id ? { ...prev, status } : prev)
  }

  const sendDm = async () => {
    if (!openerText.trim() || dmLoading) return
    setDmLoading(true)
    setDmResult(null)
    try {
      const r = await fetch(`${API}/leads/${selectedLead.id}/send-dm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: openerText.trim() }),
      })
      const data = await r.json()
      if (r.ok) {
        setDmResult({ ok: true, msg: 'Отправлено!' })
        updateStatus(selectedLead.id, 'messaged')
        setMessages(prev => [...prev, {
          id: Date.now(), direction: 'out', text: openerText.trim(),
          createdAt: new Date().toISOString(), approved: true,
        }])
      } else {
        setDmResult({ ok: false, msg: data.detail || 'Ошибка отправки' })
      }
    } catch {
      setDmResult({ ok: false, msg: 'Нет связи с бэкендом' })
    } finally {
      setDmLoading(false)
    }
  }

  const formatTime = (iso) => {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (iso) => {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now - d
    const diffH = Math.floor(diffMs / 3600000)
    if (diffH < 1) return 'только что'
    if (diffH < 24) return `${diffH} ч назад`
    const diffD = Math.floor(diffH / 24)
    return `${diffD} д назад`
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main table area — on phones it hides entirely while a lead is open */}
      <div className={`flex-col overflow-hidden transition-all duration-300 ${selectedLead ? 'hidden md:flex md:w-[55%]' : 'flex flex-1'}`}>
        <div className="p-4 md:p-8 pb-3 md:pb-4">
          <h1 className="text-xl md:text-2xl font-bold text-text-p tracking-tight">Лиды — CRM</h1>
          <p className="text-text-s text-sm mt-1 hidden sm:block">Управляйте вашей базой потенциальных клиентов.</p>
        </div>

        {/* Filters + search */}
        <div className="px-4 md:px-8 pb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {filters.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                    filter === f.id
                      ? 'bg-accent/15 text-accent border border-accent/25'
                      : 'text-text-s hover:bg-sidebar-hover hover:text-text-p'
                  }`}
                >
                  {f.label}
                  <span className={`text-[10px] px-1 py-0.5 rounded ${filter === f.id ? 'text-accent' : 'text-text-m'}`}>
                    {f.count}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-auto">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-m" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск..."
                className="bg-card border border-border text-text-p text-xs rounded-lg pl-8 pr-3 py-2 w-full sm:w-48 outline-none focus:border-accent/50 placeholder-text-m transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-4 md:px-8">
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #2d302d' }}>
            {/* Header — phones show only name + status */}
            <div className="grid px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-m grid-cols-[1fr_100px_24px] md:grid-cols-[1fr_120px_80px_110px_80px_32px]"
              style={{ background: '#1a1d1a' }}>
              <span>Имя / Бизнес</span>
              <span className="hidden md:block">Тип</span>
              <span className="hidden md:block">Канал</span>
              <span>Статус</span>
              <span className="hidden md:block">Дата</span>
              <span />
            </div>

            {filtered.length === 0 && (
              <div className="py-16 text-center text-text-m text-sm" style={{ background: '#222520' }}>
                Лиды не найдены
              </div>
            )}

            {filtered.map((lead, idx) => {
              const cm = channelMeta[lead.channel] || fallbackChannel
              const isSelected = selectedLead?.id === lead.id
              return (
                <div
                  key={lead.id}
                  onClick={() => isSelected ? closeLead() : openLead(lead)}
                  className={`grid px-4 py-3 cursor-pointer transition-colors items-center grid-cols-[1fr_100px_24px] md:grid-cols-[1fr_120px_80px_110px_80px_32px] ${
                    idx < filtered.length - 1 ? 'border-b border-[#2d302d]' : ''
                  } ${isSelected ? 'bg-accent/5 border-l-2 border-accent' : 'hover:bg-card-hover'}`}
                  style={{ background: isSelected ? undefined : '#222520' }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #7A8B69 0%, #4d5e40 100%)' }}>
                      {lead.avatar}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-p text-sm font-medium truncate">{lead.name}</span>
                        {lead.isHot && <span className="text-xs">🔥</span>}
                      </div>
                      <div className="text-text-m text-xs truncate">
                        <span className="md:hidden">{lead.businessType ? `${lead.businessType} · ` : ''}</span>
                        {lead.city}
                      </div>
                    </div>
                  </div>
                  <span className="hidden md:block text-text-s text-xs truncate">{lead.businessType}</span>
                  <div className="hidden md:flex items-center gap-1.5">
                    {cm.icon}
                    <span className="text-text-m text-xs">{cm.label}</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium w-fit ${statusColor[lead.status]}`}>
                    {statusLabel[lead.status]}
                  </span>
                  <span className="hidden md:block text-text-m text-xs">{formatDate(lead.updatedAt)}</span>
                  <ChevronRight size={13} className={`text-text-m transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Lead detail panel — fullscreen overlay on phones, side panel on desktop */}
      {selectedLead && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto slide-in md:static md:z-auto md:flex-1 md:border-l md:border-[#2d302d]"
          style={{ background: '#1a1d1a' }}
        >
          <div className="p-4 pb-10 md:p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #7A8B69 0%, #4d5e40 100%)' }}>
                  {selectedLead.avatar}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-text-p font-semibold text-base">{selectedLead.name}</span>
                    {selectedLead.isHot && <span>🔥</span>}
                  </div>
                  <div className="text-text-s text-xs">{selectedLead.businessType} · {selectedLead.city}</div>
                </div>
              </div>
              <button
                onClick={closeLead}
                className="text-text-m hover:text-text-s transition-colors p-2 -m-1 rounded-lg"
                style={{ background: '#222520' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Contact info */}
            <div className="flex gap-3 mb-5 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-text-s">
                <Phone size={12} className="text-text-m" /> {selectedLead.phone}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-text-s">
                {channelMeta[selectedLead.channel]?.icon}
                {channelMeta[selectedLead.channel]?.label}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-text-s">
                <Globe size={12} className="text-text-m" />
                {selectedLead.language === 'ru' ? 'Русский' : 'Казахский'}
              </div>
            </div>

            {/* Score */}
            <div className="rounded-xl p-4 mb-5" style={{ background: '#222520', border: '1px solid #2d302d' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-text-s text-xs font-medium">Score лида</span>
                <span className={`font-bold text-base ${selectedLead.score >= 80 ? 'text-hot' : selectedLead.score >= 60 ? 'text-yellow-300' : 'text-text-s'}`}>
                  {selectedLead.score}/100
                </span>
              </div>
              <div className="h-2 rounded-full" style={{ background: '#2d302d' }}>
                <div
                  className="h-2 rounded-full transition-all duration-700"
                  style={{
                    width: `${selectedLead.score}%`,
                    background: selectedLead.score >= 80 ? '#e8624a' : selectedLead.score >= 60 ? '#fcd34d' : '#7A8B69'
                  }}
                />
              </div>
            </div>

            {/* Funnel */}
            <div className="mb-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">Воронка</div>
              <div className="flex items-center gap-1">
                {funnelSteps.map((step, i) => {
                  const current = funnelSteps.indexOf(selectedLead.status)
                  const isPast = i <= current
                  return (
                    <button
                      key={step}
                      onClick={() => updateStatus(selectedLead.id, step)}
                      className={`flex-1 py-1.5 text-[10px] font-medium rounded transition-all duration-150 ${
                        step === selectedLead.status
                          ? 'bg-accent text-white'
                          : isPast
                            ? 'bg-accent/20 text-accent'
                            : 'bg-sidebar-hover text-text-m hover:bg-card-hover'
                      }`}
                    >
                      {statusLabel[step]}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* The message that made this a lead — the owner must see it before writing */}
            {selectedLead.lastMessage && (
              <div className="mb-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">
                  Что он написал
                </div>
                <div
                  className="rounded-xl px-3 py-2.5 text-xs text-text-p leading-relaxed whitespace-pre-line"
                  style={{ background: '#222520', border: '1px solid #2d302d' }}
                >
                  {selectedLead.lastMessage}
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="mb-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">Переписка</div>
              <div className="space-y-2">
                {messages.length === 0 && (
                  <div className="text-text-m text-xs text-center py-4 rounded-xl" style={{ background: '#222520', border: '1px solid #2d302d' }}>
                    Ещё нет сообщений
                  </div>
                )}
                {messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
                        msg.direction === 'out'
                          ? 'bg-accent/20 text-text-p'
                          : 'text-text-p'
                      }`}
                      style={msg.direction === 'in' ? { background: '#2a2d2a', border: '1px solid #343734' } : undefined}
                    >
                      {msg.text}
                      <div className={`flex items-center gap-1 mt-1 text-[10px] ${msg.direction === 'out' ? 'text-accent/60' : 'text-text-m'}`}>
                        <Clock size={9} />
                        {formatTime(msg.createdAt)}
                        {msg.direction === 'out' && msg.approved && <span className="ml-1 text-accent">✓ одобрено</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="mb-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">Заметки</div>
              <textarea
                value={notesInput}
                onChange={e => setNotesInput(e.target.value)}
                onBlur={() => onUpdateNotes(selectedLead.id, notesInput)}
                placeholder="Добавьте заметку..."
                rows={3}
                className="w-full rounded-xl px-3 py-2.5 text-xs text-text-p resize-none outline-none transition-colors"
                style={{ background: '#222520', border: '1px solid #2d302d' }}
                onFocus={e => e.target.style.borderColor = '#7A8B69'}
              />
            </div>

            {/* Opener — shown for EVERY lead. The owner approves and sends,
                he never composes from scratch. Sending works for Telegram. */}
            <div className="mb-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">
                Первое сообщение (открывашка)
              </div>
              <textarea
                value={openerText}
                onChange={e => { setOpenerText(e.target.value); setDmResult(null) }}
                placeholder="У этого лида нет открывашки — он найден до обновления. Новые лиды приходят с готовым текстом."
                rows={4}
                className="w-full rounded-xl px-3 py-2.5 text-xs text-text-p resize-none outline-none transition-colors mb-2"
                style={{ background: '#222520', border: '1px solid #2d302d' }}
                onFocus={e => e.target.style.borderColor = '#7A8B69'}
                onBlur={e => e.target.style.borderColor = '#2d302d'}
              />
              {selectedLead.channel === 'telegram' ? (
                <>
                  <button
                    onClick={sendDm}
                    disabled={dmLoading || !openerText.trim()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: dmResult?.ok ? '#2d5a2d' : '#7A8B69', color: '#fff' }}
                  >
                    <Send size={14} />
                    {dmLoading ? 'Отправляю...' : dmResult?.ok ? '✓ Отправлено' : 'Написать в Telegram'}
                  </button>
                  {dmResult && !dmResult.ok && (
                    <div className="mt-2 text-xs text-red-400 text-center">{dmResult.msg}</div>
                  )}
                </>
              ) : (
                <div className="text-[10px] text-text-m">
                  {selectedLead.phone
                    ? `Отправка из платформы пока только для Telegram. Телефон: ${selectedLead.phone} — напиши в WhatsApp.`
                    : 'Отправка из платформы пока только для Telegram.'}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">Действия</div>
            <div className="flex gap-2">
              <button
                onClick={() => updateStatus(selectedLead.id, 'interested')}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent-dim transition-colors"
              >
                <CheckCircle size={14} />
                Одобрить ответ
              </button>
              <button
                onClick={() => updateStatus(selectedLead.id, 'converted')}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-beige hover:text-text-p transition-colors"
                style={{ background: '#2d302d' }}
              >
                <UserCheck size={14} />
                Передать менеджеру
              </button>
            </div>

            {/* Delete — irreversible, so it asks first */}
            <button
              onClick={() => {
                if (window.confirm(`Удалить лида «${selectedLead.name}» навсегда?`)) {
                  onDeleteLead(selectedLead.id)
                  closeLead()
                }
              }}
              className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium text-red-400 hover:bg-red-900/20 transition-colors"
              style={{ background: '#2d1a1a', border: '1px solid #5a2a2a' }}
            >
              <Trash2 size={13} />
              Удалить лида
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
