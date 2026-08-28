import {
  LayoutDashboard, Inbox, MessageCircle, MapPin, Send, Camera,
  Users, Bot, Settings, ChevronDown, ChevronRight, Zap, ExternalLink
} from 'lucide-react'

const statusDot = (status) => {
  if (status === 'active') return 'bg-emerald-400'
  if (status === 'slow') return 'bg-yellow-400'
  return 'bg-red-500'
}

const channelIcon = (key) => {
  if (key === 'whatsapp') return <MessageCircle size={15} className="text-emerald-400" />
  if (key === '2gis') return <MapPin size={15} className="text-blue-400" />
  if (key === 'telegram') return <Send size={15} className="text-sky-400" />
  return <Camera size={15} className="text-pink-400" />
}

export default function Sidebar({
  currentPage, onNavigate, channels, expandedChannels,
  onToggleChannels, leadsTotal, hotCount, agentRunning
}) {
  const navItem = (id, icon, label, badge) => {
    const active = currentPage === id
    return (
      <button
        key={id}
        onClick={() => onNavigate(id)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 group ${
          active
            ? 'bg-accent/15 text-accent font-medium'
            : 'text-text-s hover:bg-sidebar-hover hover:text-text-p'
        }`}
      >
        <span className={active ? 'text-accent' : 'text-text-m group-hover:text-text-s'}>{icon}</span>
        <span className="flex-1 text-left">{label}</span>
        {badge != null && (
          <span className={`text-xs px-1.5 py-0.5 rounded-md font-semibold ${
            active ? 'bg-accent/20 text-accent' : 'bg-sidebar-hover text-text-m'
          }`}>
            {badge}
          </span>
        )}
      </button>
    )
  }

  return (
    <div
      className="hidden md:flex flex-col h-full select-none"
      style={{ width: 220, minWidth: 220, background: '#111412', borderRight: '1px solid #1e211e' }}
    >
      {/* Logo */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7A8B69 0%, #4d5e40 100%)' }}>
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <div className="text-text-p font-semibold text-sm leading-tight">BaiTech</div>
            <div className="text-text-m text-xs leading-tight">Lead Hub</div>
          </div>
        </div>
      </div>

      {/* Stats chip */}
      <div className="mx-3 mb-4">
        <div className="rounded-xl p-3" style={{ background: '#181a18', border: '1px solid #242724' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-text-m text-[10px] font-medium uppercase tracking-wider">Лидов всего</span>
            {hotCount > 0 && (
              <span className="text-[10px] font-semibold text-hot bg-hot/10 px-1.5 py-0.5 rounded-md">
                🔥 {hotCount}
              </span>
            )}
          </div>
          <div className="flex items-end gap-2">
            <span className="text-text-p text-2xl font-bold leading-none">{leadsTotal}</span>
            <span className="text-text-m text-xs mb-0.5">контактов</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${agentRunning ? 'bg-accent pulse-dot' : 'bg-text-m'}`} />
            <span className={`text-[10px] ${agentRunning ? 'text-accent' : 'text-text-m'}`}>
              {agentRunning ? 'Агенты работают' : 'Агенты остановлены'}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {/* ОБЗОР */}
        <div className="mb-1">
          <div className="px-3 py-1.5">
            <span className="text-text-m text-[10px] font-semibold uppercase tracking-widest">Обзор</span>
          </div>
          {navItem('dashboard', <LayoutDashboard size={15} />, 'Главная')}
        </div>

        {/* КАНАЛЫ */}
        <div className="mb-1">
          <button
            onClick={onToggleChannels}
            className="w-full flex items-center justify-between px-3 py-1.5 group"
          >
            <span className="text-text-m text-[10px] font-semibold uppercase tracking-widest group-hover:text-text-s transition-colors">Каналы</span>
            <span className="text-text-m group-hover:text-text-s transition-colors">
              {expandedChannels ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          </button>

          {expandedChannels && (
            <div className="ml-2 space-y-0.5">
              {Object.entries(channels).map(([key, ch]) => (
                <button
                  key={key}
                  onClick={() => onNavigate('agents')}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-150 hover:bg-sidebar-hover group"
                >
                  {channelIcon(key)}
                  <span className="flex-1 text-left text-text-s text-xs group-hover:text-text-p">{ch.name}</span>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(ch.status)}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ИНСТРУМЕНТЫ */}
        <div className="mb-1">
          <div className="px-3 py-1.5">
            <span className="text-text-m text-[10px] font-semibold uppercase tracking-widest">Инструменты</span>
          </div>
          {navItem('leads', <Users size={15} />, 'Лиды', leadsTotal)}
          {navItem('agents', <Bot size={15} />, 'Агенты')}
        </div>
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-4 pt-2 border-t border-[#1e211e] space-y-0.5">
        {navItem('settings', <Settings size={15} />, 'Настройки')}
        <a
          href="https://baitech.kz"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-text-m hover:text-text-s hover:bg-sidebar-hover transition-all duration-150"
        >
          <ExternalLink size={14} />
          <span className="text-xs">baitech.kz</span>
        </a>
      </div>
    </div>
  )
}
