import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fakeIban,
  fakeTckn,
  fakeVkn,
  formatIban,
  isTckn,
  mod97,
  tcknCheckDigits,
  validateIban,
  validatePhone,
  validatePlate,
  validateTaxId,
  validateTckn,
  validateVkn,
  vknCheckDigit,
} from './index.js';

// --- TCKN -------------------------------------------------------------------

test('a known-good TCKN passes', () => {
  // The arithmetic is checkable by hand: odd digits sum to 2, even to 0,
  // so d10 = (2*7 - 0) mod 10 = 4 and d11 = 6.
  const result = validateTckn('10000000146');
  assert.equal(result.valid, true);
  assert.equal(result.value, '10000000146');
});

test('the check digits are computed, not guessed', () => {
  assert.equal(tcknCheckDigits('100000001'), '46');
  assert.throws(() => tcknCheckDigits('123'), TypeError);
});

test('a regex would accept all of these; the checksum does not', () => {
  for (const bad of ['11111111111', '12345678901', '99999999999',
    '10000000147', '10000000156']) {
    assert.equal(isTckn(bad), false, bad);
  }
});

test('no repeated-digit number is checksum-valid in the first place', () => {
  // For every digit k the tenth check digit is k and the eleventh is 0, so the
  // only candidate is 00000000000 - which the leading-zero rule already
  // rejects. The explicit check exists for the error message, not the hole.
  for (let digit = 0; digit <= 9; digit += 1) {
    const nine = String(digit).repeat(9);
    assert.equal(tcknCheckDigits(nine), `${digit}0`);
  }
  assert.equal(validateTckn('11111111111').reason, 'all digits are the same');
  assert.equal(validateTckn('00000000000').reason, 'cannot start with 0');
});

test('a TCKN cannot start with zero', () => {
  assert.equal(validateTckn('01234567890').reason, 'cannot start with 0');
});

test('the reason names what was wrong', () => {
  assert.match(validateTckn('').reason, /empty/);
  assert.match(validateTckn('123').reason, /11 digits, got 3/);
  assert.match(validateTckn('1234567890a').reason, /digits only/);
  assert.match(validateTckn('10000000145').reason, /expected 46/);
});

test('spaces, dots and dashes are ignored', () => {
  assert.equal(isTckn(' 100 000 001 46 '), true);
  assert.equal(isTckn('100-000-001-46'), true);
});

