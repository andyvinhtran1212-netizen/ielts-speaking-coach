"""AIBUDGET-0033 T001 — budget configuration parsing (FR-003, FR-006, FR-007, FR-015, FR-021)."""

import pytest

from config import Settings
from services import ai_budget_config as cfg

ALL_UNSET: dict = {}
HARD_SCOPES = ("google", "azure", "openai", "elevenlabs")
SOFT_SCOPES = ("total", "anthropic")


def test_every_scope_unset_uses_spec_defaults_and_is_never_invalid():
    configs = cfg.load_scope_configs(ALL_UNSET)
    assert set(configs) == {"total", "anthropic", "google", "azure", "openai", "elevenlabs"}
    assert {s: c.monthly_usd for s, c in configs.items()} == {
        "total": 200.0, "anthropic": 100.0, "google": 20.0,
        "azure": 20.0, "openai": 20.0, "elevenlabs": 20.0,
    }
    assert not any(c.config_invalid for c in configs.values())
    for scope in HARD_SCOPES:
        assert configs[scope].mode == "hard"
        assert configs[scope].daily_usd == pytest.approx(1.3333, abs=1e-4)
    for scope in SOFT_SCOPES:
        assert configs[scope].mode == "soft"
    assert configs["anthropic"].daily_usd == pytest.approx(100 / 30 * 2)
    assert configs["total"].daily_usd == pytest.approx(200 / 30 * 2)


@pytest.mark.parametrize("raw", ["", "   ", None])
def test_empty_or_whitespace_variable_takes_the_default(raw):
    for scope in cfg.SCOPES:
        parsed = cfg.parse_scope(scope, raw)
        assert not parsed.config_invalid
        assert parsed.monthly_usd == cfg.DEFAULT_MONTHLY_USD[scope]


def test_settings_defaults_parse_to_spec_defaults():
    # The real Settings object with no AI_BUDGET_* env: same as all unset.
    settings = Settings(_env_file=None)
    configs = cfg.load_scope_configs(settings)
    assert {s: c.monthly_usd for s, c in configs.items()} == cfg.DEFAULT_MONTHLY_USD
    assert not any(c.config_invalid for c in configs.values())
    assert cfg.budget_mode(settings) == "enforce"


def test_settings_reads_budget_variables_from_environment(monkeypatch):
    monkeypatch.setenv("AI_BUDGET_MONTHLY_USD_GOOGLE", "abc")
    monkeypatch.setenv("AI_BUDGET_MONTHLY_USD_OPENAI", "35.5")
    # An invalid value must not fail startup.
    settings = Settings(_env_file=None)
    configs = cfg.load_scope_configs(settings)
    assert configs["google"].config_invalid
    assert configs["openai"].monthly_usd == 35.5
    assert not configs["azure"].config_invalid


@pytest.mark.parametrize("raw", ["0", "-5", "abc", "$20", "nan", "inf", "-inf", "20 USD", 0, -1])
@pytest.mark.parametrize("scope", HARD_SCOPES)
def test_set_but_invalid_hard_scope_is_config_invalid_alone(scope, raw):
    configs = cfg.load_scope_configs({cfg.env_var_for(scope): raw})
    bad = configs[scope]
    assert bad.config_invalid
    assert bad.mode == "hard"
    assert bad.env_var == f"AI_BUDGET_MONTHLY_USD_{scope.upper()}"
    # Never "unlimited": no cap value at all, and the RPC gets nulls.
    assert bad.monthly_usd is None and bad.daily_usd is None
    assert bad.p_caps_entry()["month"] is None
    others = [c for s, c in configs.items() if s != scope]
    assert not any(c.config_invalid for c in others)


@pytest.mark.parametrize("scope", SOFT_SCOPES)
def test_set_but_invalid_soft_scope_is_config_invalid_with_soft_mode(scope):
    configs = cfg.load_scope_configs({cfg.env_var_for(scope): "abc"})
    bad = configs[scope]
    assert bad.config_invalid
    entry = bad.p_caps_entry()
    # FR-003/plan: null month/day with mode soft → no thresholds evaluated.
    assert entry == {"month": None, "day": None, "mode": "soft",
                     "thresholds": list(bad.monthly_thresholds)}
    assert not any(c.config_invalid for s, c in configs.items() if s != scope)


def test_valid_override_and_daily_derivation():
    parsed = cfg.parse_scope("azure", " 45 ")
    assert parsed.monthly_usd == 45.0
    assert parsed.daily_usd == pytest.approx(3.0)
    assert cfg.parse_scope("google", 12.5).monthly_usd == 12.5


def test_boolean_value_is_not_a_number():
    assert cfg.parse_scope("google", True).config_invalid


def test_unknown_scope_is_rejected():
    with pytest.raises(ValueError):
        cfg.parse_scope("mistral", "10")


