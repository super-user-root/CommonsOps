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

fn operator_at(now_ns: u64, deposit: u128) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(account("registry.testnet"))
            .signer_account_id(account("manager.testnet"))
            .predecessor_account_id(account("manager.testnet"))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(10))
            .block_timestamp(now_ns)
            .build()
    );
}

fn create_funded(registry: &mut Registry) -> Template {
    operator_at(100, storage_reserve_cost(TEMPLATE_RESERVE_BYTES));
    registry.create_template(input())
}

#[test]
fn operator_creates_template_and_due_cycle() {
    let mut registry = init();
    let template = create_funded(&mut registry);
    assert_eq!(template.id.0, 0);
    assert_eq!(registry.next_template_id, 1);
    assert_eq!(registry.get_template(U64(0)), Some(template));
    operator_at(100, storage_reserve_cost(CYCLE_RESERVE_BYTES));
    let cycle = registry.materialize_cycle(U64(0));
    assert_eq!(cycle.key.period_index.0, 0);
    assert_eq!(cycle.opens_at_ns.0, 100);
    assert_eq!(cycle.deadline_at_ns.0, 600);
    assert_eq!(cycle.status, CycleStatus::Open);
    assert_eq!(registry.get_cycle(cycle.key.clone()), Some(cycle));
    assert_eq!(
        registry.get_template(U64(0)).unwrap().next_period_index.0,
        1
    );
    assert_eq!(registry.cycle_count, 1);
}

#[test]
#[should_panic(expected = "ERR_NOT_MANAGER")]
fn nonmanager_cannot_create_template() {
    let mut registry = init();
    context(
        "contributor.testnet",
        "contributor.testnet",
        storage_reserve_cost(TEMPLATE_RESERVE_BYTES),
    );
    registry.create_template(input());
}

#[test]
#[should_panic(expected = "ERR_INSUFFICIENT_STORAGE_DEPOSIT")]
fn unfunded_template_rejected() {
    let mut registry = init();
    operator_at(100, storage_reserve_cost(TEMPLATE_RESERVE_BYTES) - 1);
    registry.create_template(input());
}

#[test]
#[should_panic(expected = "ERR_INSUFFICIENT_STORAGE_DEPOSIT")]
fn unfunded_cycle_rejected() {
    let mut registry = init();
    create_funded(&mut registry);
    operator_at(100, 0);
    registry.materialize_cycle(U64(0));
}

#[test]
#[should_panic(expected = "ERR_PERIOD_NOT_DUE")]
fn cycle_before_due_rejected() {
    let mut registry = init();
    create_funded(&mut registry);
    operator_at(99, storage_reserve_cost(CYCLE_RESERVE_BYTES));
    registry.materialize_cycle(U64(0));
}

#[test]
#[should_panic(expected = "ERR_PERIOD_EXPIRED")]
fn cycle_at_exact_deadline_rejected() {
    let mut registry = init();
    create_funded(&mut registry);
    operator_at(600, storage_reserve_cost(CYCLE_RESERVE_BYTES));
    registry.materialize_cycle(U64(0));
}

#[test]
fn pause_resume_preserves_economics_and_existing_cycle() {
    let mut registry = init();
    let original = create_funded(&mut registry);
    operator_at(100, storage_reserve_cost(CYCLE_RESERVE_BYTES));
    let cycle = registry.materialize_cycle(U64(0));
    operator_at(100, 0);
    let paused = registry.set_template_active(U64(0), false);
    assert!(!paused.active);
    assert_eq!(paused.input, original.input);
    assert_eq!(registry.get_cycle(cycle.key.clone()), Some(cycle));
    let resumed = registry.set_template_active(U64(0), true);
    assert!(resumed.active);
    assert_eq!(resumed.next_period_index.0, 1);
}

#[test]
#[should_panic(expected = "ERR_TEMPLATE_PAUSED")]
fn paused_template_cannot_materialize() {
    let mut registry = init();
    create_funded(&mut registry);
    operator_at(100, 0);
    registry.set_template_active(U64(0), false);
    operator_at(100, storage_reserve_cost(CYCLE_RESERVE_BYTES));
    registry.materialize_cycle(U64(0));
}

