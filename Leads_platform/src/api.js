// Dev: Vite proxy strips /api → FastAPI. Prod: same domain, no prefix needed.
const BASE = import.meta.env.PROD ? '' : '/api'

function scoreFromStatus(status, isHot) {
  const base = { found: 30, messaged: 45, replied: 65, interested: 80, converted: 100 }
  return (base[status] || 30) + (isHot ? 10 : 0)
}

function normalizeLead(l) {
  const name = l.name || 'Неизвестно'
  return {
    id: l.id,
    name,
    avatar: name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase(),
    businessType: l.business_type || '',
    channel: l.channel || '',
    status: l.status || 'found',
    isHot: l.is_hot || false,
    language: l.language || 'ru',
    phone: l.phone || '',
    city: 'Атырау',
    lastMessage: l.last_message || '',
    notes: l.notes || '',
    score: scoreFromStatus(l.status, l.is_hot),
    profileUrl: l.profile_url || '',
    createdAt: l.created_at,
    updatedAt: l.updated_at,
    messages: [],
  }
}

function normalizeMessage(m) {
  return {
    id: m.id,
    direction: m.direction,
    text: m.text,
    approved: m.approved_by_human,
    createdAt: m.created_at,
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const api = {
  async getLeads(params = {}) {
    const q = new URLSearchParams(params).toString()
    const data = await request(`/leads${q ? '?' + q : ''}`)
    return data.leads.map(normalizeLead)
  },

  async getLead(id) {
    const data = await request(`/leads/${id}`)
    return normalizeLead(data)
  },

  async createLead(lead) {
    const data = await request('/leads', {
      method: 'POST',
      body: JSON.stringify({
        name: lead.name,
        phone: lead.phone,
        channel: lead.channel,
        business_type: lead.businessType,
        language: lead.language,
        status: lead.status,
        source: lead.source || 'inbound',
        last_message: lead.lastMessage,
        notes: lead.notes,
        is_hot: lead.isHot,
        profile_url: lead.profileUrl,
      }),
    })
    return normalizeLead(data)
  },

  async updateLead(id, updates) {
    const body = {}
    if (updates.status !== undefined) body.status = updates.status
    if (updates.notes !== undefined) body.notes = updates.notes
    if (updates.isHot !== undefined) body.is_hot = updates.isHot
    if (updates.lastMessage !== undefined) body.last_message = updates.lastMessage
    if (updates.businessType !== undefined) body.business_type = updates.businessType
    const data = await request(`/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    return normalizeLead(data)
  },

  async getMessages(leadId) {
    const data = await request(`/leads/${leadId}/messages`)
    return data.messages.map(normalizeMessage)
  },

  async addMessage(leadId, { direction, text, approved = false }) {
    const data = await request(`/leads/${leadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ direction, text, approved_by_human: approved }),
    })
    return normalizeMessage(data)
  },

  async deleteLead(id) {
    return request(`/leads/${id}`, { method: 'DELETE' })
  },

  async getStats() {
    return request('/stats')
  },

  async ping() {
    try {
      await fetch(`${BASE}/stats`, { signal: AbortSignal.timeout(2000) })
      return true
    } catch {
      return false
    }
  },
}
