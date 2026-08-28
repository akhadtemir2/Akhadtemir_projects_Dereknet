import { useState } from 'react'
import { Play, Pause, Users, MessageSquare, Flame, TrendingUp, MessageCircle, MapPin, Send, Camera, ArrowRight, Clock } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { activityData } from '../data/mockData'

const channelMeta = {
  whatsapp: { label: 'WhatsApp', icon: <MessageCircle size={13} className="text-emerald-400" />, color: '#34d399' },
  '2gis': { label: '2GIS', icon: <MapPin size={13} className="text-blue-400" />, color: '#60a5fa' },
  telegram: { label: 'Telegram', icon: <Send size={13} className="text-sky-400" />, color: '#38bdf8' },
  instagram: { label: 'Instagram', icon: <Camera size={13} className="text-pink-400" />, color: '#f472b6' },
}

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

const channelStatusMeta = {
  active: { dot: 'bg-emerald-400', label: 'Работает' },
  slow: { dot: 'bg-yellow-400 pulse-dot', label: 'Медленно' },
  error: { dot: 'bg-red-500', label: 'Ошибка' },
}

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl px-3 py-2 text-xs" style={{ background: '#1e211e', border: '1px solid #2d302d' }}>
        <div className="font-medium text-text-p mb-1">{label}</div>
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-text-s">{p.name === 'leads' ? 'Лидов' : 'Ответили'}: </span>
            <span className="text-text-p font-semibold">{p.value}</span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export default function Dashboard({
  leads, channels, agentRunning, onToggleAgent,
  newCount, repliedCount, hotCount, conversionRate, onNavigate
}) {
  const recentLeads = [...leads]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 8)

  const formatTime = (iso) => {
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
    <div className="p-4 md:p-8 max-w-6xl slide-in">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-p tracking-tight">Главная — Обзор</h1>
        <p className="text-text-s text-sm mt-1">Ваш единый входящий ящик и AI-агенты под управлением.</p>
      </div>

      {/* Agent control + channel status */}
      <div className="mb-6">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Управление агентами</div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onToggleAgent}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
              agentRunning
                ? 'bg-accent/15 text-accent border border-accent/30 hover:bg-accent/20'
                : 'bg-accent text-white hover:bg-accent-dim shadow-lg shadow-accent/20'
            }`}
          >
            {agentRunning ? <Pause size={15} /> : <Play size={15} />}
            {agentRunning ? 'Пауза агентов' : 'Запустить агентов'}
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(channels).map(([key, ch]) => {
              const meta = channelStatusMeta[ch.status]
              const cm = channelMeta[key]
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium"
                  style={{ background: '#181a18', border: '1px solid #242724' }}
                >
                  {cm.icon}
                  <span className="text-text-s">{cm.label}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Статистика сегодня</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Новых лидов', value: newCount, icon: <Users size={18} />, color: 'text-blue-400', bg: 'bg-blue-900/15' },
            { label: 'Ответили', value: repliedCount, icon: <MessageSquare size={18} />, color: 'text-accent', bg: 'bg-accent/10' },
            { label: '🔥 Горячие', value: hotCount, icon: <Flame size={18} />, color: 'text-hot', bg: 'bg-hot/10' },
            { label: 'Конверсия', value: `${conversionRate}%`, icon: <TrendingUp size={18} />, color: 'text-emerald-400', bg: 'bg-emerald-900/15' },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-4 transition-colors hover:bg-card-hover"
              style={{ background: '#222520', border: '1px solid #2d302d' }}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${s.bg} ${s.color}`}>
                {s.icon}
              </div>
              <div className="text-2xl font-bold text-text-p">{s.value}</div>
              <div className="text-text-m text-xs mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Activity Chart */}
        <div className="xl:col-span-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Активность (7 дней)</div>
          <div className="rounded-xl p-5" style={{ background: '#222520', border: '1px solid #2d302d' }}>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={activityData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7A8B69" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#7A8B69" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="repliedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D4C6B9" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#D4C6B9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d2a" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#626860', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#626860', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="leads" name="leads" stroke="#7A8B69" strokeWidth={2} fill="url(#leadsGrad)" />
                <Area type="monotone" dataKey="replied" name="replied" stroke="#D4C6B9" strokeWidth={1.5} fill="url(#repliedGrad)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1.5 text-xs text-text-s">
                <span className="w-3 h-0.5 bg-accent rounded" />
                Лиды
              </div>
              <div className="flex items-center gap-1.5 text-xs text-text-s">
                <span className="w-3 h-0.5 bg-beige rounded" />
                Ответили
              </div>
            </div>
          </div>
        </div>

        {/* Channel detail */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Каналы сегодня</div>
          <div className="rounded-xl overflow-hidden" style={{ background: '#222520', border: '1px solid #2d302d' }}>
            {Object.entries(channels).map(([key, ch], idx) => {
              const cm = channelMeta[key]
              const pct = Math.round((ch.todayCount / ch.limit) * 100)
              return (
                <div key={key} className={`p-4 ${idx < 3 ? 'border-b border-[#2d302d]' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {cm.icon}
                      <span className="text-text-p text-sm font-medium">{cm.label}</span>
                    </div>
                    <span className="text-text-s text-xs">{ch.todayCount}/{ch.limit}</span>
                  </div>
                  <div className="h-1 rounded-full" style={{ background: '#2d302d' }}>
                    <div
                      className="h-1 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: cm.color }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Recent Leads Feed */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m">Последние входящие</div>
          <button
            onClick={() => onNavigate('leads')}
            className="flex items-center gap-1 text-xs text-accent hover:text-accent-dim transition-colors"
          >
            Все лиды <ArrowRight size={12} />
          </button>
        </div>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #2d302d' }}>
          {recentLeads.map((lead, idx) => {
            // Unknown channel must not crash the dashboard
            const cm = channelMeta[lead.channel] || { label: '—', icon: <Clock size={13} className="text-text-m" /> }
            return (
              <div
                key={lead.id}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-card-hover transition-colors cursor-pointer ${
                  idx < recentLeads.length - 1 ? 'border-b border-[#2d302d]' : ''
                }`}
                style={{ background: '#222520' }}
                onClick={() => onNavigate('leads')}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-semibold text-xs"
                  style={{ background: 'linear-gradient(135deg, #7A8B69 0%, #4d5e40 100%)', color: '#fff' }}>
                  {lead.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-text-p text-sm font-medium">{lead.name}</span>
                    {lead.isHot && <span className="text-xs">🔥</span>}
                  </div>
                  <div className="text-text-m text-xs truncate">{lead.businessType} · {lead.lastMessage || 'Ещё не ответил'}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${statusColor[lead.status]}`}>
                    {statusLabel[lead.status]}
                  </span>
                  {cm.icon}
                  <span className="text-text-m text-xs flex items-center gap-1">
                    <Clock size={10} />{formatTime(lead.updatedAt)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
