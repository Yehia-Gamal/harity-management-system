(function () {
  const existing = window.APP_CONFIG && typeof window.APP_CONFIG === 'object' ? window.APP_CONFIG : {};

  window.APP_CONFIG = Object.freeze({
    appName: existing.appName || 'نظام لجنة أسرة كريمة',
    environment: existing.environment || 'production',
    supabaseUrl: existing.supabaseUrl || 'https://fbctibquzuxfjonhbrjr.supabase.co',
    supabaseAnonKey: existing.supabaseAnonKey || 'sb_publishable_HWMOnpbnXOqCQm37lf7iyA_np0iIKMo',
    googleSheetsUrl: existing.googleSheetsUrl || '',
    sessionMode: existing.sessionMode || 'session',
    casePageSize: Number(existing.casePageSize || 100) || 100,
    auditPageSize: Number(existing.auditPageSize || 100) || 100,
    minPasswordLength: Number(existing.minPasswordLength || 10) || 10,
  });
})();
