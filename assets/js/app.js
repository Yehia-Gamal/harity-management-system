// State
const APP_VERSION = '20260304_1440';

let LastToastSig_ = '';
let LastToastAt_ = 0;

let AuthOpChain_ = Promise.resolve();

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

async function createUserFromUi_() {
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  if (!SupabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }

  const hint = document.getElementById('newUserHint');
  const email = (document.getElementById('newUserEmail')?.value || '').toString().trim();
  const username = (document.getElementById('newUserUsername')?.value || '').toString().trim() || email;
  const name = (document.getElementById('newUserName')?.value || '').toString().trim();
  const tempPassword = (document.getElementById('newUserTempPassword')?.value || '').toString();

  if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
  if (!email || !email.includes('@')) {
    if (hint) { hint.style.display = 'block'; hint.textContent = 'أدخل بريد إلكتروني صحيح'; }
    return;
  }

  const permissions = getDefaultNewUserPermissions_();

  // Attempt to create Auth user via Edge Function if available.
  let createdAuth = false;
  try {
    if (SupabaseClient?.functions?.invoke) {
      const { data, error } = await SupabaseClient.functions.invoke('create-user', {
        body: { email, password: tempPassword || null, username, full_name: name || null }
      });
      if (!error && (data?.id || data?.user?.id)) createdAuth = true;
    }
  } catch { }

  // Ensure profile row exists/updated with default permissions.
  try {
    const { data: existing, error: exErr } = await SupabaseClient.from('profiles').select('id').eq('username', username).maybeSingle();
    if (exErr) throw exErr;
    if (existing?.id) {
      const { error } = await SupabaseClient.from('profiles').update({ full_name: name, permissions, is_active: true, email }).eq('id', existing.id);
      if (error) {
        const { error: e2 } = await SupabaseClient.from('profiles').update({ full_name: name, permissions, is_active: true }).eq('id', existing.id);
        if (e2) throw e2;
      }
    } else {
      const payload = { username, full_name: name || '', permissions, is_active: true, email };
      const { error } = await SupabaseClient.from('profiles').insert(payload);
      if (error) {
        const payload2 = { username, full_name: name || '', permissions, is_active: true };
        const { error: e2 } = await SupabaseClient.from('profiles').insert(payload2);
        if (e2) throw e2;
      }
    }
    try { await logAction('إنشاء مستخدم (واجهة)', '', `username: ${username} | email: ${email}`); } catch { }
    try { await renderUsersList(); } catch { }
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = createdAuth
        ? 'تم إنشاء المستخدم وتسجيله في النظام بصلاحيات مبدئية.'
        : 'تم إنشاء ملف المستخدم بصلاحيات مبدئية. إذا لم يتم إنشاء المستخدم في Auth، أنشئه من لوحة Supabase أو وفّر Edge Function create-user.';
    }
    try { document.getElementById('newUserEmail').value = ''; } catch { }
    try { document.getElementById('newUserUsername').value = ''; } catch { }
    try { document.getElementById('newUserName').value = ''; } catch { }
    try { document.getElementById('newUserTempPassword').value = ''; } catch { }
  } catch (e) {
    try { console.error('createUserFromUi_ error:', e); } catch { }
    if (hint) { hint.style.display = 'block'; hint.textContent = 'تعذر إنشاء المستخدم'; }
  }
}

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

const AppState = { currentUser: null, cases: [], isAuthenticated: false, googleSheetsUrl: 'https://script.google.com/macros/s/AKfycbwxEt1qnMH8HIQrpFm838LRq-g0p5_43m8tK563N8ZSjZ3NNysoeScWr2jV50osepU6/exec', caseIdCounter: 1000, settings: { url: null, token: null, regions: [], activeRegion: null } };

function markCasesDerivedDirty_() {
  try { AppState._derivedDirty = true; } catch { }
}

function refreshDerivedViewsIfNeeded_(sectionId) {
  const dirty = !!AppState._derivedDirty;
  if (!dirty) return;
  try {
    if (sectionId === 'dashboardSection') {
      try { updateDashboardStats(); } catch { }
      try { AppState._derivedDirty = false; } catch { }
      return;
    }
    if (sectionId === 'reportsSection') {
      let ok = false;
      try {
        generateReportPreview();
        ok = true;
      } catch { }
      if (ok) {
        try { AppState._derivedDirty = false; } catch { }
      }
      return;
    }
    if (sectionId === 'medicalCommitteeSection') {
      try { updateMedicalCommitteeStats(); } catch { }
      try { renderMedicalTable(); } catch { }
      try { AppState._derivedDirty = false; } catch { }
      return;
    }
  } catch { }
}

function getNextCaseNo_() {
  const nums = (AppState.cases || []).map(c => Number(c?.caseNo)).filter(n => Number.isFinite(n) && n > 0);
  const max = nums.length ? Math.max(...nums) : 0;
  return max + 1;
}

function toggleCasesListCategoriesMobile() {
  try {
    const grid = document.querySelector('.cases-list-filters-grid');
    if (!grid) return;
    grid.classList.toggle('cats-open');
    const btn = document.getElementById('toggleCasesCatsBtn');
    if (btn) btn.textContent = grid.classList.contains('cats-open') ? 'إخفاء' : 'إظهار';
  } catch { }
}

