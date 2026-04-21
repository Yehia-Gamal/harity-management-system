(function () {
  const LEGACY_ROLE_ALIASES = {
    admin: 'super_admin',
    supervisor: 'manager',
    data_entry: 'explorer',
    auditor: 'manager',
    viewer: 'explorer'
  };

  const CANONICAL_ROLES = ['explorer', 'manager', 'super_admin', 'doctor', 'medical_committee'];
  const FULL_ACCESS_ROLES = ['super_admin', 'hidden_super_admin'];
  const MANAGER_ACCESS_ROLES = ['manager', 'super_admin', 'hidden_super_admin'];

  function normalizeRoleKey(roleKey) {
    const raw = (roleKey || '').toString().trim();
    return LEGACY_ROLE_ALIASES[raw] || raw || 'custom';
  }

  function roleIs(roleKey, allowed) {
    const role = normalizeRoleKey(roleKey);
    return (allowed || []).includes(role);
  }

  function isHiddenRolePermissions(perms) {
    const p = perms && typeof perms === 'object' ? perms : {};
    return roleIs((p.__role || p._role || '').toString().trim(), ['hidden_super_admin']);
  }

  function normalizePermissionsObject(perms) {
    const src = perms && typeof perms === 'object' ? perms : {};
    const out = {};
    Object.keys(src).forEach((key) => {
      out[key] = !!src[key];
    });
    if (src.__role || src._role) out.__role = normalizeRoleKey(src.__role || src._role);
    return out;
  }

  window.CharityPermissions = Object.freeze({
    LEGACY_ROLE_ALIASES: Object.freeze({ ...LEGACY_ROLE_ALIASES }),
    CANONICAL_ROLES: Object.freeze([...CANONICAL_ROLES]),
    FULL_ACCESS_ROLES: Object.freeze([...FULL_ACCESS_ROLES]),
    MANAGER_ACCESS_ROLES: Object.freeze([...MANAGER_ACCESS_ROLES]),
    normalizeRoleKey,
    roleIs,
    isHiddenRolePermissions,
    normalizePermissionsObject
  });
})();
