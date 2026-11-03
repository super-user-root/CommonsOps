use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U64, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{AccountId, env};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_TEMPLATES: u64 = 100;
pub const MAX_CYCLES: u64 = 2_000;
pub const MAX_TITLE_BYTES: usize = 120;
pub const MAX_DESCRIPTION_BYTES: usize = 1_024;
pub const MAX_GITHUB_NAME_BYTES: usize = 100;
pub const MAX_EVIDENCE_URL_BYTES: usize = 320;
pub const MAX_PAGE_SIZE: u64 = 50;
pub const MAX_SKIP_COUNT: u64 = 100;
pub const TEMPLATE_RESERVE_BYTES: u64 = 4_096;
pub const CYCLE_RESERVE_BYTES: u64 = 16_384;

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Deserialize,
    Serialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Network {
    Testnet,
    Mainnet,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Deserialize,
    Serialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CycleStatus {
    Open,
    Claimed,
    Submitted,
    Expired,
    Cancelled,
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct CycleKey {
    pub template_id: U64,
    pub period_index: U64,
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ProposalKey {
    pub network: Network,
    pub dao_account_id: AccountId,
    pub proposal_id: U64,
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct TemplateInput {
    pub dao_account_id: AccountId,
    pub title: String,
    pub description: String,
    pub start_at_ns: U64,
    pub interval_ns: U64,
    pub work_window_ns: U64,
    pub claim_duration_ns: U64,
    pub amount_yocto: U128,
}

impl Ord for CycleKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (self.template_id.0, self.period_index.0).cmp(&(other.template_id.0, other.period_index.0))
    }
}

impl PartialOrd for CycleKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ProposalKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (self.network, &self.dao_account_id, self.proposal_id.0).cmp(&(
            other.network,
            &other.dao_account_id,
            other.proposal_id.0,
        ))
    }
}

impl PartialOrd for ProposalKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl TemplateInput {
    pub fn validate(&self) {
        assert!(!self.title.trim().is_empty(), "ERR_EMPTY_TITLE");
        assert!(self.title.len() <= MAX_TITLE_BYTES, "ERR_TITLE_TOO_LONG");
        assert!(
            self.description.len() <= MAX_DESCRIPTION_BYTES,
            "ERR_DESCRIPTION_TOO_LONG"
        );
        assert!(self.interval_ns.0 > 0, "ERR_ZERO_INTERVAL");
        assert!(self.work_window_ns.0 > 0, "ERR_ZERO_WORK_WINDOW");
        assert!(
            self.work_window_ns.0 <= self.interval_ns.0,
            "ERR_OVERLAPPING_PERIODS"
        );
        assert!(self.claim_duration_ns.0 > 0, "ERR_ZERO_CLAIM_DURATION");
        assert!(self.amount_yocto.0 > 0, "ERR_ZERO_PAYOUT");
        assert!(
            self.start_at_ns
                .0
                .checked_add(self.work_window_ns.0)
                .is_some(),
            "ERR_TIME_OVERFLOW"
        );
    }