function renderNewCaseForm_() {
  const host = document.getElementById('caseForm');
  if (!host) return;
  if (host.getAttribute('data-rendered') === '1' && host.innerHTML.trim()) return;

  host.innerHTML = `
    <div class="grid cols-2">
      <div class="form-group"><label class="label">رقم الحالة</label><input id="d_caseNo" class="control" disabled style="width:58px;height:58px;border-radius:999px;text-align:center;font-weight:900;padding:0"></div>
      <div class="form-group">
        <div class="grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
          <div class="form-group"><label class="label">إضافة اسم المستكشف</label><input id="d_explorerName" class="control" style="max-width:200px"></div>
          <div class="form-group"><label class="label">التاريخ</label><input id="d_date" type="date" class="control" style="max-width:200px"></div>
        </div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <div class="grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
          <div class="form-group"><label class="label">اسم رب الأسرة *</label><input id="d_familyHead" class="control" required></div>
          <div class="form-group"><label class="label">رقم قومي (ID) *</label><input id="d_id" class="control" required maxlength="14" inputmode="numeric" pattern="\\d{14}"></div>
          <div class="form-group"><label class="label">الهاتف *</label><input id="d_phone" class="control" required maxlength="11" inputmode="numeric" pattern="\\d{11}"></div>
          <div class="form-group"><label class="label">رقم واتساب</label><input id="d_whatsapp" class="control" maxlength="11" inputmode="numeric" pattern="\\d{11}"></div>
        </div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <div class="grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
          <div class="form-group"><label class="label">الحالة الاجتماعية *</label><select id="d_maritalStatus" class="control" required></select></div>
          <div class="form-group"><label class="label">عدد الأفراد</label><input id="d_familyCount" type="number" class="control" placeholder="0"></div>
          <div class="form-group"><label class="label">مبلغ منفذ</label><input id="d_deliveredAmount" type="number" class="control" placeholder="200" value="200"></div>
          <div class="form-group"><label class="label">تقييم الحالة *</label>
            <select id="d_caseGrade" class="control" required>
              <option value="">اختر</option>
              <option value="حالة مستديمة">حالة مستديمة</option>
              <option value="حالة موسمية">حالة موسمية</option>
              <option value="حالة مرفوضة">حالة مرفوضة</option>
              <option value="حالة قيد الانتظار">حالة قيد الانتظار</option>
            </select>
          </div>
        </div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <div class="grid" style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px">
          <div class="form-group"><label class="label">المحافظة *</label><select id="d_governorate" class="control" required></select></div>
          <div class="form-group"><label class="label">القرية *</label><input id="d_area" class="control" list="d_areaList" required><datalist id="d_areaList"></datalist></div>
          <div class="form-group"><label class="label">العنوان</label><textarea id="d_address" class="control" rows="2"></textarea></div>
        </div>
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label class="label">الفئة * (يمكن اختيار أكثر من فئة)</label>
        <div id="d_categoriesBox" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;padding:10px;border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc"></div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <div class="grid" style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px">
          <div class="form-group"><label class="label">عمل الأب</label><input id="d_fatherJob" class="control" style="max-width:200px"></div>
          <div class="form-group"><label class="label">عمل الأم</label><input id="d_motherJob" class="control" style="max-width:200px"></div>
          <div class="form-group"><label class="label">وصف السكن</label><textarea id="d_housingDesc" class="control" rows="2"></textarea></div>
        </div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <label class="label">السكن</label>
        <div class="grid" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
          <div class="form-group"><label class="label">نوع المنطقة</label>
            <select id="d_areaType" class="control">
              <option value="">اختر</option>
              <option value="منطقة ريفية">منطقة ريفية</option>
              <option value="منطقة حضرية">منطقة حضرية</option>
              <option value="منطقة بدوية">منطقة بدوية</option>
              <option value="منطقة شعبية">منطقة شعبية</option>
            </select>
          </div>
          <div class="form-group"><label class="label">عدد الغرف</label>
            <select id="d_roomsCount" class="control">
              <option value="">اختر</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
          </div>
          <div class="form-group"><label class="label">الحمام</label>
            <select id="d_bathroomType" class="control">
              <option value="">اختر</option>
              <option value="حمام مستقل">حمام مستقل</option>
              <option value="حمام مشترك">حمام مشترك</option>
              <option value="لا يوجد حمام">لا يوجد حمام</option>
            </select>
          </div>
          <div class="form-group"><label class="label">المياه</label>
            <select id="d_waterExists" class="control">
              <option value="">اختر</option>
              <option value="يوجد مياه بالسكن">يوجد مياه بالسكن</option>
              <option value="لا يوجد مياه بالسكن">لا يوجد مياه بالسكن</option>
            </select>
          </div>
          <div class="form-group"><label class="label">السقف</label>
            <select id="d_roofExists" class="control">
              <option value="">اختر</option>
              <option value="يوجد سقف للسكن">يوجد سقف للسكن</option>
              <option value="لا يوجد سقف للسكن">لا يوجد سقف بالسكن</option>
            </select>
          </div>
        </div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <label class="label">الديون</label>
        <div class="grid" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 2fr;gap:8px">
          <div class="form-group"><label class="label">هل توجد ديون؟</label>
            <select id="d_debtsEnabled" class="control compact" style="max-width:140px">
              <option value="لا">لا</option>
              <option value="نعم">نعم</option>
            </select>
          </div>
          <div class="form-group"><label class="label">قيمة الدين</label><input id="d_debtAmount" type="number" class="control compact" placeholder="0" style="max-width:140px"></div>
          <div class="form-group"><label class="label">صاحب الدين</label><input id="d_debtOwner" class="control"></div>
          <div class="form-group"><label class="label">حكم قضائي؟</label>
            <select id="d_hasCourtOrder" class="control compact" style="max-width:160px">
              <option value="">اختر</option>
              <option value="لا يوجد">لا يوجد</option>
              <option value="شيك">شيك</option>
              <option value="وصل امانه">وصل امانه</option>
            </select>
          </div>
          <div class="form-group"><label class="label">سبب الدين</label><input id="d_debtReason" class="control compact"></div>
        </div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <label class="label">أفراد الأسرة</label>
        <div style="display:flex; gap:8px; justify-content:flex-start; margin-bottom:8px"><button type="button" class="btn" id="d_addFamilyMemberRow">➕ إضافة فرد</button></div>
        <div style="overflow:auto; border:1px solid #e5e7eb; border-radius:12px">
          <table class="table" style="min-width:900px">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>صلة القرابة</th>
                <th>السن</th>
                <th>يعمل؟</th>
                <th>متوسط الدخل</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="d_familyMembersBody"></tbody>
          </table>
        </div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <label class="label">الجانب الطبي</label>
        <div style="display:flex; gap:8px; justify-content:flex-start; margin-bottom:8px"><button type="button" class="btn" id="d_addMedicalRow">➕ إضافة حالة طبية</button></div>
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

      <div class="form-group" style="grid-column:1/-1">
        <label class="label">الدخل والمصروفات</label>
        <div class="grid cols-2" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px">
            <div class="form-group"><label class="label">إجمالي الدخل</label><input id="d_incomeTotal" type="number" class="control" placeholder="0"></div>
            <div class="form-group"><label class="label">ملاحظات</label><textarea id="d_incomeNotes" class="control" rows="2"></textarea></div>
          </div>
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px">
            <div class="form-group"><label class="label">إجمالي المصروفات</label><input id="d_expensesTotal" type="number" class="control" placeholder="0"></div>
            <div class="form-group"><label class="label">ملاحظات</label><textarea id="d_expensesNotes" class="control" rows="2"></textarea></div>
          </div>
        </div>
        <div class="form-group"><label class="label">صافي شهري (تلقائي)</label><input id="d_netMonthly" type="number" class="control compact" placeholder="0" readonly style="max-width:160px"></div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <label class="label">الزواج / المشاريع</label>
        <div class="grid cols-2" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px">
            <div class="form-group"><label class="label">يوجد حالة زواج؟</label>
              <select id="d_marriageEnabled" class="control">
                <option value="لا">لا يوجد حالة زواج في الأسرة</option>
                <option value="نعم">نعم يوجد حالة زواج في الأسرة</option>
              </select>
            </div>
            <div class="form-group"><label class="label">اسم العروسة</label><input id="d_brideName" class="control"></div>
            <div class="form-group"><label class="label">اسم العريس</label><input id="d_groomName" class="control"></div>
            <div class="form-group"><label class="label">مهنة العريس</label><input id="d_groomJob" class="control"></div>
            <div class="form-group"><label class="label">تاريخ كتب الكتاب</label><input id="d_contractDate" type="date" class="control"></div>
            <div class="form-group"><label class="label">تاريخ الزواج</label><input id="d_weddingDate" type="date" class="control"></div>
            <div class="form-group"><label class="label">المتوفر</label><input id="d_marriageAvailable" class="control"></div>
            <div class="form-group"><label class="label">المطلوب</label><input id="d_marriageNeeded" class="control"></div>
          </div>
          <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px">
            <div class="form-group"><label class="label">يوجد مشروع؟</label>
              <select id="d_projectsEnabled" class="control">
                <option value="لا">لا تملك الأسرة مهارات عمل مشروع</option>
                <option value="نعم">نعم تستطيع الأسرة عمل مشروع</option>
              </select>
            </div>
            <div class="form-group"><label class="label">نوع المشروع</label><input id="d_projectType" class="control"></div>
            <div class="form-group"><label class="label">الخبرة والاستعداد</label><select id="d_projectExperience" class="control"></select></div>
            <div class="form-group"><label class="label">احتياجات المشروع</label><textarea id="d_projectNeeds" class="control" rows="3"></textarea></div>
          </div>
        </div>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <div class="grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
          <div class="form-group"><label class="label">احتياجات الأسرة</label><textarea id="d_familyNeeds" class="control" rows="3"></textarea></div>
          <div class="form-group"><label class="label">تقرير الباحث</label><textarea id="d_researcherReport" class="control" rows="3"></textarea></div>
        </div>
      </div>
    </div>
    <div class="tabs" style="margin-top:10px;display:flex;gap:10px;justify-content:flex-start;align-items:center">
      <button class="btn" type="submit" style="background:#2563eb;color:#fff;border-color:#2563eb;font-weight:900;padding:12px 18px;border-radius:14px;box-shadow:0 10px 22px rgba(37,99,235,.18)">💾 حفظ الحالة</button>
    </div>
  `;
  host.setAttribute('data-rendered', '1');

  try {
    const govSel = document.getElementById('d_governorate');
    if (govSel) govSel.innerHTML = ['<option value="">اختر المحافظة</option>'].concat(GOVS.map(g => `<option>${escapeHtml(g)}</option>`)).join('');
  } catch { }
  try {
    const box = document.getElementById('d_categoriesBox');
    if (box) {
      box.innerHTML = (CATEGORIES || []).map((c) => {
        const v = escapeHtml(c);
        return `
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;cursor:pointer;box-shadow:0 1px 0 rgba(15,23,42,.03)">
            <input type="checkbox" class="cat-box" value="${v}" style="width:18px;height:18px;accent-color:#2563eb" />
            <span style="font-weight:700;color:#0f172a">${v}</span>
          </label>`;
      }).join('');
    }
  } catch { }
  try {
    const ms = document.getElementById('d_maritalStatus');
    if (ms) {
      ms.innerHTML = ['<option value="">اختر</option>'].concat((MARITAL_STATUS_OPTIONS || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)).join('');
    }
  } catch { }
  try {
    const pe = document.getElementById('d_projectExperience');
    if (pe) {
      pe.innerHTML = ['<option value="">اختر</option>'].concat((PROJECT_EXPERIENCE_OPTIONS || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)).join('');
    }
  } catch { }
  try {
    const govSel = document.getElementById('d_governorate');
    const areaList = document.getElementById('d_areaList');
    const fillAreas = () => {
      if (!areaList) return;
      const gov = (govSel?.value || '').toString().trim();
      const areas = (AppState.cases || [])
        .filter(c => (c?.governorate || '').toString().trim() === gov)
        .map(c => (c?.area || '').toString().trim())
        .filter(Boolean);
      const uniq = Array.from(new Set(areas)).sort((a, b) => a.localeCompare(b));
      areaList.innerHTML = uniq.map(a => `<option value="${escapeHtml(a)}"></option>`).join('');
    };
    if (govSel) govSel.addEventListener('change', fillAreas);
    fillAreas();
  } catch { }
  try {
    const dt = document.getElementById('d_date');
    if (dt && !dt.value) dt.value = new Date().toISOString().slice(0, 10);
  } catch { }
  try {
    const d = document.getElementById('d_deliveredAmount');
    if (d && (d.value === '' || d.value == null)) d.value = '200';
  } catch { }
  try {
    const no = document.getElementById('d_caseNo');
    if (no) no.value = String(getNextCaseNo_());
  } catch { }

  try {
    const btn = document.getElementById('d_addMedicalRow');
    if (btn) btn.onclick = () => addDetailsMedicalRow({}, '');
  } catch { }
  try { addDetailsMedicalRow({}, ''); } catch { }

  try {
    const btn = document.getElementById('d_addFamilyMemberRow');
    if (btn) btn.onclick = () => addNewCaseFamilyMemberRow_({});
  } catch { }
  try { addNewCaseFamilyMemberRow_({}); } catch { }

  try {
    const incomeTotal = document.getElementById('d_incomeTotal');
    const expensesTotal = document.getElementById('d_expensesTotal');
    const net = document.getElementById('d_netMonthly');
    const calc = () => {
      const inc = Number(incomeTotal?.value || 0) || 0;
      const exp = Number(expensesTotal?.value || 0) || 0;
      if (net) net.value = String(Math.max(-999999999, Math.min(999999999, inc - exp)));
    };
    if (incomeTotal) incomeTotal.addEventListener('input', calc);
    if (expensesTotal) expensesTotal.addEventListener('input', calc);
    calc();
  } catch { }

  try {
    const onlyDigitsMax = (el, maxLen) => {
      if (!el) return;
      el.addEventListener('input', () => {
        const raw = (el.value || '').toString();
        const digits = raw.replace(/[^0-9\u0660-\u0669\u06F0-\u06F9]/g, '');
        const toLatin = (s) => s.replace(/[\u0660-\u0669]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
          .replace(/[\u06F0-\u06F9]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
        const lat = toLatin(digits).slice(0, maxLen);
        if (el.value !== lat) el.value = lat;
      });
    };
    onlyDigitsMax(document.getElementById('d_id'), 14);
    onlyDigitsMax(document.getElementById('d_phone'), 11);
    onlyDigitsMax(document.getElementById('d_whatsapp'), 11);
  } catch { }

  try {
    if (host.getAttribute('data-wired') !== '1') {
      host.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitNewCase_();
      });
      host.setAttribute('data-wired', '1');
    }
  } catch { }

  try { updateCasesListUiState_(); } catch { }
}

function addNewCaseFamilyMemberRow_(row) {
  const tb = document.getElementById('d_familyMembersBody');
  if (!tb) return;
  const r = row || {};
  const tr = document.createElement('tr');
  const relOpts = ['<option value="">اختر</option>'].concat((RELATION_OPTIONS || []).map(v => `<option value="${escapeHtml(v)}" ${String(r.relation || '') === String(v) ? 'selected' : ''}>${escapeHtml(v)}</option>`)).join('');
  const workOpts = ['<option value="">اختر</option>'].concat((WORKING_OPTIONS || []).map(v => `<option value="${escapeHtml(v)}" ${String(r.works || '') === String(v) ? 'selected' : ''}>${escapeHtml(v)}</option>`)).join('');
  tr.innerHTML = `
    <td><input class="control" data-field="name" value="${escapeHtml((r.name || '').toString())}"></td>
    <td><select class="control" data-field="relation">${relOpts}</select></td>
    <td><input class="control compact" data-field="age" type="number" value="${escapeHtml((r.age ?? '').toString())}" style="min-width:70px;max-width:90px"></td>
    <td><select class="control" data-field="works">${workOpts}</select></td>
    <td><input class="control compact" data-field="avgIncome" type="number" value="${escapeHtml((r.avgIncome ?? '').toString())}" style="min-width:90px;max-width:110px"></td>
    <td><button type="button" class="btn" onclick="this.closest('tr').remove()">🗑️</button></td>
  `;
  tb.appendChild(tr);
}

function openSponsorshipFromToolbar() {
  try {
    const sel = getSelectedCaseIds();
    if (sel.length) {
      openBulkSponsorshipModal();
      return;
    }
    openSponsorshipModalAdvanced();
  } catch (e) {
    alert(`تعذر فتح نافذة تسليم الكفالة.\n\nالخطأ: ${e?.message || 'غير معروف'}`);
  }
}

function enterCaseEditMode() {
  try {
    if (!hasPerm('cases_edit')) { alert('لا تملك صلاحية تعديل الحالة'); return; }
    const id = AppState.currentCaseId;
    if (!id) { alert('لا توجد حالة محددة للتعديل'); return; }
    openCaseDetails(id, 'edit');
  } catch (e) {
    alert(`تعذر الدخول لوضع التعديل.\n\nالخطأ: ${e?.message || 'غير معروف'}`);
  }
}

