import { describe, expect, it } from 'vitest';
import { aboutPerson, createMemory, guessCategory, shareableWithAI } from './memory';

describe('memory', () => {
  it('marks health facts so they never reach the AI', () => {
    expect(guessCategory('Allergie gegen Gel-Lack')).toBe('health');
    expect(guessCategory('Zahnärztin Dr. Huber')).toBe('health');
    const list = [createMemory('Allergie gegen Gel-Lack', 'von Hand'), createMemory('Nie vor 9 Uhr', 'von Hand')];
    expect(shareableWithAI(list).map((e) => e.text)).toEqual(['Nie vor 9 Uhr']);
  });
  it('recognises people and preferences', () => {
    expect(guessCategory('Anna mag Orchideen')).toBe('person');
    expect(guessCategory('Nie vor 9 Uhr')).toBe('preference');
    expect(guessCategory('Maniküre maximal 60 €')).toBe('preference');
    expect(guessCategory('Auto: Kennzeichen W-12345')).toBe('fact');
  });
  it('finds entries about a person', () => {
    const list = [createMemory('Anna mag Orchideen', 'x'), createMemory('Ben mag Jazz', 'x')];
    expect(aboutPerson(list, 'Anna').map((e) => e.text)).toEqual(['Anna mag Orchideen']);
  });
});
