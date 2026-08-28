import { useState, useEffect } from 'react'
import { Eye, EyeOff, Plus, Trash2, Bell, MessageCircle, MapPin, Send, Camera, CheckCircle2, Loader2, CloudOff } from 'lucide-react'

const BASE = import.meta.env.PROD ? '' : '/api'

const LS = {
  get: (key, fallback = '') => { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } },
  set: (key, val) => { try { localStorage.setItem(key, val) } catch {} },
}

async function saveToBackend(key, value) {
  try {
    await fetch(`${BASE}/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
      signal: AbortSignal.timeout(4000),
    })
  } catch {}
}

const ApiKeyField = ({ label, placeholder, storageKey, serverValue }) => {
  const [show, setShow] = useState(false)
  const [value, setValue] = useState(() => LS.get(storageKey))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // Sync server value to local if local is empty
  useEffect(() => {
    if (serverValue && !LS.get(storageKey)) {
      setValue(serverValue)
      LS.set(storageKey, serverValue)
    }
  }, [serverValue, storageKey])

  const save = async () => {
    setSaving(true)
    LS.set(storageKey, value)
    await saveToBackend(storageKey, value)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex items-center gap-3 py-3 border-b border-[#2d302d]">
      <span className="text-text-s text-sm w-44 flex-shrink-0">{label}</span>
      <div className="flex-1 relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-sidebar-hover border border-border rounded-lg px-3 py-2 text-xs text-text-p outline-none placeholder-text-m transition-colors"
          onFocus={e => e.target.style.borderColor = '#7A8B69'}
          onBlur={e => e.target.style.borderColor = '#2d302d'}
          onKeyDown={e => e.key === 'Enter' && save()}
        />
        <button
          onClick={() => setShow(v => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-m hover:text-text-s transition-colors"
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      {value && (
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent-dim transition-colors flex-shrink-0 disabled:opacity-60"
        >
          {saving
            ? <><Loader2 size={12} className="animate-spin" /> Сохраняем</>
            : saved
              ? <><CheckCircle2 size={12} /> Сохранено</>
              : <><CheckCircle2 size={12} /> Сохранить</>}
        </button>
      )}
    </div>
  )
}

const AccountCard = ({ icon, label, connected }) => (
  <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: '#222520', border: '1px solid #2d302d' }}>
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#2a2d2a' }}>
        {icon}
      </div>
      <div>
        <div className="text-text-p text-sm font-medium">{label}</div>
        <div className={`text-xs ${connected ? 'text-accent' : 'text-text-m'}`}>
          {connected ? '🟢 Подключён' : 'Не подключён'}
        </div>
      </div>
    </div>
    <button className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-s hover:text-text-p transition-colors" style={{ background: '#2d302d' }}>
      {connected ? 'Изменить' : 'Подключить'}
    </button>
  </div>
)

export default function Settings({ channels }) {
  const [workStart, setWorkStart] = useState('09:00')
  const [workEnd, setWorkEnd] = useState('18:00')
  const [tgNotify, setTgNotify] = useState(true)
  const [tgChatId, setTgChatId] = useState(() => LS.get('tg_chat_id'))
  const [tgTestStatus, setTgTestStatus] = useState(null)
  const [tgTestMsg, setTgTestMsg] = useState('')
  const [blacklist, setBlacklist] = useState(['+7 701 000 0000'])
  const [newPhone, setNewPhone] = useState('')
  const [serverKeys, setServerKeys] = useState({})
  const [backendOnline, setBackendOnline] = useState(null)

  // Load settings from backend on mount
  useEffect(() => {
    fetch(`${BASE}/settings`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.json())
      .then(data => {
        setServerKeys(data)
        setBackendOnline(true)
        // Sync all backend values to localStorage
        Object.entries(data).forEach(([k, v]) => { if (v) LS.set(k, v) })
        // Restore specific fields
        if (data.tg_chat_id) setTgChatId(data.tg_chat_id)
        if (data.work_start) setWorkStart(data.work_start)
        if (data.work_end) setWorkEnd(data.work_end)
      })
      .catch(() => setBackendOnline(false))
  }, [])

  const tgToken = LS.get('tg_bot_token') || serverKeys.tg_bot_token

  const saveChatId = async () => {
    LS.set('tg_chat_id', tgChatId)
    await saveToBackend('tg_chat_id', tgChatId)
  }

  const saveHours = async (start, end) => {
    await saveToBackend('work_start', start)
    await saveToBackend('work_end', end)
  }

  const sendTestMessage = async () => {
    const chatId = tgChatId.trim()
    if (!chatId) { setTgTestStatus('error'); setTgTestMsg('Введите ваш Chat ID'); return }

    setTgTestStatus('loading')
    setTgTestMsg('')
    await saveChatId()

    // Send via the backend — the bot token lives server-side (env), never in the
    // browser. It used to be sent from here with a token leaked by GET /settings.
    try {
      const res = await fetch(`${BASE}/telegram/test?chat_id=${encodeURIComponent(chatId)}`, {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        setTgTestStatus('ok')
        setTgTestMsg('Сообщение отправлено — проверьте Telegram')
      } else {
        const data = await res.json().catch(() => ({}))
        setTgTestStatus('error')
        setTgTestMsg(data.detail || 'Не удалось отправить. Проверь Chat ID и токен бота на сервере.')
      }
    } catch {
      setTgTestStatus('error')
      setTgTestMsg('Бэкенд недоступен')
    }
    setTimeout(() => setTgTestStatus(null), 5000)
  }

  const addToBlacklist = () => {
    if (newPhone.trim() && !blacklist.includes(newPhone.trim())) {
      setBlacklist(prev => [...prev, newPhone.trim()])
      setNewPhone('')
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl slide-in">
      <div className="mb-8 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-p tracking-tight">Настройки</h1>
          <p className="text-text-s text-sm mt-1">Конфигурация платформы BaiTech Lead Hub.</p>
        </div>
        {backendOnline === false && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-yellow-400" style={{ background: '#2a2516', border: '1px solid #4a3a1a' }}>
            <CloudOff size={13} />
            Бэкенд недоступен — ключи из localStorage
          </div>
        )}
        {backendOnline === true && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-accent" style={{ background: '#1a2a1a', border: '1px solid #3a4a3a' }}>
            <CheckCircle2 size={13} />
            Настройки синхронизированы с Supabase
          </div>
        )}
      </div>

      {/* Working hours */}
      <Section title="Рабочие часы агентов">
        <p className="text-text-m text-xs mb-4">Агенты работают только в эти часы. Вне рабочего времени — Smart Pause.</p>
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-text-m text-xs mb-1.5">Начало работы</label>
            <input
              type="time" value={workStart}
              onChange={e => { setWorkStart(e.target.value); saveHours(e.target.value, workEnd) }}
              className="bg-sidebar-hover border border-border rounded-lg px-3 py-2 text-sm text-text-p outline-none transition-colors"
              onFocus={e => e.target.style.borderColor = '#7A8B69'}
              onBlur={e => e.target.style.borderColor = '#2d302d'}
            />
          </div>
          <span className="text-text-m mt-5">—</span>
          <div>
            <label className="block text-text-m text-xs mb-1.5">Конец работы</label>
            <input
              type="time" value={workEnd}
              onChange={e => { setWorkEnd(e.target.value); saveHours(workStart, e.target.value) }}
              className="bg-sidebar-hover border border-border rounded-lg px-3 py-2 text-sm text-text-p outline-none transition-colors"
              onFocus={e => e.target.style.borderColor = '#7A8B69'}
              onBlur={e => e.target.style.borderColor = '#2d302d'}
            />
          </div>
        </div>
      </Section>

      {/* API Keys */}
      <Section title="API-ключи">
        <p className="text-text-m text-xs mb-4">
          Ключи (OpenAI, Telegram, WhatsApp) задаются переменными окружения на сервере (Railway).
          Их нельзя вводить и хранить в браузере — раньше они утекали через открытый API.
        </p>
        <div className="rounded-xl overflow-hidden" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
          <div className="px-4 pt-2">
            <div className="flex items-center gap-3 py-3">
              <span className="text-text-s text-sm w-44 flex-shrink-0">Instagram аккаунт</span>
              <div className="flex-1">
                {serverKeys.ig_username ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 size={12} />
                      @{serverKeys.ig_username}
                    </span>
                    <span className="text-[10px] text-text-m">— сессия сохранена. Управление в разделе Агенты.</span>
                  </div>
                ) : (
                  <span className="text-xs text-text-m">Войдите через раздел <span className="text-accent">Агенты → Instagram Outbound</span></span>
                )}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Connected accounts */}
      <Section title="Подключённые аккаунты">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AccountCard icon={<MessageCircle size={17} className="text-emerald-400" />} label="WhatsApp Business" connected={false} />
          <AccountCard icon={<Camera size={17} className="text-pink-400" />} label={`Instagram${serverKeys.ig_username ? ` · @${serverKeys.ig_username}` : ''}`} connected={!!serverKeys.ig_username} />
          <AccountCard icon={<Send size={17} className="text-sky-400" />} label="Telegram Bot" connected={!!tgToken} />
          <AccountCard icon={<MapPin size={17} className="text-blue-400" />} label="2GIS API" connected={false} />
        </div>
      </Section>

      {/* Telegram Notifications */}
      <Section title="Уведомления в Telegram">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-text-p text-sm font-medium">Уведомлять о горячих лидах</div>
            <div className="text-text-m text-xs mt-0.5">Получайте сообщение когда лид отвечает или набирает высокий score</div>
          </div>
          <label className="toggle-switch flex-shrink-0">
            <input type="checkbox" checked={tgNotify} onChange={e => setTgNotify(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        {tgNotify && (
          <div className="space-y-3">
            <div>
              <label className="block text-text-m text-xs mb-1.5">Ваш Telegram Chat ID</label>
              <div className="flex gap-2">
                <input
                  value={tgChatId}
                  onChange={e => setTgChatId(e.target.value)}
                  onBlur={saveChatId}
                  placeholder="12345678"
                  className="flex-1 bg-sidebar-hover border border-border rounded-lg px-3 py-2 text-sm text-text-p outline-none placeholder-text-m transition-colors font-mono"
                  onFocus={e => e.target.style.borderColor = '#7A8B69'}
                  onKeyDown={e => { if (e.key === 'Enter') { saveChatId(); sendTestMessage() } }}
                />
                <button
                  onClick={sendTestMessage}
                  disabled={tgTestStatus === 'loading'}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-dim transition-colors disabled:opacity-60"
                >
                  {tgTestStatus === 'loading'
                    ? <><Loader2 size={14} className="animate-spin" /> Отправка...</>
                    : <><Bell size={14} /> Тест</>}
                </button>
              </div>
            </div>

            {tgTestStatus === 'ok' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-accent" style={{ background: '#1a2a1a', border: '1px solid #3a4a3a' }}>
                <CheckCircle2 size={13} /> {tgTestMsg}
              </div>
            )}
            {tgTestStatus === 'error' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-red-400" style={{ background: '#2a1a1a', border: '1px solid #4a3a3a' }}>
                ⚠️ {tgTestMsg}
              </div>
            )}
            <div className="text-text-m text-xs">
              Узнать свой Chat ID: напишите <span className="font-mono text-text-s">@userinfobot</span> в Telegram.
            </div>
          </div>
        )}
      </Section>

      {/* Blacklist */}
      <Section title="Чёрный список">
        <p className="text-text-m text-xs mb-4">Этим номерам агенты никогда не напишут.</p>
        <div className="space-y-2 mb-3">
          {blacklist.map((phone, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: '#1a1d1a', border: '1px solid #2d302d' }}>
              <span className="text-text-s text-sm font-mono">{phone}</span>
              <button onClick={() => setBlacklist(prev => prev.filter((_, j) => j !== i))} className="text-text-m hover:text-hot transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newPhone}
            onChange={e => setNewPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addToBlacklist()}
            placeholder="+7 701 ..."
            className="flex-1 bg-sidebar-hover border border-border rounded-lg px-3 py-2 text-sm text-text-p outline-none placeholder-text-m transition-colors"
            onFocus={e => e.target.style.borderColor = '#7A8B69'}
            onBlur={e => e.target.style.borderColor = '#2d302d'}
          />
          <button onClick={addToBlacklist} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-text-s hover:text-text-p transition-colors" style={{ background: '#2d302d' }}>
            <Plus size={14} /> Добавить
          </button>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-8">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-text-m mb-3">{title}</div>
      <div className="rounded-xl p-5" style={{ background: '#222520', border: '1px solid #2d302d' }}>
        {children}
      </div>
    </div>
  )
}