    pub fn period_bounds(&self, period_index: u64) -> (u64, u64) {
        self.validate();
        let offset = self
            .interval_ns
            .0
            .checked_mul(period_index)
            .expect("ERR_TIME_OVERFLOW");
        let opens_at_ns = self
            .start_at_ns
            .0
            .checked_add(offset)
            .expect("ERR_TIME_OVERFLOW");
        let deadline_at_ns = opens_at_ns
            .checked_add(self.work_window_ns.0)
            .expect("ERR_TIME_OVERFLOW");
        (opens_at_ns, deadline_at_ns)
    }
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Template {
    pub id: U64,
    pub manager_id: AccountId,
    pub input: TemplateInput,
    pub active: bool,
    pub next_period_index: U64,
    pub created_at_ns: U64,
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Claim {
    pub claimant_id: AccountId,
    pub payout_recipient_id: AccountId,
    pub expires_at_ns: U64,
}

impl Claim {
    pub fn validate(&self) {
        assert!(
            self.claimant_id == self.payout_recipient_id,
            "ERR_RECIPIENT_MISMATCH"
        );
    }

    pub fn is_active(&self, now_ns: u64, deadline_at_ns: u64) -> bool {
        self.validate();
        now_ns < self.expires_at_ns.0 && now_ns < deadline_at_ns
    }
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Evidence {
    pub repository_owner: String,
    pub repository_name: String,
    pub pull_request_number: U64,
    pub url: String,
    pub commit_sha: String,
    pub digest_sha256: String,
}

impl Evidence {
    pub fn normalize(
        owner: &str,
        repository: &str,
        pull_request_number: u64,
        commit_sha: &str,
    ) -> Self {
        validate_github_name(owner, false);
        validate_github_name(repository, true);
        assert!(pull_request_number > 0, "ERR_INVALID_PR_NUMBER");
        assert!(
            commit_sha.len() == 40 && commit_sha.bytes().all(|value| value.is_ascii_hexdigit()),
            "ERR_INVALID_COMMIT_SHA"
        );
        let repository_owner = owner.to_ascii_lowercase();
        let repository_name = repository.to_ascii_lowercase();
        let commit_sha = commit_sha.to_ascii_lowercase();
        let url = format!(
            "https://github.com/{repository_owner}/{repository_name}/pull/{pull_request_number}"
        );
        assert!(
            url.len() <= MAX_EVIDENCE_URL_BYTES,
            "ERR_EVIDENCE_URL_TOO_LONG"
        );
        // Versioned, fixed-order JSON array; both Rust and TypeScript use these canonical bytes.
        let canonical = near_sdk::serde_json::to_vec(&(
            SCHEMA_VERSION,
            &repository_owner,
            &repository_name,
            pull_request_number.to_string(),
            &commit_sha,
        ))
        .expect("ERR_EVIDENCE_SERIALIZATION");
        let digest_sha256 = env::sha256(&canonical)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        Self {
            repository_owner,
            repository_name,
            pull_request_number: U64(pull_request_number),
            url,
            commit_sha,
            digest_sha256,
        }
    }
}

fn validate_github_name(name: &str, allow_period: bool) {
    assert!(
        !name.is_empty() && name.len() <= MAX_GITHUB_NAME_BYTES,
        "ERR_INVALID_GITHUB_NAME"
    );
    assert!(name != "." && name != "..", "ERR_INVALID_GITHUB_NAME");
    assert!(
        name.bytes().all(|value| value.is_ascii_alphanumeric()
            || value == b'-'
            || value == b'_'
            || (allow_period && value == b'.')),
        "ERR_INVALID_GITHUB_NAME"
    );
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ProposalLink {
    pub key: ProposalKey,
    pub linked_at_ns: U64,
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Cycle {
    pub key: CycleKey,
    pub status: CycleStatus,
    pub opens_at_ns: U64,
    pub deadline_at_ns: U64,
    pub dao_account_id: AccountId,
    pub amount_yocto: U128,
    pub claim: Option<Claim>,
    pub evidence: Option<Evidence>,
    pub submitted_at_ns: Option<U64>,
    pub proposal_link: Option<ProposalLink>,
}

impl Cycle {
    pub fn validate(&self) {
        assert!(
            self.opens_at_ns.0 < self.deadline_at_ns.0,
            "ERR_INVALID_CYCLE_WINDOW"
        );
        assert!(self.amount_yocto.0 > 0, "ERR_ZERO_PAYOUT");
        if let Some(claim) = &self.claim {
            claim.validate();
            assert!(
                claim.expires_at_ns.0 <= self.deadline_at_ns.0,
                "ERR_CLAIM_AFTER_DEADLINE"
            );
        }
        match self.status {
            CycleStatus::Open | CycleStatus::Expired | CycleStatus::Cancelled => {
                assert!(
                    self.claim.is_none()
                        && self.evidence.is_none()
                        && self.submitted_at_ns.is_none()
                        && self.proposal_link.is_none(),
                    "ERR_INVALID_EMPTY_CYCLE_STATE"
                );
            }
            CycleStatus::Claimed => {
                assert!(
                    self.claim.is_some()
                        && self.evidence.is_none()
                        && self.submitted_at_ns.is_none()
                        && self.proposal_link.is_none(),
                    "ERR_INVALID_CLAIMED_STATE"
                );
            }
            CycleStatus::Submitted => {
                assert!(
                    self.claim.is_some()
                        && self.evidence.is_some()
                        && self.submitted_at_ns.is_some(),
                    "ERR_INVALID_SUBMITTED_STATE"
                );
                let submitted_at_ns = self.submitted_at_ns.unwrap().0;
                assert!(
                    submitted_at_ns >= self.opens_at_ns.0
                        && self
                            .claim
                            .as_ref()
                            .unwrap()
                            .is_active(submitted_at_ns, self.deadline_at_ns.0),
                    "ERR_LATE_SUBMISSION"
                );
            }
        }
        if let Some(link) = &self.proposal_link {
            assert!(
                link.key.dao_account_id == self.dao_account_id,
                "ERR_DAO_MISMATCH"
            );
            assert!(
                link.linked_at_ns.0 >= self.submitted_at_ns.expect("ERR_LINK_WITHOUT_SUBMISSION").0,
                "ERR_LINK_BEFORE_SUBMISSION"
            );
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Deserialize, Serialize, Debug, Clone, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct RegistryInitialized {
    pub manager_id: AccountId,
    pub network: Network,
    pub schema_version: u32,
}

impl RegistryInitialized {
    pub fn emit(&self) {
        let event = near_sdk::serde_json::json!({
            "standard": "commonsops",
            "version": "1.0.0",
            "event": "registry_initialized",
            "data": [self],
        });
        env::log_str(&format!("EVENT_JSON:{event}"));
    }
}

pub fn checked_claim_expiry(now_ns: u64, duration_ns: u64, deadline_at_ns: u64) -> u64 {
    assert!(
        duration_ns > 0 && now_ns < deadline_at_ns,
        "ERR_INVALID_CLAIM_WINDOW"
    );
    now_ns
        .checked_add(duration_ns)
        .expect("ERR_TIME_OVERFLOW")
        .min(deadline_at_ns)
}

pub fn storage_reserve_cost(bytes: u64) -> u128 {
    env::storage_byte_cost()
        .as_yoctonear()
        .checked_mul(u128::from(bytes))
        .expect("ERR_STORAGE_COST_OVERFLOW")
}
