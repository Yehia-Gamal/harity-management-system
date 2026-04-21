// State
const APP_VERSION = '20260416_2205';

let LastToastSig_ = '';
let LastToastAt_ = 0;

let AuthOpChain_ = Promise.resolve();

const CP1252_REVERSE_MAP_ = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);
const SUSPICIOUS_ARABIC_MOJIBAKE_PATTERN_ = /[ØÙÃâð]/;
const ARABIC_MOJIBAKE_SEGMENT_PATTERN_ =
  /[ØÙÃâð][0-9A-Za-z\u0080-\u017F\u0192\u02C6\u02DC\u201A-\u201E\u2018-\u201D\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122\s.,:;!?'"`()\-_/\\[\]{}|+=*<>%؟،]*/g;

function encodeCp1252Bytes_(value) {
  const bytes = [];
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }
    if (CP1252_REVERSE_MAP_.has(code)) {
      bytes.push(CP1252_REVERSE_MAP_.get(code));
      continue;
    }
    return null;
  }
  return Uint8Array.from(bytes);
}

function repairArabicMojibake_(value) {
  const text = (value == null ? '' : String(value));
  if (!text || !SUSPICIOUS_ARABIC_MOJIBAKE_PATTERN_.test(text)) return text;

  return text.replace(ARABIC_MOJIBAKE_SEGMENT_PATTERN_, (segment) => {
    const bytes = encodeCp1252Bytes_(segment);
    if (!bytes) return segment;
    try {
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (!decoded || decoded.includes('\ufffd')) return segment;
      const decodedArabicCount = (decoded.match(/[\u0600-\u06FF]/g) || []).length;
      const sourceArabicCount = (segment.match(/[\u0600-\u06FF]/g) || []).length;
      if (decodedArabicCount < sourceArabicCount) return segment;
      return decoded;
    } catch {
      return segment;
    }
  });
}

function repairArabicMojibakeInDom_(root) {
  const scope = root && root.nodeType ? root : document.body;
  if (!scope) return;

  const fixTextNode = (node) => {
    const current = node?.nodeValue || '';
    if (!SUSPICIOUS_ARABIC_MOJIBAKE_PATTERN_.test(current)) return;
    const next = repairArabicMojibake_(current);
    if (next && next !== current) node.nodeValue = next;
  };

  const fixElement = (element) => {
    if (!element || element.nodeType !== 1) return;
    ['title', 'aria-label', 'placeholder', 'alt', 'value'].forEach((attr) => {
      const current = element.getAttribute(attr);
      if (!current || !SUSPICIOUS_ARABIC_MOJIBAKE_PATTERN_.test(current)) return;
      const next = repairArabicMojibake_(current);
      if (next && next !== current) element.setAttribute(attr, next);
    });
  };

  if (scope.nodeType === Node.TEXT_NODE) {
    fixTextNode(scope);
    return;
  }

  if (scope.nodeType === Node.ELEMENT_NODE) {
    fixElement(scope);
  }

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current = walker.currentNode;
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) fixTextNode(current);
    if (current.nodeType === Node.ELEMENT_NODE) fixElement(current);
    current = walker.nextNode();
  }
}

function installArabicMojibakeGuard_() {
  if (window.__arabicMojibakeGuardInstalled__) return;
  window.__arabicMojibakeGuardInstalled__ = true;

  const run = () => repairArabicMojibakeInDom_(document.body);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    queueMicrotask(run);
  }

  try {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') {
          repairArabicMojibakeInDom_(mutation.target);
          return;
        }
        if (mutation.type === 'attributes') {
          repairArabicMojibakeInDom_(mutation.target);
          return;
        }
        mutation.addedNodes.forEach((node) => repairArabicMojibakeInDom_(node));
      });
    });
    observer.observe(document.documentElement || document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder', 'alt', 'value'],
    });
  } catch { }
}

installArabicMojibakeGuard_();

function isAuthLockError_(e) {
  try {
    const msg = (e?.message || e?.error_description || e?.toString?.() || '').toString().toLowerCase();
    return msg.includes('lock') || msg.includes('aborterror') || msg.includes('signal is aborted') || msg.includes('broken by another request');
  } catch { return false; }

  return false;
}

function getDefaultNewUserPermissions_() {
  // Minimal view-only permissions: dashboard + read cases
  return {
    dashboard: true,
    cases_read: true
  };
}

function buildCaseDiffText_(before, after) {
  const diffParts = [];
  try {
    const a0 = before && typeof before === 'object' ? before : {};
    const b0 = after && typeof after === 'object' ? after : {};
    const eq = (a, b) => {
      try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); } catch { return (a ?? '') === (b ?? ''); }
    };
    const add = (label, a, b) => {
      if (eq(a, b)) return;
      const aa = (a == null ? '' : String(a));
      const bb = (b == null ? '' : String(b));
      diffParts.push(`${label}: "${aa}" → "${bb}"`);
    };

    add('التقييم', a0.caseGrade, b0.caseGrade);
    add('اسم الحالة', a0.familyHead, b0.familyHead);
    add('الهاتف', a0.phone, b0.phone);
    add('واتساب', a0.whatsapp, b0.whatsapp);
    add('الحالة الاجتماعية', a0.maritalStatus, b0.maritalStatus);
    add('العنوان', a0.address, b0.address);
    add('المحافظة', a0.governorate, b0.governorate);
    add('المنطقة', a0.area, b0.area);
    add('عدد أفراد الأسرة', a0.familyCount, b0.familyCount);
    add('الفئة', a0.category, b0.category);
    add('الاستعجال', a0.urgency, b0.urgency);
    add('المستكشف', a0.explorerName, b0.explorerName);
    add('تاريخ البحث', a0.date, b0.date);
    add('منفذ (مبلغ)', a0.deliveredAmount, b0.deliveredAmount);
    add('وسوم', Array.isArray(a0.tags) ? a0.tags.join(', ') : '', Array.isArray(b0.tags) ? b0.tags.join(', ') : '');

    add('عمل الأب', a0.jobs?.father, b0.jobs?.father);
    add('عمل الأم', a0.jobs?.mother, b0.jobs?.mother);

    add('وصف السكن', a0.housing?.housingDesc, b0.housing?.housingDesc);
    add('عدد الغرف', a0.housing?.roomsCount, b0.housing?.roomsCount);
    add('حمام', a0.housing?.bathroomType, b0.housing?.bathroomType);
    add('مياه', a0.housing?.waterExists, b0.housing?.waterExists);
    add('سقف', a0.housing?.roofExists, b0.housing?.roofExists);
    add('نوع المنطقة', a0.housing?.areaType, b0.housing?.areaType);

    add('هل توجد ديون', a0.debts?.enabled ? 'نعم' : 'لا', b0.debts?.enabled ? 'نعم' : 'لا');
    add('قيمة الدين', a0.debts?.amount, b0.debts?.amount);
    add('جهة الدين', a0.debts?.owner, b0.debts?.owner);
    add('حكم قضائي', a0.debts?.hasCourtOrder, b0.debts?.hasCourtOrder);
    add('سبب الدين', a0.debts?.reason, b0.debts?.reason);

    add('إجمالي الدخل', a0.income?.total, b0.income?.total);
    add('ملاحظات الدخل', a0.income?.notes, b0.income?.notes);
    add('إجمالي المصروفات', a0.expenses?.total, b0.expenses?.total);
    add('ملاحظات المصروفات', a0.expenses?.notes, b0.expenses?.notes);
    add('صافي شهري', a0.netMonthly, b0.netMonthly);

    add('زواج: مفعل', a0.marriage?.enabled ? 'نعم' : 'لا', b0.marriage?.enabled ? 'نعم' : 'لا');
    add('اسم العروسة', a0.marriage?.brideName, b0.marriage?.brideName);
    add('اسم العريس', a0.marriage?.groomName, b0.marriage?.groomName);
    add('مهنة العريس', a0.marriage?.groomJob, b0.marriage?.groomJob);
    add('تاريخ كتب الكتاب', a0.marriage?.contractDate, b0.marriage?.contractDate);
    add('تاريخ الزواج', a0.marriage?.weddingDate, b0.marriage?.weddingDate);

    add('مشروع: مفعل', a0.project?.enabled ? 'نعم' : 'لا', b0.project?.enabled ? 'نعم' : 'لا');
    add('نوع المشروع', a0.project?.type, b0.project?.type);
    add('خبرة المشروع', a0.project?.experience, b0.project?.experience);
    add('احتياجات المشروع', a0.project?.needs, b0.project?.needs);

    if (!eq(a0.medicalCases || [], b0.medicalCases || [])) {
      diffParts.push('تم تعديل الجانب الطبي');
    }
  } catch { }
  return diffParts;
}

async function createUserFromUi_() {
  if (!requirePermUi_('users_manage', 'لا تملك صلاحية إدارة المستخدمين')) return;
  if (!requireDatabaseUi_('اتصال Supabase غير جاهز حالياً')) return;

  const hint = document.getElementById('modalNewUserHint') || document.getElementById('newUserHint');
  const email = (document.getElementById('modalNewUserEmail')?.value || document.getElementById('newUserEmail')?.value || '').toString().trim();
  const fallbackUsername = email.includes('@') ? email.split('@')[0] : email;
  const username = (document.getElementById('modalNewUserUsername')?.value || document.getElementById('newUserUsername')?.value || '').toString().trim() || fallbackUsername;
  const name = (document.getElementById('modalNewUserName')?.value || document.getElementById('newUserName')?.value || '').toString().trim();
  const tempPassword = (document.getElementById('modalNewUserTempPassword')?.value || document.getElementById('newUserTempPassword')?.value || '').toString();

  if (hint) {
    hint.style.display = 'none';
    hint.textContent = '';
  }
  if (!email || !email.includes('@')) {
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = 'أدخل بريدًا إلكترونيًا صحيحًا';
    }
    return;
  }
  if (!DatabaseClient) {
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = 'الاتصال بـ Supabase غير جاهز حالياً';
    }
    return;
  }

  const permissions = getDefaultNewUserPermissions_();
  const password = tempPassword || randomTempPassword_();

  try {
    const res = await invokeAuthedEdgeFunction_('create-user', {
      body: {
        email,
        password,
        username,
        full_name: name || username,
        permissions
      }
    });
    if (res?.error) throw res.error;
    const createdId = res?.data?.user_id || '';
    try { await logAction('إنشاء مستخدم', '', `username: ${username} | email: ${email} | userId: ${createdId}`); } catch { }
    try { await renderUsersList(); } catch { }
    try { await prefillUser(username); } catch { }
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = `تم إنشاء المستخدم بنجاح. كلمة المرور المؤقتة: ${password}`;
    }
    clearAddUserForm_();
  } catch (e) {
    try { console.error('createUserFromUi_ error:', e); } catch { }
    const msg = await describeEdgeFunctionError_(e);
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = msg ? `تعذر إنشاء المستخدم: ${msg}` : 'تعذر إنشاء المستخدم';
    }
  }
}

function getSupabaseClient_() {
  return DatabaseClient?.raw || null;
}

async function invokeAuthedEdgeFunction_(name, options = {}) {
  if (!DatabaseClient?.functions?.invoke) throw new Error('database_client_not_ready');

  const sessionResult = await runAuthOp_(() => DatabaseClient.auth.getSession(), { retryLock: false });
  const token = (sessionResult?.data?.session?.access_token || '').toString().trim();
  if (!token) throw new Error('انتهت جلسة الدخول. سجل الخروج ثم ادخل مرة أخرى.');

  const headers = {
    ...(options?.headers && typeof options.headers === 'object' ? options.headers : {}),
    Authorization: `Bearer ${token}`,
  };

  return await DatabaseClient.functions.invoke(name, { ...(options || {}), headers });
}

async function describeEdgeFunctionError_(error) {
  const fallback = (error?.message || '').toString().trim();
  try {
    const response = error?.context;
    const status = Number(response?.status || 0) || 0;
    let code = '';
    try {
      const body = await response.clone().json();
      code = (body?.error || body?.message || '').toString().trim();
    } catch { }

    if (status === 401 || code === 'unauthorized') return 'جلسة الدخول غير صالحة أو انتهت. سجل الخروج ثم ادخل مرة أخرى.';
    if (status === 403 || code === 'forbidden') return 'الحساب الحالي لا يملك صلاحية إدارة المستخدمين على الخادم.';
    if (code === 'server_not_configured') return 'Edge Function غير مهيأة. تحقق من أسرار Supabase المطلوبة.';
    if (code === 'origin_not_allowed') return 'الدومين الحالي غير مسموح في ALLOWED_ORIGINS الخاصة بالـ Edge Function.';
    if (code === 'username_exists') return 'اسم المستخدم موجود بالفعل.';
    if (code === 'email_required') return 'البريد الإلكتروني مطلوب.';
    if (code === 'username_required') return 'اسم المستخدم مطلوب.';
    if (code === 'weak_password') return 'كلمة المرور المؤقتة ضعيفة.';
    if (code === 'auth_user_create_failed') return 'تعذر إنشاء حساب Supabase Auth. راجع البريد أو إعدادات Auth.';
    if (code === 'profile_create_failed') return 'تم إنشاء حساب Auth لكن تعذر إنشاء ملف المستخدم، وتمت محاولة التراجع.';
  } catch { }
  return fallback;
}

function clearAddUserForm_() {
  ['modalNewUserEmail', 'modalNewUserUsername', 'modalNewUserName', 'modalNewUserTempPassword', 'newUserEmail', 'newUserUsername', 'newUserName', 'newUserTempPassword'].forEach((id) => {
    try {
      const el = document.getElementById(id);
      if (el) el.value = '';
    } catch { }
  });
}

function openAddUserModal() {
  const modal = document.getElementById('addUserModal');
  if (!modal) return;
  clearAddUserForm_();
  try {
    const hint = document.getElementById('modalNewUserHint');
    if (hint) {
      hint.style.display = 'none';
      hint.textContent = '';
    }
  } catch { }
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  try { document.body.classList.add('modal-open'); } catch { }
  try { document.getElementById('modalNewUserEmail')?.focus?.(); } catch { }
}

function closeAddUserModal() {
  const modal = document.getElementById('addUserModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  try { document.body.classList.remove('modal-open'); } catch { }
  try { document.getElementById('openAddUserBtn')?.focus?.(); } catch { }
}

try {
  const setupAddUserModalClose_ = () => {
    const modal = document.getElementById('addUserModal');
    if (!modal || modal.getAttribute('data-wired-close') === '1') return;
    modal.setAttribute('data-wired-close', '1');
    modal.addEventListener('click', (event) => {
      const card = modal.querySelector('.modal-card');
      if (card && card.contains(event.target)) return;
      closeAddUserModal();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupAddUserModalClose_);
  else setupAddUserModalClose_();
} catch { }

function delay_(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function withTimeout_(p, ms, msg) {
  let t = null;
  try {
    const timeout = new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(msg || 'timeout')), ms);
    });
    return await Promise.race([p, timeout]);
  } finally {
    try { if (t) clearTimeout(t); } catch { }
  }
}

async function runAuthOp_(fn, { retryLock = true } = {}) {
  const exec = async () => {
    try {
      return await fn();
    } catch (e) {
      if (retryLock && isAuthLockError_(e)) {
        try { await delay_(250); } catch { }
        return await fn();
      }
      throw e;
    }
  };
  AuthOpChain_ = AuthOpChain_.then(exec, exec);
  return AuthOpChain_;
}

function showToast_(message, type = 'info', duration = 4000) {
  try {
    const sig = `${type}:${(message || '').toString().trim()}`;
    const now = Date.now();
    if (sig && LastToastSig_ === sig && (now - LastToastAt_) < 1500) return;
    LastToastSig_ = sig;
    LastToastAt_ = now;
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const msg = (message || '').toString();
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.textContent = '×';
    close.addEventListener('click', () => { try { toast.remove(); } catch { } });
    const text = document.createElement('div');
    text.className = 'toast-text';
    text.textContent = msg;
    toast.appendChild(close);
    toast.appendChild(text);
    container.appendChild(toast);
    setTimeout(() => {
      try { toast.remove(); } catch { }
    }, duration);
  } catch { }
}

function notify_(message, type = 'info', options = {}) {
  try {
    if (window.CharityUi && typeof window.CharityUi.notify === 'function') {
      window.CharityUi.notify(message, type, options || {});
      return;
    }
  } catch { }
  const text = (message || '').toString();
  if (!text) return;
  if (options && options.alert === true) {
    try { alert(text); return; } catch { }
  }
  showToast_(text, type, (options && options.duration) || 4000);
}

async function confirmDialog_(options = {}) {
  try {
    if (window.CharityUi && typeof window.CharityUi.confirmDialog === 'function') {
      return await window.CharityUi.confirmDialog(options || {});
    }
  } catch { }
  try { return !!confirm((options.message || options.title || 'تأكيد').toString()); } catch { }
  return false;
}

async function promptDialog_(options = {}) {
  try {
    if (window.CharityUi && typeof window.CharityUi.promptDialog === 'function') {
      return await window.CharityUi.promptDialog(options || {});
    }
  } catch { }
  try {
    const result = prompt((options.message || options.inputLabel || options.title || 'أدخل القيمة').toString(), (options.inputValue || '').toString());
    return result == null ? null : result.toString();
  } catch { }
  return null;
}

function setInlineHint_(elementId, message, type = 'info') {
  try {
    const el = document.getElementById(elementId);
    if (!el) return false;
    try { el.classList.remove('is-error', 'is-success', 'is-info', 'hidden'); } catch { }
    const text = (message || '').toString().trim();
    if (!text) {
      el.style.display = 'none';
      el.textContent = '';
      return true;
    }
    el.style.display = 'block';
    el.textContent = text;
    if (type === 'error') el.classList.add('is-error');
    else if (type === 'success') el.classList.add('is-success');
    else el.classList.add('is-info');
    return true;
  } catch { }
  return false;
}

function focusField_(elementId) {
  try {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.focus();
    if (typeof el.select === 'function' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.select();
  } catch { }
}

function requirePermUi_(perm, message) {
  try {
    if (hasPerm(perm)) return true;
    notify_((message || 'لا تملك صلاحية تنفيذ هذا الإجراء').toString(), 'error', { alert: true });
    return false;
  } catch { }
  return false;
}

function requireDatabaseUi_(message = 'تعذر الاتصال بقاعدة البيانات') {
  try {
    if (DatabaseClient) return true;
    notify_(message, 'error', { alert: true });
    return false;
  } catch { }
  return false;
}



function isMobileNavViewport_() {
  try { return !!window.matchMedia(`(max-width: ${MOBILE_NAV_BREAKPOINT}px)`).matches; } catch { }
  try { return (window.innerWidth || 0) <= MOBILE_NAV_BREAKPOINT; } catch { }
  return false;
}

function syncMobileNavState_(open) {
  try {
    const wrap = document.getElementById('mainNavWrap');
    const overlay = document.querySelector('.sidebar-overlay');
    const btn = document.getElementById('mobileNavToggle');
    if (!wrap) return;
    const next = !!open && isMobileNavViewport_();
    wrap.classList.toggle('open', next);
    wrap.classList.toggle('sidebar-open', next);
    wrap.setAttribute('data-mobile-open', next ? '1' : '0');
    if (overlay) {
      overlay.classList.toggle('active', next);
      overlay.setAttribute('aria-hidden', next ? 'false' : 'true');
    }
    document.body.classList.toggle('nav-open', next);
    document.body.classList.toggle('sidebar-open', next);
    if (btn) btn.setAttribute('aria-expanded', next ? 'true' : 'false');
  } catch { }
}

function readCasesListFiltersState_() {
  const selectedCategories = [];
  try {
    if (window.filterCategoriesGroup) {
      Array.from(filterCategoriesGroup.querySelectorAll('input[type="checkbox"]')).forEach((box) => {
        if (box.checked && !box.hasAttribute('data-all')) selectedCategories.push((box.value || '').toString());
      });
    }
  } catch { }
  return {
    q: (window.caseSearch ? (caseSearch.value || '').toString() : ''),
    explorer: (window.filterExplorer ? (filterExplorer.value || '').toString() : ''),
    governorate: (window.filterGovernorate ? (filterGovernorate.value || '').toString() : ''),
    area: (window.filterArea ? (filterArea.value || '').toString() : ''),
    grade: (window.filterCaseGrade ? (filterCaseGrade.value || '').toString() : ''),
    needs: (window.filterNeeds ? (filterNeeds.value || '').toString() : ''),
    selectedCategories,
    dashboardFilter: AppState.dashboardFilter ? JSON.parse(JSON.stringify(AppState.dashboardFilter)) : null
  };
}

function applyCasesListFiltersState_(state = {}) {
  try { if (window.caseSearch) caseSearch.value = (state.q || '').toString(); } catch { }
  try { if (window.filterExplorer) filterExplorer.value = (state.explorer || '').toString(); } catch { }
  try { if (window.filterGovernorate) filterGovernorate.value = (state.governorate || '').toString(); } catch { }
  try { if (window.filterArea) filterArea.value = (state.area || '').toString(); } catch { }
  try { if (window.filterCaseGrade) filterCaseGrade.value = (state.grade || '').toString(); } catch { }
  try { if (window.filterNeeds) filterNeeds.value = (state.needs || '').toString(); } catch { }
  try {
    if (window.filterCategoriesGroup) {
      const selected = new Set(Array.isArray(state.selectedCategories) ? state.selectedCategories.map((value) => (value || '').toString()) : []);
      Array.from(filterCategoriesGroup.querySelectorAll('input[type="checkbox"]')).forEach((box) => {
        if (box.hasAttribute('data-all')) {
          box.checked = false;
          return;
        }
        box.checked = selected.has((box.value || '').toString());
      });
    }
  } catch { }
  try {
    AppState.dashboardFilter = state.dashboardFilter ? JSON.parse(JSON.stringify(state.dashboardFilter)) : null;
    const bar = document.getElementById('casesListActiveFilter');
    const lab = document.getElementById('casesListActiveFilterLabel');
    const hasDash = !!AppState.dashboardFilter?.key;
    if (lab) lab.textContent = hasDash ? ((AppState.dashboardFilter?.label || AppState.dashboardFilter?.key || '').toString()) : '';
    if (bar) bar.classList.toggle('hidden', !hasDash);
  } catch { }
}

function captureCasesUiState_() {
  const modal = document.getElementById('caseDetailsModal');
  const listSection = document.getElementById('casesListSection');
  return {
    filters: readCasesListFiltersState_(),
    selectedIds: getSelectedCaseIds(),
    limit: Math.max(CASES_LIST_INITIAL_LIMIT, Number(AppState._casesListLimit || 0) || CASES_LIST_INITIAL_LIMIT),
    scrollY: Math.max(0, Number(window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0) || 0),
    currentCaseId: (AppState.currentCaseId || '').toString(),
    caseDetailsTab: (AppState.caseDetailsTab || 'details').toString(),
    detailsOpen: !!(modal && modal.classList.contains('show')),
    listSectionVisible: !!(listSection && !listSection.classList.contains('hidden'))
  };
}

function restoreSelectedCases_(selectedIds = []) {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => (id || '').toString()).filter(Boolean));
  try {
    const host = document.getElementById('casesCardsGrid') || document.getElementById('casesTableBody');
    if (!host) return;
    Array.from(host.querySelectorAll('input.case-select')).forEach((box) => {
      const id = (box.getAttribute('data-case-id') || '').toString();
      box.checked = selected.has(id);
    });
  } catch { }
  try { onCaseSelectionChange(); } catch { }
}

function restoreCasesUiState_(state = {}, options = {}) {
  try { applyCasesListFiltersState_(state.filters || {}); } catch { }
  const focusCaseId = (options.focusCaseId || state.currentCaseId || '').toString().trim();
  try {
    const filtered = getFilteredCasesCached_();
    let limit = Math.max(CASES_LIST_INITIAL_LIMIT, Number(state.limit || 0) || CASES_LIST_INITIAL_LIMIT);
    if (focusCaseId) {
      const idx = filtered.findIndex((item) => String(item?.id || '').trim() === focusCaseId);
      if (idx >= 0) limit = Math.max(limit, idx + 1);
    }
    AppState._casesListLimit = limit;
  } catch {
    try { AppState._casesListLimit = Math.max(CASES_LIST_INITIAL_LIMIT, Number(state.limit || 0) || CASES_LIST_INITIAL_LIMIT); } catch { }
  }
  try { renderCasesTable(); } catch { }
  try { restoreSelectedCases_(state.selectedIds || []); } catch { }
  try { updateCasesListUiState_(); } catch { }

  const reopenDetails = options.reopenDetails !== false && !!(options.forceOpenDetails || state.detailsOpen);
  if (focusCaseId && reopenDetails) {
    try { openCaseDetails(focusCaseId, 'view'); } catch { }
    try { setCaseDetailsTab((options.caseDetailsTab || state.caseDetailsTab || 'details').toString()); } catch { }
  }

  const shouldRestoreScroll = options.restoreScroll !== false && !!state.listSectionVisible;
  if (shouldRestoreScroll) {
    const top = Math.max(0, Number(state.scrollY || 0) || 0);
    try {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { window.scrollTo({ top, behavior: 'auto' }); } catch { try { window.scrollTo(0, top); } catch { } }
        });
      });
    } catch { }
  }
}

function getAdjacentVisibleCaseId_(caseId, list) {
  const targetId = (caseId || '').toString().trim();
  if (!targetId) return '';
  const source = Array.isArray(list) ? list : getFilteredCasesCached_();
  const idx = source.findIndex((item) => String(item?.id || '').trim() === targetId);
  if (idx < 0) return '';
  return String(source[idx + 1]?.id || source[idx - 1]?.id || '').trim();
}

function toggleMobileNav(forceOpen) {
  try {
    const wrap = document.getElementById('mainNavWrap');
    const btn = document.getElementById('mobileNavToggle');
    if (!wrap || !btn) return;
    const isOpen = wrap.classList.contains('sidebar-open') || wrap.classList.contains('open');
    const open = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
    syncMobileNavState_(open);
  } catch { }
}

function closeMobileNav() {
  try { syncMobileNavState_(false); } catch { }
}

function wireMobileNav_() {
  try {
    const btn = document.getElementById('mobileNavToggle');
    if (btn && btn.getAttribute('data-wired') !== '1') {
      btn.setAttribute('data-wired', '1');
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleMobileNav();
      });
    }
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay && overlay.getAttribute('data-wired') !== '1') {
      overlay.setAttribute('data-wired', '1');
      overlay.addEventListener('click', () => closeMobileNav());
    }
    if (document.body.getAttribute('data-mobile-nav-escape') !== '1') {
      document.body.setAttribute('data-mobile-nav-escape', '1');
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const wrap = document.getElementById('mainNavWrap');
        if (!wrap || (!wrap.classList.contains('open') && !wrap.classList.contains('sidebar-open'))) return;
        closeMobileNav();
      });
    }
    if (window.__mobileNavResizeWired !== true) {
      window.__mobileNavResizeWired = true;
      window.addEventListener('resize', () => {
        if (!isMobileNavViewport_()) closeMobileNav();
      });
    }
    syncMobileNavState_(false);
  } catch { }
}

try {
  window.addEventListener('click', (e) => {
    const wrap = document.getElementById('mainNavWrap');
    const btn = document.getElementById('mobileNavToggle');
    if (!wrap || !btn) return;
    if (!wrap.classList.contains('open') && !wrap.classList.contains('sidebar-open')) return;
    const t = e?.target;
    if (wrap.contains(t) || btn.contains(t)) return;
    closeMobileNav();
  });
} catch { }

function refreshCaseViews_(caseId, options = {}) {
  const id = (caseId || AppState.currentCaseId || '').toString().trim();
  const preserveTab = options.preserveTab !== false;
  const reopenDetails = !!options.reopenDetails;
  try { renderCasesTable(); } catch { }
  try { updateDashboardStats(); } catch { }
  try { generateReportPreview(); } catch { }
  try { updateNavBadges(); } catch { }
  try { markCasesDerivedDirty_(); } catch { }
  try { if (document.getElementById('medicalCommitteeSection') && !document.getElementById('medicalCommitteeSection').classList.contains('hidden')) renderMedicalTable(); } catch { }
  if (id && reopenDetails) {
    const tab = preserveTab ? (AppState.caseDetailsTab || 'details') : 'details';
    try { openCaseDetails(id, 'view'); } catch { }
    try { setCaseDetailsTab(tab); } catch { }
  }
}

function getSelectedCaseIds() {
  try {
    const host = document.getElementById('casesCardsGrid') || document.getElementById('casesTableBody');
    if (!host) return [];
    return Array.from(host.querySelectorAll('input.case-select:checked'))
      .map((box) => (box.getAttribute('data-case-id') || '').toString().trim())
      .filter(Boolean);
  } catch { }
  return [];
}

function clearBulkSelection() {
  try {
    const host = document.getElementById('casesCardsGrid') || document.getElementById('casesTableBody');
    if (host) Array.from(host.querySelectorAll('input.case-select')).forEach((box) => { box.checked = false; });
  } catch { }
  try {
    const allBox = document.getElementById('casesSelectAll');
    if (allBox) {
      allBox.checked = false;
      allBox.indeterminate = false;
    }
  } catch { }
  try { onCaseSelectionChange(); } catch { }
}

function getSelectedCases_() {
  const ids = new Set(getSelectedCaseIds());
  return (AppState.cases || []).filter((item) => ids.has(String(item?.id || '').trim()));
}

function getBulkStatusOptions_() {
  const base = ['جديدة', 'محولة', 'منفذة', 'قيد البحث', 'مرفوضة'];
  const dynamic = Array.from(new Set((AppState.cases || []).map((item) => String(item?.status || '').trim()).filter(Boolean)));
  return Array.from(new Set(base.concat(dynamic))).filter(Boolean);
}

function renderMiniCaseList_(list = [], max = 4) {
  const items = (Array.isArray(list) ? list : [])
    .slice(0, Math.max(0, max))
    .map((item) => `• ${(item?.familyHead || item?.id || '').toString()}`);
  const extra = Array.isArray(list) && list.length > max ? `\n... +${list.length - max} حالات أخرى` : '';
  return items.join('\n') + extra;
}


async function openBulkStatusPrompt() {
  const ids = getSelectedCaseIds();
  if (!ids.length) { alert('حدد حالة واحدة على الأقل'); return; }
  if (!hasPerm('case_status_change') && !hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل حالة الحالات'); return; }
  const options = getBulkStatusOptions_();
  const answer = (prompt(`اكتب الحالة الجديدة للحالات المحددة:
${options.join(' | ')}`) || '').toString().trim();
  if (!answer) return;
  await applyStatusToSelectedCases(answer);
}

async function applyStatusToSelectedCases(statusValue) {
  const ids = getSelectedCaseIds();
  if (!ids.length) { alert('حدد حالة واحدة على الأقل'); return; }
  const normalizedStatus = (statusValue || '').toString().trim();
  if (!normalizedStatus) return;
  if (!hasPerm('case_status_change') && !hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل حالة الحالات'); return; }

  const selectedCases = getSelectedCases_();
  const uiState = captureCasesUiState_();
  const beforeMap = new Map(selectedCases.map((item) => [String(item.id), JSON.parse(JSON.stringify(item))]));
  const actorName = (AppState.currentUser?.name || AppState.currentUser?.username || '').toString().trim();

  try {
    for (const item of selectedCases) {
      item.status = normalizedStatus;
      if (normalizedStatus === 'مرفوضة' || normalizedStatus === 'رفض') {
        item.caseGrade = 'حالة مرفوضة';
      }
      item.updated_at = new Date().toISOString();
    }
    refreshCaseViews_('', { reopenDetails: false, preserveTab: true });

    for (const item of selectedCases) {
      await upsertCaseToDb(item);
      try {
        await logAction('تعديل حالة مجموعة حالات', item.id, `status:${normalizedStatus} | by:${actorName}`);
      } catch { }
    }

    await syncCasesAfterMutation_('', { uiState, reopenDetails: false, preserveTab: true });
    try { restoreSelectedCases_(ids); } catch { }
    try { showToast_(`تم تحديث ${selectedCases.length} حالة إلى: ${normalizedStatus}`, 'success'); } catch { }
  } catch (e) {
    try {
      (AppState.cases || []).forEach((item, idx) => {
        const snap = beforeMap.get(String(item?.id || ''));
        if (snap) AppState.cases[idx] = snap;
      });
      refreshCaseViews_('', { reopenDetails: false, preserveTab: true });
    } catch { }
    alert(`تعذر تنفيذ التحديث الجماعي.

الخطأ: ${e?.message || 'خطأ غير معروف'}`);
  }
}

async function rejectSelectedCases() {
  const ids = getSelectedCaseIds();
  if (!ids.length) { alert('حدد حالة واحدة على الأقل'); return; }
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const selectedCases = getSelectedCases_().filter((item) => !isRejectedCase_(item));
  if (!selectedCases.length) { alert('كل الحالات المحددة مرفوضة بالفعل.'); return; }
  const reason = (prompt(`سبب رفض الحالات المحددة (${selectedCases.length}) - إجباري:`) || '').toString().trim();
  if (!reason) { alert('سبب الرفض مطلوب'); return; }
  if (!confirm(`تأكيد رفض ${selectedCases.length} حالة؟

${renderMiniCaseList_(selectedCases)}`)) return;

  const uiState = captureCasesUiState_();
  const beforeMap = new Map(selectedCases.map((item) => [String(item.id), JSON.parse(JSON.stringify(item))]));
  const rejectedAt = new Date().toISOString();
  const rejectedByName = (AppState.currentUser?.name || AppState.currentUser?.username || '').toString().trim();
  const rejectedByUser = (AppState.currentUser?.username || '').toString().trim();

  try {
    for (const item of selectedCases) {
      item.caseGrade = 'حالة مرفوضة';
      item.status = 'مرفوضة';
      item.rejectionReason = reason;
      item.rejectedAt = rejectedAt;
      item.rejectedByName = rejectedByName;
      item.rejectedByUser = rejectedByUser;
      item.updated_at = new Date().toISOString();
    }
    refreshCaseViews_('', { reopenDetails: false, preserveTab: true });

    for (const item of selectedCases) {
      await upsertCaseToDb(item);
      try { await logAction('رفض حالة', item.id, `سبب: ${reason}`); } catch { }
    }

    await syncCasesAfterMutation_('', { uiState, reopenDetails: false, preserveTab: true });
    try { restoreSelectedCases_(ids); } catch { }
    try { showToast_(`تم رفض ${selectedCases.length} حالة`, 'success'); } catch { }
  } catch (e) {
    try {
      (AppState.cases || []).forEach((item, idx) => {
        const snap = beforeMap.get(String(item?.id || ''));
        if (snap) AppState.cases[idx] = snap;
      });
      refreshCaseViews_('', { reopenDetails: false, preserveTab: true });
    } catch { }
    alert(`تعذر تنفيذ الرفض الجماعي.

الخطأ: ${e?.message || 'خطأ غير معروف'}`);
  }
}

async function deleteSelectedCases() {
  const ids = getSelectedCaseIds();
  if (!ids.length) { alert('حدد حالة واحدة على الأقل'); return; }
  if (!hasPerm('cases_delete')) { alert('لا تملك صلاحية حذف الحالات'); return; }
  const selectedCases = getSelectedCases_();
  const nonRejected = selectedCases.filter((item) => !isRejectedCase_(item));
  if (nonRejected.length) {
    alert(`الحذف النهائي متاح فقط للحالات المرفوضة.\n\nعدد الحالات غير المؤهلة للحذف: ${nonRejected.length}`);
    return;
  }
  const reason = (prompt(`سبب حذف الحالات المحددة (${selectedCases.length}) - إجباري:`) || '').toString().trim();
  if (!reason) { alert('سبب الحذف مطلوب'); return; }
  if (!confirm(`سيتم حذف ${selectedCases.length} حالة نهائياً.

${renderMiniCaseList_(selectedCases)}`)) return;

  const uiState = captureCasesUiState_();
  const beforeList = Array.isArray(AppState.cases) ? AppState.cases.slice() : [];
  const selectedSet = new Set(ids.map((id) => String(id || '').trim()));
  const visibleBeforeDelete = getFilteredCasesCached_().slice();
  const fallbackCaseId = visibleBeforeDelete.find((item) => !selectedSet.has(String(item?.id || '').trim()))?.id || '';

  try {
    AppState.cases = (AppState.cases || []).filter((item) => !selectedSet.has(String(item?.id || '').trim()));
    refreshCaseViews_('', { reopenDetails: false, preserveTab: true });

    for (const item of selectedCases) {
      await deleteCaseFromDb(item.id);
      try { await logAction('حذف حالة', item.id, `سبب: ${reason}`); } catch { }
    }

    await syncCasesAfterMutation_('', { uiState, fallbackCaseId, reopenDetails: false, preserveTab: true });
    try { clearBulkSelection(); } catch { }
    try { showToast_(`تم حذف ${selectedCases.length} حالة`, 'success'); } catch { }
  } catch (e) {
    AppState.cases = beforeList;
    refreshCaseViews_('', { reopenDetails: false, preserveTab: true });
    alert(`تعذر حذف الحالات المحددة.

الخطأ: ${e?.message || 'خطأ غير معروف'}`);
  }
}

function getNextCaseNo_() {
  try {
    return (AppState.cases || []).reduce((max, item) => {
      const next = Number(item?.caseNo || 0) || 0;
      return next > max ? next : max;
    }, 0) + 1;
  } catch { }
  return 1;
}

function buildSelectOptions_(items, placeholder = 'Select') {
  const list = Array.isArray(items) ? items : [];
  return [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(list.map((item) => `<option value="${escapeHtml(String(item || ''))}">${escapeHtml(String(item || ''))}</option>`))
    .join('');
}

function buildCurrentUserName_() {
  try {
    const user = AppState.currentUser || {};
    return (user.name || user.full_name || user.username || '').toString().trim();
  } catch { }
  return '';
}

function parseStructuredLines_(raw, mapper) {
  const lines = (raw || '').toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split('|').map((part) => part.trim());
    try {
      const item = mapper(parts, line);
      if (item) out.push(item);
    } catch { }
  }
  return out;
}


function recalculateNewCaseFinancials_() {
  const readNum = (id) => {
    const el = document.getElementById(id);
    const n = Number(el?.value || 0);
    return Number.isFinite(n) ? n : 0;
  };
  try {
    const totalIncome = readNum('salaryIncome') + readNum('pensionIncome') + readNum('projectIncome') + readNum('ngoIncome');
    const totalExpenses = readNum('rentExpense') + readNum('utilitiesExpense');
    const net = totalIncome - totalExpenses;
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value.toLocaleString('en-US'));
    };
    setText('incomeTotalPreview', totalIncome);
    setText('expensesTotalPreview', totalExpenses);
    setText('netMonthlyPreview', net);
  } catch { }
}

function wireNewCaseForm_() {
  try {
    const form = document.getElementById('caseForm');
    if (form && form.getAttribute('data-wired') !== '1') {
      form.setAttribute('data-wired', '1');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void submitNewCase_();
      });
    }
  } catch { }

  try {
    const caseIdEl = document.getElementById('caseId');
    if (caseIdEl && caseIdEl.getAttribute('data-wired-sync') !== '1') {
      caseIdEl.setAttribute('data-wired-sync', '1');
      caseIdEl.addEventListener('input', () => {
        const hidden = document.getElementById('nationalId');
        if (hidden && !hidden.value) hidden.value = (caseIdEl.value || '').toString().trim();
      });
    }
  } catch { }

  try {
    const ids = ['salaryIncome', 'pensionIncome', 'projectIncome', 'ngoIncome', 'rentExpense', 'utilitiesExpense'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.getAttribute('data-calc-wired') === '1') return;
      el.setAttribute('data-calc-wired', '1');
      el.addEventListener('input', () => recalculateNewCaseFinancials_());
    });
    const statusEl = document.getElementById('status');
    if (statusEl && !statusEl.value) statusEl.value = 'جديدة';
    const gradeEl = document.getElementById('caseGrade');
    if (gradeEl && !gradeEl.value) gradeEl.value = 'حالة قيد الانتظار';
    recalculateNewCaseFinancials_();
  } catch { }
}

function renderNewCaseForm_() {
  const form = document.getElementById('caseForm');
  if (!form) return;

  const today = new Date().toISOString().slice(0, 10);
  const explorer = buildCurrentUserName_();
  const nextCaseNo = getNextCaseNo_();
  const yesNo = ['نعم', 'لا'];
  const caseGradeOptions = ['حالة مستديمة', 'حالة موسمية', 'حالة قيد الانتظار'];
  const statusOptions = ['جديدة', 'محولة', 'قيد البحث', 'منفذة'];
  const bathroomTypes = ['مشترك', 'مستقل', 'لا يوجد'];
  const areaTypes = ['حضر', 'ريف', 'عشوائي', 'بدو'];
  const fundingSources = ['تبرعات أفراد', 'جمعية', 'متبرع', 'صندوق زكاة', 'تمويل ذاتي'];

  form.innerHTML = `
    <div class="ds-page-header" style="margin-bottom:20px">
      <div class="ds-page-header-content">
        <h2 style="margin:0">إضافة حالة جديدة</h2>
        <p style="margin:8px 0 0">نموذج موسّع لتسجيل كل بيانات الحالة الأساسية والسكنية والمالية والطبية دفعة واحدة.</p>
      </div>
      <div class="ds-page-header-actions">
        <button class="btn light" type="button" onclick="resetNewCaseForm_(true)" aria-label="إعادة ضبط نموذج الحالة" style="display:inline-flex;align-items:center;gap:6px">↺ إعادة ضبط</button>
        <button class="btn light" type="button" onclick="showSection('casesList','navCasesBtn')" aria-label="فتح قائمة الحالات" style="display:inline-flex;align-items:center;gap:6px">📋 قائمة الحالات</button>
      </div>
    </div>

    <div class="ds-section-panel" style="margin:0 0 18px">
      <div class="ds-section-panel-title">البيانات التعريفية والرئيسية</div>
      <div class="case-form-grid">
        <div>
          <label class="label" for="caseId" style="margin:0">كود الحالة</label>
          <input id="caseId" class="control" autocomplete="off" placeholder="يُنشأ تلقائياً إذا تركته فارغاً" />
          <div class="case-form-section-note">الرقم التسلسلي التالي داخل النظام: <strong>${escapeHtml(String(nextCaseNo))}</strong></div>
        </div>
        <div>
          <label class="label" for="nationalIdInput" style="margin:0">الرقم القومي</label>
          <input id="nationalIdInput" class="control" inputmode="numeric" placeholder="14 رقم مثلاً" />
        </div>
        <div>
          <label class="label" for="familyHead" style="margin:0">اسم رب الأسرة / اسم الحالة *</label>
          <input id="familyHead" class="control" autocomplete="name" placeholder="الاسم الكامل" required />
        </div>
        <div>
          <label class="label" for="phone" style="margin:0">الهاتف</label>
          <input id="phone" class="control" inputmode="tel" autocomplete="tel" placeholder="01xxxxxxxxx" />
        </div>
        <div>
          <label class="label" for="whatsapp" style="margin:0">واتساب</label>
          <input id="whatsapp" class="control" inputmode="tel" placeholder="اختياري" />
        </div>
        <div>
          <label class="label" for="altPhone" style="margin:0">هاتف بديل</label>
          <input id="altPhone" class="control" inputmode="tel" placeholder="اختياري" />
        </div>
        <div>
          <label class="label" for="date" style="margin:0">تاريخ البحث</label>
          <input id="date" type="date" class="control" value="${escapeHtml(today)}" />
        </div>
        <div>
          <label class="label" for="explorerName" style="margin:0">الباحث / المستكشف</label>
          <input id="explorerName" class="control" value="${escapeHtml(explorer)}" placeholder="اسم الباحث" />
        </div>
        <div>
          <label class="label" for="governorate" style="margin:0">المحافظة</label>
          <select id="governorate" class="control">${buildSelectOptions_(GOVS, 'اختر المحافظة')}</select>
        </div>
        <div>
          <label class="label" for="area" style="margin:0">المنطقة / القرية</label>
          <input id="area" class="control" placeholder="القرية / الحي / المركز" />
        </div>
        <div class="case-form-span-full">
          <label class="label" for="address" style="margin:0">العنوان التفصيلي</label>
          <input id="address" class="control" placeholder="العنوان بالكامل" />
        </div>
        <div>
          <label class="label" for="familyCount" style="margin:0">عدد أفراد الأسرة</label>
          <input id="familyCount" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="maritalStatus" style="margin:0">الحالة الاجتماعية</label>
          <select id="maritalStatus" class="control">${buildSelectOptions_(MARITAL_STATUS_OPTIONS, 'اختر الحالة')}</select>
        </div>
        <div>
          <label class="label" for="category" style="margin:0">الفئة</label>
          <select id="category" class="control">${buildSelectOptions_(CATEGORIES, 'اختر الفئة')}</select>
        </div>
        <div>
          <label class="label" for="urgency" style="margin:0">درجة الاستعجال</label>
          <select id="urgency" class="control">${buildSelectOptions_(['عادي', 'عاجل', 'عاجل جدًا'], 'اختر درجة الاستعجال')}</select>
        </div>
        <div>
          <label class="label" for="caseGrade" style="margin:0">تقييم الحالة</label>
          <select id="caseGrade" class="control">${buildSelectOptions_(caseGradeOptions, 'اختر التقييم')}</select>
        </div>
        <div>
          <label class="label" for="status" style="margin:0">الحالة الإدارية</label>
          <select id="status" class="control">${buildSelectOptions_(statusOptions, 'اختر الحالة')}</select>
        </div>
      </div>
    </div>

    <div class="ds-section-panel" style="margin:0 0 18px">
      <div class="ds-section-panel-title">السكن والاحتياج</div>
      <div class="case-form-grid">
        <div class="case-form-span-full">
          <label class="label" for="housingDesc" style="margin:0">وصف السكن</label>
          <input id="housingDesc" class="control" placeholder="مثال: شقة إيجار قديم / بيت ريفي / غرفة واحدة" />
        </div>
        <div>
          <label class="label" for="roomsCount" style="margin:0">عدد الغرف</label>
          <input id="roomsCount" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="bathroomType" style="margin:0">الحمام</label>
          <select id="bathroomType" class="control">${buildSelectOptions_(bathroomTypes, 'اختر الحالة')}</select>
        </div>
        <div>
          <label class="label" for="waterExists" style="margin:0">المياه</label>
          <select id="waterExists" class="control">${buildSelectOptions_(yesNo, 'اختر')}</select>
        </div>
        <div>
          <label class="label" for="roofExists" style="margin:0">السقف</label>
          <select id="roofExists" class="control">${buildSelectOptions_(yesNo, 'اختر')}</select>
        </div>
        <div>
          <label class="label" for="areaType" style="margin:0">نوع المنطقة</label>
          <select id="areaType" class="control">${buildSelectOptions_(areaTypes, 'اختر')}</select>
        </div>
        <div>
          <label class="label" for="estimatedAmount" style="margin:0">المبلغ المقترح</label>
          <input id="estimatedAmount" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="deliveredAmount" style="margin:0">المبلغ المنفذ/المسلم</label>
          <input id="deliveredAmount" type="number" min="0" class="control" value="0" />
        </div>
        <div>
          <label class="label" for="fundingSource" style="margin:0">مصدر التمويل</label>
          <select id="fundingSource" class="control">${buildSelectOptions_(fundingSources, 'اختر المصدر')}</select>
        </div>
        <div class="case-form-span-full">
          <label class="label" for="needsShort" style="margin:0">ملخص الاحتياج</label>
          <textarea id="needsShort" class="control" rows="2" placeholder="ملخص سريع لأهم الاحتياجات"></textarea>
        </div>
        <div class="case-form-span-full">
          <label class="label" for="familyNeeds" style="margin:0">احتياجات الأسرة التفصيلية</label>
          <textarea id="familyNeeds" class="control" rows="3" placeholder="احتياجات السقف / المياه / التعليم / العلاج / الأجهزة..."></textarea>
        </div>
        <div class="case-form-span-full">
          <label class="label" for="description" style="margin:0">وصف الحالة</label>
          <textarea id="description" class="control" rows="3" placeholder="ملخص ميداني كامل للحالة"></textarea>
        </div>
        <div class="case-form-span-full">
          <label class="label" for="researcherReport" style="margin:0">تقرير الباحث</label>
          <textarea id="researcherReport" class="control" rows="4" placeholder="ملاحظات الباحث ونتيجة الزيارة"></textarea>
        </div>
        <div class="case-form-span-full">
          <label class="label" for="tagsInput" style="margin:0">وسوم</label>
          <input id="tagsInput" class="control" placeholder="مثال: يتيم، سقف، علاج، عاجل" />
        </div>
      </div>
    </div>

    <div class="ds-section-panel" style="margin:0 0 18px">
      <div class="ds-section-panel-title">الدخل والمصروفات والعمل</div>
      <div class="inline-metrics" style="margin-bottom:16px">
        <div class="metric"><span>إجمالي الدخل</span><strong id="incomeTotalPreview">0</strong></div>
        <div class="metric"><span>إجمالي المصروفات</span><strong id="expensesTotalPreview">0</strong></div>
        <div class="metric"><span>صافي الشهري</span><strong id="netMonthlyPreview">0</strong></div>
      </div>
      <div class="case-form-grid">
        <div>
          <label class="label" for="fatherJob" style="margin:0">عمل الأب</label>
          <input id="fatherJob" class="control" placeholder="اختياري" />
        </div>
        <div>
          <label class="label" for="motherJob" style="margin:0">عمل الأم</label>
          <input id="motherJob" class="control" placeholder="اختياري" />
        </div>
        <div>
          <label class="label" for="salaryIncome" style="margin:0">مرتب</label>
          <input id="salaryIncome" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="pensionIncome" style="margin:0">معاش</label>
          <input id="pensionIncome" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="projectIncome" style="margin:0">دخل مشروع</label>
          <input id="projectIncome" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="ngoIncome" style="margin:0">إعانات/جمعيات</label>
          <input id="ngoIncome" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="rentExpense" style="margin:0">الإيجار</label>
          <input id="rentExpense" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="utilitiesExpense" style="margin:0">المرافق وفواتير أساسية</label>
          <input id="utilitiesExpense" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div class="case-form-span-full">
          <label class="label" for="incomeNotes" style="margin:0">ملاحظات الدخل</label>
          <textarea id="incomeNotes" class="control" rows="2" placeholder="أي ملاحظات إضافية عن مصادر الدخل"></textarea>
        </div>
        <div class="case-form-span-full">
          <label class="label" for="expensesNotes" style="margin:0">ملاحظات المصروفات</label>
          <textarea id="expensesNotes" class="control" rows="2" placeholder="أي ملاحظات إضافية عن المصروفات الشهرية"></textarea>
        </div>
      </div>
    </div>

    <div class="ds-section-panel" style="margin:0 0 18px">
      <div class="ds-section-panel-title">الديون والزواج والمشروع</div>
      <div class="case-form-grid">
        <div>
          <label class="label" for="debtsEnabled" style="margin:0">هل توجد ديون؟</label>
          <select id="debtsEnabled" class="control">${buildSelectOptions_(yesNo, 'اختر')}</select>
        </div>
        <div>
          <label class="label" for="debtAmount" style="margin:0">قيمة الدين</label>
          <input id="debtAmount" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="debtOwner" style="margin:0">لصالح من</label>
          <input id="debtOwner" class="control" placeholder="فرد / جهة / صاحب عقار..." />
        </div>
        <div>
          <label class="label" for="hasCourtOrder" style="margin:0">هل يوجد حكم/إيصال؟</label>
          <select id="hasCourtOrder" class="control">${buildSelectOptions_(yesNo, 'اختر')}</select>
        </div>
        <div class="case-form-span-full">
          <label class="label" for="debtReason" style="margin:0">سبب الدين</label>
          <textarea id="debtReason" class="control" rows="2" placeholder="علاج / إيجار / تعليم / تجهيز... "></textarea>
        </div>
        <div>
          <label class="label" for="marriageEnabled" style="margin:0">هل الحالة تجهيز زواج؟</label>
          <select id="marriageEnabled" class="control">${buildSelectOptions_(yesNo, 'اختر')}</select>
        </div>
        <div>
          <label class="label" for="brideName" style="margin:0">اسم العروسة</label>
          <input id="brideName" class="control" placeholder="اختياري" />
        </div>
        <div>
          <label class="label" for="groomName" style="margin:0">اسم العريس</label>
          <input id="groomName" class="control" placeholder="اختياري" />
        </div>
        <div>
          <label class="label" for="groomJob" style="margin:0">عمل العريس</label>
          <input id="groomJob" class="control" placeholder="اختياري" />
        </div>
        <div>
          <label class="label" for="contractDate" style="margin:0">تاريخ العقد</label>
          <input id="contractDate" type="date" class="control" />
        </div>
        <div>
          <label class="label" for="weddingDate" style="margin:0">تاريخ الزفاف</label>
          <input id="weddingDate" type="date" class="control" />
        </div>
        <div>
          <label class="label" for="marriageAvailable" style="margin:0">المتوفر حالياً</label>
          <input id="marriageAvailable" class="control" placeholder="الأثاث / الأجهزة المتوفرة" />
        </div>
        <div>
          <label class="label" for="marriageNeeded" style="margin:0">المطلوب</label>
          <input id="marriageNeeded" class="control" placeholder="أهم المتطلبات الناقصة" />
        </div>
        <div>
          <label class="label" for="projectEnabled" style="margin:0">هل يوجد مشروع/مقترح مشروع؟</label>
          <select id="projectEnabled" class="control">${buildSelectOptions_(yesNo, 'اختر')}</select>
        </div>
        <div>
          <label class="label" for="projectType" style="margin:0">نوع المشروع</label>
          <input id="projectType" class="control" placeholder="مثال: بقالة / ماكينة خياطة" />
        </div>
        <div>
          <label class="label" for="projectExperience" style="margin:0">الخبرة</label>
          <input id="projectExperience" class="control" placeholder="الخبرة السابقة أو الحالية" />
        </div>
        <div class="case-form-span-full">
          <label class="label" for="projectNeeds" style="margin:0">احتياجات المشروع</label>
          <textarea id="projectNeeds" class="control" rows="2" placeholder="ما الذي ينقص لبدء المشروع أو استمراره؟"></textarea>
        </div>
      </div>
    </div>

    <div class="ds-section-panel" style="margin:0 0 18px">
      <div class="ds-section-panel-title">البيانات الطبية وأفراد الأسرة</div>
      <div class="case-form-grid">
        <div>
          <label class="label" for="medicalType" style="margin:0">نوع المرض/التدخل</label>
          <input id="medicalType" class="control" placeholder="مثال: عملية عين / فشل كلوي" />
        </div>
        <div>
          <label class="label" for="medicalSpecialty" style="margin:0">التخصص</label>
          <input id="medicalSpecialty" class="control" placeholder="باطنة / جراحة / قلب..." />
        </div>
        <div>
          <label class="label" for="medicalHospital" style="margin:0">المستشفى</label>
          <input id="medicalHospital" class="control" placeholder="اسم المستشفى" />
        </div>
        <div>
          <label class="label" for="medicalDoctor" style="margin:0">الطبيب</label>
          <input id="medicalDoctor" class="control" placeholder="اسم الطبيب" />
        </div>
        <div>
          <label class="label" for="medicalCost" style="margin:0">تكلفة تقديرية طبية</label>
          <input id="medicalCost" type="number" min="0" class="control" placeholder="0" />
        </div>
        <div>
          <label class="label" for="medicalRequired" style="margin:0">المطلوب طبياً</label>
          <input id="medicalRequired" class="control" placeholder="عملية / علاج شهري / جهاز..." />
        </div>
        <div class="case-form-span-full">
          <label class="label" for="medicalReport" style="margin:0">ملخص التقرير الطبي</label>
          <textarea id="medicalReport" class="control" rows="3" placeholder="أهم ما ورد في التقرير الطبي"></textarea>
        </div>
        <div class="case-form-span-full">
          <label class="label" for="familyMembersInput" style="margin:0">أفراد الأسرة</label>
          <textarea id="familyMembersInput" class="control" rows="4" placeholder="كل فرد في سطر منفصل بهذا الشكل: الاسم | الصلة | العمر | التعليم | الحالة الاجتماعية | العمل | ملاحظات"></textarea>
          <div class="case-form-section-note">مثال: أحمد | الأب | 45 | يقرأ ويكتب | متزوج | عامل يومية | مريض سكر</div>
        </div>
      </div>
    </div>

    <input id="nationalId" type="hidden" value="" />
    <div class="ds-toolbar" style="margin:0;padding:0">
      <div id="newCaseHint" class="ds-empty-state hidden" aria-live="polite" style="margin:0;min-height:auto;padding:12px;text-align:right"></div>
      <div class="ds-toolbar-group">
        <button id="saveNewCaseBtn" class="btn" type="submit" aria-label="حفظ الحالة الجديدة" style="display:inline-flex;align-items:center;gap:6px">💾 حفظ الحالة</button>
      </div>
    </div>
  `;

  form.setAttribute('data-rendered', '1');
  wireNewCaseForm_();
}

function resetNewCaseForm_(hardReset = false) {
  try {
    const form = document.getElementById('caseForm');
    if (!form) return;
    if (hardReset || form.getAttribute('data-rendered') !== '1') {
      form.innerHTML = '';
      form.removeAttribute('data-rendered');
      form.removeAttribute('data-wired');
      renderNewCaseForm_();
      return;
    }
    form.reset();
    const today = new Date().toISOString().slice(0, 10);
    try {
      const dateEl = document.getElementById('date');
      if (dateEl) dateEl.value = today;
    } catch { }
    try {
      const explorerEl = document.getElementById('explorerName');
      if (explorerEl && !explorerEl.value) explorerEl.value = buildCurrentUserName_();
    } catch { }
    try {
      const deliveredEl = document.getElementById('deliveredAmount');
      if (deliveredEl) deliveredEl.value = '0';
    } catch { }
    try {
      const hiddenId = document.getElementById('nationalId');
      if (hiddenId) hiddenId.value = '';
    } catch { }
    try {
      const statusEl = document.getElementById('status');
      if (statusEl) statusEl.value = 'جديدة';
    } catch { }
    try { recalculateNewCaseFinancials_(); } catch { }
    try { setInlineHint_('newCaseHint', '', 'info'); } catch { }
    try { document.getElementById('caseId')?.focus?.(); } catch { }
  } catch { }
}

async function submitNewCase_() {
  if (!requirePermUi_('cases_create', 'لا تملك صلاحية إضافة الحالات')) return;
  if (!requireDatabaseUi_('اتصال Supabase غير جاهز حالياً')) return;

  const saveBtn = document.getElementById('saveNewCaseBtn');
  const read = (id) => (document.getElementById(id)?.value || '').toString().trim();
  const readNum = (id) => {
    const raw = read(id);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const readYes = (id) => read(id) === 'نعم';

  const inputId = read('caseId');
  const familyHead = read('familyHead');
  if (!familyHead) {
    setInlineHint_('newCaseHint', 'اسم رب الأسرة أو اسم الحالة مطلوب.', 'error');
    focusField_('familyHead');
    return;
  }

  const caseId = inputId || makeNewCaseId_();
  const duplicate = (AppState.cases || []).some((item) => String(item?.id || '').trim() === caseId);
  if (duplicate) {
    setInlineHint_('newCaseHint', 'كود الحالة موجود بالفعل.', 'error');
    focusField_('caseId');
    return;
  }

  const incomeTotal = readNum('salaryIncome') + readNum('pensionIncome') + readNum('projectIncome') + readNum('ngoIncome');
  const expensesTotal = readNum('rentExpense') + readNum('utilitiesExpense');
  const nowIso = new Date().toISOString();

  const medicalCases = [];
  if ([read('medicalType'), read('medicalHospital'), read('medicalDoctor'), read('medicalReport'), read('medicalRequired'), read('medicalCost')].some(Boolean)) {
    medicalCases.push({
      name: read('medicalRequired') || read('medicalType') || 'حالة طبية',
      diseaseType: read('medicalType'),
      specialty: read('medicalSpecialty'),
      hospital: read('medicalHospital'),
      doctor: read('medicalDoctor'),
      report: read('medicalReport'),
      required: read('medicalRequired'),
      estimatedCost: String(readNum('medicalCost') || ''),
      treatmentSources: ''
    });
  }

  const familyMembers = parseStructuredLines_(read('familyMembersInput'), (parts, line) => ({
    name: parts[0] || line,
    relation: parts[1] || '',
    age: Number(parts[2] || 0) || 0,
    education: parts[3] || '',
    maritalStatus: parts[4] || '',
    working: parts[5] || '',
    notes: parts[6] || ''
  }));

  const caseObj = {
    id: caseId,
    nationalId: read('nationalIdInput') || caseId,
    altPhone: read('altPhone'),
    caseNo: getNextCaseNo_(),
    familyHead,
    phone: read('phone'),
    whatsapp: read('whatsapp'),
    address: read('address'),
    governorate: read('governorate'),
    area: read('area'),
    familyCount: readNum('familyCount'),
    category: read('category'),
    urgency: read('urgency') || 'عادي',
    description: read('description'),
    explorerName: read('explorerName') || buildCurrentUserName_(),
    date: read('date') || nowIso.slice(0, 10),
    status: read('status') || 'جديدة',
    caseGrade: normalizeCaseGrade_(read('caseGrade')) || 'حالة قيد الانتظار',
    maritalStatus: read('maritalStatus'),
    jobs: {
      father: read('fatherJob'),
      mother: read('motherJob')
    },
    estimatedAmount: readNum('estimatedAmount'),
    deliveredAmount: readNum('deliveredAmount'),
    fundingSource: read('fundingSource'),
    income: {
      salary: readNum('salaryIncome'),
      pension: readNum('pensionIncome'),
      projectsIncome: readNum('projectIncome'),
      ngoIncome: readNum('ngoIncome'),
      extras: [],
      notes: read('incomeNotes'),
      total: incomeTotal
    },
    expenses: {
      rent: readNum('rentExpense'),
      utilities: readNum('utilitiesExpense'),
      extras: [],
      notes: read('expensesNotes'),
      total: expensesTotal
    },
    netMonthly: incomeTotal - expensesTotal,
    needsShort: read('needsShort'),
    familyNeeds: read('familyNeeds'),
    researcherReport: read('researcherReport'),
    tags: read('tagsInput').split(/[،,]/).map((item) => item.trim()).filter(Boolean),
    housing: {
      housingDesc: read('housingDesc'),
      roomsCount: readNum('roomsCount'),
      bathroomType: read('bathroomType'),
      waterExists: read('waterExists'),
      roofExists: read('roofExists'),
      areaType: read('areaType')
    },
    debts: {
      enabled: readYes('debtsEnabled'),
      amount: readNum('debtAmount'),
      owner: read('debtOwner'),
      hasCourtOrder: read('hasCourtOrder'),
      reason: read('debtReason')
    },
    marriage: {
      enabled: readYes('marriageEnabled'),
      brideName: read('brideName'),
      groomName: read('groomName'),
      groomJob: read('groomJob'),
      contractDate: read('contractDate'),
      weddingDate: read('weddingDate'),
      available: read('marriageAvailable'),
      needed: read('marriageNeeded')
    },
    project: {
      enabled: readYes('projectEnabled'),
      type: read('projectType'),
      experience: read('projectExperience'),
      needs: read('projectNeeds')
    },
    familyMembers,
    medicalCases,
    sponsorships: [],
    assistanceHistory: [],
    created_at: nowIso,
    updated_at: nowIso
  };

  try { normalizeMissingCoreFields_(caseObj); } catch { }
  try { ensureAssistanceArrays(); } catch { }
  try { setInlineHint_('newCaseHint', 'جارٍ حفظ الحالة في Supabase...', 'info'); } catch { }
  try { if (saveBtn) saveBtn.setAttribute('disabled', 'disabled'); } catch { }

  try {
    await upsertCaseToDb(caseObj);
    try { sendCaseToSheets(caseObj); } catch { }
    try { await logAction('إضافة حالة', caseObj.id, `family: ${caseObj.familyHead} | caseNo: ${caseObj.caseNo}`); } catch { }
    await syncCasesAfterMutation_(caseObj.id);
    try { showToast_('تم حفظ الحالة بنجاح.', 'success'); } catch { }
    try { resetNewCaseForm_(true); } catch { }
    try { showSection('casesList', 'navCasesBtn'); } catch { }
  } catch (e) {
    try { console.error('submitNewCase_ error:', e); } catch { }
    try {
      await onDatabaseWriteError_('تعذر حفظ الحالة في Supabase حالياً.', e);
    } catch {
      setInlineHint_('newCaseHint', `تعذر حفظ الحالة: ${e?.message || 'خطأ غير معروف'}`, 'error');
    }
  } finally {
    try { if (saveBtn) saveBtn.removeAttribute('disabled'); } catch { }
  }
}

function onCaseSelectionChange() {
  const ids = getSelectedCaseIds();
  try {
    const countEl = document.getElementById('bulkSelectedCount');
    if (countEl) countEl.textContent = String(ids.length);
  } catch { }
  try {
    const selectedCases = getSelectedCases_();
    const rejectedOnly = !!selectedCases.length && selectedCases.every(isRejectedCase_);
    const meta = document.getElementById('bulkSelectedMeta');
    if (meta) {
      meta.textContent = ids.length
        ? (rejectedOnly
          ? `تم تحديد ${ids.length} حالة. الحذف متاح لأن كل الحالات المحددة مرفوضة.`
          : `تم تحديد ${ids.length} حالة. الحذف متاح للحالات المرفوضة فقط.`)
        : 'يمكن تنفيذ إجراءات جماعية مباشرة.';
    }
  } catch { }
  try {
    const bar = document.getElementById('bulkActionsBar');
    if (bar) bar.classList.toggle('hidden', ids.length === 0);
  } catch { }
  try {
    const byId = (id) => document.getElementById(id);
    const canEdit = hasPerm('cases_edit');
    const canDelete = hasPerm('cases_delete');
    const canChange = hasPerm('case_status_change') || canEdit;
    const selectedCases = getSelectedCases_();
    const rejectedOnly = !!selectedCases.length && selectedCases.every(isRejectedCase_);
    if (byId('bulkSponsorshipSelectionBtn')) byId('bulkSponsorshipSelectionBtn').style.display = canEdit ? '' : 'none';
    if (byId('bulkStatusBtn')) byId('bulkStatusBtn').style.display = canChange ? '' : 'none';
    if (byId('bulkRejectBtn')) byId('bulkRejectBtn').style.display = canEdit ? '' : 'none';
    if (byId('bulkDeleteBtn')) byId('bulkDeleteBtn').style.display = (canDelete && rejectedOnly) ? '' : 'none';
    if (byId('bulkExportBtn')) byId('bulkExportBtn').style.display = ids.length ? '' : 'none';
  } catch { }
  try { updateCasesListUiState_(); } catch { }
  try {
    const host = document.getElementById('casesCardsGrid') || document.getElementById('casesTableBody');
    const allBox = document.getElementById('casesSelectAll');
    if (!host || !allBox) return;
    const boxes = Array.from(host.querySelectorAll('input.case-select'));
    const checked = boxes.filter((box) => box.checked).length;
    allBox.indeterminate = checked > 0 && checked < boxes.length;
    allBox.checked = boxes.length > 0 && checked === boxes.length;
  } catch { }
}

function toggleCasesListCategoriesMobile() {
  try {
    const grid = document.querySelector('.cases-filter-cats-body') || document.querySelector('.cases-list-filters-grid');
    if (!grid) return;
    grid.classList.toggle('cats-open');
    const btn = document.getElementById('toggleCasesCatsBtn');
    if (btn) btn.textContent = grid.classList.contains('cats-open') ? 'إخفاء الفئات' : 'إظهار الفئات';
  } catch { }
}

function openSponsorshipFromToolbar() {
  try {
    const selectedIds = getSelectedCaseIds();
    if (selectedIds.length) {
      openBulkSponsorshipModal();
      return;
    }
    openSponsorshipModalAdvanced();
  } catch (e) {
    alert(`تعذر فتح نافذة تسليم الكفالة.

الخطأ: ${e?.message || 'غير معروف'}`);
  }
}


try {
  window.addEventListener('resize', () => {
    try {
      if ((window.innerWidth || 0) > 768) closeMobileNav();
    } catch { }
  });
} catch { }

async function renderCaseChangeLog_() {
  const panel = document.getElementById('casePanelChangeLog');
  if (!panel) return;
  const id = (AppState.currentCaseId || '').toString();
  if (!id) { panel.innerHTML = '—'; return; }
  if (!DatabaseClient) {
    panel.innerHTML = '<div style="color:#64748b">تعذر الاتصال بقاعدة البيانات</div>';
    return;
  }

  try { panel.innerHTML = '<div style="color:#64748b">جارٍ تحميل السجل...</div>'; } catch { }

  try {
    const { data, error } = await DatabaseClient
      .from('audit_log')
      .select('created_at,action,details,created_by')
      .eq('case_id', id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    // Best-effort resolve usernames (optional)
    const ids = Array.from(new Set((data || []).map(x => (x.created_by || '').toString()).filter(Boolean)));
    const map = {};
    if (ids.length) {
      try {
        const q = await DatabaseClient.from('users').select('id,username,full_name').in('id', ids).limit(2000);
        (q.data || []).forEach(p => { map[(p.id || '').toString()] = (p.username || p.full_name || '').toString(); });
      } catch { }
    }

    const rows = (data || []).map(x => {
      const t = (x.created_at || '').toString().replace('T', ' ').replace('Z', '');
      const user = map[(x.created_by || '').toString()] || '';
      const action = (x.action || '').toString();
      const details = (x.details || '').toString();
      return `
        <tr>
          <td>${escapeHtml(t)}</td>
          <td>${escapeHtml(user)}</td>
          <td>${escapeHtml(action)}</td>
          <td style="max-width:520px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(details)}">${escapeHtml(details)}</td>
        </tr>`;
    }).join('');

    panel.innerHTML = `
      <div style="overflow:auto;border:1px solid #e5e7eb;border-radius:12px;background:#fff">
        <table class="table" style="min-width:900px">
          <thead>
            <tr>
              <th>الوقت</th>
              <th>المستخدم</th>
              <th>الإجراء</th>
              <th>تفاصيل</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center">لا يوجد سجل لهذه الحالة بعد</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch {
    panel.innerHTML = '<div style="color:#64748b">تعذر تحميل السجل</div>';
  }
}

function initPasswordToggles_() {
  try {
    const btns = Array.from(document.querySelectorAll('.pw-toggle'));
    btns.forEach(btn => {
      try {
        if (btn.getAttribute('data-bound') === '1') return;
        btn.setAttribute('data-bound', '1');
        btn.addEventListener('click', () => {
          try {
            const targetId = (btn.getAttribute('data-pw-target') || '').toString().trim();
            if (!targetId) return;
            const input = document.getElementById(targetId);
            if (!input) return;
            const isPwd = (input.getAttribute('type') || '').toLowerCase() === 'password';
            input.setAttribute('type', isPwd ? 'text' : 'password');
            btn.textContent = isPwd ? '🙈' : '👁';
            btn.setAttribute('aria-label', isPwd ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
          } catch { }
        });
      } catch { }
    });
  } catch { }
}

const FRONTEND_CONFIG = Object.freeze({
  googleSheetsUrl: window.APP_CONFIG?.googleSheetsUrl || '',
  supabaseUrl: window.APP_CONFIG?.supabaseUrl || '',
  supabaseAnonKey: window.APP_CONFIG?.supabaseAnonKey || '',
  settingsStorageKey: 'cms-settings-v1',
  pendingQueueStorageKey: 'cms-pending-queue-v1',
  authStorageKey: 'cms-supabase-auth',
  casePageSize: Number(window.APP_CONFIG?.casePageSize || 100) || 100,
  auditPageSize: Number(window.APP_CONFIG?.auditPageSize || 100) || 100,
  minPasswordLength: Number(window.APP_CONFIG?.minPasswordLength || 10) || 10,
  sessionMode: window.APP_CONFIG?.sessionMode || 'session'
});

function createDefaultSettings_() {
  return { url: FRONTEND_CONFIG.googleSheetsUrl || null, token: null, regions: [], activeRegion: null };
}

const AppState = { currentUser: null, cases: [], isAuthenticated: false, googleSheetsUrl: FRONTEND_CONFIG.googleSheetsUrl, caseIdCounter: 1000, settings: createDefaultSettings_() };

const CASES_LIST_INITIAL_LIMIT = 1000000;
const CASES_LIST_LOAD_STEP = 1000000;
const MOBILE_NAV_BREAKPOINT = 1100;

function mapCompatTableName_(tableName) {
  const t = (tableName || '').toString().trim();
  return t === 'users' ? 'profiles' : t;
}

function createSupabaseAuthStorage_() {
  const fallback = new Map();
  const read = (store, key) => {
    try { return store.getItem(key); } catch { return null; }
  };
  const write = (store, key, value) => {
    try { store.setItem(key, value); return true; } catch { return false; }
  };
  const remove = (store, key) => {
    try { store.removeItem(key); } catch { }
  };
  return {
    getItem(key) {
      if (getRememberMe_()) {
        return read(localStorage, key) ?? read(sessionStorage, key) ?? fallback.get(key) ?? null;
      }
      return read(sessionStorage, key) ?? fallback.get(key) ?? null;
    },
    setItem(key, value) {
      if (getRememberMe_()) {
        write(localStorage, key, value);
        remove(sessionStorage, key);
      } else if (!write(sessionStorage, key, value)) {
        fallback.set(key, value);
      } else {
        remove(localStorage, key);
      }
    },
    removeItem(key) {
      remove(localStorage, key);
      remove(sessionStorage, key);
      fallback.delete(key);
    }
  };
}

function clearPersistedAuthStorage_() {
  try { localStorage.removeItem(FRONTEND_CONFIG.authStorageKey); } catch { }
  try { sessionStorage.removeItem(FRONTEND_CONFIG.authStorageKey); } catch { }
}

function normalizeProfileRecord_(record) {
  if (!record) return null;
  const perms = record.permissions && typeof record.permissions === 'object' ? record.permissions : {};
  const email = (record.email || '').toString();
  const derivedUsername = email.includes('@') ? email.split('@')[0] : '';
  return {
    ...record,
    username: (record.username || derivedUsername || '').toString(),
    full_name: record.full_name || record.name || '',
    permissions: perms,
    is_active: record.is_active !== false,
    updated_at: record.updated_at || '',
    created_at: record.created_at || '',
    last_seen_at: record.last_seen_at || '',
    email
  };
}

async function fetchProfileById_(client, userId) {
  const raw = client?.raw || client || null;
  if (!raw || !userId) return null;
  try {
    const { data, error } = await raw.from('profiles').select('*').eq('id', String(userId)).maybeSingle();
    if (error) return null;
    return normalizeProfileRecord_(data);
  } catch {
    return null;
  }
}

async function hydrateAuthUser_(client, authUser) {
  if (!authUser) return null;
  const profile = await fetchProfileById_(client, authUser.id);
  if (!profile) return normalizeProfileRecord_(authUser);
  return normalizeProfileRecord_({
    ...authUser,
    ...profile,
    email: authUser.email || profile.email || ''
  });
}

async function fetchAuthenticatedProfile_() {
  if (!DatabaseClient) return null;
  try {
    const { data: authData, error } = await DatabaseClient.raw.auth.getUser();
    if (error || !authData?.user?.id) return null;
    const profile = await fetchProfileById_(DatabaseClient, authData.user.id);
    return profile || normalizeProfileRecord_(authData.user);
  } catch {
    return null;
  }
}

function normalizeCaseRecord_(record) {
  if (!record) return null;
  return {
    ...record,
    id: record.id || record.case_id || '',
    data: record.data && typeof record.data === 'object' ? record.data : {},
    updated_at: record.updated_at || '',
    created_by: record.created_by || null,
    updated_by: record.updated_by || null
  };
}

function normalizeAuditRecord_(record) {
  if (!record) return null;
  const out = {
    ...record,
    created_at: record.created_at || '',
    updated_at: record.updated_at || '',
    action: record.action || '',
    case_id: record.case_id || '',
    details: record.details || '',
    created_by: record.created_by || null
  };
  const expanded = normalizeProfileRecord_(record.profiles || record.created_by_profile || null);
  if (expanded) {
    out.profiles = { username: expanded.username || '', full_name: expanded.full_name || '', email: expanded.email || '' };
  }
  return out;
}

function randomTempPassword_() {
  return `Kh${Math.random().toString(36).slice(2, 8)}!${Math.random().toString(10).slice(2, 6)}`;
}

function validatePasswordPolicy_(password) {
  const value = (password || '').toString();
  const min = Number(FRONTEND_CONFIG.minPasswordLength || 10) || 10;
  if (value.length < min) return `كلمة المرور يجب أن تكون ${min} أحرف على الأقل`;
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return 'كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم ورمز';
  }
  return '';
}

function sanitizeProfileMutationPayload_(payload) {
  const body = { ...(payload || {}) };
  delete body.password;
  delete body.passwordConfirm;
  delete body.oldPassword;
  return body;
}

function normalizeQueryResult_(tableName, result) {
  if (!result || result.error) return result;
  const mapRow = (row) => {
    const table = mapCompatTableName_(tableName);
    if (table === 'profiles') return normalizeProfileRecord_(row);
    if (table === 'cases') return normalizeCaseRecord_(row);
    if (table === 'audit_log') return normalizeAuditRecord_(row);
    return row;
  };
  if (Array.isArray(result.data)) {
    return { ...result, data: result.data.map(mapRow) };
  }
  return { ...result, data: mapRow(result.data) };
}

class SupabaseCompatQuery_ {
  constructor(client, tableName) {
    this.client = client;
    this.originalTable = (tableName || '').toString().trim();
    this.table = mapCompatTableName_(tableName);
    this.query = client.raw.from(this.table);
    this.mode = 'generic';
  }

  _apply(methodName, ...args) {
    this.query = this.query[methodName](...args);
    return this;
  }

  select(columns) { return this._apply('select', columns || '*'); }
  eq(field, value) { return this._apply('eq', field, value); }
  neq(field, value) { return this._apply('neq', field, value); }
  in(field, values) { return this._apply('in', field, values); }
  order(field, opts = {}) { return this._apply('order', field, opts || {}); }
  limit(value) { return this._apply('limit', Math.max(0, Number(value) || 0)); }
  range(from, to) { return this._apply('range', Math.max(0, Number(from) || 0), Math.max(0, Number(to) || 0)); }
  insert(payload) {
    const body = this.table === 'profiles' ? sanitizeProfileMutationPayload_(payload) : (payload || {});
    this.mode = 'insert';
    return this._apply('insert', body);
  }
  update(payload) {
    const body = this.table === 'profiles' ? sanitizeProfileMutationPayload_(payload) : (payload || {});
    this.mode = 'update';
    return this._apply('update', body);
  }
  upsert(payload) {
    const body = this.table === 'profiles' ? sanitizeProfileMutationPayload_(payload) : (payload || {});
    this.mode = 'upsert';
    return this._apply('upsert', body);
  }
  delete() {
    this.mode = 'delete';
    return this._apply('delete');
  }
  async maybeSingle() {
    return normalizeQueryResult_(this.originalTable, await this.query.maybeSingle());
  }
  async single() {
    return normalizeQueryResult_(this.originalTable, await this.query.single());
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }

  async exec() {
    return normalizeQueryResult_(this.originalTable, await this.query);
  }
}

function createSupabaseCompatClient_() {
  try {
    if (!window.supabase?.createClient) return null;
    if (!FRONTEND_CONFIG.supabaseUrl || !FRONTEND_CONFIG.supabaseAnonKey) return null;
    const authLock = async (_name, _acquireTimeout, fn) => await fn();
    const raw = window.supabase.createClient(FRONTEND_CONFIG.supabaseUrl, FRONTEND_CONFIG.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: FRONTEND_CONFIG.authStorageKey,
        storage: createSupabaseAuthStorage_(),
        lock: authLock
      }
    });
    const compat = {
      raw,
      from(tableName) { return new SupabaseCompatQuery_(compat, tableName); },
      async rpc(name, params = {}) {
        try {
          return await raw.rpc(name, params || {});
        } catch (error) {
          return { data: null, error };
        }
      },
      functions: {
        async invoke(name, options = {}) {
          try {
            return await raw.functions.invoke(name, options || {});
          } catch (error) {
            return { data: null, error };
          }
        }
      },
      auth: {
        async signInWithPassword({ email, password }) {
          try {
            const authData = await raw.auth.signInWithPassword({ email: (email || '').toString().trim(), password: password || '' });
            if (authData?.error) return authData;
            const user = await hydrateAuthUser_(compat, authData?.data?.user || null);
            return {
              data: {
                user,
                session: authData?.data?.session ? { ...authData.data.session, user } : null
              },
              error: null
            };
          } catch (error) {
            return { data: null, error };
          }
        },
        async signOut() {
          const res = await raw.auth.signOut();
          clearPersistedAuthStorage_();
          return res;
        },
        async getSession() {
          const result = await raw.auth.getSession();
          if (result?.error || !result?.data?.session?.user) return result;
          const user = await hydrateAuthUser_(compat, result.data.session.user);
          return { data: { session: { ...result.data.session, user } }, error: null };
        },
        async getUser() {
          const result = await raw.auth.getUser();
          if (result?.error || !result?.data?.user) return result;
          const user = await hydrateAuthUser_(compat, result.data.user);
          return { data: { user }, error: null };
        },
        onAuthStateChange(callback) {
          const wrapped = async (event, session) => {
            const user = await hydrateAuthUser_(compat, session?.user || null);
            try {
              callback(event, session ? { ...session, user } : session);
            } catch { }
          };
          return raw.auth.onAuthStateChange(wrapped);
        },
        async resetPasswordForEmail(email, options = {}) {
          try {
            return await raw.auth.resetPasswordForEmail((email || '').toString().trim(), options || {});
          } catch (error) {
            return { data: null, error };
          }
        },
        async updateUser(payload = {}) {
          try {
            const body = sanitizeProfileMutationPayload_(payload);
            const result = await raw.auth.updateUser(body);
            if (result?.error || !result?.data?.user) return result;
            const user = await hydrateAuthUser_(compat, result.data.user);
            return { data: { user }, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
        async authRefresh() {
          try {
            const refreshed = await raw.auth.refreshSession();
            if (refreshed?.error || !refreshed?.data?.user) return refreshed;
            const user = await hydrateAuthUser_(compat, refreshed.data.user);
            return { data: { user }, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
        async exchangeCodeForSession(input) {
          try {
            const rawInput = (input || location.href || '').toString();
            const url = new URL(rawInput, location.origin);
            const code = (url.searchParams.get('code') || '').toString().trim();
            if (!code) return { data: { session: null, user: null }, error: null };
            return await raw.auth.exchangeCodeForSession(code);
          } catch (error) {
            return { data: null, error };
          }
        },
        async getSessionFromUrl() {
          try {
            const searchCode = new URL(location.href).searchParams.get('code');
            if (searchCode) return await compat.auth.exchangeCodeForSession(location.href);
            const hash = (location.hash || '').toString().replace(/^#/, '');
            const params = new URLSearchParams(hash);
            const access_token = (params.get('access_token') || '').toString().trim();
            const refresh_token = (params.get('refresh_token') || '').toString().trim();
            if (access_token && refresh_token) {
              return await raw.auth.setSession({ access_token, refresh_token });
            }
            return { data: { session: null, user: null }, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
        async setSession(payload) {
          try {
            return await raw.auth.setSession(payload || {});
          } catch (error) {
            return { data: null, error };
          }
        }
      }
    };

    try {
      window.addEventListener('beforeunload', () => {
        try {
          if (!getRememberMe_()) {
            clearPersistedAuthStorage_();
          }
        } catch { }
      });
    } catch { }

    return compat;
  } catch (e) {
    try { console.error('Supabase init error:', e); } catch { }
    return null;
  }
}

let DatabaseClient = createSupabaseCompatClient_();
try { window.CharityApi?.setClient?.(DatabaseClient); } catch { }
let AuthBusy_ = false;
let IsRecoveryUrl_ = false;
let SessionRecoveryInProgress_ = false;

function ensureAccessibleFormLabels_() {
  try {
    const controls = Array.from(document.querySelectorAll('input, select, textarea'));
    controls.forEach((el, index) => {
      try {
        if (el.type === 'hidden') return;
        if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
        const id = (el.id || '').toString().trim();
        if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return;
        const localLabel = el.closest('label') || el.closest('.form-group')?.querySelector?.('.label') || el.parentElement?.previousElementSibling;
        const labelText = (localLabel?.textContent || '').toString().replace(/\s+/g, ' ').trim();
        const fallback = (el.getAttribute('placeholder') || el.name || id || `حقل ${index + 1}`).toString().trim();
        el.setAttribute('aria-label', labelText || fallback);
      } catch { }
    });
  } catch { }
}

try {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureAccessibleFormLabels_);
  else ensureAccessibleFormLabels_();
  const observeLabels_ = () => {
    try {
      const observer = new MutationObserver(() => {
        try { ensureAccessibleFormLabels_(); } catch { }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch { }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeLabels_);
  else observeLabels_();
} catch { }

function computeIsRecoveryUrl_() {
  return false;
}
function getRememberMe_() {
  try { return (localStorage.getItem('rememberMe') || '') === '1'; } catch { return false; }
}
function setRememberMe_(v) {
  try { localStorage.setItem('rememberMe', v ? '1' : '0'); } catch { }
  if (!v) {
    clearPersistedAuthStorage_();
  }
}

const PERMISSIONS = [
  'dashboard',
  'reports',
  'settings',
  'audit',
  'medical_committee',
  'cases_read',
  'cases_create',
  'cases_edit',
  'cases_delete',
  'cases_delete_all',
  'case_status_change',
  'users_manage'
];

const PERMISSION_GROUPS = [
  {
    title: 'عام',
    items: ['dashboard', 'settings', 'audit', 'medical_committee']
  },
  {
    title: 'التقارير',
    items: ['reports']
  },
  {
    title: 'الحالات',
    items: ['cases_read', 'cases_create', 'cases_edit', 'case_status_change', 'cases_delete', 'cases_delete_all']
  },
  {
    title: 'الإدارة',
    items: ['users_manage']
  }
];
const GOVS = ['القاهرة', 'الجيزة', 'القليوبية', 'الإسكندرية', 'بورسعيد', 'السويس', 'دمياط', 'الدقهلية', 'الشرقية', 'الغربية', 'المنوفية', 'كفر الشيخ', 'البحيرة', 'الإسماعيلية', 'بني سويف', 'الفيوم', 'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'الوادي الجديد', 'مطروح', 'شمال سيناء', 'جنوب سيناء', 'البحر الأحمر'];
const CATEGORIES = ['تجهيز عرائس', 'أسقف', 'وصلات مياه', 'احتياجات ضرورية ملحة', 'مشروعات صغيرة', 'عمليات طبية', 'كفالات مرضية', 'كفالة شهرية', 'أيتام', 'طلاب علم'];
// قوائم خيارات عامة قابلة لإعادة الاستخدام
const RELATION_OPTIONS = [
  'الأم', 'الأب', 'الزوج', 'الزوجة', 'الابن', 'الابنة', 'زوجة الابن', 'زوج الابنة',
  'الأخ', 'الأخت', 'ابن الأخ', 'ابن الأخت', 'زوجة الأخ', 'زوج الأخت', 'الجد', 'الجدة',
  'العم', 'العمة', 'الخال', 'الخالة', 'صلة قرابة أخرى'
];
const WORKING_OPTIONS = ['نعم', 'لا', 'طالب/طالبة', 'مريض'];
const WORK_STABILITY_OPTIONS = ['عمل ثابت', 'عمل غير ثابت'];
const MARITAL_STATUS_OPTIONS = ['متزوج/متزوجة', 'أعزب/عزباء', 'مطلق/مطلقة', 'أرمل/أرملة', 'يتيم'];
const PROJECT_EXPERIENCE_OPTIONS = ['لا توجد خبرة', 'خبرة بسيطة', 'خبرة متوسطة', 'خبرة جيدة', 'مستعد/ة للتعلم'];

function permissionLabel_(k) {
  const map = {
    dashboard: 'الإحصائيات',
    reports: 'التقارير',
    settings: 'الإعدادات',
    audit: 'سجل الإجراءات',
    medical_committee: 'لجنة العمليات الطبية',
    cases_read: 'قراءة الحالات',
    cases_create: 'إضافة حالات',
    cases_edit: 'تعديل الحالات',
    cases_delete: 'حذف حالة',
    cases_delete_all: 'حذف كل الحالات',
    case_status_change: 'تغيير الحالة',
    users_manage: 'إدارة المستخدمين'
  };
  return map[k] || k;
}

function isHiddenSuperAdmin_() {
  try {
    const eff = getEffectivePermissions_(AppState.currentUser?.permissions || {});
    const role = (eff?.__role || '').toString().trim();
    return role === 'hidden_super_admin';
  } catch { return false; }
}

let userMgmtAutosaveTimer_ = null;

function wireUserMgmtAutosave_() {
  const host = document.getElementById('userMgmtPermissions');
  if (!host) return;
  if (host.getAttribute('data-wired') === '1') return;
  host.setAttribute('data-wired', '1');

  const schedule = () => {
    try { if (userMgmtAutosaveTimer_) clearTimeout(userMgmtAutosaveTimer_); } catch { }
    userMgmtAutosaveTimer_ = setTimeout(() => { void saveUserMgmtForm_(true); }, 350);
  };

  host.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('perm-box')) schedule();
  });

  const nameEl = document.getElementById('userMgmtName');
  if (nameEl) {
    nameEl.addEventListener('blur', schedule);
    nameEl.addEventListener('change', schedule);
  }
  const actEl = document.getElementById('userMgmtIsActive');
  if (actEl) actEl.addEventListener('change', schedule);
}

async function saveUserMgmtForm_(silent) {
  if (!hasPerm('users_manage')) { if (!silent) alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  if (!DatabaseClient) { if (!silent) alert('تعذر الاتصال بقاعدة البيانات'); return; }
  const uname = (document.getElementById('userMgmtUsername')?.value || '').trim();
  const name = (document.getElementById('userMgmtName')?.value || '').trim();
  if (!uname) return;

  const isActive = !!document.getElementById('userMgmtIsActive')?.checked;
  const role = (document.getElementById('userMgmtRole')?.value || 'custom').toString().trim() || 'custom';
  const { data: existing, error: exErr } = await DatabaseClient
    .from('users')
    .select('id,permissions')
    .eq('username', uname)
    .maybeSingle();
  if (exErr || !existing?.id) return;

  let permissions = (existing.permissions && typeof existing.permissions === 'object') ? existing.permissions : {};
  try {
    const host = document.getElementById('userMgmtPermissions');
    const uiVisible = !!(host && host.offsetParent !== null);
    if (uiVisible) {
      permissions = readUserPermissionsUi_();
      try { permissions.__role = role; } catch { }
      if (role && role !== 'custom') {
        permissions = { ...getRolePresetPermissions_(role), ...permissions, __role: role };
      }
    }
  } catch { }

  const { error } = await DatabaseClient.rpc('admin_update_profile', {
    p_username: uname,
    p_full_name: name,
    p_permissions: permissions,
    p_is_active: isActive
  });
  if (error) return;
  if (!silent) {
    try { await logAction('تحديث مستخدم (سريع)', '', `username: ${uname}`); } catch { }
  }
  try { await renderUsersList(); } catch { }
}

function buildUserPermissionsUi_(selected) {
  const host = document.getElementById('userMgmtPermissions');
  if (!host) return;
  const perms = selected && typeof selected === 'object' ? selected : {};
  const rendered = new Set();
  const mkItem = (k) => {
    const checked = !!perms[k];
    rendered.add(k);
    return `<label class="perm-item">
      <input type="checkbox" class="perm-box" data-perm="${k}" ${checked ? 'checked' : ''} />
      <span>${escapeHtml(permissionLabel_(k))}</span>
    </label>`;
  };

  const groupsHtml = (PERMISSION_GROUPS || []).map(g => {
    const items = (g.items || []).filter(k => (PERMISSIONS || []).includes(k));
    if (!items.length) return '';
    const inner = items.map(mkItem).join('');
    return `<details class="perm-group" open>
      <summary class="perm-group-title">${escapeHtml(g.title || '')}</summary>
      <div class="perm-group-grid">${inner}</div>
    </details>`;
  }).join('');

  const others = (PERMISSIONS || []).filter(k => !rendered.has(k));
  const othersHtml = others.length ? `<details class="perm-group" open>
      <summary class="perm-group-title">أخرى</summary>
      <div class="perm-group-grid">${others.map(mkItem).join('')}</div>
    </details>` : '';

  host.innerHTML = `${groupsHtml}${othersHtml}`;
  try { wireUserMgmtAutosave_(); } catch { }
}

async function setUserActiveQuick_(id, makeActive) {
  if (!DatabaseClient) return;
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  const v = !!makeActive;
  const ok = confirm(v ? 'تفعيل هذا المستخدم؟' : 'تعطيل هذا المستخدم؟');
  if (!ok) return;
  const { data: profileRow } = await DatabaseClient.from('users').select('username').eq('id', String(id)).maybeSingle();
  const uname = (profileRow?.username || '').toString().trim();
  const { error } = await DatabaseClient.rpc('admin_set_profile_active', {
    p_username: uname,
    p_is_active: v
  });
  if (error) { alert('تعذر تحديث حالة المستخدم'); return; }
  try {
    await logAction(v ? 'تفعيل مستخدم' : 'تعطيل مستخدم', '', `username: ${uname || ''} | id: ${id}`);
  } catch { }
  try { await renderUsersList(); } catch { }
}

function readUserPermissionsUi_() {
  const host = document.getElementById('userMgmtPermissions');
  const out = {};
  if (!host) return out;
  Array.from(host.querySelectorAll('input.perm-box')).forEach(b => {
    const k = b.getAttribute('data-perm');
    if (!k) return;
    out[k] = !!b.checked;
  });
  return out;
}

function getRolePresetPermissions_(roleKey) {
  const k = (roleKey || '').toString();
  const allow = (items) => {
    const obj = {};
    (items || []).forEach(p => { obj[p] = true; });
    return obj;
  };
  if (k === 'admin') {
    return allow(PERMISSIONS);
  }
  if (k === 'supervisor') {
    return allow([
      'dashboard', 'reports', 'settings', 'audit',
      'cases_read', 'cases_create', 'cases_edit', 'case_status_change'
    ]);
  }
  if (k === 'data_entry') {
    return allow([
      'dashboard', 'reports',
      'cases_read', 'cases_create', 'cases_edit'
    ]);
  }
  if (k === 'auditor') {
    return allow([
      'dashboard', 'reports', 'audit',
      'cases_read'
    ]);
  }
  if (k === 'viewer') {
    return allow([
      'dashboard', 'reports',
      'cases_read'
    ]);
  }
  return {};
}

function getUserRoleFromPermissions_(perms) {
  const p = perms && typeof perms === 'object' ? perms : {};
  const raw = (p.__role || p._role || '').toString().trim();
  return raw || 'custom';
}

function getEffectivePermissions_(perms) {
  const p = perms && typeof perms === 'object' ? perms : {};
  const role = getUserRoleFromPermissions_(p);
  if (!role || role === 'custom') {
    return { ...p };
  }
  const preset = getRolePresetPermissions_(role);
  return { ...preset, ...p };
}

function hasPerm(perm) {
  const p = AppState.currentUser?.permissions;
  if (!p || typeof p !== 'object') return false;
  const eff = getEffectivePermissions_(p);
  return !!eff[perm];
}

async function setCurrentUserFromSession_(user) {
  if (!user) return;
  const normalized = normalizeProfileRecord_(user) || user;
  const username = (normalized.username || (normalized.email || '').split('@')[0] || '').toString();
  const prof = await ensureProfileForUser(normalized, username);
  if (prof && prof.is_active === false) {
    try { await DatabaseClient?.auth?.signOut?.(); } catch { }
    throw new Error('inactive');
  }
  AppState.currentUser = {
    id: normalized.id,
    username: prof?.username || username,
    name: prof?.full_name || prof?.name || username,
    email: prof?.email || normalized.email || '',
    permissions: prof?.permissions || {}
  };
  AppState.isAuthenticated = true;
  try { AppState._myProfileCache = { userId: normalized.id, profile: prof || normalized }; } catch { }
}
function roleLabel() { return '👤' }

function usernameToEmail(u) {
  const raw = (u || '').toString().trim().toLowerCase();
  if (!raw) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : '';
}

async function ensureProfileForUser(user, username) {
  if (!user) return null;
  try {
    const id = (user.id || '').toString().trim();
    if (!id || !DatabaseClient) return normalizeProfileRecord_(user) || null;
    const hydrated = await fetchAuthenticatedProfile_();
    if (hydrated && hydrated.id === id) return hydrated;

    const { data: existing } = await DatabaseClient.from('users').select('*').eq('id', id).maybeSingle();

    if (existing) {
      if (!existing.username && username) {
        try { await DatabaseClient.from('users').update({ username: (username || '').toString().trim() }).eq('id', id); } catch { }
      }
      return existing;
    }
    return normalizeProfileRecord_(user) || null;
  } catch {
    return normalizeProfileRecord_(user) || null;
  }
}

async function getMyProfile() {
  if (!DatabaseClient) return null;
  if (AppState._myProfileCache && AppState._myProfileCache.userId && AppState._myProfileCache.profile) {
    return AppState._myProfileCache.profile;
  }
  const { data: auth, error: authErr } = await runAuthOp_(() => DatabaseClient.auth.getUser());
  if (authErr) return null;
  const user = auth?.user;
  if (!user) return null;
  const out = normalizeProfileRecord_(user) || user;
  AppState._myProfileCache = { userId: out.id, profile: out };
  return out;
}

async function getMyAuthUserId_() {
  if (!DatabaseClient) return null;
  try {
    const { data: auth, error } = await runAuthOp_(() => DatabaseClient.auth.getUser());
    if (error) return null;
    const id = auth?.user?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

function clearMyProfileCache_() {
  try { delete AppState._myProfileCache; } catch { }
}

function getAllPermissionsOn_() {
  const obj = {};
  (PERMISSIONS || []).forEach(k => { obj[k] = true; });
  return obj;
}

function normalizeMissingCoreFields_(it) {
  try {
    if (!it || typeof it !== 'object') return;
    const norm = (s) => (s ?? '').toString().trim();
    if (!norm(it.governorate)) it.governorate = 'غير محدد';
    if (!norm(it.area)) it.area = 'غير محدد';
    if (!norm(it.date)) it.date = 'غير محدد';
    if (!norm(it.explorerName)) it.explorerName = 'غير محدد';
  } catch { }
}

function ensureAssistanceArrays() {
  const normalize = (item) => {
    if (!item || typeof item !== 'object') return;
    if (!Array.isArray(item.sponsorships)) item.sponsorships = [];
    if (!Array.isArray(item.assistanceHistory)) item.assistanceHistory = [];
  };

  try {
    if (Array.isArray(AppState?.cases)) {
      AppState.cases.forEach(normalize);
    }
  } catch { }

  try { normalize(AppState?.currentCase); } catch { }
}

async function reloadCasesFromDatabase_() {
  try {
    await loadCasesFromDb(true);
  } catch { }
}

async function onDatabaseWriteError_(fallbackMsg, e) {
  try {
    const msg = (fallbackMsg || 'تعذر الحفظ في قاعدة البيانات حالياً.').toString();
    alert(`${msg}\n\nالخطأ: ${e?.message || 'خطأ غير معروف'}`);
  } catch {
    try { alert('تعذر الحفظ في قاعدة البيانات حالياً.'); } catch { }
  }
  try { await reloadCasesFromDatabase_(); } catch { }
}

async function loadCasesFromDb(force = false) {
  if (!DatabaseClient) { AppState.cases = []; return; }
  const previousLimit = Math.max(CASES_LIST_INITIAL_LIMIT, Number(AppState._casesListLimit || 0) || CASES_LIST_INITIAL_LIMIT);
  try {
    const lastAt = Number(AppState._casesLoadedAt || 0) || 0;
    if (!force && lastAt && (Date.now() - lastAt) < 8000 && Array.isArray(AppState.cases) && AppState.cases.length) {
      return;
    }
  } catch { }

  try {
    const grid = document.getElementById('casesCardsGrid');
    if (grid) {
      grid.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
          ${Array.from({ length: 6 }).map(() => `
            <div style="border:1px solid #e5e7eb;border-radius:14px;background:#fff;padding:14px">
              <div style="height:14px;width:60%;background:#eef2f7;border-radius:8px"></div>
              <div style="height:10px;width:85%;background:#eef2f7;border-radius:8px;margin-top:10px"></div>
              <div style="height:10px;width:70%;background:#eef2f7;border-radius:8px;margin-top:8px"></div>
              <div style="height:10px;width:40%;background:#eef2f7;border-radius:8px;margin-top:12px"></div>
            </div>`).join('')}
        </div>`;
    }
  } catch { }

  const { data, error } = await DatabaseClient
    .from('cases')
    .select('id,data,updated_at')
    .order('updated_at', { ascending: false });
  if (error) {
    AppState.cases = [];
    try {
      const grid = document.getElementById('casesCardsGrid');
      const msg = (error.message || '').toString();
      const code = (error.code || '').toString();
      if (grid) grid.innerHTML = `<div style="padding:14px;border:1px solid #fecaca;background:#fff1f2;color:#991b1b;border-radius:12px;text-align:center">تعذر تحميل الحالات من قاعدة البيانات.<br>تأكد من وجود الصلاحية <b>cases_read</b> للمستخدم ومن قواعد Supabase.<br><div style="margin-top:8px;color:#7f1d1d;font-size:.9rem">${escapeHtml(code ? `code: ${code} | ` : '')}${escapeHtml(msg)}</div></div>`;
    } catch { }
    throw error;
  }
  const list = (data || []).map(r => {
    const d = (r && r.data && typeof r.data === 'object') ? r.data : {};
    const out = { ...(d || {}), id: r.id, updated_at: r.updated_at };
    try { normalizeMissingCoreFields_(out); } catch { }
    return out;
  });
  AppState.cases = list;
  try { AppState._casesListLimit = Math.max(previousLimit, CASES_LIST_INITIAL_LIMIT); } catch { try { resetCasesListPager_(); } catch { } }
  try { AppState._casesLoadedAt = Date.now(); } catch { }
  try { AppState._casesVersion = (Number(AppState._casesVersion || 0) || 0) + 1; } catch { }
  ensureAssistanceArrays();
  try { ensureCaseNumbers_(); } catch { }
  computeNextCounterFromCases();
  try { renderCasesTable(); } catch { }
  try { markCasesDerivedDirty_(); } catch { }
  try { updateNavBadges(); } catch { }
}

async function upsertCaseToDb(caseObj) {
  if (!DatabaseClient) throw new Error('Supabase not configured');
  if (!caseObj || !caseObj.id) throw new Error('Missing case id');
  const prof = await getMyProfile();
  const actorId = (prof?.id || (await getMyAuthUserId_()) || null);
  const now = new Date().toISOString();
  const row = {
    id: String(caseObj.id),
    data: caseObj,
    created_by: actorId,
    updated_by: actorId,
    updated_at: now
  };
  const { data, error } = await DatabaseClient.from('cases').upsert(row).select('id,data,updated_at');
  if (error) {
    try { console.error('upsertCaseToDb error:', error); } catch { }
    throw error;
  }
  if (data && data[0]) {
    const saved = data[0];
    const idx = AppState.cases.findIndex(c => c.id === String(caseObj.id));
    if (idx >= 0 && saved.data && typeof saved.data === 'object') {
      AppState.cases[idx] = { ...saved.data, id: saved.id, updated_at: saved.updated_at };
    }
  }
  return data;
}

async function deleteCaseFromDb(id) {
  if (!DatabaseClient) throw new Error('Supabase not configured');
  const { error } = await DatabaseClient.rpc('delete_case', { p_id: String(id || '') });
  if (error) throw error;
}

async function deleteAllCasesFromDb() {
  if (!DatabaseClient) throw new Error('Supabase not configured');
  // Safety: never allow mass delete without explicit typed confirmation.
  let ok = false;
  try { ok = (prompt('تحذير خطير: اكتب DELETE-ALL لتأكيد حذف كل الحالات من قاعدة البيانات:') || '').toString().trim().toUpperCase() === 'DELETE-ALL'; } catch { ok = false; }
  if (!ok) throw new Error('cancelled');
  const { error } = await DatabaseClient.rpc('delete_all_cases', {});
  if (error) throw error;
}

async function syncCasesAfterMutation_(caseId = '', options = {}) {
  const uiState = options.uiState || captureCasesUiState_();
  try { await loadCasesFromDb(true); } catch { }
  const requestedId = (caseId || '').toString().trim();
  const fallbackCaseId = (options.fallbackCaseId || '').toString().trim();
  const activeId = requestedId && (AppState.cases || []).some((item) => String(item?.id || '').trim() === requestedId)
    ? requestedId
    : (fallbackCaseId && (AppState.cases || []).some((item) => String(item?.id || '').trim() === fallbackCaseId) ? fallbackCaseId : '');
  try { refreshCaseViews_(activeId, { ...options, reopenDetails: false }); } catch { }
  try {
    restoreCasesUiState_(uiState, {
      focusCaseId: activeId,
      reopenDetails: !!options.reopenDetails && !!activeId,
      caseDetailsTab: (options.preserveTab === false ? 'details' : (uiState.caseDetailsTab || options.caseDetailsTab || 'details')),
      forceOpenDetails: !!options.reopenDetails && !!activeId,
      restoreScroll: options.restoreScroll !== false
    });
  } catch { }
}

function initDashboardDrilldown() {
  const host = document.getElementById('dashboardSection');
  if (!host) return;
  const cards = host.querySelectorAll('[data-dashfilter]');
  cards.forEach(el => {
    el.addEventListener('click', () => {
      const key = el.getAttribute('data-dashfilter');
      if (!key) return;
      const label = el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : key;
      applyDashboardFilter(key, label);
    });
  });
}

function applyDashboardFilter(key, label) {
  AppState.dashboardFilter = { key, label };
  try { resetCasesListFilters(); } catch { }
  try {
    const bar = document.getElementById('casesListActiveFilter');
    const lab = document.getElementById('casesListActiveFilterLabel');
    if (lab) lab.textContent = label || '';
    if (bar) bar.classList.remove('hidden');
  } catch { }
  showSection('casesList', 'navCasesBtn');
  renderCasesTable();
}

function clearDashboardFilter() {
  AppState.dashboardFilter = null;
  try {
    const bar = document.getElementById('casesListActiveFilter');
    const lab = document.getElementById('casesListActiveFilterLabel');
    if (lab) lab.textContent = '';
    if (bar) bar.classList.add('hidden');
  } catch { }
  renderCasesTable();
}

function matchesDashboardFilter(c, key) {
  if (!key) return true;
  if (key === 'all') return true;
  const cat = (c.category || '').trim();
  const parts = cat ? cat.split(',').map(s => s.trim()).filter(Boolean) : [];
  const cats = parts.length ? parts : (cat ? [cat] : []);
  const housing = c.housing || {};
  const debts = c.debts || {};
  const fm = Array.isArray(c.familyMembers) ? c.familyMembers : [];

  if (key.startsWith('grade:')) {
    const want = key.slice(6).trim().toUpperCase();
    const g = String(c.caseGrade || '').trim().toUpperCase();
    return want ? g === want : true;
  }

  if (key.startsWith('gov:')) {
    const want = key.slice(4).trim();
    return want ? String(c.governorate || '').trim() === want : true;
  }

  if (key.startsWith('area:')) {
    const want = key.slice(5).trim();
    return want ? String(c.area || '').trim() === want : true;
  }

  if (key.startsWith('status:')) {
    const want = key.slice(7).trim();
    return want ? String(c.status || '').trim() === want : true;
  }

  if (key === 'need_funding') {
    const est = Number(c.estimatedAmount ?? 0) || 0;
    const del = Number(c.deliveredAmount ?? 0) || 0;
    return (est - del) > 0;
  }

  if (key === 'new_month') {
    const raw = (c.date || c.importInfo?.importDate || '').toString();
    if (!raw) return false;
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  if (key === 'alert:a_unapproved') {
    const grade = String(c.caseGrade || '').trim().toUpperCase();
    const st = String(c.status || '').trim();
    return grade === 'A' && st !== 'معتمدة' && st !== 'منفذة';
  }
  if (key === 'alert:stale_30') {
    const raw = (c.date || c.importInfo?.importDate || '').toString();
    if (!raw) return false;
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return false;
    const days = (Date.now() - d.getTime()) / 86400000;
    const st = String(c.status || '').trim();
    return days >= 30 && st !== 'منفذة';
  }
  if (key === 'alert:medical_urgent') {
    const isMed = cats.includes('عمليات طبية') || cats.includes('كفالات مرضية');
    const urg = String(c.urgency || '').trim();
    return isMed && (urg === 'عاجل' || urg === 'عاجل جدًا');
  }

  if (key.startsWith('cat:')) {
    const want = key.slice(4).trim();
    return want ? cats.includes(want) : true;
  }
  if (key === 'orphans') {
    const isOrphanCase = (c.maritalStatus || '').trim() === 'يتيم';
    const hasOrphanMember = fm.some(m => (m?.maritalStatus || '').trim() === 'يتيم');
    return isOrphanCase || hasOrphanMember;
  }
  if (key === 'dropouts') {
    return fm.some(m => (m?.education || '').includes('متسرب من التعليم'));
  }
  if (key === 'debts') {
    return !!debts.enabled;
  }
  if (key === 'sponsored') {
    const legacy = Array.isArray(c?.sponsorships) ? c.sponsorships : [];
    const unified = Array.isArray(c?.assistanceHistory) ? c.assistanceHistory : [];
    const hasUnified = unified.some(x => (x?.type || '').toString() === 'sponsorship');
    return hasUnified || legacy.length > 0;
  }
  if (key === 'need_bathroom') {
    return (housing.bathroomType || '').trim() === 'لا يوجد';
  }
  if (key === 'need_roof') {
    return (housing.roofExists || '').trim() === 'لا يوجد';
  }
  if (key === 'need_water') {
    return (housing.waterExists || '').trim() === 'لا يوجد';
  }
  if (key === 'need_medical_care') {
    return cats.includes('كفالات مرضية') || cats.includes('عمليات طبية');
  }
  if (key === 'need_medical_ops') {
    return cats.includes('عمليات طبية');
  }
  if (key === 'monthly_sponsorship') {
    return cats.includes('كفالة شهرية');
  }
  return true;
}
async function logAction(action, caseId, details) {
  try {
    if (!DatabaseClient) return;
    try { if (isHiddenSuperAdmin_()) return; } catch { }
    const prof = await getMyProfile();
    await DatabaseClient.from('audit_log').insert({
      action: action || '',
      case_id: caseId || '',
      details: details || '',
      created_by: prof?.id || null
    });
  } catch { }
  try { renderAuditLog(); } catch { }
}

async function renderAuditLog() {
  const body = document.getElementById('auditLogBody');
  if (!body) return;
  const delBody = document.getElementById('deletedCasesBody');
  const fmtDetails = (txt) => {
    let s = (txt || '').toString();
    try {
      if (s.includes('| data:')) s = s.split('| data:')[0].trim();
    } catch { }
    const full = s;
    try {
      if (s.length > 160) s = `${s.slice(0, 160)}...`;
    } catch { }
    return { short: s, full };
  };
  if (!DatabaseClient) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center">تعذر الاتصال بقاعدة البيانات</td></tr>';
    if (delBody) delBody.innerHTML = '<tr><td colspan="4" style="text-align:center">تعذر الاتصال بقاعدة البيانات</td></tr>';
    return;
  }
  const { data, error } = await DatabaseClient
    .from('audit_log')
    .select('created_at,action,case_id,details,profiles:created_by(username,full_name)')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    const msg = (error?.message || '').toString().trim();
    body.innerHTML = `<tr><td colspan="5" style="text-align:center">تعذر تحميل سجل الإجراءات${msg ? `: ${escapeHtml(msg)}` : ''}</td></tr>`;
    if (delBody) delBody.innerHTML = `<tr><td colspan="4" style="text-align:center">تعذر تحميل السجل${msg ? `: ${escapeHtml(msg)}` : ''}</td></tr>`;
    return;
  }
  const rows = (data || []).map(x => {
    const t = (x.created_at || '').toString().replace('T', ' ').replace('Z', '');
    const uname = x?.profiles?.username || '';
    const fname = x?.profiles?.full_name || '';
    const user = uname ? `${uname}${fname ? ` (${fname})` : ''}` : '';
    const d = fmtDetails(x.details);
    return `<tr><td>${t}</td><td>${user}</td><td>${x.action || ''}</td><td>${x.case_id || ''}</td><td title="${escapeHtml(d.full)}" style="max-width:520px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(d.short)}</td></tr>`;
  }).join('');
  body.innerHTML = rows || '<tr><td colspan="5" style="text-align:center">لا يوجد سجل بعد</td></tr>';

  // Deleted cases view (filter from audit log)
  if (delBody) {
    const dels = (data || []).filter(x => (x.action || '').toString().includes('حذف حالة'));
    const drows = dels.map(x => {
      const t = (x.created_at || '').toString().replace('T', ' ').replace('Z', '');
      const uname = x?.profiles?.username || '';
      const fname = x?.profiles?.full_name || '';
      const user = uname ? `${uname}${fname ? ` (${fname})` : ''}` : '';
      const details = (x.details || '').toString();
      let reason = details.includes('سبب:') ? details.split('سبب:')[1].trim() : details;
      try {
        if (reason.includes('| data:')) reason = reason.split('| data:')[0].trim();
      } catch { }
      return `<tr><td>${t}</td><td>${user}</td><td>${x.case_id || ''}</td><td>${escapeHtml(reason)}</td></tr>`;
    }).join('');
    delBody.innerHTML = drows || '<tr><td colspan="4" style="text-align:center">لا يوجد حذف مسجل بعد</td></tr>';
  }
}

async function exportAuditLog() {
  if (!DatabaseClient) return;
  const { data } = await DatabaseClient
    .from('audit_log')
    .select('created_at,action,case_id,details')
    .order('created_at', { ascending: false })
    .limit(1000);
  const txt = JSON.stringify({ meta: { exportedAt: new Date().toISOString() }, auditLog: data || [] }, null, 2);
  const blob = new Blob([txt], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearAuditLog() {
  alert('مسح سجل الإجراءات غير متاح حالياً');
}

document.addEventListener('DOMContentLoaded', () => { loadSettings(); init(); ensureAssistanceArrays(); try { loadPendingQueue_(); } catch { } try { void trySyncPendingQueue(); } catch { } });

function init() {
  try { IsRecoveryUrl_ = computeIsRecoveryUrl_(); } catch { IsRecoveryUrl_ = false; }
  try { AuthBusy_ = false; } catch { }
  try {
    window.addEventListener('beforeunload', () => {
      try {
        if (!getRememberMe_()) {
          clearPersistedAuthStorage_();
        }
      } catch { }
    });
  } catch { }
  // login
  document.getElementById('loginForm').addEventListener('submit', onLogin);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  try {
    const fp = document.getElementById('forgotPasswordBtn');
    if (fp) fp.addEventListener('click', sendPasswordResetEmail_);
  } catch { }
  try {
    const rm = document.getElementById('rememberMe');
    if (rm) rm.checked = getRememberMe_();
  } catch { }
  try {
    window.addEventListener('online', () => {
      try { void trySyncPendingQueue(); } catch { }
    });
  } catch { }
  const importInput = document.getElementById('importInput'); if (importInput) { importInput.addEventListener('change', onImportFile) }
  const jsonImportInput = document.getElementById('jsonImportInput'); if (jsonImportInput) { jsonImportInput.addEventListener('change', onJSONImportFile) }
  const listImportInput = document.getElementById('listImportInput'); if (listImportInput) { listImportInput.addEventListener('change', onListImportFile) }
  try { initPasswordToggles_(); } catch { }
  try { if (IsRecoveryUrl_) void detectRecoveryFlow_(); } catch { }
  try { initDashboardDrilldown(); } catch { }
  // filters options
  setFilterOptions();
  // header ui
  initHeaderUi();
  wireMobileNav_();
  // auth session events
  try {
    if (DatabaseClient?.auth?.onAuthStateChange) {
      DatabaseClient.auth.onAuthStateChange(async (_event, session) => {
        try { clearMyProfileCache_(); } catch { }
        if (!session?.user) return;
        if (AuthBusy_) return;
        if (IsRecoveryUrl_) return;
        try {
          await setCurrentUserFromSession_(session.user);
          showMainApp();
          try { await loadCasesFromDb(); } catch (e) { try { console.error(e); } catch { } }
        } catch (e) {
          try {
            const msg = (e && e.message ? String(e.message) : '').toLowerCase();
            if (msg.includes('aborterror') || msg.includes('signal is aborted')) return;
          } catch { }
          try { console.error('onAuthStateChange error:', e); } catch { }
        }
      });
    }
  } catch { }
  // restore session
  if (!SessionRecoveryInProgress_ && getRememberMe_()) {
    void restoreDatabaseSession();
  }
  try { buildUserPermissionsUi_({}); } catch { }

  try { if (!IsRecoveryUrl_) void detectRecoveryFlow_(); } catch { }
}

async function sendPasswordResetEmail_() {
  const hint = document.getElementById('loginHint');
  try {
    if (hint) {
      hint.classList.remove('hidden');
      hint.textContent = 'جارٍ إرسال رابط إعادة تعيين كلمة المرور...';
    }
  } catch { }
  if (!DatabaseClient) {
    try { if (hint) hint.textContent = 'تعذر الاتصال بقاعدة البيانات'; } catch { }
    return;
  }
  try {
    const raw = (document.getElementById('username')?.value || '').toString().trim();
    if (!raw) {
      try { if (hint) hint.textContent = 'اكتب البريد الإلكتروني أولًا'; } catch { }
      return;
    }
    const email = usernameToEmail(raw);
    if (!email) {
      try { if (hint) hint.textContent = 'أدخل بريدًا إلكترونيًا كاملًا مثل user@gmail.com'; } catch { }
      return;
    }

    const redirectTo = `${location.origin}${location.pathname}`;
    const res = await DatabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (res?.error) throw res.error;
    try {
      if (hint) {
        hint.textContent = 'تم إرسال رسالة إعادة تعيين كلمة المرور إلى البريد الإلكتروني إن كان الحساب موجودًا. افحص البريد الوارد والرسائل غير المرغوبة.';
      }
    } catch { }
    try { showToast_('تم إرسال رابط إعادة تعيين كلمة المرور إذا كان البريد موجودًا.', 'success'); } catch { }
    try {
      const fp = document.getElementById('forgotPasswordBtn');
      if (fp) fp.style.display = 'none';
    } catch { }
  } catch (e) {
    try { console.error('resetPasswordForEmail error:', e); } catch { }
    const msg = (e?.message || e?.error_description || '').toString().trim();
    try { if (hint) hint.textContent = msg ? `تعذر إرسال الرابط: ${msg}` : 'تعذر إرسال رابط إعادة تعيين كلمة المرور'; } catch { }
  }
}
async function detectRecoveryFlow_() {
  if (!DatabaseClient) return;
  if (SessionRecoveryInProgress_) {
    return;
  }
  SessionRecoveryInProgress_ = true;
  try {
  const hash = (location.hash || '').toString();
  const search = (location.search || '').toString();
  const raw = `${search}${hash}`;
  if (!raw) { SessionRecoveryInProgress_ = false; return; }
  const isRecovery = raw.includes('type=recovery') || raw.includes('access_token=') || raw.includes('code=');
  if (!isRecovery) { SessionRecoveryInProgress_ = false; return; }

  // Check if there's an error in the URL (e.g., otp_expired)
  const hasError = raw.includes('error=') || raw.includes('otp_expired') || raw.includes('invalid') || raw.includes('expired');
  if (hasError) {
    try {
      const hint = document.getElementById('loginHint');
      if (hint) {
        hint.classList.remove('hidden');
        hint.textContent = 'رابط إعادة تعيين كلمة المرور منتهي الصلاحية أو غير صالح. يرجى طلب رابط جديد من خلال "نسيت كلمة المرور؟".';
      }
      try { IsRecoveryUrl_ = false; } catch { }
      // Clear the hash to avoid repeated detection
      try { history.replaceState(null, '', location.pathname); } catch { }
    } catch { }
    SessionRecoveryInProgress_ = false;
    return; // Do not proceed to open modal
  }

  IsRecoveryUrl_ = true;

  // Open modal immediately without waiting for session activation
  try { openRecoveryPasswordModal(); } catch { }

  try {
    const hint = document.getElementById('loginHint');
    if (hint) {
      hint.classList.remove('hidden');
      hint.textContent = 'يرجى تعيين كلمة مرور جديدة لإكمال الاستعادة.';
    }
  } catch { }

  try {
    AuthBusy_ = true;
    if (DatabaseClient.auth.getSessionFromUrl) {
      await runAuthOp_(() => DatabaseClient.auth.getSessionFromUrl({ storeSession: true }));
    } else if (DatabaseClient.auth.exchangeCodeForSession && raw.includes('code=')) {
      await runAuthOp_(() => DatabaseClient.auth.exchangeCodeForSession(location.href));
    } else {
      const h = (location.hash || '').toString().replace(/^#/, '');
      const p = new URLSearchParams(h);
      const access_token = (p.get('access_token') || '').toString();
      const refresh_token = (p.get('refresh_token') || '').toString();
      if (access_token && refresh_token && DatabaseClient.auth.setSession) {
        await runAuthOp_(() => DatabaseClient.auth.setSession({ access_token, refresh_token }));
      }
    }
  } catch (e) {
    try { console.error('exchangeCodeForSession error:', e); } catch { }
  } finally {
    AuthBusy_ = false;
  }

  try {
    const { data } = await DatabaseClient.auth.getSession();
    if (data?.session?.user) {
      SessionRecoveryInProgress_ = false;
      return;
    }
  } catch { }

  // If no session was established, update the hint in the modal
  try {
    const hint = document.getElementById('recoveryHint');
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = 'تعذر تفعيل جلسة الاستعادة من الرابط. قد يكون هناك مشكلة في ساعة الجهاز (Clock Skew). تأكد أن ساعة الجهاز وساعة الإنترنت متطابقتان بشكل صحيح، ثم أعد إرسال رابط إعادة تعيين كلمة المرور.';
    }
  } catch { }
  } finally {
    try { SessionRecoveryInProgress_ = false; } catch { }
  }
}

function openRecoveryPasswordModal() {
  const m = document.getElementById('recoveryPasswordModal');
  if (!m) return;
  try { document.getElementById('recoveryNewPassword').value = ''; } catch { }
  try { document.getElementById('recoveryNewPassword2').value = ''; } catch { }
  try {
    const hint = document.getElementById('recoveryHint');
    if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
  } catch { }
  try { document.body.classList.add('modal-open'); } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try { document.getElementById('recoveryNewPassword')?.focus?.(); } catch { }
}

function closeRecoveryPasswordModal() {
  const m = document.getElementById('recoveryPasswordModal');
  if (!m) return;
  try {
    const ae = document.activeElement;
    if (ae && m.contains(ae) && typeof ae.blur === 'function') ae.blur();
  } catch { }
  m.classList.remove('show');
  m.setAttribute('aria-hidden', 'true');
  try { document.body.classList.remove('modal-open'); } catch { }
}

async function applyRecoveryPassword_() {
  const hint = document.getElementById('recoveryHint');
  const btn = document.getElementById('recoverySaveBtn');
  try { if (btn) btn.setAttribute('disabled', 'disabled'); } catch { }
  try { if (hint) { hint.style.display = 'block'; hint.textContent = 'جارٍ الحفظ...'; } } catch { }

  if (!DatabaseClient) {
    try { if (hint) hint.textContent = 'تعذر الاتصال بقاعدة البيانات'; } catch { }
    try { if (btn) btn.removeAttribute('disabled'); } catch { }
    return;
  }
  try {
    const p1 = (document.getElementById('recoveryNewPassword')?.value || '').toString();
    const p2 = (document.getElementById('recoveryNewPassword2')?.value || '').toString();
    if (!p1.trim() || !p2.trim()) {
      if (hint) hint.textContent = 'أدخل كلمة المرور الجديدة وتأكيدها';
      return;
    }
    const passwordPolicyError = validatePasswordPolicy_(p1.trim());
    if (passwordPolicyError) {
      if (hint) hint.textContent = passwordPolicyError;
      return;
    }
    if (p1 !== p2) {
      if (hint) hint.textContent = 'كلمة المرور وتأكيدها غير متطابقين';
      return;
    }

    const res = await withTimeout_(
      runAuthOp_(() => DatabaseClient.auth.updateUser({ password: p1 })),
      15000,
      'تعذر حفظ كلمة المرور: انتهت المهلة. أعد المحاولة.'
    );
    if (res?.error) throw res.error;

    if (hint) hint.textContent = 'تم تحديث كلمة المرور. جارٍ إعادة تحميل الصفحة...';
    try {
      const cleanUrl = `${location.origin}${location.pathname}`;
      history.replaceState(null, '', cleanUrl);
    } catch { }

    try {
      void withTimeout_(
        runAuthOp_(() => DatabaseClient.auth.signOut(), { retryLock: true }),
        7000,
        'timeout'
      );
    } catch { }
    try {
      IsRecoveryUrl_ = false; // Reset flag after successful password change
      closeRecoveryPasswordModal();
      showLoginScreen_();
    } catch { }
    setTimeout(() => { try { location.reload(); } catch { } }, 900);
    setTimeout(() => { try { location.reload(); } catch { } }, 5500);
  } catch (e) {
    try { console.error('applyRecoveryPassword_ error:', e); } catch { }
    const msg = (e?.message || e?.error_description || '').toString().trim();
    if (hint) hint.textContent = msg ? `تعذر حفظ كلمة المرور: ${msg}` : 'تعذر حفظ كلمة المرور';
  } finally {
    try { delete AppState._lastValidatedPassword; } catch { }
    try { if (btn) btn.removeAttribute('disabled'); } catch { }
  }
}

function showMainApp() {
  try {
    const login = document.getElementById('loginScreen');
    const app = document.getElementById('mainApp');
    if (login) login.classList.add('hidden');
    if (app) app.classList.remove('hidden');
  } catch { }
  try {
    const u = AppState.currentUser;
    const nameInline = document.getElementById('userNameInline');
    const menuName = document.getElementById('userMenuName');
    const menuMeta = document.getElementById('userMenuMeta');
    const nm = (u?.name || u?.username || '').toString();
    if (nameInline) nameInline.textContent = nm;
    if (menuName) menuName.textContent = (u?.name || u?.username || '').toString();
    if (menuMeta) menuMeta.textContent = (u?.username ? `@${u.username}` : '').toString();
  } catch { }

  try { applyRoleBasedUi_(); } catch { }
}

function applyRoleBasedUi_() {
  const eff = getEffectivePermissions_(AppState.currentUser?.permissions || {});
  const role = (eff?.__role || 'custom').toString().trim() || 'custom';

  const setBtn = (id, show) => {
    try {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? '' : 'none';
    } catch { }
  };

  const can = (p) => {
    try { return !!eff?.[p]; } catch { return false; }
  };
  const canOpenMedical = () => {
    try {
      return can('medical_committee') || can('reports') || can('users_manage') || role === 'manager' || role === 'doctor' || role === 'medical_committee' || role === 'super_admin' || role === 'hidden_super_admin';
    } catch { return false; }
  };

  try {
    const delAllBtn = document.getElementById('deleteAllCasesBtn');
    if (delAllBtn) delAllBtn.style.display = can('cases_delete_all') ? '' : 'none';
  } catch { }

  // default by permissions
  setBtn('quickAddBtn', can('cases_create'));
  setBtn('navCasesBtn', can('cases_read'));
  setBtn('beneficiariesBtn', can('cases_read'));
  setBtn('regionsBtn', can('cases_read') || can('reports') || can('dashboard'));
  setBtn('dashboardBtn', can('dashboard'));
  setBtn('auditBtn', can('audit'));
  setBtn('settingsBtn', can('settings'));
  setBtn('medicalCommitteeBtn', canOpenMedical());
  setBtn('reportsBtn', can('reports'));
  setBtn('globalSearchBtn', can('cases_read') || can('users_manage') || can('audit'));
  setBtn('notificationsBtn', can('cases_read') || can('dashboard'));
  setBtn('usersBtn', can('users_manage'));

  // strict visibility rules per role
  if (role === 'explorer') {
    setBtn('quickAddBtn', true);
    setBtn('navCasesBtn', true);
    setBtn('beneficiariesBtn', true);
    setBtn('regionsBtn', true);
    setBtn('settingsBtn', true);
    setBtn('medicalCommitteeBtn', false);
    setBtn('dashboardBtn', false);
    setBtn('reportsBtn', false);
    setBtn('globalSearchBtn', true);
    setBtn('notificationsBtn', true);
    setBtn('usersBtn', false);
    setBtn('auditBtn', false);
  }
  if (role === 'manager') {
    setBtn('quickAddBtn', true);
    setBtn('navCasesBtn', true);
    setBtn('beneficiariesBtn', true);
    setBtn('regionsBtn', true);
    setBtn('settingsBtn', true);
    setBtn('dashboardBtn', true);
    setBtn('medicalCommitteeBtn', true);
    setBtn('reportsBtn', true);
    setBtn('globalSearchBtn', true);
    setBtn('notificationsBtn', true);
    setBtn('usersBtn', true);
    setBtn('auditBtn', false);
  }
  if (role === 'doctor') {
    setBtn('medicalCommitteeBtn', true);
    setBtn('quickAddBtn', false);
    setBtn('navCasesBtn', false);
    setBtn('beneficiariesBtn', false);
    setBtn('regionsBtn', false);
    setBtn('dashboardBtn', false);
    setBtn('reportsBtn', false);
    setBtn('auditBtn', false);
    setBtn('settingsBtn', true);
    setBtn('globalSearchBtn', true);
    setBtn('notificationsBtn', true);
    setBtn('usersBtn', false);
  }
  if (role === 'medical_committee') {
    setBtn('medicalCommitteeBtn', true);
    setBtn('quickAddBtn', false);
    setBtn('navCasesBtn', false);
    setBtn('beneficiariesBtn', false);
    setBtn('regionsBtn', false);
    setBtn('dashboardBtn', false);
    setBtn('reportsBtn', false);
    setBtn('auditBtn', false);
    setBtn('settingsBtn', false);
    setBtn('globalSearchBtn', true);
    setBtn('notificationsBtn', true);
    setBtn('usersBtn', false);
  }
  if (role === 'hidden_super_admin') {
    // full access (still hidden from user lists and audit log)
    setBtn('quickAddBtn', true);
    setBtn('navCasesBtn', true);
    setBtn('beneficiariesBtn', true);
    setBtn('regionsBtn', true);
    setBtn('dashboardBtn', true);
    setBtn('reportsBtn', true);
    setBtn('auditBtn', true);
    setBtn('settingsBtn', true);
    setBtn('medicalCommitteeBtn', true);
    setBtn('globalSearchBtn', true);
    setBtn('notificationsBtn', true);
    setBtn('usersBtn', true);
  }

  // Hide settings entry from dropdown if user can't access settings
  try {
    const menuSettings = document.getElementById('userSettingsBtn');
    if (menuSettings) menuSettings.style.display = can('settings') ? '' : 'none';
  } catch { }
}

function showLoginScreen_() {
  try {
    const login = document.getElementById('loginScreen');
    const app = document.getElementById('mainApp');
    if (app) app.classList.add('hidden');
    if (login) login.classList.remove('hidden');
  } catch { }
  try {
    const err = document.getElementById('loginError');
    if (err) err.classList.add('hidden');
  } catch { }
  try {
    const pwd = document.getElementById('password');
    if (pwd) pwd.value = '';
  } catch { }
}

async function onLogin(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const errBox = document.getElementById('loginError');
  const hintBox = document.getElementById('loginHint');
  const forgotBtn = document.getElementById('forgotPasswordBtn');
  const uEl = document.getElementById('username');
  const pEl = document.getElementById('password');
  const submitBtn = document.querySelector('#loginForm button[type="submit"]');
  try { if (errBox) errBox.classList.add('hidden'); } catch { }
  try { if (hintBox) hintBox.classList.add('hidden'); } catch { }
  try { if (forgotBtn) forgotBtn.style.display = 'none'; } catch { }
  try { uEl?.classList?.remove?.('control-error'); } catch { }
  try { pEl?.classList?.remove?.('control-error'); } catch { }

  if (IsRecoveryUrl_) {
    try {
      if (hintBox) {
        hintBox.classList.remove('hidden');
        hintBox.textContent = 'أكمل تغيير كلمة المرور أولاً من نافذة الاستعادة.';
      }
      openRecoveryPasswordModal();
    } catch { }
    return;
  }

  if (AuthBusy_) {
    try {
      if (hintBox) {
        hintBox.classList.remove('hidden');
        hintBox.textContent = 'النظام مشغول الآن… انتظر ثوانٍ ثم أعد المحاولة.';
      }
    } catch { }
    try {
      setTimeout(() => {
        try { AuthBusy_ = false; } catch { }
      }, 1500);
    } catch { }
    return;
  }
  AuthBusy_ = true;

  const email = usernameToEmail((document.getElementById('username')?.value || '').toString().trim());
  const password = (document.getElementById('password')?.value || '').toString();
  if (!email || !password) {
    try { if (errBox) errBox.classList.remove('hidden'); } catch { }
    try {
      if (hintBox && !email) {
        hintBox.classList.remove('hidden');
        hintBox.textContent = 'يجب تسجيل الدخول بالبريد الإلكتروني الكامل فقط، مثل user@gmail.com';
      }
    } catch { }
    AuthBusy_ = false;
    try { if (submitBtn) submitBtn.removeAttribute('disabled'); } catch { }
    return;
  }
  if (!DatabaseClient) {
    alert('تعذر الاتصال بقاعدة البيانات');
    AuthBusy_ = false;
    try { if (submitBtn) submitBtn.removeAttribute('disabled'); } catch { }
    return;
  }

  try { if (submitBtn) submitBtn.setAttribute('disabled', 'disabled'); } catch { }

  try {
    const rm = !!document.getElementById('rememberMe')?.checked;
    if (rm !== getRememberMe_()) setRememberMe_(rm);
  } catch { }

  try {
    let lastErr = null;
    let data = null;
    try {
      const res = await runAuthOp_(() => DatabaseClient.auth.signInWithPassword({ email, password }));
      if (res?.error) { lastErr = res.error; }
      data = res?.data || null;
    } catch (ex) {
      lastErr = ex;
    }

    if (!data?.user) {
      if (lastErr) throw lastErr;
      throw new Error('no_user');
    }
    const user = data.user;
    if (!user) throw new Error('no_user');

    await setCurrentUserFromSession_(user);
    showMainApp();
    try { showSection('casesList', 'navCasesBtn'); } catch { }
    try { await loadCasesFromDb(); } catch (loadErr) { try { console.error(loadErr); } catch { } }
    try { document.getElementById('password').value = ''; } catch { }
    try { uEl?.classList?.remove?.('control-error'); } catch { }
    try { pEl?.classList?.remove?.('control-error'); } catch { }
    try { if (forgotBtn) forgotBtn.style.display = 'none'; } catch { }
  } catch (authErr) {
    try { console.error('login error:', authErr); } catch { }
    // Better hint: user may exist but the password is wrong or the account is inactive in Supabase.
    try {
      const unameKey = (email || '').toString().trim();
      let profRow = null;
      try {
        const q = await DatabaseClient
          .from('users')
          .select('id,username,is_active')
          .eq('username', unameKey)
          .maybeSingle();
        if (!q?.error) profRow = q?.data || null;
      } catch { profRow = null; }

      if (profRow && profRow.is_active === false) {
        alert('هذا المستخدم معطل. راجع الإدارة لإعادة التفعيل.');
        try {
          if (forgotBtn) { forgotBtn.style.display = 'block'; }
          if (hintBox) {
            hintBox.classList.remove('hidden');
            hintBox.textContent = 'إذا نسيت كلمة المرور اضغط على "نسيت كلمة المرور؟" لإرسال رابط إعادة التعيين.';
          }
        } catch { }
        try { showToast_('إذا نسيت كلمة المرور اضغط على "نسيت كلمة المرور؟" لإرسال رابط إعادة التعيين.', 'warning'); } catch { }
        return;
      }
      if (profRow) {
        alert(
          'البريد الإلكتروني موجود كاسم مستخدم، لكن تعذر تسجيل الدخول.\n\n' +
          'الأسباب الشائعة:\n' +
          '- كلمة المرور غير صحيحة\n' +
          '- البريد غير موجود داخل Supabase Auth أو الحساب غير مفعل'
        );
        try {
          if (forgotBtn) { forgotBtn.style.display = 'block'; }
          if (hintBox) {
            hintBox.classList.remove('hidden');
            hintBox.textContent = 'إذا نسيت كلمة المرور اضغط على "نسيت كلمة المرور؟" لإرسال رابط إعادة التعيين.';
          }
        } catch { }
        try { showToast_('إذا نسيت كلمة المرور اضغط على "نسيت كلمة المرور؟" لإرسال رابط إعادة التعيين.', 'warning'); } catch { }
        return;
      }
    } catch { }

    try { uEl?.classList?.add?.('control-error'); } catch { }
    try { pEl?.classList?.add?.('control-error'); } catch { }

    try { if (errBox) errBox.classList.remove('hidden'); } catch { }
    try {
      if (forgotBtn) { forgotBtn.style.display = 'block'; }
      if (hintBox) {
        hintBox.classList.remove('hidden');
        hintBox.textContent = 'إذا نسيت كلمة المرور اضغط على "نسيت كلمة المرور؟" لإرسال رابط إعادة التعيين.';
      }
    } catch { }
    try { showToast_('بيانات الدخول غير صحيحة', 'error'); } catch { }
    try { showToast_('إذا نسيت كلمة المرور اضغط على "نسيت كلمة المرور؟" لإرسال رابط إعادة التعيين.', 'warning'); } catch { }
  } finally {
    AuthBusy_ = false;
    try { if (submitBtn) submitBtn.removeAttribute('disabled'); } catch { }
  }
}

async function logout() {
  // Make UI respond immediately even if signOut is slow.
  try {
    AppState.currentUser = null;
    AppState.isAuthenticated = false;
  } catch { }
  try { showLoginScreen_(); } catch { }
  try {
    const menu = document.getElementById('userMenu');
    const btn = document.getElementById('userMenuBtn');
    if (menu) { menu.classList.add('hidden'); menu.setAttribute('aria-hidden', 'true'); }
    if (btn) btn.setAttribute('aria-expanded', 'false');
  } catch { }
  try {
    AuthBusy_ = false;
    IsRecoveryUrl_ = false;
  } catch { }
  try {
    if (DatabaseClient?.auth?.signOut) {
      await withTimeout_(
        runAuthOp_(() => DatabaseClient.auth.signOut(), { retryLock: true }),
        7000,
        'timeout'
      );
    }
  } catch { }
  // Ensure local persisted session is cleared even if signOut fails.
  try { clearPersistedAuthStorage_(); } catch { }
  try {
    AppState.currentUser = null;
    AppState.isAuthenticated = false;
  } catch { }
  try { showLoginScreen_(); } catch { }
  // Avoid requiring a manual reload to make login responsive.
  try { setTimeout(() => { try { location.reload(); } catch { } }, 200); } catch { }
}

function showDefaultAllowedSection_() {
  try {
    if (hasPerm('cases_read')) return showSection('casesList', 'navCasesBtn');
    if (hasPerm('dashboard')) return showSection('dashboard', 'dashboardBtn');
    if (hasPerm('reports')) return showSection('reports', 'reportsBtn');
    if (hasPerm('settings')) return showSection('settings', 'settingsBtn');
  } catch { }
  try { showSection('settings', 'settingsBtn'); } catch { }
}

function countBy_(rows, getter) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = (getter(row) || 'غير محدد').toString().trim() || 'غير محدد';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function renderBeneficiariesPage_() {
  const host = document.getElementById('beneficiariesContent');
  if (!host) return;
  const q = (document.getElementById('beneficiarySearch')?.value || '').toString().trim().toLowerCase();
  const rows = (AppState.cases || []).filter((item) => {
    const hay = [item.familyHead, item.phone, item.whatsapp, item.governorate, item.area, item.address, item.id].join(' ').toLowerCase();
    return !q || hay.includes(q);
  }).slice(0, 250);
  if (!rows.length) {
    host.innerHTML = '<div class="ds-empty-state">لا توجد أسر مطابقة للبحث الحالي.</div>';
    return;
  }
  host.innerHTML = `<table><thead><tr><th>الأسرة</th><th>الهاتف</th><th>المحافظة</th><th>المنطقة</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${rows.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.familyHead || 'بدون اسم')}</strong><br><small>${escapeHtml(item.id || '')}</small></td>
      <td>${escapeHtml(item.phone || item.whatsapp || '-')}</td>
      <td>${escapeHtml(item.governorate || '-')}</td>
      <td>${escapeHtml(item.area || '-')}</td>
      <td><span class="pill">${escapeHtml(item.status || 'جديدة')}</span></td>
      <td><button class="btn mini" type="button" onclick="openCaseDetails('${escapeHtml(item.id)}')">عرض</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function renderRegionsPage_() {
  const host = document.getElementById('regionsContent');
  if (!host) return;
  const cases = AppState.cases || [];
  const govs = countBy_(cases, (item) => item.governorate);
  const areas = countBy_(cases, (item) => item.area).slice(0, 12);
  const item = ([name, count], kind) => `
    <button class="region-stat-item" type="button" onclick="showSection('casesList','navCasesBtn')" data-region-kind="${escapeHtml(kind)}">
      <span class="region-stat-name">${escapeHtml(name)}</span>
      <span class="region-stat-count">${escapeHtml(String(count))}</span>
    </button>`;
  const card = (title, hint, kind, list) => `
    <section class="ds-section-panel region-stat-panel">
      <div class="region-stat-panel-head">
        <div class="ds-section-panel-title">${escapeHtml(title)}</div>
        <p class="region-stat-panel-hint">${escapeHtml(hint)}</p>
      </div>
      <div class="region-stat-list">
        ${list.length ? list.map((entry) => item(entry, kind)).join('') : '<div class="ds-empty-state compact">لا توجد بيانات مناطق بعد.</div>'}
      </div>
    </section>`;
  host.innerHTML =
    card('المحافظات', 'توزيع الحالات حسب المحافظة', 'governorate', govs) +
    card('المناطق الأكثر نشاطاً', 'أكثر المناطق حضورًا داخل الحالات الحالية', 'area', areas);
}

function renderGlobalSearchPage_() {
  const host = document.getElementById('globalSearchResults');
  if (!host) return;
  const q = (document.getElementById('globalSearchInput')?.value || '').toString().trim().toLowerCase();
  if (!q) {
    host.innerHTML = '<div class="ds-empty-state">اكتب كلمة بحث لعرض النتائج من الحالات والأسر والمناطق.</div>';
    return;
  }
  const rows = (AppState.cases || []).filter((item) => [
    item.id, item.familyHead, item.phone, item.whatsapp, item.governorate, item.area, item.address, item.category, item.status, item.needsShort
  ].join(' ').toLowerCase().includes(q)).slice(0, 40);
  host.innerHTML = rows.length ? rows.map((item) => `
    <article class="case-card" onclick="openCaseDetails('${escapeHtml(item.id)}')">
      <h3 class="case-card-title">${escapeHtml(item.familyHead || 'حالة بدون اسم')}</h3>
      <p>${escapeHtml([item.governorate, item.area, item.category].filter(Boolean).join(' - ') || 'لا توجد بيانات تصنيف')}</p>
      <span class="pill">${escapeHtml(item.status || 'جديدة')}</span>
    </article>`).join('') : '<div class="ds-empty-state">لا توجد نتائج مطابقة.</div>';
}

function renderNotificationsPage_() {
  const host = document.getElementById('notificationsContent');
  if (!host) return;
  const cases = AppState.cases || [];
  const items = [];
  cases.filter((c) => String(c.urgency || '').includes('عاجل')).slice(0, 12).forEach((c) => items.push({ level: 'warn', title: 'حالة عاجلة', text: c.familyHead || c.id, id: c.id }));
  cases.filter((c) => String(c.category || '').includes('طبية') || String(c.category || '').includes('مرضية')).slice(0, 12).forEach((c) => items.push({ level: 'ok', title: 'متابعة طبية', text: c.familyHead || c.id, id: c.id }));
  cases.filter((c) => !c.phone && !c.whatsapp).slice(0, 12).forEach((c) => items.push({ level: 'info', title: 'بيانات ناقصة', text: `لا يوجد هاتف للحالة: ${c.familyHead || c.id}`, id: c.id }));
  host.innerHTML = items.length ? items.slice(0, 30).map((item) => `
    <article class="case-card">
      <span class="pill ${item.level === 'warn' ? 'danger' : ''}">${escapeHtml(item.title)}</span>
      <h3 class="case-card-title">${escapeHtml(item.text)}</h3>
      <button class="btn mini" type="button" onclick="openCaseDetails('${escapeHtml(item.id)}')">فتح الحالة</button>
    </article>`).join('') : '<div class="ds-empty-state">لا توجد إشعارات حالياً.</div>';
}

function showSection(key, navBtnId) {
  const map = {
    newCase: 'newCaseSection',
    casesList: 'casesListSection',
    beneficiaries: 'beneficiariesSection',
    regions: 'regionsSection',
    dashboard: 'dashboardSection',
    reports: 'reportsSection',
    globalSearch: 'globalSearchSection',
    notifications: 'notificationsSection',
    audit: 'auditSection',
    settings: 'settingsSection',
    userManagement: 'userManagementSection',
    medicalCommittee: 'medicalCommitteeSection',
    unauthorized: 'unauthorizedSection',
    notFound: 'notFoundSection'
  };

  try {
    const targetId0 = map[key] || key;
    const eff = getEffectivePermissions_(AppState.currentUser?.permissions || {});
    const role = (eff?.__role || 'custom').toString().trim();

      const allow = (permKey, targetId) => {
        if (!permKey) return true;
        if (targetId === 'medicalCommitteeSection') {
          return !!(
            eff?.medical_committee ||
            eff?.reports ||
            eff?.users_manage ||
            role === 'manager' ||
            role === 'doctor' ||
            role === 'medical_committee' ||
            role === 'super_admin' ||
            role === 'hidden_super_admin'
          );
        }
        return !!eff?.[permKey];
      };

    const need = {
      newCaseSection: 'cases_create',
      casesListSection: 'cases_read',
      beneficiariesSection: 'cases_read',
      regionsSection: 'cases_read',
      dashboardSection: 'dashboard',
      reportsSection: 'reports',
      globalSearchSection: 'cases_read',
      notificationsSection: 'cases_read',
      auditSection: 'audit',
      settingsSection: 'settings',
      userManagementSection: 'users_manage',
      medicalCommitteeSection: 'medical_committee',
      unauthorizedSection: null,
      notFoundSection: null
    };
    const perm = need[targetId0];
    if (!allow(perm, targetId0)) {
      const isBootstrapping = !AppState?.isAuthenticated || !AppState?.currentUser || !Object.keys(eff || {}).length;
      if (!isBootstrapping) {
        showSection('unauthorized');
      }
      return;
    }
  } catch { }

  try { closeMobileNav(); } catch { }

  const all = Object.values(map);
  all.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const targetId = map[key] || key;
  const target = document.getElementById(targetId);
  if (target) target.classList.remove('hidden');

  try { refreshDerivedViewsIfNeeded_(targetId); } catch { }

  if (targetId === 'auditSection') {
    try { void renderAuditLog(); } catch { }
  }

  // If user navigates to a derived section after another one cleared the dirty flag,
  // ensure it still refreshes when cases changed.
  try {
    const v = Number(AppState._casesVersion || 0) || 0;
    if (targetId === 'dashboardSection') {
      const seen = Number(AppState._dashboardRenderedVersion || 0) || 0;
      if (v && v !== seen) {
        try { updateDashboardStats(); } catch { }
        try { AppState._dashboardRenderedVersion = v; } catch { }
      }
    } else if (targetId === 'reportsSection') {
      const seen = Number(AppState._reportsRenderedVersion || 0) || 0;
      if (v && v !== seen) {
        try { generateReportPreview(); } catch { }
        try { AppState._reportsRenderedVersion = v; } catch { }
      }
    } else if (targetId === 'medicalCommitteeSection') {
      const seen = Number(AppState._medicalRenderedVersion || 0) || 0;
      if (v && v !== seen) {
        try { updateMedicalCommitteeStats(); } catch { }
        try { renderMedicalTable(); } catch { }
        try { AppState._medicalRenderedVersion = v; } catch { }
      }
    }
  } catch { }

  if (targetId === 'settingsSection') {
    try {
      const canManageUsers = hasPerm('users_manage');
      const usersCard = document.querySelector('#settingsSection .settings-users-home-card');
      if (usersCard) usersCard.style.display = canManageUsers ? '' : 'none';
    } catch { }
  }

  if (targetId === 'newCaseSection') {
    try {
      const f = document.getElementById('caseForm');
      if (f) {
        f.innerHTML = '';
        f.removeAttribute('data-rendered');
        f.removeAttribute('data-wired');
      }
    } catch { }
    try { renderNewCaseForm_(); } catch { }
  }

  if (targetId === 'beneficiariesSection') {
    try { renderBeneficiariesPage_(); } catch { }
  }

  if (targetId === 'regionsSection') {
    try { renderRegionsPage_(); } catch { }
  }

  if (targetId === 'globalSearchSection') {
    try { renderGlobalSearchPage_(); } catch { }
  }

  if (targetId === 'notificationsSection') {
    try { renderNotificationsPage_(); } catch { }
  }

  if (targetId === 'userManagementSection') {
    try { syncSettingsPermissionsUi_(); } catch { }
    try { setTimeout(() => { try { void renderUsersList(); } catch { } }, 0); } catch { }
  }

  try {
    const defaultNavMap = {
      newCaseSection: 'quickAddBtn',
      casesListSection: 'navCasesBtn',
      beneficiariesSection: 'beneficiariesBtn',
      regionsSection: 'regionsBtn',
      dashboardSection: 'dashboardBtn',
      reportsSection: 'reportsBtn',
      globalSearchSection: 'globalSearchBtn',
      notificationsSection: 'notificationsBtn',
      auditSection: 'auditBtn',
      settingsSection: 'settingsBtn',
      userManagementSection: 'usersBtn',
      medicalCommitteeSection: 'medicalCommitteeBtn'
    };
    const resolvedNavBtnId = navBtnId || defaultNavMap[targetId] || '';
    Array.from(document.querySelectorAll('#mainNav .nav-btn, #mainNav .sidebar-nav-item')).forEach(b => b.classList.remove('active'));
    if (resolvedNavBtnId) {
      const btn = document.getElementById(resolvedNavBtnId);
      if (btn) btn.classList.add('active');
    }
  } catch { }

  try {
    const topbarTitle = document.querySelector('.topbar-title');
    if (topbarTitle) {
      const sectionTitles = {
        newCaseSection: 'إضافة حالة جديدة',
        casesListSection: 'قائمة الحالات',
        beneficiariesSection: 'المستفيدون والأسر',
        regionsSection: 'المناطق والمحافظات',
        dashboardSection: 'الإحصائيات',
        reportsSection: 'التقارير',
        globalSearchSection: 'البحث العام',
        notificationsSection: 'الإشعارات',
        auditSection: 'سجل الإجراءات',
        settingsSection: 'الإعدادات',
        userManagementSection: 'إدارة المستخدمين',
        medicalCommitteeSection: 'لجنة العمليات الطبية',
        unauthorizedSection: 'غير مصرح',
        notFoundSection: 'الصفحة غير موجودة'
      };
      topbarTitle.textContent = sectionTitles[targetId] || 'لجنة أسرة كريمة';
    }
  } catch { }
}

async function restoreDatabaseSession() {
  if (!DatabaseClient) return;
  if (!getRememberMe_()) return;
  if (AuthBusy_) return;
  if (IsRecoveryUrl_) return;
  try { if (DatabaseClient?.auth?.authRefresh) await runAuthOp_(() => DatabaseClient.auth.authRefresh(), { retryLock: false }); } catch { }
  const { data: sess, error } = await runAuthOp_(() => DatabaseClient.auth.getSession(), { retryLock: false });
  if (error) {
    try { console.error('getSession error:', error); } catch { }
    return;
  }
  if (!sess?.session?.user) return;
  try {
    await setCurrentUserFromSession_(sess.session.user);
    showMainApp();
    // Ensure we render the cases section after refresh
    try { showSection('casesList', 'navCasesBtn'); } catch { }
    try { await loadCasesFromDb(); } catch (e) { try { console.error('loadCasesFromDb error:', e); } catch { } }
  } catch (e) {
    try { console.error('restoreDatabaseSession error:', e); } catch { }
  }
}



function formatTodayDDMMYYYY() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function parseDDMMYYYYToISO(raw) {
  const s = (raw || '').toString().trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  if (!yyyy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  const dt = new Date(yyyy, mm - 1, dd);
  if (dt.getFullYear() !== yyyy || (dt.getMonth() + 1) !== mm || dt.getDate() !== dd) return '';
  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function getImportMeta() {
  const metaGov = (document.getElementById('importGovernorate')?.value || '').trim();
  const metaArea = (document.getElementById('importArea')?.value || '').trim();
  const metaDateRaw = (document.getElementById('importDate')?.value || '').trim();
  const metaDate = parseDDMMYYYYToISO(metaDateRaw) || metaDateRaw;
  const chips = document.getElementById('importExplorersChips');
  const metaExplorers = chips ? Array.from(chips.querySelectorAll('.chip')).map(chip => chip.textContent.replace('×', '').trim()).filter(Boolean) : [];
  return { metaGov, metaArea, metaDate, metaExplorers };
}

function validateImportMeta() {
  return true;
}

function normalizeCaseGrade_(v) {
  const s = (v ?? '').toString().trim();
  if (!s) return '';
  const upper = s.toUpperCase();
  if (upper === 'A') return 'حالة مستديمة';
  if (upper === 'B') return 'حالة موسمية';
  if (upper === 'C') return 'حالة مرفوضة';
  if (s === 'قيد الانتظار' || s === 'Pending') return 'حالة قيد الانتظار';
  return s;
}

function initHeaderUi() {
  // Quick search: element removed from header

  // Dropdowns
  const toggleMenu = (btnId, menuId) => {
    const btn = document.getElementById(btnId);
    const menu = document.getElementById(menuId);
    if (!btn || !menu) return;
    const open = () => { menu.classList.remove('hidden'); menu.setAttribute('aria-hidden', 'false'); };
    const close = () => {
      try {
        const active = document.activeElement;
        if (active && menu.contains(active)) {
          try { (active).blur?.(); } catch { }
          try { btn.focus?.(); } catch { }
        }
      } catch { }
      menu.classList.add('hidden');
      menu.setAttribute('aria-hidden', 'true');
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.classList.contains('hidden')) open(); else close();
    });
    document.addEventListener('click', (e) => {
      if (menu.classList.contains('hidden')) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    // Close on selecting an item
    menu.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('button')) {
        close();
      }
    });
    return { open, close };
  };

  toggleMenu('actionsMenuBtn', 'actionsMenu');
  toggleMenu('userMenuBtn', 'userMenu');
}

function updateNavBadges() {
  const total = AppState.cases.length;
  const urgent = AppState.cases.filter(c => c.urgency === 'عاجل' || c.urgency === 'عاجل جدًا').length;
  const medical = AppState.cases.filter(c => (c.category || '').includes('عمليات طبية') || (c.category || '').includes('كفالات مرضية')).length;
  try {
    const t = document.getElementById('casesTotalBadge');
    if (t) t.textContent = String(total);
    const u = document.getElementById('casesUrgentBadge');
    if (u) { u.textContent = `عاجل ${urgent}`; u.classList.toggle('hidden', urgent <= 0); }
    const m = document.getElementById('casesMedicalBadge');
    if (m) { m.textContent = `طبي ${medical}`; m.classList.toggle('hidden', medical <= 0); }
  } catch { }
}

function triggerListImport() {
  openImportModal();
}

function openImportModal() {
  const m = document.getElementById('importCasesModal');
  if (!m) { return; }
  try { refreshImportExplorersOptions(); } catch { }
  try { refreshImportAreaList(); } catch { }
  try {
    const d = document.getElementById('importDate');
    if (d && !d.value) d.value = formatTodayDDMMYYYY();
  } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try {
    const preferred = document.getElementById('importExplorerNameInput') || document.getElementById('importDate');
    if (preferred && typeof preferred.focus === 'function') preferred.focus();
  } catch { }
}

function closeImportModal() {
  const m = document.getElementById('importCasesModal');
  if (!m) return;
  try {
    const ae = document.activeElement;
    if (ae && m.contains(ae) && typeof ae.blur === 'function') ae.blur();
  } catch { }
  m.classList.remove('show');
  m.setAttribute('aria-hidden', 'true');
  try {
    const fallback = document.getElementById('listImportBtn') || document.getElementById('navCasesBtn') || document.getElementById('quickAddBtn');
    if (fallback && typeof fallback.focus === 'function') fallback.focus();
  } catch { }
}

function triggerImportFilePick() {
  const inp = document.getElementById('listImportInput');
  if (inp) inp.click();
}

function onListImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  try { AppState.lastImportFileName = file.name || ''; } catch { }
  if (name.endsWith('.xlsx')) {
    if (!window.XLSX) { alert('مكتبة Excel غير متاحة حالياً. تأكد من اتصال الإنترنت.'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = new Uint8Array(reader.result);
        const wb = window.XLSX.read(data, { type: 'array' });
        const sheetName = wb.SheetNames?.[0];
        const ws = sheetName ? wb.Sheets?.[sheetName] : null;
        if (!ws) throw new Error('لم يتم العثور على Sheet داخل ملف Excel');

        // Prefer AOA import to avoid generating huge CSV strings (faster + less memory)
        const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
        resetCasesListFilters();
        importFromAOA_(aoa);
        try { showSection('casesList'); } catch { }
        try { closeImportModal(); } catch { }
      } catch (err) {
        try { console.error('Excel import failed (list import)', err); } catch { }
        const msg = (err && err.message) ? `\n\nالتفاصيل: ${err.message}` : '';
        alert(`تعذر قراءة ملف Excel${msg}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
    return;
  }
  alert('صيغة الملف غير مدعومة. يرجى اختيار ملف Excel (XLSX) فقط.');
  e.target.value = '';
}

function filterImportExplorersOptions() {
  const sel = document.getElementById('importExplorers');
  if (!sel) return;
  const q = ((document.getElementById('importExplorersSearch')?.value || '').toString().trim()).toLowerCase();
  const all = Array.isArray(window.__importExplorersAll) ? window.__importExplorersAll : [];
  const prevSelected = new Set(Array.from(sel.selectedOptions).map(o => (o.value || '').trim()).filter(Boolean));
  const filtered = q ? all.filter(n => n.toLowerCase().includes(q)) : all.slice();
  sel.innerHTML = filtered.map(n => {
    const safe = (n || '').replace(/"/g, '');
    const selectedAttr = prevSelected.has(n) ? ' selected' : '';
    return `<option value="${safe}"${selectedAttr}>${n}</option>`;
  }).join('');
}

function addImportExplorerName() {
  const inp = document.getElementById('importExplorerNameInput');
  if (!inp) return;
  const name = (inp.value || '').trim();
  if (!name) return;

  // Render chip locally inside the import modal only
  renderImportExplorerChip(name);
  inp.value = '';
}

function renderImportExplorerChip(name) {
  const chips = document.getElementById('importExplorersChips');
  if (!chips) return;
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = name;
  chip.style.cssText = 'background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:12px;font-size:13px;display:inline-flex;align-items:center;gap:4px';
  const remove = document.createElement('span');
  remove.textContent = '×';
  remove.style.cssText = 'cursor:pointer;margin-left:4px;font-weight:bold';
  remove.onclick = () => chip.remove();
  chip.appendChild(remove);
  chips.appendChild(chip);
}

function resetCasesListFilters() {
  try { if (window.caseSearch) caseSearch.value = ''; } catch { }
  try { if (window.filterExplorer) filterExplorer.value = ''; } catch { }
  try { if (window.filterGovernorate) filterGovernorate.value = ''; } catch { }
  try { if (window.filterArea) filterArea.value = ''; } catch { }
  try { if (window.filterCaseGrade) filterCaseGrade.value = ''; } catch { }
  try { if (window.filterNeeds) filterNeeds.value = ''; } catch { }
  try {
    AppState.dashboardFilter = null;
    const bar = document.getElementById('casesListActiveFilter');
    const lab = document.getElementById('casesListActiveFilterLabel');
    if (lab) lab.textContent = '';
    if (bar) bar.classList.add('hidden');
  } catch { }
  try {
    if (window.filterCategoriesGroup) {
      const boxes = filterCategoriesGroup.querySelectorAll('input[type="checkbox"]');
      boxes.forEach(b => { b.checked = false; });
    }
  } catch { }
}

function getCasesListFiltersState_() {
  const q = (window.caseSearch ? (caseSearch.value || '').toString().trim() : '');
  const explorer = (window.filterExplorer ? (filterExplorer.value || '').toString().trim() : '');
  const gov = (window.filterGovernorate ? (filterGovernorate.value || '').toString().trim() : '');
  const area = (window.filterArea ? (filterArea.value || '').toString().trim() : '');
  const grade = (window.filterCaseGrade ? (filterCaseGrade.value || '').toString().trim() : '');
  let cats = 0;
  try {
    if (window.filterCategoriesGroup) {
      cats = Array.from(filterCategoriesGroup.querySelectorAll('input[type="checkbox"]')).filter(b => b.checked).length;
    }
  } catch { cats = 0; }
  const needs = (window.filterNeeds ? (filterNeeds.value || '').toString().trim() : '');
  return { q, explorer, gov, area, grade, needs, cats };
}

function updateCasesListUiState_() {
  try {
    const s = getCasesListFiltersState_();
    const hasLocal = !!(s.q || s.explorer || s.gov || s.area || s.grade || s.needs || s.cats);
    const btn = document.getElementById('casesClearFiltersBtn');
    if (btn) btn.classList.toggle('hidden', !hasLocal);
  } catch { }
  try { renderCasesQuickSections_(); } catch { }
}

function clearCasesListFilters() {
  try { if (window.caseSearch) caseSearch.value = ''; } catch { }
  try { if (window.filterExplorer) filterExplorer.value = ''; } catch { }
  try { if (window.filterGovernorate) filterGovernorate.value = ''; } catch { }
  try { if (window.filterArea) filterArea.value = ''; } catch { }
  try { if (window.filterCaseGrade) filterCaseGrade.value = ''; } catch { }
  try { if (window.filterNeeds) filterNeeds.value = ''; } catch { }
  try {
    if (window.filterCategoriesGroup) {
      const boxes = filterCategoriesGroup.querySelectorAll('input[type="checkbox"]');
      boxes.forEach(b => { b.checked = false; });
    }
  } catch { }
  try {
    AppState.dashboardFilter = null;
    const bar = document.getElementById('casesListActiveFilter');
    const lab = document.getElementById('casesListActiveFilterLabel');
    if (lab) lab.textContent = '';
    if (bar) bar.classList.add('hidden');
  } catch { }
  try { resetCasesListPager_(); } catch { }
  try { filterCases(); } catch { try { renderCasesTable(); } catch { } }
  try { updateCasesListUiState_(); } catch { }
}

const CASES_GRADE_SECTIONS_ = [
  { key: '', label: 'كل الحالات', note: 'الكل' },
  { key: 'حالة قيد الانتظار', label: 'قيد الانتظار', note: 'تحتاج إجراء' },
  { key: 'حالة مرفوضة', label: 'المرفوضة', note: 'تحتاج مراجعة' },
  { key: 'حالة موسمية', label: 'الموسمية', note: 'موسمية' },
  { key: 'حالة مستديمة', label: 'المستديمة', note: 'دائمة' }
];

function isRejectedCase_(item) {
  const grade = normalizeCaseGrade_((item?.caseGrade || '').toString());
  const status = String(item?.status || '').trim();
  return grade === 'حالة مرفوضة' || status === 'مرفوضة';
}

function getFilteredCasesBase_(options = {}) {
  const skipGrade = !!options.skipGrade;
  const gov = window.filterGovernorate ? filterGovernorate.value : '';
  const areaTxt = window.filterArea ? filterArea.value.trim() : '';
  const grade = skipGrade ? '' : (window.filterCaseGrade ? filterCaseGrade.value : '');
  const q = window.caseSearch ? caseSearch.value.trim() : '';
  const explorerQ = window.filterExplorer ? filterExplorer.value.trim() : '';
  const needsQ = window.filterNeeds ? filterNeeds.value.trim() : '';
  const catsHost = window.filterCategoriesGroup ? filterCategoriesGroup : null;
  const selectedCats = catsHost ? Array.from(catsHost.querySelectorAll('input[type="checkbox"]')).filter(b => b.checked).map(b => b.value) : [];
  const dashKey = AppState.dashboardFilter?.key;
  return (AppState.cases || []).filter((x) => {
    const okGov = !gov || x.governorate === gov;
    const okArea = !areaTxt || (x.area || '').includes(areaTxt);
    const okGrade = !grade || (x.caseGrade || '') === grade;
    const okCats = !selectedCats.length || selectedCats.some((c) => (x.category || '').includes(c));
    const hay = [x.id, x.familyHead, x.phone, x.address, x.governorate, x.area, x.category, x.explorerName, x.date]
      .map((v) => (v || '').toString())
      .join(' ');
    const okQ = !q || hay.toLowerCase().includes(q.toLowerCase());
    const ex = (x.explorerName || '').toString();
    const okExplorer = !explorerQ || ex.toLowerCase().includes(explorerQ.toLowerCase());
    const needsHay = [x.needsShort, x.familyNeeds, x.description, x.researcherReport, x.category, x.tags]
      .map((v) => (Array.isArray(v) ? v.join(' ') : (v || '').toString()))
      .join(' ');
    const okNeeds = !needsQ || needsHay.toLowerCase().includes(needsQ.toLowerCase());
    const okDash = !dashKey || matchesDashboardFilter(x, dashKey);
    return okGov && okArea && okGrade && okCats && okQ && okExplorer && okNeeds && okDash;
  });
}

function getCasesSectionCount_(gradeKey) {
  const list = getFilteredCasesBase_({ skipGrade: true });
  if (!gradeKey) return list.length;
  return list.filter((item) => normalizeCaseGrade_((item?.caseGrade || '').toString()) === gradeKey).length;
}

function renderCasesQuickSections_() {
  const host = document.getElementById('casesQuickSections');
  if (!host) return;
  const activeGrade = (window.filterCaseGrade ? (filterCaseGrade.value || '').toString().trim() : '');
  host.innerHTML = CASES_GRADE_SECTIONS_.map((section) => {
    const active = activeGrade === section.key;
    const activeCls = active ? ' is-active' : '';
    const allCls = !section.key ? ' cases-quick-section--all' : '';
    return `
      <button type="button" class="cases-quick-section${activeCls}${allCls}" onclick="applyCasesGradeSection_('${escapeHtml(section.key)}')">
        <span class="cases-quick-section-label">${escapeHtml(section.label)}</span>
        <span class="cases-quick-section-note">${escapeHtml(section.note)}</span>
        <span class="cases-quick-section-count">${escapeHtml(String(getCasesSectionCount_(section.key)))}</span>
      </button>`;
  }).join('');
}

function applyCasesGradeSection_(gradeKey) {
  try {
    if (window.filterCaseGrade) filterCaseGrade.value = (gradeKey || '').toString();
  } catch { }
  try { resetCasesListPager_(); } catch { }
  filterCases();
}

function exportCasesToExcelFromList_(list, filePrefix = 'cases-view') {
  const source = Array.isArray(list) ? list : [];
  if (!source.length) { alert('لا توجد حالات للتصدير'); return; }

  const sumNum = (v) => Number(v ?? 0) || 0;
  const needOf = (c) => Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount));

  const headers = [
    'رقم الحالة', 'اسم الحالة', 'الرقم القومي', 'الهاتف', 'رقم واتساب', 'العنوان', 'المحافظة', 'المنطقة', 'الفئة', 'الحالة', 'الاستعجال', 'تقييم الحالة', 'المستكشف', 'تاريخ البحث', 'مبلغ تقديري', 'مبلغ منفذ', 'الاحتياج', 'عدد الكفالات المسجلة', 'إجمالي الكفالات المسجلة', 'تاريخ آخر كفالة', 'عدد المساعدات (غير الكفالة)', 'إجمالي المساعدات (غير الكفالة)'
  ];
  const rows = [headers];
  source.forEach(c => {
    const hist = Array.isArray(c.assistanceHistory) ? c.assistanceHistory : [];
    const spons = hist.filter(x => (x?.type || '') === 'sponsorship');
    const other = hist.filter(x => (x?.type || '') && (x?.type || '') !== 'sponsorship');
    const sponsCount = spons.length;
    const sponsTotal = spons.reduce((a, x) => a + (Number(x?.amount ?? 0) || 0), 0);
    const lastSponsDate = spons.length ? String(spons.map(x => x?.date || '').sort().slice(-1)[0] || '') : '';
    const otherCount = other.length;
    const otherTotal = other.reduce((a, x) => a + (Number(x?.amount ?? 0) || 0), 0);
    rows.push([
      String(c.caseNo ?? ''), String(c.familyHead ?? ''), String(c.id ?? ''), String(c.phone ?? ''), String(c.whatsapp ?? ''), String(c.address ?? ''), String(c.governorate ?? ''), String(c.area ?? ''), String(c.category ?? ''), String(c.status ?? ''), String(c.urgency ?? ''), String(c.caseGrade ?? ''), String(c.explorerName ?? ''), String(c.date ?? ''), String(c.estimatedAmount ?? ''), String(c.deliveredAmount ?? ''), String(needOf(c)), String(sponsCount), String(sponsTotal), String(lastSponsDate), String(otherCount), String(otherTotal)
    ]);
  });

  const fname = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    if (!window.XLSX) throw new Error('XLSX missing');
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws['!sheetViews'] = [{ rightToLeft: true }];
    window.XLSX.utils.book_append_sheet(wb, ws, 'Cases');
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Views = [{ RTL: true }];
    window.XLSX.writeFile(wb, fname);
    return;
  } catch { }

  try {
    let csv = headers.join(',') + "\n";
    rows.slice(1).forEach(r => {
      csv += r.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',') + "\n";
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname.replace(/\.xlsx$/i, '.csv');
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    alert('تعذر تصدير البيانات');
  }
}

function exportFilteredCasesToExcel() {
  exportCasesToExcelFromList_(getFilteredCases(), 'cases-view');
}

function exportSelectedCasesToExcel() {
  exportCasesToExcelFromList_(getSelectedCases_(), 'cases-selected');
}

function generateImportedCaseId() {
  const n = Number(AppState.caseIdCounter || 1000) + 1;
  AppState.caseIdCounter = n;
  return `IMP-${n}`;
}

function makeNewCaseId_() {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const n = Number(AppState.caseIdCounter || 1);
  AppState.caseIdCounter = n + 1;
  return `C-${ym}-${String(n).padStart(4, '0')}`;
}

function generateCaseId() {
  // In this app, caseId is the national id entered by the user.
  // This function is used as a safe "reset/new case" helper.
  try {
    const cid = document.getElementById('caseId');
    if (cid) cid.value = '';
  } catch { }
  try {
    const nid = document.getElementById('nationalId');
    if (nid) nid.value = '';
  } catch { }
  try {
    const cid = document.getElementById('caseId');
    if (cid) cid.focus();
  } catch { }
}

function downloadCasesImportTemplate() {
  const headers = [
    'م',
    'اسم الحالة',
    'الرقم القومي',
    'عدد الابناء',
    'وصف الحالة',
    'عمل الاب',
    'عمل الام',
    'المرضي',
    'الحالة الاجتماعية',
    'احتياجاتهم',
    'الدخل الشهري',
    'احتياج الاسرة',
    'رقم التليفون',
    'العنوان',
    'المحافظة',
    'القرية',
    'فئة الحالة',
    'الاستعجال',
    'اسم المستكشف',
    'التاريخ',
    'الحالة',
    'تقييم الحالة',
    'رقم واتساب',
    'وصف السكن',
    'عدد الغرف',
    'الحمام',
    'المياه',
    'السقف',
    'نوع المنطقة',
    'هل توجد ديون؟',
    'قيمة الدين',
    'صاحب الدين',
    'حكم قضائي؟',
    'سبب الدين',
    'الدخل: الرواتب',
    'الدخل: المعاشات',
    'الدخل: المشاريع',
    'الدخل: مساعدات الجمعيات',
    'الدخل: بنود إضافية (JSON)',
    'الدخل: ملاحظات',
    'الدخل: إجمالي',
    'المصروفات: إيجار السكن',
    'المصروفات: المرافق',
    'المصروفات: بنود إضافية (JSON)',
    'المصروفات: ملاحظات',
    'المصروفات: إجمالي',
    'صافي شهري',
    'هل يوجد حالة زواج؟',
    'اسم العروسة',
    'اسم العريس',
    'مهنة العريس',
    'تاريخ كتب الكتاب',
    'تاريخ الزواج',
    'الاحتياجات المتوفرة (زواج)',
    'الاحتياجات المطلوبة (زواج)',
    'هل يوجد مشروع؟',
    'نوع المشروع',
    'الخبرة والاستعداد',
    'الاحتياجات المطلوبة للمشروع',
    'مبلغ تقديري',
    'مبلغ منفذ',
    'مصدر التمويل',
    'وسوم',
    'أفراد الأسرة (JSON)',
    'احتياجات الأسرة',
    'تقرير الباحث',
    'الحالات الطبية'
  ];

  const exampleMedicalCases = JSON.stringify([
    {
      name: 'مثال: عملية عين',
      diseaseType: 'مثال: مياه بيضاء',
      hospital: 'مستشفى عام',
      doctor: 'د/ أحمد',
      report: 'ملخص تقرير',
      estimatedCost: '5000'
    }
  ]);

  const exampleRow = [
    '1',
    'محمد علي',
    '29901010101010',
    '2',
    'وصف مختصر',
    'عمل الأب',
    'عمل الأم',
    'لا يوجد',
    'متزوج/متزوجة',
    'احتياجات مختصرة',
    '2000',
    'احتياج الأسرة',
    '01000000000',
    'عنوان مختصر',
    'القاهرة',
    'مدينة نصر',
    'عمليات طبية',
    'عاجل',
    'مستكشف 1',
    new Date().toISOString().slice(0, 10),
    'جديدة',
    'A',
    '01000000000',
    'وصف السكن هنا',
    '2',
    'مستقل',
    'يوجد',
    'يوجد',
    'حضر',
    'لا',
    '',
    '',
    '',
    '',
    '2000',
    '0',
    '0',
    '0',
    '[]',
    '',
    '2000',
    '500',
    '300',
    '[]',
    '',
    '800',
    '1200',
    'لا',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'لا',
    '',
    '',
    '',
    '10000',
    '',
    '',
    'وسم1|وسم2',
    '[{"name":"الأب","relation":"الأب","age":40,"working":"نعم","workStability":"عمل ثابت","notes":""}]',
    'احتياجات الأسرة',
    'تقرير الباحث',
    exampleMedicalCases
  ];

  try {
    if (window.XLSX) {
      const wb = window.XLSX.utils.book_new();
      const ws = window.XLSX.utils.aoa_to_sheet([headers, exampleRow]);

      const range = window.XLSX.utils.decode_range(ws['!ref']);
      const lastCol = range.e.c;
      const lastRow = range.e.r;
      const ref = window.XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, lastRow), c: lastCol } });

      // AutoFilter on header row
      ws['!autofilter'] = { ref };

      // Column widths (approx.)
      ws['!cols'] = headers.map(h => {
        const len = String(h || '').length;
        const wch = Math.min(48, Math.max(14, len + 2));
        return { wch };
      });

      // Freeze top row + RTL (Excel will respect in most cases)
      ws['!sheetViews'] = [{ rightToLeft: true, state: 'frozen', ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' }];

      // Simple header styling (may be ignored depending on XLSX build)
      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
      };
      for (let c = 0; c <= lastCol; c++) {
        const addr = window.XLSX.utils.encode_cell({ r: 0, c });
        if (ws[addr]) ws[addr].s = headerStyle;
      }

      // Add helper lists sheet
      const listsRows = [
        ['نعم/لا', 'نعم', 'لا'],
        ['الحالة', 'جديدة', 'محولة', 'منفذة'],
        ['الاستعجال', 'عادي', 'عاجل', 'عاجل جدًا'],
        ['تقييم الحالة', 'حالة مستديمة', 'حالة موسمية', 'حالة مرفوضة', 'حالة قيد الانتظار'],
        ['الحالة الاجتماعية', 'أعزب/عزباء', 'متزوج/متزوجة', 'مطلق/مطلقة', 'أرمل/أرملة'],
        ['الحمام', 'مشترك', 'مستقل', 'لا يوجد'],
        ['المياه/السقف', 'يوجد', 'لا يوجد'],
        ['نوع المنطقة', 'عشوائي', 'بدو', 'ريف', 'حضر']
      ];
      const wsLists = window.XLSX.utils.aoa_to_sheet(listsRows);
      wsLists['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
      wsLists['!sheetViews'] = [{ rightToLeft: true }];

      window.XLSX.utils.book_append_sheet(wb, ws, 'Cases');
      window.XLSX.utils.book_append_sheet(wb, wsLists, 'Lists');

      // Workbook RTL view
      wb.Workbook = wb.Workbook || {};
      wb.Workbook.Views = [{ RTL: true }];

      window.XLSX.writeFile(wb, 'cases-import-template.xlsx');
      return;
    }
  } catch { }

  alert('مكتبة Excel غير متاحة حالياً. تأكد من اتصال الإنترنت ثم أعد المحاولة.');
}

function downloadSampleCasesExcel() {
  if (!window.XLSX) { alert('مكتبة Excel غير متاحة حالياً. تأكد من اتصال الإنترنت.'); return; }

  const headers = [
    'رقم الحالة',
    'اسم رب الأسرة',
    'رقم الهاتف',
    'العنوان',
    'المحافظة',
    'المنطقة',
    'عدد أفراد الأسرة',
    'فئة الحالة',
    'الاستعجال',
    'الوصف',
    'اسم المستكشف',
    'التاريخ',
    'الحالة',
    'تقييم الحالة',
    'الحالة الاجتماعية',
    'رقم واتساب',
    'وصف السكن',
    'عدد الغرف',
    'الحمام',
    'المياه',
    'السقف',
    'نوع المنطقة',
    'هل توجد ديون؟',
    'قيمة الدين',
    'صاحب الدين',
    'حكم قضائي؟',
    'سبب الدين',
    'الدخل: الرواتب',
    'الدخل: المعاشات',
    'الدخل: المشاريع',
    'الدخل: مساعدات الجمعيات',
    'الدخل: بنود إضافية (JSON)',
    'الدخل: ملاحظات',
    'الدخل: إجمالي',
    'المصروفات: إيجار السكن',
    'المصروفات: المرافق',
    'المصروفات: بنود إضافية (JSON)',
    'المصروفات: ملاحظات',
    'المصروفات: إجمالي',
    'صافي شهري',
    'هل يوجد حالة زواج؟',
    'اسم العروسة',
    'اسم العريس',
    'مهنة العريس',
    'تاريخ كتب الكتاب',
    'تاريخ الزواج',
    'الاحتياجات المتوفرة (زواج)',
    'الاحتياجات المطلوبة (زواج)',
    'هل يوجد مشروع؟',
    'نوع المشروع',
    'الخبرة والاستعداد',
    'الاحتياجات المطلوبة للمشروع',
    'مبلغ تقديري',
    'مبلغ منفذ',
    'مصدر التمويل',
    'وسوم',
    'أفراد الأسرة (JSON)',
    'احتياجات الأسرة',
    'تقرير الباحث',
    'الحالات الطبية'
  ];

  const pick = (arr, i) => arr[Math.abs(i) % arr.length];
  const pad2 = (n) => String(n).padStart(2, '0');
  const today = new Date();
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const addDays = (base, days) => { const d = new Date(base.getTime()); d.setDate(d.getDate() + days); return d; };
  const yn = (b) => b ? 'نعم' : 'لا';

  const govs = Array.isArray(GOVS) && GOVS.length ? GOVS : ['القاهرة', 'الجيزة'];
  const areas = ['مدينة نصر', 'الهرم', 'شبرا', 'العجوزة', 'حلوان', 'الزيتون', 'بولاق', 'منشية القناطر', '6 أكتوبر', 'العصافرة', 'المعمورة', 'العامرية'];
  const explorers = ['مستكشف 1', 'مستكشف 2', 'مستكشف 3', 'مستكشف 4', 'مستكشف 5'];
  const statusList = ['جديدة', 'محولة', 'منفذة'];
  const urgencyList = ['عادي', 'عاجل', 'عاجل جدًا'];
  const grades = ['حالة مستديمة', 'حالة موسمية', 'حالة مرفوضة', 'حالة قيد الانتظار'];
  const bathroomTypes = ['مشترك', 'مستقل', 'لا يوجد'];
  const ynExists = ['يوجد', 'لا يوجد'];
  const areaTypes = ['حضر', 'ريف', 'عشوائي', 'بدو'];
  const maritalList = ['أعزب/عزباء', 'متزوج/متزوجة', 'مطلق/مطلقة', 'أرمل/أرملة', 'يتيم'];
  const educations = ['لا يوجد', 'أبتدائية', 'اعدادية', 'ثانوية', 'تعليم متوسط', 'جامعي', 'محو أمية', 'متسرب من التعليم'];
  const debtOwners = ['بقالة', 'صاحب البيت', 'شركة كهرباء', 'جمعية', 'مستشفى', 'أقارب'];
  const courtOrders = ['لا يوجد', 'شيك', 'وصل امانه'];
  const fundingSources = ['تبرعات أفراد', 'جمعية', 'متبرع', 'صندوق زكاة', 'تمويل ذاتي'];
  const jobs = ['عامل', 'سائق', 'نجار', 'سباك', 'موظف', 'لا يعمل'];
  const projectTypes = ['مشروع خياطة', 'تربية دواجن', 'بقالة صغيرة', 'عربة طعام', 'ورشة بسيطة'];
  const projectNeeds = ['ماكينة', 'خامات', 'معدات', 'رأس مال', 'تجهيز مكان'];
  const marriageNeeds = ['أجهزة كهربائية', 'أثاث', 'دهانات', 'مفروشات', 'مستلزمات مطبخ'];
  const marriageAvailable = ['بعض الأثاث', 'غرفة نوم', 'ثلاجة', 'بوتاجاز', 'لا يوجد'];
  const tagsPool = ['ديون', 'يتيم', 'متسرب', 'سكن', 'طبي', 'عاجل', 'مشروع', 'زواج', 'مياه', 'أسقف', 'كفالة شهرية'];

  const makeExtras = (i, kind) => {
    const list = [];
    if ((i + (kind === 'inc' ? 0 : 1)) % 3 === 0) list.push({ name: kind === 'inc' ? 'مساعدة أهل' : 'أدوية', value: kind === 'inc' ? 300 : 200 });
    if ((i + (kind === 'inc' ? 1 : 2)) % 4 === 0) list.push({ name: kind === 'inc' ? 'دخل إضافي' : 'تعليم', value: kind === 'inc' ? 250 : 150 });
    return list;
  };

  const makeFamilyMembers = (i, famCount, wantDropout, wantOrphanMember) => {
    const out = [];
    const base = famCount || 4;
    for (let k = 0; k < Math.max(2, Math.min(8, base)); k++) {
      const age = 6 + ((i * 3 + k * 7) % 55);
      let edu = pick(educations, i + k);
      if (wantDropout && k === 0) edu = 'متسرب من التعليم';
      let ms = pick(maritalList, i + k);
      if (wantOrphanMember && k === 1) ms = 'يتيم';
      out.push({
        name: `فرد ${k + 1}`,
        relation: k === 0 ? 'الأب' : k === 1 ? 'الأم' : (k % 2 === 0 ? 'الابن' : 'الابنة'),
        age,
        education: edu,
        maritalStatus: ms,
        working: age >= 18 ? (k % 3 === 0 ? 'نعم' : (k % 3 === 1 ? 'لا' : 'مريض')) : 'طالب/طالبة'
      });
    }
    return out;
  };

  const makeMedicalCases = (i, categories) => {
    const cats = (categories || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!cats.includes('عمليات طبية') && !cats.includes('كفالات مرضية')) return '[]';
    const rows = [];
    if (cats.includes('عمليات طبية')) {
      rows.push({
        name: 'عملية',
        diseaseType: pick(['عيون', 'قلب', 'عظام', 'أورام', 'باطنة'], i),
        treatmentSources: 'تقرير مستشفى',
        specialty: pick(['رمد', 'جراحة', 'عظام', 'قلب'], i + 2),
        hospital: pick(['مستشفى عام', 'مستشفى جامعي', 'مستشفى خاص'], i + 1),
        doctor: `د/ ${pick(['أحمد', 'محمد', 'محمود', 'يوسف', 'سعيد'], i)}`,
        report: 'تمت مراجعة الحالة وتحتاج تدخل',
        required: 'تنفيذ العملية',
        estimatedCost: String(4000 + (i % 10) * 700)
      });
    }
    if (cats.includes('كفالات مرضية')) {
      rows.push({
        name: 'كفالة علاج',
        diseaseType: pick(['سكر', 'ضغط', 'فشل كلوي', 'التهاب كبد', 'ربو'], i + 3),
        treatmentSources: 'روشتة شهرية',
        specialty: 'باطنة',
        hospital: pick(['مستشفى عام', 'وحدة صحية'], i + 4),
        doctor: `د/ ${pick(['علي', 'خالد', 'هشام', 'إبراهيم'], i + 1)}`,
        report: 'يتطلب علاج شهري منتظم',
        required: 'دواء شهري',
        estimatedCost: String(500 + (i % 6) * 120)
      });
    }
    return JSON.stringify(rows);
  };

  const makeCategories = (i) => {
    const base = pick(CATEGORIES, i);
    const extra = (i % 5 === 0) ? pick(CATEGORIES, i + 3) : '';
    const extra2 = (i % 11 === 0) ? pick(CATEGORIES, i + 5) : '';
    const set = [base, extra, extra2].map(s => (s || '').trim()).filter(Boolean);
    return Array.from(new Set(set)).join(', ');
  };

  const rows = [];
  rows.push(headers);

  for (let i = 1; i <= 100; i++) {
    const id = `T-${String(i).padStart(4, '0')}`;
    const gov = pick(govs, i);
    const area = pick(areas, i * 2);
    const explorer = pick(explorers, i);
    const date = fmtDate(addDays(today, -i));
    const status = pick(statusList, i);
    const urgency = pick(urgencyList, i);
    const grade = pick(grades, i);
    const maritalStatus = (i % 17 === 0) ? 'يتيم' : pick(maritalList, i);

    const categories = makeCategories(i);

    const needBathroom = (i % 9 === 0);
    const needWater = (i % 8 === 0);
    const needRoof = (i % 10 === 0);
    const bathroomType = needBathroom ? 'لا يوجد' : pick(bathroomTypes, i);
    const waterExists = needWater ? 'لا يوجد' : 'يوجد';
    const roofExists = needRoof ? 'لا يوجد' : 'يوجد';
    const rooms = String(((i % 4) + 1));
    const areaType = pick(areaTypes, i);
    const housingDesc = `سكن ${areaType} - ${rooms} غرف`;

    const hasDebts = (i % 6 === 0);
    const debtAmount = hasDebts ? String(1500 + (i % 10) * 350) : '';
    const debtOwner = hasDebts ? pick(debtOwners, i) : '';
    const courtOrder = hasDebts ? pick(courtOrders, i) : '';
    const debtReason = hasDebts ? pick(['مصروفات علاج', 'إيجار متأخر', 'فواتير', 'تجهيزات', 'مصاريف دراسة'], i) : '';

    const salary = (i % 7 === 0) ? 0 : (1200 + (i % 8) * 250);
    const pension = (i % 5 === 0) ? (600 + (i % 4) * 200) : 0;
    const projectsIncome = (i % 12 === 0) ? (800 + (i % 5) * 300) : 0;
    const ngoIncome = (i % 6 === 0) ? (300 + (i % 5) * 150) : 0;
    const incExtrasArr = makeExtras(i, 'inc');
    const incExtras = JSON.stringify(incExtrasArr);
    const incomeTotal = salary + pension + projectsIncome + ngoIncome + incExtrasArr.reduce((a, b) => a + (Number(b.value) || 0), 0);

    const rent = (i % 4 === 0) ? (700 + (i % 6) * 120) : 0;
    const utilities = 250 + (i % 5) * 60;
    const expExtrasArr = makeExtras(i, 'exp');
    const expExtras = JSON.stringify(expExtrasArr);
    const expensesTotal = rent + utilities + expExtrasArr.reduce((a, b) => a + (Number(b.value) || 0), 0);
    const netMonthly = incomeTotal - expensesTotal;

    const marriageEnabled = (i % 13 === 0);
    const brideName = marriageEnabled ? `عروسة ${i}` : '';
    const groomName = marriageEnabled ? `عريس ${i}` : '';
    const groomJob = marriageEnabled ? pick(jobs, i) : '';
    const contractDate = marriageEnabled ? fmtDate(addDays(today, -i - 60)) : '';
    const weddingDate = marriageEnabled ? fmtDate(addDays(today, -i - 20)) : '';
    const marAvail = marriageEnabled ? pick(marriageAvailable, i) : '';
    const marNeed = marriageEnabled ? pick(marriageNeeds, i) : '';

    const projectEnabled = (i % 14 === 0);
    const projectType = projectEnabled ? pick(projectTypes, i) : '';
    const projectExp = projectEnabled ? pick(['خبرة متوسطة', 'خبرة جيدة', 'لا توجد خبرة'], i) : '';
    const projectNeed = projectEnabled ? pick(projectNeeds, i) : '';

    const estAmount = 5000 + (i % 12) * 900;
    const delAmount = status === 'منفذة' ? Math.max(0, estAmount - (i % 4) * 400) : '';
    const fundingSource = pick(fundingSources, i);

    const tags = [];
    if (hasDebts) tags.push('ديون');
    if (maritalStatus === 'يتيم') tags.push('يتيم');
    if (needBathroom || needRoof || needWater) tags.push('سكن');
    if (urgency !== 'عادي') tags.push('عاجل');
    if (categories.includes('عمليات طبية') || categories.includes('كفالات مرضية')) tags.push('طبي');
    if (categories.includes('كفالة شهرية')) tags.push('كفالة شهرية');
    if (marriageEnabled) tags.push('زواج');
    if (projectEnabled) tags.push('مشروع');
    const extraTags = (i % 3 === 0) ? [pick(tagsPool, i + 1)] : [];
    const tagsStr = Array.from(new Set([...tags, ...extraTags])).join('|');

    const famCount = 3 + (i % 6);
    const wantDropout = (i % 9 === 0);
    const wantOrphanMember = (i % 19 === 0);
    const familyMembers = JSON.stringify(makeFamilyMembers(i, famCount, wantDropout, wantOrphanMember));

    const familyNeeds = `احتياجات: ${needWater ? 'مياه ' : ''}${needRoof ? 'سقف ' : ''}${needBathroom ? 'حمام ' : ''}`.trim() || 'احتياجات متنوعة';
    const researcherReport = `تمت زيارة الحالة وتقييمها (${grade})`;
    const medicalCasesJson = makeMedicalCases(i, categories);

    const row = [
      id,
      `رب الأسرة ${i}`,
      `010${String(10000000 + i).slice(-8)}`,
      `عنوان تجريبي رقم ${i} - ${area}`,
      gov,
      area,
      String(famCount),
      categories,
      urgency,
      `وصف الحالة رقم ${i} (بيانات تجريبية كاملة)` ,
      explorer,
      date,
      status,
      grade,
      maritalStatus,
      `010${String(20000000 + i).slice(-8)}`,
      housingDesc,
      rooms,
      bathroomType,
      waterExists,
      roofExists,
      areaType,
      yn(hasDebts),
      debtAmount,
      debtOwner,
      courtOrder,
      debtReason,
      String(salary),
      String(pension),
      String(projectsIncome),
      String(ngoIncome),
      incExtras,
      'ملاحظات دخل',
      String(incomeTotal),
      String(rent),
      String(utilities),
      expExtras,
      'ملاحظات مصروفات',
      String(expensesTotal),
      String(netMonthly),
      yn(marriageEnabled),
      brideName,
      groomName,
      groomJob,
      contractDate,
      weddingDate,
      marAvail,
      marNeed,
      yn(projectEnabled),
      projectType,
      projectExp,
      projectNeed,
      String(estAmount),
      (delAmount === '' ? '' : String(delAmount)),
      fundingSource,
      tagsStr,
      familyMembers,
      familyNeeds,
      researcherReport,
      medicalCasesJson
    ];

    while (row.length < headers.length) row.push('');
    rows.push(row);
  }

  try {
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(rows);

    const range = window.XLSX.utils.decode_range(ws['!ref']);
    const lastCol = range.e.c;
    const lastRow = range.e.r;
    const ref = window.XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, lastRow), c: lastCol } });
    ws['!autofilter'] = { ref };
    ws['!cols'] = headers.map(h => {
      const len = String(h || '').length;
      const wch = Math.min(52, Math.max(14, len + 2));
      return { wch };
    });
    ws['!sheetViews'] = [{ rightToLeft: true }];

    window.XLSX.utils.book_append_sheet(wb, ws, 'Cases');
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Views = [{ RTL: true }];
    window.XLSX.writeFile(wb, 'sample-cases-100.xlsx');
  } catch {
    alert('تعذر إنشاء ملف البيانات التجريبية');
  }
}

// Import CSV/Excel (CSV supported directly; XLSX please export to CSV first)
function triggerImport() { const inp = document.getElementById('importInput'); if (inp) inp.click(); }
function onImportFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx')) {
    if (!window.XLSX) { alert('مكتبة Excel غير متاحة حالياً. تأكد من اتصال الإنترنت.'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = new Uint8Array(reader.result);
        const wb = window.XLSX.read(data, { type: 'array' });
        const sheetName = wb.SheetNames?.[0];
        const ws = sheetName ? wb.Sheets?.[sheetName] : null;
        if (!ws) throw new Error('لم يتم العثور على Sheet داخل ملف Excel');

        const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
        importFromAOA_(aoa);
      } catch (err) {
        try { console.error('Excel import failed', err); } catch { }
        const msg = (err && err.message) ? `\n\nالتفاصيل: ${err.message}` : '';
        alert(`تعذر قراءة ملف Excel${msg}`);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert('صيغة الملف غير مدعومة. يرجى اختيار Excel (XLSX) فقط.');
  }
  e.target.value = '';
}

function triggerJSONImport() {
  const inp = document.getElementById('jsonImportInput');
  if (inp) inp.click();
}

function onJSONImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  if (!name.endsWith('.json')) { alert('يرجى اختيار ملف JSON'); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importFromJSONBackup(reader.result);
    } catch {
      alert('تعذر قراءة ملف النسخة الاحتياطية');
    }
  };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
}

function exportToJSONBackup() {
  const payload = {
    meta: { version: 1, exportedAt: new Date().toISOString() },
    cases: AppState.cases
  };
  const txt = JSON.stringify(payload, null, 2);
  const blob = new Blob([txt], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cases-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importFromJSONBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { alert('ملف JSON غير صالح'); return; }
  const raw = Array.isArray(data) ? data : (Array.isArray(data.cases) ? data.cases : null);
  if (!raw) { alert('الملف لا يحتوي على بيانات حالات'); return; }
  const ok = confirm('سيتم استبدال كل الحالات الحالية بالنسخة الاحتياطية. هل تريد المتابعة؟');
  if (!ok) return;
  const ok2 = confirm('تحذير: هذه العملية قد تستبدل كل البيانات المخزنة في قاعدة البيانات. هل تريد المتابعة؟');
  if (!ok2) return;
  let ok3 = false;
  try { ok3 = (prompt('اكتب كلمة CONFIRM للتأكيد النهائي:') || '').toString().trim().toUpperCase() === 'CONFIRM'; } catch { ok3 = false; }
  if (!ok3) { alert('تم إلغاء العملية'); return; }
  const sanitized = raw.map(x => {
    const obj = { ...(x || {}) };
    obj.id = (obj.id || '').toString();
    obj.familyHead = (obj.familyHead || '').toString();
    obj.phone = (obj.phone || '').toString();
    obj.address = (obj.address || '').toString();
    obj.governorate = (obj.governorate || '').toString();
    obj.area = (obj.area || '').toString();
    obj.familyCount = Number(obj.familyCount || 0) || 0;
    obj.category = (obj.category || '').toString();
    obj.urgency = (obj.urgency || '').toString();
    obj.description = (obj.description || '').toString();
    obj.explorerName = (obj.explorerName || '').toString();
    obj.date = (obj.date || '').toString();
    obj.status = (obj.status || 'جديدة').toString();
    obj.medicalCases = Array.isArray(obj.medicalCases) ? obj.medicalCases : [];
    obj.tags = Array.isArray(obj.tags) ? obj.tags : [];
    if (!Array.isArray(obj.sponsorships)) obj.sponsorships = [];
    if (!Array.isArray(obj.assistanceHistory)) obj.assistanceHistory = [];
    return obj;
  });
  AppState.cases = sanitized;
  ensureAssistanceArrays();
  // Persist to Supabase (replace all remote cases)
  try {
    if (DatabaseClient) {
      (async () => {
        try { await deleteAllCasesFromDb(); } catch { }
        for (const c of sanitized) {
          try { await upsertCaseToDb(c); } catch { }
        }
      })();
    }
  } catch { }
  try { renderCasesTable(); } catch { }
  try { updateDashboardStats(); } catch { }
  try { generateReportPreview(); } catch { }
  try { updateNavBadges(); } catch { }
  logAction('استعادة JSON', '', `عدد الحالات: ${sanitized.length}`);
  alert(`تمت الاستعادة بنجاح: ${sanitized.length} حالة`);
}

function importFromCSV(text) {
  const rows = text.split(/\r?\n/).filter(r => r.trim().length > 0);
  if (rows.length < 2) { alert('ملف فارغ'); return; }
  const headers = rows[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const dataRows = rows.slice(1);
  importFromParsedRows_(headers, dataRows, (row) => parseCSVLine(row));
}

function importFromAOA_(aoa) {
  if (!Array.isArray(aoa) || aoa.length < 2) { alert('ملف فارغ'); return; }
  const headers = (aoa[0] || []).map(h => (h ?? '').toString().trim());
  const dataRows = aoa.slice(1);
  importFromParsedRows_(headers, dataRows, (row) => (Array.isArray(row) ? row.map(v => (v ?? '').toString()) : []));
}

function importFromParsedRows_(headers, dataRows, parseRow) {
  const getVal = (cols, i) => {
    try {
      if (i == null || i < 0) return '';
      const v = (cols && cols.length > i) ? cols[i] : '';
      return (v ?? '').toString().trim();
    } catch {
      return '';
    }
  };

  const idx = (name) => headers.findIndex(h => h === name);
  const idxAny = (names) => {
    for (const n of (names || [])) {
      const i = idx(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  // Support Arabic header names used by export
  const map = {
    caseNo: idxAny(['رقم الحالة', 'caseNo', 'case_no']),
    id: idxAny(['الرقم القومي', 'رقم قومي', 'National ID', 'nationalId']),
    familyHead: idxAny(['اسم رب الأسرة', 'اسم الحالة']),
    phone: idxAny(['الهاتف', 'رقم الهاتف', 'رقم التليفون']),
    address: idx('العنوان'),
    governorate: idx('المحافظة'),
    area: idxAny(['المنطقة', 'القرية']),
    familyCount: idxAny(['عدد الأفراد', 'عدد أفراد الأسرة', 'عدد الابناء']),
    category: idx('الفئة') >= 0 ? idx('الفئة') : idx('فئة الحالة'),
    urgency: idx('الاستعجال'),
    description: idxAny(['الوصف', 'وصف الحالة']),
    explorerName: idx('المستكشف') >= 0 ? idx('المستكشف') : idx('اسم المستكشف'),
    date: idx('التاريخ'),
    status: idx('الحالة'),
    hospital: idx('المستشفى'),
    doctor: idx('الطبيب') >= 0 ? idx('الطبيب') : idx('اسم الطبيب'),
    medicalReport: idx('التقرير الطبي'),
    estimatedCost: idx('التكلفة الطبية التقديرية') >= 0 ? idx('التكلفة الطبية التقديرية') : idx('التكلفة التقديرية'),
    estimatedAmount: idx('مبلغ تقديري'),
    deliveredAmount: idx('مبلغ منفذ'),
    fundingSource: idx('مصدر التمويل'),
    tags: idx('وسوم'),
    medicalCases: idx('الحالات الطبية'),
    caseGrade: idx('تقييم الحالة'),
    maritalStatus: idx('الحالة الاجتماعية'),
    whatsapp: idx('رقم واتساب'),
    housingDesc: idx('وصف السكن'),
    roomsCount: idx('عدد الغرف'),
    bathroomType: idx('الحمام'),
    waterExists: idx('المياه'),
    roofExists: idx('السقف'),
    areaType: idx('نوع المنطقة'),
    debtsEnabled: idx('هل توجد ديون؟'),
    debtAmount: idx('قيمة الدين'),
    debtOwner: idx('صاحب الدين'),
    hasCourtOrder: idx('حكم قضائي؟'),
    debtReason: idx('سبب الدين'),
    incomeSalary: idx('الدخل: الرواتب'),
    incomePension: idx('الدخل: المعاشات'),
    incomeProjects: idx('الدخل: المشاريع'),
    incomeNgo: idx('الدخل: مساعدات الجمعيات'),
    incomeExtras: idx('الدخل: بنود إضافية (JSON)'),
    incomeNotes: idx('الدخل: ملاحظات'),
    incomeTotal: idx('الدخل: إجمالي'),
    expenseRent: idx('المصروفات: إيجار السكن'),
    expenseUtilities: idx('المصروفات: المرافق'),
    expenseExtras: idx('المصروفات: بنود إضافية (JSON)'),
    expensesNotes: idx('المصروفات: ملاحظات'),
    expensesTotal: idx('المصروفات: إجمالي'),
    netMonthly: idx('صافي شهري'),
    marriageEnabled: idx('هل يوجد حالة زواج؟'),
    brideName: idx('اسم العروسة'),
    groomName: idx('اسم العريس'),
    groomJob: idx('مهنة العريس'),
    contractDate: idx('تاريخ كتب الكتاب'),
    weddingDate: idx('تاريخ الزواج'),
    marriageAvailable: idx('الاحتياجات المتوفرة (زواج)'),
    marriageNeeded: idx('الاحتياجات المطلوبة (زواج)'),
    projectsEnabled: idx('هل يوجد مشروع؟'),
    projectType: idx('نوع المشروع'),
    projectExperience: idx('الخبرة والاستعداد'),
    projectNeeds: idx('الاحتياجات المطلوبة للمشروع'),
    familyMembers: idx('أفراد الأسرة (JSON)'),
    familyNeeds: idxAny(['احتياجات الأسرة', 'احتياج الاسرة', 'احتياجاتهم']),
    researcherReport: idx('تقرير الباحث'),
    fatherJob: idx('عمل الاب'),
    motherJob: idx('عمل الام'),
    illnesses: idx('المرضي'),
    monthlyIncome: idx('الدخل الشهري'),
    needsShort: idx('احتياجاتهم')
  };
  const importFileName = (AppState.lastImportFileName || '').toString();
  const imported = [];
  let caseNo = 1;
  for (const row of dataRows) {
    const cols = parseRow(row);
    if (!cols || cols.length === 0) continue;
    const yn = (v) => {
      const s = (v || '').toString().trim();
      return (s === 'نعم' || s.toLowerCase() === 'yes' || s === 'true' || s === '1');
    };
    const numOr = (v, fallback) => {
      const s = (v || '').toString().trim();
      if (!s) return fallback;
      const n = Number(s);
      return isNaN(n) ? fallback : n;
    };
    const parseJsonOr = (raw, fallback) => {
      try {
        const s = (raw || '').toString().trim();
        if (!s) return fallback;
        return JSON.parse(s);
      } catch {
        return fallback;
      }
    };
    const obj = {
      id: getVal(cols, map.id),
      caseNo: Number(getVal(cols, map.caseNo) || 0) || null,
      familyHead: getVal(cols, map.familyHead),
      phone: getVal(cols, map.phone),
      address: getVal(cols, map.address),
      governorate: getVal(cols, map.governorate),
      area: getVal(cols, map.area),
      familyCount: Number(getVal(cols, map.familyCount) || 0) || 0,
      category: getVal(cols, map.category),
      urgency: getVal(cols, map.urgency),
      description: getVal(cols, map.description),
      explorerName: getVal(cols, map.explorerName),
      date: getVal(cols, map.date),
      status: getVal(cols, map.status) || 'جديدة',
      caseGrade: normalizeCaseGrade_(getVal(cols, map.caseGrade)),
      maritalStatus: getVal(cols, map.maritalStatus),
      whatsapp: getVal(cols, map.whatsapp),
      housing: {
        housingDesc: getVal(cols, map.housingDesc),
        roomsCount: numOr(getVal(cols, map.roomsCount), 0) || 0,
        bathroomType: getVal(cols, map.bathroomType),
        waterExists: getVal(cols, map.waterExists),
        roofExists: getVal(cols, map.roofExists),
        areaType: getVal(cols, map.areaType)
      },
      debts: {
        enabled: yn(getVal(cols, map.debtsEnabled)),
        amount: numOr(getVal(cols, map.debtAmount), 0) || 0,
        owner: getVal(cols, map.debtOwner),
        hasCourtOrder: getVal(cols, map.hasCourtOrder),
        reason: getVal(cols, map.debtReason)
      },
      income: {
        salary: numOr(getVal(cols, map.incomeSalary), 0) || 0,
        pension: numOr(getVal(cols, map.incomePension), 0) || 0,
        projects: numOr(getVal(cols, map.incomeProjects), 0) || 0,
        ngo: numOr(getVal(cols, map.incomeNgo), 0) || 0,
        extras: parseJsonOr(getVal(cols, map.incomeExtras), []),
        notes: getVal(cols, map.incomeNotes),
        total: numOr(getVal(cols, map.incomeTotal), 0) || 0
      },
      expenses: {
        rent: numOr(getVal(cols, map.expenseRent), 0) || 0,
        utilities: numOr(getVal(cols, map.expenseUtilities), 0) || 0,
        extras: parseJsonOr(getVal(cols, map.expenseExtras), []),
        notes: getVal(cols, map.expensesNotes),
        total: numOr(getVal(cols, map.expensesTotal), 0) || 0
      },
      netMonthly: numOr(getVal(cols, map.netMonthly), 0) || 0,
      marriage: {
        enabled: yn(getVal(cols, map.marriageEnabled)),
        brideName: getVal(cols, map.brideName),
        groomName: getVal(cols, map.groomName),
        groomJob: getVal(cols, map.groomJob),
        contractDate: getVal(cols, map.contractDate),
        weddingDate: getVal(cols, map.weddingDate),
        available: getVal(cols, map.marriageAvailable),
        needed: getVal(cols, map.marriageNeeded)
      },
      project: {
        enabled: yn(getVal(cols, map.projectsEnabled)),
        type: getVal(cols, map.projectType),
        experience: getVal(cols, map.projectExperience),
        needs: getVal(cols, map.projectNeeds)
      },
      medicalInfo: {
        hospital: getVal(cols, map.hospital),
        doctor: getVal(cols, map.doctor),
        medicalReport: getVal(cols, map.medicalReport),
        estimatedCost: getVal(cols, map.estimatedCost)
      },
      estimatedAmount: (getVal(cols, map.estimatedAmount) ? Number(getVal(cols, map.estimatedAmount)) : ''),
      deliveredAmount: (getVal(cols, map.deliveredAmount) ? Number(getVal(cols, map.deliveredAmount)) : ''),
      fundingSource: getVal(cols, map.fundingSource),
      tags: (getVal(cols, map.tags) || '').split(/\||,/).map(s => s.trim()).filter(Boolean),
      familyMembers: parseJsonOr(getVal(cols, map.familyMembers), []),
      familyNeeds: getVal(cols, map.familyNeeds),
      researcherReport: getVal(cols, map.researcherReport),
      assistanceHistory: []
    };

    try {
      const fj = (getVal(cols, map.fatherJob) || '').toString().trim();
      const mj = (getVal(cols, map.motherJob) || '').toString().trim();
      if (fj || mj) {
        obj.jobs = obj.jobs && typeof obj.jobs === 'object' ? obj.jobs : {};
        if (fj) obj.jobs.father = fj;
        if (mj) obj.jobs.mother = mj;
      }
    } catch { }

    try {
      const ill = (getVal(cols, map.illnesses) || '').toString().trim();
      if (ill) obj.illnesses = ill;
    } catch { }

    try {
      const ns = (getVal(cols, map.needsShort) || '').toString().trim();
      if (ns) obj.needsShort = ns;
    } catch { }

    try {
      const mi = (getVal(cols, map.monthlyIncome) || '').toString().trim();
      if (mi && (!obj.income || !obj.income.total)) {
        const n = Number(mi);
        if (!isNaN(n)) obj.income.total = n;
      }
    } catch { }

    // medical legacy single fields
    const med = {
      hospital: getVal(cols, map.hospital),
      doctor: getVal(cols, map.doctor),
      medicalReport: getVal(cols, map.medicalReport),
      estimatedCost: getVal(cols, map.estimatedCost)
    };

    // Parse medical cases JSON if provided
    try {
      if (map.medicalCases != null && map.medicalCases >= 0) {
        const raw = getVal(cols, map.medicalCases);
        if (raw) { obj.medicalCases = JSON.parse(raw); }
      }
    } catch { }
    // Generate ID if missing
    if (!obj.id) { obj.id = generateImportedCaseId(); }

    try { normalizeMissingCoreFields_(obj); } catch { }

    // Assign sequential case number if missing
    if (!obj.caseNo) obj.caseNo = getNextCaseNo_();

    // Attach import source (optional)
    try {
      if (importFileName) obj.importInfo = { sourceFileName: importFileName };
    } catch { }
    imported.push(obj);
  }
  if (!imported.length) { alert('لم يتم العثور على بيانات صالحة'); return; }
  // Merge locally
  imported.forEach(c => {
    if (!Array.isArray(c.sponsorships)) c.sponsorships = [];
    if (!Array.isArray(c.assistanceHistory)) c.assistanceHistory = [];
  });
  const byId = new Map(AppState.cases.map(c => [c.id, c]));
  imported.forEach(c => { byId.set(c.id, c); });
  AppState.cases = Array.from(byId.values());
  // Persist to Supabase
  try {
    if (DatabaseClient) {
      (async () => {
        for (const c of imported) {
          try { await upsertCaseToDb(c); } catch { }
        }
      })();
    }
  } catch { }
  renderCasesTable(); updateDashboardStats(); generateReportPreview();
  try { updateNavBadges(); } catch { }
  logAction('استيراد CSV', '', `عدد السجلات: ${imported.length}`);
  alert(`تم استيراد ${imported.length} سجلًا بنجاح`);
}

function getLastSponsorship(it) {
  const legacy = Array.isArray(it?.sponsorships) ? it.sponsorships : [];
  const unified = Array.isArray(it?.assistanceHistory) ? it.assistanceHistory : [];
  const fromUnified = unified
    .filter(x => (x?.type || '').toString() === 'sponsorship')
    .map(x => ({
      startDate: x.date || x.startDate || '',
      amount: x.amount,
      createdAt: x.createdAt || '',
      byName: x.byName || '',
      byUser: x.byUser || ''
    }));
  const merged = fromUnified.length ? fromUnified : legacy;
  if (!merged.length) return null;
  const sorted = merged.slice().sort((a, b) => String(b.startDate || b.createdAt || '').localeCompare(String(a.startDate || a.createdAt || '')));
  return sorted[0] || null;
}

function getSponsorshipHistory(it) {
  const legacy = Array.isArray(it?.sponsorships) ? it.sponsorships : [];
  const unified = Array.isArray(it?.assistanceHistory) ? it.assistanceHistory : [];
  const fromUnified = unified
    .filter(x => (x?.type || '').toString() === 'sponsorship')
    .map(x => ({
      startDate: x.date || x.startDate || '',
      amount: x.amount,
      createdAt: x.createdAt || '',
      byName: x.byName || '',
      byUser: x.byUser || ''
    }));
  return fromUnified.length ? fromUnified : legacy;
}

function formatSponsorshipLabel(last) {
  if (!last) return '';
  const amt = (last.amount ?? '') !== '' ? `${last.amount}` : '';
  const start = last.startDate || '';
  const end = last.endDate || '';
  if (amt && start && end) return `${amt} (${start} → ${end})`;
  if (amt && start) return `${amt} (${start})`;
  if (amt) return `${amt}`;
  return start || '';
}

function openMedicalCommittee() {
  // Treat medical committee as part of reports
  try {
    showSection('medicalCommittee', 'medicalCommitteeBtn');
  } catch {
    try {
      const s = document.getElementById('medicalCommitteeSection');
      if (s) s.classList.remove('hidden');
    } catch { }
  }
  try { refreshDerivedViewsIfNeeded_('medicalCommitteeSection'); } catch { }
}

function setMedicalFilter(key) {
  try { AppState.medicalCommitteeFilter = key || 'all'; } catch { }
  try {
    const t = document.getElementById('medFilterType');
    const st = document.getElementById('medFilterStatus');
    const gr = document.getElementById('medFilterGrade');
    const gv = document.getElementById('medFilterGov');
    if (key === 'all') {
      if (t) t.value = '';
      if (st) st.value = '';
      if (gr) gr.value = '';
      if (gv) gv.value = '';
    } else if (key && key.startsWith('type:')) {
      if (t) t.value = key.slice(5).trim();
    } else if (key && key.startsWith('status:')) {
      if (st) st.value = key.slice(7).trim();
    } else if (key && key.startsWith('grade:')) {
      if (gr) gr.value = key.slice(6).trim();
    }
  } catch { }
  try { updateMedicalCommitteeStats(); } catch { }
  try { renderMedicalTable(); } catch { }
}

function getMedicalCases_() {
  const cases = Array.isArray(AppState.cases) ? AppState.cases : [];
  return cases.filter(c => {
    const cat = (c.category || '').toString();
    return cat.includes('عمليات طبية') || cat.includes('كفالات مرضية');
  });
}

function getMedicalType_(c) {
  const cat = (c.category || '').toString();
  if (cat.includes('عمليات طبية')) return 'ops';
  if (cat.includes('كفالات مرضية')) return 'sponsorship';
  return '';
}

function medicalMatchesPreset_(c, key) {
  if (!key || key === 'all') return true;
  if (key === 'need_funding') {
    const est = Number(c.estimatedAmount ?? 0) || 0;
    const del = Number(c.deliveredAmount ?? 0) || 0;
    return (est - del) > 0;
  }
  if (key.startsWith('type:')) return getMedicalType_(c) === key.slice(5).trim();
  if (key.startsWith('status:')) return String(c.status || '').trim() === key.slice(7).trim();
  if (key.startsWith('grade:')) return String(c.caseGrade || '').trim().toUpperCase() === key.slice(6).trim().toUpperCase();
  return true;
}

function updateMedicalCommitteeStats() {
  const fmt = (n) => {
    try { return (Number(n ?? 0) || 0).toLocaleString('ar-EG'); } catch { return String(n ?? 0); }
  };
  const sumNum = (v) => Number(v ?? 0) || 0;
  const list = getMedicalCases_();
  const preset = (AppState.medicalCommitteeFilter || 'all').toString();
  const filtered = list.filter(c => medicalMatchesPreset_(c, preset));

  const ops = list.filter(c => getMedicalType_(c) === 'ops').length;
  const spons = list.filter(c => getMedicalType_(c) === 'sponsorship').length;
  const gradeA = list.filter(c => String(c.caseGrade || '').trim().toUpperCase() === 'A').length;
  const inReview = list.filter(c => String(c.status || '').trim() === 'قيد البحث').length;
  const need = list.reduce((acc, c) => acc + Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount)), 0);

  try { const el = document.getElementById('medKpiTotal'); if (el) el.textContent = fmt(filtered.length); } catch { }
  try { const el = document.getElementById('medKpiOps'); if (el) el.textContent = fmt(ops); } catch { }
  try { const el = document.getElementById('medKpiSponsorship'); if (el) el.textContent = fmt(spons); } catch { }
  try { const el = document.getElementById('medKpiGradeA'); if (el) el.textContent = fmt(gradeA); } catch { }
  try { const el = document.getElementById('medKpiInReview'); if (el) el.textContent = fmt(inReview); } catch { }
  try { const el = document.getElementById('medKpiNeed'); if (el) el.textContent = fmt(need); } catch { }

  // Populate filter options (status + governorates) once
  try {
    const st = document.getElementById('medFilterStatus');
    if (st && st.options && st.options.length <= 1) {
      const opts = Array.from(new Set(list.map(c => String(c.status || '').trim()).filter(Boolean)));
      st.innerHTML = ['<option value="">الحالة الإدارية: الكل</option>'].concat(opts.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)).join('');
    }
  } catch { }
  try {
    const gv = document.getElementById('medFilterGov');
    if (gv && gv.options && gv.options.length <= 1) {
      const opts = Array.from(new Set(list.map(c => String(c.governorate || '').trim()).filter(Boolean)));
      opts.sort((a, b) => a.localeCompare(b));
      gv.innerHTML = ['<option value="">المحافظة: الكل</option>'].concat(opts.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)).join('');
    }
  } catch { }
}

function renderMedicalTable() {
  const tb = document.getElementById('medTableBody');
  if (!tb) return;
  const fmtMoney = (n) => {
    const x = Number(n ?? 0) || 0;
    try { return x.toLocaleString('ar-EG'); } catch { return String(x); }
  };
  const sumNum = (v) => Number(v ?? 0) || 0;
  const preset = (AppState.medicalCommitteeFilter || 'all').toString();

  const q = (document.getElementById('medTableSearch')?.value || '').toString().trim().toLowerCase();
  const fType = (document.getElementById('medFilterType')?.value || '').toString().trim();
  const fStatus = (document.getElementById('medFilterStatus')?.value || '').toString().trim();
  const fGrade = (document.getElementById('medFilterGrade')?.value || '').toString().trim().toUpperCase();
  const fGov = (document.getElementById('medFilterGov')?.value || '').toString().trim();
  const sort = (document.getElementById('medTableSort')?.value || 'need_desc').toString();

  const list = getMedicalCases_()
    .filter(c => medicalMatchesPreset_(c, preset))
    .filter(c => {
      if (fType && getMedicalType_(c) !== fType) return false;
      if (fStatus && String(c.status || '').trim() !== fStatus) return false;
      if (fGrade && String(c.caseGrade || '').trim().toUpperCase() !== fGrade) return false;
      if (fGov && String(c.governorate || '').trim() !== fGov) return false;

      if (!q) return true;
      const medInfo = c.medicalInfo || {};
      const med0 = Array.isArray(c.medicalCases) && c.medicalCases.length ? (c.medicalCases[0] || {}) : {};
      const hosp = String(medInfo.hospital || med0.hospital || '').trim();
      const doc = String(medInfo.doctor || med0.doctor || '').trim();
      const hay = [
        c.familyHead,
        c.id,
        c.governorate,
        c.area,
        c.category,
        c.status,
        c.caseGrade,
        hosp,
        doc
      ].map(x => String(x || '').toLowerCase()).join(' | ');
      return hay.includes(q);
    });

  const getNeed = (c) => Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount));
  const getDateVal = (c) => {
    const raw = (c?.date || c?.importInfo?.importDate || '').toString();
    if (!raw) return 0;
    const d = new Date(raw);
    const t = d.getTime();
    return Number.isFinite(t) ? t : 0;
  };

  list.sort((a, b) => {
    if (sort === 'need_asc') return getNeed(a) - getNeed(b);
    if (sort === 'date_asc') return getDateVal(a) - getDateVal(b);
    if (sort === 'date_desc') return getDateVal(b) - getDateVal(a);
    return getNeed(b) - getNeed(a);
  });

  const top = list.slice(0, 200);
  tb.innerHTML = top.map(c => {
    const typ = getMedicalType_(c) === 'ops' ? 'عمليات طبية' : 'كفالات مرضية';
    const grade = String(c.caseGrade || '').trim() || '—';
    const gov = String(c.governorate || '').trim() || '—';
    const st = String(c.status || '').trim() || '—';
    const medInfo = c.medicalInfo || {};
    const med0 = Array.isArray(c.medicalCases) && c.medicalCases.length ? (c.medicalCases[0] || {}) : {};
    const hosp = String(medInfo.hospital || med0.hospital || '').trim();
    const doc = String(medInfo.doctor || med0.doctor || '').trim();
    const hospDoc = [hosp, doc].filter(Boolean).join(' / ') || '—';
    const need = getNeed(c);
    return `
      <tr>
        <td>${escapeHtml(String(c.familyHead || ''))}<div class="dash-muted" style="margin-top:2px">${escapeHtml(String(c.id || ''))}</div></td>
        <td>${escapeHtml(typ)}</td>
        <td>${escapeHtml(grade)}</td>
        <td>${escapeHtml(gov)}</td>
        <td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(hospDoc)}">${escapeHtml(hospDoc)}</td>
        <td>${escapeHtml(fmtMoney(need))}</td>
        <td>${escapeHtml(st)}</td>
        <td><button class="btn mini" type="button" onclick="openCaseDetails('${escapeHtml(c.id)}')">عرض</button></td>
      </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center">لا توجد نتائج</td></tr>';

  try {
    const meta = document.getElementById('medTableMeta');
    if (meta) meta.textContent = `يعرض ${Math.min(200, list.length)} من ${list.length}`;
  } catch { }
}

function getFilteredCases() {
  return getFilteredCasesBase_();
}

function renderCasesTable() {
  const list = getFilteredCasesCached_();
  const grid = document.getElementById('casesCardsGrid');
  if (!grid) return;
  const limit = Math.max(CASES_LIST_INITIAL_LIMIT, Number(AppState._casesListLimit || 0) || CASES_LIST_INITIAL_LIMIT);
  const visible = list.slice(0, Math.max(0, limit));
  const cards = visible.map(x => {
    if (!Array.isArray(x.sponsorships)) x.sponsorships = [];
    if (!Array.isArray(x.assistanceHistory)) x.assistanceHistory = [];
    const lastSponsor = getLastSponsorship(x);
    const sponsorLabel = formatSponsorshipLabel(lastSponsor);
    const title = (x.familyHead || '').toString().trim() || x.id;
    const urgencyText = (x.urgency || '').toString().trim();
    const urgencyClass = urgencyText === 'عاجل جدًا' ? 'b-new' : urgencyText === 'عاجل' ? 'b-proc' : 'b-done';
    const statusClass = x.status === 'جديدة' ? 'b-new' : x.status === 'محولة' ? 'b-proc' : 'b-done';
    const shortDesc = (x.description || '').toString().trim();
    const clipped = shortDesc.length > 140 ? `${shortDesc.slice(0, 140)}...` : shortDesc;
    return `
      <div class="case-card" data-case-row="${x.id}">
        <div class="case-card-head">
          <label class="case-card-select" onclick="event.stopPropagation();">
            <input class="case-select" type="checkbox" data-case-id="${x.id}" onclick="event.stopPropagation();" onchange="onCaseSelectionChange()" />
          </label>
          <div class="case-card-title">
            <div class="case-card-name">${escapeHtml(title)}</div>
            <div class="case-card-meta">${escapeHtml((x.governorate || '').toString())}${x.area ? ' - ' + escapeHtml((x.area || '').toString()) : ''}</div>
          </div>
          <div class="case-card-badges">
            ${urgencyText ? `<span class="badge ${urgencyClass}">${escapeHtml(urgencyText)}</span>` : ''}
            <span class="badge ${statusClass}">${escapeHtml((x.status || '').toString())}</span>
          </div>
        </div>

        <div class="case-card-body">
          <div class="case-card-line"><strong>الفئة:</strong> ${escapeHtml((x.category || '').toString())}</div>
          <div class="case-card-line"><strong>آخر كفالة:</strong> ${escapeHtml((sponsorLabel || '').toString())}</div>
          <div class="case-card-line"><strong>تاريخ البحث:</strong> ${escapeHtml((x.date || '').toString())}</div>
          <div class="case-card-line"><strong>المستكشف:</strong> ${escapeHtml((x.explorerName || '').toString())}</div>
          ${clipped ? `<div class="case-card-desc">${escapeHtml(clipped)}</div>` : ''}
        </div>

        <div class="case-card-actions" onclick="event.stopPropagation();">
          <button type="button" class="btn" onclick="openSingleSponsorshipModal('${x.id}')">دفع الكفالة الشهرية</button>
          <button type="button" class="btn light" style="color:#1f2937;border-color:#e5e7eb" onclick="openCaseDetails('${x.id}')">عرض التفاصيل</button>
        </div>
      </div>`;
  }).join('');

  grid.innerHTML = cards || '';
  if (window.noCasesMessage) {
    noCasesMessage.classList.toggle('hidden', list.length > 0);
  }
  // افتح تفاصيل الحالة عند الضغط على البطاقة (مع تجاهل الأزرار والحقول)
  Array.from(grid.querySelectorAll('[data-case-row]')).forEach(card => {
    const key = card.getAttribute('data-case-row');
    if (!key) return;
    card.addEventListener('click', e => {
      if (e.target && e.target.tagName) {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'select' || tag === 'button' || tag === 'input' || tag === 'label' || tag === 'a') return;
      }
      openCaseDetails(key);
    });
  });
  try { onCaseSelectionChange(); } catch { }
  try { updateCasesListUiState_(); } catch { }
  try { renderCasesQuickSections_(); } catch { }

  try {
    const meta = document.getElementById('casesListMeta');
    if (meta) meta.textContent = `يعرض ${Math.min(visible.length, list.length)} من ${list.length} حالة محمّلة`;
  } catch { }
  try {
    const btn = document.getElementById('casesLoadMoreBtn');
    if (btn) {
      btn.style.display = (visible.length < list.length) ? 'inline-flex' : 'none';
      btn.textContent = (visible.length < list.length) ? `تحميل ${Math.min(CASES_LIST_LOAD_STEP, list.length - visible.length)} حالة إضافية` : 'تم عرض كل الحالات';
    }
  } catch { }
}

function setFilterOptions() {
  // Governorates for filters and import
  try {
    if (window.filterGovernorate) {
      filterGovernorate.innerHTML = ['<option value="">كل المحافظات</option>'].concat(GOVS.map(g => `<option>${g}</option>`)).join('');
    }
  } catch { }
  try {
    const ig = document.getElementById('importGovernorate');
    if (ig) {
      ig.innerHTML = ['<option value="">اختر المحافظة</option>'].concat(GOVS.map(g => `<option>${g}</option>`)).join('');
    }
  } catch { }

  // Case grade
  try {
    if (window.filterCaseGrade) {
      filterCaseGrade.innerHTML = [
        '<option value="">كل التقييمات</option>',
        '<option>حالة قيد الانتظار</option>',
        '<option>حالة مرفوضة</option>',
        '<option>حالة مستديمة</option>',
        '<option>حالة موسمية</option>'
      ].join('');
    }
  } catch { }

  // Categories checkbox group (cases list)
  try {
    if (window.filterCategoriesGroup) {
      filterCategoriesGroup.innerHTML = `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" value="" data-all="1"> الكل</label>`
        + CATEGORIES.map(c => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" value="${c}"> ${c}</label>`).join('');
      const allBox = filterCategoriesGroup.querySelector('input[data-all="1"]');
      if (allBox) {
        allBox.addEventListener('change', () => {
          const boxes = filterCategoriesGroup.querySelectorAll('input[type="checkbox"]');
          boxes.forEach(b => { if (!b.dataset.all) b.checked = allBox.checked; });
          renderCasesTable();
        });
      }
    }
  } catch { }

  // Import meta defaults & options (cases list)
  try {
    const d = document.getElementById('importDate');
    if (d && !d.value) d.value = formatTodayDDMMYYYY();
  } catch { }
  try {
    const govSel = document.getElementById('importGovernorate');
    if (govSel) {
      govSel.onchange = () => {
        try { refreshImportAreaList(); } catch { }
      };
    }
  } catch { }
  try { renderCasesQuickSections_(); } catch { }
}

function toggleSelectAllCases(checked) {
  const host = document.getElementById('casesCardsGrid') || document.getElementById('casesTableBody');
  if (!host) return;
  Array.from(host.querySelectorAll('input.case-select')).forEach(b => { b.checked = !!checked; });
  onCaseSelectionChange();
  try { updateCasesListUiState_(); } catch { }
}

function openSingleSponsorshipModal(caseId) {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const it = AppState.cases.find(c => c.id === caseId);
  if (!it) { alert('الحالة غير موجودة'); return; }
  const m = document.getElementById('bulkSponsorshipModal');
  if (!m) return;
  m.setAttribute('data-single-case-id', (caseId || '').toString());
  try { m.setAttribute('data-target-ids', JSON.stringify([(caseId || '').toString()])); } catch { }
  try {
    setSponsorScopeUiMode_('locked_selected');
  } catch { }
  try {
    const start = document.getElementById('sponsorStart');
    const amt = document.getElementById('sponsorAmount');
    const typeSel = document.getElementById('sponsorType');
    if (start) start.value = new Date().toISOString().slice(0, 10);
    if (amt) amt.value = '';
    if (typeSel) typeSel.value = 'sponsorship';
    try { onSponsorTypeChange_(); } catch { }
  } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try { document.getElementById('sponsorStart')?.focus?.(); } catch { }
}


function openBulkSponsorshipModal() {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const ids = getSelectedCaseIds();
  if (!ids.length) { alert('اختر حالة واحدة على الأقل'); return; }
  const m = document.getElementById('bulkSponsorshipModal');
  if (!m) return;
  try { m.removeAttribute('data-single-case-id'); } catch { }
  try { m.setAttribute('data-target-ids', JSON.stringify(ids)); } catch { }
  try {
    setSponsorScopeUiMode_('locked_selected');
  } catch { }
  try {
    const start = document.getElementById('sponsorStart');
    const amt = document.getElementById('sponsorAmount');
    const typeSel = document.getElementById('sponsorType');
    if (start) start.value = new Date().toISOString().slice(0, 10);
    if (amt) amt.value = '';
    if (typeSel) typeSel.value = 'sponsorship';
    try { onSponsorTypeChange_(); } catch { }
  } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try { document.getElementById('sponsorStart')?.focus?.(); } catch { }
}

function closeBulkSponsorshipModal() {
  const m = document.getElementById('bulkSponsorshipModal');
  if (!m) return;
  try {
    const ae = document.activeElement;
    if (ae && m.contains(ae) && typeof ae.blur === 'function') ae.blur();
  } catch { }
  try {
    const start = document.getElementById('sponsorStart');
    const amt = document.getElementById('sponsorAmount');
    const typeSel = document.getElementById('sponsorType');
    if (start) start.value = '';
    if (amt) amt.value = '';
    if (typeSel) typeSel.value = 'sponsorship';
    try { onSponsorTypeChange_(); } catch { }
  } catch { }
  try { m.removeAttribute('data-single-case-id'); } catch { }
  try { m.removeAttribute('data-target-ids'); } catch { }
  try { setSponsorScopeUiMode_('normal'); } catch { }
  m.classList.remove('show');
  m.setAttribute('aria-hidden', 'true');
}

function setCaseDetailsTab(tabKey) {
  const k = (tabKey || 'details').toString();
  AppState.caseDetailsTab = k;
  const body = document.getElementById('caseDetailsBody');
  const details = document.getElementById('casePanelDetails');
  const payments = document.getElementById('casePanelPayments');
  const logPanel = document.getElementById('casePanelChangeLog');
  if (details) details.classList.toggle('hidden', k !== 'details');
  if (payments) payments.classList.toggle('hidden', k !== 'payments');
  if (logPanel) logPanel.classList.toggle('hidden', k !== 'changelog');
  if (k === 'changelog') {
    try { void renderCaseChangeLog_(); } catch { }
  }
  try {
    const activePanel = k === 'payments' ? payments : (k === 'changelog' ? logPanel : details);
    if (body) body.scrollTop = 0;
    if (activePanel && typeof activePanel.scrollTo === 'function') {
      activePanel.scrollTo({ top: 0, left: 0 });
    } else if (activePanel) {
      activePanel.scrollTop = 0;
    }
  } catch { }
  try { syncCaseDetailsButtons(); } catch { }
}

function syncCaseDetailsButtons() {
  const k = (AppState.caseDetailsTab || 'details').toString();
  const detailsBtn = document.getElementById('caseTabDetails');
  const payBtn = document.getElementById('caseTabPayments');
  const logBtn = document.getElementById('caseTabChangeLog');
  if (detailsBtn) {
    detailsBtn.classList.toggle('is-active', k === 'details');
    detailsBtn.setAttribute('aria-pressed', k === 'details' ? 'true' : 'false');
    detailsBtn.classList.toggle('light', k !== 'details');
    if (k === 'details') {
      try { detailsBtn.removeAttribute('style'); } catch { }
    } else {
      try { detailsBtn.style.color = '#1f2937'; detailsBtn.style.borderColor = '#e5e7eb'; } catch { }
    }
  }
  if (payBtn) {
    payBtn.classList.toggle('is-active', k === 'payments');
    payBtn.setAttribute('aria-pressed', k === 'payments' ? 'true' : 'false');
    payBtn.classList.toggle('light', k !== 'payments');
    if (k === 'payments') {
      try { payBtn.removeAttribute('style'); } catch { }
    } else {
      try { payBtn.style.color = '#1f2937'; payBtn.style.borderColor = '#e5e7eb'; } catch { }
    }
  }
  if (logBtn) {
    logBtn.classList.toggle('is-active', k === 'changelog');
    logBtn.setAttribute('aria-pressed', k === 'changelog' ? 'true' : 'false');
    logBtn.classList.toggle('light', k !== 'changelog');
    if (k === 'changelog') {
      try { logBtn.removeAttribute('style'); } catch { }
    } else {
      try { logBtn.style.color = '#1f2937'; logBtn.style.borderColor = '#e5e7eb'; } catch { }
    }
  }

  try {
    const canEdit = hasPerm('cases_edit');
    const canDelete = hasPerm('cases_delete');
    const mode = (AppState.caseDetailsMode || 'view').toString();
    const toggleBtn = document.getElementById('caseEditToggleBtn');
    const delBtn = document.getElementById('deleteCaseBtn');
    const rejectBtn = document.getElementById('rejectCaseBtn');
    const printBtn = document.getElementById('printCaseBtn');
    const shotBtn = document.getElementById('paymentsScreenshotBtn');
    const detailsShotBtn = document.getElementById('caseDetailsScreenshotBtn');
    const inPayments = k === 'payments';
    const current = (AppState.cases || []).find((item) => String(item?.id || '').trim() === String(AppState.currentCaseId || '').trim());
    const isRejected = isRejectedCase_(current);
    if (toggleBtn) {
      toggleBtn.classList.toggle('hidden', !(canEdit && !inPayments && !isRejected));
      if (mode === 'edit') {
        toggleBtn.textContent = '💾 حفظ التعديلات';
        toggleBtn.classList.add('primary-save');
      } else {
        toggleBtn.textContent = '✏️ تعديل';
        toggleBtn.classList.remove('primary-save');
      }
    }
    if (rejectBtn) rejectBtn.classList.toggle('hidden', !(canEdit && !inPayments && !isRejected));
    if (delBtn) delBtn.classList.toggle('hidden', !(canDelete && !inPayments && isRejected));
    if (printBtn) {
      try { printBtn.textContent = inPayments ? '🖨️ طباعة' : '🖨️ طباعة'; } catch { }
    }
    if (shotBtn) shotBtn.classList.toggle('hidden', !inPayments);
    if (detailsShotBtn) detailsShotBtn.classList.toggle('hidden', inPayments);
  } catch { }
}

function computePaymentUid_(x, idx) {
  if (x && typeof x === 'object') {
    const u = (x.uid || '').toString().trim();
    if (u) return u;
  }
  const base = (x?.createdAt || x?.date || '').toString().trim() || String(Date.now());
  return `${base}__${Math.random().toString(16).slice(2)}`;
}

function ensurePaymentUids_(it) {
  try {
    if (!it || typeof it !== 'object') return false;
    if (!Array.isArray(it.assistanceHistory)) it.assistanceHistory = [];
    let changed = false;
    it.assistanceHistory.forEach((x) => {
      if (!x || typeof x !== 'object') return;
      const has = (x.uid || '').toString().trim();
      if (has) return;
      x.uid = computePaymentUid_(x);
      changed = true;
    });
    return changed;
  } catch {
    return false;
  }
}

function getPaymentsFilter_() {
  const f = AppState.paymentsFilter && typeof AppState.paymentsFilter === 'object' ? AppState.paymentsFilter : {};
  return {
    type: (f.type || '').toString(),
    from: (f.from || '').toString(),
    to: (f.to || '').toString()
  };
}

function setPaymentsFilter_(patch) {
  try {
    const cur = getPaymentsFilter_();
    AppState.paymentsFilter = { ...cur, ...(patch || {}) };
  } catch { }
}

function refreshPaymentsPanel_() {
  try {
    const id = (AppState.currentCaseId || '').toString();
    const it = (AppState.cases || []).find(c => c.id === id);
    const panel = document.getElementById('casePanelPayments');
    if (it && panel) panel.innerHTML = renderPaymentsTabHtml_(it);
    setCaseDetailsTab('payments');
  } catch { }
}

function onPaymentsFilterChange() {
  try {
    const type = (document.getElementById('paymentsFilterType')?.value || '').toString();
    const from = (document.getElementById('paymentsFilterFrom')?.value || '').toString();
    const to = (document.getElementById('paymentsFilterTo')?.value || '').toString();
    setPaymentsFilter_({ type, from, to });
  } catch { }
  refreshPaymentsPanel_();
}

function toggleCaseEditSave() {
  try {
    const mode = (AppState.caseDetailsMode || 'view').toString();
    if (mode === 'edit') {
      saveCaseEdits();
      return;
    }
    enterCaseEditMode();
  } catch (e) {
    alert(`تعذر تنفيذ العملية.\n\nالخطأ: ${e?.message || 'غير معروف'}`);
  }
}

function setSponsorScopeUiMode_(mode) {
  const scopeSel = document.getElementById('sponsorScope');
  const scopeWrap = document.getElementById('sponsorScopeWrap');
  if (!scopeSel) return;

  if (mode === 'locked_selected') {
    scopeSel.value = 'selected';
    scopeSel.disabled = true;
    if (scopeWrap) scopeWrap.classList.add('hidden');
    onSponsorScopeChange();
    return;
  }

  // normal
  scopeSel.disabled = false;
  if (scopeWrap) scopeWrap.classList.remove('hidden');
  if (!scopeSel.value) scopeSel.value = 'selected';
  onSponsorScopeChange();
}

function openSponsorshipModalAdvanced() {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const m = document.getElementById('bulkSponsorshipModal');
  if (!m) return;
  try { m.removeAttribute('data-single-case-id'); } catch { }

  try {
    setSponsorScopeUiMode_('normal');
    // Default scope: prefer "selected" if there is any selection.
    const selectedIds = getSelectedCaseIds();
    let hasFilters = false;
    try {
      const s = getCasesListFiltersState_();
      hasFilters = !!(s.q || s.explorer || s.gov || s.area || s.grade || s.cats);
    } catch { hasFilters = false; }
    const scopeSel = document.getElementById('sponsorScope');
    if (scopeSel) scopeSel.value = selectedIds.length ? 'selected' : (hasFilters ? 'filtered' : 'all');
    onSponsorScopeChange();
  } catch { }

  try {
    const start = document.getElementById('sponsorStart');
    const amt = document.getElementById('sponsorAmount');
    const typeSel = document.getElementById('sponsorType');
    if (start) start.value = new Date().toISOString().slice(0, 10);
    if (amt) amt.value = '';
    if (typeSel) typeSel.value = 'sponsorship';
    try { onSponsorTypeChange_(); } catch { }
  } catch { }

  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try { document.getElementById('sponsorStart')?.focus?.(); } catch { }
}

function populateSponsorScopeOptions_() {
  // Governorates
  try {
    const govSel = document.getElementById('sponsorScopeGov');
    if (govSel && (!govSel.options || govSel.options.length <= 1)) {
      govSel.innerHTML = ['<option value="">اختر المحافظة</option>'].concat(GOVS.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`)).join('');
    }
  } catch { }

  // Categories
  try {
    const catSel = document.getElementById('sponsorScopeCategory');
    if (catSel && (!catSel.options || catSel.options.length <= 1)) {
      catSel.innerHTML = ['<option value="">اختر الفئة</option>'].concat(CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)).join('');
    }
  } catch { }
}

function onSponsorScopeChange() {
  const scope = (document.getElementById('sponsorScope')?.value || 'selected').toString();
  const wrapGov = document.getElementById('sponsorScopeGovWrap');
  const wrapArea = document.getElementById('sponsorScopeAreaWrap');
  const wrapCat = document.getElementById('sponsorScopeCategoryWrap');
  const hint = document.getElementById('sponsorScopeHint');

  if (wrapGov) wrapGov.classList.toggle('hidden', scope !== 'gov');
  if (wrapArea) wrapArea.classList.toggle('hidden', scope !== 'area');
  if (wrapCat) wrapCat.classList.toggle('hidden', scope !== 'category');

  try { populateSponsorScopeOptions_(); } catch { }

  if (hint) {
    const msg =
      scope === 'selected' ? 'سيتم تطبيق الكفالة على الحالات المحددة فقط.' :
        scope === 'filtered' ? 'سيتم تطبيق الكفالة على الحالات المعروضة حالياً حسب الفلاتر.' :
          scope === 'all' ? 'سيتم تطبيق الكفالة على كل الحالات.' :
            scope === 'gov' ? 'اختر محافظة لتطبيق الكفالة على كل حالات هذه المحافظة.' :
              scope === 'area' ? 'اكتب جزء من اسم المنطقة لتطبيق الكفالة على الحالات المطابقة.' :
                scope === 'category' ? 'اختر فئة لتطبيق الكفالة على الحالات التابعة لهذه الفئة.' :
                  '';
    hint.textContent = msg;
  }
}

function onSponsorTypeChange_() {
  const type = (document.getElementById('sponsorType')?.value || 'sponsorship').toString().trim();
  const wrap = document.getElementById('sponsorAmountWrap');
  const input = document.getElementById('sponsorAmount');
  const label = wrap ? wrap.querySelector('label') : null;
  if (!input) return;

  const isCash = type === 'sponsorship';
  const shouldHideAmount = type === 'in_kind';
  if (wrap) wrap.classList.toggle('hidden', shouldHideAmount);

  input.required = isCash;
  input.min = isCash ? '1' : '0';
  if (shouldHideAmount) input.value = '';

  if (label) {
    label.textContent = isCash
      ? 'قيمة الكفالة *'
      : type === 'ramadan_bags'
        ? 'عدد الشنط / القيمة التقديرية (اختياري)'
        : 'قيمة تقديرية (اختياري)';
  }
  input.placeholder = isCash ? '0' : (type === 'ramadan_bags' ? 'مثال: 50' : 'اختياري');
}

function computeSponsorTargetIds_() {
  const m = document.getElementById('bulkSponsorshipModal');
  const singleId = (m?.getAttribute('data-single-case-id') || '').toString().trim();
  if (singleId) return [singleId];

  const scope = (document.getElementById('sponsorScope')?.value || 'selected').toString();
  if (scope === 'selected') {
    try {
      const snap = (m?.getAttribute('data-target-ids') || '').toString().trim();
      if (snap) {
        const parsed = JSON.parse(snap);
        if (Array.isArray(parsed) && parsed.length) return parsed.map(x => String(x || '').trim()).filter(Boolean);
      }
    } catch { }
  }
  if (scope === 'all') {
    return (AppState.cases || []).map(c => c.id).filter(Boolean);
  }
  if (scope === 'filtered') {
    return getFilteredCases().map(c => c.id).filter(Boolean);
  }
  if (scope === 'gov') {
    const gov = (document.getElementById('sponsorScopeGov')?.value || '').toString().trim();
    if (!gov) { alert('اختر المحافظة'); return []; }
    return (AppState.cases || []).filter(c => String(c.governorate || '').trim() === gov).map(c => c.id).filter(Boolean);
  }
  if (scope === 'area') {
    const areaQ = (document.getElementById('sponsorScopeArea')?.value || '').toString().trim();
    if (!areaQ) { alert('اكتب اسم المنطقة'); return []; }
    const q = areaQ.toLowerCase();
    return (AppState.cases || []).filter(c => String(c.area || '').toLowerCase().includes(q)).map(c => c.id).filter(Boolean);
  }
  if (scope === 'category') {
    const cat = (document.getElementById('sponsorScopeCategory')?.value || '').toString().trim();
    if (!cat) { alert('اختر الفئة'); return []; }
    return (AppState.cases || []).filter(c => String(c.category || '').includes(cat)).map(c => c.id).filter(Boolean);
  }
  // default: selected
  return getSelectedCaseIds();
}

function renderPaymentsTabHtml_(it) {
  try {
    const changed = ensurePaymentUids_(it);
    if (changed) { try { if (DatabaseClient) void upsertCaseToDb(it); } catch { } }
  } catch { }

  const allHist = Array.isArray(it?.assistanceHistory) ? it.assistanceHistory : [];
  const f = getPaymentsFilter_();
  const hist = allHist.filter(x => {
    if (!x) return false;
    const t = (x.type || '').toString();
    const d = (x.date || '').toString();
    if (f.type && t !== f.type) return false;
    if (f.from && d && d < f.from) return false;
    if (f.to && d && d > f.to) return false;
    return true;
  });

  const sumAmt = (list) => (list || []).reduce((acc, x) => {
    const n = Number(x?.amount ?? 0);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  const sumS = sumAmt(hist.filter(x => (x?.type || '') === 'sponsorship'));
  const sumA = sumAmt(hist.filter(x => (x?.type || '') !== 'sponsorship'));

  const rows = hist
    .slice()
    .sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')))
    .map((x, idx) => {
      const t = String(x?.type || '');
      const d = String(x?.date || '');
      const amt = (x?.amount ?? '') === '' ? '' : String(x?.amount ?? '');
      const by = String(x?.byName || x?.byUser || '');
      const notes = String(x?.notes || '');
      const uid = (x?.uid || computePaymentUid_(x, idx)).toString();
      const canEdit = hasPerm('cases_edit');
      return `
        <tr>
          <td>${escapeHtml(t === 'sponsorship' ? 'كفالة' : t)}</td>
          <td>${escapeHtml(d)}</td>
          <td>${escapeHtml(amt)}</td>
          <td>${escapeHtml(by)}</td>
          <td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(notes)}">${escapeHtml(notes)}</td>
          <td style="white-space:nowrap">${canEdit ? `<button type="button" class="btn light" style="padding:6px 10px;color:#1f2937;border-color:#e5e7eb" onclick="openEditPaymentModal('${it.id}','${escapeHtml(uid)}')">تعديل</button>` : ''}</td>
        </tr>`;
    }).join('');

  const canEdit = hasPerm('cases_edit');
  const uniqTypes = Array.from(new Set(allHist.map(x => (x?.type || '').toString()).filter(Boolean)));
  uniqTypes.sort((a, b) => a.localeCompare(b));

  const filterBox = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:8px 0">
      <div class="form-group" style="margin:0"><label class="label">فلتر النوع</label>
        <select id="paymentsFilterType" class="control" onchange="onPaymentsFilterChange()">
          <option value="">الكل</option>
          ${uniqTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t === 'sponsorship' ? 'كفالة' : t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin:0"><label class="label">من تاريخ</label><input id="paymentsFilterFrom" type="date" class="control" onchange="onPaymentsFilterChange()" /></div>
      <div class="form-group" style="margin:0"><label class="label">إلى تاريخ</label><input id="paymentsFilterTo" type="date" class="control" onchange="onPaymentsFilterChange()" /></div>
    </div>`;

  const totalsBox = `
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:8px 0">
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:10px;background:#fff">
        <div style="color:#64748b;font-size:.9rem">إجمالي الكفالات (حسب الفلتر)</div>
        <div style="font-weight:900;font-size:1.35rem;margin-top:6px">${escapeHtml(sumS.toLocaleString('en-US'))}</div>
      </div>
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:10px;background:#fff">
        <div style="color:#64748b;font-size:.9rem">إجمالي المساعدات (حسب الفلتر)</div>
        <div style="font-weight:900;font-size:1.35rem;margin-top:6px">${escapeHtml(sumA.toLocaleString('en-US'))}</div>
      </div>
    </div>`;

  const actions = canEdit ? `
    <div style="display:flex;gap:8px;justify-content:flex-start;flex-wrap:wrap;margin:8px 0">
      <button type="button" class="btn" onclick="openSingleSponsorshipModal('${it.id}')">💳 دفع كفالة</button>
      <button type="button" class="btn light" onclick="openAddAssistanceModal('${it.id}')" style="color:#1f2937;border-color:#e5e7eb">➕ إضافة مساعدة</button>
    </div>` : '';

  return `
    ${actions}
    ${totalsBox}
    ${filterBox}
    <script>
      try {
        const f = ${JSON.stringify(f)};
        const t = document.getElementById('paymentsFilterType');
        const a = document.getElementById('paymentsFilterFrom');
        const b = document.getElementById('paymentsFilterTo');
        if (t) t.value = f.type || '';
        if (a) a.value = f.from || '';
        if (b) b.value = f.to || '';
      } catch { }
    </script>
    <div id="paymentsTableWrap" style="overflow:auto;border:1px solid #e5e7eb;border-radius:12px">
      <table class="table" style="min-width:720px">
        <thead>
          <tr>
            <th>النوع</th>
            <th>التاريخ</th>
            <th>المبلغ</th>
            <th>بواسطة</th>
            <th>ملاحظات</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="6" style="text-align:center">لا توجد مدفوعات/مساعدات مسجلة</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function openEditPaymentModal(caseId, uid) {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const it = AppState.cases.find(c => c.id === (caseId || '').toString());
  if (!it) { alert('الحالة غير موجودة'); return; }
  try {
    const changed = ensurePaymentUids_(it);
    if (changed) { try { if (DatabaseClient) void upsertCaseToDb(it); } catch { } }
  } catch { }
  const hist = Array.isArray(it.assistanceHistory) ? it.assistanceHistory : [];
  const idx = hist.findIndex((x) => (x?.uid || '').toString() === (uid || '').toString());
  if (idx < 0) { alert('تعذر العثور على العملية'); return; }
  const rec = hist[idx] || {};
  const m = document.getElementById('editPaymentModal');
  if (!m) { alert('تعذر فتح نافذة التعديل'); return; }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v ?? '').toString(); };
  set('editPaymentCaseId', it.id);
  set('editPaymentUid', (uid || '').toString());
  set('editPaymentType', rec.type || '');
  set('editPaymentDate', rec.date || '');
  set('editPaymentAmount', (rec.amount ?? '') === '' ? '' : String(rec.amount ?? ''));
  set('editPaymentBy', rec.byName || rec.byUser || '');
  set('editPaymentNotes', rec.notes || '');
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try { document.getElementById('editPaymentType')?.focus?.(); } catch { }
}

function closeEditPaymentModal() {
  const m = document.getElementById('editPaymentModal');
  if (!m) return;
  try {
    const ae = document.activeElement;
    if (ae && m.contains(ae) && typeof ae.blur === 'function') ae.blur();
  } catch { }
  m.classList.remove('show');
  m.setAttribute('aria-hidden', 'true');
}

async function applyEditPayment() {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const caseId = (document.getElementById('editPaymentCaseId')?.value || '').toString().trim();
  const uid = (document.getElementById('editPaymentUid')?.value || '').toString().trim();
  const type = (document.getElementById('editPaymentType')?.value || '').toString().trim();
  const date = (document.getElementById('editPaymentDate')?.value || '').toString().trim();
  const amountRaw = (document.getElementById('editPaymentAmount')?.value || '').toString().trim();
  const by = (document.getElementById('editPaymentBy')?.value || '').toString().trim();
  const notes = (document.getElementById('editPaymentNotes')?.value || '').toString().trim();

  if (!caseId) { alert('تعذر تحديد الحالة'); return; }
  if (!uid) { alert('تعذر تحديد العملية'); return; }
  if (!type) { alert('النوع مطلوب'); return; }
  if (!date) { alert('التاريخ مطلوب'); return; }
  const amount = amountRaw ? Number(amountRaw) : '';
  if (amountRaw && (Number.isNaN(amount) || amount < 0)) { alert('قيمة المبلغ غير صالحة'); return; }

  const it = AppState.cases.find(c => c.id === caseId);
  if (!it) { alert('الحالة غير موجودة'); return; }
  if (!Array.isArray(it.assistanceHistory)) it.assistanceHistory = [];
  const idx = it.assistanceHistory.findIndex((x) => (x?.uid || '').toString() === uid);
  if (idx < 0) { alert('تعذر العثور على العملية'); return; }

  const old = it.assistanceHistory[idx] || {};
  const updated = {
    ...old,
    uid: old.uid || (old.createdAt ? `${old.createdAt}__${Math.random().toString(16).slice(2)}` : `uid__${Date.now()}__${Math.random().toString(16).slice(2)}`),
    type,
    date,
    amount,
    notes,
    byName: by || old.byName || '',
    byUser: old.byUser || ''
  };
  it.assistanceHistory[idx] = updated;

  try {
    logAction('تعديل عملية', caseId, JSON.stringify({ uid, type, date, amount, by, notes }));
  } catch { }

  const uiState = captureCasesUiState_();
  try {
    if (DatabaseClient) {
      await upsertCaseToDb(it);
    }
  } catch (e) {
    try { console.error('upsertCaseToDb (edit payment) error:', e); } catch { }
    await onDatabaseWriteError_('تعذر حفظ التعديل في قاعدة البيانات حالياً.', e);
    return;
  }
  try {
    if ((AppState.currentCaseId || '') === caseId) {
      const panel = document.getElementById('casePanelPayments');
      if (panel) panel.innerHTML = renderPaymentsTabHtml_(it);
      setCaseDetailsTab('payments');
    }
  } catch { }
  await syncCasesAfterMutation_(caseId, { reopenDetails: (AppState.currentCaseId || '') === caseId, preserveTab: true, uiState });
  closeEditPaymentModal();
  alert('تم حفظ التعديل');
}

async function deletePaymentRecord() {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const caseId = (document.getElementById('editPaymentCaseId')?.value || '').toString().trim();
  const uid = (document.getElementById('editPaymentUid')?.value || '').toString().trim();
  if (!caseId || !uid) { alert('تعذر تحديد العملية'); return; }
  if (!confirm('هل تريد حذف هذه العملية؟')) return;

  const it = AppState.cases.find(c => c.id === caseId);
  if (!it) { alert('الحالة غير موجودة'); return; }
  if (!Array.isArray(it.assistanceHistory)) it.assistanceHistory = [];
  const idx = it.assistanceHistory.findIndex((x) => (x?.uid || '').toString() === uid);
  if (idx < 0) { alert('تعذر العثور على العملية'); return; }
  const deleted = it.assistanceHistory[idx] || null;
  it.assistanceHistory.splice(idx, 1);
  try { logAction('حذف عملية', caseId, JSON.stringify({ uid, deleted })); } catch { }

  const uiState = captureCasesUiState_();
  try {
    if (DatabaseClient) {
      await upsertCaseToDb(it);
    }
  } catch (e) {
    try { console.error('upsertCaseToDb (delete payment) error:', e); } catch { }
    await onDatabaseWriteError_('تعذر حذف العملية من قاعدة البيانات حالياً.', e);
    return;
  }
  try {
    if ((AppState.currentCaseId || '') === caseId) {
      const panel = document.getElementById('casePanelPayments');
      if (panel) panel.innerHTML = renderPaymentsTabHtml_(it);
      setCaseDetailsTab('payments');
    }
  } catch { }
  await syncCasesAfterMutation_(caseId, { reopenDetails: (AppState.currentCaseId || '') === caseId, preserveTab: true, uiState });
  closeEditPaymentModal();
  alert('تم حذف العملية');
}

async function applyBulkSponsorship() {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  if (AppState.bulkSponsorshipInProgress) return;
  const m = document.getElementById('bulkSponsorshipModal');
  const singleId = (m?.getAttribute('data-single-case-id') || '').toString().trim();
  const ids = computeSponsorTargetIds_();
  if (!ids.length) { alert('لا توجد حالات مطابقة للنطاق المختار'); return; }
  const startDate = (document.getElementById('sponsorStart')?.value || '').trim();
  const sponsorType = (document.getElementById('sponsorType')?.value || 'sponsorship').toString().trim() || 'sponsorship';
  const amountRaw = (document.getElementById('sponsorAmount')?.value || '').toString().trim();
  const hasAmount = amountRaw !== '';
  const amount = hasAmount ? Number(amountRaw) : '';
  if (!startDate) { alert('تاريخ بداية الكفالة مطلوب'); return; }
  if (sponsorType === 'sponsorship') {
    if (!hasAmount || Number.isNaN(amount) || amount <= 0) { alert('قيمة الكفالة مطلوبة'); return; }
  } else if (hasAmount && (Number.isNaN(amount) || amount < 0)) {
    alert('القيمة المدخلة غير صالحة');
    return;
  }

  let saveBtn = null;
  let watchdog = null;
  try {
    saveBtn = document.getElementById('bulkSponsorshipSaveBtn') || m?.querySelector('button.btn');
    if (saveBtn) saveBtn.disabled = true;
  } catch { }
  AppState.bulkSponsorshipInProgress = true;

  try {
    watchdog = setTimeout(() => {
      try {
        if (AppState.bulkSponsorshipInProgress) {
          AppState.bulkSponsorshipInProgress = false;
          if (saveBtn) saveBtn.disabled = false;
          alert('استغرقت العملية وقتاً طويلاً. تحقق من الاتصال ثم حاول مرة أخرى.');
        }
      } catch { }
    }, 25000);
  } catch { }

  const createdAt = new Date().toISOString();
  const byName = (AppState.currentUser?.name || AppState.currentUser?.username || '').toString().trim();
  const byUser = (AppState.currentUser?.username || '').toString().trim();
  const record = {
    uid: `${createdAt}__${Math.random().toString(16).slice(2)}`,
    type: sponsorType,
    date: startDate,
    amount: hasAmount ? amount : '',
    createdAt,
    byName,
    byUser
  };

  let updated = 0;
  const failed = [];
  try {
    for (const id of ids) {
      const it = AppState.cases.find(c => c.id === id);
      if (!it) continue;
      if (!Array.isArray(it.sponsorships)) it.sponsorships = [];
      if (!Array.isArray(it.assistanceHistory)) it.assistanceHistory = [];
      it.assistanceHistory.push({ ...record, uid: `${createdAt}__${Math.random().toString(16).slice(2)}` });
      try {
        if (DatabaseClient) {
          await upsertCaseToDb(it);
        }
      } catch (e) {
        try { console.error('upsertCaseToDb (sponsorship) error:', e); } catch { }
        failed.push({ id, message: e?.message || 'خطأ غير معروف' });
      }
      updated += 1;
    }

    try {
      const uiState = captureCasesUiState_();
      await syncCasesAfterMutation_(singleId || ids[0] || '', { reopenDetails: !!singleId, preserveTab: true, uiState });
      try {
        const scope = (document.getElementById('sponsorScope')?.value || (singleId ? 'selected' : 'selected')).toString();
        logAction('تسليم كفالة', '', `type: ${sponsorType} | scope: ${scope} | عدد الحالات: ${updated} | failed: ${failed.length}`);
      } catch {
        logAction('تسليم كفالة', '', `type: ${sponsorType} | عدد الحالات: ${updated} | failed: ${failed.length}`);
      }
    } catch { }

    try {
      if (singleId && (AppState.currentCaseId || '') === singleId) {
        const it = AppState.cases.find(c => c.id === singleId);
        const panel = document.getElementById('casePanelPayments');
        if (it && panel) panel.innerHTML = renderPaymentsTabHtml_(it);
        setCaseDetailsTab(AppState.caseDetailsTab || 'details');
      }
    } catch { }

    try { logAction('إضافة كفالة', '', `type: ${sponsorType} | عدد الحالات: ${updated} | failed: ${failed.length}`); } catch { }

    if (failed.length) {
      const msg = failed.slice(0, 8).map(x => `${x.id}: ${x.message}`).join('\n');
      setTimeout(() => alert(`تعذر حفظ بعض عمليات الكفالة في قاعدة البيانات (${failed.length}).\n\n${msg}`), 100);
      try { await reloadCasesFromDatabase_(); } catch { }
      return;
    }
    const doneLabel = sponsorType === 'sponsorship' ? 'الكفالة' : getAssistanceTypeLabel_(sponsorType);
    setTimeout(() => alert(`تم تسجيل ${doneLabel} لعدد ${updated} حالة`), 100);
  } catch (e) {
    try { console.error('applyBulkSponsorship unexpected error:', e); } catch { }
    alert(`حدث خطأ غير متوقع أثناء تسليم الكفالة.\n\nالخطأ: ${e?.message || 'خطأ غير معروف'}\n\nحاول مرة أخرى.`);
  } finally {
    try { if (watchdog) clearTimeout(watchdog); } catch { }
    try { closeBulkSponsorshipModal(); } catch { }
    try { if (!singleId) clearBulkSelection(); } catch { }
    try { AppState.bulkSponsorshipInProgress = false; } catch { }
    try { if (saveBtn) saveBtn.disabled = false; } catch { }
  }
}

function openAddAssistanceModal(caseId) {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const m = document.getElementById('addAssistanceModal');
  if (!m) return;
  const cid = document.getElementById('assistanceCaseId');
  if (cid) cid.value = (caseId || '').toString();
  try {
    const typeSel = document.getElementById('assistanceType');
    const other = document.getElementById('assistanceOtherType');
    const otherWrap = document.getElementById('assistanceOtherWrap');
    const dt = document.getElementById('assistanceDate');
    const amt = document.getElementById('assistanceAmount');
    const notes = document.getElementById('assistanceNotes');
    if (typeSel) typeSel.value = '';
    if (other) other.value = '';
    if (otherWrap) otherWrap.classList.add('hidden');
    if (dt && !dt.value) dt.value = new Date().toISOString().slice(0, 10);
    if (amt) amt.value = '';
    if (notes) notes.value = '';
  } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try { document.getElementById('assistanceType')?.focus?.(); } catch { }
}

function closeAddAssistanceModal() {
  const m = document.getElementById('addAssistanceModal');
  if (!m) return;
  try {
    const ae = document.activeElement;
    if (ae && m.contains(ae) && typeof ae.blur === 'function') ae.blur();
  } catch { }
  m.classList.remove('show');
  m.setAttribute('aria-hidden', 'true');
}

function onAssistanceTypeChange() {
  const typeSel = document.getElementById('assistanceType');
  const otherWrap = document.getElementById('assistanceOtherWrap');
  if (!typeSel || !otherWrap) return;
  const isOther = (typeSel.value || '') === 'أخرى';
  otherWrap.classList.toggle('hidden', !isOther);
}

async function applyAddAssistance() {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const caseId = (document.getElementById('assistanceCaseId')?.value || '').toString().trim();
  const typeVal = (document.getElementById('assistanceType')?.value || '').toString().trim();
  const otherType = (document.getElementById('assistanceOtherType')?.value || '').toString().trim();
  const date = (document.getElementById('assistanceDate')?.value || '').toString().trim();
  const amountRaw = (document.getElementById('assistanceAmount')?.value || '').toString().trim();
  const notes = (document.getElementById('assistanceNotes')?.value || '').toString().trim();

  const finalType = (typeVal === 'أخرى') ? otherType : typeVal;
  if (!caseId) { alert('تعذر تحديد الحالة'); return; }
  if (!finalType) { alert('نوع المساعدة مطلوب'); return; }
  if (!date) { alert('تاريخ المساعدة مطلوب'); return; }
  if (!notes) { alert('ملاحظات المساعدة مطلوبة'); return; }

  const amount = amountRaw ? Number(amountRaw) : '';
  if (amountRaw && (Number.isNaN(amount) || amount < 0)) { alert('قيمة المبلغ غير صالحة'); return; }

  const it = AppState.cases.find(c => c.id === caseId);
  if (!it) { alert('الحالة غير موجودة'); return; }
  if (!Array.isArray(it.assistanceHistory)) it.assistanceHistory = [];

  const createdAt = new Date().toISOString();
  const byName = (AppState.currentUser?.name || AppState.currentUser?.username || '').toString().trim();
  const byUser = (AppState.currentUser?.username || '').toString().trim();
  const uid = `${createdAt}__${Math.random().toString(16).slice(2)}`;
  const rec = { uid, type: finalType, date, amount, notes, createdAt, byName, byUser };
  it.assistanceHistory.push(rec);
  try { logAction('إضافة مساعدة', caseId, JSON.stringify(rec)); } catch { }
  const uiState = captureCasesUiState_();
  try {
    if (DatabaseClient) {
      await upsertCaseToDb(it);
    }
  } catch (e) {
    try { console.error('upsertCaseToDb (assistance) error:', e); } catch { }
    await onDatabaseWriteError_('تعذر حفظ المساعدة في قاعدة البيانات حالياً.', e);
    return;
  }
  await syncCasesAfterMutation_(caseId, { reopenDetails: (AppState.currentCaseId || '') === caseId, preserveTab: true, uiState });
  logAction('إضافة مساعدة', caseId, `النوع: ${finalType}${amountRaw ? ` - المبلغ: ${amount}` : ''}`);
  closeAddAssistanceModal();
  try {
    if ((AppState.currentCaseId || '') === caseId) {
      const panel = document.getElementById('casePanelPayments');
      if (panel) panel.innerHTML = renderPaymentsTabHtml_(it);
      setCaseDetailsTab((AppState.caseDetailsTab || 'details').toString());
    }
  } catch { }
  alert('تمت إضافة المساعدة');
}

function onCaseDetailsPrintClick() {
  const k = (AppState.caseDetailsTab || 'details').toString();
  if (k === 'payments') {
    try { printPaymentsForCurrentCase(); } catch { }
    return;
  }
  printCurrentCase();
}

function printPaymentsForCurrentCase() {
  const id = AppState.currentCaseId;
  const it = AppState.cases.find(c => c.id === id);
  if (!it) { alert('لا توجد حالة للطباعة'); return; }
  const hist = Array.isArray(it.assistanceHistory) ? it.assistanceHistory : [];
  const rows = hist
    .slice()
    .sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')))
    .map(x => {
      const t = String(x?.type || '');
      const d = String(x?.date || '');
      const amt = (x?.amount ?? '') === '' ? '' : String(x?.amount ?? '');
      const by = String(x?.byName || x?.byUser || '');
      const notes = String(x?.notes || '');
      return `
        <tr>
          <td>${escapeHtml(t === 'sponsorship' ? 'كفالة' : t)}</td>
          <td>${escapeHtml(d)}</td>
          <td>${escapeHtml(amt)}</td>
          <td>${escapeHtml(by)}</td>
          <td>${escapeHtml(notes)}</td>
        </tr>`;
    }).join('');

  const w = window.open('', '_blank');
  if (!w) { alert('يرجى السماح بالنوافذ المنبثقة'); return; }
  w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طباعة المدفوعات</title>
    <style>
      body{font-family:Tajawal,Arial,sans-serif;padding:16px;color:#111827}
      h2{margin:0 0 8px 0}
      .head{border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:10px 12px;margin:10px 0 12px 0}
      .head .title{font-weight:900;font-size:18px;color:#0f172a;margin-bottom:6px}
      .muted{color:#6b7280;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border:1px solid #e5e7eb;padding:7px;text-align:right;font-size:12px;vertical-align:top}
      th{background:#f8fafc}
      @media print{.no-print{display:none}}
    </style>
  </head><body>
    <div class="no-print" style="margin-bottom:10px"><button onclick="window.print()">طباعة</button></div>
    <h2>المدفوعات/المساعدات</h2>
    <div class="head">
      <div class="title">${escapeHtml(it.familyHead || '')}</div>
      <div class="muted">رقم الحالة: <strong>${escapeHtml(it.id || '')}</strong>${it.date ? ` — تاريخ: <strong>${escapeHtml(it.date)}</strong>` : ''}</div>
      <div class="muted">${it.governorate ? `المحافظة: <strong>${escapeHtml(it.governorate)}</strong>` : ''}${it.governorate && it.area ? ' — ' : ''}${it.area ? `القرية: <strong>${escapeHtml(it.area)}</strong>` : ''}</div>
    </div>
    <table>
      <thead><tr><th>النوع</th><th>التاريخ</th><th>المبلغ</th><th>بواسطة</th><th>ملاحظات</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center">لا توجد بيانات</td></tr>'}</tbody>
    </table>
  </body></html>`);
  w.document.close();
  w.focus();
  logAction('طباعة مدفوعات/مساعدات', it.id, 'تم فتح صفحة طباعة المدفوعات');
}

function capturePaymentsScreenshot() {
  try {
    const wrap = document.getElementById('paymentsTableWrap');
    if (!wrap) { alert('تعذر العثور على جدول المدفوعات'); return; }
    if (!window.html2canvas) { alert('تعذر إنشاء لقطة شاشة (html2canvas غير محمّل).'); return; }

    const id = (AppState.currentCaseId || '').toString();
    const it = (AppState.cases || []).find(c => (c?.id || '').toString() === id) || {};
    const family = (it.familyHead || it.name || 'حالة').toString().trim() || 'حالة';
    const gov = (it.governorate || '').toString().trim();
    const area = (it.area || '').toString().trim();
    const dt = (it.date || '').toString().trim();

    const safeName = (s) => (s || '').toString()
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'case';

    const temp = document.createElement('div');
    temp.style.position = 'fixed';
    temp.style.left = '-10000px';
    temp.style.top = '0';
    temp.style.background = '#ffffff';
    temp.style.padding = '14px';
    temp.style.width = `${Math.max(720, wrap.getBoundingClientRect().width || 720)}px`;
    temp.style.boxSizing = 'border-box';
    temp.style.direction = 'rtl';
    temp.style.fontFamily = 'Tajawal, Arial, sans-serif';

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.flexDirection = 'column';
    head.style.gap = '6px';
    head.style.padding = '10px 12px';
    head.style.border = '1px solid #e5e7eb';
    head.style.borderRadius = '12px';
    head.style.marginBottom = '10px';
    head.style.background = '#f8fafc';
    head.innerHTML = `
      <div style="font-weight:900;font-size:18px;color:#0f172a">${escapeHtml(family)}</div>
      <div style="color:#64748b;font-size:13px">رقم الحالة: <strong>${escapeHtml(id || '')}</strong>${dt ? ` — تاريخ: <strong>${escapeHtml(dt)}</strong>` : ''}</div>
      <div style="color:#64748b;font-size:13px">${gov ? `المحافظة: <strong>${escapeHtml(gov)}</strong>` : ''}${gov && area ? ' — ' : ''}${area ? `المنطقة: <strong>${escapeHtml(area)}</strong>` : ''}</div>
    `;

    const clonedWrap = wrap.cloneNode(true);
    try {
      clonedWrap.style.overflow = 'visible';
      clonedWrap.style.maxHeight = 'none';
    } catch { }

    temp.appendChild(head);
    temp.appendChild(clonedWrap);
    document.body.appendChild(temp);

    window.html2canvas(temp, { backgroundColor: '#ffffff', scale: 2 }).then(canvas => {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName(family)}.png`;
      a.click();
      try { logAction('لقطة شاشة مدفوعات/مساعدات', AppState.currentCaseId || '', 'PNG'); } catch { }
      try { document.body.removeChild(temp); } catch { }
    }).catch(() => {
      try { document.body.removeChild(temp); } catch { }
      alert('تعذر إنشاء لقطة شاشة. استخدم زر الطباعة ثم حفظ PDF.');
    });
  } catch {
    alert('تعذر إنشاء لقطة شاشة. استخدم زر الطباعة ثم حفظ PDF.');
  }
}

function captureCaseDetailsScreenshot() {
  try {
    const panel = document.getElementById('casePanelDetails');
    if (!panel) { alert('تعذر العثور على تفاصيل الحالة'); return; }
    if (!window.html2canvas) { alert('تعذر إنشاء لقطة شاشة (html2canvas غير محمّل).'); return; }

    const id = (AppState.currentCaseId || '').toString();
    const it = (AppState.cases || []).find(c => (c?.id || '').toString() === id) || {};
    const family = (it.familyHead || it.name || 'حالة').toString().trim() || 'حالة';
    const gov = (it.governorate || '').toString().trim();
    const area = (it.area || '').toString().trim();
    const dt = (it.date || '').toString().trim();

    const safeName = (s) => (s || '').toString()
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'case';

    const temp = document.createElement('div');
    temp.style.position = 'fixed';
    temp.style.left = '-10000px';
    temp.style.top = '0';
    temp.style.background = '#ffffff';
    temp.style.padding = '14px';
    temp.style.width = `${Math.max(720, panel.getBoundingClientRect().width || 720)}px`;
    temp.style.boxSizing = 'border-box';
    temp.style.direction = 'rtl';
    temp.style.fontFamily = 'Tajawal, Arial, sans-serif';

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.flexDirection = 'column';
    head.style.gap = '6px';
    head.style.padding = '10px 12px';
    head.style.border = '1px solid #e5e7eb';
    head.style.borderRadius = '12px';
    head.style.marginBottom = '10px';
    head.style.background = '#f8fafc';
    head.innerHTML = `
      <div style="font-weight:900;font-size:18px;color:#0f172a">${escapeHtml(family)}</div>
      <div style="color:#64748b;font-size:13px">رقم الحالة: <strong>${escapeHtml(id || '')}</strong>${dt ? ` — تاريخ: <strong>${escapeHtml(dt)}</strong>` : ''}</div>
      <div style="color:#64748b;font-size:13px">${gov ? `المحافظة: <strong>${escapeHtml(gov)}</strong>` : ''}${gov && area ? ' — ' : ''}${area ? `المنطقة: <strong>${escapeHtml(area)}</strong>` : ''}</div>
    `;

    const clonedPanel = panel.cloneNode(true);
    temp.appendChild(head);
    temp.appendChild(clonedPanel);
    document.body.appendChild(temp);

    window.html2canvas(temp, { backgroundColor: '#ffffff', scale: 2 }).then(canvas => {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName(family)}.png`;
      a.click();
      try { logAction('لقطة شاشة تفاصيل الحالة', AppState.currentCaseId || '', 'PNG'); } catch { }
      try { document.body.removeChild(temp); } catch { }
    }).catch(() => {
      try { document.body.removeChild(temp); } catch { }
      alert('تعذر إنشاء لقطة شاشة. استخدم زر الطباعة ثم حفظ PDF.');
    });
  } catch {
    alert('تعذر إنشاء لقطة شاشة. استخدم زر الطباعة ثم حفظ PDF.');
  }
}

function escapeHtml(str) {
  return (str || '').toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function filterCases() {
  try { resetCasesListPager_(); } catch { }
  try { scheduleCasesListRender_(); } catch {
    renderCasesTable();
    try { updateCasesListUiState_(); } catch { }
  }
}

let CasesListRenderTimer_ = null;
function scheduleCasesListRender_() {
  try { if (CasesListRenderTimer_) clearTimeout(CasesListRenderTimer_); } catch { }
  CasesListRenderTimer_ = setTimeout(() => {
    renderCasesTable();
    try { updateCasesListUiState_(); } catch { }
  }, 220);
}

function resetCasesListPager_() {
  try { AppState._casesListLimit = CASES_LIST_INITIAL_LIMIT; } catch { }
}

function loadMoreCases() {
  try {
    const cur = Number(AppState._casesListLimit || CASES_LIST_INITIAL_LIMIT) || CASES_LIST_INITIAL_LIMIT;
    AppState._casesListLimit = cur + CASES_LIST_LOAD_STEP;
  } catch { }
  renderCasesTable();
}

function makeCasesFilterKey_() {
  const gov = window.filterGovernorate ? (filterGovernorate.value || '') : '';
  const areaTxt = window.filterArea ? filterArea.value.trim() : '';
  const grade = window.filterCaseGrade ? filterCaseGrade.value : '';
  const q = window.caseSearch ? caseSearch.value.trim() : '';
  const explorerQ = window.filterExplorer ? filterExplorer.value.trim() : '';
  const needsQ = window.filterNeeds ? filterNeeds.value.trim() : '';
  let cats = '';
  try {
    const catsHost = window.filterCategoriesGroup ? filterCategoriesGroup : null;
    const selectedCats = catsHost ? Array.from(catsHost.querySelectorAll('input[type="checkbox"]')).filter(b => b.checked).map(b => b.value) : [];
    cats = selectedCats.sort().join(',');
  } catch { }
  const dashKey = (AppState.dashboardFilter?.key || '').toString();
  const v = Number(AppState._casesVersion || 0) || 0;
  return [v, gov, areaTxt, grade, q, explorerQ, needsQ, cats, dashKey].join('||');
}

function getFilteredCasesCached_() {
  const key = makeCasesFilterKey_();
  try {
    if (AppState._filteredCasesCacheKey === key && Array.isArray(AppState._filteredCasesCache)) {
      return AppState._filteredCasesCache;
    }
  } catch { }
  const list = getFilteredCases();
  try {
    AppState._filteredCasesCacheKey = key;
    AppState._filteredCasesCache = list;
  } catch { }
  return list;
}
function updateCaseStatus(id, val) {
  if (!hasPerm('case_status_change')) { alert('لا تملك صلاحية تغيير الحالة'); return; }
  const it = AppState.cases.find(x => x.id === id);
  if (it) {
    it.status = val; renderCasesTable();
    try { if (DatabaseClient) void upsertCaseToDb(it); } catch { }
    sendStatusUpdateToSheets({ id: it.id, status: it.status });
    logAction('تغيير حالة', it.id, val);
  }
}

// Settings UI & Storage
function readStorageJson_(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}
function writeStorageJson_(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}
function normalizeSettingsState_(raw) {
  const base = createDefaultSettings_();
  const src = (raw && typeof raw === 'object') ? raw : {};
  const regions = Array.isArray(src.regions)
    ? src.regions
      .filter(r => r && typeof r === 'object')
      .map(r => ({
        name: (r.name || '').toString().trim(),
        url: (r.url || '').toString().trim(),
        token: (r.token || '').toString().trim() || null
      }))
      .filter(r => r.name && r.url)
    : [];
  const activeRegion = (src.activeRegion || '').toString().trim() || null;
  const fallbackUrl = (src.url || src.googleSheetsUrl || '').toString().trim() || base.url;
  return {
    url: fallbackUrl,
    token: (src.token || '').toString().trim() || null,
    regions,
    activeRegion: regions.some(r => r.name === activeRegion) ? activeRegion : null
  };
}
function persistSettingsState_() {
  const normalized = normalizeSettingsState_(AppState.settings);
  AppState.settings = normalized;
  AppState.googleSheetsUrl = normalized.url || FRONTEND_CONFIG.googleSheetsUrl;
  writeStorageJson_(FRONTEND_CONFIG.settingsStorageKey, normalized);
  return normalized;
}
function loadSettings() {
  try {
    const stored = readStorageJson_(FRONTEND_CONFIG.settingsStorageKey, null);
    AppState.settings = normalizeSettingsState_(stored);
  } catch {
    AppState.settings = createDefaultSettings_();
  }
  AppState.googleSheetsUrl = AppState.settings.url || FRONTEND_CONFIG.googleSheetsUrl;
}
function saveSettings() {
  const next = { ...normalizeSettingsState_(AppState.settings) };
  const urlInput = document.getElementById('settingsUrlInput');
  const tokenEl = document.getElementById('settingsTokenInput');
  if (urlInput && (urlInput.value || '').toString().trim()) next.url = (urlInput.value || '').toString().trim();
  if (tokenEl) next.token = (tokenEl.value || '').toString().trim() || null;
  AppState.settings = next;
  persistSettingsState_();
  try {
    const b = document.getElementById('syncBadge');
    if (b) b.textContent = '';
  } catch { }
  if (tokenEl || urlInput) alert('تم حفظ الإعدادات');
}
function openSettings() {
  if (!hasPerm('settings')) { alert('لا تملك صلاحية فتح الإعدادات'); return; }
  const m = document.getElementById('settingsModal');
  if (!m) return;
  const urlInput = document.getElementById('settingsUrlInput');
  if (urlInput) {
    urlInput.value = getConfiguredUrl() || '';
    urlInput.readOnly = true;
  }
  const tokenEl = document.getElementById('settingsTokenInput');
  if (tokenEl) tokenEl.value = getToken() || '';
  try { renderUsersList(); } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
}
function closeSettings() {
  const m = document.getElementById('settingsModal');
  if (!m) return;
  m.classList.remove('show');
  m.setAttribute('aria-hidden', 'true');
}
function getConfiguredUrl() {
  const reg = getActiveRegion();
  if (reg && reg.url) return reg.url;
  const settingsUrl = (AppState.settings?.url || '').toString().trim();
  if (settingsUrl) return settingsUrl;
  const stateUrl = (AppState.googleSheetsUrl || '').toString().trim();
  return stateUrl || FRONTEND_CONFIG.googleSheetsUrl;
}
function getToken() { const reg = getActiveRegion(); if (reg && reg.token) return reg.token; return AppState.settings.token }

// Regions management
function getActiveRegion() {
  if (!AppState.settings.activeRegion) return null;
  return (AppState.settings.regions || []).find(r => r.name === AppState.settings.activeRegion) || null;
}
function populateRegionSelect() {
  const sel = document.getElementById('regionSelect'); if (!sel) return;
  const regions = AppState.settings.regions || [];
  sel.innerHTML = ['<option value="">الكل/الرئيسي</option>'].concat(regions.map(r => `<option>${r.name}</option>`)).join('');
  if (AppState.settings.activeRegion) { sel.value = AppState.settings.activeRegion; }
  sel.onchange = onRegionChange;
}
function onRegionChange(e) {
  const name = e.target.value || null;
  AppState.settings.activeRegion = name && name.length ? name : null;
  persistSettingsState_();
  // Reload from region source
  loadRemoteCases();
}
function renderRegions() {
  const list = document.getElementById('regionsList'); if (!list) return;
  const regs = AppState.settings.regions || [];
  if (!regs.length) { list.innerHTML = 'لا توجد مناطق مضافة بعد'; return; }
  list.innerHTML = regs.map(r => `<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #eee;padding:6px 0"><div><strong>${r.name}</strong><br><small>${r.url || ''}</small></div><div><button class="btn" type="button" onclick="prefillRegion('${r.name.replace(/"/g, '')}')">تعديل</button></div></div>`).join('');
}
function prefillRegion(name) {
  const r = (AppState.settings.regions || []).find(x => x.name === name); if (!r) return;
  document.getElementById('regionNameInput').value = r.name || '';
  document.getElementById('regionUrlInput').value = r.url || '';
  document.getElementById('regionTokenInput').value = r.token || '';
}
function addOrUpdateRegion() {
  const name = (document.getElementById('regionNameInput').value || '').trim();
  const url = (document.getElementById('regionUrlInput').value || '').trim();
  const token = (document.getElementById('regionTokenInput').value || '').trim();
  if (!name || !url) { alert('اسم المنطقة ورابطها مطلوبان'); return; }
  let regs = AppState.settings.regions || [];
  const idx = regs.findIndex(r => r.name === name);
  const obj = { name, url, token: token || null };
  if (idx >= 0) regs[idx] = obj; else regs.push(obj);
  AppState.settings.regions = regs;
  persistSettingsState_();
  renderRegions(); populateRegionSelect();
}
function removeRegion() {
  const name = (document.getElementById('regionNameInput').value || '').trim();
  if (!name) { alert('أدخل اسم المنطقة لحذفها'); return; }
  AppState.settings.regions = (AppState.settings.regions || []).filter(r => r.name !== name);
  if (AppState.settings.activeRegion === name) AppState.settings.activeRegion = null;
  persistSettingsState_();
  renderRegions(); populateRegionSelect();
}

// Dashboard & Reports
function updateDashboardStats() {
  const cases = Array.isArray(AppState.cases) ? AppState.cases : [];
  const sumNum = (v) => Number(v ?? 0) || 0;
  const fmt = (n) => {
    const x = Math.round((Number(n) || 0) * 100) / 100;
    return x.toLocaleString('en-US');
  };

  const monthLabel = (() => {
    try {
      const now = new Date();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      return `${now.getFullYear()}-${m}`;
    } catch { return ''; }
  })();

  const byType = {};
  const byGrade = { A: 0, B: 0, C: 0, other: 0 };
  const byGov = {};
  const byArea = {};
  const byStatus = {};

  let kTotal = cases.length;
  let kNewMonth = 0;
  let sumEstimated = 0;
  let sumDelivered = 0;

  let sumIncome = 0;
  let sumExpenses = 0;
  let sumDebts = 0;
  let sumOpsNeed = 0;
  let sumMonthlySponsorship = 0;
  let deficitSum = 0;
  let deficitCount = 0;

  const catBoxes = {
    'تجهيز عرائس': 0,
    'أسقف': 0,
    'وصلات مياه': 0,
    'احتياجات ضرورية ملحة': 0,
    'مشروعات صغيرة': 0,
    'عمليات طبية': 0,
    'كفالات مرضية': 0,
    'كفالة شهرية': 0
  };

  const inc = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

  const getCaseDate = (c) => {
    const raw = (c?.date || c?.importInfo?.importDate || '').toString();
    if (!raw) return null;
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return null;
    return d;
  };

  const getNeed = (c) => {
    const est = sumNum(c.estimatedAmount);
    const del = sumNum(c.deliveredAmount);
    return Math.max(0, est - del);
  };

  cases.forEach(c => {
    const st = String(c.status || 'غير محدد').trim() || 'غير محدد';
    inc(byStatus, st);

    const d = getCaseDate(c);
    if (d) {
      const now = new Date();
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) kNewMonth += 1;
    }

    const cat = (c.category || '').trim();
    const parts = cat ? cat.split(',').map(s => s.trim()).filter(Boolean) : [];
    const cats = parts.length ? parts : (cat ? [cat] : ['غير محدد']);
    const primary = cats[0] || 'غير محدد';
    inc(byType, primary);

    // Category boxes counts (match any category in the case)
    try {
      Object.keys(catBoxes).forEach(k => {
        if (cats.includes(k)) catBoxes[k] += 1;
      });
    } catch { }

    const gr = String(c.caseGrade || '').trim().toUpperCase();
    if (gr === 'A') byGrade.A += 1;
    else if (gr === 'B') byGrade.B += 1;
    else if (gr === 'C') byGrade.C += 1;
    else byGrade.other += 1;

    inc(byGov, String(c.governorate || 'غير محدد').trim() || 'غير محدد');
    inc(byArea, String(c.area || 'غير محدد').trim() || 'غير محدد');

    sumEstimated += sumNum(c.estimatedAmount);
    sumDelivered += sumNum(c.deliveredAmount);

    // Monthly sponsorship assumption: 200 EGP per case per month
    sumMonthlySponsorship += 200;

    const income = c.income || {};
    const expenses = c.expenses || {};
    const incT = sumNum(income.total);
    const expT = sumNum(expenses.total);
    sumIncome += incT;
    sumExpenses += expT;
    const deficit = Math.max(0, expT - incT);
    if (deficit > 0) { deficitSum += deficit; deficitCount += 1; }

    const debts = c.debts || {};
    if (debts.enabled) sumDebts += sumNum(debts.amount);

    const meds = Array.isArray(c.medicalInfo) ? c.medicalInfo : [];
    meds.forEach(m => {
      const v = sumNum(m?.estimatedCost || m?.cost || m?.amount);
      if (v) sumOpsNeed += v;
    });
  });

  const currentNeed = Math.max(0, sumEstimated - sumDelivered);

  try { document.getElementById('kpiTotalCases').textContent = fmt(kTotal); } catch { }
  try { document.getElementById('kpiNewThisMonth').textContent = fmt(kNewMonth); } catch { }
  try { document.getElementById('kpiNewThisMonthMeta').textContent = monthLabel ? `الشهر: ${monthLabel}` : '—'; } catch { }
  try { document.getElementById('kpiCurrentNeed').textContent = fmt(currentNeed); } catch { }

  try { document.getElementById('finIncomeTotal').textContent = fmt(sumIncome); } catch { }
  try { document.getElementById('finExpensesTotal').textContent = fmt(sumExpenses); } catch { }
  try { document.getElementById('finAvgDeficit').textContent = fmt(deficitCount ? (deficitSum / deficitCount) : 0); } catch { }
  try { document.getElementById('finDebtsTotal').textContent = fmt(sumDebts); } catch { }
  try { document.getElementById('finOpsNeed').textContent = fmt(sumOpsNeed); } catch { }
  try { document.getElementById('finEstimated').textContent = fmt(sumEstimated); } catch { }
  try { document.getElementById('finMonthlySponsorship').textContent = fmt(sumMonthlySponsorship); } catch { }

  // Category boxes UI
  try { document.getElementById('catBrides').textContent = fmt(catBoxes['تجهيز عرائس']); } catch { }
  try { document.getElementById('catRoofs').textContent = fmt(catBoxes['أسقف']); } catch { }
  try { document.getElementById('catWaterLinks').textContent = fmt(catBoxes['وصلات مياه']); } catch { }
  try { document.getElementById('catUrgentNeeds').textContent = fmt(catBoxes['احتياجات ضرورية ملحة']); } catch { }
  try { document.getElementById('catSmallProjects').textContent = fmt(catBoxes['مشروعات صغيرة']); } catch { }
  try { document.getElementById('catMedicalOps').textContent = fmt(catBoxes['عمليات طبية']); } catch { }
  try { document.getElementById('catMedicalSponsorship').textContent = fmt(catBoxes['كفالات مرضية']); } catch { }
  try { document.getElementById('catMonthlySponsorship').textContent = fmt(catBoxes['كفالة شهرية']); } catch { }

  try {
    AppState.dashboardGeoMode = AppState.dashboardGeoMode || 'gov';
  } catch { }

  try {
    const geoMode = AppState.dashboardGeoMode || 'gov';
    const gg = document.getElementById('geoGovBtn');
    const ga = document.getElementById('geoAreaBtn');
    if (gg && ga) {
      if (geoMode === 'gov') {
        gg.classList.remove('light');
        ga.classList.add('light');
        try { ga.style.color = '#1f2937'; ga.style.borderColor = '#e5e7eb'; } catch { }
      } else {
        ga.classList.remove('light');
        gg.classList.add('light');
        try { gg.style.color = '#1f2937'; gg.style.borderColor = '#e5e7eb'; } catch { }
      }
    }
  } catch { }

  const topEntries = (obj, limit = 8) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const chartLabels = (entries) => entries.map(x => x[0]);
  const chartValues = (entries) => entries.map(x => x[1]);

  const upsertChart = (key, canvasId, config) => {
    try {
      AppState._dashCharts = AppState._dashCharts || {};
      const ctx = document.getElementById(canvasId);
      if (!ctx) return;
      if (AppState._dashCharts[key]) {
        try { AppState._dashCharts[key].destroy(); } catch { }
      }
      AppState._dashCharts[key] = new Chart(ctx, config);
    } catch { }
  };

  try {
    const entries = topEntries(byType, 8);
    const labels = chartLabels(entries);
    const values = chartValues(entries);
    upsertChart('type', 'chartByType', {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: ['#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#0ea5e9', '#dc2626', '#334155', '#059669'] }] },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Tajawal' } } },
          tooltip: { rtl: true }
        },
        onClick: (_evt, els) => {
          if (!els || !els.length) return;
          const idx = els[0].index;
          const label = labels[idx];
          if (!label) return;
          applyDashboardFilter(`cat:${label}`, `النوع: ${label}`);
        }
      }
    });
  } catch { }

  try {
    const labels = ['A', 'B', 'C'];
    const values = [byGrade.A, byGrade.B, byGrade.C];
    upsertChart('grade', 'chartByGrade', {
      type: 'pie',
      data: { labels: ['A (حرجة)', 'B (متوسطة)', 'C (أقل أولوية)'], datasets: [{ data: values, backgroundColor: ['#dc2626', '#f59e0b', '#16a34a'] }] },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Tajawal' } } },
          tooltip: { rtl: true }
        },
        onClick: (_evt, els) => {
          if (!els || !els.length) return;
          const idx = els[0].index;
          const g = labels[idx];
          if (!g) return;
          applyDashboardFilter(`grade:${g}`, `التقييم: ${g}`);
        }
      }
    });
  } catch { }

  try {
    const geoMode = AppState.dashboardGeoMode || 'gov';
    const src = geoMode === 'gov' ? byGov : byArea;
    const entries = topEntries(src, 10);
    const labels = chartLabels(entries);
    const values = chartValues(entries);
    upsertChart('geo', 'chartGeo', {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: '#2563eb' }] },
      options: {
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { rtl: true }
        },
        scales: {
          x: { ticks: { font: { family: 'Tajawal' } } },
          y: { ticks: { font: { family: 'Tajawal' } } }
        },
        onClick: (_evt, els) => {
          if (!els || !els.length) return;
          const idx = els[0].index;
          const label = labels[idx];
          if (!label) return;
          applyDashboardFilter(geoMode === 'gov' ? `gov:${label}` : `area:${label}`, `${geoMode === 'gov' ? 'المحافظة' : 'المنطقة'}: ${label}`);
        }
      }
    });
  } catch { }

  try {
    const host = document.getElementById('dashAlerts');
    if (host) {
      const a1 = cases.filter(c => matchesDashboardFilter(c, 'alert:a_unapproved')).length;
      const a2 = cases.filter(c => matchesDashboardFilter(c, 'alert:stale_30')).length;
      const a3 = cases.filter(c => matchesDashboardFilter(c, 'alert:medical_urgent')).length;
      const row = (title, desc, count, key) => {
        const disabled = count ? '' : 'disabled';
        return `
          <div class="alert-item">
            <div>
              <div class="alert-title">${escapeHtml(title)}</div>
              <div class="alert-sub">${escapeHtml(desc)}</div>
            </div>
            <div class="alert-actions">
              <span class="alert-count">${fmt(count)}</span>
              <button class="btn mini" type="button" ${disabled} onclick="applyDashboardFilter('${key}','${escapeHtml(title)}')">عرض</button>
            </div>
          </div>`;
      };
      host.innerHTML = [
        row('حالات A غير معتمدة', 'حالات حرجة تحتاج اعتماد/إجراء', a1, 'alert:a_unapproved'),
        row('حالات مر عليها أكثر من 30 يوم بدون إجراء', 'تحسين المتابعة وتحديث الحالة', a2, 'alert:stale_30'),
        row('حالات علاج عاجلة', 'أولوية عالية للحالات الطبية', a3, 'alert:medical_urgent')
      ].join('');
    }
  } catch { }

  try {
    AppState._dashData = { cases, byStatus, byGov, byType };
  } catch { }

  try { initDashboardSelectors_(); } catch { }
  try { renderDashboardTable(); } catch { }

  try {
    const v = Number(AppState._casesVersion || 0) || 0;
    if (v) AppState._dashboardRenderedVersion = v;
  } catch { }
}

function setDashboardGeoMode(mode) {
  try { AppState.dashboardGeoMode = mode === 'area' ? 'area' : 'gov'; } catch { }
  try { updateDashboardStats(); } catch { }
}

function initDashboardSelectors_() {
  const cases = Array.isArray(AppState.cases) ? AppState.cases : [];
  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  const statuses = uniq(cases.map(c => String(c.status || '').trim()).filter(Boolean));
  const govs = uniq(cases.map(c => String(c.governorate || '').trim()).filter(Boolean));
  const types = uniq(cases.map(c => {
    const cat = (c.category || '').trim();
    if (!cat) return '';
    const parts = cat.split(',').map(s => s.trim()).filter(Boolean);
    return parts[0] || cat;
  }).filter(Boolean));

  const fill = (id, values, firstLabel) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${firstLabel}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    try { el.value = cur; } catch { }
  };

  fill('dashFilterStatus', statuses, 'الحالة الإدارية: الكل');
  fill('dashFilterGov', govs, 'المحافظة: الكل');
  fill('dashFilterType', types, 'النوع: الكل');
}

function renderDashboardTable() {
  const tb = document.getElementById('dashTableBody');
  if (!tb) return;
  const cases = Array.isArray(AppState.cases) ? AppState.cases : [];
  const q = (document.getElementById('dashTableSearch')?.value || '').toString().trim().toLowerCase();
  const st = (document.getElementById('dashFilterStatus')?.value || '').toString().trim();
  const gr = (document.getElementById('dashFilterGrade')?.value || '').toString().trim().toUpperCase();
  const gov = (document.getElementById('dashFilterGov')?.value || '').toString().trim();
  const type = (document.getElementById('dashFilterType')?.value || '').toString().trim();
  const sort = (document.getElementById('dashTableSort')?.value || 'need_desc').toString();

  const sumNum = (v) => Number(v ?? 0) || 0;
  const getNeed = (c) => Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount));
  const getDateVal = (c) => {
    const raw = (c?.date || c?.importInfo?.importDate || '').toString();
    const d = raw ? new Date(raw) : null;
    return d && Number.isFinite(d.getTime()) ? d.getTime() : 0;
  };
  const getType = (c) => {
    const cat = (c.category || '').trim();
    if (!cat) return '';
    const parts = cat.split(',').map(s => s.trim()).filter(Boolean);
    return parts[0] || cat;
  };

  let list = cases.slice();
  list = list.filter(c => {
    if (st && String(c.status || '').trim() !== st) return false;
    if (gr && String(c.caseGrade || '').trim().toUpperCase() !== gr) return false;
    if (gov && String(c.governorate || '').trim() !== gov) return false;
    if (type && getType(c) !== type) return false;
    if (q) {
      const hay = [c.familyHead, c.id, c.caseNo, c.governorate, c.area, c.category, c.status, c.caseGrade]
        .map(x => (x == null ? '' : String(x))).join(' | ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    if (sort === 'need_asc') return getNeed(a) - getNeed(b);
    if (sort === 'date_desc') return getDateVal(b) - getDateVal(a);
    if (sort === 'date_asc') return getDateVal(a) - getDateVal(b);
    return getNeed(b) - getNeed(a);
  });

  const top = list.slice(0, 20);
  const fmt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US');
  tb.innerHTML = top.map(c => {
    const name = (c.familyHead || '').toString().trim() || (c.id || '').toString();
    const t = getType(c) || '—';
    const g = (c.caseGrade || '—').toString();
    const gov2 = (c.governorate || '—').toString();
    const need = getNeed(c);
    const st2 = (c.status || '—').toString();
    return `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(t)}</td>
        <td>${escapeHtml(g)}</td>
        <td>${escapeHtml(gov2)}</td>
        <td>${escapeHtml(fmt(need))}</td>
        <td>${escapeHtml(st2)}</td>
        <td><button class="btn mini" type="button" onclick="openCaseDetails('${escapeHtml(c.id)}')">عرض</button></td>
      </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center">لا توجد نتائج</td></tr>';

  try {
    const meta = document.getElementById('dashTableMeta');
    if (meta) meta.textContent = `يعرض ${Math.min(20, list.length)} من ${list.length}`;
  } catch { }
}
function generateReportPreview() {
  const host = document.getElementById('reportPreview');
  if (!host) return;
  const cases = Array.isArray(AppState.cases) ? AppState.cases : [];
  if (!cases.length) {
    host.innerHTML = '<div class="section" style="border-color:#e5e7eb;background:#fff">لا توجد بيانات لعرض التقارير الآن. افتح قائمة الحالات أو انتظر اكتمال التحميل.</div>';
    return;
  }

  const range = getReportsRange_();
  const achievementsOnly = !!document.getElementById('reportsAchievementsOnly')?.checked;
  const list = range.active ? cases.filter(c => {
    const dv = getCaseDateValue_(c);
    if (!dv) return false;
    if (range.from && dv < range.from) return false;
    if (range.to && dv > range.to) return false;
    return true;
  }) : cases.slice();

  const sumNum = (v) => Number(v ?? 0) || 0;
  const needOf = (c) => Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount));

  const total = list.length;
  const done = list.filter(c => c.status === 'منفذة').length;
  const urgent = list.filter(c => c.urgency === 'عاجل' || c.urgency === 'عاجل جدًا').length;
  const medical = list.filter(c => c.category === 'عمليات طبية' || c.category === 'كفالات مرضية').length;
  const rate = total ? ((done / total) * 100).toFixed(1) : 0;
  const byGov = {}; list.forEach(c => { const g = c.governorate || 'غير محدد'; byGov[g] = (byGov[g] || 0) + 1 });
  const topGov = Object.entries(byGov).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([g, n]) => `<div style=\"display:flex;justify-content:space-between\"><span>${escapeHtml(g)}</span><strong>${escapeHtml(n)}</strong></div>`).join('');

  const flatAssists = flattenAssistanceInRange_(list, range);
  const spons = flatAssists.filter(x => (x?.type || '') === 'sponsorship');
  const other = flatAssists.filter(x => (x?.type || '') && (x?.type || '') !== 'sponsorship');
  const sponsTotal = spons.reduce((a, x) => a + (Number(x?.amount ?? 0) || 0), 0);
  const otherTotal = other.reduce((a, x) => a + (Number(x?.amount ?? 0) || 0), 0);

  const rangeLabel = range.active ? `الفترة: ${escapeHtml(range.label)}` : 'الفترة: كل البيانات';

  const typeFilter = (AppState._reportsTypeFilter || 'all').toString();
  try { syncReportsTypeTabsUi_(); } catch { }

  try { renderReportsDashboard_(list, range, typeFilter, flatAssists); } catch { }

  const achievementsText = buildReportsAchievementsText_(list, range, typeFilter);
  const previewTable = achievementsOnly ? '' : renderReportsCasesTable_(list, needOf);

  const topAreasHtml = renderReportsTopAreas_(list, range, typeFilter);
  const byExecutorHtml = renderReportsByExecutor_(list, range, typeFilter);
  const medicalHtml = renderReportsMedicalPro_(list, range);

  host.innerHTML = `
    <div class="ds-toolbar" style="background:#f8fbff; border-color:#e2eaff; border-radius:12px; margin-bottom:16px;">
      <div style="font-weight:900; font-size:1.1rem; color:var(--brand-primary);">${rangeLabel}</div>
      <div style="font-size:0.9rem; color:var(--text-muted); font-weight:700;">عدد الحالات المعروضة: <span style="font-size:1.1rem; color:var(--text-primary);">${escapeHtml(total)}</span></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
      <div class="ds-content-card" style="padding:16px;border-top:3px solid var(--brand-primary)">
        <div style="font-size:.85rem;color:var(--text-muted);font-weight:700;margin-bottom:4px">إجمالي الحالات</div>
        <div style="font-size:1.8rem;font-weight:900;color:var(--text-primary)">${escapeHtml(total)}</div>
      </div>
      <div class="ds-content-card" style="padding:16px;border-top:3px solid var(--status-success);background:rgba(16,185,129,0.02)">
        <div style="font-size:.85rem;color:var(--status-success);font-weight:700;margin-bottom:4px">الحالات المنفذة</div>
        <div style="font-size:1.8rem;font-weight:900;color:var(--status-success)">${escapeHtml(done)}</div>
      </div>
      <div class="ds-content-card" style="padding:16px;border-top:3px solid var(--brand-secondary)">
        <div style="font-size:.85rem;color:var(--text-muted);font-weight:700;margin-bottom:4px">نسبة الإنجاز</div>
        <div style="font-size:1.8rem;font-weight:900;color:var(--brand-secondary)">${escapeHtml(rate)}%</div>
      </div>
      <div class="ds-content-card" style="padding:16px;border-top:3px solid var(--status-warning)">
        <div style="font-size:.85rem;color:var(--text-muted);font-weight:700;margin-bottom:4px">العاجلة</div>
        <div style="font-size:1.8rem;font-weight:900;color:var(--text-primary)">${escapeHtml(urgent)}</div>
      </div>
      <div class="ds-content-card" style="padding:16px;border-top:3px solid #8b5cf6">
        <div style="font-size:.85rem;color:var(--text-muted);font-weight:700;margin-bottom:4px">الطبية</div>
        <div style="font-size:1.8rem;font-weight:900;color:var(--text-primary)">${escapeHtml(medical)}</div>
      </div>
      <div class="ds-content-card" style="padding:16px;border-top:3px solid var(--text-muted)">
        <div style="font-size:.85rem;color:var(--text-muted);font-weight:700;margin-bottom:8px">توزيع أعلى المحافظات</div>
        <div style="font-size:.9rem;color:var(--text-primary)">${topGov || 'لا بيانات'}</div>
      </div>
      <div class="ds-content-card" style="padding:16px;border-top:3px solid #0284c7">
        <div style="font-size:.85rem;color:var(--text-muted);font-weight:700;margin-bottom:4px">إجمالي عمليات كفالة</div>
        <div style="font-size:1.8rem;font-weight:900;color:var(--text-primary)">${escapeHtml(spons.length)}</div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:4px">بإجمالي ${escapeHtml(Math.round(sponsTotal).toLocaleString('en-US'))} جنيه</div>
      </div>
      <div class="ds-content-card" style="padding:16px;border-top:3px solid #059669">
        <div style="font-size:.85rem;color:var(--text-muted);font-weight:700;margin-bottom:4px">تدخلات أخرى</div>
        <div style="font-size:1.8rem;font-weight:900;color:var(--text-primary)">${escapeHtml(other.length)}</div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:4px">بإجمالي ${escapeHtml(Math.round(otherTotal).toLocaleString('en-US'))} جنيه</div>
      </div>
    </div>
    <div class="ds-section-panel" style="margin-bottom:24px">
      <div class="ds-section-panel-title">
        <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-left:8px"><polyline points="20 6 9 17 4 12"></polyline></svg>
        نص الإنجازات المجمع (يمكن نسخه والمشاركة به)
      </div>
      <pre id="reportsAchievementsText" style="white-space:pre-wrap;margin:16px;padding:20px;background:#f8fafc;border:1px solid #e2eaf0;border-radius:12px;font-family:inherit;line-height:1.85;color:var(--text-primary);font-size:.95rem">${escapeHtml(achievementsText || 'لا توجد إنجازات داخل الفترة وفقاً للبيانات الحالية.')}</pre>
    </div>
    <div class="ds-section-panel" style="margin-bottom:24px">
      <div class="ds-section-panel-title">أفضل 10 مناطق إنجازًا</div>
      <div style="margin:16px">${topAreasHtml}</div>
    </div>
    <div class="ds-section-panel" style="margin-bottom:24px">
      <div class="ds-section-panel-title">الإنجازات حسب المنفّذ</div>
      <div style="margin:16px">${byExecutorHtml}</div>
    </div>
    <div class="ds-section-panel" style="margin-bottom:24px">
      <div class="ds-section-panel-title">تقرير طبي (احترافي)</div>
      <div style="margin:16px">${medicalHtml}</div>
    </div>
    ${achievementsOnly ? '' : `
      <div class="ds-section-panel" style="margin-bottom:24px">
        <div class="ds-section-panel-title">تفاصيل الحالات</div>
        <div style="margin:16px">${previewTable}</div>
      </div>`}
    `;

  try { updateReportsRangeHint_(range, total); } catch { }
  try { renderAuditLog(); } catch { }
}

function renderReportsDashboard_(casesInRange, range, typeFilter, flatAssists) {
  const list = Array.isArray(casesInRange) ? casesInRange : [];
  const sumNum = (v) => Number(v ?? 0) || 0;
  const fmt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US');
  const needOf = (c) => Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount));

  const rangeLabel = range?.active ? `الفترة: ${range.label}` : 'الفترة: كل البيانات';
  const total = list.length;
  const done = list.filter(c => c.status === 'منفذة').length;
  const rate = total ? `${((done / total) * 100).toFixed(1)}%` : '0%';
  const totalNeed = list.reduce((a, c) => a + needOf(c), 0);

  // assistance counts based on filter
  const assistsAll = Array.isArray(flatAssists) ? flatAssists : flattenAssistanceInRange_(list, range);
  const assists = filterAssistsByReportsType_(assistsAll, typeFilter);
  const spons = assists.filter(x => (x?.type || '') === 'sponsorship');
  const other = assists.filter(x => (x?.type || '') && (x?.type || '') !== 'sponsorship');

  try { document.getElementById('repKpiTotal').textContent = fmt(total); } catch { }
  try { document.getElementById('repKpiDone').textContent = fmt(done); } catch { }
  try { document.getElementById('repKpiRate').textContent = rate; } catch { }
  try { document.getElementById('repKpiNeed').textContent = fmt(totalNeed); } catch { }
  try { document.getElementById('repKpiSpons').textContent = fmt(spons.length); } catch { }
  try { document.getElementById('repKpiOther').textContent = fmt(other.length); } catch { }
  try { document.getElementById('repKpiRange').textContent = rangeLabel; } catch { }

  // Aggregate charts
  const byType = {};
  const byGrade = { A: 0, B: 0, C: 0, other: 0 };
  const byGov = {};
  const inc = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };
  const getType = (c) => {
    const cat = (c?.category || '').toString().trim();
    if (!cat) return 'غير محدد';
    const parts = cat.split(',').map(s => s.trim()).filter(Boolean);
    return parts[0] || cat;
  };
  list.forEach(c => {
    inc(byType, getType(c));
    const gr = String(c.caseGrade || '').trim().toUpperCase();
    if (gr === 'A') byGrade.A += 1;
    else if (gr === 'B') byGrade.B += 1;
    else if (gr === 'C') byGrade.C += 1;
    else byGrade.other += 1;
    inc(byGov, String(c.governorate || 'غير محدد').trim() || 'غير محدد');
  });

  const topEntries = (obj, limit = 10) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const chartLabels = (entries) => entries.map(x => x[0]);
  const chartValues = (entries) => entries.map(x => x[1]);

  const upsert = (key, canvasId, config) => {
    try {
      if (!window.Chart) return;
      AppState._repCharts = AppState._repCharts || {};
      const ctx = document.getElementById(canvasId);
      if (!ctx) return;
      if (AppState._repCharts[key]) {
        try { AppState._repCharts[key].destroy(); } catch { }
      }
      AppState._repCharts[key] = new Chart(ctx, config);
    } catch { }
  };

  try {
    const entries = topEntries(byType, 8);
    const labels = chartLabels(entries);
    const values = chartValues(entries);
    upsert('type', 'repChartByType', {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: ['#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#0ea5e9', '#dc2626', '#334155', '#059669'] }] },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Tajawal' } } },
          tooltip: { rtl: true }
        }
      }
    });
  } catch { }

  try {
    const labels = ['A', 'B', 'C'];
    const values = [byGrade.A, byGrade.B, byGrade.C];
    upsert('grade', 'repChartByGrade', {
      type: 'pie',
      data: { labels: ['A (حرجة)', 'B (متوسطة)', 'C (أقل أولوية)'], datasets: [{ data: values, backgroundColor: ['#dc2626', '#f59e0b', '#16a34a'] }] },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Tajawal' } } },
          tooltip: { rtl: true }
        }
      }
    });
  } catch { }

  try {
    const entries = topEntries(byGov, 10);
    const labels = chartLabels(entries);
    const values = chartValues(entries);
    upsert('geo', 'repChartGeo', {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: '#2563eb' }] },
      options: {
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { rtl: true }
        },
        scales: {
          x: { ticks: { font: { family: 'Tajawal' } } },
          y: { ticks: { font: { family: 'Tajawal' } } }
        }
      }
    });
  } catch { }
}

function buildReportsAchievementsText_(cases, range, typeFilter) {
  const list = Array.isArray(cases) ? cases : [];
  const safeRange = range?.active ? `${range.label}` : 'كل البيانات';
  const lines = [];
  lines.push(`📊 تقرير إنجازات لجنة أسرة كريمة`);
  lines.push(`📅 الفترة: ${safeRange}`);
  if (typeFilter && typeFilter !== 'all') {
    lines.push(`🏷️ نوع التقرير: ${escapeHtml(getReportsTypeLabel_(typeFilter))}`);
  }
  lines.push(`--------------------------------------------------`);
  lines.push('');

  const totalCases = list.length;
  const addedCases = list.filter(c => {
    const dv = getCaseDateValue_(c);
    if (!dv) return false;
    if (range?.active) {
      if (range?.from && dv < range.from) return false;
      if (range?.to && dv > range.to) return false;
    }
    return true;
  }).length;

  if (totalCases || addedCases) {
    lines.push(`👥 ملخص الحالات الإجمالي:`);
  }
  if (totalCases) {
    lines.push(`   🔸 إجمالي الحالات المتفاعلة: ${totalCases} حالة${range?.active ? ' (ضمن الفترة)' : ''}`);
  }
  if (addedCases && range?.active) {
    lines.push(`   🔸 حالات جديدة مسجلة: ${addedCases} حالة مستجدة`);
  }

  const assistsAll = flattenAssistanceInRange_(list, range);
  const assists = filterAssistsByReportsType_(assistsAll, typeFilter);
  if (assists.length) {
    lines.push('');
    lines.push('💰 تفصيل المساعدات والكفالات (المنفذة):');
    lines.push('--------------------------------------------------');

    const fmtMoney = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');

    // Grouping by Governorate and Area for better hierarchy
    const govGroups = {};
    assists.forEach(x => {
      const gov = (x?.governorate || 'غير محدد').trim();
      const area = (x?.area || 'غير محدد').trim();
      const type = (x?.type || 'غير محدد').trim();

      govGroups[gov] = govGroups[gov] || { total: 0, areas: {} };
      govGroups[gov].total += Number(x?.amount ?? 0) || 0;

      const ak = `${area}||${type}`;
      govGroups[gov].areas[ak] = govGroups[gov].areas[ak] || { area, type, count: 0, total: 0, names: [] };
      govGroups[gov].areas[ak].count += 1;
      govGroups[gov].areas[ak].total += Number(x?.amount ?? 0) || 0;

      const nm = (x?.familyHead || '').toString().trim();
      if (nm) govGroups[gov].areas[ak].names.push(nm);
    });

    const sortedGovs = Object.keys(govGroups).sort((a,b) => govGroups[b].total - govGroups[a].total);

    sortedGovs.forEach(gov => {
      lines.push(`\n📍 محافظة ${gov}`);

      const sortedAreas = Object.values(govGroups[gov].areas).sort((a,b) => b.total - a.total);
      sortedAreas.forEach(g => {
        const typeLabel = g.type === 'sponsorship' ? 'كفالة مالية' : g.type;
        const areaText = g.area && g.area !== 'غير محدد' ? g.area : 'مناطق عامة';
        const moneyPart = g.total ? ` (بإجمالي ${fmtMoney(g.total)} جنيه)` : '';

        lines.push(`   🔸 ${areaText}: ${g.count} عملية ${typeLabel}${moneyPart}`);

        const uniq = Array.from(new Set((g.names || []).filter(Boolean)));
        if (uniq.length > 0 && uniq.length <= 15) {
          lines.push(`      👤 شملت: ${uniq.join('، ')}`);
        }
      });
    });
  }

  // Category highlights within list
  const byCat = {};
  list.forEach(c => {
    const cat = (c?.category || 'غير محدد').toString().trim();
    byCat[cat] = (byCat[cat] || 0) + 1;
  });
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topCats.length) {
    lines.push('');
    lines.push('📈 توزيع الحالات المتفاعلة حسب الفئة:');
    topCats.forEach(([cat, n]) => {
      lines.push(`- ${cat}: ${n} حالة`);
    });
  }

  return lines.join('\n');
}

function getReportsTypeLabel_(t) {
  const v = (t || 'all').toString();
  if (v === 'sponsorship') return 'كفالات مالية';
  if (v === 'ramadan_bags') return 'شنط رمضان';
  if (v === 'in_kind') return 'مساعدات عينية';
  if (v === 'medical') return 'عمليات طبية';
  if (v === 'all') return 'الكل';
  return v;
}

function filterAssistsByReportsType_(assists, typeFilter) {
  const list = Array.isArray(assists) ? assists : [];
  const t = (typeFilter || 'all').toString();
  if (!t || t === 'all') return list;
  if (t === 'medical') {
    // medical achievements are case-based, not assistance-based
    return list.filter(x => {
      const type = (x?.type || '').toString();
      return type === 'عمليات طبية' || type === 'كفالات مرضية' || type === 'رعاية صحية';
    });
  }
  return list.filter(x => (x?.type || '').toString() === t);
}

function setReportsTypeFilter(type) {
  try { AppState._reportsTypeFilter = (type || 'all').toString(); } catch { }
  try { syncReportsTypeTabsUi_(); } catch { }
  try { generateReportPreview(); } catch { }
}

function syncReportsTypeTabsUi_() {
  const current = (AppState._reportsTypeFilter || 'all').toString();
  const all = [
    { id: 'reportsTypeAllBtn', key: 'all' },
    { id: 'reportsTypeSponsorshipBtn', key: 'sponsorship' },
    { id: 'reportsTypeRamadanBtn', key: 'ramadan_bags' },
    { id: 'reportsTypeInKindBtn', key: 'in_kind' },
    { id: 'reportsTypeBridesBtn', key: 'تجهيز عرائس' },
    { id: 'reportsTypeMedicalBtn', key: 'medical' }
  ];
  all.forEach(x => {
    const btn = document.getElementById(x.id);
    if (!btn) return;
    const active = x.key === current;
    btn.classList.toggle('light', !active);
  });
}

function renderReportsTopAreas_(cases, range, typeFilter) {
  const list = Array.isArray(cases) ? cases : [];
  const assistsAll = flattenAssistanceInRange_(list, range);
  const assists = filterAssistsByReportsType_(assistsAll, typeFilter);
  const fmtMoney = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');

  const groups = {};
  assists.forEach(x => {
    const gov = (x?.governorate || 'غير محدد').toString().trim();
    const area = (x?.area || 'غير محدد').toString().trim();
    const k = `${gov}||${area}`;
    groups[k] = groups[k] || { gov, area, count: 0, total: 0 };
    groups[k].count += 1;
    groups[k].total += Number(x?.amount ?? 0) || 0;
  });

  const sorted = Object.values(groups).sort((a, b) => (b.total - a.total) || (b.count - a.count)).slice(0, 10);
  const rows = sorted.map((g, idx) => `
    <tr>
      <td>${escapeHtml(idx + 1)}</td>
      <td>${escapeHtml(g.gov)}</td>
      <td>${escapeHtml(g.area)}</td>
      <td>${escapeHtml(g.count)}</td>
      <td>${escapeHtml(fmtMoney(g.total))}</td>
    </tr>`).join('');

  return `
    <div style="overflow:auto;border:1px solid #e5e7eb;border-radius:12px;background:#fff">
      <table class="table" style="min-width:760px">
        <thead><tr><th>#</th><th>المحافظة</th><th>المنطقة</th><th>عدد العمليات</th><th>إجمالي المبالغ</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="text-align:center">لا توجد بيانات</td></tr>'}</tbody>
      </table>
    </div>`;
}

function renderReportsByExecutor_(cases, range, typeFilter) {
  const list = Array.isArray(cases) ? cases : [];
  const assistsAll = flattenAssistanceInRange_(list, range);
  const assists = filterAssistsByReportsType_(assistsAll, typeFilter);
  const fmtMoney = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');

  const groups = {};
  assists.forEach(x => {
    const by = (x?.by || x?.byName || x?.byUser || 'غير محدد').toString().trim() || 'غير محدد';
    groups[by] = groups[by] || { by, count: 0, total: 0 };
    groups[by].count += 1;
    groups[by].total += Number(x?.amount ?? 0) || 0;
  });
  const sorted = Object.values(groups).sort((a, b) => (b.total - a.total) || (b.count - a.count)).slice(0, 15);
  const rows = sorted.map((g, idx) => `
    <tr>
      <td>${escapeHtml(idx + 1)}</td>
      <td>${escapeHtml(g.by)}</td>
      <td>${escapeHtml(g.count)}</td>
      <td>${escapeHtml(fmtMoney(g.total))}</td>
    </tr>`).join('');

  return `
    <div style="overflow:auto;border:1px solid #e5e7eb;border-radius:12px;background:#fff">
      <table class="table" style="min-width:680px">
        <thead><tr><th>#</th><th>المنفّذ</th><th>عدد العمليات</th><th>إجمالي المبالغ</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" style="text-align:center">لا توجد بيانات</td></tr>'}</tbody>
      </table>
    </div>`;
}

function renderReportsMedicalPro_(cases, range) {
  const list = Array.isArray(cases) ? cases : [];
  const medicalCases = list.filter(c => {
    const cat = (c?.category || '').toString();
    return cat === 'عمليات طبية' || cat === 'كفالات مرضية' || (Array.isArray(c?.medicalCases) && c.medicalCases.length);
  });
  if (!medicalCases.length) {
    return '<div style="color:#64748b">لا توجد حالات طبية داخل الفترة.</div>';
  }

  const sumNum = (v) => Number(v ?? 0) || 0;
  const needOf = (c) => Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount));

  const rows = [];
  medicalCases.forEach(c => {
    const meds = Array.isArray(c.medicalCases) && c.medicalCases.length ? c.medicalCases : [c.medicalInfo || {}];
    meds.forEach(m => {
      const disease = (m?.diseaseType || m?.name || '').toString();
      const specialty = (m?.specialty || '').toString();
      const hospital = (m?.hospital || '').toString();
      const doctor = (m?.doctor || '').toString();
      const cost = (m?.estimatedCost ?? '').toString();
      rows.push({
        caseNo: (c?.caseNo ?? '').toString(),
        id: (c?.id ?? '').toString(),
        familyHead: (c?.familyHead ?? '').toString(),
        governorate: (c?.governorate ?? '').toString(),
        area: (c?.area ?? '').toString(),
        disease,
        specialty,
        hospital,
        doctor,
        cost,
        remainingNeed: String(needOf(c))
      });
    });
  });

  const htmlRows = rows.slice(0, 250).map(r => `
    <tr>
      <td>${escapeHtml(r.caseNo)}</td>
      <td>${escapeHtml(r.familyHead)}</td>
      <td>${escapeHtml(r.governorate)}</td>
      <td>${escapeHtml(r.area)}</td>
      <td>${escapeHtml(r.disease)}</td>
      <td>${escapeHtml(r.specialty)}</td>
      <td>${escapeHtml(r.hospital)}</td>
      <td>${escapeHtml(r.doctor)}</td>
      <td>${escapeHtml(r.cost)}</td>
      <td>${escapeHtml(r.remainingNeed)}</td>
    </tr>`).join('');

  return `
    <div style="overflow:auto;border:1px solid #e5e7eb;border-radius:12px;background:#fff">
      <table class="table" style="min-width:1200px">
        <thead>
          <tr>
            <th>رقم</th>
            <th>اسم الحالة</th>
            <th>المحافظة</th>
            <th>المنطقة</th>
            <th>المرض/الحالة</th>
            <th>التخصص/الخطورة</th>
            <th>المستشفى</th>
            <th>الطبيب</th>
            <th>التكلفة التقديرية</th>
            <th>الاحتياج المتبقي (عام)</th>
          </tr>
        </thead>
        <tbody>${htmlRows || '<tr><td colspan="10" style="text-align:center">لا توجد بيانات</td></tr>'}</tbody>
      </table>
    </div>
    <div style="color:#64748b;font-size:.9rem;margin-top:8px">يعرض ${escapeHtml(Math.min(rows.length, 250))} من ${escapeHtml(rows.length)} سجل طبي</div>`;
}

function exportMedicalReportToExcel() {
  const range = getReportsRange_();
  const cases = Array.isArray(AppState.cases) ? AppState.cases : [];
  const list = range.active ? cases.filter(c => {
    const dv = getCaseDateValue_(c);
    if (!dv) return false;
    if (range.from && dv < range.from) return false;
    if (range.to && dv > range.to) return false;
    return true;
  }) : cases.slice();

  const medicalCases = list.filter(c => {
    const cat = (c?.category || '').toString();
    return cat === 'عمليات طبية' || cat === 'كفالات مرضية' || (Array.isArray(c?.medicalCases) && c.medicalCases.length);
  });
  if (!medicalCases.length) { alert('لا توجد حالات طبية للتصدير داخل الفترة'); return; }

  const sumNum = (v) => Number(v ?? 0) || 0;
  const needOf = (c) => Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount));

  const headers = [
    'رقم الحالة',
    'اسم الحالة',
    'الرقم القومي',
    'المحافظة',
    'المنطقة',
    'الفئة',
    'تاريخ البحث',
    'المرض/الحالة',
    'التخصص/الخطورة',
    'المستشفى',
    'الطبيب',
    'التقرير',
    'التكلفة التقديرية',
    'الاحتياج المتبقي (عام)'
  ];
  const rows = [headers];

  medicalCases.forEach(c => {
    const meds = Array.isArray(c.medicalCases) && c.medicalCases.length ? c.medicalCases : [c.medicalInfo || {}];
    meds.forEach(m => {
      rows.push([
        String(c.caseNo ?? ''),
        String(c.familyHead ?? ''),
        String(c.id ?? ''),
        String(c.governorate ?? ''),
        String(c.area ?? ''),
        String(c.category ?? ''),
        String(c.date ?? ''),
        String(m?.diseaseType || m?.name || ''),
        String(m?.specialty || ''),
        String(m?.hospital || ''),
        String(m?.doctor || ''),
        String(m?.report || m?.medicalReport || ''),
        String(m?.estimatedCost ?? ''),
        String(needOf(c))
      ]);
    });
  });

  const fname = `medical-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    if (!window.XLSX) throw new Error('XLSX missing');
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws['!sheetViews'] = [{ rightToLeft: true }];
    window.XLSX.utils.book_append_sheet(wb, ws, 'Medical');
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Views = [{ RTL: true }];
    window.XLSX.writeFile(wb, fname);
    try { logAction('تصدير تقرير طبي Excel', '', `range: ${range.label} | rows: ${rows.length - 1}`); } catch { }
  } catch {
    alert('تعذر تصدير تقرير طبي (XLSX غير متاح)');
  }
}

function copyReportsTemplate(kind) {
  try {
    const range = getReportsRange_();
    const pre = document.getElementById('reportsAchievementsText');
    const raw = (pre?.textContent || '').toString().trim();
    const t = (AppState._reportsTypeFilter || 'all').toString();
    const title = range?.active ? `تقرير الإنجازات (${range.label})` : 'تقرير الإنجازات';
    const typeLine = t && t !== 'all' ? `\nنوع التقرير: ${getReportsTypeLabel_(t)}\n` : '\n';

    let out = '';
    if ((kind || '').toString() === 'whatsapp') {
      out = `${title}${typeLine}${raw}`;
    } else if ((kind || '').toString() === 'facebook') {
      out = `${title}\n${range?.active ? `الفترة: ${range.label}\n` : ''}${t !== 'all' ? `نوع التقرير: ${getReportsTypeLabel_(t)}\n` : ''}\n${raw}\n\n#خواطر_أحلى_شباب`;
    } else {
      out = `خطاب رسمي\n${title}\n${range?.active ? `الفترة: ${range.label}\n` : ''}${t !== 'all' ? `نوع التقرير: ${getReportsTypeLabel_(t)}\n` : ''}\n${raw}\n`;
    }
    void (async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(out);
          alert('تم نسخ القالب');
          return;
        }
      } catch { }
      try {
        const ta = document.createElement('textarea');
        ta.value = out;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        alert('تم نسخ القالب');
      } catch {
        alert('تعذر النسخ');
      }
    })();
  } catch {
    alert('تعذر تجهيز القالب');
  }
}

async function copyReportsAchievementsText() {
  try {
    const pre = document.getElementById('reportsAchievementsText');
    const txt = (pre?.textContent || '').toString();
    if (!txt.trim()) { alert('لا يوجد نص لنسخه'); return; }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(txt);
      alert('تم نسخ نص الإنجازات');
      return;
    }
  } catch { }

  try {
    const pre = document.getElementById('reportsAchievementsText');
    const txt = (pre?.textContent || '').toString();
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    alert('تم نسخ نص الإنجازات');
  } catch {
    alert('تعذر النسخ');
  }
}

function getReportsRange_() {
  const fromRaw = (document.getElementById('reportsFromDate')?.value || '').toString().trim();
  const toRaw = (document.getElementById('reportsToDate')?.value || '').toString().trim();
  const from = fromRaw ? normalizeISODateValue_(fromRaw) : 0;
  const to = toRaw ? normalizeISODateValue_(toRaw) : 0;
  const active = !!(fromRaw || toRaw);
  const label = `${fromRaw || '...'} - ${toRaw || '...'}`;
  return { fromRaw, toRaw, from: from || 0, to: to || 0, active, label };
}

function normalizeISODateValue_(iso) {
  const s = (iso || '').toString().trim();
  if (!s) return 0;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return 0;
  return ms;
}

function getCaseDateValue_(c) {
  const raw = (c?.date ?? '').toString().trim();
  if (!raw) return 0;
  if (raw.includes('/')) {
    const iso = parseDDMMYYYYToISO(raw);
    return normalizeISODateValue_(iso);
  }
  return normalizeISODateValue_(raw);
}

function getAssistanceDateValue_(raw) {
  const s = (raw ?? '').toString().trim();
  if (!s) return 0;
  if (s.includes('/')) {
    const iso = parseDDMMYYYYToISO(s);
    return normalizeISODateValue_(iso);
  }
  return normalizeISODateValue_(s);
}

function flattenAssistanceInRange_(cases, range) {
  const list = Array.isArray(cases) ? cases : [];
  const out = [];
  list.forEach(c => {
    const hist = Array.isArray(c?.assistanceHistory) ? c.assistanceHistory : [];
    hist.forEach(x => {
      const dv = getAssistanceDateValue_(x?.date || '');
      if (!dv) return;
      if (range?.active) {
        if (range?.from && dv < range.from) return;
        if (range?.to && dv > range.to) return;
      }
      const byName = (x?.byName ?? '').toString().trim();
      const byUser = (x?.byUser ?? '').toString().trim();
      const by = ((x?.by ?? '').toString().trim() || byName || byUser || '').toString().trim();
      out.push({
        caseId: (c?.id ?? '').toString(),
        caseNo: (c?.caseNo ?? '').toString(),
        familyHead: (c?.familyHead ?? '').toString(),
        governorate: (c?.governorate ?? '').toString(),
        area: (c?.area ?? '').toString(),
        type: (x?.type ?? '').toString(),
        date: (x?.date ?? '').toString(),
        amount: Number(x?.amount ?? 0) || 0,
        by,
        byName,
        byUser,
        notes: (x?.notes ?? '').toString()
      });
    });
  });
  return out;
}

function renderReportsCasesTable_(list, needOf) {
  const rows = (Array.isArray(list) ? list : []).slice();
  rows.sort((a, b) => getCaseDateValue_(b) - getCaseDateValue_(a));
  const top = rows.slice(0, 200);
  const fmt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US');
  const tr = top.map(c => {
    const name = (c?.familyHead || '').toString().trim() || (c?.id || '').toString();
    const nid = (c?.id || '').toString();
    const gov = (c?.governorate || '').toString();
    const area = (c?.area || '').toString();
    const cat = (c?.category || '').toString();
    const st = (c?.status || '').toString();
    const urg = (c?.urgency || '').toString();
    const grade = (c?.caseGrade || '').toString();
    const d = (c?.date || '').toString();
    const need = needOf ? needOf(c) : '';
    const btn = `<button class=\"btn mini\" type=\"button\" onclick=\"openCaseDetails('${escapeHtml(nid)}')\">عرض</button>`;
    return `
      <tr>
        <td>${escapeHtml(c?.caseNo ?? '')}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(nid)}</td>
        <td>${escapeHtml(gov)}</td>
        <td>${escapeHtml(area)}</td>
        <td>${escapeHtml(cat)}</td>
        <td>${escapeHtml(st)}</td>
        <td>${escapeHtml(urg)}</td>
        <td>${escapeHtml(grade)}</td>
        <td>${escapeHtml(d)}</td>
        <td>${escapeHtml(fmt(need))}</td>
        <td>${btn}</td>
      </tr>`;
  }).join('');

  return `
    <div style="overflow:auto;border:1px solid #e5e7eb;border-radius:12px;background:#fff">
      <table class="table" style="min-width:1100px">
        <thead>
          <tr>
            <th>رقم</th>
            <th>اسم الحالة</th>
            <th>الرقم القومي</th>
            <th>المحافظة</th>
            <th>المنطقة</th>
            <th>الفئة</th>
            <th>الحالة</th>
            <th>الاستعجال</th>
            <th>التقييم</th>
            <th>تاريخ البحث</th>
            <th>الاحتياج</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${tr || '<tr><td colspan="12" style="text-align:center">لا توجد بيانات</td></tr>'}
        </tbody>
      </table>
    </div>
    <div style="color:#64748b;font-size:.9rem;margin-top:8px">يعرض ${escapeHtml(top.length)} من ${escapeHtml(rows.length)} حالة (الأحدث أولاً)</div>`;
}

function updateReportsRangeHint_(range, total) {
  const el = document.getElementById('reportsRangeHint');
  if (!el) return;
  el.style.display = 'block';
  if (range?.active) {
    el.textContent = `يعرض النتائج حسب الفترة: ${range.label} | عدد الحالات: ${total}`;
  } else {
    el.textContent = `يعرض كل البيانات | عدد الحالات: ${total}`;
  }
}

function exportReportsRangeToExcel() {
  const range = getReportsRange_();
  const cases = Array.isArray(AppState.cases) ? AppState.cases : [];
  const list = range.active ? cases.filter(c => {
    const dv = getCaseDateValue_(c);
    if (!dv) return false;
    if (range.from && dv < range.from) return false;
    if (range.to && dv > range.to) return false;
    return true;
  }) : cases.slice();
  if (!list.length) { alert('لا توجد بيانات للتصدير حسب الفترة'); return; }

  const sumNum = (v) => Number(v ?? 0) || 0;
  const needOf = (c) => Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount));

  const casesHeaders = [
    'رقم الحالة', 'اسم الحالة', 'الرقم القومي', 'المحافظة', 'المنطقة', 'الفئة', 'الحالة', 'الاستعجال', 'التقييم', 'تاريخ البحث',
    'مبلغ تقديري', 'مبلغ منفذ', 'الاحتياج',
    'عدد الكفالات المسجلة', 'إجمالي الكفالات المسجلة', 'تاريخ آخر كفالة',
    'عدد المساعدات (غير الكفالة)', 'إجمالي المساعدات (غير الكفالة)'
  ];
  const casesRows = [casesHeaders];
  list.forEach(c => {
    const hist = Array.isArray(c.assistanceHistory) ? c.assistanceHistory : [];
    const spons = hist.filter(x => (x?.type || '') === 'sponsorship');
    const other = hist.filter(x => (x?.type || '') && (x?.type || '') !== 'sponsorship');
    const sponsCount = spons.length;
    const sponsTotal = spons.reduce((a, x) => a + (Number(x?.amount ?? 0) || 0), 0);
    const lastSponsDate = spons.length ? String(spons.map(x => x?.date || '').sort().slice(-1)[0] || '') : '';
    const otherCount = other.length;
    const otherTotal = other.reduce((a, x) => a + (Number(x?.amount ?? 0) || 0), 0);
    casesRows.push([
      String(c.caseNo ?? ''),
      String(c.familyHead ?? ''),
      String(c.id ?? ''),
      String(c.governorate ?? ''),
      String(c.area ?? ''),
      String(c.category ?? ''),
      String(c.status ?? ''),
      String(c.urgency ?? ''),
      String(c.caseGrade ?? ''),
      String(c.date ?? ''),
      String(c.estimatedAmount ?? ''),
      String(c.deliveredAmount ?? ''),
      String(needOf(c)),
      String(sponsCount),
      String(sponsTotal),
      String(lastSponsDate),
      String(otherCount),
      String(otherTotal)
    ]);
  });

  const assists = flattenAssistanceInRange_(list, range);
  const assistsHeaders = ['رقم الحالة', 'الرقم القومي', 'اسم الحالة', 'المحافظة', 'المنطقة', 'النوع', 'التاريخ', 'المبلغ', 'بواسطة', 'ملاحظات'];
  const assistsRows = [assistsHeaders];
  assists.forEach(x => {
    assistsRows.push([
      String(x.caseNo ?? ''),
      String(x.caseId ?? ''),
      String(x.familyHead ?? ''),
      String(x.governorate ?? ''),
      String(x.area ?? ''),
      String(x.type ?? ''),
      String(x.date ?? ''),
      String(x.amount ?? ''),
      String(x.by ?? ''),
      String(x.notes ?? '')
    ]);
  });

  const fname = `reports-${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    if (!window.XLSX) throw new Error('XLSX missing');
    const wb = window.XLSX.utils.book_new();
    const ws1 = window.XLSX.utils.aoa_to_sheet(casesRows);
    ws1['!sheetViews'] = [{ rightToLeft: true }];
    window.XLSX.utils.book_append_sheet(wb, ws1, 'Cases');
    const ws2 = window.XLSX.utils.aoa_to_sheet(assistsRows);
    ws2['!sheetViews'] = [{ rightToLeft: true }];
    window.XLSX.utils.book_append_sheet(wb, ws2, 'Assistance');
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Views = [{ RTL: true }];
    window.XLSX.writeFile(wb, fname);
    try { logAction('تصدير تقرير Excel', '', `range: ${range.label} | cases: ${list.length} | assists: ${assists.length}`); } catch { }
    return;
  } catch {
    alert('تعذر تصدير Excel (XLSX غير متاح)');
  }
}

function captureReportsScreenshot() {
  try {
    const wrap = document.getElementById('reportPreview');
    if (!wrap) { alert('تعذر العثور على محتوى التقرير'); return; }
    if (!window.html2canvas) { alert('تعذر إنشاء لقطة شاشة (html2canvas غير محمّل).'); return; }

    const temp = document.createElement('div');
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    temp.style.top = '0';
    temp.style.width = '1200px';
    temp.style.background = '#ffffff';
    const cloned = wrap.cloneNode(true);
    temp.appendChild(cloned);
    document.body.appendChild(temp);

    window.html2canvas(temp, { backgroundColor: '#ffffff', scale: 2 }).then(canvas => {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      try { temp.remove(); } catch { }
      try { logAction('لقطة شاشة للتقرير', '', ''); } catch { }
    }).catch(() => {
      try { temp.remove(); } catch { }
      alert('تعذر إنشاء لقطة شاشة');
    });
  } catch {
    alert('تعذر إنشاء لقطة شاشة');
  }
}

function exportReportsToWord() {
  try {
    const host = document.getElementById('reportPreview');
    if (!host) { alert('تعذر العثور على محتوى التقرير'); return; }
    const range = getReportsRange_();
    const title = range?.active ? `تقرير الفترة: ${range.label}` : 'تقرير شامل';
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h2>${escapeHtml(title)}</h2>${host.innerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${new Date().toISOString().slice(0, 10)}.doc`;
    a.click();
    URL.revokeObjectURL(url);
    try { logAction('تصدير تقرير Word', '', `range: ${range.label}`); } catch { }
  } catch {
    alert('تعذر تصدير Word');
  }
}
function exportToCSV() {
  const headers = ['رقم الحالة', 'الرقم القومي', 'اسم رب الأسرة', 'الهاتف', 'العنوان', 'المحافظة', 'المنطقة', 'عدد الأفراد', 'الفئة', 'الاستعجال', 'الوصف', 'المستكشف', 'التاريخ', 'حالة الطلب', 'عمل الأب', 'عمل الأم', 'المرضي', 'احتياجاتهم (مختصر)', 'إجمالي الدخل', 'المستشفى', 'الطبيب', 'التقرير الطبي', 'التكلفة الطبية التقديرية', 'مبلغ تقديري', 'مبلغ منفذ', 'مصدر التمويل', 'وسوم', 'الحالات الطبية'];
  let csv = headers.join(',') + '\n';
  AppState.cases.forEach(c => {
    const jobs = (c.jobs && typeof c.jobs === 'object') ? c.jobs : {};
    const income = (c.income && typeof c.income === 'object') ? c.income : {};
    const firstMed = Array.isArray(c.medicalCases) && c.medicalCases.length ? c.medicalCases[0] : null;
    const m = firstMed ? {
      hospital: firstMed.hospital || '',
      doctor: firstMed.doctor || '',
      medicalReport: firstMed.report || '',
      estimatedCost: firstMed.estimatedCost || ''
    } : (c.medicalInfo || {});
    const medJson = JSON.stringify(c.medicalCases || []).replaceAll('"', '""');
    csv += `"${c.caseNo ?? ''}","${c.id}","${c.familyHead}","${c.phone}","${c.address}","${c.governorate || ''}","${c.area || ''}","${c.familyCount}","${c.category}","${c.urgency}","${(c.description || '').replaceAll('"', '""')}","${c.explorerName}","${c.date}","${c.status}","${(jobs.father || '').toString().replaceAll('"', '""')}","${(jobs.mother || '').toString().replaceAll('"', '""')}","${(c.illnesses || '').toString().replaceAll('"', '""')}","${(c.needsShort || '').toString().replaceAll('"', '""')}","${income.total ?? ''}","${m.hospital || ''}","${m.doctor || ''}","${m.medicalReport || ''}","${m.estimatedCost || ''}","${c.estimatedAmount || ''}","${c.deliveredAmount || ''}","${c.fundingSource || ''}","${Array.isArray(c.tags) ? c.tags.join(' | ') : ''}","${medJson}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'cases.csv'; a.click(); URL.revokeObjectURL(url);
  logAction('تصدير CSV', '', `عدد الحالات: ${AppState.cases.length}`);
}

// نافذة تفاصيل الحالة (عرض/تعديل)
function openCaseDetails(id, mode) {
  const it = AppState.cases.find(c => c.id === id); if (!it) return;
  AppState.currentCaseId = id;
  const body = document.getElementById('caseDetailsBody');
  if (!body) {
    alert('تعذر فتح التفاصيل: عنصر caseDetailsBody غير موجود في الصفحة');
    return;
  }
  const canEdit = hasPerm('cases_edit');
  const finalMode = (mode || 'view').toString();
  AppState.caseDetailsMode = (canEdit && finalMode === 'edit') ? 'edit' : 'view';
  if (AppState.caseDetailsMode === 'edit') {
    try {
      AppState.caseDetailsOriginal = JSON.parse(JSON.stringify(it));
      AppState.caseDetailsDirty = false;
    } catch {
      AppState.caseDetailsOriginal = null;
      AppState.caseDetailsDirty = false;
    }
  } else {
    try { AppState.caseDetailsDirty = false; } catch { }
    try { AppState.caseDetailsOriginal = null; } catch { }
  }
  const disAttr = (AppState.caseDetailsMode === 'edit') ? '' : 'disabled';
  const isAdmin = canEdit;
  try { syncCaseDetailsButtons(); } catch { }
  const housing = it.housing || {};
  const debts = it.debts || {};
  const income = it.income || {};
  const expenses = it.expenses || {};
  const marriage = it.marriage || {};
  const project = it.project || {};
  const jobs = (it.jobs && typeof it.jobs === 'object') ? it.jobs : {};
  const importInfo = (it.importInfo && typeof it.importInfo === 'object') ? it.importInfo : null;
  const explorationInfo = (it.explorationInfo && typeof it.explorationInfo === 'object') ? it.explorationInfo : null;

  const viewBox = (title, val, opt) => {
    const v = (val ?? '').toString().trim();
    const safe = escapeHtml(v || '—');
    const missing = !!(opt && opt.missing);
    const border = missing ? '#fecaca' : '#eef2f7';
    const bg = missing ? '#fff7f7' : '#fff';
    return `<div style="border:1px solid ${border};border-radius:12px;padding:10px;background:${bg}"><div style="color:#64748b;font-size:.85rem;margin-bottom:4px">${escapeHtml(title)}</div><div style="font-weight:700;color:#0f172a;white-space:pre-wrap;word-break:break-word">${safe}</div></div>`;
  };
  const viewSection = (title, inner) => `
    <div style="grid-column:1/-1;border:1px solid #e5e7eb;border-radius:14px;padding:12px;background:#f8fafc">
      <div style="font-weight:800;color:#0f172a;margin-bottom:10px">${escapeHtml(title)}</div>
      <div class="grid cols-2" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${inner}</div>
    </div>`;

  if (AppState.caseDetailsMode !== 'edit') {
    const exp = explorationInfo || {
      governorate: it.governorate || '',
      area: it.area || '',
      explorerName: it.explorerName || '',
      date: it.date || '',
      status: it.status || '',
      category: it.category || '',
      urgency: it.urgency || ''
    };

    const isDefaultMissing = (v) => (v ?? '').toString().trim() === 'غير محدد';
    const coreIdentity = `<div style="grid-column:1/-1">${viewSection('بيانات أساسية', [
      viewBox('رقم الحالة', it.caseNo ?? ''),
      viewBox('اسم الحالة', it.familyHead || ''),
      viewBox('الرقم القومي', it.id || ''),
      viewBox('الحالة الاجتماعية', it.maritalStatus || ''),
      viewBox('عدد أفراد الأسرة', it.familyCount || ''),
      viewBox('المحافظة', it.governorate || '', { missing: isDefaultMissing(it.governorate) }),
      viewBox('القرية', it.area || '', { missing: isDefaultMissing(it.area) }),
      viewBox('اسم الباحث', it.explorerName || '', { missing: isDefaultMissing(it.explorerName) }),
      viewBox('تاريخ البحث', it.date || '', { missing: isDefaultMissing(it.date) }),
      viewBox('تقييم الحالة', normalizeCaseGrade_(it.caseGrade || ''))
    ].join(''))}</div>`;

    const adminClassify = `<div style="grid-column:1/-1">${viewSection('التصنيف الإداري', [
      viewBox('نوع الحالة', it.category || ''),
      //viewBox('أولوية الحالة', it.urgency || ''),
      //viewBox('حالة الطلب', it.status || '')
    ].join(''))}</div>`;

    const incomeExpensesHtml = `<div style="grid-column:1/-1">${viewSection('الدخل والمصروفات', [
      viewBox('إجمالي الدخل', income.total ?? ''),
      viewBox('ملاحظات الدخل', income.notes || ''),
      viewBox('إجمالي المصروفات', expenses.total ?? ''),
      viewBox('ملاحظات المصروفات', expenses.notes || ''),
      viewBox('صافي شهري', it.netMonthly ?? '')
    ].join(''))}</div>`;

    const housingHtml = `<div style="grid-column:1/-1">${viewSection('السكن', [
      viewBox('عدد الغرف', housing.roomsCount ?? ''),
      viewBox('نوع السقف', housing.roofExists || ''),
      viewBox('مياه', housing.waterExists || ''),
      viewBox('حمام', housing.bathroomType || ''),
      viewBox('نوع المنطقة', housing.areaType || ''),
      viewBox('وصف السكن', housing.housingDesc || '')
    ].join(''))}</div>`;

    const hasDebts = !!debts.enabled || !!(debts.amount ?? '') || !!(debts.owner || '').toString().trim() || !!(debts.reason || '').toString().trim() || !!(debts.hasCourtOrder || '').toString().trim();
    const debtsHtml = `<div style="grid-column:1/-1">${viewSection('الديون', [
      viewBox('قيمة الدين', debts.amount ?? ''),
      viewBox('سبب الدين', debts.reason || ''),
      viewBox('جهة الدين', debts.owner || ''),
      viewBox('حكم قضائي (نعم/لا)', debts.hasCourtOrder || ''),
      viewBox('هل توجد ديون؟', hasDebts ? (debts.enabled ? 'نعم' : 'نعم (غير محدد)') : 'لا')
    ].join(''))}</div>`;

    const medicalCases = Array.isArray(it.medicalCases) ? it.medicalCases : [];
    const medicalHtml = `<div style="grid-column:1/-1">${viewSection('الجانب الطبي', medicalCases.length
      ? medicalCases.map((m, i) => viewBox(`حالة طبية #${i + 1}`, [
        `الاسم: ${m?.name || ''}`,
        `نوع المرض: ${m?.diseaseType || ''}`,
        `درجة الخطورة: ${m?.specialty || ''}`,
        `التكلفة التقديرية: ${m?.estimatedCost || ''}`,
        `المطلوب: ${m?.required || ''}`,
        `المستشفى: ${m?.hospital || ''}`
      ].filter(Boolean).join('\n'))).join('')
      : viewBox('لا توجد بيانات طبية', '—'))}</div>`;

    const needsHtml = `<div style="grid-column:1/-1">${viewSection('الاحتياجات', [
      viewBox('احتياجات مصنفة', it.category || ''),
      viewBox('وصف احتياجات إضافي', [it.needsShort || '', it.familyNeeds || ''].filter(Boolean).join('\n'))
    ].join(''))}</div>`;

    const reportHtml = `<div style="grid-column:1/-1">${viewSection('تقرير الباحث', [
      viewBox('ملخص الحالة', it.description || ''),
      viewBox('التوصية النهائية', ''),
      viewBox('سبب التوصية', ''),
      viewBox('النتيجة بعد التنظيم', it.researcherReport || '')
    ].join(''))}</div>`;

    const imp = importInfo;
    const importSection = (imp && (imp.sourceFileName || '').toString().trim()) ? `<div style="grid-column:1/-1">${viewSection('بيانات الاستيراد', [
      viewBox('اسم الملف', imp.sourceFileName || '')
    ].join(''))}</div>` : '';

    const detailsHtml = `
      ${coreIdentity}
      ${adminClassify}
      ${incomeExpensesHtml}
      ${housingHtml}
      ${debtsHtml}
      ${medicalHtml}
      ${needsHtml}
      ${reportHtml}
      ${importSection}
    `;
    const paymentsHtml = renderPaymentsTabHtml_(it);
    const logHtml = `<div id="casePanelChangeLog" class="hidden" style="grid-column:1/-1"><div style="color:#64748b">اختر تبويب السجل لعرض التغييرات.</div></div>`;
    body.innerHTML = `
      <div class="caseDetailsBodyBtnAdd case-details-tabs" style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-start;flex-wrap:wrap;margin-bottom:10px">
        <button id="caseTabDetails" type="button" class="btn case-details-tab" onclick="setCaseDetailsTab('details')">تفاصيل الحالة</button>
        <button id="caseTabPayments" type="button" class="btn light case-details-tab" onclick="setCaseDetailsTab('payments')" style="color:#1f2937;border-color:#e5e7eb">المدفوعات/المساعدات</button>
        <button id="caseTabChangeLog" type="button" class="btn light case-details-tab" onclick="setCaseDetailsTab('changelog')" style="color:#1f2937;border-color:#e5e7eb">سجل التغييرات</button>
      </div>
      <div id="casePanelDetails" style="grid-column:1/-1">${detailsHtml}</div>
      <div id="casePanelPayments" class="hidden" style="grid-column:1/-1">${paymentsHtml}</div>
      ${logHtml}
    `;
    try { setCaseDetailsTab(AppState.caseDetailsTab || 'details'); } catch { }
  } else {
  const detailsFormHtml = `
    <div class="form-group"><label class="label">رقم الحالة</label><input id="d_caseNo" class="control" value="${it.caseNo ?? ''}" disabled></div>
    <div class="form-group"><label class="label">الرقم القومي</label><input id="d_id" class="control" value="${it.id}" disabled></div>
    <div class="form-group"><label class="label">تقييم الحالة</label><input id="d_caseGrade" class="control" value="${it.caseGrade || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">اسم رب الأسرة</label><input id="d_familyHead" class="control" value="${it.familyHead || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">الهاتف</label><input id="d_phone" class="control" value="${it.phone || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">الحالة الاجتماعية</label><input id="d_maritalStatus" class="control" value="${it.maritalStatus || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">رقم واتساب</label><input id="d_whatsapp" class="control" value="${it.whatsapp || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">العنوان</label><input id="d_address" class="control" value="${it.address || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">المحافظة</label><input id="d_governorate" class="control" value="${it.governorate || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">القرية</label><input id="d_area" class="control" value="${it.area || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">عدد الأفراد</label><input id="d_familyCount" type="number" class="control" value="${it.familyCount || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">الفئة</label><input id="d_category" class="control" value="${it.category || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">الاستعجال</label><input id="d_urgency" class="control" value="${it.urgency || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">عمل الأب</label><input id="d_fatherJob" class="control" value="${escapeHtml((jobs.father || '').toString())}" ${disAttr}></div>
    <div class="form-group"><label class="label">عمل الأم</label><input id="d_motherJob" class="control" value="${escapeHtml((jobs.mother || '').toString())}" ${disAttr}></div>
    <div class="form-group"><label class="label">إضافة اسم المستكشف</label><input id="d_explorerName" class="control" value="${it.explorerName || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">التاريخ</label><input id="d_date" type="date" class="control" value="${it.date || ''}" ${disAttr}></div>
    <div class="form-group"><label class="label">مبلغ منفذ</label><input id="d_deliveredAmount" type="number" class="control" value="${it.deliveredAmount || 200}" ${disAttr} style="max-width:200px"></div>
    <div class="form-group" style="grid-column:1/-1"><label class="label">وسوم</label><input id="d_tags" class="control" value="${Array.isArray(it.tags) ? it.tags.join(', ') : ''}" ${disAttr}></div>

    <div class="form-group" style="grid-column:1/-1">
      <label class="label">السكن</label>
      <div class="grid cols-3" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="form-group" style="grid-column:1/-1"><label class="label">وصف السكن</label><textarea id="d_housingDesc" class="control" rows="2" ${disAttr}>${housing.housingDesc || ''}</textarea></div>
        <div class="form-group"><label class="label">عدد الغرف</label>
          <select id="d_roomsCount" class="control" ${disAttr}>
            <option value="">اختر</option>
            <option value="1" ${String(housing.roomsCount ?? '') === '1' ? 'selected' : ''}>1</option>
            <option value="2" ${String(housing.roomsCount ?? '') === '2' ? 'selected' : ''}>2</option>
            <option value="3" ${String(housing.roomsCount ?? '') === '3' ? 'selected' : ''}>3</option>
            <option value="4" ${String(housing.roomsCount ?? '') === '4' ? 'selected' : ''}>4</option>
          </select>
        </div>
        <div class="form-group"><label class="label">الحمام</label><input id="d_bathroomType" class="control" value="${housing.bathroomType || ''}" ${disAttr}></div>
        <div class="form-group"><label class="label">المياه</label><input id="d_waterExists" class="control" value="${housing.waterExists || ''}" ${disAttr}></div>
        <div class="form-group"><label class="label">السقف</label><input id="d_roofExists" class="control" value="${housing.roofExists || ''}" ${disAttr}></div>
        <div class="form-group"><label class="label">نوع المنطقة</label><input id="d_areaType" class="control" value="${housing.areaType || ''}" ${disAttr}></div>
      </div>
    </div>

    <div class="form-group" style="grid-column:1/-1">
      <label class="label">الديون</label>
      <div class="grid cols-3" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="form-group"><label class="label">هل توجد ديون؟</label><input id="d_debtsEnabled" class="control compact" value="${debts.enabled ? 'نعم' : 'لا'}" ${disAttr} style="max-width:140px"></div>
        <div class="form-group"><label class="label">قيمة الدين</label><input id="d_debtAmount" type="number" class="control compact" value="${debts.amount ?? ''}" ${disAttr} style="max-width:140px"></div>
        <div class="form-group"><label class="label">صاحب الدين</label><input id="d_debtOwner" class="control" value="${debts.owner || ''}" ${disAttr}></div>
        <div class="form-group"><label class="label">حكم قضائي؟</label>
          <select id="d_hasCourtOrder" class="control" ${disAttr}>
            <option value="">اختر</option>
            <option value="لا يوجد" ${debts.hasCourtOrder === 'لا يوجد' ? 'selected' : ''}>لا يوجد</option>
            <option value="شيك" ${debts.hasCourtOrder === 'شيك' ? 'selected' : ''}>شيك</option>
            <option value="وصل امانه" ${debts.hasCourtOrder === 'وصل امانه' ? 'selected' : ''}>وصل امانه</option>
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1"><label class="label">سبب الدين</label><input id="d_debtReason" class="control compact" value="${debts.reason || ''}" ${disAttr} style="max-width:220px"></div>
      </div>
    </div>

    <div class="form-group" style="grid-column:1/-1">
      <label class="label">الدخل والمصروفات</label>
      <div class="grid cols-2" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px">
          <div class="form-group"><label class="label">إجمالي الدخل</label><input id="d_incomeTotal" type="number" class="control" value="${income.total ?? ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">ملاحظات</label><textarea id="d_incomeNotes" class="control" rows="2" ${disAttr}>${income.notes || ''}</textarea></div>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px">
          <div class="form-group"><label class="label">إجمالي المصروفات</label><input id="d_expensesTotal" type="number" class="control" value="${expenses.total ?? ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">ملاحظات</label><textarea id="d_expensesNotes" class="control" rows="2" ${disAttr}>${expenses.notes || ''}</textarea></div>
        </div>
      </div>
      <div class="form-group"><label class="label">صافي شهري</label><input id="d_netMonthly" type="number" class="control compact" value="${it.netMonthly ?? ''}" ${disAttr} style="max-width:160px"></div>
    </div>

    <div class="form-group" style="grid-column:1/-1">
      <label class="label">الزواج / المشاريع</label>
      <div class="grid cols-2" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px">
          <div class="form-group"><label class="label">يوجد حالة زواج؟</label><input id="d_marriageEnabled" class="control" value="${marriage.enabled ? 'نعم' : 'لا'}" ${disAttr}></div>
          <div class="form-group"><label class="label">اسم العروسة</label><input id="d_brideName" class="control" value="${marriage.brideName || ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">اسم العريس</label><input id="d_groomName" class="control" value="${marriage.groomName || ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">مهنة العريس</label><input id="d_groomJob" class="control" value="${marriage.groomJob || ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">تاريخ كتب الكتاب</label><input id="d_contractDate" class="control" value="${marriage.contractDate || ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">تاريخ الزواج</label><input id="d_weddingDate" class="control" value="${marriage.weddingDate || ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">المتوفر</label><input id="d_marriageAvailable" class="control" value="${marriage.available || ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">المطلوب</label><input id="d_marriageNeeded" class="control" value="${marriage.needed || ''}" ${disAttr}></div>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px">
          <div class="form-group"><label class="label">يوجد مشروع؟</label><input id="d_projectsEnabled" class="control" value="${project.enabled ? 'نعم' : 'لا'}" ${disAttr}></div>
          <div class="form-group"><label class="label">نوع المشروع</label><input id="d_projectType" class="control" value="${project.type || ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">الخبرة والاستعداد</label><input id="d_projectExperience" class="control" value="${project.experience || ''}" ${disAttr}></div>
          <div class="form-group"><label class="label">احتياجات المشروع</label><input id="d_projectNeeds" class="control" value="${project.needs || ''}" ${disAttr}></div>
        </div>
      </div>
    </div>

    <div class="form-group" style="grid-column:1/-1"><label class="label">أفراد الأسرة</label><textarea id="d_familyMembers" class="control" rows="4" ${disAttr}>${formatFamilyMembersPlain(it.familyMembers)}</textarea></div>
    <div class="form-group" style="grid-column:1/-1"><label class="label">احتياجاتهم (مختصر)</label><textarea id="d_needsShort" class="control" rows="2" ${disAttr}>${it.needsShort || ''}</textarea></div>
    <div class="form-group" style="grid-column:1/-1"><label class="label">احتياجات الأسرة</label><textarea id="d_familyNeeds" class="control" rows="3" ${disAttr}>${it.familyNeeds || ''}</textarea></div>
    <div class="form-group" style="grid-column:1/-1"><label class="label">تقرير الباحث</label><textarea id="d_researcherReport" class="control" rows="3" ${disAttr}>${it.researcherReport || ''}</textarea></div>

    <div class="form-group" style="grid-column:1/-1">
      <label class="label">الجانب الطبي</label>
      ${isAdmin ? '<div style="display:flex; gap:8px; justify-content:flex-start; margin-bottom:8px"><button type="button" class="btn" id="d_addMedicalRow">➕ إضافة حالة طبية</button></div>' : ''}
      <div style="overflow:auto; border:1px solid #e5e7eb; border-radius:12px">
        <table class="table" style="min-width:1000px">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>نوع المرض</th>
              <th>مصادر العلاج</th>
              <th>التخصص</th>
              <th>المستشفى</th>
              <th>المطلوب</th>
              <th>التكلفة التقديرية</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="d_medicalBody"></tbody>
        </table>
      </div>
    </div>
  `;

  const paymentsHtml = renderPaymentsTabHtml_(it);
  const logHtml = `<div id="casePanelChangeLog" class="hidden" style="grid-column:1/-1"><div style="color:#64748b">اختر تبويب السجل لعرض التغييرات.</div></div>`;
  body.innerHTML = `
    <div class="caseDetailsBodyBtnAdd case-details-tabs" style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-start;flex-wrap:wrap;margin-bottom:10px">
      <button id="caseTabDetails" type="button" class="btn case-details-tab" onclick="setCaseDetailsTab('details')">تفاصيل الحالة</button>
      <button id="caseTabPayments" type="button" class="btn light case-details-tab" onclick="setCaseDetailsTab('payments')" style="color:#1f2937;border-color:#e5e7eb">المدفوعات/المساعدات</button>
      <button id="caseTabChangeLog" type="button" class="btn light case-details-tab" onclick="setCaseDetailsTab('changelog')" style="color:#1f2937;border-color:#e5e7eb">سجل التغييرات</button>
    </div>
    <div id="casePanelDetails" class="grid cols-2" style="grid-column:1/-1">${detailsFormHtml}</div>
    <div id="casePanelPayments" class="hidden" style="grid-column:1/-1">${paymentsHtml}</div>
    ${logHtml}
  `;

  const existing = Array.isArray(it.medicalCases) ? it.medicalCases : [];
  if (existing.length) existing.forEach(r => addDetailsMedicalRow(r, disAttr));
  else if (isAdmin) addDetailsMedicalRow({}, disAttr);
  if (isAdmin) {
    const btn = document.getElementById('d_addMedicalRow');
    if (btn) btn.onclick = () => addDetailsMedicalRow({}, disAttr);
  }

  // detect unsaved changes
  try {
    const markDirty = () => { AppState.caseDetailsDirty = true; };
    Array.from(body.querySelectorAll('input, textarea, select')).forEach(el => {
      el.addEventListener('input', markDirty);
      el.addEventListener('change', markDirty);
    });
  } catch { }
  }
  try { AppState.caseDetailsTab = 'details'; } catch { }
  try { setCaseDetailsTab('details'); } catch { }
  try { body.scrollTop = 0; } catch { }
  try { syncCaseDetailsButtons(); } catch { }
  const pb = document.getElementById('printCaseBtn');
  if (pb) pb.style.display = 'inline-block';
  const m = document.getElementById('caseDetailsModal');
  if (!m) {
    alert('تعذر فتح التفاصيل: عنصر caseDetailsModal غير موجود في الصفحة');
    return;
  }
  try { document.body.classList.add('modal-open'); } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try {
    setTimeout(() => {
      try { AppState.caseDetailsTab = 'details'; } catch { }
      try { setCaseDetailsTab('details'); } catch { }
      try { body.scrollTop = 0; } catch { }
      try {
        const card = m.querySelector('.modal-card');
        if (card) card.scrollTop = 0;
      } catch { }
      try { syncCaseDetailsButtons(); } catch { }
    }, 0);
  } catch { }
}

function closeCaseDetails() {
  const m = document.getElementById('caseDetailsModal');
  if (!m) return;

  try {
    const ae = document.activeElement;
    if (ae && m.contains(ae) && typeof ae.blur === 'function') ae.blur();
  } catch { }

  const inEdit = (AppState.caseDetailsMode || 'view').toString() === 'edit';
  const dirty = !!AppState.caseDetailsDirty;
  if (inEdit && dirty) {
    const doSave = confirm('يوجد تغييرات غير محفوظة. هل تريد حفظ التغييرات قبل الخروج؟');
    if (doSave) {
      try { saveCaseEdits(); } catch { }
      return;
    }
    // discard changes and restore snapshot
    try {
      const id = AppState.currentCaseId;
      if (id && AppState.caseDetailsOriginal) {
        const idx = (AppState.cases || []).findIndex(c => c.id === id);
        if (idx >= 0) AppState.cases[idx] = JSON.parse(JSON.stringify(AppState.caseDetailsOriginal));
      }
      AppState.caseDetailsDirty = false;
      AppState.caseDetailsOriginal = null;
    } catch { }
  }

  m.classList.remove('show');
  m.setAttribute('aria-hidden', 'true');
  try { document.body.classList.remove('modal-open'); } catch { }
  try { AppState.caseDetailsMode = 'view'; } catch { }
  try { AppState.caseDetailsDirty = false; } catch { }
  try { AppState.caseDetailsOriginal = null; } catch { }
}

// Close case details on overlay click + ESC
try {
  const setupCaseDetailsModalClose = () => {
    const m = document.getElementById('caseDetailsModal');
    if (!m) return;
    if (m.getAttribute('data-close-wired') === '1') return;
    m.setAttribute('data-close-wired', '1');

    m.addEventListener('click', (e) => {
      const card = m.querySelector('.modal-card');
      if (card && card.contains(e.target)) return;
      closeCaseDetails();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modal = document.getElementById('caseDetailsModal');
      if (!modal || !modal.classList.contains('show')) return;
      closeCaseDetails();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupCaseDetailsModalClose);
  } else {
    setupCaseDetailsModalClose();
  }
} catch { }

async function rejectCurrentCase() {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const id = (AppState.currentCaseId || document.getElementById('d_id')?.value || '').toString().trim();
  if (!id) { alert('تعذر تحديد الحالة'); return; }
  const idx = (AppState.cases || []).findIndex(c => String(c?.id || '').trim() === id);
  if (idx < 0) { alert('الحالة غير موجودة'); return; }
  const current = AppState.cases[idx] || {};
  if (isRejectedCase_(current)) { alert('هذه الحالة مرفوضة بالفعل. الحذف متاح فقط بعد الرفض.'); return; }
  const title = (current.familyHead || current.id || id).toString();
  if (!confirm(`هل تريد رفض الحالة؟
${title}`)) return;

  let reason = '';
  try { reason = (prompt('سبب رفض الحالة (إجباري):') || '').toString().trim(); } catch { reason = ''; }
  if (!reason) { alert('سبب الرفض مطلوب'); return; }

  const uiState = captureCasesUiState_();
  const before = JSON.parse(JSON.stringify(current));
  const rejectedAt = new Date().toISOString();
  const rejectedByName = (AppState.currentUser?.name || AppState.currentUser?.username || '').toString().trim();
  const rejectedByUser = (AppState.currentUser?.username || '').toString().trim();
  const next = {
    ...current,
    caseGrade: 'حالة مرفوضة',
    status: 'مرفوضة',
    rejectionReason: reason,
    rejectedAt,
    rejectedByName,
    rejectedByUser
  };

  AppState.cases[idx] = next;
  refreshCaseViews_(id, { reopenDetails: true, preserveTab: true });

  try {
    const payload = JSON.stringify({
      reason,
      before: { caseGrade: before.caseGrade || '', status: before.status || '' },
      after: { caseGrade: next.caseGrade || '', status: next.status || '' },
      rejectedAt
    });
    await logAction('رفض حالة', id, `سبب: ${reason} | data:${payload}`);
  } catch { }

  try {
    if (DatabaseClient) await upsertCaseToDb(next);
  } catch (e) {
    AppState.cases[idx] = before;
    refreshCaseViews_(id, { reopenDetails: true, preserveTab: true });
    alert(`تعذر حفظ رفض الحالة في قاعدة البيانات.\n\nالخطأ: ${e?.message || 'خطأ غير معروف'}`);
    return;
  }

  await syncCasesAfterMutation_(id, { reopenDetails: true, preserveTab: true, uiState });
  try { sendUpdateCaseToSheets(next); } catch { }
  alert('تم رفض الحالة');
}

function deleteCurrentCase() {
  if (!hasPerm('cases_delete')) { alert('لا تملك صلاحية حذف الحالة'); return; }
  const id = AppState.currentCaseId || document.getElementById('d_id')?.value;
  if (!id) return;
  const it = AppState.cases.find(c => c.id === id);
  if (!isRejectedCase_(it)) { alert('الحذف النهائي متاح فقط للحالات المرفوضة.'); return; }
  const title = it ? (it.familyHead || it.id || '') : id;
  if (!confirm(`هل تريد حذف الحالة نهائياً؟\n${title}`)) return;

  let reason = '';
  try { reason = (prompt('سبب حذف الحالة (إجباري):') || '').toString().trim(); } catch { reason = ''; }
  if (!reason) { alert('سبب الحذف مطلوب'); return; }

  (async () => {
    const uiState = captureCasesUiState_();
    const beforeList = Array.isArray(AppState.cases) ? AppState.cases.slice() : [];
    const visibleListBeforeDelete = getFilteredCasesCached_().slice();
    const fallbackCaseId = getAdjacentVisibleCaseId_(id, visibleListBeforeDelete);
    const snapshot = it ? JSON.parse(JSON.stringify(it)) : null;
    AppState.cases = (AppState.cases || []).filter(c => c.id !== id);
    refreshCaseViews_('');

    try {
      const payload = JSON.stringify({ reason, case: snapshot, deletedAt: new Date().toISOString() });
      await logAction('حذف حالة', id, `سبب: ${reason} | data:${payload}`);
    } catch { }

    try {
      if (DatabaseClient) await deleteCaseFromDb(id);
    } catch (e) {
      AppState.cases = beforeList;
      refreshCaseViews_('');
      alert(`تعذر حذف الحالة من قاعدة البيانات.\n\nالخطأ: ${e?.message || 'خطأ غير معروف'}`);
      return;
    }

    await syncCasesAfterMutation_('', { uiState, fallbackCaseId, reopenDetails: !!fallbackCaseId, preserveTab: true });
    try { closeCaseDetails(); } catch { }
    alert('تم حذف الحالة');
  })();
}

function deleteAllCases() {
  if (!hasPerm('cases_delete_all')) { alert('لا تملك صلاحية حذف جميع الحالات'); return; }
  const count = Array.isArray(AppState.cases) ? AppState.cases.length : 0;
  if (!count) { alert('لا توجد حالات للحذف'); return; }
  if (!confirm(`هل تريد حذف جميع الحالات نهائياً؟\nعدد الحالات: ${count}`)) return;
  if (!confirm('تأكيد أخير: سيتم حذف كل الحالات ولن يمكن استرجاعها.')) return;

  (async () => {
    const uiState = captureCasesUiState_();
    const beforeList = Array.isArray(AppState.cases) ? AppState.cases.slice() : [];
    const snapshot = JSON.parse(JSON.stringify(beforeList || []));
    AppState.cases = [];
    refreshCaseViews_('');

    try {
      const payload = JSON.stringify({ count, cases: snapshot, deletedAt: new Date().toISOString() });
      await logAction('حذف جميع الحالات', '', `count:${count} | data:${payload}`);
    } catch { }

    try {
      if (DatabaseClient) await deleteAllCasesFromDb();
    } catch (e) {
      AppState.cases = beforeList;
      refreshCaseViews_('');
      alert(`تعذر حذف جميع الحالات من قاعدة البيانات.\n\nالخطأ: ${e?.message || 'خطأ غير معروف'}`);
      return;
    }

    await syncCasesAfterMutation_('', { uiState, reopenDetails: false, restoreScroll: true });
    try { closeCaseDetails(); } catch { }
    alert('تم حذف جميع الحالات');
  })();
}

function formatExtrasPlain(extras) {
  const arr = Array.isArray(extras) ? extras : [];
  return arr.map(x => {
    if (x == null) return '';
    if (typeof x === 'string') return x;
    if (typeof x !== 'object') return String(x);
    const name = (x.name ?? x.title ?? x.item ?? '').toString().trim();
    const amount = (x.amount ?? x.value ?? '').toString().trim();
    if (name && amount) return `${name}: ${amount}`;
    if (name) return name;
    if (amount) return amount;
    return '';
  }).filter(Boolean).join('\n');
}

function parseExtrasPlain(text) {
  const lines = (text || '').toString().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.map(line => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const name = parts.slice(0, -1).join(':').trim();
      const amountRaw = parts[parts.length - 1].trim();
      const amountNum = Number(amountRaw);
      const amount = isNaN(amountNum) ? amountRaw : amountNum;
      return { name, amount };
    }
    return { name: line, amount: '' };
  });
}

function formatFamilyMembersPlain(members) {
  const arr = Array.isArray(members) ? members : [];
  return arr.map(x => {
    if (!x || typeof x !== 'object') return '';
    const name = (x.name || '').toString().trim();
    const relation = (x.relation || '').toString().trim();
    const age = (x.age ?? '').toString().trim();
    const works = (x.works || '').toString().trim();
    const avgIncome = (x.avgIncome ?? '').toString().trim();
    const parts = [name, relation, age, works, avgIncome].filter(p => p !== '');
    return parts.join(' | ');
  }).filter(Boolean).join('\n');
}

function parseFamilyMembersPlain(text) {
  const lines = (text || '').toString().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.map(line => {
    const parts = line.split('|').map(s => s.trim());
    const [name, relation, ageRaw, works, avgIncomeRaw] = parts;
    const ageNum = Number(ageRaw);
    const avgIncomeNum = Number(avgIncomeRaw);
    return {
      name: (name || '').trim(),
      relation: (relation || '').trim(),
      age: (ageRaw == null || ageRaw === '') ? '' : (isNaN(ageNum) ? ageRaw : ageNum),
      works: (works || '').trim(),
      avgIncome: (avgIncomeRaw == null || avgIncomeRaw === '') ? '' : (isNaN(avgIncomeNum) ? avgIncomeRaw : avgIncomeNum)
    };
  }).filter(x => Object.values(x).some(v => String(v || '').trim() !== ''));
}

async function saveCaseEdits() {
  if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالات'); return; }
  const host = document.getElementById('caseDetailsBody');
  const q = (id) => (host ? host.querySelector(`#${id}`) : null);

  const normalizeDigits_ = (s) => {
    const raw = (s || '').toString();
    const digits = raw.replace(/[^0-9\u0660-\u0669\u06F0-\u06F9]/g, '');
    const latin = digits
      .replace(/[\u0660-\u0669]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[\u06F0-\u06F9]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    return latin;
  };

  const idCandidate = (AppState.currentCaseId || q('d_id')?.value || '').toString();
  const idNorm = normalizeDigits_(idCandidate);
  const idx = (AppState.cases || []).findIndex(c => normalizeDigits_(c?.id) === idNorm);
  if (idx < 0) { alert('تعذر العثور على الحالة'); return; }
  const old = AppState.cases[idx] || {};
  const it = old;
  const yn = (v) => {
    const s = (v || '').toString().trim();
    return (s === 'نعم' || s.toLowerCase() === 'yes' || s === 'true' || s === '1');
  };

  const medBody = q('d_medicalBody');
  const medRows = medBody ? Array.from(medBody.querySelectorAll('tr')) : [];
  const medicalCases = medRows.map(tr => {
    const get = (field) => (tr.querySelector(`[data-field="${field}"]`)?.value || '').trim();
    const row = {
      name: get('name'),
      diseaseType: (tr.querySelector('[data-field="diseaseType"]')?.value || '').trim(),
      treatmentSources: get('treatmentSources'),
      specialty: get('specialty'),
      hospital: get('hospital'),
      required: get('required'),
      estimatedCost: get('estimatedCost')
    };
    const hasAny = [row.name, row.diseaseType, row.treatmentSources, row.specialty, row.hospital, row.required, row.estimatedCost]
      .some(v => String(v || '').trim() !== '');
    if (!hasAny) return null;
    return row;
  }).filter(Boolean);
  const updated = {
    ...old,
    caseGrade: q('d_caseGrade')?.value?.trim() || '',
    familyHead: q('d_familyHead')?.value?.trim() || '',
    phone: q('d_phone')?.value?.trim() || '',
    maritalStatus: q('d_maritalStatus')?.value?.trim() || '',
    whatsapp: q('d_whatsapp')?.value?.trim() || '',
    address: q('d_address')?.value?.trim() || '',
    governorate: q('d_governorate')?.value?.trim() || '',
    area: q('d_area')?.value?.trim() || '',
    familyCount: Number(q('d_familyCount')?.value || 0) || 0,
    category: q('d_category')?.value?.trim() || '',
    urgency: q('d_urgency')?.value?.trim() || '',
    jobs: {
      father: q('d_fatherJob')?.value?.trim() || '',
      mother: q('d_motherJob')?.value?.trim() || ''
    },
    explorerName: q('d_explorerName')?.value?.trim() || '',
    date: q('d_date')?.value?.trim() || '',
    deliveredAmount: Number(q('d_deliveredAmount')?.value || 200) || 200,
    tags: (q('d_tags')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
    housing: {
      housingDesc: q('d_housingDesc')?.value?.trim() || '',
      roomsCount: Number(q('d_roomsCount')?.value || 0) || 0,
      bathroomType: q('d_bathroomType')?.value?.trim() || '',
      waterExists: q('d_waterExists')?.value?.trim() || '',
      roofExists: q('d_roofExists')?.value?.trim() || '',
      areaType: q('d_areaType')?.value?.trim() || ''
    },
    debts: {
      enabled: yn(q('d_debtsEnabled')?.value || ''),
      amount: Number(q('d_debtAmount')?.value || 0) || 0,
      owner: q('d_debtOwner')?.value?.trim() || '',
      hasCourtOrder: q('d_hasCourtOrder')?.value?.trim() || '',
      reason: q('d_debtReason')?.value?.trim() || ''
    },
    income: {
      notes: q('d_incomeNotes')?.value || '',
      total: Number(q('d_incomeTotal')?.value || 0) || 0
    },
    expenses: {
      notes: q('d_expensesNotes')?.value || '',
      total: Number(q('d_expensesTotal')?.value || 0) || 0
    },
    netMonthly: Number(q('d_netMonthly')?.value || 0) || 0,
    marriage: {
      enabled: yn(q('d_marriageEnabled')?.value || ''),
      brideName: q('d_brideName')?.value?.trim() || '',
      groomName: q('d_groomName')?.value?.trim() || '',
      groomJob: q('d_groomJob')?.value?.trim() || '',
      contractDate: q('d_contractDate')?.value?.trim() || '',
      weddingDate: q('d_weddingDate')?.value?.trim() || '',
      available: q('d_marriageAvailable')?.value?.trim() || '',
      needed: q('d_marriageNeeded')?.value?.trim() || ''
    },
    project: {
      enabled: yn(q('d_projectsEnabled')?.value || ''),
      type: q('d_projectType')?.value?.trim() || '',
      experience: q('d_projectExperience')?.value?.trim() || '',
      needs: q('d_projectNeeds')?.value?.trim() || ''
    },
    familyMembers: parseFamilyMembersPlain(q('d_familyMembers')?.value || ''),
    needsShort: q('d_needsShort')?.value || '',
    familyNeeds: q('d_familyNeeds')?.value || '',
    researcherReport: q('d_researcherReport')?.value || '',
    medicalCases
  };

  // build diff BEFORE mutating `it`
  let diffMsg = 'تم تعديل البيانات';
  try {
    const before = (AppState.caseDetailsOriginal && typeof AppState.caseDetailsOriginal === 'object') ? AppState.caseDetailsOriginal : old;
    const parts = buildCaseDiffText_(before, updated);
    if (Array.isArray(parts) && parts.length) diffMsg = parts.slice(0, 40).join(' | ');
  } catch { }

  Object.assign(it, updated);
  try { AppState.caseDetailsDirty = false; } catch { }
  try { AppState.caseDetailsMode = 'view'; } catch { }
  try { AppState.caseDetailsOriginal = null; } catch { }
  const uiState = captureCasesUiState_();
  try {
    if (DatabaseClient) await upsertCaseToDb(it);
  } catch (e) {
    alert(`تعذر حفظ التعديلات في قاعدة البيانات.\n\nالخطأ: ${e?.message || 'خطأ غير معروف'}`);
    return;
  }
  try { await logAction('تعديل حالة', it.id, diffMsg); } catch { try { await logAction('تعديل حالة', it.id, 'تم تعديل البيانات'); } catch { } }
  await syncCasesAfterMutation_(it.id, { reopenDetails: true, preserveTab: true, uiState });
  try { showToast_('تم حفظ التعديلات', 'success'); } catch { }
  alert('تم حفظ التعديلات');
}

function printCurrentCase() {
  const id = AppState.currentCaseId;
  const it = AppState.cases.find(c => c.id === id);
  if (!it) { alert('لا توجد حالة للطباعة'); return; }
  const w = window.open('', '_blank');
  if (!w) { alert('يرجى السماح بالنوافذ المنبثقة'); return; }
  const medRows = (Array.isArray(it.medicalCases) ? it.medicalCases : []).map(m => `
    <tr>
      <td>${m.name || ''}</td>
      <td>${m.diseaseType || ''}</td>
      <td>${m.treatmentSources || ''}</td>
      <td>${m.specialty || ''}</td>
      <td>${m.hospital || ''}</td>
      <td>${m.doctor || ''}</td>
      <td>${m.report || ''}</td>
      <td>${m.required || ''}</td>
      <td>${m.estimatedCost || ''}</td>
    </tr>`).join('');
  const housing = it.housing || {};
  const debts = it.debts || {};
  const income = it.income || {};
  const expenses = it.expenses || {};
  const marriage = it.marriage || {};
  const project = it.project || {};
  const jobs = (it.jobs && typeof it.jobs === 'object') ? it.jobs : {};
  w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طباعة حالة</title>
    <style>
      body{font-family:Tajawal,Arial,sans-serif;padding:16px;color:#111827}
      h2{margin:0 0 8px 0}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
      .box{border:1px solid #e5e7eb;border-radius:10px;padding:10px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th,td{border:1px solid #e5e7eb;padding:6px;text-align:right;font-size:12px;vertical-align:top}
      .muted{color:#6b7280;font-size:12px}
      .head{border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:10px 12px;margin:10px 0 12px 0}
      .head .title{font-weight:900;font-size:18px;color:#0f172a;margin-bottom:6px}
      @media print{.no-print{display:none}}
    </style>
  </head><body>
    <div class="no-print" style="margin-bottom:10px"><button onclick="window.print()">طباعة</button></div>
    <h2>نموذج حالة</h2>
    <div class="head">
      <div class="title">${escapeHtml(it.familyHead || '')}</div>
      <div class="muted">رقم الحالة: <strong>${escapeHtml(it.id || '')}</strong>${it.date ? ` — تاريخ: <strong>${escapeHtml(it.date)}</strong>` : ''}</div>
      <div class="muted">${it.governorate ? `المحافظة: <strong>${escapeHtml(it.governorate)}</strong>` : ''}${it.governorate && it.area ? ' — ' : ''}${it.area ? `القرية: <strong>${escapeHtml(it.area)}</strong>` : ''}</div>
    </div>
    <div class="grid" style="margin-top:10px">
      <div class="box"><div><strong>الاسم:</strong> ${it.familyHead || ''}</div><div><strong>الهاتف:</strong> ${it.phone || ''}</div><div><strong>العنوان:</strong> ${it.address || ''}</div></div>
      <div class="box"><div><strong>المحافظة:</strong> ${it.governorate || ''}</div><div><strong>القرية:</strong> ${it.area || ''}</div><div><strong>الفئة:</strong> ${it.category || ''}</div><div><strong>المستكشف:</strong> ${it.explorerName || ''}</div></div>
    </div>
    <div class="grid" style="margin-top:10px">
      <div class="box"><strong>بيانات إضافية</strong>
        <div style="margin-top:6px"><strong>تقييم الحالة:</strong> ${it.caseGrade || ''}</div>
        <div><strong>الحالة الاجتماعية:</strong> ${it.maritalStatus || ''}</div>
        <div><strong>واتساب:</strong> ${it.whatsapp || ''}</div>
        <div><strong>عمل الأب:</strong> ${(jobs.father || '').toString()}</div>
        <div><strong>عمل الأم:</strong> ${(jobs.mother || '').toString()}</div>
      </div>
      <div class="box"><strong>السكن</strong>
        <div style="margin-top:6px"><strong>وصف:</strong> ${housing.housingDesc || ''}</div>
        <div><strong>غرف:</strong> ${housing.roomsCount ?? ''}</div>
        <div><strong>حمام:</strong> ${housing.bathroomType || ''}</div>
        <div><strong>مياه:</strong> ${housing.waterExists || ''}</div>
        <div><strong>سقف:</strong> ${housing.roofExists || ''}</div>
        <div><strong>نوع المنطقة:</strong> ${housing.areaType || ''}</div>
      </div>
    </div>
    <div class="grid" style="margin-top:10px">
      <div class="box"><strong>المبالغ</strong><div style="margin-top:6px">منفذ: ${it.deliveredAmount || ''}</div></div>
      <div class="box"><strong>الوسوم</strong><div style="margin-top:6px">${Array.isArray(it.tags) ? it.tags.join(', ') : ''}</div></div>
    </div>
    <div class="grid" style="margin-top:10px">
      <div class="box"><strong>الديون</strong>
        <div style="margin-top:6px"><strong>توجد؟</strong> ${debts.enabled ? 'نعم' : 'لا'}</div>
        <div><strong>القيمة:</strong> ${debts.amount ?? ''}</div>
        <div><strong>المالك:</strong> ${debts.owner || ''}</div>
        <div><strong>حكم قضائي:</strong> ${debts.hasCourtOrder || ''}</div>
        <div><strong>السبب:</strong> ${debts.reason || ''}</div>
      </div>
      <div class="box"><strong>الدخل/المصروفات</strong>
        <div style="margin-top:6px"><strong>دخل:</strong> ${income.total ?? ''}</div>
        <div><strong>مصروفات:</strong> ${expenses.total ?? ''}</div>
        <div><strong>صافي:</strong> ${it.netMonthly ?? ''}</div>
      </div>
    </div>
    <div class="grid" style="margin-top:10px">
      <div class="box"><strong>الزواج</strong>
        <div style="margin-top:6px"><strong>يوجد؟</strong> ${marriage.enabled ? 'نعم' : 'لا'}</div>
        <div><strong>العروسة:</strong> ${marriage.brideName || ''}</div>
        <div><strong>العريس:</strong> ${marriage.groomName || ''}</div>
        <div><strong>مهنة العريس:</strong> ${marriage.groomJob || ''}</div>
      </div>
      <div class="box"><strong>المشاريع</strong>
        <div style="margin-top:6px"><strong>يوجد؟</strong> ${project.enabled ? 'نعم' : 'لا'}</div>
        <div><strong>النوع:</strong> ${project.type || ''}</div>
        <div><strong>الخبرة:</strong> ${project.experience || ''}</div>
        <div><strong>الاحتياجات:</strong> ${project.needs || ''}</div>
      </div>
    </div>
    <div class="box" style="margin-top:10px"><strong>احتياجات الأسرة</strong><div style="margin-top:6px">${(it.familyNeeds || '').toString()}</div></div>
    <div class="box" style="margin-top:10px"><strong>تقرير الباحث</strong><div style="margin-top:6px">${(it.researcherReport || '').toString()}</div></div>
    <div class="box" style="margin-top:10px"><strong>الحالات الطبية</strong>
      <table><thead><tr><th>الاسم</th><th>نوع المرض</th><th>مصادر العلاج</th><th>التخصص</th><th>المستشفى</th><th>الطبيب</th><th>التقرير</th><th>المطلوب</th><th>التكلفة</th></tr></thead><tbody>
        ${medRows || '<tr><td colspan="9" style="text-align:center">لا يوجد</td></tr>'}
      </tbody></table>
    </div>
  </body></html>`);
  w.document.close();
  w.focus();
  logAction('طباعة حالة', it.id, 'تم فتح صفحة الطباعة');
}

async function listProfiles_() {
  if (!DatabaseClient) return [];
  const { data, error } = await DatabaseClient.rpc('list_profiles_public', {});
  if (error) return [];
  return (data || []).map((row) => normalizeProfileRecord_(row)).filter((p) => {
    try {
      const perms = p?.permissions && typeof p.permissions === 'object' ? p.permissions : {};
      const r = (perms.__role || '').toString().trim();
      return r !== 'hidden_super_admin';
    } catch { return true; }
  });
}

function getPermPreset_(kind) {
  const on = (keys) => {
    const o = {};
    (keys || []).forEach(k => { o[k] = true; });
    return o;
  };
  if (kind === 'explorer') {
    return { ...on(['cases_create', 'cases_read', 'settings']), __role: 'explorer' };
  }
  if (kind === 'manager') {
    return { ...on(['cases_read', 'cases_create', 'cases_edit', 'case_status_change', 'cases_delete', 'dashboard', 'settings']), __role: 'manager' };
  }
  if (kind === 'super_admin') {
    const all = { ...getAllPermissionsOn_(), __role: 'super_admin' };
    try { all.reports = false; } catch { }
    return all;
  }
  if (kind === 'doctor') {
    return { ...on(['medical_committee', 'settings']), __role: 'doctor' };
  }
  if (kind === 'medical_committee') {
    return { ...on(['medical_committee']), __role: 'medical_committee' };
  }
  if (kind === 'hidden_super_admin') {
    return { ...getAllPermissionsOn_(), __role: 'hidden_super_admin' };
  }
  return {};
}

function setAllPermsUi_(checked) {
  const host = document.getElementById('userMgmtPermissions');
  if (!host) return;
  Array.from(host.querySelectorAll('input.perm-box')).forEach(b => { b.checked = !!checked; });
  try { void saveUserMgmtForm_(true); } catch { }
}

function applyPermPreset_(kind) {
  const preset = getPermPreset_(kind);
  const host = document.getElementById('userMgmtPermissions');
  if (!host) return;
  Array.from(host.querySelectorAll('input.perm-box')).forEach(b => {
    const k = b.getAttribute('data-perm');
    if (!k) return;
    b.checked = !!preset[k];
  });
  try { void saveUserMgmtForm_(true); } catch { }
}

async function saveMySettings() {
  if (!DatabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  if (!AppState.currentUser?.id) { alert('لم يتم تسجيل الدخول'); return; }
  const hint = document.getElementById('mySettingsHint');
  const btn = document.querySelector('#settingsSection button[onclick="saveMySettings()"]');
  let ok = false;

  try {
    try {
      if (btn) btn.setAttribute('disabled', 'disabled');
      if (hint) { hint.style.display = 'block'; hint.textContent = 'جارٍ الحفظ...'; }
    } catch { }

    const oldPass = (document.getElementById('myOldPassword')?.value || '').toString();
    const newPass = (document.getElementById('myNewPassword')?.value || '').toString();

    if (!oldPass.trim()) {
      if (hint) { hint.style.display = 'block'; hint.textContent = 'أدخل كلمة المرور القديمة'; }
      else alert('أدخل كلمة المرور القديمة');
      return;
    }
    if (!newPass.trim()) {
      if (hint) { hint.style.display = 'block'; hint.textContent = 'أدخل كلمة المرور الجديدة'; }
      else alert('أدخل كلمة المرور الجديدة');
      return;
    }

    const passwordPolicyError = validatePasswordPolicy_(newPass.trim());
    if (passwordPolicyError) {
      if (hint) { hint.style.display = 'block'; hint.textContent = passwordPolicyError; }
      else alert(passwordPolicyError);
      return;
    }

    if (oldPass.trim() === newPass.trim()) {
      if (hint) { hint.style.display = 'block'; hint.textContent = 'كلمة المرور الجديدة يجب أن تكون مختلفة عن القديمة'; }
      else alert('كلمة المرور الجديدة يجب أن تكون مختلفة عن القديمة');
      return;
    }

    let email = (AppState.currentUser?.email || '').toString().trim();
    if (!email) {
      try {
        const u = await DatabaseClient.auth.getUser();
        email = (u?.data?.user?.email || '').toString().trim();
      } catch { }
    }
    if (!email) {
      if (hint) { hint.style.display = 'block'; hint.textContent = 'تعذر تحديد البريد الإلكتروني للمستخدم'; }
      else alert('تعذر تحديد البريد الإلكتروني للمستخدم');
      return;
    }

    try {
      const reauth = await DatabaseClient.auth.signInWithPassword({ email, password: oldPass });
      if (reauth?.error) throw reauth.error;
      try { AppState._lastValidatedPassword = oldPass; } catch { }
    } catch (e) {
      try { console.error('reauth error:', e); } catch { }
      const msg = (e?.message || e?.error_description || '').toString().trim();
      if (hint) { hint.style.display = 'block'; hint.textContent = msg ? `تعذر التحقق من كلمة المرور القديمة: ${msg}` : 'كلمة المرور القديمة غير صحيحة'; }
      else alert(msg ? `تعذر التحقق من كلمة المرور القديمة: ${msg}` : 'كلمة المرور القديمة غير صحيحة');
      return;
    }

    try {
      const res = await DatabaseClient.auth.updateUser({ password: newPass, passwordConfirm: newPass, oldPassword: oldPass });
      if (res?.error) throw res.error;
      try { document.getElementById('myOldPassword').value = ''; } catch { }
      try { document.getElementById('myNewPassword').value = ''; } catch { }
      ok = true;
    } catch (e) {
      try { console.error('updateUser error:', e); } catch { }
      const msg = (e?.message || e?.error_description || '').toString().trim();
      if (hint) { hint.style.display = 'block'; hint.textContent = msg ? `تعذر تغيير كلمة المرور: ${msg}` : 'تعذر تغيير كلمة المرور'; }
      else alert(msg ? `تعذر تغيير كلمة المرور: ${msg}` : 'تعذر تغيير كلمة المرور');
      return;
    }

    if (hint) { hint.style.display = 'block'; hint.textContent = 'تم تغيير كلمة المرور. جارٍ إعادة تحميل الصفحة...'; }
    else alert('تم تغيير كلمة المرور');

    // Ensure the UI paints the final message even if other async handlers run.
    try {
      await new Promise(r => requestAnimationFrame(() => r()));
      await new Promise(r => setTimeout(r, 0));
    } catch { }
    setTimeout(() => { location.reload(); }, 1500);
  } catch (e) {
    try { console.error('saveMySettings unexpected error:', e); } catch { }
    const msg = (e?.message || e?.error_description || '').toString().trim();
    if (hint) { hint.style.display = 'block'; hint.textContent = msg ? `حدث خطأ غير متوقع: ${msg}` : 'حدث خطأ غير متوقع'; }
    else alert(msg ? `حدث خطأ غير متوقع: ${msg}` : 'حدث خطأ غير متوقع');
  } finally {
    try { delete AppState._lastValidatedPassword; } catch { }
    try { if (btn) btn.removeAttribute('disabled'); } catch { }
    try {
      if (ok && hint && (hint.textContent || '').toString().trim() === 'جارٍ الحفظ...') {
        hint.style.display = 'block';
        hint.textContent = 'تم تغيير كلمة المرور';
      }
    } catch { }
  }
}

function syncSettingsPermissionsUi_() {
  const canManage = hasPerm('users_manage');
  const userHint = document.getElementById('userMgmtReadonlyHint');
  const bulk = document.getElementById('permBulkActions');
  const preset = document.getElementById('permPresetActions');
  const actions = document.querySelector('#userManagementSection .settings-actions');
  const resetBtn = document.getElementById('resetPasswordLinkBtn');
  const inputs = ['userMgmtUsername', 'userMgmtName', 'userMgmtIsActive'];

  if (!canManage) {
    if (userHint) {
      userHint.style.display = 'block';
      userHint.textContent = 'يمكنك مشاهدة المستخدمين فقط. لتعديل المستخدمين تحتاج صلاحية إدارة المستخدمين.';
    }
    if (bulk) bulk.style.display = 'none';
    if (preset) preset.style.display = 'none';
    if (actions) actions.style.display = 'none';
    if (resetBtn) resetBtn.style.display = 'none';
    inputs.forEach(id => { const el = document.getElementById(id); if (el) el.setAttribute('disabled', 'disabled'); });
    try {
      const host = document.getElementById('userMgmtPermissions');
      Array.from(host?.querySelectorAll('input.perm-box') || []).forEach(b => b.setAttribute('disabled', 'disabled'));
    } catch { }
    return;
  }
  if (userHint) userHint.style.display = 'none';
  if (bulk) bulk.style.display = '';
  if (preset) preset.style.display = '';
  if (actions) actions.style.display = '';
  if (resetBtn) resetBtn.style.display = '';
  inputs.forEach(id => { const el = document.getElementById(id); if (el) el.removeAttribute('disabled'); });
  try {
    const host = document.getElementById('userMgmtPermissions');
    Array.from(host?.querySelectorAll('input.perm-box') || []).forEach(b => b.removeAttribute('disabled'));
  } catch { }

  try {
    const uname = (document.getElementById('userMgmtUsername')?.value || '').toString().trim();
    if (resetBtn) resetBtn.disabled = !uname;
  } catch { }
}

// settings: keep reset password link button enabled only when a username is selected
try {
  const wireResetPasswordBtnState_ = () => {
    const unameEl = document.getElementById('userMgmtUsername');
    const resetBtn = document.getElementById('resetPasswordLinkBtn');
    if (!unameEl || !resetBtn) return;
    if (unameEl.getAttribute('data-wired-reset') === '1') return;
    unameEl.setAttribute('data-wired-reset', '1');
    const sync = () => { try { syncSettingsPermissionsUi_(); } catch { } };
    unameEl.addEventListener('input', sync);
    unameEl.addEventListener('change', sync);
    sync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireResetPasswordBtnState_);
  else wireResetPasswordBtnState_();
} catch { }

async function renderUsersList() {
  const host = document.getElementById('usersList');
  if (!host) return;
  if (!DatabaseClient) { host.textContent = 'تعذر الاتصال بقاعدة البيانات'; return; }
  if (!(hasPerm('users_manage') || hasPerm('settings'))) { host.textContent = 'لا تملك صلاحية عرض المستخدمين'; return; }
  try {
    const list = await listProfiles_();
    if (!list.length) { host.textContent = 'لا يوجد مستخدمون'; return; }
    host.innerHTML = list.map(p => {
      const uname = (p.username || '').toString();
      const safe = uname.replace(/"/g, '');
      const active = (p.is_active !== false);
      const name = (p.full_name || '').toString();
      const lastSeenRaw = (p.last_seen_at || '').toString();
      const lastSeen = lastSeenRaw ? lastSeenRaw.replace('T', ' ').replace('Z', '') : '';
      const badge = active ? '<span class="pill ok">مفعل</span>' : '<span class="pill off">معطل</span>';
      return `<div class="user-item" role="button" tabindex="0" aria-label="Open user ${escapeHtml(uname || p.id)}" onclick="openUserActionsModal('${escapeHtml(safe)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openUserActionsModal('${escapeHtml(safe)}')}">
        <div>
          <div class="title">${escapeHtml(uname || p.id)}</div>
          <div class="meta">${escapeHtml(name || '')}${lastSeen ? ` — آخر ظهور: ${escapeHtml(lastSeen)}` : ''}</div>
        </div>
        <div class="user-item-actions">
          ${badge}
        </div>
      </div>`;
    }).join('') || '<div style="color:#64748b;text-align:center;padding:10px">لا يوجد مستخدمون</div>';
    try { syncSettingsPermissionsUi_(); } catch { }
  } catch {
    host.textContent = 'تعذر تحميل المستخدمين';
  }
}

function openUserActionsModal(usernameKey) {
  try {
    const uname = (usernameKey || '').toString().trim();
    if (!uname) return;
    const m = document.getElementById('userActionsModal');
    if (!m) return;
    m.setAttribute('data-username', uname);
    const hint = document.getElementById('userActionsHint');
    if (hint) { hint.style.display = 'none'; hint.textContent = ''; }

    const eEl = document.getElementById('userActionsEmail');
    const uEl = document.getElementById('userActionsUsername');
    const nEl = document.getElementById('userActionsName');
    if (eEl) eEl.value = '';
    if (uEl) uEl.value = uname;
    if (nEl) nEl.value = '';
    const st = document.getElementById('userActionsStatus');
    if (st) st.textContent = 'جارٍ التحميل...';

    try { if (eEl) eEl.value = ''; } catch { }

    void (async () => {
      try {
        let data = null;
        let error = null;
        try {
          const q1 = await DatabaseClient.from('users').select('id,username,full_name,is_active').eq('username', uname).maybeSingle();
          data = q1.data; error = q1.error;
        } catch (e1) {
          error = e1;
        }
        if (error) {
          try {
            const q2 = await DatabaseClient.from('users').select('id,username,full_name,is_active').eq('username', uname).maybeSingle();
            data = q2.data;
            error = q2.error;
          } catch (e2) {
            error = e2;
          }
        }
        if (error) throw error;
        if (nEl) nEl.value = (data?.full_name || '').toString();
        try {
          const email = (data?.email || '').toString().trim();
          const fall = (uname || '').toString().trim();
          const finalEmail = email || (fall.includes('@') ? fall : '');
          if (eEl) eEl.value = finalEmail;
        } catch { }
        const active = (data?.is_active !== false);
        if (st) st.textContent = active ? 'مفعل' : 'معطل';
        const tbtn = document.getElementById('userActionsToggleBtn');
        if (tbtn) {
          tbtn.textContent = active ? 'تعطيل المستخدم' : 'تفعيل المستخدم';
          tbtn.style.background = active ? '#ef4444' : '#22c55e';
        }
      } catch (e) {
        try { console.error('openUserActionsModal load error:', e); } catch { }
        if (st) st.textContent = 'تعذر التحميل';
      }
    })();

    try { document.body.classList.add('modal-open'); } catch { }
    m.classList.add('show');
    m.setAttribute('aria-hidden', 'false');
    try { document.getElementById('userActionsToggleBtn')?.focus?.(); } catch { }
  } catch { }
}

function closeUserActionsModal() {
  const m = document.getElementById('userActionsModal');
  if (!m) return;
  try {
    const ae = document.activeElement;
    if (ae && m.contains(ae) && typeof ae.blur === 'function') ae.blur();
  } catch { }
  m.classList.remove('show');
  m.setAttribute('aria-hidden', 'true');
  try { document.body.classList.remove('modal-open'); } catch { }
  try {
    const fallback = document.getElementById('usersList') || document.getElementById('userMgmtUsername') || document.getElementById('navSettingsBtn');
    fallback?.focus?.();
  } catch { }
}

async function userActionsToggleActive_() {
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  const m = document.getElementById('userActionsModal');
  if (!m) return;
  const uname = (m.getAttribute('data-username') || '').toString().trim();
  if (!uname) return;
  try {
    const { data, error } = await DatabaseClient.from('users').select('id,is_active').eq('username', uname).maybeSingle();
    if (error) throw error;
    const current = (data?.is_active !== false);
    await setUserActiveQuick_(data.id, !current);
    try { await renderUsersList(); } catch { }
    closeUserActionsModal();
  } catch (e) {
    try { console.error('userActionsToggleActive_ error:', e); } catch { }
    const hint = document.getElementById('userActionsHint');
    if (hint) { hint.style.display = 'block'; hint.textContent = 'تعذر تغيير حالة المستخدم'; }
  }
}

async function userActionsEditPermissions_() {
  const m = document.getElementById('userActionsModal');
  if (!m) return;
  const uname = (m.getAttribute('data-username') || '').toString().trim();
  if (!uname) return;
  try { await openUserPermissionsModal_(uname); } catch { }
}

function setAllPermsModalUi_(checked) {
  const host = document.getElementById('userPermPermissions');
  if (!host) return;
  Array.from(host.querySelectorAll('input.perm-box')).forEach(b => { b.checked = !!checked; });
}

function applyPermPresetModal_(kind) {
  const preset = getPermPreset_(kind);
  const host = document.getElementById('userPermPermissions');
  if (!host) return;
  try {
    const m = document.getElementById('userPermissionsModal');
    if (m) m.setAttribute('data-role', (kind || '').toString());
  } catch { }
  Array.from(host.querySelectorAll('input.perm-box')).forEach(b => {
    const k = (b.getAttribute('data-perm') || '').toString();
    if (!k) return;
    b.checked = !!preset[k];
  });
}

function closeUserPermissionsModal() {
  const m = document.getElementById('userPermissionsModal');
  if (!m) return;
  try {
    const ae = document.activeElement;
    if (ae && m.contains(ae) && typeof ae.blur === 'function') ae.blur();
  } catch { }
  m.classList.remove('show');
  m.setAttribute('aria-hidden', 'true');
  try { document.body.classList.remove('modal-open'); } catch { }
}

function buildUserPermsModalUi_(selected) {
  const host = document.getElementById('userPermPermissions');
  if (!host) return;
  const perms = selected && typeof selected === 'object' ? selected : {};
  const rendered = new Set();
  const mkItem = (k) => {
    rendered.add(k);
    const checked = perms[k] ? 'checked' : '';
    return `<label class="perm-item"><input type="checkbox" class="perm-box" data-perm="${escapeHtml(k)}" ${checked}> <span>${escapeHtml(permissionLabel_(k))}</span></label>`;
  };
  const groupsHtml = (PERMISSION_GROUPS || []).map(g => {
    const items = (g.items || []).filter(k => (PERMISSIONS || []).includes(k));
    if (!items.length) return '';
    const inner = items.map(mkItem).join('');
    return `<details class="perm-group" open>
      <summary class="perm-group-title">${escapeHtml(g.title || '')}</summary>
      <div class="perm-group-grid">${inner}</div>
    </details>`;
  }).join('');
  const others = (PERMISSIONS || []).filter(k => !rendered.has(k));
  const othersHtml = others.length ? `<details class="perm-group" open>
      <summary class="perm-group-title">أخرى</summary>
      <div class="perm-group-grid">${others.map(mkItem).join('')}</div>
    </details>` : '';
  host.innerHTML = groupsHtml + othersHtml;
}

async function openUserPermissionsModal_(uname) {
  if (!DatabaseClient) return;
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  const m = document.getElementById('userPermissionsModal');
  if (!m) return;
  m.setAttribute('data-username', (uname || '').toString().trim());
  const meta = document.getElementById('userPermMeta');
  const hint = document.getElementById('userPermHint');
  const btn = document.getElementById('userPermSaveBtn');
  if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
  if (meta) meta.textContent = 'جارٍ التحميل...';
  try { if (btn) btn.setAttribute('disabled', 'disabled'); } catch { }
  try { buildUserPermsModalUi_({}); } catch { }

  try {
    const { data, error } = await DatabaseClient.from('users').select('id,username,permissions').eq('username', uname).maybeSingle();
    if (error) throw error;
    const p = data?.permissions && typeof data.permissions === 'object' ? data.permissions : {};
    try {
      const r = (p.__role || '').toString().trim();
      if (r) m.setAttribute('data-role', r);
      else m.removeAttribute('data-role');
    } catch { }
    if (meta) meta.textContent = `المستخدم: ${uname}`;
    try { buildUserPermsModalUi_(p); } catch { }
  } catch (e) {
    try { console.error('openUserPermissionsModal_ error:', e); } catch { }
    if (meta) meta.textContent = `المستخدم: ${uname}`;
    if (hint) { hint.style.display = 'block'; hint.textContent = 'تعذر تحميل الصلاحيات'; }
  } finally {
    try { delete AppState._lastValidatedPassword; } catch { }
    try { if (btn) btn.removeAttribute('disabled'); } catch { }
  }

  closeUserActionsModal();
  try { document.body.classList.add('modal-open'); } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try { document.getElementById('userPermSaveBtn')?.focus?.(); } catch { }
}

async function saveUserPermissions_() {
  if (!DatabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  const m = document.getElementById('userPermissionsModal');
  if (!m) return;
  const uname = (m.getAttribute('data-username') || '').toString().trim();
  if (!uname) return;
  const hint = document.getElementById('userPermHint');
  const btn = document.getElementById('userPermSaveBtn');
  if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
  try { if (btn) btn.setAttribute('disabled', 'disabled'); } catch { }

  try {
    const host = document.getElementById('userPermPermissions');
    const permissions = {};
    Array.from(host?.querySelectorAll('input.perm-box') || []).forEach(b => {
      const k = (b.getAttribute('data-perm') || '').toString();
      if (!k) return;
      permissions[k] = !!b.checked;
    });

    try {
      const r = (m.getAttribute('data-role') || '').toString().trim();
      if (r) permissions.__role = r;
    } catch { }

    const { error } = await DatabaseClient.rpc('admin_update_profile', {
      p_username: uname,
      p_permissions: permissions
    });
    if (error) throw error;
    try { await logAction('تحديث صلاحيات مستخدم', '', `target: ${uname}`); } catch { }
    try { await renderUsersList(); } catch { }
    closeUserPermissionsModal();
    try { showToast_('تم حفظ الصلاحيات', 'success'); } catch { }
  } catch (e) {
    try { console.error('saveUserPermissions_ error:', e); } catch { }
    if (hint) { hint.style.display = 'block'; hint.textContent = 'تعذر حفظ الصلاحيات'; }
  } finally {
    try { delete AppState._lastValidatedPassword; } catch { }
    try { if (btn) btn.removeAttribute('disabled'); } catch { }
  }
}

async function userActionsDelete_() {
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  if (!DatabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  const m = document.getElementById('userActionsModal');
  if (!m) return;
  const uname = (m.getAttribute('data-username') || '').toString().trim();
  if (!uname) return;
  const ok = confirm(`حذف المستخدم نهائياً من النظام: ${uname} ؟

ملاحظة: سيُحذف ملفه من Supabase وفق الصلاحيات والقواعد الخادمية.`);
  if (!ok) return;
  const hint = document.getElementById('userActionsHint');
  if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
  try {
    const { error } = await DatabaseClient.rpc('admin_delete_profile', {
      p_username: uname
    });
    if (error) throw error;
    try { await logAction('حذف مستخدم', '', `username: ${uname}`); } catch { }
    try { await renderUsersList(); } catch { }
    closeUserActionsModal();
    try { showToast_('تم حذف المستخدم', 'success'); } catch { }
  } catch (e) {
    try { console.error('userActionsDelete_ error:', e); } catch { }
    if (hint) { hint.style.display = 'block'; hint.textContent = 'تعذر حذف المستخدم'; }
  }
}

async function userActionsResetPasswordLink_() {
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  const m = document.getElementById('userActionsModal');
  if (!m) return;
  const uname = (m.getAttribute('data-username') || '').toString().trim();
  if (!uname) return;
  try {
    document.getElementById('userMgmtUsername').value = uname;
  } catch { }
  try { await generateResetPasswordLinkForSelectedUser(); } catch { }
}

async function prefillUser(usernameKey) {
  if (!DatabaseClient) return;
  if (!(hasPerm('users_manage') || hasPerm('settings'))) { alert('لا تملك صلاحية عرض المستخدمين'); return; }
  const uname = (usernameKey || '').toString().trim();
  if (!uname) return;
  const { data, error } = await DatabaseClient.from('users').select('*').eq('username', uname).maybeSingle();
  if (error) { alert('تعذر تحميل المستخدم'); return; }
  const p = data;
  if (!p) { alert('المستخدم غير موجود'); return; }
  document.getElementById('userMgmtUsername').value = p.username || '';
  document.getElementById('userMgmtName').value = p.full_name || '';
  const act = document.getElementById('userMgmtIsActive');
  if (act) act.checked = (p.is_active !== false);
  try {
    const perms = p.permissions || {};
    const role = getUserRoleFromPermissions_(perms);
    const roleSel = document.getElementById('userMgmtRole');
    if (roleSel) roleSel.value = role || 'custom';
    buildUserPermissionsUi_(getEffectivePermissions_(perms));
    try { syncUserMgmtRoleLockUi_(); } catch { }
  } catch { }
  try { syncSettingsPermissionsUi_(); } catch { }
}

function syncUserMgmtRoleLockUi_() {
  const role = (document.getElementById('userMgmtRole')?.value || 'custom').toString();
  const host = document.getElementById('userMgmtPermissions');
  if (!host) return;
  const boxes = Array.from(host.querySelectorAll('input.perm-box'));
  if (role && role !== 'custom') {
    const preset = getRolePresetPermissions_(role);
    boxes.forEach(b => {
      const k = (b.getAttribute('data-perm') || '').toString();
      if (!k) return;
      b.checked = !!preset[k];
      b.disabled = true;
    });
  } else {
    boxes.forEach(b => { b.disabled = false; });
  }
}

function onUserMgmtRoleChange_() {
  try { syncUserMgmtRoleLockUi_(); } catch { }
  try { void saveUserMgmtForm_(true); } catch { }
}

async function addOrUpdateUser() {
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  if (!DatabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  const uname = (document.getElementById('userMgmtUsername').value || '').trim();
  const name = (document.getElementById('userMgmtName').value || '').trim();
  if (!uname) { alert('اسم المستخدم مطلوب'); return; }

  const isActive = !!document.getElementById('userMgmtIsActive')?.checked;
  const role = (document.getElementById('userMgmtRole')?.value || 'custom').toString().trim() || 'custom';
  const { data: existing, error: exErr } = await DatabaseClient
    .from('users')
    .select('id,full_name,is_active,permissions')
    .eq('username', uname)
    .maybeSingle();
  if (exErr || !existing?.id) { alert('المستخدم غير موجود'); return; }

  let permissions = (existing.permissions && typeof existing.permissions === 'object') ? existing.permissions : {};
  try {
    const host = document.getElementById('userMgmtPermissions');
    const uiVisible = !!(host && host.offsetParent !== null);
    if (uiVisible) {
      permissions = readUserPermissionsUi_();
      try { permissions.__role = role; } catch { }
      if (role && role !== 'custom') {
        permissions = { ...getRolePresetPermissions_(role), ...permissions, __role: role };
      }
    }
  } catch { }

  const before = {
    full_name: (existing.full_name || '').toString(),
    is_active: (existing.is_active !== false),
    permissions: (existing.permissions && typeof existing.permissions === 'object') ? existing.permissions : {}
  };

  const { error } = await DatabaseClient.rpc('admin_update_profile', {
    p_username: uname,
    p_full_name: name,
    p_permissions: permissions,
    p_is_active: isActive
  });
  if (error) { alert('تعذر حفظ المستخدم'); return; }
  try {
    const afterPerms = permissions && typeof permissions === 'object' ? permissions : {};
    const beforePerms = before.permissions || {};
    const beforeRole = getUserRoleFromPermissions_(beforePerms);
    const afterRole = getUserRoleFromPermissions_(afterPerms);
    const allKeys = new Set([...(Object.keys(beforePerms)), ...(Object.keys(afterPerms))]);
    const added = [];
    const removed = [];
    allKeys.forEach(k => {
      const b = !!beforePerms[k];
      const a = !!afterPerms[k];
      if (a && !b) added.push(k);
      if (!a && b) removed.push(k);
    });
    const parts = [];
    if (before.full_name !== name) parts.push(`الاسم: "${before.full_name}" → "${name}"`);
    if (before.is_active !== isActive) parts.push(`الحالة: ${before.is_active ? 'مفعل' : 'معطل'} → ${isActive ? 'مفعل' : 'معطل'}`);
    if (beforeRole !== afterRole) parts.push(`الدور: ${beforeRole} → ${afterRole}`);
    if (added.length) parts.push(`صلاحيات مضافة: ${added.join(', ')}`);
    if (removed.length) parts.push(`صلاحيات محذوفة: ${removed.join(', ')}`);
    await logAction('تحديث صلاحيات/مستخدم', '', `target: ${uname} | ${parts.join(' | ')}`);
  } catch { }
  try { await renderUsersList(); } catch { }
  alert('تم حفظ المستخدم');
}

try {
  const roleSel = document.getElementById('userMgmtRole');
  if (roleSel && !roleSel.getAttribute('data-wired')) {
    roleSel.setAttribute('data-wired', '1');
    roleSel.addEventListener('change', onUserMgmtRoleChange_);
  }
} catch { }

async function generateResetPasswordLinkForSelectedUser() {
  if (!DatabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  const uname = (document.getElementById('userMgmtUsername')?.value || '').trim();
  if (!uname) { alert('اختر مستخدم أولاً'); return; }
  try {
    const { data: existing, error: exErr } = await DatabaseClient.from('users').select('id,username,email').eq('username', uname).maybeSingle();
    if (exErr || !existing?.id) throw (exErr || new Error('not found'));
    const email = (existing.email || '').toString().trim();
    if (!email) throw new Error('missing_email');
    const res = await invokeAuthedEdgeFunction_('reset-password-link', {
      body: { email }
    });
    if (res?.error) throw res.error;
    const actionLink = (res?.data?.action_link || '').toString().trim();
    try { await logAction('تعيين كلمة مرور مؤقتة', '', `target: ${uname}`); } catch { }
    if (actionLink) {
      prompt('تم إنشاء رابط إعادة تعيين كلمة المرور. انسخه وأرسله للمستخدم:', actionLink);
    } else {
      alert('تم إرسال/إنشاء رابط إعادة تعيين كلمة المرور بنجاح.');
    }
  } catch (e) {
    try { console.error(e); } catch { }
    const msg = await describeEdgeFunctionError_(e);
    alert(`تعذر إنشاء رابط إعادة التعيين.

${msg || 'خطأ غير معروف'}`);
  }
}

async function deleteUser() {
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  if (!DatabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  const uname = (document.getElementById('userMgmtUsername').value || '').trim();
  if (!uname) { alert('أدخل اسم المستخدم'); return; }
  if (!confirm(`تعطيل المستخدم: ${uname} ؟`)) return;
  const { error } = await DatabaseClient.rpc('admin_set_profile_active', {
    p_username: uname,
    p_is_active: false
  });
  if (error) { alert('تعذر تعطيل المستخدم'); return; }
  try { await logAction('تعطيل مستخدم', '', `username: ${uname}`); } catch { }
  try { await renderUsersList(); } catch { }
  alert('تم تعطيل المستخدم');
}
function sendUpdateCaseToSheets(c) {
  const payload = { action: 'updateCase', case: normalizeCaseForSheets(c) };
  const url = getConfiguredUrl();
  const token = getToken();
  postWithRetry(url, payload, 2, { token }).catch(() => enqueue({ type: 'updateCase', payload, url, token, activeRegion: AppState.settings?.activeRegion || null }));
}
function exportToExcel() { exportToCSV() }
async function printReport() {
  try { generateReportPreview(); } catch { }

  const dash = document.getElementById('reportsDashWrap');
  const pre = document.getElementById('reportPreview');
  if (!dash && !pre) { try { window.print(); } catch { } return; }

  const clone = document.createElement('div');
  clone.dir = 'rtl';
  clone.style.fontFamily = 'Tajawal, sans-serif';
  clone.style.padding = '12px';

  try {
    if (dash) clone.appendChild(dash.cloneNode(true));
    if (pre) {
      const preClone = pre.cloneNode(true);
      try { preClone.style.marginTop = '12px'; } catch { }
      clone.appendChild(preClone);
    }
  } catch { }

  // Convert canvases to images so charts appear in print/PDF
  try {
    const canvases = Array.from(clone.querySelectorAll('canvas'));
    canvases.forEach((cv) => {
      try {
        const original = document.getElementById(cv.id);
        if (!original) return;
        const dataUrl = original.toDataURL('image/png', 1.0);
        if (!dataUrl) return;
        const img = document.createElement('img');
        img.src = dataUrl;
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.alt = '';
        cv.replaceWith(img);
      } catch { }
    });
  } catch { }

  let w = null;
  try { w = window.open('', '_blank'); } catch { w = null; }
  if (!w) { try { window.print(); } catch { } return; }

  const cssHref = (() => {
    try {
      const link = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .find(x => (x.getAttribute('href') || '').includes('assets/css/style.css'));
      return link ? link.href : '';
    } catch { return ''; }
  })();

  const html = `<!doctype html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>طباعة التقرير</title>
    ${cssHref ? `<link rel="stylesheet" href="${cssHref}">` : ''}
    <style>
      body{background:#fff;margin:0;padding:0}
      .header,.nav{display:none !important}
      .section{box-shadow:none !important}
      @page{margin:12mm}
    </style>
  </head>
  <body></body>
  </html>`;

  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch {
    try { w.close(); } catch { }
    try { window.print(); } catch { }
    return;
  }

  try {
    w.document.body.appendChild(clone);
  } catch { }

  try {
    setTimeout(() => {
      try { w.focus(); } catch { }
      try { w.print(); } catch { }
      try { w.close(); } catch { }
    }, 250);
  } catch { }
}

function addDetailsMedicalRow(row, disAttr) {
  const tb = document.getElementById('d_medicalBody');
  if (!tb) return;
  const r = row || {};
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="control" data-field="name" value="${(r.name || '').replaceAll('"', '&quot;')}" ${disAttr}></td>
    <td>
      <select class="control" data-field="diseaseType" ${disAttr}>
        <option value="" ${!r.diseaseType ? 'selected' : ''}>اختر</option>
        <option ${r.diseaseType === 'مزمن' ? 'selected' : ''}>مزمن</option>
        <option ${r.diseaseType === 'عجز' ? 'selected' : ''}>عجز</option>
        <option ${r.diseaseType === 'إعاقة' ? 'selected' : ''}>إعاقة</option>
      </select>
    </td>
    <td><input class="control" data-field="treatmentSources" value="${(r.treatmentSources || '').replaceAll('"', '&quot;')}" ${disAttr}></td>
    <td><input class="control" data-field="specialty" value="${(r.specialty || '').replaceAll('"', '&quot;')}" ${disAttr}></td>
    <td><input class="control" data-field="hospital" value="${(r.hospital || '').replaceAll('"', '&quot;')}" ${disAttr}></td>
    <td><input class="control" data-field="required" value="${(r.required || '').replaceAll('"', '&quot;')}" ${disAttr}></td>
    <td><input class="control" data-field="estimatedCost" type="number" value="${(r.estimatedCost ?? '')}" ${disAttr}></td>
    <td>${disAttr ? '' : '<button type="button" class="btn" onclick="this.closest(\'tr\').remove()">🗑️</button>'}</td>
  `;
  tb.appendChild(tr);
}

// Google Sheets integration with retry and offline queue
let PendingQueue_ = [];
function normalizeQueueJob_(job) {
  if (!job || typeof job !== 'object') return null;
  const payload = (job.payload && typeof job.payload === 'object') ? job.payload : null;
  const url = (job.url || '').toString().trim() || getConfiguredUrl();
  if (!payload || !url) return null;
  return {
    id: (job.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`).toString(),
    type: (job.type || 'job').toString(),
    payload,
    url,
    token: (job.token || '').toString().trim() || null,
    activeRegion: (job.activeRegion || '').toString().trim() || null,
    createdAt: (job.createdAt || new Date().toISOString()).toString()
  };
}
function loadPendingQueue_() {
  const stored = readStorageJson_(FRONTEND_CONFIG.pendingQueueStorageKey, []);
  setQueue(stored);
}
function persistPendingQueue_() {
  writeStorageJson_(FRONTEND_CONFIG.pendingQueueStorageKey, getQueue());
}
function getQueue() { try { return Array.isArray(PendingQueue_) ? PendingQueue_ : []; } catch { return []; } }
function setQueue(q) {
  try {
    PendingQueue_ = (Array.isArray(q) ? q : []).map(normalizeQueueJob_).filter(Boolean);
  } catch { PendingQueue_ = []; }
  persistPendingQueue_();
}
function enqueue(job) {
  const normalized = normalizeQueueJob_(job);
  if (!normalized) return;
  const q = getQueue();
  q.push(normalized);
  setQueue(q);
}
async function trySyncPendingQueue() {
  const q = getQueue();
  if (!q.length) return;
  try { if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return; } catch { }
  const rest = [];
  for (const job of q) {
    try {
      await postWithRetry(job.url || getConfiguredUrl(), job.payload, 2, { token: job.token || null });
    } catch {
      rest.push(job);
    }
  }
  setQueue(rest);
}
async function postWithRetry(url, payload, retries, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    // Apps Script Web Apps often fail CORS preflight (OPTIONS). Avoid preflight by:
    // - sending body as text/plain (simple request)
    // - not sending custom headers
    const token = (options && Object.prototype.hasOwnProperty.call(options, 'token')) ? options.token : getToken();
    const bodyObj = token ? { ...(payload || {}), token } : (payload || {});
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(bodyObj), signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('bad status');
    const txt = await res.text();
    try {
      const obj = JSON.parse(txt || '{}');
      // Our Apps Script returns { ok: true/false, ... }. Treat ok:false as an error so we can retry/queue.
      if (obj && typeof obj === 'object' && obj.ok === false) {
        const errMsg = (obj.error || obj.message || 'remote error').toString();
        throw new Error(errMsg);
      }
      return obj;
    } catch {
      // Apps Script may return HTML (auth/permission page). Treat as failure so we can queue.
      throw new Error('non-json response');
    }
  } catch (e) {
    if (retries > 0) return await postWithRetry(url, payload, retries - 1, options);
    throw e;
  } finally {
    try { clearTimeout(timer); } catch { }
  }
}
function sendCaseToSheets(c) {
  const payload = { action: 'addCase', case: normalizeCaseForSheets(c) };
  const url = getConfiguredUrl();
  const token = getToken();
  postWithRetry(url, payload, 2, { token }).catch(() => enqueue({ type: 'addCase', payload, url, token, activeRegion: AppState.settings?.activeRegion || null }));
}
function sendStatusUpdateToSheets(u) {
  const payload = { action: 'updateStatus', update: u };
  const url = getConfiguredUrl();
  const token = getToken();
  postWithRetry(url, payload, 2, { token }).catch(() => enqueue({ type: 'updateStatus', payload, url, token, activeRegion: AppState.settings?.activeRegion || null }));
}

// Load from Google Sheets and merge
async function loadRemoteCases() {
  try {
    const payload = { action: 'listCases' };
    const url = getConfiguredUrl();
    const res = await postWithRetry(url, payload, 2);
    if (!res || !Array.isArray(res.cases)) return;
    mergeCases(res.cases);
  } catch (e) {
    // silent: offline or endpoint not ready
  }
}

function mergeCases(remoteCases) {
  const byId = new Map(AppState.cases.map(c => [c.id, c]));
  let changed = false;
  for (const r of remoteCases) {
    if (!r || !r.id) continue;
    if (byId.has(r.id)) {
      const cur = byId.get(r.id);
      // prefer remote status/fields if provided
      const merged = { ...cur, ...r, medicalInfo: { ...(cur.medicalInfo || {}), ...(r.medicalInfo || {}) } };
      byId.set(r.id, merged);
    } else {
      byId.set(r.id, r);
    }
    changed = true;
  }
  if (changed) {
    AppState.cases = Array.from(byId.values());
    // Re-compute next case counter based on remote data (source of truth)
    computeNextCounterFromCases();
    // refresh visible sections
    try { renderCasesTable(); } catch { }
    try { updateDashboardStats(); } catch { }
    try { generateReportPreview(); } catch { }
    try { updateNavBadges(); } catch { }
    // refresh new case ID if form visible
    try { if (!document.getElementById('newCaseSection').classList.contains('hidden')) generateCaseId(); } catch { }
  }
}

// Compute next case counter from existing cases for current YYYYMM
function computeNextCounterFromCases() {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  let maxSuffix = 0;
  const re = new RegExp(`^CASE-${ym}-(\\d+)$`);
  for (const c of AppState.cases) {
    if (typeof c.id !== 'string') continue;
    const m = c.id.match(re);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!isNaN(num) && num > maxSuffix) maxSuffix = num;
    }
  }
  AppState.caseIdCounter = maxSuffix + 1 || 1;
}