#[test]
#[should_panic(expected = "ERR_DUPLICATE_CYCLE")]
fn existing_period_cannot_be_materialized_twice() {
    let mut registry = init();
    create_funded(&mut registry);
    operator_at(100, storage_reserve_cost(CYCLE_RESERVE_BYTES));
    registry.materialize_cycle(U64(0));
    // Simulate a persisted duplicate index instead of testing only normal index advancement.
    registry.templates.get_mut(&0).unwrap().next_period_index = U64(0);
    registry.materialize_cycle(U64(0));
}

#[test]
fn only_expired_periods_are_skipped_and_skip_is_bounded() {
    let mut registry = init();
    create_funded(&mut registry);
    operator_at(1600, 0);
    assert_eq!(registry.skip_expired_periods(U64(0), U64(2)).0, 2);
    assert_eq!(registry.cycle_count, 0);
    assert_eq!(
        registry.get_template(U64(0)).unwrap().next_period_index.0,
        2
    );
}

#[test]
#[should_panic(expected = "ERR_SKIP_LIVE_PERIOD")]
fn live_period_skip_rejected() {
    let mut registry = init();
    create_funded(&mut registry);
    operator_at(599, 0);
    registry.skip_expired_periods(U64(0), U64(1));
}

#[test]
#[should_panic(expected = "ERR_INVALID_SKIP_COUNT")]
fn unbounded_skip_rejected() {
    let mut registry = init();
    create_funded(&mut registry);
    operator_at(u64::MAX, 0);
    registry.skip_expired_periods(U64(0), U64(MAX_SKIP_COUNT + 1));
}

#[test]
#[should_panic(expected = "ERR_TEMPLATE_CAPACITY")]
fn template_cap_rejected() {
    let mut registry = init();
    registry.next_template_id = MAX_TEMPLATES;
    operator_at(100, storage_reserve_cost(TEMPLATE_RESERVE_BYTES));
    registry.create_template(input());
}

#[test]
#[should_panic(expected = "ERR_CYCLE_CAPACITY")]
fn cycle_cap_rejected() {
    let mut registry = init();
    create_funded(&mut registry);
    registry.cycle_count = MAX_CYCLES;
    operator_at(100, storage_reserve_cost(CYCLE_RESERVE_BYTES));
    registry.materialize_cycle(U64(0));
}

#[test]
fn missing_views_are_none() {
    let registry = init();
    assert!(registry.get_template(U64(99)).is_none());
    assert!(
        registry
            .get_cycle(CycleKey {
                template_id: U64(99),
                period_index: U64(0)
            })
            .is_none()
    );
}

fn open_cycle() -> (Registry, CycleKey) {
    let mut registry = init();
    create_funded(&mut registry);
    operator_at(100, storage_reserve_cost(CYCLE_RESERVE_BYTES));
    let cycle = registry.materialize_cycle(U64(0));
    (registry, cycle.key)
}

fn contributor_at(name: &str, now_ns: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(account("registry.testnet"))
            .signer_account_id(account(name))
            .predecessor_account_id(account(name))
            .attached_deposit(NearToken::from_yoctonear(0))
            .account_balance(NearToken::from_near(10))
            .block_timestamp(now_ns)
            .build()
    );
}

#[test]
fn contributor_claims_releases_and_another_contributor_claims() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    let first = registry.claim_cycle(key.clone());
    assert_eq!(first.status, CycleStatus::Claimed);
    assert_eq!(
        first.claim.as_ref().unwrap().claimant_id,
        account("alice.testnet")
    );
    assert_eq!(
        first.claim.as_ref().unwrap().payout_recipient_id,
        account("alice.testnet")
    );
    assert_eq!(first.claim.as_ref().unwrap().expires_at_ns.0, 200);
    let released = registry.release_claim(key.clone());
    assert_eq!(released.status, CycleStatus::Open);
    assert!(released.claim.is_none());
    contributor_at("bob.testnet", 101);
    let second = registry.claim_cycle(key);
    assert_eq!(second.claim.unwrap().claimant_id, account("bob.testnet"));
}

#[test]
#[should_panic(expected = "ERR_CYCLE_NOT_OPEN")]
fn double_claim_rejected() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    registry.claim_cycle(key.clone());
    contributor_at("bob.testnet", 101);
    registry.claim_cycle(key);
}

