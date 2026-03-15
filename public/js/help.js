// =============================================
// PLUG & PLAY — HELP PAGE ENGINE
// =============================================

const HelpApp = {
  currentIssue: null,
  currentStep: 1,
  faqs: [],

  async init() {
    await this.loadFAQs();
    this.bindIssueButtons();
    this.bindFAQSearch();
    this.bindUploadZone();
    this.bindForm();
    this.setupStepBack();

    // Pre-fill order number from URL / session
    const urlOrder = new URLSearchParams(location.search).get('order');
    const sessionOrder = sessionStorage.getItem('pnp_help_order');
    const orderNum = urlOrder || sessionOrder;
    if (orderNum) {
      const el = document.getElementById('helpOrderNumber');
      if (el) el.value = orderNum;
    }
  },

  // =============================================
  // FAQs
  // =============================================
  async loadFAQs() {
    try {
      const res = await fetch('/api/faq');
      const data = await res.json();
      this.faqs = data.faqs || [];
      this.renderFAQs(this.faqs);
    } catch {
      this.renderFAQs([]);
    }
  },

  renderFAQs(faqs) {
    const list = document.getElementById('faqList');
    list.innerHTML = faqs.map((faq, i) => `
      <div class="faq-item" id="faq-${i}">
        <button class="faq-question" data-idx="${i}">
          ${escHtml(faq.q)}
          <svg class="faq-chevron" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
        <div class="faq-answer">${escHtml(faq.a)}</div>
      </div>
    `).join('');

    list.querySelectorAll('.faq-question').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const isOpen = item.classList.contains('open');
        list.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
        if (!isOpen) item.classList.add('open');
      });
    });
  },

  // =============================================
  // FAQ SEARCH
  // =============================================
  bindFAQSearch() {
    const input = document.getElementById('faqSearch');
    const suggestions = document.getElementById('faqSuggestions');

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();

      if (q.length < 2) {
        suggestions.style.display = 'none';
        return;
      }

      const matches = this.faqs.filter(faq =>
        faq.q.toLowerCase().includes(q) ||
        faq.a.toLowerCase().includes(q) ||
        (faq.tags || []).some(t => t.includes(q))
      );

      if (matches.length === 0) {
        suggestions.style.display = 'none';
        return;
      }

      suggestions.innerHTML = matches.slice(0, 3).map(faq => `
        <div class="faq-suggestion-item" data-q="${escHtml(faq.q)}">
          <div class="faq-suggestion-q">${escHtml(faq.q)}</div>
          <div class="faq-suggestion-a">${escHtml(faq.a)}</div>
        </div>
      `).join('');

      suggestions.style.display = 'block';
    });

    suggestions.addEventListener('click', (e) => {
      const item = e.target.closest('.faq-suggestion-item');
      if (!item) return;

      const q = item.dataset.q;
      const faq = this.faqs.find(f => f.q === q);
      if (faq) {
        // Scroll to and open matching FAQ
        const idx = this.faqs.indexOf(faq);
        const faqEl = document.getElementById(`faq-${idx}`);
        if (faqEl) {
          faqEl.classList.add('open');
          faqEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      suggestions.style.display = 'none';
      input.value = '';
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !suggestions.contains(e.target)) {
        suggestions.style.display = 'none';
      }
    });
  },

  // =============================================
  // ISSUE SELECTION
  // =============================================
  bindIssueButtons() {
    document.querySelectorAll('.issue-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const issue = btn.dataset.issue;
        this.selectIssue(issue);
      });
    });
  },

  selectIssue(issue) {
    this.currentIssue = issue;

    // Highlight selected
    document.querySelectorAll('.issue-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`.issue-btn[data-issue="${issue}"]`)?.classList.add('selected');

    // Set issue type in form
    document.getElementById('issueTypeInput').value = issue;

    // Update step 2 UI
    this.updateStep2Context(issue);

    // Go to step 2
    this.goToStep(2);
  },

  updateStep2Context(issue) {
    const contexts = {
      not_shipped: {
        title: 'My Order Hasn\'t Shipped',
        context: '<strong>Let\'s investigate.</strong> Our team will review your order\'s production status and provide an update within 24 hours. If there\'s an unexpected delay, we\'ll notify you immediately.',
        showProof: false,
        showRefundPolicy: false,
      },
      not_arrived: {
        title: 'My Order Hasn\'t Arrived',
        context: '<strong>Let\'s track it down.</strong> We\'ll check with the carrier and provide a detailed location update. Most delayed parcels arrive within 2-3 additional business days.',
        showProof: false,
        showRefundPolicy: false,
      },
      damaged: {
        title: 'Item Arrived Damaged',
        context: '<strong>We\'re really sorry about this.</strong> Please provide your contact details and optionally upload proof of the damage. You\'ll receive a private WhatsApp number to send photos/video for faster processing.',
        showProof: true,
        showRefundPolicy: false,
      },
      refund: {
        title: 'Return / Refund Request',
        context: '',
        showProof: false,
        showRefundPolicy: true,
      },
      where_is_order: {
        title: 'Where Is My Order?',
        context: '<strong>Let\'s get you an exact update.</strong> Our team will pinpoint exactly where your order is in production or transit and send you a detailed status update.',
        showProof: false,
        showRefundPolicy: false,
      },
    };

    const ctx = contexts[issue] || { title: 'Get Help', context: '', showProof: false, showRefundPolicy: false };

    document.getElementById('step2Title').textContent = ctx.title;
    document.getElementById('issueContext').innerHTML = ctx.context;
    document.getElementById('issueContext').style.display = ctx.context ? 'block' : 'none';
    document.getElementById('proofSection').style.display = ctx.showProof ? 'block' : 'none';
    document.getElementById('refundPolicy').style.display = ctx.showRefundPolicy ? 'flex' : 'none';
  },

  // =============================================
  // STEP NAVIGATION
  // =============================================
  goToStep(step) {
    this.currentStep = step;

    // Hide all steps
    for (let i = 1; i <= 3; i++) {
      const el = document.getElementById(`step${i}`);
      if (el) el.style.display = i === step ? 'block' : 'none';
    }

    // Update step indicator
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(`step${i}dot`);
      if (!dot) continue;
      if (i < step) { dot.className = 'step-dot done'; }
      else if (i === step) { dot.className = 'step-dot active'; }
      else { dot.className = 'step-dot'; }
    }

    const line1 = document.getElementById('line1');
    const line2 = document.getElementById('line2');
    if (line1) line1.className = step > 1 ? 'step-line active' : 'step-line';
    if (line2) line2.className = step > 2 ? 'step-line active' : 'step-line';

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  setupStepBack() {
    document.getElementById('backToStep1').addEventListener('click', () => {
      this.goToStep(1);
    });
  },

  // =============================================
  // FILE UPLOAD
  // =============================================
  bindUploadZone() {
    const zone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('proofFile');
    const preview = document.getElementById('filePreview');

    if (!zone) return;

    zone.addEventListener('click', () => fileInput.click());

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) {
        fileInput.files = e.dataTransfer.files;
        this.showFilePreview(e.dataTransfer.files[0], preview);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) {
        this.showFilePreview(fileInput.files[0], preview);
      }
    });
  },

  showFilePreview(file, preview) {
    preview.style.display = 'block';
    preview.innerHTML = `
      <div class="file-preview-item">
        <span>✅</span>
        <span>${escHtml(file.name)}</span>
        <span style="color:var(--text-muted);font-size:0.8rem">(${(file.size / 1024 / 1024).toFixed(1)} MB)</span>
      </div>
    `;
  },

  // =============================================
  // FORM SUBMISSION
  // =============================================
  bindForm() {
    const form = document.getElementById('ticketForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitTicketBtn');
      const errorDiv = document.getElementById('ticketFormError');

      const btnText = btn.querySelector('.btn-text');
      const btnLoader = btn.querySelector('.btn-loader');

      // Validate
      const name = form.querySelector('[name=customerName]').value.trim();
      const email = form.querySelector('[name=customerEmail]').value.trim();
      const orderNum = form.querySelector('[name=orderNumber]').value.trim();

      if (!name || !email || !orderNum) {
        errorDiv.textContent = 'Please fill in your name, email, and order number.';
        errorDiv.style.display = 'block';
        return;
      }

      if (!email.includes('@')) {
        errorDiv.textContent = 'Please enter a valid email address.';
        errorDiv.style.display = 'block';
        return;
      }

      // Show loader
      btnText.textContent = 'Submitting...';
      btnLoader.style.display = 'inline-flex';
      btn.disabled = true;
      errorDiv.style.display = 'none';

      try {
        const formData = new FormData(form);

        const res = await fetch('/api/ticket', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to submit ticket.');
        }

        // Show confirmation
        this.showConfirmation(data);

      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
        btnText.textContent = 'Submit Support Ticket';
        btnLoader.style.display = 'none';
        btn.disabled = false;
      }
    });
  },

  showConfirmation(data) {
    document.getElementById('ticketRefNum').textContent = data.referenceNumber;

    // Show WhatsApp section for damaged items
    const waSection = document.getElementById('whatsappSection');
    if (data.showWhatsApp && data.whatsappNumber) {
      waSection.style.display = 'block';
      const waLink = document.getElementById('whatsappBtn');
      const waMsg = encodeURIComponent(data.whatsappMessage || `Ticket ref: ${data.referenceNumber}`);
      const phone = data.whatsappNumber.replace(/\D/g, '');
      // Convert Australian number to international format
      const intlPhone = phone.startsWith('0') ? `61${phone.slice(1)}` : phone;
      waLink.href = `https://wa.me/${intlPhone}?text=${waMsg}`;
    } else {
      waSection.style.display = 'none';
    }

    this.goToStep(3);
  },
};

// =============================================
// HTML ESCAPE UTILITY
// =============================================
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============================================
// INIT
// =============================================
HelpApp.init();
