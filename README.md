# tr-doc

Validate Turkish identifiers by their real checksums — national id, tax
number, IBAN, licence plate, phone — and get back a reason when they fail.

```js
import { validateTckn, validateIban, validatePlate, validatePhone } from 'tr-doc';

validateTckn('11111111111');
// { valid: false, reason: 'all digits are the same' }

validateTckn('10000000145');
// { valid: false, reason: 'check digits are 45, expected 46' }

validateIban('TR3300061005197864578413');
// { valid: false, reason: 'a TR IBAN is 26 characters, got 24' }

validatePlate('34 A 123');
// { valid: false, reason: '1 letter(s) go with 4 or 5 digits, got 3' }

validatePhone('+90 532 123 4567');
// { valid: true, value: '+905321234567', national: '0532 123 45 67', kind: 'mobile' }
```

`/^\d{11}$/` accepts `11111111111`. It is not a national id — the checksum says
so — and the form that accepted it has just created a customer record nobody
can invoice.

## Install

```bash
npm install tr-doc
```

Zero dependencies, ESM, Node 18+ and any browser.

## Validation is not verification

A TCKN with the right check digits tells you the number **wasn't mistyped**.
Whether it belongs to the person filling in your form is a question only the
state's own service (NVİ) can answer, and it needs the name and birth year too.
This library is the cheap first gate that stops a typo reaching that service —
not an identity check, and it is not sold as one.

## What it checks

### TCKN — 11 digits

```
d10 = ((d1+d3+d5+d7+d9) × 7 − (d2+d4+d6+d8)) mod 10
d11 =  (d1…d10 summed) mod 10
```

Note the **subtraction**. A checksum that only added would miss a
transposition, which is the most common typing error there is — there's a test
that swaps two adjacent digits and asserts the result is rejected, and another
that changes each of the eleven digits in turn.

Repeated-digit numbers get their own message. Worth saying plainly: they are
not a hole in the arithmetic. For any digit `k` the tenth check digit comes out
as `k` and the eleventh as `0`, which only agree at `k = 0` — and that's
already out for the leading zero. The explicit check exists for the error
message.

### VKN — 10 digits

Each digit is shifted by its distance from the end, doubled by a power of two
and reduced mod 9 — **except** when the shift lands on 9, which is carried
as-is. That exception isn't decoration: `9 mod 9` is `0`, so without it the
scheme loses digits.

`validateTaxId` takes either and tells you which it got:

```js
validateTaxId('1234567801').kind   // 'vkn'  (10 digits)
validateTaxId('10000000146').kind  // 'tckn' (11 digits)
```

### IBAN — ISO 7064 mod-97-10

Move the first four characters to the end, turn letters into numbers
(`A` = 10), and the result must be `1 mod 97`.

The number is far too big for a JavaScript double, so the remainder is reduced
**as it is built**. `Number('3300061005197864578413260000')` silently loses the
low digits and starts accepting invalid IBANs — there's a test comparing
`mod97` against `BigInt` arithmetic over 40 digits.

Lengths are enforced per country for the 45 a Turkish business actually sees;
an unknown country still gets the checksum. A valid TR IBAN comes back split
into bank code and account number, plus a paper-ready `formatted`.

### Licence plates

Letters and digits are **not independent** — the combination is what's legal:

| letters | digits |
| --- | --- |
| 1 | 4 or 5 |
| 2 | 3 or 4 |
| 3 | 2 or 3 |

So `34 A 1234` and `35 ABC 12` are fine, and `34 A 123` isn't. The province
code must be 01–81, and you get the province name back:

```js
validatePlate('34a1234');
// { valid: true, value: '34 A 1234', province: 'İstanbul', provinceCode: 34, … }
```

### Phone numbers

Normalises the five ways people type one — `0532 123 45 67`, `+90 532 …`,
`00905321234567`, `(0532) 123-45-67`, `5321234567` — to E.164, and says whether
it's a mobile or a landline from the allocated prefix blocks. A `5xx` prefix
that isn't an allocated block is reported as `mobile-unknown-prefix` rather
than quietly accepted, because the blocks change and silently guessing is worse
than saying so.

## Test fixtures

```js
import { fakeTckn, fakeVkn, fakeIban } from 'tr-doc';

fakeTckn();        // '45672918306'  — checksum-valid, nobody's
fakeIban('00062'); // 'TR…'
```

Seeding a test database needs numbers your own validator accepts. These are
random numbers that pass the arithmetic — they won't pass verification against
NVİ, which is exactly the point: using a real person's id in a fixture is both
unnecessary and not yours to do.

## API

```js
validateTckn(input)  isTckn(input)  tcknCheckDigits(first9)
validateVkn(input)   isVkn(input)   vknCheckDigit(first9)   validateTaxId(input)
validateIban(input)  isIban(input)  formatIban(input)       mod97(rearranged)
validatePlate(input) isPlate(input) PROVINCES
validatePhone(input) isPhone(input)
fakeTckn()  fakeVkn()  fakeIban(bankCode?)
```

Every `validate*` returns `{ valid: true, … }` with the parsed parts, or
`{ valid: false, reason }` — a string you can show a user. Input is accepted
with spaces, dots and dashes, in any case.

## Tests

```bash
npm test
```

35 tests, including: a hand-checkable TCKN, every single-digit mutation of a
valid one, transpositions, the mod-97 result compared against `BigInt`, each
legal plate shape, and 500 generated fixtures of each kind round-tripping
through their validator.

## License

MIT