test('a transposition is caught, which is why the formula subtracts', () => {
  const valid = fakeTckn();
  const digits = valid.split('');
  // Swap two of the first nine digits that differ, and the checksum must move.
  let swapped = null;
  for (let i = 0; i < 8 && !swapped; i += 1) {
    if (digits[i] !== digits[i + 1]) {
      const copy = [...digits];
      [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
      swapped = copy.join('');
    }
  }
  if (swapped) assert.equal(isTckn(swapped), false, swapped);
});

test('changing any single digit invalidates it', () => {
  const valid = fakeTckn();
  for (let position = 0; position < 11; position += 1) {
    const digits = valid.split('');
    digits[position] = String((Number(digits[position]) + 1) % 10);
    if (position === 0 && digits[0] === '0') continue;
    assert.equal(isTckn(digits.join('')), false, `position ${position}`);
  }
});

// --- VKN --------------------------------------------------------------------

test('a generated VKN validates, and a changed digit does not', () => {
  for (let round = 0; round < 200; round += 1) {
    const value = fakeVkn();
    assert.equal(validateVkn(value).valid, true, value);
    const digits = value.split('');
    digits[9] = String((Number(digits[9]) + 1) % 10);
    assert.equal(validateVkn(digits.join('')).valid, false, digits.join(''));
  }
});

test('the 9-in-the-shift case is carried, not reduced to zero', () => {
  // (d + 9 - i) % 10 === 9 is the branch that mod 9 would erase. Exercise it
  // with a leading 0 at i = 0: (0 + 9) % 10 === 9.
  assert.equal(typeof vknCheckDigit('012345678'), 'string');
  assert.equal(validateVkn(`012345678${vknCheckDigit('012345678')}`).valid, true);
});

test('VKN length and shape', () => {
  assert.match(validateVkn('123').reason, /10 digits, got 3/);
  assert.match(validateVkn('abcdefghij').reason, /digits only/);
  assert.throws(() => vknCheckDigit('1'), TypeError);
});

test('validateTaxId picks the right scheme by length', () => {
  const tckn = fakeTckn();
  const vkn = fakeVkn();
  assert.deepEqual(
    { kind: validateTaxId(tckn).kind, valid: validateTaxId(tckn).valid },
    { kind: 'tckn', valid: true },
  );
  assert.deepEqual(
    { kind: validateTaxId(vkn).kind, valid: validateTaxId(vkn).valid },
    { kind: 'vkn', valid: true },
  );
  assert.equal(validateTaxId('123').kind, null);
});

// --- IBAN -------------------------------------------------------------------

test('a generated TR IBAN validates and reports its parts', () => {
  const iban = fakeIban('00062');
  const result = validateIban(iban);
  assert.equal(result.valid, true, `${iban} ${result.reason ?? ''}`);
  assert.equal(result.country, 'TR');
  assert.equal(result.bankCode, '00062');
  assert.equal(result.accountNumber.length, 16);
});

test('mod 97 is computed incrementally, so a 30-digit IBAN keeps its precision', () => {
  // Number('TR330006100519786457841326' as digits) would lose the low digits
  // entirely; the remainder has to be reduced as it is built.
  assert.equal(mod97('000610051978645784132600TR33'.replace(/[A-Z]/g,
    (c) => String(c.charCodeAt(0) - 55))) >= 0, true);
  const huge = '9'.repeat(40);
  assert.equal(mod97(huge), Number(BigInt(huge) % 97n));
});

test('a real-shaped IBAN with one digit changed is rejected', () => {
  const iban = fakeIban();
  const broken = `${iban.slice(0, 20)}${(Number(iban[20]) + 1) % 10}${iban.slice(21)}`;
  assert.equal(validateIban(iban).valid, true);
  assert.equal(validateIban(broken).valid, false);
});

test('a transposition inside the account number is caught', () => {
  const iban = fakeIban();
  let swapped = null;
  for (let i = 10; i < iban.length - 1 && !swapped; i += 1) {
    if (iban[i] !== iban[i + 1]) {
      swapped = iban.slice(0, i) + iban[i + 1] + iban[i] + iban.slice(i + 2);
    }
  }
  assert.equal(validateIban(swapped).valid, false);
});

test('country length is enforced where it is known', () => {
  assert.match(validateIban('TR3300061005197864578413').reason,
    /TR IBAN is 26 characters, got 24/);
  assert.match(validateIban('DE89370400440532013').reason,
    /DE IBAN is 22 characters/);
});

test('a well-formed German IBAN passes', () => {
  // The IBAN from the ISO documentation.
  assert.equal(validateIban('DE89 3704 0044 0532 0130 00').valid, true);
});

test('an unknown country still gets the checksum check', () => {
  assert.equal(validateIban('ZZ00123456789012345').valid, false);
});

test('IBAN shape errors are named', () => {
  assert.match(validateIban('').reason, /empty/);
  assert.match(validateIban('1234567890123456').reason, /two letters/);
  assert.match(validateIban('TRxx0006100519786457841326').reason, /two letters/);
});

test('formatting is in groups of four', () => {
  assert.equal(formatIban('TR330006100519786457841326'),
    'TR33 0006 1005 1978 6457 8413 26');
  assert.equal(validateIban('tr33 0006 1005 1978 6457 8413 26').valid,
    validateIban('TR330006100519786457841326').valid);
});

// --- plates -----------------------------------------------------------------

test('plates in every legal shape', () => {
  for (const [plate, province] of [
    ['34 A 1234', 'İstanbul'],
    ['06 AB 123', 'Ankara'],
    ['35 ABC 12', 'İzmir'],
    ['01 A 12345', 'Adana'],
    ['81 ABC 123', 'Düzce'],
  ]) {
    const result = validatePlate(plate);
    assert.equal(result.valid, true, plate);
    assert.equal(result.province, province);
  }
});

test('separators and case do not matter', () => {
  assert.equal(validatePlate('34a1234').value, '34 A 1234');
  assert.equal(validatePlate('34-a-1234').value, '34 A 1234');
});

test('the letter and digit counts are not independent', () => {
  // One letter needs four or five digits; three needs two or three.
  assert.match(validatePlate('34 A 123').reason, /1 letter\(s\) go with 4 or 5 digits/);
  assert.match(validatePlate('34 ABC 1234').reason, /3 letter\(s\) go with 2 or 3 digits/);
});

test('an impossible province code is rejected', () => {
  assert.match(validatePlate('82 A 1234').reason, /not a province code/);
  assert.match(validatePlate('00 A 1234').reason, /not a province code/);
  assert.equal(validatePlate('81 A 1234').valid, true);
});

test('nonsense plates are rejected with a shape message', () => {
  assert.match(validatePlate('ABC 123').reason, /expected two digits/);
  assert.match(validatePlate('').reason, /empty/);
  assert.match(validatePlate('34 ABCD 12').reason, /expected two digits/);
});

// --- phones -----------------------------------------------------------------

test('every way people type a mobile number normalises to one', () => {
  for (const input of ['0532 123 45 67', '+90 532 123 4567', '905321234567',
    '00905321234567', '(0532) 123-45-67', '5321234567']) {
    const result = validatePhone(input);
    assert.equal(result.valid, true, input);
    assert.equal(result.value, '+905321234567', input);
    assert.equal(result.kind, 'mobile');
  }
});

test('the national format is readable', () => {
  assert.equal(validatePhone('05321234567').national, '0532 123 45 67');
});

test('a landline is recognised as one', () => {
  const result = validatePhone('0212 123 45 67');
  assert.equal(result.kind, 'landline');
  assert.equal(result.areaCode, '212');
});

test('a 5xx prefix that is not an allocated mobile block is flagged, not accepted silently', () => {
  assert.equal(validatePhone('0500 123 45 67').kind, 'mobile-unknown-prefix');
});

test('wrong-length numbers are rejected', () => {
  assert.match(validatePhone('0532 123 45').reason, /10 digits.*got 8/);
  assert.match(validatePhone('0532 123 45 67 89').reason, /got 12/);
  assert.match(validatePhone('abc').reason, /digits only/);
  assert.match(validatePhone('').reason, /empty/);
});

// --- fixtures ---------------------------------------------------------------

test('the fixture generators produce values this library accepts', () => {
  for (let round = 0; round < 500; round += 1) {
    assert.equal(validateTckn(fakeTckn()).valid, true);
    assert.equal(validateVkn(fakeVkn()).valid, true);
    assert.equal(validateIban(fakeIban()).valid, true);
  }
});

test('fixtures are not all the same number', () => {
  const seen = new Set(Array.from({ length: 50 }, () => fakeTckn()));
  assert.ok(seen.size > 45);
});

test('a fake TCKN never starts with zero', () => {
  for (let round = 0; round < 200; round += 1) {
    assert.notEqual(fakeTckn()[0], '0');
  }
});
