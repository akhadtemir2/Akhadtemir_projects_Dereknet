import { useState, useEffect } from 'react'
import { MessageCircle, MapPin, Send, Camera, Play, ChevronDown, Square, RefreshCw, AlertCircle, CheckCircle, Users, Flame, Eye, X, Edit3, LogIn } from 'lucide-react'
import { promptTemplates } from '../data/mockData'

function timeAgo(iso) {
  if (!iso) return null
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (isNaN(s) || s < 0) return null
  if (s < 60) return `${s} сек назад`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин назад`
  return `${Math.floor(m / 60)} ч назад`
}

const businessTypes = [
  { id: 'salon', label: 'Салон красоты' },
  { id: 'restaurant', label: 'Ресторан / Кафе' },
  { id: 'autoservice', label: 'Автосервис' },
  { id: 'clinic', label: 'Клиника' },
  { id: 'shop', label: 'Магазин' },
  { id: 'construction', label: 'Стройка/Ремонт' },
]

const BASE = import.meta.env.PROD ? '' : '/api'

async function apiCall(method, path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json().catch(() => null)
    if (res.ok) return data
    // Surface the real backend error to the user instead of a generic message
    return { ok: false, detail: data?.detail || `Ошибка ${res.status}` }
  } catch {
    return null
  }
}

export default function Agents({ channels, onUpdateChannel }) {
  const [selectedBusiness, setSelectedBusiness] = useState('salon')
  const [promptType, setPromptType] = useState('comment_ru')
  const [testInput, setTestInput] = useState('')
  const [testOutput, setTestOutput] = useState('')
  const [testLoading, setTestLoading] = useState(false)

  // Telegram parser state
  const [parserStatus, setParserStatus] = useState(null)
  const [parserLoading, setParserLoading] = useState(false)

  // Telethon parser state
  const [tgStatus, setTgStatus] = useState(null)
  const [tgLoading, setTgLoading] = useState(false)
  const [tgGroups, setTgGroups] = useState('')

  // Instagram parser state
  const [igStatus, setIgStatus] = useState(null)
  const [igLoading, setIgLoading] = useState(false)
  const [igUser, setIgUser] = useState('')
  const [igPass, setIgPass] = useState('')
  const [igHumanReview, setIgHumanReview] = useState(true)
  const [igShowPass, setIgShowPass] = useState(false)
  const [editingDm, setEditingDm] = useState({})   // action_id → edited text

  // Limits (лимиты владельца — полный контроль над парсерами)
  const [igLimits, setIgLimits] = useState(null)   // {comments_per_day, dms_per_day, delay_min, delay_max}
  const [tgLeadsLimit, setTgLeadsLimit] = useState(null)
  const [limitsSaving, setLimitsSaving] = useState(false)
  const [rejectingAll, setRejectingAll] = useState(false)

  const saveIgLimits = async () => {
    if (!igLimits) return
    setLimitsSaving(true)
    const res = await apiCall('POST', '/instagram/limits', igLimits)
    setLimitsSaving(false)
    if (res?.ok) await loadIgStatus()
    else alert(res?.detail || 'Не удалось сохранить лимиты')
  }

  const saveTgLimits = async () => {
    if (!tgLeadsLimit) return
    setLimitsSaving(true)
    const res = await apiCall('POST', '/parser/telegram/limits', { leads_per_day: Number(tgLeadsLimit) })
    setLimitsSaving(false)
    if (res?.ok) { await loadTgStatus(); await loadParserStatus() }
    else alert(res?.detail || 'Не удалось сохранить лимит')
  }

  const rejectAllComments = async () => {
    const total = igStatus?.pending_comments_total || igStatus?.pending_comments?.length || 0
    if (!window.confirm(`Отклонить все комментарии в очереди (${total})? Это действие нельзя отменить.`)) return
    setRejectingAll(true)
    const res = await apiCall('POST', '/instagram/actions/reject-all')
    setRejectingAll(false)
    if (res?.ok) await loadIgStatus()
    else alert(res?.detail || 'Не удалось очистить очередь')
  }

  // ── Telegram Bot API ──────────────────────────────────────────────────────

  const loadParserStatus = async () => {
    const data = await apiCall('GET', '/parser/telegram-bot/status')
    if (data && data.ok !== false) setParserStatus(data)
  }

  useEffect(() => {
    loadParserStatus()
    const iv = setInterval(loadParserStatus, 4000)
    return () => clearInterval(iv)
  }, [])

  const startParser = async () => {
    setParserLoading(true)
    const res = await apiCall('POST', '/parser/telegram-bot/start')
    setParserLoading(false)
    if (res?.ok) await loadParserStatus()
    else alert(res?.detail || 'Ошибка запуска — проверь TELEGRAM_BOT_TOKEN в .env')
  }

  const stopParser = async () => {
    setParserLoading(true)
    await apiCall('POST', '/parser/telegram-bot/stop')
    setParserLoading(false)
    await loadParserStatus()
  }

  // ── Telethon ──────────────────────────────────────────────────────────────

  const loadTgStatus = async () => {
    const data = await apiCall('GET', '/parser/telegram/status')
    if (data && data.ok !== false) setTgStatus(data)
  }

  useEffect(() => {
    loadTgStatus()
    const iv = setInterval(loadTgStatus, 4000)
    return () => clearInterval(iv)
  }, [])

  // Restore saved groups so the textarea isn't empty after a page reload
  useEffect(() => {
    (async () => {
      const data = await apiCall('GET', '/parser/telegram/groups')
      if (data?.groups?.length) setTgGroups(prev => prev || data.groups.join('\n'))
    })()
  }, [])

  const startTelethon = async () => {
    const groups = tgGroups.split(/[\n,]/).map(g => g.trim()).filter(Boolean)
    if (!groups.length) { alert('Введи хотя бы одну группу'); return }
    setTgLoading(true)
    const res = await apiCall('POST', '/parser/telegram/start', { groups })
    setTgLoading(false)
    if (res?.ok) await loadTgStatus()
    else alert(res?.detail || 'Ошибка — проверь TG_API_ID и TG_API_HASH в .env и запусти telegram_auth.py')
  }

  const stopTelethon = async () => {
    setTgLoading(true)
    await apiCall('POST', '/parser/telegram/stop')
    setTgLoading(false)
    await loadTgStatus()
  }

  // ── Instagram ─────────────────────────────────────────────────────────────

  const loadIgStatus = async () => {
    const data = await apiCall('GET', '/instagram/status')
    if (data && data.ok !== false) setIgStatus(data)
  }

  useEffect(() => {
    loadIgStatus()
    const iv = setInterval(loadIgStatus, 5000)
    return () => clearInterval(iv)
  }, [])

  const [igRemember, setIgRemember] = useState(true)
  const igLogin = async () => {
    if (!igUser || !igPass) return
    setIgLoading(true)
    const res = await apiCall('POST', '/instagram/login', { username: igUser, password: igPass, remember: igRemember })
    setIgLoading(false)
    if (res?.ok) {
      setIgPass('')
      await loadIgStatus()
    } else {
      alert(res?.detail || 'Ошибка входа в Instagram')
    }
  }

  // Proxy for Instagram — a KZ proxy keeps the session alive on a datacenter server
  const [igProxy, setIgProxy] = useState('')
  const [igProxyLoaded, setIgProxyLoaded] = useState(false)
  useEffect(() => {
    (async () => {
      const data = await apiCall('GET', '/settings')
      if (data && data.ok !== false) setIgProxy(data.ig_proxy || '')
      setIgProxyLoaded(true)
    })()
  }, [])
  const saveIgProxy = async () => {
    const res = await apiCall('PUT', '/settings/ig_proxy', { value: igProxy.trim() })
    if (res && res.ok !== false) alert('Прокси сохранён. Теперь примени сессию заново.')
    else alert(res?.detail || 'Не удалось сохранить прокси')
  }

  // Apply a session string from instagram_auth.py — safest way, no login from server IP
  const [igSessionB64, setIgSessionB64] = useState('')
  const igApplySession = async () => {
    if (!igUser || !igSessionB64.trim()) return
    setIgLoading(true)
    const res = await apiCall('POST', '/instagram/session', { username: igUser, session_b64: igSessionB64.trim() })
    setIgLoading(false)
    if (res?.ok) {
      setIgSessionB64('')
      await loadIgStatus()
      alert(res.message || 'Сессия применена')
    } else {
      alert(res?.detail || 'Не удалось применить сессию')
    }
  }

  const igStart = async () => {
    setIgLoading(true)
    const res = await apiCall('POST', '/instagram/start', { human_review: igHumanReview })
    setIgLoading(false)
    if (res?.ok) await loadIgStatus()
    else alert(res?.detail || 'Ошибка запуска')
  }

  const igStop = async () => {
    setIgLoading(true)
    await apiCall('POST', '/instagram/stop')
    setIgLoading(false)
    await loadIgStatus()
  }

  const approveComment = async (item) => {
    const res = await apiCall('POST', `/instagram/approve-comment/${item.id}`, {
      post_shortcode: item.post_shortcode,
      comment_text: item.comment_text,
      action_id: item.id,
    })
    if (res?.ok) {
      await loadIgStatus()
    } else {
      alert(res?.detail || 'Ошибка публикации комментария')
    }
  }

  const rejectComment = async (item) => {
    await apiCall('POST', `/instagram/reject-comment/${item.id}`)
    await loadIgStatus()
  }

  const approveDm = async (item) => {
    const dmText = editingDm[item.action_id] ?? item.dm_text
    const res = await apiCall('POST', `/instagram/approve-dm/${item.action_id}`, {
      action_id: item.action_id,
      author_id: item.author_id,
      author_username: item.author,
      dm_text: dmText,
      business_type: item.business_type,
      language: item.language,
    })
    if (res?.ok) {
      setEditingDm(prev => { const n = { ...prev }; delete n[item.action_id]; return n })
      await loadIgStatus()
    } else {
      alert(res?.detail || 'Ошибка отправки DM')
    }
  }

  const rejectDm = async (item) => {
    await apiCall('POST', `/instagram/reject-dm/${item.action_id}`)
    setEditingDm(prev => { const n = { ...prev }; delete n[item.action_id]; return n })
    await loadIgStatus()
  }

  // ── 2GIS parser ───────────────────────────────────────────────────────────

  const GIS_CITIES = [
    { id: 'atyrau', label: 'Атырау' },
    { id: 'almaty', label: 'Алматы' },
    { id: 'astana', label: 'Астана' },
    { id: 'aktobe', label: 'Актобе' },
    { id: 'shymkent', label: 'Шымкент' },
  ]
  const [gisStatus, setGisStatus] = useState(null)
  const [gisLoading, setGisLoading] = useState(false)
  const [gisCities, setGisCities] = useState(['atyrau'])

  const loadGisStatus = async () => {
    const data = await apiCall('GET', '/parser/twogis/status')
    if (data && data.ok !== false) setGisStatus(data)
  }

  useEffect(() => {
    loadGisStatus()
    const iv = setInterval(loadGisStatus, 5000)
    return () => clearInterval(iv)
  }, [])

  const gisStart = async () => {
    if (!gisCities.length) { alert('Выбери хотя бы один город'); return }
    setGisLoading(true)
    const res = await apiCall('POST', '/parser/twogis/start', { city_ids: gisCities })
    setGisLoading(false)
    if (res?.ok) await loadGisStatus()
    else alert(res?.detail || 'Ошибка запуска 2GIS')
  }

  const gisStop = async () => {
    setGisLoading(true)
    await apiCall('POST', '/parser/twogis/stop')
    setGisLoading(false)
    await loadGisStatus()
  }

  const toggleGisCity = (id) => {
    setGisCities(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
  }

  // AI verdict log — why each candidate was accepted or rejected
  const [aiVerdicts, setAiVerdicts] = useState([])
  useEffect(() => {
    const load = async () => {
      const data = await apiCall('GET', '/agent-logs?channel=telegram&limit=50')
      if (data?.logs) setAiVerdicts(data.logs.filter(l => l.action === 'ai_verdict').slice(0, 8))
    }
    load()
    const iv = setInterval(load, 15000)
    return () => clearInterval(iv)
  }, [])

  // Fill limit inputs once statuses arrive
  useEffect(() => {
    if (igStatus?.limits && !igLimits) setIgLimits(igStatus.limits)
  }, [igStatus])
  useEffect(() => {
    if (tgStatus?.limits && tgLeadsLimit === null) setTgLeadsLimit(tgStatus.limits.leads_per_day)
  }, [tgStatus])

  // ── Prompt test ───────────────────────────────────────────────────────────

  const runTest = () => {
    if (!testInput.trim()) return
    setTestLoading(true)
    setTestOutput('')
    setTimeout(() => {
      const templates = {
        salon_comment_ru: 'Очень понимаю — в таком ритме важно не упустить ни одного клиента. Есть способы автоматизировать запись, чтобы освободить время.',
        salon_offer_ru: 'Спасибо за ответ! Мы — BaiTech из Атырау, помогаем салонам красоты автоматизировать запись через WhatsApp. Клиенты пишут сами, бот отвечает 24/7 без вашего участия. Как сейчас обрабатываете входящие? Предлагаем бесплатную консультацию — baitech.kz',
        restaurant_comment_ru: 'Отличное блюдо! Интересно, как справляетесь с потоком брони по вечерам?',
        restaurant_offer_ru: 'Спасибо за ответ! BaiTech — автоматизируем приём броней и заказов для ресторанов через WhatsApp. Бот работает ночью, вы получаете уведомления утром. Покажем демо? baitech.kz',
      }
      const key = `${selectedBusiness}_${promptType}`
      setTestOutput(templates[key] || `[Демо-ответ AI для типа "${selectedBusiness}" / "${promptType}"]\n\nВ реальном режиме здесь будет ответ GPT-4o-mini на основе вашего промпта и входного текста.`)
      setTestLoading(false)
    }, 1200)
  }

  const currentPrompt = promptTemplates[selectedBusiness]?.[promptType] || ''
  const pendingComments = igStatus?.pending_comments || []
  const pendingDms = igStatus?.pending_dms || []

  return (
    <div className="p-4 md:p-8 max-w-5xl slide-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-p tracking-tight">Агенты — Управление</h1>
        <p className="text-text-s text-sm mt-1">Настройте AI-агентов для каждого канала.</p>
      </div>

      {/* ── Telegram Parser ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Telegram Парсер</div>
        <div className="rounded-xl overflow-hidden" style={{ background: '#222520', border: '1px solid #2d302d' }}>
          <div className="p-4 border-b border-[#2d302d] flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-sky-900/15">
                <Send size={16} className="text-sky-400" />
              </div>
              <div>
                <div className="text-text-p text-sm font-semibold">Мониторинг групп</div>
                <div className="text-text-m text-xs">Bot API · поиск бизнесменов по ключевым словам</div>
              </div>
            </div>

            {parserStatus ? (
              <div className="flex items-center gap-2">
                {parserStatus.running ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                    Работает
                    {timeAgo(parserStatus.last_activity) && (
                      <span className="text-[10px] text-text-m font-normal">· проверка {timeAgo(parserStatus.last_activity)}</span>
                    )}
                  </span>
                ) : parserStatus.last_error ? (
                  <span className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertCircle size={12} />
                    Ошибка
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-text-m">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-m" />
                    Остановлен
                  </span>
                )}
              </div>
            ) : (
              <span className="text-text-m text-xs">Нет связи с бэкендом</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#2d302d]">
            <div className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Управление</div>
              <div className="rounded-lg px-3 py-3 mb-4 text-xs leading-relaxed" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                <div className="text-text-s mb-2">
                  Бот читает сообщения из всех групп, куда он добавлен. Новые группы определяются автоматически.
                </div>
                <div className="text-text-m">
                  ⚠️ Отключи Privacy Mode в <span className="text-sky-400">@BotFather</span>:<br />
                  <span className="font-mono text-[10px]">/mybots → Bot Settings → Group Privacy → Turn off</span>
                </div>
              </div>

              <div className="flex gap-2 mb-3">
                {parserStatus?.running ? (
                  <button
                    onClick={stopParser}
                    disabled={parserLoading}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40"
                    style={{ background: '#7a3030' }}
                  >
                    <Square size={11} />
                    {parserLoading ? 'Останавливаем...' : 'Остановить'}
                  </button>
                ) : (
                  <button
                    onClick={startParser}
                    disabled={parserLoading || !parserStatus}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent-dim transition-colors disabled:opacity-40"
                  >
                    <Play size={11} />
                    {parserLoading ? 'Запускаем...' : 'Запустить'}
                  </button>
                )}
                <button onClick={loadParserStatus} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-text-s hover:text-text-p transition-colors" style={{ background: '#2d302d' }}>
                  <RefreshCw size={11} />
                </button>
              </div>

              {parserStatus?.last_error && (
                <div className="rounded-lg px-3 py-2 text-xs text-red-400 leading-relaxed" style={{ background: '#3a1a1a', border: '1px solid #5a2a2a' }}>
                  <span className="font-semibold">Ошибка: </span>{parserStatus.last_error}
                </div>
              )}

              {parserStatus?.groups && Object.keys(parserStatus.groups).length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] font-semibold text-text-m uppercase tracking-widest mb-2">Обнаруженные группы</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {Object.entries(parserStatus.groups).map(([id, title]) => (
                      <div key={id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg" style={{ background: '#1a1d1a' }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 flex-shrink-0" />
                        <span className="text-text-s truncate">{title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Статистика сессии</div>
              {parserStatus ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Прочитано сообщений', value: parserStatus.stats?.seen ?? 0, icon: <Eye size={13} className="text-text-m" /> },
                      { label: 'Совпало по словам', value: parserStatus.stats?.scanned ?? 0, icon: <RefreshCw size={13} className="text-text-m" /> },
                      { label: 'Найдено лидов', value: parserStatus.stats?.found ?? 0, icon: <Users size={13} className="text-accent" />, accent: true },
                      { label: '🔥 Горячих', value: parserStatus.stats?.hot ?? 0, icon: <Flame size={13} className="text-hot" />, hot: true },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl px-3 py-2.5" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                        <div className="flex items-center gap-1.5 mb-1">{s.icon}<span className="text-[10px] text-text-m">{s.label}</span></div>
                        <div className={`text-lg font-bold ${s.hot ? 'text-hot' : s.accent ? 'text-accent' : 'text-text-p'}`}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  {parserStatus.running && Object.keys(parserStatus.groups || {}).length === 0 && (
                    <div className="mt-3 rounded-lg px-3 py-2 text-[10px] text-amber-400/90 leading-relaxed"
                      style={{ background: '#2a2510', border: '1px solid #4a3a10' }}>
                      ⚠️ Бот не получил ещё ни одного сообщения. Проверь: он добавлен в группу
                      и Privacy Mode выключен в @BotFather.
                    </div>
                  )}
                </>
              ) : (
                <div className="text-text-m text-xs py-4 text-center">Бэкенд недоступен</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Telethon Parser ──────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Telegram — Telethon (Аккаунт BaiTech)</div>
        <div className="rounded-xl overflow-hidden" style={{ background: '#222520', border: '1px solid #2d302d' }}>

          {/* Header */}
          <div className="p-4 border-b border-[#2d302d] flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-sky-900/25">
                <Send size={16} className="text-sky-300" />
              </div>
              <div>
                <div className="text-text-p text-sm font-semibold">Сканирование от имени аккаунта</div>
                <div className="text-text-m text-xs">Telethon · читает историю групп + realtime · может написать в ЛС первым</div>
              </div>
            </div>
            {tgStatus ? (
              <div className="flex items-center gap-2">
                {tgStatus.running ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                    Работает
                    {timeAgo(tgStatus.last_activity) && (
                      <span className="text-[10px] text-text-m font-normal">· проверка {timeAgo(tgStatus.last_activity)}</span>
                    )}
                  </span>
                ) : tgStatus.last_error ? (
                  <span className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertCircle size={12} />
                    Ошибка
                  </span>
                ) : tgStatus.available ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle size={12} />
                    Сессия готова
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-amber-400">
                    <AlertCircle size={12} />
                    Нет сессии
                  </span>
                )}
              </div>
            ) : (
              <span className="text-text-m text-xs">Нет связи с бэкендом</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#2d302d]">
            {/* Left — group input + controls */}
            <div className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Группы для сканирования</div>

              <div className="rounded-lg px-3 py-2.5 mb-3 text-[10px] text-sky-400/80 leading-relaxed" style={{ background: '#0d1a25', border: '1px solid #1a3a50' }}>
                ✅ В отличие от Bot API — Telethon читает <span className="font-semibold">историю</span> сообщений и может <span className="font-semibold">написать первым в ЛС</span> любому участнику группы.
              </div>

              <textarea
                value={tgGroups}
                onChange={e => setTgGroups(e.target.value)}
                placeholder={'@atyrau_business\nhttps://t.me/kz_biznes\n@predprinimatel_kz'}
                rows={5}
                disabled={tgStatus?.running}
                className="w-full rounded-lg px-3 py-2.5 text-xs text-text-p font-mono resize-none outline-none leading-relaxed mb-3 disabled:opacity-50"
                style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}
                onFocus={e => e.target.style.borderColor = '#38bdf8'}
                onBlur={e => e.target.style.borderColor = '#2d302d'}
              />
              <div className="text-[10px] text-text-m mb-3">Каждая группа на новой строке или через запятую. Можно ссылку или @юзернейм.</div>

              <div className="flex gap-2">
                {tgStatus?.running ? (
                  <button
                    onClick={stopTelethon}
                    disabled={tgLoading}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40"
                    style={{ background: '#7a3030' }}
                  >
                    <Square size={11} />
                    {tgLoading ? 'Останавливаем...' : 'Остановить'}
                  </button>
                ) : (
                  <button
                    onClick={startTelethon}
                    disabled={tgLoading || !tgGroups.trim()}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40"
                    style={{ background: '#1565a0' }}
                  >
                    <Play size={11} />
                    {tgLoading ? 'Запускаем...' : 'Запустить сканирование'}
                  </button>
                )}
                <button onClick={loadTgStatus} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-text-s hover:text-text-p transition-colors" style={{ background: '#2d302d' }}>
                  <RefreshCw size={11} />
                </button>
              </div>

              {tgStatus?.last_error && (
                <div className="mt-3 rounded-lg px-3 py-2 text-xs text-red-400 leading-relaxed" style={{ background: '#3a1a1a', border: '1px solid #5a2a2a' }}>
                  <span className="font-semibold">Ошибка: </span>{tgStatus.last_error}
                </div>
              )}

              {/* Лимит лидов/день — применяется к обоим Telegram-парсерам */}
              <div className="mt-4 rounded-lg px-3 py-3" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-text-p text-xs font-medium">Лимит лидов/день</div>
                    <div className="text-text-m text-[10px] mt-0.5">
                      Найдено сегодня: {tgStatus?.leads_today ?? 0}/{tgStatus?.limits?.leads_per_day ?? '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={1} max={500}
                      value={tgLeadsLimit ?? ''}
                      onChange={e => setTgLeadsLimit(e.target.value)}
                      className="w-20 rounded-lg px-2 py-1.5 text-xs text-text-p outline-none text-center"
                      style={{ background: '#222520', border: '1px solid #2d302d' }}
                    />
                    <button
                      onClick={saveTgLimits}
                      disabled={limitsSaving || !tgLeadsLimit}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-accent text-white hover:bg-accent-dim transition-colors disabled:opacity-40"
                    >
                      Сохранить
                    </button>
                  </div>
                </div>
              </div>

              {tgStatus?.groups?.length > 0 && tgStatus.running && (
                <div className="mt-3">
                  <div className="text-[10px] font-semibold text-text-m uppercase tracking-widest mb-2">Активные группы</div>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {tgStatus.groups.map(g => (
                      <div key={g} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg" style={{ background: '#1a1d1a' }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-300 flex-shrink-0" />
                        <span className="text-text-s truncate font-mono">{g}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right — stats */}
            <div className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Статистика сессии</div>
              {tgStatus ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Прочитано сообщений', value: tgStatus.stats?.seen ?? 0, icon: <Eye size={13} className="text-text-m" /> },
                    { label: 'Совпало по словам', value: tgStatus.stats?.scanned ?? 0, icon: <RefreshCw size={13} className="text-text-m" /> },
                    { label: 'Найдено лидов', value: tgStatus.stats?.found ?? 0, icon: <Users size={13} className="text-accent" />, accent: true },
                    { label: '🔥 Горячих', value: tgStatus.stats?.hot ?? 0, icon: <Flame size={13} className="text-hot" />, hot: true },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl px-3 py-2.5" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                      <div className="flex items-center gap-1.5 mb-1">{s.icon}<span className="text-[10px] text-text-m">{s.label}</span></div>
                      <div className={`text-lg font-bold ${s.hot ? 'text-hot' : s.accent ? 'text-accent' : 'text-text-p'}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-text-m text-xs py-4 text-center">Бэкенд недоступен</div>
              )}

              {/* Membership + traffic diagnostics — silence used to look identical to health */}
              {tgStatus?.running && (
                <div className="mt-3 space-y-2">
                  <div className="rounded-lg px-3 py-2 text-[10px] leading-relaxed"
                    style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                    <span className="text-text-m">Состоим в группах: </span>
                    <span className="text-text-p font-semibold">
                      {tgStatus.joined ?? 0} из {tgStatus.groups?.length ?? 0}
                    </span>
                    <div className="text-text-m mt-1">
                      Telegram присылает новые сообщения только для групп, в которых аккаунт состоит.
                    </div>
                  </div>
                  {(tgStatus.stats?.seen ?? 0) === 0 && (
                    <div className="rounded-lg px-3 py-2 text-[10px] text-amber-400/90 leading-relaxed"
                      style={{ background: '#2a2510', border: '1px solid #4a3a10' }}>
                      ⚠️ Ни одного сообщения ещё не прочитано. Значит группы молчат или аккаунт
                      в них не вступил — а не то, что фильтр слишком строгий.
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 rounded-lg px-3 py-3 text-[10px] text-text-m leading-relaxed" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                <div className="font-semibold text-text-s mb-1.5">Как работает Telethon:</div>
                <div className="space-y-1">
                  <div>1. <span className="text-sky-300">Сам вступает</span> в указанные группы — иначе realtime не приходит</div>
                  <div>2. Историю группы читает один раз, дальше — realtime</div>
                  <div>3. Дешёвый AI-фильтр отсеивает шум, полный скоринг — только кандидатам</div>
                  <div>4. Владелец B2C-бизнеса = лид, даже если он ни на что не жалуется</div>
                  <div>5. К каждому лиду — готовая открывашка RU/KZ → уведомление в Telegram</div>
                </div>
              </div>

              {/* AI verdicts — full transparency on accept/reject decisions */}
              {aiVerdicts.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">Решения AI (последние)</div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {aiVerdicts.map(v => {
                      const accepted = (v.result || '').startsWith('ПРИНЯТ')
                      return (
                        <div key={v.id} className="rounded-lg px-2.5 py-2 text-[10px] leading-relaxed"
                          style={{ background: '#1a1d1a', border: `1px solid ${accepted ? '#3a4a20' : '#2d302d'}` }}>
                          <div className={`font-semibold mb-0.5 ${accepted ? 'text-emerald-400' : 'text-text-m'}`}>
                            {accepted ? '✓ ПРИНЯТ' : '✕ Отклонён'}
                            <span className="text-text-m font-normal ml-2">{timeAgo(v.created_at)}</span>
                          </div>
                          <div className="text-text-s break-words">{(v.result || '').replace(/^(ПРИНЯТ|ОТКЛОНЁН) · /, '')}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 2GIS Parser ──────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">2GIS — Холодные лиды с болью</div>
        <div className="rounded-xl overflow-hidden" style={{ background: '#222520', border: '1px solid #2d302d' }}>

          <div className="p-4 border-b border-[#2d302d] flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-900/15">
                <MapPin size={16} className="text-blue-400" />
              </div>
              <div>
                <div className="text-text-p text-sm font-semibold">Бизнесы с жалобами «не отвечают»</div>
                <div className="text-text-m text-xs">Каталог 2GIS · рейтинг 1–2.5★ · AI читает отзывы · телефон сразу в карточке</div>
              </div>
            </div>
            {gisStatus ? (
              <div className="flex items-center gap-2">
                {gisStatus.running ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                    Сканирует
                  </span>
                ) : !gisStatus.api_key_set ? (
                  <span className="flex items-center gap-1.5 text-xs text-amber-400">
                    <AlertCircle size={12} />
                    Нет API-ключа
                  </span>
                ) : gisStatus.last_error ? (
                  <span className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertCircle size={12} />
                    Ошибка
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-blue-300">
                    <CheckCircle size={12} />
                    Готов
                  </span>
                )}
              </div>
            ) : (
              <span className="text-text-m text-xs">Нет связи с бэкендом</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#2d302d]">
            {/* Left — control */}
            <div className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Управление</div>

              {gisStatus && !gisStatus.api_key_set && (
                <div className="rounded-lg px-3 py-3 mb-3 text-xs text-amber-400/80 leading-relaxed" style={{ background: '#2a2510', border: '1px solid #4a3a10' }}>
                  ⚠️ Жду одобрения заявки на dev.2gis.ru. Когда придёт ключ — впиши его в Railway
                  Variables как <span className="font-mono">TWOGIS_API_KEY</span> (или в backend/.env локально).
                </div>
              )}

              <div className="text-[10px] text-text-m mb-2">Города для сканирования:</div>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {GIS_CITIES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => !gisStatus?.running && toggleGisCity(c.id)}
                    disabled={gisStatus?.running}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 ${
                      gisCities.includes(c.id)
                        ? 'bg-blue-900/40 text-blue-300 border border-blue-700/40'
                        : 'text-text-m border border-[#2d302d] hover:text-text-s'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                {gisStatus?.running ? (
                  <button
                    onClick={gisStop}
                    disabled={gisLoading}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40"
                    style={{ background: '#7a3030' }}
                  >
                    <Square size={11} />
                    {gisLoading ? 'Останавливаем...' : 'Остановить'}
                  </button>
                ) : (
                  <button
                    onClick={gisStart}
                    disabled={gisLoading || !gisStatus?.api_key_set}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40"
                    style={{ background: '#1e5a8a' }}
                  >
                    <Play size={11} />
                    {gisLoading ? 'Запускаем...' : 'Запустить сканирование'}
                  </button>
                )}
                <button onClick={loadGisStatus} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-text-s hover:text-text-p transition-colors" style={{ background: '#2d302d' }}>
                  <RefreshCw size={11} />
                </button>
              </div>

              {gisStatus?.last_error && (
                <div className="mt-3 rounded-lg px-3 py-2 text-xs text-red-400 leading-relaxed" style={{ background: '#3a1a1a', border: '1px solid #5a2a2a' }}>
                  <span className="font-semibold">Ошибка: </span>{gisStatus.last_error}
                </div>
              )}
            </div>

            {/* Right — stats */}
            <div className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Статистика</div>
              {gisStatus ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Просканировано', value: gisStatus.stats?.scanned ?? 0, icon: <RefreshCw size={13} className="text-text-m" /> },
                      { label: 'Найдено лидов', value: gisStatus.stats?.leads_found ?? 0, icon: <Users size={13} className="text-accent" />, accent: true },
                      { label: 'Страниц каталога', value: gisStatus.stats?.pages ?? 0, icon: <MapPin size={13} className="text-blue-400" /> },
                      { label: 'Ошибок', value: gisStatus.stats?.errors ?? 0, icon: <AlertCircle size={13} className="text-text-m" /> },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl px-3 py-2.5" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                        <div className="flex items-center gap-1.5 mb-1">{s.icon}<span className="text-[10px] text-text-m">{s.label}</span></div>
                        <div className={`text-lg font-bold ${s.accent ? 'text-accent' : 'text-text-p'}`}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  {gisStatus.last_run && (
                    <div className="mt-2 text-[10px] text-text-m">Последний скан завершён: {new Date(gisStatus.last_run).toLocaleString('ru-RU')}</div>
                  )}
                </>
              ) : (
                <div className="text-text-m text-xs py-4 text-center">Бэкенд недоступен</div>
              )}

              <div className="mt-4 rounded-lg px-3 py-3 text-[10px] text-text-m leading-relaxed" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                <div className="font-semibold text-text-s mb-1.5">Почему это лучший источник:</div>
                <div className="space-y-1">
                  <div>1. Ищет бизнесы с рейтингом 1–2.5★ по выбранным городам</div>
                  <div>2. AI читает их отзывы и ловит жалобы «не берут трубку, не отвечают в WhatsApp»</div>
                  <div>3. Это доказанная боль — ровно то, что решает BaiTech</div>
                  <div>4. Телефон уже в карточке + готовая открывашка RU/KZ</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Instagram Parser ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Instagram — Outbound Поиск</div>
        <div className="rounded-xl overflow-hidden" style={{ background: '#222520', border: '1px solid #2d302d' }}>

          {/* Header */}
          <div className="p-4 border-b border-[#2d302d] flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-pink-900/15">
                <Camera size={16} className="text-pink-400" />
              </div>
              <div>
                <div className="text-text-p text-sm font-semibold">Комментарии → Ответ → Direct</div>
                <div className="text-text-m text-xs">Instagrapi · AI находит бизнесы, пишет комментарий, ждёт ответа, шлёт оффер</div>
              </div>
            </div>

            {igStatus ? (
              <div className="flex items-center gap-2">
                {igStatus.running ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                    Работает
                  </span>
                ) : igStatus.logged_in ? (
                  <span className="flex items-center gap-1.5 text-xs text-pink-400">
                    <CheckCircle size={12} />
                    Вошли как @{igStatus.username}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-text-m">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-m" />
                    Не авторизован
                  </span>
                )}
              </div>
            ) : (
              <span className="text-text-m text-xs">Нет связи с бэкендом</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#2d302d]">
            {/* Left: login / control */}
            <div className="p-4">
              {/* Session error — shown above everything, incl. login form (login_required case) */}
              {igStatus && !igStatus.logged_in && igStatus.last_error && (
                <div className="mb-4 rounded-lg px-3 py-2 text-xs text-red-400 leading-relaxed" style={{ background: '#3a1a1a', border: '1px solid #5a2a2a' }}>
                  <span className="font-semibold">Ошибка: </span>{igStatus.last_error}
                </div>
              )}

              {/* Login form — only if not logged in */}
              {igStatus && !igStatus.logged_in && (
                <div className="mb-4">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Войти в Instagram</div>
                  <div className="rounded-lg px-3 py-3 mb-3 text-xs text-amber-400/80 leading-relaxed" style={{ background: '#2a2510', border: '1px solid #4a3a10' }}>
                    ⚠️ Используй <span className="font-semibold">отдельный Instagram аккаунт</span>, не основной.
                    Лучший способ входа — <span className="font-semibold">строка сессии</span> (блок ниже): она создаётся на твоём компьютере,
                    и Instagram не видит вход с чужого IP. Вход по паролю отсюда — только если строка не сработала,
                    и не жми «Войти» много раз подряд.
                  </div>
                  <div className="space-y-2 mb-3">
                    <input
                      type="text"
                      placeholder="Логин Instagram"
                      value={igUser}
                      onChange={e => setIgUser(e.target.value)}
                      className="w-full rounded-lg px-3 py-2.5 text-xs text-text-p outline-none"
                      style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}
                      onFocus={e => e.target.style.borderColor = '#f472b6'}
                      onBlur={e => e.target.style.borderColor = '#2d302d'}
                    />
                    <div className="relative">
                      <input
                        type={igShowPass ? 'text' : 'password'}
                        placeholder="Пароль"
                        value={igPass}
                        onChange={e => setIgPass(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && igLogin()}
                        className="w-full rounded-lg px-3 py-2.5 pr-10 text-xs text-text-p outline-none"
                        style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}
                        onFocus={e => e.target.style.borderColor = '#f472b6'}
                        onBlur={e => e.target.style.borderColor = '#2d302d'}
                      />
                      <button
                        onClick={() => setIgShowPass(!igShowPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-m hover:text-text-p"
                      >
                        <Eye size={12} />
                      </button>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={igRemember}
                      onChange={e => setIgRemember(e.target.checked)}
                      className="accent-[#7A8B69]"
                    />
                    <span className="text-[10px] text-text-s">
                      Запомнить пароль для авто-восстановления сессии (хранится в твоей БД)
                    </span>
                  </label>
                  <button
                    onClick={igLogin}
                    disabled={igLoading || !igUser || !igPass}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40"
                    style={{ background: '#c0357a' }}
                  >
                    <LogIn size={12} />
                    {igLoading ? 'Входим...' : 'Войти'}
                  </button>

                  {/* Proxy — Instagram kills home-made sessions used from datacenter IPs */}
                  <div className="mt-4 pt-4 border-t border-[#2d302d]">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">
                      Прокси для Instagram <span className="text-text-m normal-case">(рекомендуется KZ)</span>
                    </div>
                    <div className="text-[10px] text-text-m mb-2 leading-relaxed">
                      Instagram убивает сессию, когда она создана дома, а используется с IP сервера.
                      Мобильный/резидентный прокси Казахстана решает это. Формат: <span className="font-mono">http://логин:пароль@хост:порт</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="http://user:pass@host:port"
                        value={igProxy}
                        onChange={e => setIgProxy(e.target.value)}
                        className="flex-1 rounded-lg px-3 py-2 text-xs text-text-p font-mono outline-none"
                        style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}
                      />
                      <button
                        onClick={saveIgProxy}
                        disabled={!igProxyLoaded}
                        className="px-3 py-2 rounded-lg text-[11px] font-semibold bg-accent text-white hover:bg-accent-dim transition-colors disabled:opacity-40"
                      >
                        Сохранить
                      </button>
                    </div>
                  </div>

                  {/* Session string — recommended: created on YOUR computer, no login from server IP */}
                  <div className="mt-4 pt-4 border-t border-[#2d302d]">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">
                      Или вставь строку сессии <span className="text-emerald-400 normal-case">(надёжнее)</span>
                    </div>
                    <div className="text-[10px] text-text-m mb-2 leading-relaxed">
                      Запусти на своём компьютере <span className="font-mono text-text-s">python backend\instagram_auth.py</span>,
                      скопируй длинную строку и вставь сюда. Логин укажи в поле выше. Применяется сразу, без редеплоя.
                    </div>
                    <textarea
                      value={igSessionB64}
                      onChange={e => setIgSessionB64(e.target.value)}
                      placeholder="H4sIA... (строка IG_SESSION_B64 из instagram_auth.py)"
                      rows={3}
                      className="w-full rounded-lg px-3 py-2.5 text-[10px] text-text-p font-mono resize-none outline-none leading-relaxed mb-2 break-all"
                      style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}
                      onFocus={e => e.target.style.borderColor = '#f472b6'}
                      onBlur={e => e.target.style.borderColor = '#2d302d'}
                    />
                    <button
                      onClick={igApplySession}
                      disabled={igLoading || !igUser || !igSessionB64.trim()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40"
                      style={{ background: '#3a6a20' }}
                    >
                      <CheckCircle size={12} />
                      {igLoading ? 'Применяем...' : 'Применить сессию'}
                    </button>
                  </div>
                </div>
              )}

              {/* Control — only if logged in */}
              {igStatus?.logged_in && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Управление</div>

                  {/* Human review toggle */}
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5 mb-4" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                    <div>
                      <div className="text-text-p text-xs font-medium">Human Review Gate</div>
                      <div className="text-text-m text-[10px] mt-0.5">AI генерирует → ты одобряешь → публикуется</div>
                    </div>
                    <label className="toggle-switch flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={igHumanReview}
                        onChange={e => setIgHumanReview(e.target.checked)}
                        disabled={igStatus.running}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>

                  <div className="flex gap-2">
                    {igStatus.running ? (
                      <button
                        onClick={igStop}
                        disabled={igLoading}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40"
                        style={{ background: '#7a3030' }}
                      >
                        <Square size={11} />
                        {igLoading ? 'Останавливаем...' : 'Остановить'}
                      </button>
                    ) : (
                      <button
                        onClick={igStart}
                        disabled={igLoading}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                        style={{ background: '#c0357a' }}
                      >
                        <Play size={11} />
                        {igLoading ? 'Запускаем...' : 'Запустить поиск'}
                      </button>
                    )}
                    <button onClick={loadIgStatus} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-text-s hover:text-text-p transition-colors" style={{ background: '#2d302d' }}>
                      <RefreshCw size={11} />
                    </button>
                  </div>

                  {igStatus.last_error && (
                    <div className="mt-3 rounded-lg px-3 py-2 text-xs text-red-400 leading-relaxed" style={{ background: '#3a1a1a', border: '1px solid #5a2a2a' }}>
                      <span className="font-semibold">Ошибка: </span>{igStatus.last_error}
                    </div>
                  )}

                  {/* Лимиты — полный контроль над активностью парсера */}
                  {igLimits && (
                    <div className="mt-4 rounded-lg px-3 py-3" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                      <div className="text-text-p text-xs font-medium mb-1">Лимиты активности</div>
                      <div className="text-text-m text-[10px] mb-3">
                        Сегодня: {igStatus?.today?.comments ?? 0}/{igLimits.comments_per_day} комментариев · {igStatus?.today?.dms ?? 0}/{igLimits.dms_per_day} DM
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {[
                          { key: 'comments_per_day', label: 'Комментарии/день', min: 1, max: 200 },
                          { key: 'dms_per_day', label: 'DM/день', min: 1, max: 100 },
                          { key: 'delay_min', label: 'Пауза от (сек)', min: 5, max: 600 },
                          { key: 'delay_max', label: 'Пауза до (сек)', min: 5, max: 900 },
                        ].map(f => (
                          <div key={f.key}>
                            <div className="text-[10px] text-text-m mb-1">{f.label}</div>
                            <input
                              type="number" min={f.min} max={f.max}
                              value={igLimits[f.key] ?? ''}
                              onChange={e => setIgLimits(prev => ({ ...prev, [f.key]: e.target.value }))}
                              className="w-full rounded-lg px-2 py-1.5 text-xs text-text-p outline-none text-center"
                              style={{ background: '#222520', border: '1px solid #2d302d' }}
                            />
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={saveIgLimits}
                        disabled={limitsSaving}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-accent text-white hover:bg-accent-dim transition-colors disabled:opacity-40"
                      >
                        {limitsSaving ? 'Сохраняем...' : 'Сохранить лимиты'}
                      </button>
                    </div>
                  )}

                  <div className="mt-4 rounded-lg px-3 py-3 text-[10px] text-text-m leading-relaxed" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                    <div className="font-semibold text-text-s mb-1.5">Как работает:</div>
                    <div className="space-y-1">
                      <div>1. Ищет посты бизнесов по хэштегам (#атырау, #кафеатырау...)</div>
                      <div>2. AI определяет язык (RU/KZ) и тип бизнеса</div>
                      <div>3. Генерирует живой комментарий → ты одобряешь</div>
                      <div>4. Ждёт ответа автора поста</div>
                      <div>5. Генерирует DM-оффер → ты одобряешь → отправляет</div>
                    </div>
                  </div>
                </div>
              )}

              {!igStatus && (
                <div className="text-text-m text-xs py-4 text-center">Бэкенд недоступен</div>
              )}
            </div>

            {/* Right: stats */}
            <div className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Статистика сессии</div>
              {igStatus?.logged_in ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Постов изучено', value: igStatus.stats?.scanned ?? 0, icon: <RefreshCw size={13} className="text-text-m" /> },
                    { label: 'Комментариев', value: igStatus.stats?.commented ?? 0, icon: <Camera size={13} className="text-pink-400" />, accent: true },
                    { label: 'Ответили', value: igStatus.stats?.replies ?? 0, icon: <CheckCircle size={13} className="text-emerald-400" />, green: true },
                    { label: 'DM отправлено', value: igStatus.stats?.dms_sent ?? 0, icon: <Send size={13} className="text-accent" />, hot: true },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl px-3 py-2.5" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
                      <div className="flex items-center gap-1.5 mb-1">{s.icon}<span className="text-[10px] text-text-m">{s.label}</span></div>
                      <div className={`text-lg font-bold ${s.hot ? 'text-accent' : s.green ? 'text-emerald-400' : s.accent ? 'text-pink-400' : 'text-text-p'}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-text-m text-xs py-4 text-center opacity-50">
                  Войдите в Instagram для начала работы
                </div>
              )}

              {/* Pending queue count badges */}
              {(pendingComments.length > 0 || pendingDms.length > 0) && (
                <div className="mt-4 space-y-2">
                  {pendingComments.length > 0 && (
                    <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: '#1a2510', border: '1px solid #3a4a20' }}>
                      <span className="text-xs text-emerald-400">Комментарии ждут одобрения</span>
                      <span className="text-xs font-bold text-emerald-300 bg-emerald-900/30 px-2 py-0.5 rounded-full">{pendingComments.length}</span>
                    </div>
                  )}
                  {pendingDms.length > 0 && (
                    <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: '#251520', border: '1px solid #4a2535' }}>
                      <span className="text-xs text-pink-400">DM-офферы ждут одобрения</span>
                      <span className="text-xs font-bold text-pink-300 bg-pink-900/30 px-2 py-0.5 rounded-full">{pendingDms.length}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Comment Review Queue ── */}
          {pendingComments.length > 0 && (
            <div className="border-t border-[#2d302d] p-4">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
                    Очередь комментариев ({igStatus?.pending_comments_total ?? pendingComments.length})
                  </div>
                  <span className="text-[10px] text-text-m">— одобри или отклони каждый перед публикацией</span>
                </div>
                <button
                  onClick={rejectAllComments}
                  disabled={rejectingAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-40"
                  style={{ background: '#2d1a1a', border: '1px solid #5a2a2a' }}
                >
                  <X size={11} />
                  {rejectingAll ? 'Очищаем...' : 'Отклонить все'}
                </button>
              </div>
              <div className="space-y-3">
                {pendingComments.map((item) => (
                  <div key={item.id || item.post_shortcode} className="rounded-xl overflow-hidden" style={{ background: '#1a1d1a', border: '1px solid #2d4a20' }}>
                    <div className="px-4 py-2.5 border-b border-[#2d302d] flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <a href={item.post_url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-pink-400 hover:underline">
                          @{item.author}
                        </a>
                        <span className="text-[10px] px-2 py-0.5 rounded-full text-text-m" style={{ background: '#2d302d' }}>
                          {item.business_type}
                        </span>
                        <span className="text-[10px] text-text-m uppercase">{item.language}</span>
                      </div>
                      <a href={item.post_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-m hover:text-text-s flex items-center gap-1">
                        <Eye size={10} />
                        Открыть пост
                      </a>
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-[10px] text-text-m mb-1.5">Пост (фрагмент):</div>
                      <div className="text-xs text-text-m leading-relaxed mb-3 line-clamp-2 italic">"{item.caption}"</div>
                      <div className="text-[10px] text-emerald-400 mb-1.5">Комментарий AI:</div>
                      <div className="text-xs text-text-p leading-relaxed mb-3 rounded-lg px-3 py-2" style={{ background: '#1a2510', border: '1px solid #3a4a20' }}>
                        {item.comment_text}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => approveComment(item)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
                          style={{ background: '#3a6a20' }}
                        >
                          <CheckCircle size={11} />
                          Опубликовать
                        </button>
                        <button
                          onClick={() => rejectComment(item)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-red-400 transition-colors hover:bg-red-900/20"
                          style={{ background: '#2d1a1a', border: '1px solid #5a2a2a' }}
                        >
                          <X size={11} />
                          Отклонить
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── DM Review Queue ── */}
          {pendingDms.length > 0 && (
            <div className="border-t border-[#2d302d] p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-pink-400">
                  Очередь DM-офферов ({pendingDms.length})
                </div>
                <span className="text-[10px] text-text-m">— {pendingDms.length === 1 ? 'этот автор' : 'эти авторы'} ответил(и) на комментарий</span>
              </div>
              <div className="space-y-3">
                {pendingDms.map((item) => {
                  const dmText = editingDm[item.action_id] ?? item.dm_text
                  const isEditing = editingDm[item.action_id] !== undefined
                  return (
                    <div key={item.id || item.action_id} className="rounded-xl overflow-hidden" style={{ background: '#1a1d1a', border: '1px solid #4a2535' }}>
                      <div className="px-4 py-2.5 border-b border-[#2d302d] flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <a href={`https://instagram.com/${item.author}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-pink-400 hover:underline">
                            @{item.author}
                          </a>
                          <span className="text-[10px] px-2 py-0.5 rounded-full text-text-m" style={{ background: '#2d302d' }}>
                            {item.business_type}
                          </span>
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <CheckCircle size={9} />
                            Ответил на комментарий
                          </span>
                        </div>
                      </div>
                      <div className="px-4 py-3">
                        <div className="text-[10px] text-text-m mb-1.5">Их ответ:</div>
                        <div className="text-xs text-text-s leading-relaxed mb-3 italic">"{item.reply_text}"</div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="text-[10px] text-pink-400">DM-оффер AI:</div>
                          {!isEditing && (
                            <button
                              onClick={() => setEditingDm(prev => ({ ...prev, [item.action_id]: item.dm_text }))}
                              className="flex items-center gap-1 text-[10px] text-text-m hover:text-text-p transition-colors"
                            >
                              <Edit3 size={9} />
                              Редактировать
                            </button>
                          )}
                        </div>
                        {isEditing ? (
                          <textarea
                            value={dmText}
                            onChange={e => setEditingDm(prev => ({ ...prev, [item.action_id]: e.target.value }))}
                            rows={5}
                            className="w-full rounded-lg px-3 py-2.5 text-xs text-text-p leading-relaxed resize-none outline-none mb-3"
                            style={{ background: '#251520', border: '1px solid #c0357a55' }}
                          />
                        ) : (
                          <div className="text-xs text-text-p leading-relaxed whitespace-pre-line mb-3 rounded-lg px-3 py-2" style={{ background: '#251520', border: '1px solid #4a2535' }}>
                            {dmText}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => approveDm(item)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
                            style={{ background: '#c0357a' }}
                          >
                            <Send size={11} />
                            Отправить DM
                          </button>
                          <button
                            onClick={() => rejectDm(item)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-red-400 transition-colors hover:bg-red-900/20"
                            style={{ background: '#2d1a1a', border: '1px solid #5a2a2a' }}
                          >
                            <X size={11} />
                            Пропустить
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Prompt Editor ────────────────────────────────────────────────────── */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">Редактор шаблонов</div>
        <div className="rounded-xl overflow-hidden" style={{ background: '#222520', border: '1px solid #2d302d' }}>
          <div className="p-4 border-b border-[#2d302d]">
            <div className="flex flex-wrap gap-3">
              <div className="relative">
                <select
                  value={selectedBusiness}
                  onChange={e => setSelectedBusiness(e.target.value)}
                  className="appearance-none bg-sidebar-hover border border-border text-text-p text-xs rounded-lg px-3 py-2 pr-8 outline-none focus:border-accent/50 cursor-pointer"
                >
                  {businessTypes.map(bt => (
                    <option key={bt.id} value={bt.id}>{bt.label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-m pointer-events-none" />
              </div>

              <div className="flex gap-1">
                {[
                  { id: 'comment_ru', label: 'Комментарий RU' },
                  { id: 'offer_ru', label: 'Оффер RU' },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setPromptType(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      promptType === t.id
                        ? 'bg-accent/15 text-accent border border-accent/25'
                        : 'text-text-s hover:bg-sidebar-hover'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#2d302d]">
            <div className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">Промпт</div>
              <textarea
                value={currentPrompt}
                rows={8}
                readOnly
                className="w-full rounded-lg px-3 py-2.5 text-xs text-text-s font-mono resize-none outline-none leading-relaxed"
                style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}
              />
            </div>

            <div className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-2">Тест промпта</div>
              <textarea
                value={testInput}
                onChange={e => setTestInput(e.target.value)}
                placeholder="Введите пост или сообщение лида для теста..."
                rows={4}
                className="w-full rounded-lg px-3 py-2.5 text-xs text-text-p resize-none outline-none leading-relaxed mb-2"
                style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}
                onFocus={e => e.target.style.borderColor = '#7A8B69'}
                onBlur={e => e.target.style.borderColor = '#2d302d'}
              />
              <button
                onClick={runTest}
                disabled={!testInput.trim() || testLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent-dim transition-colors disabled:opacity-40 mb-3"
              >
                <Play size={12} />
                {testLoading ? 'Генерируем...' : 'Тест (demo)'}
              </button>

              {testOutput && (
                <div className="rounded-lg px-3 py-2.5 text-xs text-text-p leading-relaxed whitespace-pre-wrap"
                  style={{ background: '#1a1d1a', border: '1px solid #3a4a32' }}>
                  <div className="text-[10px] text-accent font-semibold mb-1.5">AI-ответ (демо)</div>
                  {testOutput}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
