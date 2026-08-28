import { LayoutDashboard, Users, Bot, Settings } from 'lucide-react'

const items = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Главная' },
  { id: 'leads', icon: Users, label: 'Лиды' },
  { id: 'agents', icon: Bot, label: 'Агенты' },
  { id: 'settings', icon: Settings, label: 'Настройки' },
]

// Bottom tab bar — phones only. The desktop sidebar is hidden on small screens.
export default function MobileNav({ currentPage, onNavigate, leadsTotal }) {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex"
      style={{
        background: '#111412',
        borderTop: '1px solid #1e211e',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {items.map(({ id, icon: Icon, label }) => {
        const active = currentPage === id
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              active ? 'text-accent' : 'text-text-m'
            }`}
          >
            <span className="relative">
              <Icon size={20} />
              {id === 'leads' && leadsTotal > 0 && (
                <span className="absolute -top-1 -right-3 min-w-[14px] text-center text-[8px] font-bold px-1 py-px rounded-full bg-accent text-white">
                  {leadsTotal}
                </span>
              )}
            </span>
            {label}
          </button>
        )
      })}
    </nav>
  )
}
