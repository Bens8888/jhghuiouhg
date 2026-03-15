// =============================================
// PLUG & PLAY — SHARED UTILITIES
// =============================================

const PNP = {
  // Format date
  formatDate(iso) {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  },

  // Format date range
  formatDateRange(minIso, maxIso) {
    if (!minIso) return 'Calculating...';
    const min = new Date(minIso);
    const max = new Date(maxIso);
    const minStr = min.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    const maxStr = max.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    return `${minStr} – ${maxStr}`;
  },

  // Time ago
  timeAgo(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },

  // Countdown to date
  countdown(iso) {
    if (!iso) return '';
    const diff = new Date(iso) - Date.now();
    if (diff <= 0) return 'Imminent';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return `in ${days}d ${hours}h`;
    return `in ${hours}h`;
  },

  // Issue type labels
  issueLabel(type) {
    const map = {
      not_shipped: "Order Hasn't Shipped",
      not_arrived: "Order Hasn't Arrived",
      damaged: "Item Arrived Damaged",
      refund: "Return / Refund Request",
      where_is_order: "Where Is My Order",
    };
    return map[type] || type;
  },

  // Status to CSS class
  statusClass(status) {
    const map = {
      paid: 'paid',
      pending: 'pending',
      fulfilled: 'shipped',
      unfulfilled: 'pending',
      shipped: 'shipped',
    };
    return map[status] || 'pending';
  },

  // Icon map (emoji fallback)
  activityIcon(iconName) {
    const map = {
      factory: '🏭',
      truck: '🚚',
      check: '✅',
      'check-circle': '✅',
      layers: '📦',
      zap: '⚡',
      rocket: '🚀',
      package: '📦',
      headphones: '🎧',
      'map-pin': '📍',
      settings: '⚙️',
      boxes: '📦',
    };
    return map[iconName] || '📋';
  },

  // Number with commas
  numFormat(n) {
    return Number(n).toLocaleString('en-AU');
  },

  // Escape HTML
  esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

window.PNP = PNP;