#[test]
#[should_panic(expected = "ERR_NOT_CLAIMANT")]
fn another_contributor_cannot_release() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    registry.claim_cycle(key.clone());
    contributor_at("bob.testnet", 101);
    registry.release_claim(key);
}

#[test]
fn expired_claim_is_cleared_and_reassignable() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    registry.claim_cycle(key.clone());
    contributor_at("settler.testnet", 200);
    let reopened = registry.expire_cycle_or_claim(key.clone());
    assert_eq!(reopened.status, CycleStatus::Open);
    assert!(reopened.claim.is_none());
    contributor_at("bob.testnet", 200);
    assert_eq!(
        registry.claim_cycle(key).claim.unwrap().claimant_id,
        account("bob.testnet")
    );
}

#[test]
fn exact_cycle_deadline_is_terminal_expiry() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 599);
    let claimed = registry.claim_cycle(key.clone());
    assert_eq!(claimed.claim.unwrap().expires_at_ns.0, 600);
    contributor_at("settler.testnet", 600);
    let expired = registry.expire_cycle_or_claim(key.clone());
    assert_eq!(expired.status, CycleStatus::Expired);
    assert!(expired.claim.is_none());
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| registry.claim_cycle(key)))
            .is_err()
    );
}

#[test]
#[should_panic(expected = "ERR_NOT_EXPIRED")]
fn early_expiry_settlement_rejected() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    registry.claim_cycle(key.clone());
    contributor_at("settler.testnet", 199);
    registry.expire_cycle_or_claim(key);
}

#[test]
fn claimant_submits_canonical_immutable_evidence() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    registry.claim_cycle(key.clone());
    contributor_at("alice.testnet", 199);
    let submitted = registry.submit_evidence(
        key.clone(),
        "Example".to_owned(),
        "Docs".to_owned(),
        U64(42),
        "AB".repeat(20),
    );
    assert_eq!(submitted.status, CycleStatus::Submitted);
    assert_eq!(
        submitted.claim.as_ref().unwrap().payout_recipient_id,
        account("alice.testnet")
    );
    assert_eq!(
        submitted.evidence.as_ref().unwrap().url,
        "https://github.com/example/docs/pull/42"
    );
    assert_eq!(submitted.submitted_at_ns, Some(U64(199)));
    assert_eq!(registry.get_cycle(key).unwrap(), submitted);
}

#[test]
#[should_panic(expected = "ERR_NOT_CLAIMANT")]
fn nonclaimant_cannot_submit() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    registry.claim_cycle(key.clone());
    contributor_at("bob.testnet", 101);
    registry.submit_evidence(
        key,
        "example".to_owned(),
        "docs".to_owned(),
        U64(1),
        "a".repeat(40),
    );
}

#[test]
#[should_panic(expected = "ERR_CLAIM_EXPIRED")]
fn stale_claimant_cannot_submit_at_expiry() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    registry.claim_cycle(key.clone());
    contributor_at("alice.testnet", 200);
    registry.submit_evidence(
        key,
        "example".to_owned(),
        "docs".to_owned(),
        U64(1),
        "a".repeat(40),
    );
}

#[test]
#[should_panic(expected = "ERR_CYCLE_NOT_CLAIMED")]
fn submitted_evidence_cannot_be_replaced() {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    registry.claim_cycle(key.clone());
    contributor_at("alice.testnet", 101);
    registry.submit_evidence(
        key.clone(),
        "example".to_owned(),
        "docs".to_owned(),
        U64(1),
        "a".repeat(40),
    );
    registry.submit_evidence(
        key,
        "example".to_owned(),
        "docs".to_owned(),
        U64(2),
        "b".repeat(40),
    );
}

fn submitted_cycle() -> (Registry, CycleKey) {
    let (mut registry, key) = open_cycle();
    contributor_at("alice.testnet", 100);
    registry.claim_cycle(key.clone());
    contributor_at("alice.testnet", 101);
    registry.submit_evidence(
        key.clone(),
        "example".to_owned(),
        "docs".to_owned(),
        U64(1),
        "a".repeat(40),
    );
    (registry, key)
}

