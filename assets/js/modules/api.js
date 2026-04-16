(function () {
  function ensureClient(client) {
    if (!client) throw new Error('supabase_not_ready');
    return client;
  }

  async function rpc(client, name, params) {
    const { data, error } = await ensureClient(client).rpc(name, params || {});
    if (error) throw error;
    return data;
  }

  async function invokeFunction(client, name, body) {
    const { data, error } = await ensureClient(client).functions.invoke(name, { body: body || {} });
    if (error) throw error;
    return data;
  }

  async function adminUpdateProfile(client, username, patch) {
    const body = {
      p_username: (username || '').toString().trim(),
      p_full_name: Object.prototype.hasOwnProperty.call(patch || {}, 'full_name') ? patch.full_name : null,
      p_permissions: Object.prototype.hasOwnProperty.call(patch || {}, 'permissions') ? patch.permissions : null,
      p_is_active: Object.prototype.hasOwnProperty.call(patch || {}, 'is_active') ? patch.is_active : null
    };
    const data = await rpc(client, 'admin_update_profile', body);
    return Array.isArray(data) ? data[0] : data;
  }

  async function adminSetProfileActive(client, username, isActive) {
    return rpc(client, 'admin_set_profile_active', {
      p_username: (username || '').toString().trim(),
      p_is_active: !!isActive
    });
  }

  async function adminDeleteProfile(client, username) {
    return rpc(client, 'admin_delete_profile', {
      p_username: (username || '').toString().trim()
    });
  }

  async function upsertCase(client, row) {
    const { data, error } = await ensureClient(client)
      .from('cases')
      .upsert(row)
      .select('id,data,updated_at');
    if (error) throw error;
    return data;
  }

  async function listCases(client, limit = 5000) {
    const { data, error } = await ensureClient(client)
      .from('cases')
      .select('id,data,updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function listCasesPage(client, params = {}) {
    return rpc(client, 'list_cases_page', {
      p_limit: params.limit || 100,
      p_offset: params.offset || 0,
      p_search: params.search || null,
      p_governorate: params.governorate || null,
      p_area: params.area || null,
      p_grade: params.grade || null,
      p_category: params.category || null
    });
  }

  async function listCasesPaged(client, options = {}) {
    const pageSize = Math.max(1, Math.min(Number(options.pageSize || 500) || 500, 500));
    const maxRows = Math.max(pageSize, Number(options.maxRows || 5000) || 5000);
    const out = [];
    let offset = 0;
    let total = null;

    while (out.length < maxRows) {
      const page = await listCasesPage(client, {
        limit: pageSize,
        offset,
        search: options.search || null,
        governorate: options.governorate || null,
        area: options.area || null,
        grade: options.grade || null,
        category: options.category || null
      });
      const rows = Array.isArray(page) ? page : [];
      if (!rows.length) break;
      rows.forEach((row) => {
        if (out.length < maxRows) out.push(row);
      });
      if (total == null) total = Number(rows[0]?.total_count || 0) || 0;
      offset += rows.length;
      if (rows.length < pageSize || (total && offset >= total)) break;
    }

    return out.map((row) => ({
      id: row.id,
      data: row.data,
      updated_at: row.updated_at
    }));
  }

  async function deleteCase(client, id) {
    return rpc(client, 'delete_case', { p_id: String(id) });
  }

  async function deleteAllCases(client) {
    return rpc(client, 'delete_all_cases');
  }

  async function listProfilesPublic(client) {
    return rpc(client, 'list_profiles_public');
  }

  async function insertAuditLog(client, row) {
    const { data, error } = await ensureClient(client).from('audit_log').insert(row);
    if (error) throw error;
    return data;
  }

  async function listAuditLog(client, limit = 500) {
    const { data, error } = await ensureClient(client)
      .from('audit_log')
      .select('created_at,action,case_id,details,created_by')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function listAuditLogPage(client, params = {}) {
    return rpc(client, 'list_audit_log_page', {
      p_limit: params.limit || 100,
      p_offset: params.offset || 0,
      p_case_id: params.caseId || null
    });
  }

  async function listCaseAuditLog(client, caseId, limit = 200) {
    const { data, error } = await ensureClient(client)
      .from('audit_log')
      .select('created_at,action,details,created_by')
      .eq('case_id', String(caseId))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function listProfilesByIds(client, ids) {
    if (!Array.isArray(ids) || !ids.length) return [];
    const { data, error } = await ensureClient(client)
      .from('profiles')
      .select('id,username,full_name')
      .in('id', ids)
      .limit(2000);
    if (error) throw error;
    return data || [];
  }

  async function getProfileByUsername(client, username, columns = '*') {
    const { data, error } = await ensureClient(client)
      .from('profiles')
      .select(columns)
      .eq('username', (username || '').toString().trim())
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  window.CharityApi = Object.freeze({
    rpc,
    invokeFunction,
    adminUpdateProfile,
    adminSetProfileActive,
    adminDeleteProfile,
    listCases,
    listCasesPage,
    listCasesPaged,
    upsertCase,
    deleteCase,
    deleteAllCases,
    listProfilesPublic,
    insertAuditLog,
    listAuditLog,
    listAuditLogPage,
    listCaseAuditLog,
    listProfilesByIds,
    getProfileByUsername
  });
})();
