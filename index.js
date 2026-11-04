/**
 * tr-doc - validate Turkish identifiers by their checksums, not by a regex.
 *
 * `/^\d{11}$/` accepts 11111111111. It is not a national id; the checksum says
 * so, and a form that submits it has just created a customer record nobody can
 * invoice. The same goes for a tax number, an IBAN with a transposed digit, and
 * a plate with an impossible province code.
 *
 * Every function here implements the actual algorithm, and every one of them
 * tells you *why* something failed, because "invalid" is not an error message a
 * user can act on.
 *
 * One thing this cannot do, and does not pretend to: **validation is not
 * verification.** A TCKN whose checksum is right tells you the number was not
 * mistyped. Whether it belongs to the person filling in the form is a question
 * only the state's own service can answer.
 *
 * No dependencies.
 */

// --- shared -----------------------------------------------------------------

const digitsOf = (value) => String(value ?? '').replace(/[\s.-]/g, '');

function fail(reason) {
  return { valid: false, reason };
}

// --- TCKN (Turkish national identity number) --------------------------------

/**
 * The two check digits of a TCKN, from the first nine.
 *
 *   d10 = ((d1+d3+d5+d7+d9) * 7 - (d2+d4+d6+d8)) mod 10
 *   d11 =  (d1..d10 summed) mod 10
 *
 * Note the subtraction in the first one: a checksum that only *added* would
 * miss a transposition, which is the most common typing error there is.
 */
export function tcknCheckDigits(first9) {
  const digits = String(first9).split('').map(Number);
  if (digits.length !== 9 || digits.some(Number.isNaN)) {
    throw new TypeError('tcknCheckDigits wants exactly 9 digits');
  }
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  const tenth = ((odd * 7 - even) % 10 + 10) % 10;
  const eleventh = (odd + even + tenth) % 10;
  return `${tenth}${eleventh}`;
}

export function validateTckn(input) {
  const value = digitsOf(input);
  if (!value) return fail('empty');
  if (!/^\d+$/.test(value)) return fail('must be digits only');
  if (value.length !== 11) {
    return fail(`must be 11 digits, got ${value.length}`);
  }
  if (value[0] === '0') return fail('cannot start with 0');
  if (/^(\d)\1{10}$/.test(value)) {
    // No repeated-digit number is checksum-valid: for every digit k the tenth
    // comes out as k and the eleventh as 0, which only agree at k = 0 -- and
    // that is already rejected for the leading zero. So this is not a hole
    // being plugged; it is the most common thing typed into a field people
    // resent, and it deserves a better message than "check digits".
    return fail('all digits are the same');
  }
  const expected = tcknCheckDigits(value.slice(0, 9));
  if (value.slice(9) !== expected) {
    return fail(`check digits are ${value.slice(9)}, expected ${expected}`);
  }
  return { valid: true, value };
}

export const isTckn = (input) => validateTckn(input).valid;

// --- VKN (tax number) -------------------------------------------------------

/**
 * The check digit of a 10-digit VKN, from the first nine.
 *
 * Each digit is shifted by its distance from the end, doubled by a power of two
 * and reduced mod 9 - except when the shift lands on 9, which is carried as-is.
 * That exception is not decoration: without it the scheme loses digits, because
 * 9 mod 9 is 0.
 */
export function vknCheckDigit(first9) {
  const digits = String(first9).split('').map(Number);
  if (digits.length !== 9 || digits.some(Number.isNaN)) {
    throw new TypeError('vknCheckDigit wants exactly 9 digits');
  }
  let total = 0;
  for (let index = 0; index < 9; index += 1) {
    const shifted = (digits[index] + (9 - index)) % 10;
    total += shifted === 9 ? shifted : (shifted * 2 ** (9 - index)) % 9;
  }
  return String((10 - (total % 10)) % 10);
}

export function validateVkn(input) {
  const value = digitsOf(input);
  if (!value) return fail('empty');
  if (!/^\d+$/.test(value)) return fail('must be digits only');
  if (value.length !== 10) {
    return fail(`must be 10 digits, got ${value.length}`);
  }
  const expected = vknCheckDigit(value.slice(0, 9));
  if (value[9] !== expected) {
    return fail(`check digit is ${value[9]}, expected ${expected}`);
  }
  return { valid: true, value };
}