async function submitNewCase_() {
  if (!hasPerm('cases_create')) { alert('لا تملك صلاحية إضافة حالات'); return; }
  const idRaw = (document.getElementById('d_id')?.value || '').toString().trim();
  const familyHead = (document.getElementById('d_familyHead')?.value || '').toString().trim();
  const phoneRaw = (document.getElementById('d_phone')?.value || '').toString().trim();
  const whatsappRaw = (document.getElementById('d_whatsapp')?.value || '').toString().trim();
  const caseGrade = (document.getElementById('d_caseGrade')?.value || '').toString().trim();
  const maritalStatus = (document.getElementById('d_maritalStatus')?.value || '').toString().trim();
  const governorate = (document.getElementById('d_governorate')?.value || '').toString().trim();
  const area = (document.getElementById('d_area')?.value || '').toString().trim();
  const categories = Array.from(document.querySelectorAll('#d_categoriesBox input.cat-box:checked'))
    .map(b => (b?.value || '').toString().trim())
    .filter(Boolean);

  const normalizeDigits_ = (s) => {
    const raw = (s || '').toString();
    const digits = raw.replace(/[^0-9\u0660-\u0669\u06F0-\u06F9]/g, '');
    const latin = digits
      .replace(/[\u0660-\u0669]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[\u06F0-\u06F9]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    return latin;
  };

  const id = normalizeDigits_(idRaw);
  const phone = normalizeDigits_(phoneRaw);
  const whatsapp = normalizeDigits_(whatsappRaw);

  if (!id) { alert('رقم قومي (ID) مطلوب'); return; }
  if (!/^\d{14}$/.test(id)) { alert('رقم قومي (ID) يجب أن يكون 14 رقم'); return; }
  if (!caseGrade) { alert('تقييم الحالة مطلوب'); return; }
  if (!familyHead) { alert('اسم رب الأسرة مطلوب'); return; }
  if (!maritalStatus) { alert('الحالة الاجتماعية مطلوبة'); return; }
  if (!phone) { alert('الهاتف مطلوب'); return; }
  if (!/^\d{11}$/.test(phone)) { alert('الهاتف يجب أن يكون 11 رقم'); return; }
  if (whatsapp && !/^\d{11}$/.test(whatsapp)) { alert('رقم واتساب يجب أن يكون 11 رقم'); return; }
  if (!governorate) { alert('المحافظة مطلوبة'); return; }
  if (!area) { alert('المنطقة مطلوبة'); return; }
  if (!categories.length) { alert('الفئة مطلوبة (يمكن اختيار أكثر من فئة)'); return; }

  const norm = (s) => (s || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
  const dupCase = (AppState.cases || []).find(c => normalizeDigits_(c?.id) === id);
  if (dupCase) {
    const msg = `يوجد حالة بنفس الرقم القومي بالفعل.\n\n` +
      `رقم الحالة: ${dupCase?.caseNo ?? ''}\n` +
      `اسم رب الأسرة: ${dupCase?.familyHead || ''}\n` +
      `الهاتف: ${dupCase?.phone || ''}`;
    alert(msg);
    return;
  }

  const dupPhoneCase = (AppState.cases || []).find(c => normalizeDigits_(c?.phone) && normalizeDigits_(c?.phone) === phone);
  if (dupPhoneCase) {
    const msg = `تنبيه: يوجد حالة بنفس رقم الهاتف بالفعل.\n\n` +
      `رقم الحالة: ${dupPhoneCase?.caseNo ?? ''}\n` +
      `اسم رب الأسرة: ${dupPhoneCase?.familyHead || ''}\n` +
      `الرقم القومي: ${dupPhoneCase?.id || ''}\n\n` +
      `هل تريد المتابعة وحفظ الحالة؟`;
    if (!confirm(msg)) return;
  }

  const dupNameCase = (AppState.cases || []).find(c => norm(c?.familyHead) && norm(c?.familyHead) === norm(familyHead));
  if (dupNameCase) {
    const msg = `تنبيه: يوجد حالة بنفس اسم رب الأسرة بالفعل.\n\n` +
      `رقم الحالة: ${dupNameCase?.caseNo ?? ''}\n` +
      `الهاتف: ${dupNameCase?.phone || ''}\n` +
      `الرقم القومي: ${dupNameCase?.id || ''}\n\n` +
      `هل تريد المتابعة وحفظ الحالة؟`;
    if (!confirm(msg)) return;
  }

  const yn = (v) => {
    const s = (v || '').toString().trim();
    return (s === 'نعم' || s.toLowerCase() === 'yes' || s === 'true' || s === '1');
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

  const medBody = document.getElementById('d_medicalBody');
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
    const hasAny = [row.name, row.treatmentSources, row.specialty, row.hospital, row.required, row.estimatedCost]
      .some(v => String(v || '').trim() !== '');
    if (!hasAny) return null;
    return row;
  }).filter(Boolean);

  const obj = {
    id,
    caseNo: Number(document.getElementById('d_caseNo')?.value || getNextCaseNo_()) || getNextCaseNo_(),
    caseGrade,
    familyHead,
    phone,
    whatsapp,
    address: (document.getElementById('d_address')?.value || '').toString().trim(),
    governorate,
    area,
    category: categories.join('، '),
    categories,
    status: 'جديدة',
    urgency: '',
    maritalStatus,
    familyCount: Number(document.getElementById('d_familyCount')?.value || 0) || 0,
    jobs: {
      father: (document.getElementById('d_fatherJob')?.value || '').toString().trim(),
      mother: (document.getElementById('d_motherJob')?.value || '').toString().trim()
    },
    explorerName: (document.getElementById('d_explorerName')?.value || '').toString().trim(),
    date: (document.getElementById('d_date')?.value || '').toString().trim(),
    deliveredAmount: Number(document.getElementById('d_deliveredAmount')?.value || 200) || 200,
    tags: [],
    housing: {
      housingDesc: (document.getElementById('d_housingDesc')?.value || '').toString().trim(),
      roomsCount: Number(document.getElementById('d_roomsCount')?.value || 0) || 0,
      bathroomType: (document.getElementById('d_bathroomType')?.value || '').toString().trim(),
      waterExists: (document.getElementById('d_waterExists')?.value || '').toString().trim(),
      roofExists: (document.getElementById('d_roofExists')?.value || '').toString().trim(),
      areaType: (document.getElementById('d_areaType')?.value || '').toString().trim()
    },
    debts: {
      enabled: yn(document.getElementById('d_debtsEnabled')?.value || ''),
      amount: Number(document.getElementById('d_debtAmount')?.value || 0) || 0,
      owner: (document.getElementById('d_debtOwner')?.value || '').toString().trim(),
      hasCourtOrder: (document.getElementById('d_hasCourtOrder')?.value || '').toString().trim(),
      reason: (document.getElementById('d_debtReason')?.value || '').toString().trim()
    },
    income: {
      notes: (document.getElementById('d_incomeNotes')?.value || '').toString(),
      total: Number(document.getElementById('d_incomeTotal')?.value || 0) || 0
    },
    expenses: {
      notes: (document.getElementById('d_expensesNotes')?.value || '').toString(),
      total: Number(document.getElementById('d_expensesTotal')?.value || 0) || 0
    },
    netMonthly: Number(document.getElementById('d_netMonthly')?.value || 0) || 0,
    marriage: {
      enabled: yn(document.getElementById('d_marriageEnabled')?.value || ''),
      brideName: (document.getElementById('d_brideName')?.value || '').toString().trim(),
      groomName: (document.getElementById('d_groomName')?.value || '').toString().trim(),
      groomJob: (document.getElementById('d_groomJob')?.value || '').toString().trim(),
      contractDate: (document.getElementById('d_contractDate')?.value || '').toString().trim(),
      weddingDate: (document.getElementById('d_weddingDate')?.value || '').toString().trim(),
      available: (document.getElementById('d_marriageAvailable')?.value || '').toString().trim(),
      needed: (document.getElementById('d_marriageNeeded')?.value || '').toString().trim()
    },
    project: {
      enabled: yn(document.getElementById('d_projectsEnabled')?.value || ''),
      type: (document.getElementById('d_projectType')?.value || '').toString().trim(),
      experience: (document.getElementById('d_projectExperience')?.value || '').toString().trim(),
      needs: (document.getElementById('d_projectNeeds')?.value || '').toString().trim()
    },
    familyMembers: (function () {
      try {
        const tb = document.getElementById('d_familyMembersBody');
        if (tb) {
          const rows = Array.from(tb.querySelectorAll('tr'));
          return rows.map(tr => {
            const get = (field) => (tr.querySelector(`[data-field="${field}"]`)?.value || '').toString().trim();
            const row = {
              name: get('name'),
              relation: get('relation'),
              age: get('age'),
              works: get('works'),
              avgIncome: get('avgIncome')
            };
            const hasAny = Object.values(row).some(v => String(v || '').trim() !== '');
            if (!hasAny) return null;
            const ageNum = Number(row.age);
            const incNum = Number(row.avgIncome);
            return {
              name: row.name,
              relation: row.relation,
              age: row.age === '' ? '' : (isNaN(ageNum) ? row.age : ageNum),
              works: row.works,
              avgIncome: row.avgIncome === '' ? '' : (isNaN(incNum) ? row.avgIncome : incNum)
            };
          }).filter(Boolean);
        }
      } catch { }
      return parseFamilyMembersPlain((document.getElementById('d_familyMembers')?.value || '').toString());
    })(),
    needsShort: '',
    familyNeeds: (document.getElementById('d_familyNeeds')?.value || '').toString(),
    researcherReport: (document.getElementById('d_researcherReport')?.value || '').toString(),
    medicalCases,
    importInfo: parseJsonOr('', null),
    explorationInfo: parseJsonOr('', null),
    assistanceHistory: [],
    sponsorships: []
  };

  try {
    AppState.cases = Array.isArray(AppState.cases) ? AppState.cases : [];
    AppState.cases.push(obj);
    ensureAssistanceArrays();
    try { ensureCaseNumbers_(); } catch { }
    try {
      if (SupabaseClient) await upsertCaseToDb(obj);
      else throw new Error('Supabase not configured');
    } catch (e) {
      await onSupabaseWriteError_('تعذر حفظ الحالة في قاعدة البيانات حالياً.', e);
      return;
    }
    try { logAction('إضافة حالة', obj.id, `caseNo: ${obj.caseNo} | familyHead: ${obj.familyHead}`); } catch { }
    alert('تم حفظ الحالة');
    try { renderCasesTable(); } catch { }
    try { updateDashboardStats(); } catch { }
    try { generateReportPreview(); } catch { }
    try { updateNavBadges(); } catch { }
    try {
      const host = document.getElementById('caseForm');
      if (host) {
        host.innerHTML = '';
        host.removeAttribute('data-rendered');
        host.removeAttribute('data-wired');
      }
    } catch { }
    try { showSection('casesList', 'navCasesBtn'); } catch { }
  } catch (e) {
    alert(`تعذر حفظ الحالة.\n\nالخطأ: ${e?.message || 'غير معروف'}`);
  }
}

function getSelectedCaseIds() {
  const host = document.getElementById('casesCardsGrid') || document.getElementById('casesTableBody');
  if (!host) return [];
  return Array.from(host.querySelectorAll('input.case-select:checked'))
    .map(b => (b.getAttribute('data-case-id') || '').toString().trim())
    .filter(Boolean);
}

function clearBulkSelection() {
  try {
    const host = document.getElementById('casesCardsGrid') || document.getElementById('casesTableBody');
    if (!host) return;
    Array.from(host.querySelectorAll('input.case-select')).forEach(b => { b.checked = false; });
  } catch { }
  try {
    const allBox = document.getElementById('casesSelectAll');
    if (allBox) allBox.checked = false;
  } catch { }
  try { onCaseSelectionChange(); } catch { }
}

function onCaseSelectionChange() {
  const ids = getSelectedCaseIds();
  try {
    const countEl = document.getElementById('bulkSelectedCount');
    if (countEl) countEl.textContent = String(ids.length);
  } catch { }
  try {
    const bar = document.getElementById('bulkActionsBar');
    if (bar) bar.classList.toggle('hidden', ids.length === 0);
  } catch { }

  try {
    const host = document.getElementById('casesCardsGrid') || document.getElementById('casesTableBody');
    const allBox = document.getElementById('casesSelectAll');
    if (host && allBox) {
      const boxes = Array.from(host.querySelectorAll('input.case-select'));
      const checked = boxes.filter(b => b.checked).length;
      allBox.indeterminate = checked > 0 && checked < boxes.length;
      allBox.checked = boxes.length > 0 && checked === boxes.length;
    }
  } catch { }
}

function ensureCaseNumbers_() {
  const list = Array.isArray(AppState.cases) ? AppState.cases : [];
  const rows = list.map((c, i) => {
    const no = Number(c?.caseNo);
    const has = Number.isFinite(no) && no > 0;
    const upd = c?.updated_at || '';
    const dt = c?.date || '';
    return { c, i, has, no, upd, dt, id: (c?.id || '').toString() };
  });

  rows.sort((a, b) => {
    if (a.has && b.has) return a.no - b.no;
    if (a.has) return -1;
    if (b.has) return 1;
    const d = String(a.dt || '').localeCompare(String(b.dt || ''));
    if (d !== 0) return d;
    const u = String(a.upd || '').localeCompare(String(b.upd || ''));
    if (u !== 0) return u;
    return a.id.localeCompare(b.id);
  });

  let n = 1;
  for (const r of rows) {
    try { r.c.caseNo = n; } catch { }
    n += 1;
  }
}

function ensureAssistanceArrays() {
  try {
    if (!Array.isArray(AppState.cases)) return;
    AppState.cases.forEach(c => {
      if (!c || typeof c !== 'object') return;
      if (!Array.isArray(c.sponsorships)) c.sponsorships = [];
      if (!Array.isArray(c.assistanceHistory)) c.assistanceHistory = [];
    });
  } catch { }
}

const SUPABASE_URL = 'https://fbctibquzuxfjonhbrjr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HWMOnpbnXOqCQm37lf7iyA_np0iIKMo';
let SupabaseClient = null;
let AuthBusy_ = false;
let IsRecoveryUrl_ = false;
let SessionRecoveryInProgress_ = false;
function computeIsRecoveryUrl_() {
  try {
    const hash = (location.hash || '').toString();
    const search = (location.search || '').toString();
    const raw = `${search}${hash}`;
    return raw.includes('type=recovery') || raw.includes('access_token=') || raw.includes('code=');
  } catch { return false; }
}
function getRememberMe_() {
  try { return (localStorage.getItem('rememberMe') || '') === '1'; } catch { return false; }
}
function setRememberMe_(v) {
  try { localStorage.setItem('rememberMe', v ? '1' : '0'); } catch { }
  if (!v) {
    try { localStorage.removeItem('sb-session'); } catch { }
  }
}
function initSupabaseClient_() {
  try {
    if (!(window.supabase && typeof window.supabase.createClient === 'function')) return null;
    const store = localStorage;
    const storageKey = 'sb-session';
    const storage = {
      getItem: (key) => {
        try { return store.getItem(key); } catch { return null; }
      },
      setItem: (key, value) => {
        try { store.setItem(key, value); } catch { }
      },
      removeItem: (key) => {
        try { store.removeItem(key); } catch { }
      }
    };
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage,
        storageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  } catch (e) {
    try { console.error('Supabase init error:', e); } catch { }
    return null;
  }
}
SupabaseClient = initSupabaseClient_();

const PERMISSIONS = [
  'dashboard',
  'reports',
  'settings',
  'audit',
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
    items: ['dashboard', 'settings', 'audit']
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
  if (!SupabaseClient) { if (!silent) alert('تعذر الاتصال بقاعدة البيانات'); return; }
  const uname = (document.getElementById('userMgmtUsername')?.value || '').trim();
  const name = (document.getElementById('userMgmtName')?.value || '').trim();
  if (!uname) return;

  const isActive = !!document.getElementById('userMgmtIsActive')?.checked;
  const permissions = readUserPermissionsUi_();

  const { data: existing, error: exErr } = await SupabaseClient.from('profiles').select('id').eq('username', uname).maybeSingle();
  if (exErr || !existing?.id) return;

  const { error } = await SupabaseClient
    .from('profiles')
    .update({ full_name: name, permissions, is_active: isActive })
    .eq('id', existing.id);
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
  if (!SupabaseClient) return;
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  const v = !!makeActive;
  const ok = confirm(v ? 'تفعيل هذا المستخدم؟' : 'تعطيل هذا المستخدم؟');
  if (!ok) return;
  const { error } = await SupabaseClient.from('profiles').update({ is_active: v }).eq('id', String(id));
  if (error) { alert('تعذر تحديث حالة المستخدم'); return; }
  try {
    const { data } = await SupabaseClient.from('profiles').select('username').eq('id', String(id)).maybeSingle();
    const uname = data?.username || '';
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
function hasPerm(perm) {
  const p = AppState.currentUser?.permissions;
  if (!p || typeof p !== 'object') return false;
  return !!p[perm];
}

async function setCurrentUserFromSession_(user) {
  if (!user) return;
  const username = (user.email || '').split('@')[0] || '';
  const prof = await ensureProfileForUser(user, username);
  if (prof && prof.is_active === false) {
    try { await SupabaseClient?.auth?.signOut?.(); } catch { }
    throw new Error('inactive');
  }
  AppState.currentUser = {
    id: user.id,
    username: prof?.username || username,
    name: prof?.full_name || username,
    permissions: prof?.permissions || {}
  };
  AppState.isAuthenticated = true;

  // Update last seen if column exists (ignore errors)
  try {
    await SupabaseClient.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', user.id);
  } catch { }
}
function roleLabel() { return '👤' }

function usernameToEmail(u) {
  const x = (u || '').toString().trim().toLowerCase();
  if (!x) return '';
  if (x.includes('@')) return x;
  return `${x}@app.local`;
}

async function ensureProfileForUser(user, username) {
  if (!SupabaseClient || !user?.id) return null;
  const { data: existing } = await SupabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (existing) return existing;

  const payload = {
    id: user.id,
    username: (username || '').toString().trim(),
    full_name: '',
    permissions: {}
  };
  const { data: created, error } = await SupabaseClient.from('profiles').insert(payload).select('*').single();
  if (error) throw error;
  return created;
}

async function getMyProfile() {
  if (!SupabaseClient) return null;
  // Cache to avoid many concurrent auth.getUser() calls (can trigger AbortError lock contention)
  if (AppState._myProfileCache && AppState._myProfileCache.userId && AppState._myProfileCache.profile) {
    return AppState._myProfileCache.profile;
  }
  const { data: auth, error: authErr } = await runAuthOp_(() => SupabaseClient.auth.getUser());
  if (authErr) return null;
  const user = auth?.user;
  if (!user) return null;
  const { data: prof } = await SupabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
  const out = prof || null;
  AppState._myProfileCache = { userId: user.id, profile: out };
  return out;
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

async function reloadCasesFromSupabase_() {
  try {
    await loadCasesFromDb(true);
  } catch { }
}

async function onSupabaseWriteError_(fallbackMsg, e) {
  try {
    const msg = (fallbackMsg || 'تعذر الحفظ في قاعدة البيانات حالياً.').toString();
    alert(`${msg}\n\nالخطأ: ${e?.message || 'خطأ غير معروف'}`);
  } catch {
    try { alert('تعذر الحفظ في قاعدة البيانات حالياً.'); } catch { }
  }
  try { await reloadCasesFromSupabase_(); } catch { }
}

async function loadCasesFromDb(force = false) {
  if (!SupabaseClient) { AppState.cases = []; return; }
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

  const { data, error } = await SupabaseClient
    .from('cases')
    .select('id,data,updated_at')
    .order('updated_at', { ascending: false })
    .limit(5000);
  if (error) {
    AppState.cases = [];
    try {
      const grid = document.getElementById('casesCardsGrid');
      const msg = (error.message || '').toString();
      const code = (error.code || '').toString();
      if (grid) grid.innerHTML = `<div style="padding:14px;border:1px solid #fecaca;background:#fff1f2;color:#991b1b;border-radius:12px;text-align:center">تعذر تحميل الحالات من قاعدة البيانات.<br>تأكد من وجود الصلاحية <b>cases_read</b> للمستخدم ومن سياسات RLS.<br><div style="margin-top:8px;color:#7f1d1d;font-size:.9rem">${escapeHtml(code ? `code: ${code} | ` : '')}${escapeHtml(msg)}</div></div>`;
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
  if (!SupabaseClient) throw new Error('Supabase not configured');
  if (!caseObj || !caseObj.id) throw new Error('Missing case id');
  const prof = await getMyProfile();
  const now = new Date().toISOString();
  const row = {
    id: String(caseObj.id),
    data: caseObj,
    created_by: prof?.id || null,
    updated_by: prof?.id || null,
    updated_at: now
  };
  const { data, error } = await SupabaseClient.from('cases').upsert(row).select('id,data,updated_at');
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
  if (!SupabaseClient) throw new Error('Supabase not configured');
  const { error } = await SupabaseClient.rpc('delete_case', { p_id: String(id) });
  if (error) throw error;
}

async function deleteAllCasesFromDb() {
  if (!SupabaseClient) throw new Error('Supabase not configured');
  // Safety: never allow mass delete without explicit typed confirmation.
  let ok = false;
  try { ok = (prompt('تحذير خطير: اكتب DELETE-ALL لتأكيد حذف كل الحالات من قاعدة البيانات:') || '').toString().trim().toUpperCase() === 'DELETE-ALL'; } catch { ok = false; }
  if (!ok) throw new Error('cancelled');
  // Avoid RPC that may execute a DELETE without a WHERE clause (blocked by PostgREST).
  // Use a safe delete with an explicit filter.
  const { error } = await SupabaseClient.from('cases').delete().neq('id', '');
  if (error) throw error;
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
    if (!SupabaseClient) return;
    const prof = await getMyProfile();
    await SupabaseClient.from('audit_log').insert({
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
  if (!SupabaseClient) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center">تعذر الاتصال بقاعدة البيانات</td></tr>';
    if (delBody) delBody.innerHTML = '<tr><td colspan="4" style="text-align:center">تعذر الاتصال بقاعدة البيانات</td></tr>';
    return;
  }
  const { data } = await SupabaseClient
    .from('audit_log')
    .select('created_at,action,case_id,details,profiles:created_by(username,full_name)')
    .order('created_at', { ascending: false })
    .limit(500);
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
  if (!SupabaseClient) return;
  const { data } = await SupabaseClient
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

document.addEventListener('DOMContentLoaded', () => { init(); loadSettings(); ensureAssistanceArrays(); });

function init() {
  try { IsRecoveryUrl_ = computeIsRecoveryUrl_(); } catch { IsRecoveryUrl_ = false; }
  try { AuthBusy_ = false; } catch { }
  try {
    window.addEventListener('beforeunload', () => {
      try {
        if (!getRememberMe_()) localStorage.removeItem('sb-session');
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
  // auth session events
  try {
    if (SupabaseClient?.auth?.onAuthStateChange) {
      SupabaseClient.auth.onAuthStateChange(async (_event, session) => {
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
  if (!SessionRecoveryInProgress_) {
    void restoreSupabaseSession();
  }
  try { buildUserPermissionsUi_({}); } catch { }

  try { if (!IsRecoveryUrl_) void detectRecoveryFlow_(); } catch { }
}

async function sendPasswordResetEmail_() {
  const hint = document.getElementById('loginHint');
  try { if (hint) { hint.classList.remove('hidden'); hint.textContent = 'جارٍ إرسال رابط إعادة تعيين كلمة المرور...'; } } catch { }
  if (!SupabaseClient) {
    try { if (hint) hint.textContent = 'تعذر الاتصال بقاعدة البيانات (Supabase)'; } catch { }
    return;
  }
  try {
    const raw = (document.getElementById('username')?.value || '').toString().trim();
    if (!raw) {
      try { if (hint) hint.textContent = 'اكتب اسم المستخدم أو البريد أولاً'; } catch { }
      return;
    }
    const candidates = [];
    if (raw.includes('@')) {
      candidates.push(raw);
      candidates.push(raw.toLowerCase());
    } else {
      candidates.push(`${raw}@app.local`);
      candidates.push(`${raw.toLowerCase()}@app.local`);
      try { candidates.push(usernameToEmail(raw)); } catch { }
    }
    const uniq = Array.from(new Set(candidates.map(s => (s || '').toString().trim()).filter(Boolean)));
    const email = uniq[0];
    if (!email) {
      try { if (hint) hint.textContent = 'تعذر تحديد البريد الإلكتروني'; } catch { }
      return;
    }

    const redirectTo = `${location.origin}${location.pathname}`;
    const res = await SupabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (res?.error) throw res.error;
    try { if (hint) hint.textContent = 'تم إرسال رابط إعادة تعيين كلمة المرور إلى البريد (إن كان موجوداً). افحص البريد الوارد والـSpam.'; } catch { }
    try { showToast_('تم إرسال رابط إعادة تعيين كلمة المرور (إن كان البريد موجوداً).', 'success'); } catch { }
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
  if (!SupabaseClient) return;
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
    if (SupabaseClient.auth.getSessionFromUrl) {
      await runAuthOp_(() => SupabaseClient.auth.getSessionFromUrl({ storeSession: true }));
    } else if (SupabaseClient.auth.exchangeCodeForSession && raw.includes('code=')) {
      await runAuthOp_(() => SupabaseClient.auth.exchangeCodeForSession(location.href));
    } else {
      const h = (location.hash || '').toString().replace(/^#/, '');
      const p = new URLSearchParams(h);
      const access_token = (p.get('access_token') || '').toString();
      const refresh_token = (p.get('refresh_token') || '').toString();
      if (access_token && refresh_token && SupabaseClient.auth.setSession) {
        await runAuthOp_(() => SupabaseClient.auth.setSession({ access_token, refresh_token }));
      }
    }
  } catch (e) {
    try { console.error('exchangeCodeForSession error:', e); } catch { }
  } finally {
    AuthBusy_ = false;
  }

  try {
    const { data } = await SupabaseClient.auth.getSession();
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

  if (!SupabaseClient) {
    try { if (hint) hint.textContent = 'تعذر الاتصال بقاعدة البيانات (Supabase)'; } catch { }
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
    if (p1.trim().length < 6) {
      if (hint) hint.textContent = 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل';
      return;
    }
    if (p1 !== p2) {
      if (hint) hint.textContent = 'كلمة المرور وتأكيدها غير متطابقين';
      return;
    }

    const res = await withTimeout_(
      runAuthOp_(() => SupabaseClient.auth.updateUser({ password: p1 })),
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
        runAuthOp_(() => SupabaseClient.auth.signOut(), { retryLock: true }),
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

  const username = (document.getElementById('username')?.value || '').toString().trim();
  const password = (document.getElementById('password')?.value || '').toString();
  if (!username || !password) {
    try { if (errBox) errBox.classList.remove('hidden'); } catch { }
    AuthBusy_ = false;
    try { if (submitBtn) submitBtn.removeAttribute('disabled'); } catch { }
    return;
  }
  if (!SupabaseClient) {
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
    const unameRaw = (username || '').toString().trim();
    const candidates = [];
    if (unameRaw.includes('@')) {
      candidates.push(unameRaw);
      candidates.push(unameRaw.toLowerCase());
    } else {
      candidates.push(`${unameRaw}@app.local`);
      candidates.push(`${unameRaw.toLowerCase()}@app.local`);
      candidates.push(usernameToEmail(unameRaw));
    }
    const uniq = Array.from(new Set(candidates.map(s => (s || '').toString().trim()).filter(Boolean)));

    let lastErr = null;
    let data = null;
    for (const email of uniq) {
      try {
        const res = await runAuthOp_(() => SupabaseClient.auth.signInWithPassword({ email, password }));
        if (res?.error) { lastErr = res.error; continue; }
        data = res?.data || null;
        if (data?.user) break;
      } catch (ex) {
        lastErr = ex;
      }
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
    // Better hint: profile may exist but auth user/password is wrong or user was not created in Supabase Auth.
    try {
      const unameKey = (username || '').toString().trim();
      let profRow = null;
      try {
        const q = await SupabaseClient
          .from('profiles')
          .select('id,username,is_active')
          .eq('username', unameKey)
          .maybeSingle();
        if (!q?.error) profRow = q?.data || null;
      } catch { profRow = null; }

      if (profRow && profRow.is_active === false) {
        alert('هذا المستخدم معطّل. راجع الإدارة لإعادة التفعيل.');
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
        const emailHint = usernameToEmail(unameKey);
        alert('اسم المستخدم موجود، لكن تعذر تسجيل الدخول.\n\nالأسباب الشائعة:\n- كلمة المرور غير صحيحة\n- المستخدم لم يتم إنشاؤه داخل Supabase (Authentication → Users) بنفس البريد\n\nالبريد الذي يتوقعه النظام غالباً: ' + emailHint + '\n\nملاحظة: إذا كان حسابك في Supabase معمول ببريد مختلف (مثل Gmail)، اكتب البريد الكامل في خانة "اسم المستخدم".');
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
    if (SupabaseClient?.auth?.signOut) {
      await withTimeout_(
        runAuthOp_(() => SupabaseClient.auth.signOut(), { retryLock: true }),
        7000,
        'timeout'
      );
    }
  } catch { }
  // Ensure local persisted session is cleared even if signOut fails.
  try { localStorage.removeItem('sb-session'); } catch { }
  try {
    AppState.currentUser = null;
    AppState.isAuthenticated = false;
  } catch { }
  try { showLoginScreen_(); } catch { }
  // Avoid requiring a manual reload to make login responsive.
  try { setTimeout(() => { try { location.reload(); } catch { } }, 200); } catch { }
}

function showSection(key, navBtnId) {
  const map = {
    newCase: 'newCaseSection',
    casesList: 'casesListSection',
    dashboard: 'dashboardSection',
    reports: 'reportsSection',
    audit: 'auditSection',
    settings: 'settingsSection',
    userManagement: 'userManagementSection',
    medicalCommittee: 'medicalCommitteeSection'
  };
  const all = Object.values(map);
  all.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const targetId = map[key] || key;
  const target = document.getElementById(targetId);
  if (target) target.classList.remove('hidden');

  try { refreshDerivedViewsIfNeeded_(targetId); } catch { }

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

  if (targetId === 'userManagementSection') {
    try { syncSettingsPermissionsUi_(); } catch { }
    try { setTimeout(() => { try { void renderUsersList(); } catch { } }, 0); } catch { }
  }

  try {
    Array.from(document.querySelectorAll('#mainNav .nav-btn')).forEach(b => b.classList.remove('active'));
    if (navBtnId) {
      const btn = document.getElementById(navBtnId);
      if (btn) btn.classList.add('active');
    }
  } catch { }
}

async function restoreSupabaseSession() {
  if (!SupabaseClient) return;
  if (AuthBusy_) return;
  if (IsRecoveryUrl_) return;
  const { data: sess, error } = await runAuthOp_(() => SupabaseClient.auth.getSession(), { retryLock: false });
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
    try { console.error('restoreSupabaseSession error:', e); } catch { }
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
  return { q, explorer, gov, area, grade, cats };
}

function updateCasesListUiState_() {
  try {
    const s = getCasesListFiltersState_();
    const hasLocal = !!(s.q || s.explorer || s.gov || s.area || s.grade || s.cats);
    const btn = document.getElementById('casesClearFiltersBtn');
    if (btn) btn.classList.toggle('hidden', !hasLocal);
  } catch { }
}

function clearCasesListFilters() {
  try { if (window.caseSearch) caseSearch.value = ''; } catch { }
  try { if (window.filterExplorer) filterExplorer.value = ''; } catch { }
  try { if (window.filterGovernorate) filterGovernorate.value = ''; } catch { }
  try { if (window.filterArea) filterArea.value = ''; } catch { }
  try { if (window.filterCaseGrade) filterCaseGrade.value = ''; } catch { }
  try {
    if (window.filterCategoriesGroup) {
      const boxes = filterCategoriesGroup.querySelectorAll('input[type="checkbox"]');
      boxes.forEach(b => { b.checked = false; });
    }
  } catch { }
  try { renderCasesTable(); } catch { }
  try { updateCasesListUiState_(); } catch { }
}

function exportFilteredCasesToExcel() {
  const list = getFilteredCases();
  if (!list.length) { alert('لا توجد حالات للتصدير'); return; }

  const sumNum = (v) => Number(v ?? 0) || 0;
  const needOf = (c) => Math.max(0, sumNum(c.estimatedAmount) - sumNum(c.deliveredAmount));

  const headers = [
    'رقم الحالة',
    'اسم الحالة',
    'الرقم القومي',
    'الهاتف',
    'رقم واتساب',
    'العنوان',
    'المحافظة',
    'المنطقة',
    'الفئة',
    'الحالة',
    'الاستعجال',
    'تقييم الحالة',
    'المستكشف',
    'تاريخ البحث',
    'مبلغ تقديري',
    'مبلغ منفذ',
    'الاحتياج',
    'عدد الكفالات المسجلة',
    'إجمالي الكفالات المسجلة',
    'تاريخ آخر كفالة',
    'عدد المساعدات (غير الكفالة)',
    'إجمالي المساعدات (غير الكفالة)'
  ];
  const rows = [headers];
  list.forEach(c => {
    const hist = Array.isArray(c.assistanceHistory) ? c.assistanceHistory : [];
    const spons = hist.filter(x => (x?.type || '') === 'sponsorship');
    const other = hist.filter(x => (x?.type || '') && (x?.type || '') !== 'sponsorship');
    const sponsCount = spons.length;
    const sponsTotal = spons.reduce((a, x) => a + (Number(x?.amount ?? 0) || 0), 0);
    const lastSponsDate = spons.length ? String(spons.map(x => x?.date || '').sort().slice(-1)[0] || '') : '';
    const otherCount = other.length;
    const otherTotal = other.reduce((a, x) => a + (Number(x?.amount ?? 0) || 0), 0);
    rows.push([
      String(c.caseNo ?? ''),
      String(c.familyHead ?? ''),
      String(c.id ?? ''),
      String(c.phone ?? ''),
      String(c.whatsapp ?? ''),
      String(c.address ?? ''),
      String(c.governorate ?? ''),
      String(c.area ?? ''),
      String(c.category ?? ''),
      String(c.status ?? ''),
      String(c.urgency ?? ''),
      String(c.caseGrade ?? ''),
      String(c.explorerName ?? ''),
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

  const fname = `cases-view-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    let csv = headers.join(',') + '\n';
    rows.slice(1).forEach(r => {
      csv += r.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',') + '\n';
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
  const ok2 = confirm('تحذير: هذه العملية قد تحذف البيانات من قاعدة البيانات (Supabase) وتستبدلها بالكامل. هل تريد المتابعة؟');
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
    if (SupabaseClient) {
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
  // Persist to Supabase (sequential to avoid concurrent auth.getUser lock aborts)
  try {
    if (SupabaseClient) {
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
    showSection('medicalCommittee', 'navReportsBtn');
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
  const gov = window.filterGovernorate ? filterGovernorate.value : '';
  const areaTxt = window.filterArea ? filterArea.value.trim() : '';
  const grade = window.filterCaseGrade ? filterCaseGrade.value : '';
  const q = window.caseSearch ? caseSearch.value.trim() : '';
  const explorerQ = window.filterExplorer ? filterExplorer.value.trim() : '';
  const catsHost = window.filterCategoriesGroup ? filterCategoriesGroup : null;
  const selectedCats = catsHost ? Array.from(catsHost.querySelectorAll('input[type="checkbox"]')).filter(b => b.checked).map(b => b.value) : [];
  const dashKey = AppState.dashboardFilter?.key;
  return AppState.cases.filter(x => {
    const okGov = !gov || x.governorate === gov;
    const okArea = !areaTxt || (x.area || '').includes(areaTxt);
    const okGrade = !grade || (x.caseGrade || '') === grade;
    const okCats = !selectedCats.length || selectedCats.some(c => (x.category || '').includes(c));
    const hay = [x.id, x.familyHead, x.phone, x.address, x.governorate, x.area, x.category, x.explorerName, x.date]
      .map(v => (v || '').toString())
      .join(' ');
    const okQ = !q || hay.toLowerCase().includes(q.toLowerCase());
    const ex = (x.explorerName || '').toString();
    const okExplorer = !explorerQ || ex.toLowerCase().includes(explorerQ.toLowerCase());
    const okDash = !dashKey || matchesDashboardFilter(x, dashKey);
    return okGov && okArea && okGrade && okCats && okQ && okExplorer && okDash;
  });
}

function renderCasesTable() {
  const list = getFilteredCases();
  const grid = document.getElementById('casesCardsGrid');
  if (!grid) return;
  const cards = list.map(x => {
    if (!Array.isArray(x.sponsorships)) x.sponsorships = [];
    if (!Array.isArray(x.assistanceHistory)) x.assistanceHistory = [];
    const lastSponsor = getLastSponsorship(x);
    const sponsorLabel = formatSponsorshipLabel(lastSponsor);
    const title = (x.familyHead || '').toString().trim() || x.id;
    const urgencyClass = x.urgency === 'عاجل جدًا' ? 'b-new' : x.urgency === 'عاجل' ? 'b-proc' : 'b-done';
    const statusClass = x.status === 'جديدة' ? 'b-new' : x.status === 'محولة' ? 'b-proc' : 'b-done';
    const shortDesc = (x.description || '').toString().trim();
    const clipped = shortDesc.length > 140 ? shortDesc.slice(0, 140) + '…' : shortDesc;
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
            <span class="badge ${urgencyClass}">${escapeHtml((x.urgency || '').toString())}</span>
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
          <button type="button" class="btn" onclick="openSingleSponsorshipModal('${x.id}')">💳 دفع الكفالة الشهرية</button>
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
        '<option>حالة مستديمة</option>',
        '<option>حالة موسمية</option>',
        '<option>حالة مرفوضة</option>',
        '<option>حالة قيد الانتظار</option>'
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
    if (start) start.value = new Date().toISOString().slice(0, 10);
    if (amt) amt.value = '';
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
    if (start) start.value = new Date().toISOString().slice(0, 10);
    if (amt) amt.value = '';
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
    if (start) start.value = '';
    if (amt) amt.value = '';
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
  const details = document.getElementById('casePanelDetails');
  const payments = document.getElementById('casePanelPayments');
  if (details) details.classList.toggle('hidden', k !== 'details');
  if (payments) payments.classList.toggle('hidden', k !== 'payments');
  try { syncCaseDetailsButtons(); } catch { }
}

function syncCaseDetailsButtons() {
  const k = (AppState.caseDetailsTab || 'details').toString();
  const detailsBtn = document.getElementById('caseTabDetails');
  const payBtn = document.getElementById('caseTabPayments');
  if (detailsBtn) {
    detailsBtn.classList.toggle('light', k !== 'details');
    if (k === 'details') {
      try { detailsBtn.removeAttribute('style'); } catch { }
    } else {
      try { detailsBtn.style.color = '#1f2937'; detailsBtn.style.borderColor = '#e5e7eb'; } catch { }
    }
  }
  if (payBtn) {
    payBtn.classList.toggle('light', k !== 'payments');
    if (k === 'payments') {
      try { payBtn.removeAttribute('style'); } catch { }
    } else {
      try { payBtn.style.color = '#1f2937'; payBtn.style.borderColor = '#e5e7eb'; } catch { }
    }
  }

  try {
    const canEdit = hasPerm('cases_edit');
    const mode = (AppState.caseDetailsMode || 'view').toString();
    const toggleBtn = document.getElementById('caseEditToggleBtn');
    const delBtn = document.getElementById('deleteCaseBtn');
    const printBtn = document.getElementById('printCaseBtn');
    const shotBtn = document.getElementById('paymentsScreenshotBtn');
    const detailsShotBtn = document.getElementById('caseDetailsScreenshotBtn');
    const inPayments = k === 'payments';
    if (toggleBtn) {
      toggleBtn.style.display = (canEdit && !inPayments) ? 'inline-flex' : 'none';
      if (mode === 'edit') {
        toggleBtn.textContent = '💾 حفظ التعديلات';
        toggleBtn.classList.add('primary-save');
      } else {
        toggleBtn.textContent = '✏️ تعديل';
        toggleBtn.classList.remove('primary-save');
      }
    }
    if (delBtn) delBtn.style.display = (canEdit && !inPayments) ? 'inline-flex' : 'none';
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
    if (start) start.value = new Date().toISOString().slice(0, 10);
    if (amt) amt.value = '';
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
    if (changed) { try { if (SupabaseClient) void upsertCaseToDb(it); } catch { } }
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
    if (changed) { try { if (SupabaseClient) void upsertCaseToDb(it); } catch { } }
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

  try {
    if (SupabaseClient) {
      await upsertCaseToDb(it);
    }
  } catch (e) {
    try { console.error('upsertCaseToDb (edit payment) error:', e); } catch { }
    await onSupabaseWriteError_('تعذر حفظ التعديل في قاعدة البيانات حالياً.', e);
    return;
  }
  try {
    if ((AppState.currentCaseId || '') === caseId) {
      const panel = document.getElementById('casePanelPayments');
      if (panel) panel.innerHTML = renderPaymentsTabHtml_(it);
      setCaseDetailsTab('payments');
    }
  } catch { }
  renderCasesTable();
  try { updateDashboardStats(); } catch { }
  try { generateReportPreview(); } catch { }
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

  try {
    if (SupabaseClient) {
      await upsertCaseToDb(it);
    }
  } catch (e) {
    try { console.error('upsertCaseToDb (delete payment) error:', e); } catch { }
    await onSupabaseWriteError_('تعذر حذف العملية من قاعدة البيانات حالياً.', e);
    return;
  }
  try {
    if ((AppState.currentCaseId || '') === caseId) {
      const panel = document.getElementById('casePanelPayments');
      if (panel) panel.innerHTML = renderPaymentsTabHtml_(it);
      setCaseDetailsTab('payments');
    }
  } catch { }
  renderCasesTable();
  try { updateDashboardStats(); } catch { }
  try { generateReportPreview(); } catch { }
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
  const amountRaw = (document.getElementById('sponsorAmount')?.value || '').toString().trim();
  const amount = Number(amountRaw);
  if (!startDate) { alert('تاريخ بداية الكفالة مطلوب'); return; }
  if (!amountRaw || Number.isNaN(amount) || amount <= 0) { alert('قيمة الكفالة مطلوبة'); return; }

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
  const record = { uid: `${createdAt}__${Math.random().toString(16).slice(2)}`, type: 'sponsorship', date: startDate, amount, createdAt, byName, byUser };

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
        if (SupabaseClient) {
          await upsertCaseToDb(it);
          try { console.log('Sponsorship saved to DB for case:', id); } catch { }
        }
      } catch (e) {
        try { console.error('upsertCaseToDb (sponsorship) error:', e); } catch { }
        failed.push({ id, message: e?.message || 'خطأ غير معروف' });
      }
      updated += 1;
    }

    try {
      renderCasesTable();
      try { updateDashboardStats(); } catch { }
      try { generateReportPreview(); } catch { }
      try {
        const scope = (document.getElementById('sponsorScope')?.value || (singleId ? 'selected' : 'selected')).toString();
        logAction('تسليم كفالة', '', `scope: ${scope} | عدد الحالات: ${updated} | failed: ${failed.length}`);
      } catch {
        logAction('تسليم كفالة', '', `عدد الحالات: ${updated} | failed: ${failed.length}`);
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

    try { logAction('إضافة كفالة', '', `عدد الحالات: ${updated} | failed: ${failed.length}`); } catch { }

    if (failed.length) {
      const msg = failed.slice(0, 8).map(x => `${x.id}: ${x.message}`).join('\n');
      setTimeout(() => alert(`تعذر حفظ بعض عمليات الكفالة في قاعدة البيانات (${failed.length}).\n\n${msg}`), 100);
      try { await reloadCasesFromSupabase_(); } catch { }
      return;
    }
    setTimeout(() => alert(`تم تسجيل الكفالة لعدد ${updated} حالة`), 100);
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
  try {
    if (SupabaseClient) {
      await upsertCaseToDb(it);
      try { console.log('Assistance saved to DB for case:', caseId, 'Type:', finalType); } catch { }
    }
  } catch (e) {
    try { console.error('upsertCaseToDb (assistance) error:', e); } catch { }
    await onSupabaseWriteError_('تعذر حفظ المساعدة في قاعدة البيانات حالياً.', e);
    return;
  }
  renderCasesTable();
  try { updateDashboardStats(); } catch { }
  try { generateReportPreview(); } catch { }
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
  renderCasesTable();
  try { updateCasesListUiState_(); } catch { }
}
function updateCaseStatus(id, val) {
  if (!hasPerm('case_status_change')) { alert('لا تملك صلاحية تغيير الحالة'); return; }
  const it = AppState.cases.find(x => x.id === id);
  if (it) {
    it.status = val; renderCasesTable();
    try { if (SupabaseClient) void upsertCaseToDb(it); } catch { }
    sendStatusUpdateToSheets({ id: it.id, status: it.status });
    logAction('تغيير حالة', it.id, val);
  }
}

// Settings UI & Storage
function loadSettings() {
  try { AppState.settings = { url: null, token: null, regions: [], activeRegion: null }; } catch { AppState.settings = { url: null, token: null, regions: [], activeRegion: null } }
}
function saveSettings() {
  const tokenEl = document.getElementById('settingsTokenInput');
  if (!tokenEl) return;
  const token = (tokenEl.value || '').trim();
  if (!token) return;
  AppState.settings = { ...AppState.settings, url: AppState.googleSheetsUrl, token: token || null };
  try {
    const b = document.getElementById('syncBadge');
    if (b) b.textContent = '';
  } catch { }
  alert('تم حفظ الإعدادات');
}
function openSettings() {
  if (!hasPerm('settings')) { alert('لا تملك صلاحية فتح الإعدادات'); return; }
  const m = document.getElementById('settingsModal');
  if (!m) return;
  const urlInput = document.getElementById('settingsUrlInput');
  if (urlInput) {
    urlInput.value = AppState.googleSheetsUrl || '';
    urlInput.readOnly = true;
  }
  const tokenEl = document.getElementById('settingsTokenInput');
  if (tokenEl) tokenEl.value = AppState.settings.token || '';
  try { renderUsersList(); } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
}
function closeSettings() { const m = document.getElementById('settingsModal'); m.classList.remove('show'); m.setAttribute('aria-hidden', 'true'); }
function getConfiguredUrl() { return AppState.googleSheetsUrl }
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
  renderRegions(); populateRegionSelect();
}
function removeRegion() {
  const name = (document.getElementById('regionNameInput').value || '').trim();
  if (!name) { alert('أدخل اسم المنطقة لحذفها'); return; }
  AppState.settings.regions = (AppState.settings.regions || []).filter(r => r.name !== name);
  if (AppState.settings.activeRegion === name) AppState.settings.activeRegion = null;
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

  const total = cases.length;
  const done = cases.filter(c => c.status === 'منفذة').length;
  const urgent = cases.filter(c => c.urgency === 'عاجل' || c.urgency === 'عاجل جدًا').length;
  const medical = cases.filter(c => c.category === 'عمليات طبية' || c.category === 'كفالات مرضية').length;
  const rate = total ? ((done / total) * 100).toFixed(1) : 0;
  const byGov = {}; cases.forEach(c => { const g = c.governorate || 'غير محدد'; byGov[g] = (byGov[g] || 0) + 1 });
  const topGov = Object.entries(byGov).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([g, n]) => `<div style=\"display:flex;justify-content:space-between\"><span>${g}</span><strong>${n}</strong></div>`).join('');
  host.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      <div class="section"><div style="font-weight:700;font-size:22px">${total}</div>إجمالي الحالات</div>
      <div class="section"><div style="font-weight:700;font-size:22px">${done}</div>الحالات المنفذة</div>
      <div class="section"><div style="font-weight:700;font-size:22px">${rate}%</div>نسبة الإنجاز</div>
      <div class="section"><div style="font-weight:700;font-size:22px">${urgent}</div>العاجلة</div>
      <div class="section"><div style="font-weight:700;font-size:22px">${medical}</div>الطبية</div>
      <div class="section"><div style="font-weight:700;margin-bottom:6px">حسب المحافظة</div>${topGov || 'لا بيانات'}</div>
    </div>`
  try { renderAuditLog(); } catch { }
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
    const coreIdentity = `<div style="grid-column:1/-1">${viewSection('القسم 1: بيانات أساسية', [
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

    const adminClassify = `<div style="grid-column:1/-1">${viewSection('القسم 2: التصنيف الإداري', [
      viewBox('نوع الحالة', it.category || ''),
      viewBox('أولوية الحالة', it.urgency || ''),
      viewBox('حالة الطلب', it.status || '')
    ].join(''))}</div>`;

    const incomeExpensesHtml = `<div style="grid-column:1/-1">${viewSection('القسم 3: الدخل والمصروفات', [
      viewBox('إجمالي الدخل', income.total ?? ''),
      viewBox('ملاحظات الدخل', income.notes || ''),
      viewBox('إجمالي المصروفات', expenses.total ?? ''),
      viewBox('ملاحظات المصروفات', expenses.notes || ''),
      viewBox('صافي شهري', it.netMonthly ?? '')
    ].join(''))}</div>`;

    const housingHtml = `<div style="grid-column:1/-1">${viewSection('القسم 5: السكن', [
      viewBox('عدد الغرف', housing.roomsCount ?? ''),
      viewBox('نوع السقف', housing.roofExists || ''),
      viewBox('مياه', housing.waterExists || ''),
      viewBox('حمام', housing.bathroomType || ''),
      viewBox('نوع المنطقة', housing.areaType || ''),
      viewBox('وصف السكن', housing.housingDesc || '')
    ].join(''))}</div>`;

    const hasDebts = !!debts.enabled || !!(debts.amount ?? '') || !!(debts.owner || '').toString().trim() || !!(debts.reason || '').toString().trim() || !!(debts.hasCourtOrder || '').toString().trim();
    const debtsHtml = `<div style="grid-column:1/-1">${viewSection('القسم 6: الديون', [
      viewBox('قيمة الدين', debts.amount ?? ''),
      viewBox('سبب الدين', debts.reason || ''),
      viewBox('جهة الدين', debts.owner || ''),
      viewBox('حكم قضائي (نعم/لا)', debts.hasCourtOrder || ''),
      viewBox('هل توجد ديون؟', hasDebts ? (debts.enabled ? 'نعم' : 'نعم (غير محدد)') : 'لا')
    ].join(''))}</div>`;

    const medicalCases = Array.isArray(it.medicalCases) ? it.medicalCases : [];
    const medicalHtml = `<div style="grid-column:1/-1">${viewSection('القسم 7: الجانب الطبي', medicalCases.length
      ? medicalCases.map((m, i) => viewBox(`حالة طبية #${i + 1}`, [
        `الاسم: ${m?.name || ''}`,
        `نوع المرض: ${m?.diseaseType || ''}`,
        `درجة الخطورة: ${m?.specialty || ''}`,
        `التكلفة التقديرية: ${m?.estimatedCost || ''}`,
        `المطلوب: ${m?.required || ''}`,
        `المستشفى: ${m?.hospital || ''}`
      ].filter(Boolean).join('\n'))).join('')
      : viewBox('لا توجد بيانات طبية', '—'))}</div>`;

    const needsHtml = `<div style="grid-column:1/-1">${viewSection('القسم 8: الاحتياجات', [
      viewBox('احتياجات مصنفة', it.category || ''),
      viewBox('وصف احتياجات إضافي', [it.needsShort || '', it.familyNeeds || ''].filter(Boolean).join('\n'))
    ].join(''))}</div>`;

    const reportHtml = `<div style="grid-column:1/-1">${viewSection('القسم 9: تقرير الباحث', [
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
    body.innerHTML = `
      <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-start;flex-wrap:wrap;margin-bottom:10px">
        <button id="caseTabDetails" type="button" class="btn" onclick="setCaseDetailsTab('details')">تفاصيل الحالة</button>
        <button id="caseTabPayments" type="button" class="btn light" onclick="setCaseDetailsTab('payments')" style="color:#1f2937;border-color:#e5e7eb">المدفوعات/المساعدات</button>
      </div>
      <div id="casePanelDetails" style="grid-column:1/-1">${detailsHtml}</div>
      <div id="casePanelPayments" class="hidden" style="grid-column:1/-1">${paymentsHtml}</div>
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
  body.innerHTML = `
    <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-start;flex-wrap:wrap;margin-bottom:10px">
      <button id="caseTabDetails" type="button" class="btn" onclick="setCaseDetailsTab('details')">تفاصيل الحالة</button>
      <button id="caseTabPayments" type="button" class="btn light" onclick="setCaseDetailsTab('payments')" style="color:#1f2937;border-color:#e5e7eb">المدفوعات/المساعدات</button>
    </div>
    <div id="casePanelDetails" class="grid cols-2" style="grid-column:1/-1">${detailsFormHtml}</div>
    <div id="casePanelPayments" class="hidden" style="grid-column:1/-1">${paymentsHtml}</div>
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

function deleteCurrentCase() {
  if (!hasPerm('cases_delete')) { alert('لا تملك صلاحية حذف الحالة'); return; }
  const id = AppState.currentCaseId || document.getElementById('d_id')?.value;
  if (!id) return;
  const it = AppState.cases.find(c => c.id === id);
  const title = it ? (it.familyHead || it.id || '') : id;
  if (!confirm(`هل تريد حذف الحالة نهائياً؟\n${title}`)) return;

  let reason = '';
  try { reason = (prompt('سبب حذف الحالة (إجباري):') || '').toString().trim(); } catch { reason = ''; }
  if (!reason) { alert('سبب الحذف مطلوب'); return; }

  (async () => {
    const beforeList = Array.isArray(AppState.cases) ? AppState.cases.slice() : [];
    const snapshot = it ? JSON.parse(JSON.stringify(it)) : null;
    AppState.cases = (AppState.cases || []).filter(c => c.id !== id);
    try { renderCasesTable(); } catch { }
    try { updateDashboardStats(); } catch { }
    try { updateNavBadges(); } catch { }

    try {
      const payload = JSON.stringify({ reason, case: snapshot, deletedAt: new Date().toISOString() });
      await logAction('حذف حالة', id, `سبب: ${reason} | data:${payload}`);
    } catch { }

    try {
      if (SupabaseClient) await deleteCaseFromDb(id);
    } catch (e) {
      AppState.cases = beforeList;
      try { renderCasesTable(); } catch { }
      try { updateDashboardStats(); } catch { }
      try { updateNavBadges(); } catch { }
      alert(`تعذر حذف الحالة من قاعدة البيانات.\n\nالخطأ: ${e?.message || 'خطأ غير معروف'}`);
      return;
    }

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
    const beforeList = Array.isArray(AppState.cases) ? AppState.cases.slice() : [];
    const snapshot = JSON.parse(JSON.stringify(beforeList || []));
    AppState.cases = [];
    try { renderCasesTable(); } catch { }
    try { updateDashboardStats(); } catch { }
    try { updateNavBadges(); } catch { }

    try {
      const payload = JSON.stringify({ count, cases: snapshot, deletedAt: new Date().toISOString() });
      await logAction('حذف جميع الحالات', '', `count:${count} | data:${payload}`);
    } catch { }

    try {
      if (SupabaseClient) await deleteAllCasesFromDb();
    } catch (e) {
      AppState.cases = beforeList;
      try { renderCasesTable(); } catch { }
      try { updateDashboardStats(); } catch { }
      try { updateNavBadges(); } catch { }
      alert(`تعذر حذف جميع الحالات من قاعدة البيانات.\n\nالخطأ: ${e?.message || 'خطأ غير معروف'}`);
      return;
    }

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

function saveCaseEdits() {
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
  Object.assign(it, updated);
  try { AppState.caseDetailsDirty = false; } catch { }
  try { AppState.caseDetailsMode = 'view'; } catch { }
  try { AppState.caseDetailsOriginal = null; } catch { }
  try { void upsertCaseToDb(it); } catch { }
  renderCasesTable(); updateDashboardStats(); generateReportPreview();
  try { updateNavBadges(); } catch { }
  logAction('تعديل حالة', it.id, 'تم تعديل البيانات');
  closeCaseDetails();
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
  if (!SupabaseClient) return [];
  const canManage = hasPerm('users_manage');
  if (canManage) {
    const baseSel = 'id,username,full_name,permissions,is_active,updated_at,last_seen_at';
    const q = await SupabaseClient
      .from('profiles')
      .select(baseSel)
      .order('updated_at', { ascending: false })
      .limit(5000);
    if (q.error) throw q.error;
    return q.data || [];
  }

  // Safer readonly list for managers: use a restricted RPC (no permissions leakage)
  const q2 = await SupabaseClient.rpc('list_profiles_public');
  if (q2.error) throw q2.error;
  return q2.data || [];
}

function getPermPreset_(kind) {
  const on = (keys) => {
    const o = {};
    (keys || []).forEach(k => { o[k] = true; });
    return o;
  };
  if (kind === 'explorer') {
    return on(['cases_create', 'cases_read', 'case_status_change']);
  }
  if (kind === 'manager') {
    return on(['cases_create', 'cases_read', 'case_status_change', 'cases_edit', 'cases_delete', 'dashboard', 'audit']);
  }
  if (kind === 'super_admin') {
    return getAllPermissionsOn_();
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
  if (!SupabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
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

    if (newPass.trim().length < 6) {
      if (hint) { hint.style.display = 'block'; hint.textContent = 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل'; }
      else alert('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
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
        const u = await SupabaseClient.auth.getUser();
        email = (u?.data?.user?.email || '').toString().trim();
      } catch { }
    }
    if (!email) {
      if (hint) { hint.style.display = 'block'; hint.textContent = 'تعذر تحديد البريد الإلكتروني للمستخدم'; }
      else alert('تعذر تحديد البريد الإلكتروني للمستخدم');
      return;
    }

    try {
      const reauth = await SupabaseClient.auth.signInWithPassword({ email, password: oldPass });
      if (reauth?.error) throw reauth.error;
    } catch (e) {
      try { console.error('reauth error:', e); } catch { }
      const msg = (e?.message || e?.error_description || '').toString().trim();
      if (hint) { hint.style.display = 'block'; hint.textContent = msg ? `تعذر التحقق من كلمة المرور القديمة: ${msg}` : 'كلمة المرور القديمة غير صحيحة'; }
      else alert(msg ? `تعذر التحقق من كلمة المرور القديمة: ${msg}` : 'كلمة المرور القديمة غير صحيحة');
      return;
    }

    try {
      const res = await SupabaseClient.auth.updateUser({ password: newPass });
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
  if (!SupabaseClient) { host.textContent = 'تعذر الاتصال بقاعدة البيانات'; return; }
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
      return `<div class="user-item" role="button" tabindex="0" onclick="openUserActionsModal('${escapeHtml(safe)}')">
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
          const q1 = await SupabaseClient.from('profiles').select('id,username,full_name,is_active,email').eq('username', uname).maybeSingle();
          data = q1.data; error = q1.error;
        } catch (e1) {
          error = e1;
        }
        if (error) {
          try {
            const q2 = await SupabaseClient.from('profiles').select('id,username,full_name,is_active').eq('username', uname).maybeSingle();
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
    const { data, error } = await SupabaseClient.from('profiles').select('id,is_active').eq('username', uname).maybeSingle();
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
    return `<label class="perm-item"><input type="checkbox" class="perm-box" data-perm="${escapeHtml(k)}" ${checked}> <span>${escapeHtml(permissionLabel(k))}</span></label>`;
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
  if (!SupabaseClient) return;
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
    const { data, error } = await SupabaseClient.from('profiles').select('id,username,permissions').eq('username', uname).maybeSingle();
    if (error) throw error;
    const p = data?.permissions && typeof data.permissions === 'object' ? data.permissions : {};
    if (meta) meta.textContent = `المستخدم: ${uname}`;
    try { buildUserPermsModalUi_(p); } catch { }
  } catch (e) {
    try { console.error('openUserPermissionsModal_ error:', e); } catch { }
    if (meta) meta.textContent = `المستخدم: ${uname}`;
    if (hint) { hint.style.display = 'block'; hint.textContent = 'تعذر تحميل الصلاحيات'; }
  } finally {
    try { if (btn) btn.removeAttribute('disabled'); } catch { }
  }

  closeUserActionsModal();
  try { document.body.classList.add('modal-open'); } catch { }
  m.classList.add('show');
  m.setAttribute('aria-hidden', 'false');
  try { document.getElementById('userPermSaveBtn')?.focus?.(); } catch { }
}

async function saveUserPermissions_() {
  if (!SupabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
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

    const { data: existing, error: exErr } = await SupabaseClient.from('profiles').select('id').eq('username', uname).maybeSingle();
    if (exErr || !existing?.id) throw (exErr || new Error('not found'));
    const { error } = await SupabaseClient.from('profiles').update({ permissions }).eq('id', existing.id);
    if (error) throw error;
    try { await logAction('تحديث صلاحيات مستخدم', '', `target: ${uname}`); } catch { }
    try { await renderUsersList(); } catch { }
    closeUserPermissionsModal();
    try { showToast_('تم حفظ الصلاحيات', 'success'); } catch { }
  } catch (e) {
    try { console.error('saveUserPermissions_ error:', e); } catch { }
    if (hint) { hint.style.display = 'block'; hint.textContent = 'تعذر حفظ الصلاحيات'; }
  } finally {
    try { if (btn) btn.removeAttribute('disabled'); } catch { }
  }
}

async function userActionsDelete_() {
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  if (!SupabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  const m = document.getElementById('userActionsModal');
  if (!m) return;
  const uname = (m.getAttribute('data-username') || '').toString().trim();
  if (!uname) return;
  const ok = confirm(`حذف المستخدم نهائياً من ملفه (profiles): ${uname} ؟\n\nملاحظة: هذا لا يحذف مستخدم Supabase Auth إلا إذا كان لديك وظيفة مخصصة لذلك.`);
  if (!ok) return;
  const hint = document.getElementById('userActionsHint');
  if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
  try {
    const { data: existing, error: exErr } = await SupabaseClient.from('profiles').select('id').eq('username', uname).maybeSingle();
    if (exErr || !existing?.id) throw (exErr || new Error('not found'));
    const { error } = await SupabaseClient.from('profiles').delete().eq('id', existing.id);
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
  if (!SupabaseClient) return;
  if (!(hasPerm('users_manage') || hasPerm('settings'))) { alert('لا تملك صلاحية عرض المستخدمين'); return; }
  const uname = (usernameKey || '').toString().trim();
  if (!uname) return;
  const { data, error } = await SupabaseClient.from('profiles').select('*').eq('username', uname).maybeSingle();
  if (error) { alert('تعذر تحميل المستخدم'); return; }
  const p = data;
  if (!p) { alert('المستخدم غير موجود'); return; }
  document.getElementById('userMgmtUsername').value = p.username || '';
  document.getElementById('userMgmtName').value = p.full_name || '';
  const act = document.getElementById('userMgmtIsActive');
  if (act) act.checked = (p.is_active !== false);
  try { buildUserPermissionsUi_(p.permissions || {}); } catch { }
  try { syncSettingsPermissionsUi_(); } catch { }
}

async function addOrUpdateUser() {
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  if (!SupabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  const uname = (document.getElementById('userMgmtUsername').value || '').trim();
  const name = (document.getElementById('userMgmtName').value || '').trim();
  if (!uname) { alert('اسم المستخدم مطلوب'); return; }

  const isActive = !!document.getElementById('userMgmtIsActive')?.checked;
  const permissions = readUserPermissionsUi_();

  const { data: existing, error: exErr } = await SupabaseClient
    .from('profiles')
    .select('id,full_name,permissions,is_active')
    .eq('username', uname)
    .maybeSingle();
  if (exErr) { alert('تعذر التحقق من المستخدم'); return; }
  if (!existing?.id) {
    alert('هذا المستخدم غير موجود في قاعدة البيانات بعد.\nالرجاء: قم بإنشاء المستخدم من لوحة Supabase (Authentication → Users). سيتم إنشاء ملفه تلقائياً ثم يمكنك إعطاؤه الصلاحيات من هنا.');
    return;
  }

  const before = {
    full_name: (existing.full_name || '').toString(),
    is_active: (existing.is_active !== false),
    permissions: (existing.permissions && typeof existing.permissions === 'object') ? existing.permissions : {}
  };

  const { error } = await SupabaseClient
    .from('profiles')
    .update({ full_name: name, permissions, is_active: isActive })
    .eq('id', existing.id);
  if (error) { alert('تعذر حفظ المستخدم'); return; }
  try {
    const afterPerms = permissions && typeof permissions === 'object' ? permissions : {};
    const beforePerms = before.permissions || {};
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
    if (added.length) parts.push(`صلاحيات مضافة: ${added.join(', ')}`);
    if (removed.length) parts.push(`صلاحيات محذوفة: ${removed.join(', ')}`);
    await logAction('تحديث صلاحيات/مستخدم', '', `target: ${uname} | ${parts.join(' | ')}`);
  } catch { }
  try { await renderUsersList(); } catch { }
  alert('تم حفظ المستخدم');
}

async function generateResetPasswordLinkForSelectedUser() {
  if (!SupabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  const uname = (document.getElementById('userMgmtUsername')?.value || '').trim();
  if (!uname) { alert('اختر مستخدم أولاً'); return; }
  const email = usernameToEmail(uname);
  try {
    const { data, error } = await SupabaseClient.functions.invoke('reset-password-link', { body: { email } });
    if (error) throw error;
    const link = data?.action_link || data?.link || '';
    if (!link) { alert('تم تنفيذ الطلب، لكن لم يتم إرجاع رابط'); return; }
    try { await logAction('إنشاء رابط إعادة تعيين كلمة المرور', '', `target: ${uname}`); } catch { }
    prompt('انسخ رابط إعادة تعيين كلمة المرور وأرسله للمستخدم:', link);
  } catch (e) {
    try { console.error(e); } catch { }
    alert('تعذر إنشاء رابط إعادة تعيين كلمة المرور. تأكد من نشر Edge Function وإعداد المتغيرات السرية.');
  }
}

async function deleteUser() {
  if (!hasPerm('users_manage')) { alert('لا تملك صلاحية إدارة المستخدمين'); return; }
  if (!SupabaseClient) { alert('تعذر الاتصال بقاعدة البيانات'); return; }
  const uname = (document.getElementById('userMgmtUsername').value || '').trim();
  if (!uname) { alert('أدخل اسم المستخدم'); return; }
  if (!confirm(`تعطيل المستخدم: ${uname} ؟`)) return;
  const { data: existing, error: exErr } = await SupabaseClient.from('profiles').select('id').eq('username', uname).maybeSingle();
  if (exErr || !existing?.id) { alert('المستخدم غير موجود'); return; }
  const { error } = await SupabaseClient.from('profiles').update({ is_active: false }).eq('id', existing.id);
  if (error) { alert('تعذر تعطيل المستخدم'); return; }
  try { await logAction('تعطيل مستخدم', '', `username: ${uname}`); } catch { }
  try { await renderUsersList(); } catch { }
  alert('تم تعطيل المستخدم');
}
function sendUpdateCaseToSheets(c) {
  const payload = { action: 'updateCase', case: normalizeCaseForSheets(c) };
  const url = getConfiguredUrl();
  postWithRetry(url, payload, 2).catch(() => enqueue({ type: 'updateCase', payload }));
}
function exportToExcel() { exportToCSV() }
function printReport() { window.print() }

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
function getQueue() { try { return Array.isArray(PendingQueue_) ? PendingQueue_ : []; } catch { return []; } }
function setQueue(q) { try { PendingQueue_ = Array.isArray(q) ? q : []; } catch { PendingQueue_ = []; } }
function enqueue(job) { const q = getQueue(); q.push(job); setQueue(q) }
async function trySyncPendingQueue() {
  const q = getQueue(); if (!q.length) return;
  const rest = [];
  for (const job of q) {
    try { await postWithRetry(AppState.googleSheetsUrl, job.payload, 2); } catch { rest.push(job) }
  }
  setQueue(rest);
}
async function postWithRetry(url, payload, retries) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    // Apps Script Web Apps often fail CORS preflight (OPTIONS). Avoid preflight by:
    // - sending body as text/plain (simple request)
    // - not sending custom headers
    const token = getToken();
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
    if (retries > 0) return await postWithRetry(url, payload, retries - 1);
    throw e;
  }
}
function sendCaseToSheets(c) {
  const payload = { action: 'addCase', case: normalizeCaseForSheets(c) };
  const url = getConfiguredUrl();
  postWithRetry(url, payload, 2).catch(() => enqueue({ type: 'addCase', payload }));
}
function sendStatusUpdateToSheets(u) {
  const payload = { action: 'updateStatus', update: u };
  const url = getConfiguredUrl();
  postWithRetry(url, payload, 2).catch(() => enqueue({ type: 'updateStatus', payload }));
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
