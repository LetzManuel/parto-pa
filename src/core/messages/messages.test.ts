import { describe, expect, it } from 'vitest';
import { cleanDictation, mainClause } from './dictation';
import { compose, normalizePhone, parseCommand, parseRequest, sendLink, isMessageIntent, defaultChannel, type Recipient } from './index';

const REF = '2026-11-22'; // Sunday

const NAILS: Recipient = { key: 'provider:1', name: 'Studio Nails', contactPerson: 'Frau Huber', formal: true, email: 'office@studionails.at', phone: '0664 123 45 67', aliases: ['Maniküre Gel', 'Huber'], service: 'Maniküre Gel' };
const BERGER: Recipient = { key: 'provider:2', name: 'Installateur Berger', contactPerson: 'Herr Berger', formal: true, email: 'berger@example.at', phone: null, aliases: [] };
const ANNA: Recipient = { key: 'person:anna', name: 'Anna', formal: false, phone: '+43 676 1112233' };
const ALL = [NAILS, BERGER, ANNA];
const ME = { name: 'Manuel Letz' };

describe('dictation clean-up', () => {
  it('spoken punctuation, fillers, capitals', () => {
    expect(cleanDictation('äh ich komme heute später komma sorry punkt bis gleich')).toBe('Ich komme heute später, sorry. Bis gleich.');
    expect(cleanDictation('passt dir das fragezeichen neuer absatz danke')).toBe('Passt dir das?\n\nDanke.');
  });
  it('keeps "um Punkt 8"', () => {
    expect(cleanDictation('ich bin um punkt 8 da')).toBe('Ich bin um punkt 8 da.');
  });
  it('indirect speech back to a main clause', () => {
    expect(mainClause('ich morgen um 8 komme')).toBe('ich komme morgen um 8');
    expect(mainClause('ich morgen leider nicht kommen kann')).toBe('ich kann morgen leider nicht kommen');
    expect(mainClause('der Termin passt')).toBe('der Termin passt');
  });
});

describe('voice request', () => {
  it('template, recipient, channel and date from one sentence', () => {
    const r = parseRequest('Absage an Studio Nails per WhatsApp: ich kann morgen leider nicht', ALL, REF);
    expect(r).toMatchObject({ template: 'cancel', channel: 'whatsapp', date: '2026-11-23', when: 'morgen', body: 'Ich kann morgen leider nicht.' });
    expect(r.recipient?.key).toBe('provider:1');
  });
  it('"sag Anna, dass …"', () => {
    const r = parseRequest('Sag Anna per SMS dass ich morgen um 8 komme', ALL, REF);
    expect(r.recipient?.key).toBe('person:anna');
    expect(r).toMatchObject({ channel: 'sms', body: 'Ich komme morgen um 8.' });
  });
  it('finds a provider by trade word and spoken colon', () => {
    const r = parseRequest('Schreib dem Installateur eine Mail wegen Angebot Doppelpunkt bitte um einen Kostenvoranschlag für die Therme', ALL, REF);
    expect(r.recipient?.key).toBe('provider:2');
    expect(r).toMatchObject({ template: 'quote', channel: 'email', body: 'Bitte um einen Kostenvoranschlag für die Therme.' });
  });
  it('message vs memo', () => {
    expect(isMessageIntent('Schreib Anna, dass ich später komme')).toBe(true);
    expect(isMessageIntent('Nachricht an Studio Nails')).toBe(true);
    expect(isMessageIntent('Erinner mich morgen an die Steuer')).toBe(false);
  });
});

describe('compose', () => {
  it('formal e-mail with subject, greeting and sign-off', () => {
    const m = compose({ template: 'cancel', recipient: NAILS, channel: 'email', body: 'Ich bin leider krank.', sender: ME, when: 'am Freitag, 27. November' });
    expect(m.subject).toBe('Absage Termin am Freitag, 27. November');
    expect(m.text).toBe('Sehr geehrte Frau Huber,\n\nleider muss ich meinen Termin am Freitag, 27. November absagen.\n\nIch bin leider krank.\n\nVielen Dank für Ihr Verständnis.\n\nMit freundlichen Grüßen\nManuel Letz');
  });
  it('short informal WhatsApp', () => {
    const m = compose({ template: 'free', recipient: ANNA, channel: 'whatsapp', body: 'Ich komme morgen um 8.', sender: ME });
    expect(m).toEqual({ subject: null, text: 'Hallo Anna,\nich komme morgen um 8.\nLG Manuel' });
  });
  it('du to a business without a contact name', () => {
    const m = compose({ template: 'free', recipient: { ...BERGER, contactPerson: null, formal: false, phone: '0664 1' }, channel: 'whatsapp', body: 'Passt.', sender: ME });
    expect(m.text.startsWith('Hallo,\n')).toBe(true);
  });
  it('template alone, no body', () => {
    const m = compose({ template: 'request', recipient: BERGER, channel: 'email', body: '', sender: ME });
    expect(m.text).toContain('Sehr geehrter Herr Berger,\n\nich hätte gerne einen Termin.\n\nBitte geben Sie mir kurz Bescheid');
  });
  it('availability for a babysitter', () => {
    const m = compose({ template: 'availability', recipient: ANNA, channel: 'sms', body: '', sender: ME, when: 'am Samstag, 28. November' });
    expect(m.text).toBe('Hallo Anna,\nhättest du am Samstag, 28. November Zeit? Sag mir bitte kurz Bescheid. Danke!\nLG Manuel');
  });
});

describe('send links', () => {
  it('phone numbers', () => {
    expect(normalizePhone('0664 123 45 67')).toBe('+436641234567');
    expect(normalizePhone('0049 171 1234567')).toBe('+491711234567');
    expect(normalizePhone('12')).toBeNull();
  });
  it('mailto, sms and WhatsApp', () => {
    const m = { subject: 'Hallo du', text: 'A & B' };
    expect(sendLink('email', NAILS, m)).toBe('mailto:office@studionails.at?subject=Hallo%20du&body=A%20%26%20B');
    expect(sendLink('sms', NAILS, m)).toBe('sms:+436641234567?&body=A%20%26%20B');
    expect(sendLink('whatsapp', NAILS, m)).toBe('https://wa.me/436641234567?text=A%20%26%20B');
    expect(sendLink('whatsapp', BERGER, m)).toBeNull();
  });
  it('default channel', () => {
    expect(defaultChannel(NAILS)).toBe('email');
    expect(defaultChannel(ANNA)).toBe('whatsapp');
  });
});

describe('voice commands', () => {
  it.each([
    ['Senden', { type: 'send' }],
    ['ja bitte', { type: 'send' }],
    ['Lies vor', { type: 'read' }],
    ['abbrechen', { type: 'cancel' }],
    ['per WhatsApp', { type: 'channel', channel: 'whatsapp' }],
    ['lieber als SMS', { type: 'channel', channel: 'sms' }],
    ['Vorlage Absage', { type: 'template', template: 'cancel' }],
    ['ohne Vorlage', { type: 'template', template: 'free' }],
    ['per du', { type: 'formal', formal: false }],
    ['ergänze ich bringe die Unterlagen mit', { type: 'append', text: 'ich bringe die Unterlagen mit' }],
    ['an Anna', { type: 'recipient', query: 'Anna' }],
  ])('%s', (said, cmd) => {
    expect(parseCommand(said)).toEqual(cmd);
  });
  it('unknown', () => {
    expect(parseCommand('Wie spät ist es')).toBeNull();
  });
});