def test_scope_modes_are_fixed_constants():
    assert {s: cfg.mode_for(s) for s in cfg.SCOPES} == {
        "total": "soft", "anthropic": "soft", "google": "hard",
        "azure": "hard", "openai": "hard", "elevenlabs": "hard",
    }
    # There is no variable for the mode: setting one changes nothing.
    configs = cfg.load_scope_configs({"AI_BUDGET_MODE_ANTHROPIC": "hard"})
    assert configs["anthropic"].mode == "soft"


def test_monthly_thresholds_anthropic_80_100_others_50_80_100():
    configs = cfg.load_scope_configs(ALL_UNSET)
    assert configs["anthropic"].monthly_thresholds == (80, 100)
    for scope in ("total",) + HARD_SCOPES:
        assert configs[scope].monthly_thresholds == (50, 80, 100)


def test_p_caps_shape_for_every_scope():
    caps = cfg.p_caps(cfg.load_scope_configs(ALL_UNSET))
    assert set(caps) == set(cfg.SCOPES)
    assert caps["google"] == {"month": 20.0, "day": pytest.approx(20 / 30 * 2),
                              "mode": "hard", "thresholds": [50, 80, 100]}
    assert caps["anthropic"]["thresholds"] == [80, 100]
    assert caps["anthropic"]["mode"] == "soft"


@pytest.mark.parametrize("raw,expected", [
    ("enforce", "enforce"), ("shadow", "shadow"), (" SHADOW ", "shadow"),
    ("", "enforce"), (None, "enforce"), ("off", "enforce"), ("shadoww", "enforce"),
])
def test_budget_mode_is_enforce_unless_exactly_shadow(raw, expected):
    assert cfg.budget_mode({"AI_BUDGET_MODE": raw}) == expected


@pytest.mark.parametrize("raw,on", [
    (None, False), ("", False), ("  ", False), ("off", False), ("OFF", False),
    ("false", False), ("False", False), ("0", False), (" 0 ", False),
    ("on", True), ("ON", True), ("true", True), ("1", True),
    ("yes", True), ("of", True), ("2", True), ("disabled", True),
])
def test_kill_switch_parsing(raw, on):
    environ = {} if raw is None else {"AI_KILL_SWITCH": raw}
    assert cfg.kill_switch_on(environ) is on


def test_kill_switch_reads_process_environment_per_call(monkeypatch):
    monkeypatch.delenv("AI_KILL_SWITCH", raising=False)
    assert cfg.kill_switch_on() is False
    monkeypatch.setenv("AI_KILL_SWITCH", "on")
    assert cfg.kill_switch_on() is True
    monkeypatch.setenv("AI_KILL_SWITCH", "off")
    assert cfg.kill_switch_on() is False


def test_kill_switch_is_not_a_cached_settings_field():
    assert "AI_KILL_SWITCH" not in Settings.model_fields


def test_paid_ai_quotas_current_defaults_are_valid():
    quotas = cfg.load_paid_ai_quotas(Settings(_env_file=None))
    assert set(quotas) == set(cfg.PAID_AI_QUOTA_VARS)
    assert not any(q.config_invalid for q in quotas.values())
    assert quotas["MAX_GRADINGS_PER_USER_PER_DAY"].value == 200


@pytest.mark.parametrize("name", cfg.PAID_AI_QUOTA_VARS)
@pytest.mark.parametrize("raw", [0, -1, "0", "-3", "abc"])
def test_paid_ai_quota_zero_negative_or_unparseable_is_config_invalid(name, raw):
    source = {n: 10 for n in cfg.PAID_AI_QUOTA_VARS}
    source[name] = raw
    quotas = cfg.load_paid_ai_quotas(source)
    assert quotas[name].config_invalid
    assert not any(q.config_invalid for n, q in quotas.items() if n != name)


def test_paid_ai_quota_zero_from_environment(monkeypatch):
    monkeypatch.setenv("MAX_GRADINGS_PER_USER_PER_DAY", "0")
    quotas = cfg.load_paid_ai_quotas(Settings(_env_file=None))
    assert quotas["MAX_GRADINGS_PER_USER_PER_DAY"].config_invalid
    assert quotas["MAX_GRADINGS_PER_USER_PER_DAY"].value == 0


def test_startup_summary_names_invalid_variable_and_holds_no_secrets():
    source = {
        "AI_BUDGET_MONTHLY_USD_GOOGLE": "abc",
        "AI_BUDGET_MODE": "shadow",
        "ANTHROPIC_API_KEY": "sk-ant-should-never-appear",
        **{n: 5 for n in cfg.PAID_AI_QUOTA_VARS},
    }
    line = cfg.startup_summary(source, environ={"AI_KILL_SWITCH": "on"})
    assert "mode=shadow" in line
    assert "kill_switch=on" in line
    assert "google=hard:config_invalid(AI_BUDGET_MONTHLY_USD_GOOGLE)" in line
    assert "anthropic=soft:100/month" in line
    assert "sk-ant" not in line
