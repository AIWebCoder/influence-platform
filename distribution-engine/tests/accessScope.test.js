const {
  allowsPersona,
  buildAccountScope,
  filterProxiesForScope,
} = require('../src/core/accessScope');

describe('accessScope', () => {
  const fleetAdmin = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    role: 'admin',
    mode: 'fleet',
    personaIds: null,
    isAdmin: true,
    isFleet: true,
  };

  const scopedOperator = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    role: 'operator',
    mode: 'scoped',
    personaIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    isAdmin: false,
    isFleet: false,
  };

  it('fleet admin allows any persona', () => {
    expect(allowsPersona(fleetAdmin, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(true);
  });

  it('scoped operator allows only assigned persona', () => {
    expect(allowsPersona(scopedOperator, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(true);
    expect(allowsPersona(scopedOperator, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(false);
  });

  it('buildAccountScope blocks all when scoped with no personas', () => {
    const scope = { ...scopedOperator, personaIds: [] };
    const { clause } = buildAccountScope(scope, 'a', 1);
    expect(clause).toContain('FALSE');
  });

  it('filterProxiesForScope hides unassigned proxies for scoped operator', () => {
    const rows = [
      { id: '1', host: '1.2.3.4', assigned_persona_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', password_encrypted: 'x' },
      { id: '2', host: '5.6.7.8', assigned_persona_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', password_encrypted: 'y' },
    ];
    const filtered = filterProxiesForScope(rows, scopedOperator);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
    expect(filtered[0].password_encrypted).toBeUndefined();
  });
});