#[test]
fn manager_links_submitted_cycle_once() {
    let (mut registry, key) = submitted_cycle();
    operator_at(102, 0);
    let linked = registry.link_proposal(key.clone(), U64(63));
    let proposal_key = ProposalKey {
        network: Network::Testnet,
        dao_account_id: account("community.sputnikv2.testnet"),
        proposal_id: U64(63),
    };
    assert_eq!(linked.proposal_link.as_ref().unwrap().key, proposal_key);
    assert_eq!(linked.proposal_link.as_ref().unwrap().linked_at_ns.0, 102);
    assert_eq!(registry.get_proposal_cycle(proposal_key), Some(key));
    assert_eq!(
        linked.claim.as_ref().unwrap().payout_recipient_id,
        account("alice.testnet")
    );
    assert_eq!(linked.amount_yocto, input().amount_yocto);
}

#[test]
#[should_panic(expected = "ERR_NOT_MANAGER")]
fn contributor_cannot_link_proposal() {
    let (mut registry, key) = submitted_cycle();
    contributor_at("alice.testnet", 102);
    registry.link_proposal(key, U64(63));
}

#[test]
#[should_panic(expected = "ERR_CYCLE_NOT_SUBMITTED")]
fn unsubmitted_cycle_cannot_link() {
    let (mut registry, key) = open_cycle();
    operator_at(102, 0);
    registry.link_proposal(key, U64(63));
}

#[test]
#[should_panic(expected = "ERR_PROPOSAL_ALREADY_LINKED")]
fn cycle_link_cannot_be_replaced() {
    let (mut registry, key) = submitted_cycle();
    operator_at(102, 0);
    registry.link_proposal(key.clone(), U64(63));
    registry.link_proposal(key, U64(64));
}

#[test]
#[should_panic(expected = "ERR_PROPOSAL_REPLAY")]
fn same_proposal_cannot_link_another_cycle() {
    let (mut registry, first_key) = submitted_cycle();
    operator_at(102, 0);
    registry.link_proposal(first_key, U64(63));

    operator_at(1100, storage_reserve_cost(CYCLE_RESERVE_BYTES));
    let second_key = registry.materialize_cycle(U64(0)).key;
    contributor_at("bob.testnet", 1100);
    registry.claim_cycle(second_key.clone());
    contributor_at("bob.testnet", 1101);
    registry.submit_evidence(
        second_key.clone(),
        "example".to_owned(),
        "docs".to_owned(),
        U64(2),
        "b".repeat(40),
    );
    operator_at(1102, 0);
    registry.link_proposal(second_key, U64(63));
}

#[test]
#[should_panic(expected = "ERR_UNEXPECTED_DEPOSIT")]
fn proposal_link_rejects_attached_deposit() {
    let (mut registry, key) = submitted_cycle();
    operator_at(102, 1);
    registry.link_proposal(key, U64(63));
}

#[test]
#[should_panic(expected = "ERR_INDIRECT_CALLER")]
fn indirect_manager_cannot_link_proposal() {
    let (mut registry, key) = submitted_cycle();
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(account("registry.testnet"))
            .signer_account_id(account("manager.testnet"))
            .predecessor_account_id(account("relay.testnet"))
            .attached_deposit(NearToken::from_yoctonear(0))
            .account_balance(NearToken::from_near(10))
            .block_timestamp(102)
            .build()
    );
    registry.link_proposal(key, U64(63));
}

#[test]
fn proposal_network_and_dao_are_snapshotted_by_contract() {
    let (mut registry, key) = submitted_cycle();
    operator_at(102, 0);
    let linked = registry.link_proposal(key, U64(u64::MAX));
    let proposal = &linked.proposal_link.unwrap().key;
    assert_eq!(proposal.network, Network::Testnet);
    assert_eq!(proposal.dao_account_id, linked.dao_account_id);
    assert_eq!(proposal.proposal_id.0, u64::MAX);
}

#[test]
fn missing_proposal_view_is_none() {
    let registry = init();
    assert!(
        registry
            .get_proposal_cycle(ProposalKey {
                network: Network::Testnet,
                dao_account_id: account("missing.sputnikv2.testnet"),
                proposal_id: U64(0),
            })
            .is_none()
    );
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
