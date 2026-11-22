import { describe, expect, it } from 'vitest';
import { createDeadline, remindFrom, renew } from './deadlines';

describe('deadlines', () => {
  it('uses Austrian defaults', () => {
    const p = createDeadline({ kind: 'pickerl', dueDate: '2027-03-31' });
    expect(p.title).toBe('§57a-Pickerl');
    expect(remindFrom(p)).toBe('2027-03-01');
    expect(renew(p)?.dueDate).toBe('2028-03-31');
  });
  it('one-off deadlines end when handled', () => {
    expect(renew(createDeadline({ kind: 'warranty', title: 'Garantie Waschmaschine', dueDate: '2027-05-01' }))).toBeNull();
  });
});