export const isVkn = (input) => validateVkn(input).valid;

/** Either a personal id or a company tax number, whichever it is. */
export function validateTaxId(input) {
  const value = digitsOf(input);
  if (value.length === 11) return { kind: 'tckn', ...validateTckn(value) };
  if (value.length === 10) return { kind: 'vkn', ...validateVkn(value) };
  return { kind: null, ...fail('a tax id is 10 digits (VKN) or 11 (TCKN)') };
}

// --- IBAN -------------------------------------------------------------------

// Length per country, for the ones a Turkish business actually sees. An unknown
// country still gets the mod-97 check; only the length is unverified.
export const IBAN_LENGTHS = {
  TR: 26, DE: 22, GB: 22, NL: 18, FR: 27, IT: 27, ES: 24, BE: 16, AT: 20,
  CH: 21, SE: 24, DK: 18, NO: 15, FI: 18, PL: 28, CZ: 24, RO: 24, BG: 22,
  GR: 27, PT: 25, IE: 22, LU: 20, HU: 28, AZ: 28, GE: 22, UA: 29, AE: 23,
  SA: 24, QA: 29, KW: 30, IL: 23, MT: 31, CY: 28, EE: 20, LV: 21, LT: 20,
  SI: 19, SK: 24, HR: 21, RS: 22, MK: 19, AL: 28, BA: 20, ME: 22, MD: 24,
};

/**
 * ISO 7064 mod-97-10: move the first four characters to the end, turn letters
 * into numbers (A = 10), and the whole thing must be 1 mod 97.
 *
 * The number is far too big for a double, so it is reduced as it is built -
 * doing it with `Number(huge)` silently loses precision and starts accepting
 * invalid IBANs.
 */
export function mod97(rearranged) {
  let remainder = 0;
  for (const character of rearranged) {
    const code = character.charCodeAt(0);
    const piece = code >= 65 && code <= 90
      ? String(code - 55)             // A -> 10 ... Z -> 35
      : character;
    for (const digit of piece) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}

export function validateIban(input) {
  const value = String(input ?? '').replace(/\s/g, '').toUpperCase();
  if (!value) return fail('empty');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(value)) {
    return fail('must be two letters, two check digits, then letters or digits');
  }
  const country = value.slice(0, 2);
  const expectedLength = IBAN_LENGTHS[country];
  if (expectedLength && value.length !== expectedLength) {
    return fail(`a ${country} IBAN is ${expectedLength} characters, got ${value.length}`);
  }
  if (value.length < 15 || value.length > 34) {
    return fail(`an IBAN is 15-34 characters, got ${value.length}`);
  }
  const remainder = mod97(value.slice(4) + value.slice(0, 4));
  if (remainder !== 1) {
    return fail('check digits do not match the account number (mod 97)');
  }
  const result = { valid: true, value, country, formatted: formatIban(value) };
  if (country === 'TR') {
    // TR: 2 country, 2 check, 5 bank, 1 reserved, 16 account.
    result.bankCode = value.slice(4, 9);
    result.accountNumber = value.slice(10);
    if (value[9] !== '0') {
      // Reserved and always zero in practice; worth surfacing rather than
      // rejecting, since the mod-97 check already passed.
      result.note = `reserved digit is ${value[9]}, normally 0`;
    }
  }
  return result;
}

export const isIban = (input) => validateIban(input).valid;

/** Groups of four, the way it is printed on paper. */
export function formatIban(input) {
  const value = String(input ?? '').replace(/\s/g, '').toUpperCase();
  return value.replace(/(.{4})/g, '$1 ').trim();
}

// --- licence plates ---------------------------------------------------------

export const PROVINCES = [
  null, 'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara',
  'Antalya', 'Artvin', 'Aydın', 'Balıkesir', 'Bilecik', 'Bingöl', 'Bitlis',
  'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli',
  'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir',
  'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkâri', 'Hatay', 'Isparta',
  'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli',
  'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa',
  'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu',
  'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat',
  'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak',
  'Aksaray', 'Bayburt', 'Karaman', 'Kırıkkale', 'Batman', 'Şırnak', 'Bartın',
  'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye', 'Düzce',
];

// Letters and digits are not independent: the combination is what is legal.
const PLATE_SHAPES = { 1: [4, 5], 2: [3, 4], 3: [2, 3] };

