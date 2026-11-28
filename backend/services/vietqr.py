"""VietQR (NAPAS 247 account transfer) payload builder.

ENROLL-0060 / GOI-05 §5.8, task G05-T11. Pure functions only: no network,
no configuration, no logging. The bank details come from the caller
(COURSEACCESS-0055 reads ``ENROLL_BANK_*`` and builds ``Order.transfer``);
this module never declares a second set of bank settings.

Payload layout (EMVCo merchant-presented QR, TLV = 2-digit id + 2-digit
length + value), as used by NAPAS VietQR for an account transfer:

    00 "01"                      payload format indicator
    01 "12"                      point of initiation: dynamic (amount present)
    38                           merchant account information, NAPAS:
       00 "A000000727"             NAPAS GUID
       01                          beneficiary organisation:
          00 <bank BIN, 6 digits>
          01 <account number>
       02 "QRIBFTTA"               service code: transfer to an account
    53 "704"                     currency, VND (ISO 4217 numeric)
    54 <integer amount>          transaction amount, whole dong
    58 "VN"                      country code
    62                           additional data field:
       08 <order code>             purpose of transaction (transfer memo)
    63 <CRC>                     CRC-16/CCITT-FALSE over everything up to and
                                 including "6304", 4 upper-case hex chars

Source check: NAPAS has not published its "VietQR – Đặc tả kỹ thuật" openly,
so the layout above was cross-checked against public payloads produced by
independent open-source VietQR encoders (npm ``vietnam-qr-pay``, Dart
``vietqr_gen``) and recomputed here byte for byte (see
``tests/test_vietqr.py``). Acceptance still requires a real scan in at least
three Vietnamese banking apps before the order screen ships (GOI-05 §9).

Inputs are validated strictly and invalid input raises ``ValueError``; the
builder never returns a payload that a banking app would mis-read.
"""

from __future__ import annotations

import re

NAPAS_GUID = "A000000727"
SERVICE_ACCOUNT_TRANSFER = "QRIBFTTA"
CURRENCY_VND = "704"
COUNTRY_VN = "VN"

MAX_AMOUNT_VND = 999_999_999

_BANK_BIN_RE = re.compile(r"^[0-9]{6}$")
_ACCOUNT_NO_RE = re.compile(r"^[0-9A-Z]{1,19}$")
# Order code from COURSEACCESS-0055 FR-022: "AVER-" + 6 characters from the
# alphabet 23456789ABCDEFGHJKMNPQRSTUVWXYZ (no 0, 1, I, L, O).
ORDER_CODE_RE = re.compile(r"^AVER-[2-9A-HJKMNP-Z]{6}$")


def crc16_ccitt(data: str | bytes) -> str:
    """CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no xorout).

    Returns 4 upper-case hex characters. ``crc16_ccitt("123456789") == "29B1"``.
    """
    raw = data.encode("ascii") if isinstance(data, str) else bytes(data)
    crc = 0xFFFF
    for byte in raw:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return f"{crc:04X}"


def _tlv(tag: str, value: str) -> str:
    length = len(value)
    if length > 99:
        raise ValueError(f"VietQR field {tag} is longer than 99 characters")
    return f"{tag}{length:02d}{value}"


def build_payload(*, bank_bin: str, account_no: str, amount_vnd: int, note: str) -> str:
    """Return the VietQR payload string for one bank transfer.

    ``note`` is the order code (``AVER-XXXXXX``) and becomes the transfer memo.
    Raises ``ValueError`` on any invalid input.
    """
    if not isinstance(bank_bin, str) or not _BANK_BIN_RE.fullmatch(bank_bin):
        raise ValueError("bank_bin must be exactly 6 digits")
    if not isinstance(account_no, str) or not _ACCOUNT_NO_RE.fullmatch(account_no):
        raise ValueError("account_no must be 1-19 characters from [0-9A-Z]")
    # bool is an int subclass; True must not pass as 1 dong.
    if isinstance(amount_vnd, bool) or not isinstance(amount_vnd, int):
        raise ValueError("amount_vnd must be an integer number of dong")
    if not 1 <= amount_vnd <= MAX_AMOUNT_VND:
        raise ValueError(f"amount_vnd must be between 1 and {MAX_AMOUNT_VND}")
    if not isinstance(note, str) or not ORDER_CODE_RE.fullmatch(note):
        raise ValueError("note must be an order code AVER- plus 6 characters")

    beneficiary = _tlv("00", bank_bin) + _tlv("01", account_no)
    merchant_account = (
        _tlv("00", NAPAS_GUID)
        + _tlv("01", beneficiary)
        + _tlv("02", SERVICE_ACCOUNT_TRANSFER)
    )
    body = (
        _tlv("00", "01")
        + _tlv("01", "12")
        + _tlv("38", merchant_account)
        + _tlv("53", CURRENCY_VND)
        + _tlv("54", str(amount_vnd))
        + _tlv("58", COUNTRY_VN)
        + _tlv("62", _tlv("08", note))
        + "6304"
    )
    return body + crc16_ccitt(body)
