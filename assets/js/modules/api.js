(function () {
  let activeClient = null;

  function setClient(client) {
    activeClient = client || null;
  }

  function getRawClient(client) {
    const resolved = client || activeClient || null;
    const raw = resolved?.raw || resolved || null;
    if (!raw?.from || !raw?.auth) throw new Error('supabase_not_ready');
    return raw;
  }

  async function listCases(client) {
    const raw = getRawClient(client);
    const { data, error } = await raw
      .from('cases')
      .select('id,data,updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id || '',
      data: row.data && typeof row.data === 'object' ? row.data : {},
      updated_at: row.updated_at || ''
    }));
  }

  async function upsertCase(client, row) {
    const raw = getRawClient(client);
    const payload = {
      id: String(row?.id || row?.case_id || '').trim(),
      data: row?.data && typeof row.data === 'object' ? row.data : {},
      created_by: row?.created_by || null,
      updated_by: row?.updated_by || null,
      updated_at: row?.updated_at || new Date().toISOString()
    };
    if (!payload.id) throw new Error('missing_case_id');
    const { data, error } = await raw
      .from('cases')
      .upsert(payload)
      .select('id,data,updated_at');
    if (error) throw error;
    return data || [];
  }

  async function deleteCase(client, caseId) {
    const raw = getRawClient(client);
    const { error } = await raw.rpc('delete_case', { p_id: String(caseId || '') });
    if (error) throw error;
    return true;
  }

  async function deleteAllCases(client) {
    const raw = getRawClient(client);
    const { data, error } = await raw.rpc('delete_all_cases', {});
    if (error) throw error;
    return Number(data || 0);
  }

  async function listUsers(client) {
    const raw = getRawClient(client);
    const { data, error } = await raw.rpc('list_profiles_public', {});
    if (error) throw error;
    return data || [];
  }

  async function createUser(client, payload = {}) {
    const resolved = client || activeClient || null;
    const { data, error } = await resolved.functions.invoke('create-user', { body: payload || {} });
    if (error) throw error;
    return data || null;
  }

  async function updateUser(client, userId, patch = {}) {
    const raw = getRawClient(client);
    const { data: row, error: rowError } = await raw
      .from('profiles')
      .select('username')
      .eq('id', String(userId || ''))
      .maybeSingle();
    if (rowError) throw rowError;
    const { data, error } = await raw.rpc('admin_update_profile', {
      p_username: row?.username || '',
      p_full_name: Object.prototype.hasOwnProperty.call(patch || {}, 'full_name') ? patch.full_name : null,
      p_permissions: Object.prototype.hasOwnProperty.call(patch || {}, 'permissions') ? patch.permissions : null,
      p_is_active: Object.prototype.hasOwnProperty.call(patch || {}, 'is_active') ? !!patch.is_active : null
    });
    if (error) throw error;
    return data || null;
  }

  async function deleteUser(client, userId) {
    const raw = getRawClient(client);
    const { data: row, error: rowError } = await raw
      .from('profiles')
      .select('username')
      .eq('id', String(userId || ''))
      .maybeSingle();
    if (rowError) throw rowError;
    const { error } = await raw.rpc('admin_delete_profile', { p_username: row?.username || '' });
    if (error) throw error;
    return true;
  }

  async function insertAuditLog(client, row = {}) {
    const raw = getRawClient(client);
    const { data, error } = await raw.from('audit_log').insert({
      action: (row.action || '').toString(),
      case_id: (row.case_id || '').toString(),
      details: (row.details || '').toString(),
      created_by: row.created_by || null
    }).select('created_at,action,case_id,details,created_by');
    if (error) throw error;
    return data || [];
  }

  async function listAuditLog(client) {
    const raw = getRawClient(client);
    const { data, error } = await raw
      .from('audit_log')
      .select('created_at,action,case_id,details,profiles:created_by(username,full_name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  window.CharityApi = Object.freeze({
    setClient,
    getRawClient,
    listCases,
    upsertCase,
    deleteCase,
    deleteAllCases,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    insertAuditLog,
    listAuditLog
  });
})();
