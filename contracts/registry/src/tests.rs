use super::*;
use near_sdk::json_types::{U64, U128};
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::{NearToken, testing_env};

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn context(signer: &str, predecessor: &str, deposit: u128) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(account("registry.testnet"))
            .signer_account_id(account(signer))
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(10))
            .block_timestamp(100)
            .build()
    );
}

fn init() -> Registry {
    context("registry.testnet", "registry.testnet", 0);
    Registry::new(account("manager.testnet"), Network::Testnet)
}

fn input() -> TemplateInput {
    TemplateInput {
        dao_account_id: account("community.sputnikv2.testnet"),
        title: "Documentation maintenance".to_owned(),
        description: "Update the public documentation".to_owned(),
        start_at_ns: U64(100),
        interval_ns: U64(1000),
        work_window_ns: U64(500),
        claim_duration_ns: U64(100),
        amount_yocto: U128(1_000_000_000_000_000_000_000_000),
    }
}

#[test]
fn self_init_round_trips_state_and_emits_event() {
    let registry = init();
    let encoded = near_sdk::borsh::to_vec(&registry).unwrap();
    let restored: Registry = near_sdk::borsh::from_slice(&encoded).unwrap();
    assert_eq!(restored.manager_id, account("manager.testnet"));
    assert_eq!(restored.network, Network::Testnet);
    assert_eq!(restored.schema_version, SCHEMA_VERSION);
    assert_eq!(
        restored.foundation_status(),
        "foundation: no business behavior"
    );
    assert!(get_logs()[0].starts_with("EVENT_JSON:"));
    let event: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(&get_logs()[0][11..]).unwrap();
    assert_eq!(event["event"], "registry_initialized");
    assert_eq!(event["data"][0]["manager_id"], "manager.testnet");
    env::state_write(&restored);
    assert!(env::state_exists());
}

#[test]
#[should_panic(expected = "ERR_INIT_NOT_SELF")]
fn external_caller_cannot_select_manager() {
    context("attacker.testnet", "attacker.testnet", 0);
    Registry::new(account("attacker.testnet"), Network::Testnet);
}

#[test]
#[should_panic(expected = "ERR_INIT_NOT_SELF")]
fn indirect_self_predecessor_cannot_initialize() {
    context("attacker.testnet", "registry.testnet", 0);
    Registry::new(account("attacker.testnet"), Network::Testnet);
}

#[test]
#[should_panic(expected = "ERR_UNEXPECTED_DEPOSIT")]
fn init_rejects_deposit() {
    context("registry.testnet", "registry.testnet", 1);
    Registry::new(account("manager.testnet"), Network::Testnet);
}

#[test]
#[should_panic(expected = "ERR_ALREADY_INITIALIZED")]
fn repeated_init_rejects_existing_state() {
    let registry = init();
    env::state_write(&registry);
    Registry::new(account("other.testnet"), Network::Testnet);
}

#[test]
#[should_panic(expected = "The contract is not initialized")]
fn default_is_not_implicit_init() {
    Registry::default();
}

#[test]
fn direct_manager_check_passes() {
    let registry = init();
    context("manager.testnet", "manager.testnet", 0);
    assert_eq!(registry.assert_manager(), account("manager.testnet"));
}

#[test]
#[should_panic(expected = "ERR_NOT_MANAGER")]
fn contributor_is_not_manager() {
    let registry = init();
    context("contributor.testnet", "contributor.testnet", 0);
    registry.assert_manager();
}

#[test]
#[should_panic(expected = "ERR_INDIRECT_CALLER")]
fn indirect_manager_call_rejected() {
    let registry = init();
    context("manager.testnet", "relay.testnet", 0);
    registry.assert_manager();
}

#[test]
fn period_arithmetic_and_claim_equality() {
    let data = input();
    assert_eq!(data.period_bounds(2), (2100, 2600));
    assert_eq!(checked_claim_expiry(200, 1000, 600), 600);
    let claim = Claim {
        claimant_id: account("contributor.testnet"),
        payout_recipient_id: account("contributor.testnet"),
        expires_at_ns: U64(300),
    };
    assert!(claim.is_active(299, 600));
    assert!(!claim.is_active(300, 600));
    assert!(!claim.is_active(600, 600));
}