export function validatePlate(input) {
  const raw = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (!raw) return fail('empty');
  const match = /^(\d{2})([A-Z]{1,3})(\d{2,5})$/.exec(raw);
  if (!match) {
    return fail('expected two digits, one to three letters, then two to five digits');
  }
  const [, provinceCode, letters, numbers] = match;
  const province = Number(provinceCode);
  if (province < 1 || province > 81) {
    return fail(`${provinceCode} is not a province code (01-81)`);
  }
  const allowed = PLATE_SHAPES[letters.length];
  if (!allowed.includes(numbers.length)) {
    return fail(
      `${letters.length} letter(s) go with ${allowed.join(' or ')} digits, `
      + `got ${numbers.length}`,
    );
  }
  return {
    valid: true,
    value: `${provinceCode} ${letters} ${numbers}`,
    province: PROVINCES[province],
    provinceCode: province,
    letters,
    numbers,
  };
}

export const isPlate = (input) => validatePlate(input).valid;

// --- phone numbers ----------------------------------------------------------

const MOBILE_PREFIXES = new Set([
  '501', '505', '506', '507', '551', '552', '553', '554', '555', '559', // Turkcell
  '530', '531', '532', '533', '534', '535', '536', '537', '538', '539', // Türk Telekom
  '540', '541', '542', '543', '544', '545', '546', '547', '548', '549', // Vodafone
  '561', '599',
]);

/**
 * Normalise a Turkish number to E.164.
 *
 * Accepts the five ways people type it: `0532 123 45 67`, `532 123 4567`,
 * `+90 532 …`, `0090532…`, `(0532) 123-45-67`.
 */
export function validatePhone(input) {
  let value = String(input ?? '').replace(/[\s().\-/]/g, '');
  if (!value) return fail('empty');
  if (value.startsWith('+90')) value = value.slice(3);
  else if (value.startsWith('0090')) value = value.slice(4);
  else if (value.startsWith('90') && value.length === 12) value = value.slice(2);
  else if (value.startsWith('0')) value = value.slice(1);
  if (!/^\d+$/.test(value)) return fail('must be digits only');
  if (value.length !== 10) {
    return fail(`a Turkish number has 10 digits after the country code, got ${value.length}`);
  }
  const area = value.slice(0, 3);
  if (area[0] === '0') return fail('area code cannot start with 0');
  const mobile = MOBILE_PREFIXES.has(area);
  return {
    valid: true,
    value: `+90${value}`,
    national: `0${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6, 8)} ${value.slice(8)}`,
    kind: mobile ? 'mobile' : (area[0] === '5' ? 'mobile-unknown-prefix' : 'landline'),
    areaCode: area,
  };
}

export const isPhone = (input) => validatePhone(input).valid;

// --- test fixtures ----------------------------------------------------------

const randomDigit = () => Math.floor(Math.random() * 10);

/**
 * A checksum-valid TCKN for **test fixtures**.
 *
 * It is a random number that passes the arithmetic. It is not anybody's
 * identity number, and it will not pass verification against NVI - which is the
 * point: seeding a test database needs numbers your validator accepts, and
 * using a real person's is both illegal and unnecessary.
 */
export function fakeTckn() {
  let first9 = String(1 + Math.floor(Math.random() * 9));
  while (first9.length < 9) first9 += randomDigit();
  return first9 + tcknCheckDigits(first9);
}

/** A checksum-valid VKN, for the same reason. */
export function fakeVkn() {
  let first9 = '';
  while (first9.length < 9) first9 += randomDigit();
  return first9 + vknCheckDigit(first9);
}

/** A checksum-valid TR IBAN, for the same reason. */
export function fakeIban(bankCode = '00061') {
  let account = '';
  while (account.length < 16) account += randomDigit();
  const body = `${bankCode}0${account}`;
  const remainder = mod97(`${body}TR00`);
  const check = String(98 - remainder).padStart(2, '0');
  return `TR${check}${body}`;
}

export default {
  validateTckn, isTckn, tcknCheckDigits,
  validateVkn, isVkn, vknCheckDigit, validateTaxId,
  validateIban, isIban, formatIban, mod97,
  validatePlate, isPlate, PROVINCES,
  validatePhone, isPhone,
  fakeTckn, fakeVkn, fakeIban,
};
