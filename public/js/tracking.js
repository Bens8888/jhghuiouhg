// =============================================
// PLUG & PLAY — TRACKING PAGE ENGINE
// =============================================

const TrackingApp = {
  data: null,

  async init() {
    // Load from sessionStorage (set by homepage form)
    const cached = sessionStorage.getItem('pnp_order_data');
    const orderNumber = new URLSearchParams(location.search).get('order');

    if (cached) {
      try {
        this.data = JSON.parse(cached);
        this.render();
        return;
      } catch {}
    }

    // If no session data, redirect home
    if (!orderNumber) {
      window.location.href = '/';
      return;
    }

    // Show error (needs to re-enter details for security)
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'flex';
    document.getElementById('errorMsg').textContent =
      'Your session has expired. Please re-enter your details to track your order.';
  },

  render() {
    const { order, stage, stageDetails, estimates, stats, activity, tickets, meta } = this.data;

    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('trackingContent').style.display = 'block';

    this.renderOrderSummary(order, stats, estimates);
    this.renderProgress(stage, stageDetails);
    this.renderTimeline(stage, stageDetails);
    this.renderStats(stats, order);
    this.renderQueue(stats, order.orderAge);
    this.renderMap(order.shippingAddress);
    this.renderActivity(activity);
    this.renderTickets(tickets);
    this.setupHelpButton(order.orderNumber);
    this.startLiveSimulation(stats);
  },

  // =============================================
  // ORDER SUMMARY
  // =============================================
  renderOrderSummary(order, stats, estimates) {
    // Order number badge
    document.getElementById('orderNumberBadge').textContent = order.orderNumber;

    // Order date
    document.getElementById('orderDate').textContent =
      `Placed on ${PNP.formatDate(order.createdAt)}`;

    // Status badge
    const badge = document.getElementById('orderStatusBadge');
    const status = order.shippedAt ? 'shipped' : order.financialStatus;
    badge.textContent = order.shippedAt ? 'Shipped' : (order.financialStatus === 'paid' ? 'Paid' : 'Pending');
    badge.className = `order-status-badge ${PNP.statusClass(status)}`;

    // Details grid
    document.getElementById('shippingMethod').textContent = order.shippingMethod || 'Standard Shipping';

    if (estimates.shipped) {
      document.getElementById('estShipDate').textContent = PNP.formatDate(estimates.estimatedShipDate);
    } else {
      document.getElementById('estShipDate').textContent =
        `~${PNP.formatDate(estimates.estimatedShipDate)}${stats.globalDelayDays > 0 ? ` (+${stats.globalDelayDays}d delay)` : ''}`;
    }

    document.getElementById('estDelivery').textContent =
      PNP.formatDateRange(estimates.estimatedDeliveryMin, estimates.estimatedDeliveryMax);

    // Tracking number
    if (order.trackingNumber) {
      document.getElementById('trackingCard').style.display = 'block';
      const tLink = document.getElementById('trackingLink');
      tLink.textContent = order.trackingNumber;
      if (order.trackingUrl) tLink.href = order.trackingUrl;
    }

    // Batch & confidence
    document.getElementById('batchNumber').textContent = stats.batchNumber;
    const conf = stats.confidenceScore;
    document.getElementById('confidenceScore').textContent = `${conf}%`;
    document.getElementById('confidenceScore').style.color =
      conf >= 85 ? 'var(--green)' : conf >= 70 ? 'var(--yellow)' : 'var(--red)';

    // Reassurance message
    const msgs = [
      'Your order is progressing normally through our production pipeline.',
      'We\'re working hard to get your order to you as fast as possible.',
      'Your order has been prioritised and is moving through production.',
      'Everything is on track — your order is in safe hands.',
    ];
    document.getElementById('reassuranceMsg').textContent = msgs[Math.floor(Math.random() * msgs.length)];

    // Items
    this.renderItems(order.lineItems);
  },

  renderItems(items) {
    const list = document.getElementById('itemsList');
    if (!items || !items.length) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:0.875rem">Item details not available</p>';
      return;
    }

    list.innerHTML = items.map(item => `
      <div class="item-row">
        <div class="item-qty">${PNP.esc(String(item.quantity))}</div>
        <div class="item-info">
          <div class="item-title">${PNP.esc(item.title)}</div>
          ${item.variant && item.variant !== 'Default Title' ?
            `<div class="item-variant">${PNP.esc(item.variant)}</div>` : ''}
        </div>
        <div class="item-price">$${parseFloat(item.price || 0).toFixed(2)}</div>
      </div>
    `).join('');
  },

  // =============================================
  // PROGRESS BAR
  // =============================================
  renderProgress(stage, stageDetails) {
    const pct = Math.round((stage / 7) * 100);
    const fill = document.getElementById('progressFill');
    const glow = document.getElementById('progressGlow');
    const pctEl = document.getElementById('progressPct');
    const labelEl = document.getElementById('currentStepLabel');
    const countdownEl = document.getElementById('countdownLabel');

    pctEl.textContent = `${pct}%`;

    // Color based on stage / delay
    const colorClass = stage <= 2 ? '' : stage >= 6 ? 'green' : '';
    fill.className = `progress-fill ${colorClass}`;
    fill.style.width = `${pct}%`;
    glow.style.width = `${pct}%`;

    const currentStage = stageDetails.find(s => s.step === stage);
    if (currentStage) {
      labelEl.textContent = currentStage.label;
    }

    // Countdown
    if (this.data.estimates && !this.data.estimates.shipped) {
      countdownEl.textContent = `Est. ship ${PNP.countdown(this.data.estimates.estimatedShipDate)}`;
    } else if (this.data.estimates.shipped) {
      countdownEl.textContent = `Est. delivery ${PNP.countdown(this.data.estimates.estimatedDeliveryMax)}`;
    }
  },

  // =============================================
  // TIMELINE
  // =============================================
  renderTimeline(currentStage, stageDetails) {
    const container = document.getElementById('timeline');

    container.innerHTML = stageDetails.map((step, idx) => {
      const isCompleted = step.step < currentStage;
      const isActive = step.step === currentStage;
      const isPending = step.step > currentStage;
      const isLast = idx === stageDetails.length - 1;

      const stateClass = isCompleted ? 'completed' : isActive ? 'active' : 'pending';

      const icons = {
        1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>',
        2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>',
        3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
        4: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M5.34 18.66l-1.41 1.41M20 12h-2M6 12H4M18.66 18.66l-1.41-1.41M6.76 6.76L5.35 5.35"/><circle cx="12" cy="12" r="9" stroke-dasharray="2 2"/></svg>',
        5: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10V20a1 1 0 01-1 1H4a1 1 0 01-1-1V10M23 4H1l2 6h18L23 4z"/></svg>',
        6: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
        7: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
      };

      return `
        <div class="timeline-step ${stateClass}">
          ${!isLast ? '<div class="timeline-line"></div>' : ''}
          <div class="timeline-dot-wrap">
            <div class="timeline-dot" data-step="${step.step}" title="${PNP.esc(step.label)}">
              ${icons[step.step] || ''}
            </div>
          </div>
          <div class="timeline-body">
            <div class="timeline-header">
              <span class="timeline-label">${PNP.esc(step.label)}</span>
              <div style="display:flex;align-items:center;gap:8px">
                ${isCompleted ? '<svg class="timeline-checkmark" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>' : ''}
                <button class="timeline-info-btn" data-step="${step.step}" aria-label="Learn more about this step">
                  <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
                </button>
              </div>
            </div>
            <div class="timeline-duration">
              ${isActive ? '⟳ Currently active · ' : ''}${PNP.esc(step.duration)}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind info popup buttons
    container.querySelectorAll('.timeline-info-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const stepNum = parseInt(btn.dataset.step);
        const step = stageDetails.find(s => s.step === stepNum);
        if (step) this.showPopup(step);
      });
    });
  },

  showPopup(step) {
    const icons = { 1:'📋', 2:'📦', 3:'⚙️', 4:'🏭', 5:'🎁', 6:'🚚', 7:'📍' };
    document.getElementById('popupIcon').textContent = icons[step.step] || '📋';
    document.getElementById('popupTitle').textContent = step.label;
    document.getElementById('popupDesc').textContent = step.description;
    document.getElementById('popupDuration').textContent = `Typical duration: ${step.duration}`;
    document.getElementById('popupOverlay').style.display = 'flex';
  },

  // =============================================
  // STATS
  // =============================================
  renderStats(stats) {
    document.getElementById('statProduced').textContent = PNP.numFormat(stats.ordersProducedToday);
    document.getElementById('statShipped').textContent = PNP.numFormat(stats.ordersShippedThisWeek);
    document.getElementById('statQueue').textContent = PNP.numFormat(stats.ordersInQueue);

    const conf = Simulation.getConfidenceScore(stats.confidenceScore);
    document.getElementById('statConfidence').textContent = `${conf}%`;
    document.getElementById('confBarFill').style.width = `${conf}%`;
  },

  // =============================================
  // QUEUE
  // =============================================
  renderQueue(stats, orderAge) {
    document.getElementById('queueBatch').textContent = stats.batchNumber;
    const ahead = Simulation.calculateQueuePosition(orderAge || 0, stats.ordersInQueue);
    document.getElementById('queueAhead').textContent = ahead > 0 ? PNP.numFormat(ahead) : 'Next in line!';
    if (ahead === 0) {
      document.getElementById('queueAhead').style.color = 'var(--green)';
    }
  },

  // =============================================
  // MAP
  // =============================================
  renderMap(addr) {
    const mapSection = document.getElementById('mapSection');
    if (!addr || !addr.address1) return;

    const addressStr = [addr.address1, addr.city, addr.province, addr.country].filter(Boolean).join(', ');
    const encoded = encodeURIComponent(addressStr);
    const googleMapsKey = window.GOOGLE_MAPS_KEY || '';

    mapSection.style.display = 'block';
    document.getElementById('deliveryAddress').textContent = `📍 ${addressStr}`;

    const mapContainer = document.getElementById('mapContainer');
    if (googleMapsKey) {
      mapContainer.innerHTML = `
        <iframe
          src="https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(googleMapsKey)}&q=${encoded}"
          allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade">
        </iframe>`;
    } else {
      // Fallback: link to Google Maps
      mapContainer.innerHTML = `
        <a href="https://maps.google.com/?q=${encoded}" target="_blank" rel="noopener"
           style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--accent-2);text-decoration:underline;font-size:0.875rem">
          📍 View delivery address on Google Maps
        </a>`;
    }
  },

  // =============================================
  // ACTIVITY FEED
  // =============================================
  renderActivity(items) {
    const feed = document.getElementById('activityFeed');
    if (!items || !items.length) {
      feed.innerHTML = '<p style="color:var(--text-muted);font-size:0.875rem">No recent activity</p>';
      return;
    }

    feed.innerHTML = items.map(item => `
      <div class="activity-item">
        <div class="activity-icon-wrap ${PNP.esc(item.type)}">
          ${PNP.activityIcon(item.icon)}
        </div>
        <div class="activity-body">
          <div class="activity-msg">${PNP.esc(item.message)}</div>
          <div class="activity-time">${PNP.timeAgo(item.time)}</div>
        </div>
      </div>
    `).join('');
  },

  // =============================================
  // TICKETS
  // =============================================
  renderTickets(tickets) {
    if (!tickets || !tickets.length) return;

    const section = document.getElementById('ticketsSection');
    const list = document.getElementById('ticketsList');
    section.style.display = 'block';

    const issueTypes = {
      not_shipped: "Hasn't Shipped",
      not_arrived: "Hasn't Arrived",
      damaged: "Item Damaged",
      refund: "Refund Request",
      where_is_order: "Order Location",
    };

    list.innerHTML = tickets.map(t => `
      <div class="ticket-row">
        <div class="ticket-row-left">
          <div class="ticket-issue">${PNP.esc(issueTypes[t.issue_type] || t.issue_type)}</div>
          <div class="ticket-ref">Ref: ${PNP.esc(t.reference_number || t.id.substring(0, 8))}</div>
          <div class="ticket-ref">${PNP.formatDate(t.created_at)}</div>
        </div>
        <span class="ticket-status-badge ${PNP.esc(t.status)}">${PNP.esc(t.status.replace('_', ' '))}</span>
      </div>
    `).join('');
  },

  // =============================================
  // HELP BUTTON
  // =============================================
  setupHelpButton(orderNumber) {
    const btn = document.getElementById('openHelpBtn');
    btn.href = `/help?order=${encodeURIComponent(orderNumber)}`;
    btn.addEventListener('click', (e) => {
      // Pass order number to help page
      sessionStorage.setItem('pnp_help_order', orderNumber);
    });
  },

  // =============================================
  // LIVE SIMULATION
  // =============================================
  startLiveSimulation(stats) {
    Simulation.start(({ produced }) => {
      document.getElementById('statProduced').textContent = PNP.numFormat(produced);

      // Occasionally add a new activity item
      if (Math.random() > 0.6) {
        const newActivity = Simulation.generateActivity();
        const feed = document.getElementById('activityFeed');
        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `
          <div class="activity-icon-wrap ${newActivity.type}">
            ${PNP.activityIcon(newActivity.icon)}
          </div>
          <div class="activity-body">
            <div class="activity-msg">${PNP.esc(newActivity.message)}</div>
            <div class="activity-time">Just now</div>
          </div>
        `;
        feed.insertBefore(item, feed.firstChild);

        // Keep max 8 items
        while (feed.children.length > 8) {
          feed.removeChild(feed.lastChild);
        }
      }

      // Confidence score variation
      const conf = Simulation.getConfidenceScore(stats.confidenceScore);
      document.getElementById('statConfidence').textContent = `${conf}%`;
      document.getElementById('confBarFill').style.width = `${conf}%`;
    });
  },
};

// =============================================
// POPUP CLOSE
// =============================================
document.getElementById('popupClose').addEventListener('click', () => {
  document.getElementById('popupOverlay').style.display = 'none';
});

document.getElementById('popupOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('popupOverlay')) {
    document.getElementById('popupOverlay').style.display = 'none';
  }
});

// =============================================
// INIT
// =============================================
TrackingApp.init();