#[test]
#[should_panic(expected = "ERR_TIME_OVERFLOW")]
fn period_overflow_rejected() {
    input().period_bounds(u64::MAX);
}

#[test]
#[should_panic(expected = "ERR_OVERLAPPING_PERIODS")]
fn overlapping_work_windows_rejected() {
    let mut data = input();
    data.work_window_ns = U64(1001);
    data.validate();
}

#[test]
#[should_panic(expected = "ERR_TITLE_TOO_LONG")]
fn title_limit_is_utf8_bytes() {
    let mut data = input();
    data.title = "é".repeat(61);
    data.validate();
}

#[test]
fn evidence_is_normalized_and_recomputed() {
    context("contributor.testnet", "contributor.testnet", 0);
    let evidence = Evidence::normalize("Example", "Docs", 42, &"AB".repeat(20));
    assert_eq!(evidence.url, "https://github.com/example/docs/pull/42");
    assert_eq!(evidence.commit_sha, "ab".repeat(20));
    let canonical = format!("[1,\"example\",\"docs\",\"42\",\"{}\"]", "ab".repeat(20));
    let expected: String = env::sha256(canonical.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(evidence.digest_sha256, expected);
    assert_eq!(
        near_sdk::serde_json::to_value(&evidence).unwrap()["pull_request_number"],
        "42"
    );
}

#[test]
#[should_panic(expected = "ERR_INVALID_GITHUB_NAME")]
fn evidence_cannot_inject_url_path() {
    context("contributor.testnet", "contributor.testnet", 0);
    Evidence::normalize("owner/evil", "docs", 1, &"a".repeat(40));
}

#[test]
fn decimal_json_does_not_lose_precision() {
    let mut data = input();
    data.amount_yocto = U128(u128::MAX);
    data.start_at_ns = U64(9_007_199_254_740_993);
    let text = near_sdk::serde_json::to_string(&data).unwrap();
    let restored: TemplateInput = near_sdk::serde_json::from_str(&text).unwrap();
    assert_eq!(restored, data);
    assert!(text.contains(&format!("\"{}\"", u128::MAX)));
}

#[test]
#[should_panic(expected = "ERR_RECIPIENT_MISMATCH")]
fn claim_cannot_bind_different_recipient() {
    Claim {
        claimant_id: account("contributor.testnet"),
        payout_recipient_id: account("other.testnet"),
        expires_at_ns: U64(300),
    }
    .validate();
}

#[test]
fn funded_state_and_max_record_storage_fit_reserve() {
    let mut registry = init();
    let long_account: AccountId = "a".repeat(64).parse().unwrap();
    let mut template_input = input();
    template_input.title = "t".repeat(MAX_TITLE_BYTES);
    template_input.description = "d".repeat(MAX_DESCRIPTION_BYTES);
    template_input.dao_account_id = long_account.clone();
    template_input.validate();
    let template = Template {
        id: U64(u64::MAX),
        manager_id: long_account.clone(),
        input: template_input,
        active: true,
        next_period_index: U64(u64::MAX),
        created_at_ns: U64(u64::MAX),
    };
    let before = env::storage_usage();
    registry.templates.insert(u64::MAX, template);
    registry.templates.flush();
    let template_growth = env::storage_usage() - before;
    assert!(
        template_growth <= TEMPLATE_RESERVE_BYTES,
        "template bytes: {template_growth}"
    );
    let key = CycleKey {
        template_id: U64(u64::MAX),
        period_index: U64(u64::MAX),
    };
    let proposal_key = ProposalKey {
        network: Network::Testnet,
        dao_account_id: long_account.clone(),
        proposal_id: U64(u64::MAX),
    };
    let evidence = Evidence::normalize(
        &"a".repeat(MAX_GITHUB_NAME_BYTES),
        &"b".repeat(MAX_GITHUB_NAME_BYTES),
        u64::MAX,
        &"c".repeat(40),
    );
    let cycle = Cycle {
        key: key.clone(),
        status: CycleStatus::Submitted,
        opens_at_ns: U64(1),
        deadline_at_ns: U64(1000),
        dao_account_id: long_account.clone(),
        amount_yocto: U128(u128::MAX),
        claim: Some(Claim {
            claimant_id: long_account.clone(),
            payout_recipient_id: long_account,
            expires_at_ns: U64(1000),
        }),
        evidence: Some(evidence),
        submitted_at_ns: Some(U64(999)),
        proposal_link: Some(ProposalLink {
            key: proposal_key.clone(),
            linked_at_ns: U64(u64::MAX),
        }),
    };
    cycle.validate();
    let before = env::storage_usage();
    registry.cycles.insert(key.clone(), cycle);
    registry.proposal_links.insert(proposal_key, key);
    registry.cycles.flush();
    registry.proposal_links.flush();
    let cycle_growth = env::storage_usage() - before;
    assert!(
        cycle_growth <= CYCLE_RESERVE_BYTES,
        "cycle+link bytes: {cycle_growth}"
    );
    registry.assert_storage_backed();
    println!(
        "measured SDK storage growth: template={template_growth}; cycle+proposal={cycle_growth}"
    );
}

#[test]
#[should_panic(expected = "ERR_STORAGE_NOT_BACKED")]
fn insufficient_account_storage_backing_rejected() {
    let registry = init();
    testing_env!(
        VMContextBuilder::new()
            .account_balance(NearToken::from_yoctonear(0))
            .storage_usage(1000)
            .build()
    );
    registry.assert_storage_backed();
}

fn claimed_cycle() -> Cycle {
    Cycle {
        key: CycleKey {
            template_id: U64(1),
            period_index: U64(0),
        },
        status: CycleStatus::Claimed,
        opens_at_ns: U64(100),
        deadline_at_ns: U64(600),
        dao_account_id: account("community.sputnikv2.testnet"),
        amount_yocto: U128(1),
        claim: Some(Claim {
            claimant_id: account("contributor.testnet"),
            payout_recipient_id: account("contributor.testnet"),
            expires_at_ns: U64(600),
        }),
        evidence: None,
        submitted_at_ns: None,
        proposal_link: None,
    }
}

#[test]
fn submitted_cycle_rejects_every_forged_evidence_field() {
    context("contributor.testnet", "contributor.testnet", 0);
    let mut canonical = claimed_cycle();
    canonical.status = CycleStatus::Submitted;
    canonical.submitted_at_ns = Some(U64(200));
    canonical.evidence = Some(Evidence::normalize("example", "docs", 42, &"a".repeat(40)));
    canonical.validate();
    let mut mutations = Vec::new();
    for field in 0..7 {
        let mut bad = canonical.clone();
        let evidence = bad.evidence.as_mut().unwrap();
        match field {
            0 => evidence.repository_owner = "A".repeat(MAX_GITHUB_NAME_BYTES + 1),
            1 => evidence.repository_name = "..".to_owned(),
            2 => evidence.pull_request_number = U64(0),
            3 => evidence.url = "https://attacker.invalid/forged".to_owned(),
            4 => evidence.commit_sha = "g".repeat(40),
            5 => evidence.digest_sha256 = "0".repeat(64),
            _ => evidence.repository_owner = "EXAMPLE".to_owned(),
        }
        mutations.push(bad);
    }
    for bad in mutations {
        assert!(std::panic::catch_unwind(|| bad.validate()).is_err());
    }
}

#[test]
fn claim_window_must_start_after_cycle_opening() {
    context("contributor.testnet", "contributor.testnet", 0);
    let valid = claimed_cycle();
    valid.validate();
    for expiry in [0, 100, 601] {
        let mut invalid = valid.clone();
        invalid.claim.as_mut().unwrap().expires_at_ns = U64(expiry);
        assert!(std::panic::catch_unwind(|| invalid.validate()).is_err());
    }
    // An elapsed-but-not-yet-settled valid claim remains a valid stored record.
    let mut elapsed = valid;
    elapsed.claim.as_mut().unwrap().expires_at_ns = U64(101);
    elapsed.validate();
}

#[test]
fn storage_prefixes_are_distinct() {
    let keys = [
        StorageKey::Templates,
        StorageKey::Cycles,
        StorageKey::ProposalLinks,
    ];
    let encoded: Vec<Vec<u8>> = keys
        .iter()
        .map(|key| near_sdk::borsh::to_vec(key).unwrap())
        .collect();
    assert_ne!(encoded[0], encoded[1]);
    assert_ne!(encoded[0], encoded[2]);
    assert_ne!(encoded[1], encoded[2]);
}
