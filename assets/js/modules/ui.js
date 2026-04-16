(function () {
  let lastToastSig = '';
  let lastToastAt = 0;
  let activeDialogCleanup = null;

  function showToast(message, type = 'info', duration = 4000) {
    try {
      const sig = `${type}:${(message || '').toString().trim()}`;
      const now = Date.now();
      if (sig && lastToastSig === sig && (now - lastToastAt) < 1500) return;
      lastToastSig = sig;
      lastToastAt = now;

      let container = document.getElementById('toastContainer');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'toast-close';
      close.textContent = 'x';
      close.addEventListener('click', () => { try { toast.remove(); } catch { } });

      const text = document.createElement('div');
      text.className = 'toast-text';
      text.textContent = (message || '').toString();

      toast.appendChild(close);
      toast.appendChild(text);
      container.appendChild(toast);

      setTimeout(() => {
        try { toast.remove(); } catch { }
      }, duration);
    } catch { }
  }

  function notify(message, type = 'info', options = {}) {
    const text = (message || '').toString();
    if (!text) return;
    if (options.alert === true) {
      try { alert(text); return; } catch { }
    }
    showToast(text, type, options.duration || 4000);
  }

  function ensureDialogModal_() {
    let modal = document.getElementById('appDecisionModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'appDecisionModal';
    modal.className = 'modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-card" style="max-width:560px">
        <div class="modal-head">
          <h3 id="appDecisionTitle">تأكيد</h3>
          <button type="button" class="close-btn" id="appDecisionClose" aria-label="إغلاق">×</button>
        </div>
        <div class="decision-dialog">
          <div id="appDecisionMessage" class="decision-dialog-message"></div>
          <div id="appDecisionInputGroup" class="form-group hidden">
            <label id="appDecisionInputLabel" class="label" for="appDecisionInput">البيان</label>
            <input id="appDecisionInput" class="control" type="text" />
            <textarea id="appDecisionTextarea" class="control hidden" rows="4"></textarea>
            <div id="appDecisionInputHint" class="decision-dialog-hint hidden"></div>
          </div>
          <div id="appDecisionStatus" class="decision-dialog-status hidden"></div>
        </div>
        <div class="decision-dialog-actions">
          <button type="button" id="appDecisionCancel" class="btn light" style="color:#1f2937;border-color:#e5e7eb">إلغاء</button>
          <button type="button" id="appDecisionConfirm" class="btn">تأكيد</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    return modal;
  }

  function openDecisionDialog(options = {}) {
    if (activeDialogCleanup) {
      try { activeDialogCleanup(null); } catch { }
      activeDialogCleanup = null;
    }

    const modal = ensureDialogModal_();
    const titleEl = document.getElementById('appDecisionTitle');
    const messageEl = document.getElementById('appDecisionMessage');
    const inputGroup = document.getElementById('appDecisionInputGroup');
    const inputLabel = document.getElementById('appDecisionInputLabel');
    const inputEl = document.getElementById('appDecisionInput');
    const textareaEl = document.getElementById('appDecisionTextarea');
    const hintEl = document.getElementById('appDecisionInputHint');
    const statusEl = document.getElementById('appDecisionStatus');
    const cancelBtn = document.getElementById('appDecisionCancel');
    const confirmBtn = document.getElementById('appDecisionConfirm');
    const closeBtn = document.getElementById('appDecisionClose');

    const title = (options.title || 'تأكيد').toString();
    const message = (options.message || '').toString();
    const cancelText = (options.cancelText || 'إلغاء').toString();
    const confirmText = (options.confirmText || 'تأكيد').toString();
    const inputMode = options.inputMode === 'textarea' ? 'textarea' : 'text';
    const inputEnabled = !!options.input;
    const required = !!options.required;
    const exact = (options.exactValue || '').toString();
    const danger = !!options.danger;
    const readOnly = !!options.readOnly;

    titleEl.textContent = title;
    messageEl.textContent = message;
    cancelBtn.textContent = cancelText;
    confirmBtn.textContent = confirmText;
    confirmBtn.style.background = danger ? '#b91c1c' : '';
    confirmBtn.style.color = '#ffffff';

    inputGroup.classList.toggle('hidden', !inputEnabled);
    hintEl.classList.add('hidden');
    hintEl.textContent = '';
    statusEl.classList.add('hidden');
    statusEl.textContent = '';

    inputEl.classList.toggle('hidden', inputEnabled && inputMode === 'textarea');
    textareaEl.classList.toggle('hidden', !inputEnabled || inputMode !== 'textarea');

    const activeInput = inputMode === 'textarea' ? textareaEl : inputEl;
    const inactiveInput = inputMode === 'textarea' ? inputEl : textareaEl;
    inactiveInput.value = '';

    if (inputEnabled) {
      inputLabel.textContent = (options.inputLabel || 'البيان').toString();
      activeInput.value = (options.inputValue || '').toString();
      activeInput.placeholder = (options.placeholder || '').toString();
      activeInput.readOnly = readOnly;
      if (exact) {
        hintEl.textContent = `اكتب ${exact} للتأكيد.`;
        hintEl.classList.remove('hidden');
      } else if (options.inputHint) {
        hintEl.textContent = (options.inputHint || '').toString();
        hintEl.classList.remove('hidden');
      }
    }

    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch { }

    return new Promise((resolve) => {
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        try {
          modal.classList.remove('show');
          modal.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('modal-open');
        } catch { }
        try { cleanup(); } catch { }
        activeDialogCleanup = null;
        resolve(value);
      };

      const submit = () => {
        if (!inputEnabled) {
          finish(true);
          return;
        }

        const value = (activeInput.value || '').toString().trim();
        if (required && !value) {
          statusEl.textContent = 'هذا الحقل مطلوب.';
          statusEl.classList.remove('hidden');
          try { activeInput.focus(); } catch { }
          return;
        }
        if (exact && value.toUpperCase() !== exact.toUpperCase()) {
          statusEl.textContent = `يجب كتابة ${exact} كما هو.`;
          statusEl.classList.remove('hidden');
          try { activeInput.focus(); } catch { }
          try { activeInput.select(); } catch { }
          return;
        }

        finish(value);
      };

      const onBackdropClick = (event) => {
        const card = modal.querySelector('.modal-card');
        if (card && card.contains(event.target)) return;
        finish(null);
      };

      const onKeydown = (event) => {
        if (event.key === 'Escape') {
          finish(null);
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey && (!inputEnabled || inputMode !== 'textarea')) {
          event.preventDefault();
          submit();
        }
      };

      const cleanup = () => {
        modal.removeEventListener('click', onBackdropClick);
        document.removeEventListener('keydown', onKeydown);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn.removeEventListener('click', onCancel);
        confirmBtn.removeEventListener('click', onConfirm);
      };

      const onCancel = () => finish(null);
      const onConfirm = () => submit();

      modal.addEventListener('click', onBackdropClick);
      document.addEventListener('keydown', onKeydown);
      cancelBtn.addEventListener('click', onCancel);
      closeBtn.addEventListener('click', onCancel);
      confirmBtn.addEventListener('click', onConfirm);

      activeDialogCleanup = finish;

      setTimeout(() => {
        try {
          if (inputEnabled) {
            activeInput.focus();
            if (readOnly && typeof activeInput.select === 'function') activeInput.select();
          }
          else confirmBtn.focus();
        } catch { }
      }, 0);
    });
  }

  async function confirmDialog(options = {}) {
    const result = await openDecisionDialog(options);
    return result === true;
  }

  async function promptDialog(options = {}) {
    return await openDecisionDialog({ ...options, input: true });
  }

  window.CharityUi = Object.freeze({
    showToast,
    notify,
    confirmDialog,
    promptDialog
  });
})();
