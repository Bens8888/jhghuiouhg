// =============================================
// PLUG & PLAY — ADMIN PANEL ENGINE
// =============================================

const adminApp = {
  token: null,
  currentPage: 1,
  currentTicketFilters: {},

  // =============================================
  // AUTH
  // =============================================
  async login(username, password) {
    const res = await fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) throw new Error(data.error || 'Login failed');

    this.token = data.token;
    localStorage.setItem('pnp_admin_token', data.token);
    return true;
  },

  authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
    };
  },

  logout() {
    localStorage.removeItem('pnp_admin_token');
    this.token = null;
    document.getElementById('adminApp').style.display = 'none';
    document.getElementById('loginOverlay').style.display = 'flex';
  },

  async apiGet(path) {
    const res = await fetch(path, { headers: this.authHeaders() });
    if (res.status === 401) { this.logout(); throw new Error('Session expired'); }
    return res.json();
  },

  async apiPatch(path, body) {
    const res = await fetch(path, {
      method: 'PATCH',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (res.status === 401) { this.logout(); throw new Error('Session expired'); }
    return res.json();
  },

  async apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (res.status === 401) { this.logout(); throw new Error('Session expired'); }
    return res.json();
  },

  // =============================================
  // INIT
  // =============================================
  async init() {
    // Check stored token
    const stored = localStorage.getItem('pnp_admin_token');
    if (stored) {
      this.token = stored;
      try {
        await this.loadDashboard();
        this.showApp();
      } catch {
        this.logout();
      }
    }

    // Login form
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById('loginError');
      const username = document.getElementById('adminUser').value.trim();
      const password = document.getElementById('adminPass').value;

      try {
        await this.login(username, password);
        await this.loadDashboard();
        this.showApp();
      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
      }
    });

    // Tab navigation
    document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

    // Ticket filters
    document.getElementById('ticketSearch').addEventListener('input',
      debounce(() => this.loadTickets(), 400));
    document.getElementById('ticketStatusFilter').addEventListener('change', () => this.loadTickets());
    document.getElementById('ticketPriorityFilter').addEventListener('change', () => this.loadTickets());

    // Ticket modal close
    document.getElementById('ticketModalClose').addEventListener('click', () => {
      document.getElementById('ticketModal').style.display = 'none';
    });

    // Delay slider
    const slider = document.getElementById('delaySlider');
    if (slider) {
      slider.addEventListener('input', () => {
        document.getElementById('delayLabel').textContent = `${slider.value} day${slider.value != 1 ? 's' : ''}`;
      });
    }
  },

  showApp() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('adminApp').style.display = 'flex';
    this.switchTab('dashboard');
  },

  // =============================================
  // TABS
  // =============================================
  switchTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = 'block';

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');

    // Load tab data
    switch (tab) {
      case 'dashboard': this.loadDashboard(); break;
      case 'tickets': this.loadTickets(); break;
      case 'production': this.loadProduction(); break;
      case 'behavior': this.loadBehavior(); break;
      case 'activity': this.loadActivity(); break;
    }
  },

  // =============================================
  // DASHBOARD
  // =============================================
  async loadDashboard() {
    try {
      const data = await this.apiGet('/admin/api/dashboard');

      // Stats
      document.getElementById('ds-produced').textContent = fmt(data.stats.ordersProducedToday);
      document.getElementById('ds-shipped').textContent = fmt(data.stats.ordersShippedThisWeek);
      document.getElementById('ds-queue').textContent = fmt(data.stats.ordersInQueue);
      document.getElementById('ds-openTickets').textContent = fmt(data.tickets.open);
      document.getElementById('ds-highPriority').textContent = fmt(data.tickets.highPriority);
      document.getElementById('ds-views').textContent = fmt(data.todayViews);

      // Sidebar badge
      const badge = document.getElementById('sidebarTicketBadge');
      if (data.tickets.open > 0) {
        badge.textContent = data.tickets.open;
        badge.style.display = 'inline-flex';
      }

      // Alert if open tickets
      const card = document.getElementById('ds-openTicketsCard');
      card.classList.toggle('alert', data.tickets.open > 0);

      // Angry customers
      const angryCont = document.getElementById('angryCustomers');
      if (data.angryCustomers.length === 0) {
        angryCont.innerHTML = '<p style="color:var(--text-muted);font-size:0.875rem">No frequent checkers in the last 24 hours.</p>';
      } else {
        angryCont.innerHTML = data.angryCustomers.map(c => `
          <div class="admin-list-row">
            <span>Order ${escHtml(c.order_number)}</span>
            <span style="color:var(--red);font-weight:700">${c.views} views in 24h</span>
            <button class="btn-secondary" onclick="adminApp.loadOrderDetail('${escHtml(c.order_number)}')">View Order</button>
          </div>
        `).join('');
      }

      // Recent tickets
      this.renderTicketTable(data.recentTickets, document.getElementById('dashRecentTickets'), true);

    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  },

  // =============================================
  // TICKETS
  // =============================================
  async loadTickets(page = 1) {
    this.currentPage = page;
    const search = document.getElementById('ticketSearch').value.trim();
    const status = document.getElementById('ticketStatusFilter').value;
    const priority = document.getElementById('ticketPriorityFilter').value;

    const params = new URLSearchParams({ page, limit: 20 });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);

    try {
      const data = await this.apiGet(`/admin/api/tickets?${params}`);
      const container = document.getElementById('ticketsTable');

      if (!data.tickets.length) {
        container.innerHTML = '<p style="color:var(--text-muted);padding:20px">No tickets found.</p>';
      } else {
        this.renderTicketTable(data.tickets, container, false);
      }

      // Pagination
      const totalPages = Math.ceil(data.total / 20);
      const pag = document.getElementById('ticketsPagination');
      pag.innerHTML = '';
      for (let i = 1; i <= Math.min(totalPages, 10); i++) {
        const btn = document.createElement('button');
        btn.className = `page-btn${i === page ? ' active' : ''}`;
        btn.textContent = i;
        btn.addEventListener('click', () => this.loadTickets(i));
        pag.appendChild(btn);
      }
    } catch (err) {
      console.error('Tickets load error:', err);
    }
  },

  renderTicketTable(tickets, container, compact = false) {
    container.innerHTML = `
      <div class="ticket-table">
        <div class="ticket-table-head">
          <div>Order</div>
          <div>Issue / Customer</div>
          <div>Status</div>
          <div>Priority</div>
          <div>Views</div>
          <div>Date</div>
        </div>
        ${tickets.map(t => `
          <div class="ticket-table-row" onclick="adminApp.openTicketModal('${t.id}')">
            <div>#${escHtml(t.order_number)}</div>
            <div>
              <div style="font-weight:600">${escHtml(issueLabel(t.issue_type))}</div>
              <div style="color:var(--text-muted);font-size:0.8rem">${escHtml(t.customer_name || t.customer_email || '—')}</div>
            </div>
            <div><span class="ticket-status-badge ${t.status}">${escHtml(t.status.replace('_',' '))}</span></div>
            <div><span class="priority-badge ${t.priority}">${t.priority}</span></div>
            <div style="color:var(--text-muted)">${t.total_views || 0}</div>
            <div style="color:var(--text-muted);font-size:0.8rem">${timeAgo(t.created_at)}</div>
          </div>
        `).join('')}
      </div>
    `;
  },

  async openTicketModal(ticketId) {
    const modal = document.getElementById('ticketModal');
    const content = document.getElementById('ticketModalContent');
    modal.style.display = 'flex';

    try {
      const data = await this.apiGet(`/admin/api/tickets/${ticketId}`);
      const { ticket, views, allTickets } = data;

      content.innerHTML = `
        <h2 style="font-size:1.2rem;font-weight:800;margin-bottom:20px">
          Ticket ${escHtml(ticket.reference_number || ticket.id.substring(0,8))}
        </h2>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
          <div class="modal-section"><div class="modal-label">Order</div><div class="modal-value">#${escHtml(ticket.order_number)}</div></div>
          <div class="modal-section"><div class="modal-label">Issue</div><div class="modal-value">${escHtml(issueLabel(ticket.issue_type))}</div></div>
          <div class="modal-section"><div class="modal-label">Customer</div><div class="modal-value">${escHtml(ticket.customer_name || '—')}</div></div>
          <div class="modal-section"><div class="modal-label">Email</div><div class="modal-value">${escHtml(ticket.customer_email || '—')}</div></div>
          <div class="modal-section"><div class="modal-label">Phone</div><div class="modal-value">${escHtml(ticket.customer_phone || '—')}</div></div>
          <div class="modal-section"><div class="modal-label">TikTok</div><div class="modal-value">${escHtml(ticket.tiktok_username || '—')}</div></div>
          <div class="modal-section"><div class="modal-label">Status</div><div class="modal-value"><span class="ticket-status-badge ${ticket.status}">${ticket.status}</span></div></div>
          <div class="modal-section"><div class="modal-label">Priority</div><div class="modal-value"><span class="priority-badge ${ticket.priority}">${ticket.priority}</span></div></div>
        </div>

        ${ticket.description ? `
          <div class="modal-section" style="margin-bottom:16px">
            <div class="modal-label">Customer Message</div>
            <div class="modal-value" style="background:rgba(255,255,255,0.02);padding:12px;border-radius:8px;border:1px solid var(--border);font-size:0.875rem;color:var(--text-muted)">${escHtml(ticket.description)}</div>
          </div>
        ` : ''}

        ${allTickets.length > 1 ? `
          <div class="modal-section" style="margin-bottom:16px">
            <div class="modal-label">All Tickets For This Order (${allTickets.length})</div>
            ${allTickets.map(t => `<div style="font-size:0.8rem;color:var(--text-muted);padding:4px 0">${t.issue_type} · ${t.status} · ${timeAgo(t.created_at)}</div>`).join('')}
          </div>
        ` : ''}

        <div style="margin-bottom:16px">
          <div class="modal-label" style="margin-bottom:8px">Admin Notes / Resolution</div>
          <textarea class="modal-note-input" id="adminNoteInput" placeholder="Add notes or resolution details...">${escHtml(ticket.admin_notes || '')}</textarea>
        </div>

        <div class="modal-actions">
          <button class="btn-close-ticket" onclick="adminApp.updateTicket('${ticket.id}', 'in_progress')">Mark In Progress</button>
          <button class="btn-approve" onclick="adminApp.closeTicket('${ticket.id}', 'Resolved — order confirmed fine')">Close as Resolved</button>
          <button class="btn-approve" onclick="adminApp.closeTicket('${ticket.id}', 'Approved — replacement/refund issued')">Approve & Close</button>
          <button class="btn-deny" onclick="adminApp.updateTicket('${ticket.id}', 'closed', 'Request denied')">Deny & Close</button>
        </div>
      `;
    } catch (err) {
      content.innerHTML = `<p style="color:var(--red)">Error loading ticket: ${err.message}</p>`;
    }
  },

  async updateTicket(id, status, resolution) {
    const notes = document.getElementById('adminNoteInput')?.value || '';
    try {
      await this.apiPatch(`/admin/api/tickets/${id}`, { status, resolution, adminNotes: notes });
      document.getElementById('ticketModal').style.display = 'none';
      this.loadTickets();
      if (this.currentStep !== undefined) this.loadDashboard();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  async closeTicket(id, resolution) {
    const notes = document.getElementById('adminNoteInput')?.value || '';
    try {
      await this.apiPost(`/admin/api/tickets/${id}/close`, {
        resolution: notes || resolution,
      });
      document.getElementById('ticketModal').style.display = 'none';
      this.loadTickets();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  // =============================================
  // ORDERS
  // =============================================
  async loadOrder() {
    const orderNum = document.getElementById('orderSearch').value.trim().replace('#', '');
    if (!orderNum) return;

    const detail = document.getElementById('orderDetail');
    detail.style.display = 'block';
    detail.innerHTML = '<p style="color:var(--text-muted)">Loading...</p>';

    try {
      const data = await this.apiGet(`/admin/api/orders/${orderNum}`);
      const order = data.shopifyData;
      const cache = data.orderCache;

      detail.innerHTML = `
        <div style="margin-top:20px">
          ${order ? `
            <div class="order-detail-grid" style="margin-bottom:20px">
              <div class="detail-card"><span class="detail-label">Order</span><span class="detail-value">${escHtml(order.orderNumber)}</span></div>
              <div class="detail-card"><span class="detail-label">Status</span><span class="detail-value">${escHtml(order.fulfillmentStatus)}</span></div>
              <div class="detail-card"><span class="detail-label">Placed</span><span class="detail-value">${timeAgo(order.createdAt)}</span></div>
              <div class="detail-card"><span class="detail-label">Total Views</span><span class="detail-value">${data.totalViews}</span></div>
              <div class="detail-card"><span class="detail-label">Open Tickets</span><span class="detail-value">${data.tickets.filter(t=>t.status==='open').length}</span></div>
            </div>
          ` : '<p style="color:var(--text-muted);margin-bottom:16px">Order not in cache yet — search for it on the tracking page first.</p>'}

          <div class="admin-section">
            <h3 style="font-weight:700;margin-bottom:16px">Admin Overrides</h3>
            <div class="order-control-row">
              <div class="form-group">
                <label class="form-label">Production Stage (1–7)</label>
                <input type="number" min="1" max="7" id="ov-stage" class="form-input" placeholder="Auto"
                  value="${cache?.production_stage || ''}" />
              </div>
              <div class="form-group">
                <label class="form-label">Batch Number</label>
                <input type="text" id="ov-batch" class="form-input" placeholder="e.g. #24"
                  value="${escHtml(cache?.batch_number || '')}" />
              </div>
              <div class="form-group">
                <label class="form-label">Priority Order</label>
                <select id="ov-priority" class="form-input">
                  <option value="0" ${!cache?.priority ? 'selected':''}>Normal</option>
                  <option value="1" ${cache?.priority === 1 ? 'selected':''}>High Priority</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="margin-bottom:16px">
              <label class="form-label">Admin Notes (visible internally only)</label>
              <textarea id="ov-notes" class="form-input form-textarea">${escHtml(cache?.admin_notes || '')}</textarea>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn-track" style="width:auto" onclick="adminApp.saveOrderOverride('${orderNum}')">Save Overrides</button>
              <button class="btn-approve" onclick="adminApp.saveOrderOverride('${orderNum}', true)">Force Mark as Shipped</button>
            </div>
          </div>

          ${data.tickets.length ? `
            <div class="admin-section">
              <h3 style="font-weight:700;margin-bottom:16px">Tickets (${data.tickets.length})</h3>
              ${data.tickets.map(t => `
                <div class="admin-list-row" style="cursor:pointer" onclick="adminApp.openTicketModal('${t.id}')">
                  <span>${escHtml(issueLabel(t.issue_type))}</span>
                  <span class="ticket-status-badge ${t.status}">${t.status}</span>
                  <span style="color:var(--text-muted);font-size:0.8rem">${timeAgo(t.created_at)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    } catch (err) {
      detail.innerHTML = `<p style="color:var(--red)">Error: ${err.message}</p>`;
    }
  },

  loadOrderDetail(orderNum) {
    this.switchTab('orders');
    document.getElementById('orderSearch').value = orderNum;
    setTimeout(() => this.loadOrder(), 100);
  },

  async saveOrderOverride(orderNum, forceShipped = false) {
    const stage = parseInt(document.getElementById('ov-stage').value) || 0;
    const batch = document.getElementById('ov-batch').value.trim();
    const priority = parseInt(document.getElementById('ov-priority').value) || 0;
    const notes = document.getElementById('ov-notes').value.trim();

    try {
      await this.apiPatch(`/admin/api/orders/${orderNum}`, {
        productionStage: forceShipped ? 7 : stage,
        batchNumber: batch,
        priority,
        adminNotes: notes,
        forceShipped,
      });
      alert('Saved successfully!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  // =============================================
  // PRODUCTION
  // =============================================
  async loadProduction() {
    try {
      const data = await this.apiGet('/admin/api/production');
      const today = data.today;

      if (today) {
        document.getElementById('pc-produced').value = today.orders_produced;
        document.getElementById('pc-shipped').value = today.orders_shipped;
        document.getElementById('pc-queue').value = today.orders_in_queue;
        document.getElementById('pc-batch').value = today.batch_number;
        document.getElementById('pc-confidence').value = today.confidence_score;
        document.getElementById('delaySlider').value = today.global_delay_days || 0;
        document.getElementById('delayLabel').textContent =
          `${today.global_delay_days || 0} day${today.global_delay_days != 1 ? 's' : ''}`;
      }

      // History table
      const hist = document.getElementById('productionHistory');
      hist.innerHTML = `
        <table class="history-table">
          <thead>
            <tr><th>Date</th><th>Produced</th><th>Shipped</th><th>Queue</th><th>Confidence</th><th>Delay</th></tr>
          </thead>
          <tbody>
            ${data.history.map(row => `
              <tr>
                <td>${row.stat_date}</td>
                <td>${row.orders_produced}</td>
                <td>${row.orders_shipped}</td>
                <td>${row.orders_in_queue}</td>
                <td>${row.confidence_score}%</td>
                <td>${row.global_delay_days || 0}d</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      console.error('Production load error:', err);
    }
  },

  async saveProduction() {
    const body = {
      ordersProduced: parseInt(document.getElementById('pc-produced').value),
      ordersShipped: parseInt(document.getElementById('pc-shipped').value),
      ordersInQueue: parseInt(document.getElementById('pc-queue').value),
      batchNumber: parseInt(document.getElementById('pc-batch').value),
      confidenceScore: parseInt(document.getElementById('pc-confidence').value),
      globalDelayDays: parseInt(document.getElementById('delaySlider').value),
    };

    try {
      await this.apiPatch('/admin/api/production', body);
      alert('Production settings saved!');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },

  // =============================================
  // BEHAVIOR
  // =============================================
  async loadBehavior() {
    try {
      const data = await this.apiGet('/admin/api/behavior');

      const topViewers = document.getElementById('topViewers');
      topViewers.innerHTML = data.topViewers.length ? data.topViewers.map(v => `
        <div class="admin-list-row">
          <span>Order #${escHtml(v.order_number)}</span>
          <span style="font-weight:700">${v.views} views</span>
          <span style="color:var(--text-muted);font-size:0.8rem">Last: ${timeAgo(v.last_view)}</span>
          <button class="btn-secondary" onclick="adminApp.loadOrderDetail('${escHtml(v.order_number)}')">View</button>
        </div>
      `).join('') : '<p style="color:var(--text-muted)">No data yet.</p>';

      const repeatOpeners = document.getElementById('repeatOpeners');
      repeatOpeners.innerHTML = data.repeatOpeners.length ? data.repeatOpeners.map(c => `
        <div class="admin-list-row">
          <span>#${escHtml(c.order_number)}</span>
          <span style="font-weight:700;color:var(--yellow)">${c.ticket_count} tickets</span>
          <span style="color:var(--text-muted)">${escHtml(c.customer_email || c.customer_name || '—')}</span>
        </div>
      `).join('') : '<p style="color:var(--text-muted)">No repeat openers yet.</p>';
    } catch (err) {
      console.error('Behavior load error:', err);
    }
  },

  // =============================================
  // ACTIVITY FEED
  // =============================================
  async loadActivity() {
    try {
      const data = await this.apiGet('/admin/api/activity');
      const list = document.getElementById('activityList');

      list.innerHTML = data.feed.map(item => `
        <div class="activity-admin-row">
          <div class="activity-admin-type" style="color:${typeColor(item.event_type)}">${item.event_type}</div>
          <div class="activity-admin-msg">${escHtml(item.message)}</div>
          <div class="activity-admin-time">${timeAgo(item.created_at)}</div>
        </div>
      `).join('');
    } catch (err) {
      console.error('Activity load error:', err);
    }
  },

  async postActivity() {
    const msg = document.getElementById('newActivity').value.trim();
    const type = document.getElementById('activityType').value;
    if (!msg) return;

    try {
      await this.apiPost('/admin/api/activity', { message: msg, eventType: type, icon: typeIcon(type) });
      document.getElementById('newActivity').value = '';
      this.loadActivity();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  },
};

// =============================================
// UTILITIES
// =============================================
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmt(n) { return Number(n || 0).toLocaleString('en-AU'); }

function timeAgo(iso) {
  if (!iso) return '—';
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return 'Just now';
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

function issueLabel(type) {
  const map = { not_shipped:"Hasn't Shipped", not_arrived:"Hasn't Arrived", damaged:"Damaged Item", refund:"Refund/Return", where_is_order:"Order Location" };
  return map[type] || type;
}

function typeColor(type) {
  const map = { production:'#a5b4fc', shipped:'#67e8f9', update:'#fcd34d', support:'#fca5a5' };
  return map[type] || 'var(--text-muted)';
}

function typeIcon(type) {
  const map = { production:'factory', shipped:'truck', update:'zap', support:'headphones' };
  return map[type] || 'package';
}

function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// =============================================
// INIT
// =============================================
window.adminApp = adminApp;
adminApp.init();
