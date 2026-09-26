import uuid

from app.services.messaging_gateway import (
    ALPHABET,
    approve_pairing_code,
    generate_pairing_code,
    get_gateway_configs,
    is_user_approved,
    list_approved_devices,
    list_pending_pairings,
    request_pairing,
    revoke_device,
    save_gateway_config,
)


def test_pairing_code_format():
    code = generate_pairing_code()
    assert len(code) == 9  # 4 chars + '-' + 4 chars
    assert code[4] == "-"
    parts = code.split("-")
    assert len(parts) == 2
    for char in parts[0] + parts[1]:
        assert char in ALPHABET
        assert char not in ("0", "O", "1", "I")


def test_pairing_lifecycle(tmp_path):
    user_id = f"tg_user_{uuid.uuid4().hex}"
    
    # 1. Initially not approved
    assert not is_user_approved("telegram", user_id)

    # 2. Request pairing code
    ok, _msg, code = request_pairing("telegram", user_id, "Alice Test")
    assert ok is True
    assert code is not None

    # 3. Check code appears in pending list
    pending = list_pending_pairings()
    assert any(p["code"] == code for p in pending)

    # 4. Approve code
    approved_ok, _approve_msg, dev = approve_pairing_code(code)
    assert approved_ok is True
    assert dev is not None
    assert dev["user_id"] == user_id

    # 5. Check user is now approved
    assert is_user_approved("telegram", user_id) is True
    approved_list = list_approved_devices()
    assert any(d["user_id"] == user_id for d in approved_list)

    # 6. Revoke approval
    revoked = revoke_device("telegram", user_id)
    assert revoked is True
    assert not is_user_approved("telegram", user_id)


def test_bot_config_persistence():
    save_gateway_config(
        platform="telegram",
        bot_token="123456789:ABCdefGhIJKlmNoPQRstuVWXyz",
        chat_id="987654321",
        is_active=True,
        notify_on_approval=True
    )
    configs = get_gateway_configs()
    assert "telegram" in configs
    tg = configs["telegram"]
    assert tg["has_token"] is True
    assert tg["masked_token"].startswith("1234")
    assert tg["chat_id"] == "987654321"
