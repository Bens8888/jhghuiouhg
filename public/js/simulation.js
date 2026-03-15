// =============================================
// PLUG & PLAY — PRODUCTION SIMULATION ENGINE
// =============================================

const Simulation = {
  _interval: null,
  _statsInterval: null,
  _baseProduced: 173,
  _currentProduced: 173,

  // Start live simulation updates
  start(statsCallback) {
    this._statsInterval = setInterval(() => {
      this._tick(statsCallback);
    }, 30000); // Update every 30 seconds
  },

  stop() {
    clearInterval(this._statsInterval);
  },

  // Simulate realistic production tick
  _tick(callback) {
    const hour = new Date().getHours();

    // Production rate varies by time of day
    // Peaks: 10am-12pm, 2pm-5pm (manufacturing hours)
    const hourlyRates = [0,0,0,0,0,0,1,2,3,5,7,8,8,6,7,8,7,6,5,4,3,2,1,0];
    const rate = hourlyRates[hour] || 1;
    const tick = Math.floor(Math.random() * rate * 2 + rate);

    this._currentProduced += tick;

    if (callback) {
      callback({
        produced: this._currentProduced,
        tick,
      });
    }
  },

  // Calculate realistic orders ahead of you (based on order age and position)
  calculateQueuePosition(orderAge, ordersInQueue) {
    // Older orders are further ahead — newer orders have more ahead
    // Order age in hours, assume orders process at ~20/hr peak, ~5/hr slow
    const avgHourlyRate = 12;
    const processed = Math.floor(orderAge * avgHourlyRate * 0.1); // rough estimate
    const ahead = Math.max(0, Math.min(ordersInQueue, ordersInQueue - processed));
    return Math.max(0, Math.floor(ahead * (1 - Math.min(1, orderAge / (14 * 24)))));
  },

  // Generate fake but realistic activity message
  generateActivity() {
    const templates = [
      { type: 'production', icon: 'factory', msgs: [
        () => `Production team completed ${Math.floor(Math.random()*20+8)} items — quality checks passing`,
        () => `Batch #${Math.floor(Math.random()*5+22)} production update: ${Math.floor(Math.random()*15+10)} units assembled`,
        () => `Manufacturing throughput running at ${Math.floor(Math.random()*10+85)}% capacity today`,
      ]},
      { type: 'shipped', icon: 'truck', msgs: [
        () => `${Math.floor(Math.random()*10+5)} orders dispatched via AusPost Express`,
        () => `Courier pickup confirmed — ${Math.floor(Math.random()*8+3)} packages on the way`,
        () => `Afternoon dispatch complete: ${Math.floor(Math.random()*12+6)} shipments processed`,
      ]},
      { type: 'update', icon: 'zap', msgs: [
        () => 'Quality control passed — all recent orders cleared for dispatch',
        () => 'Production materials restocked — zero delays expected',
        () => `Batch completed on schedule — ${Math.floor(Math.random()*5+2)} days ahead of estimate`,
      ]},
    ];

    const cat = templates[Math.floor(Math.random() * templates.length)];
    const msg = cat.msgs[Math.floor(Math.random() * cat.msgs.length)]();
    return { type: cat.type, icon: cat.icon, message: msg, time: new Date().toISOString() };
  },

  // Dynamic confidence score with slight variation
  getConfidenceScore(base) {
    const hour = new Date().getHours();
    // Higher confidence during peak hours
    const peakBonus = (hour >= 9 && hour <= 17) ? 5 : -3;
    const noise = (Math.random() - 0.5) * 6;
    return Math.min(99, Math.max(60, Math.round(base + peakBonus + noise)));
  },

  // Dynamic estimate adjustment
  getDynamicEstimate(baseEstimate, delayDays) {
    const base = new Date(baseEstimate);
    base.setDate(base.getDate() + (delayDays || 0));
    return base.toISOString();
  },
};

window.Simulation = Simulation;
