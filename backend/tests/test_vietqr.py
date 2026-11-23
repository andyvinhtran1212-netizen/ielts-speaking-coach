"""G05-T11 / ENROLL-0060: VietQR payload builder (services/vietqr.py).

Account numbers below are FAKE (giả). The public reference payloads come from
independent open-source VietQR encoders (npm ``vietnam-qr-pay``, Dart
``vietqr_gen``); they are used only to cross-check the TLV layout and CRC.
"""

import pytest

from services.vietqr import build_payload, crc16_ccitt

# Reference payloads published by third-party encoders (layout cross-check).
# ACB 970416, account 257678859, 10 000 VND, memo "Chuyen tien" (vietnam-qr-pay).
_REF_ACB_DYNAMIC = (
    "00020101021238530010A0000007270123000697041601092576788590208QRIBFTTA"
    "53037045405100005802VN62150811Chuyen tien630453E6"
)
# Same account, 999 999 VND, memo "Cam on nhe" (vietnam-qr-pay).
_REF_ACB_DYNAMIC_2 = (
    "00020101021238530010A0000007270123000697041601092576788590208QRIBFTTA"
    "530370454069999995802VN62140810Cam on nhe6304E786"
)
# Static payload without amount, Techcombank 970407 (vietqr_gen).
_REF_TCB_STATIC = (
    "00020101021138540010A00000072701240006970407011096020919960208QRIBFTTA"
    "53037045802VN630434A0"
)

_VALID = dict(bank_bin="970436", account_no="0123456789", amount_vnd=10000, note="AVER-ABC234")


def test_crc16_ccitt_false_check_value():
    assert crc16_ccitt("123456789") == "29B1"
    assert crc16_ccitt(b"123456789") == "29B1"


@pytest.mark.parametrize("reference", [_REF_ACB_DYNAMIC, _REF_ACB_DYNAMIC_2, _REF_TCB_STATIC])
def test_crc_matches_published_reference_payloads(reference):
    body, crc = reference[:-4], reference[-4:]
    assert body.endswith("6304")
    assert crc16_ccitt(body) == crc


def test_layout_matches_reference_up_to_memo():
    # Same bank, account and amount as _REF_ACB_DYNAMIC; only the memo (tag 62)
    # and therefore the CRC differ.
    payload = build_payload(bank_bin="970416", account_no="257678859", amount_vnd=10000, note="AVER-ABC234")
    prefix = _REF_ACB_DYNAMIC.split("6215")[0]
    assert payload.startswith(prefix)
    assert payload[len(prefix):] == "62150811AVER-ABC2346304" + payload[-4:]


def test_full_payload_character_by_character():
    payload = build_payload(**_VALID)
    expected_body = (
        "000201"            # payload format indicator
        "010212"            # dynamic QR (amount present)
        "3854"
        "0010A000000727"    # NAPAS GUID
        "0124" "0006970436" "01100123456789"
        "0208QRIBFTTA"      # account-transfer service
        "5303704"           # VND
        "540510000"         # amount
        "5802VN"
        "6215" "0811AVER-ABC234"
        "6304"
    )
    assert payload == expected_body + crc16_ccitt(expected_body)
    assert payload.startswith("000201010212")
    assert len(payload[-4:]) == 4 and all(c in "0123456789ABCDEF" for c in payload[-4:])


def test_alphanumeric_account_and_bounds_accepted():
    assert build_payload(bank_bin="970454", account_no="99ZP24009M07248267", amount_vnd=1, note="AVER-Z9Z9Z9")
    assert build_payload(bank_bin="970436", account_no="1" * 19, amount_vnd=999_999_999, note="AVER-222222")


@pytest.mark.parametrize(
    "field,value",
    [
        ("bank_bin", "97043"),
        ("bank_bin", "9704366"),
        ("bank_bin", "97043A"),
        ("bank_bin", 970436),
        ("account_no", ""),
        ("account_no", "1" * 20),
        ("account_no", "0123 456"),
        ("account_no", "abc123"),
        ("amount_vnd", 0),
        ("amount_vnd", -1),
        ("amount_vnd", 1_000_000_000),
        ("amount_vnd", 10000.0),
        ("amount_vnd", "10000"),
        ("amount_vnd", True),
        ("note", "AVER-ABC23"),
        ("note", "AVER-ABC2345"),
        ("note", "aver-abc234"),
        ("note", "XAVER-ABC234"),
        ("note", "Chuyen tien"),
        ("note", "AVER-ABC234\n"),
    ],
)
def test_invalid_input_raises(field, value):
    with pytest.raises(ValueError):
        build_payload(**{**_VALID, field: value})


@pytest.mark.parametrize("ambiguous", ["O", "0", "I", "1", "L"])
def test_order_code_with_ambiguous_characters_rejected(ambiguous):
    with pytest.raises(ValueError):
        build_payload(**{**_VALID, "note": f"AVER-ABC23{ambiguous}"})
