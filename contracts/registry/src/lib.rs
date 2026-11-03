mod domain;

pub use domain::*;
use near_sdk::borsh::BorshSerialize;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Templates,
    Cycles,
    ProposalLinks,
}

/// Registry storage foundation; lifecycle and payment methods are not yet exposed.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    pub schema_version: u32,
    pub manager_id: AccountId,
    pub network: Network,
    pub next_template_id: u64,
    pub cycle_count: u64,
    templates: LookupMap<u64, Template>,
    cycles: LookupMap<CycleKey, Cycle>,
    proposal_links: LookupMap<ProposalKey, CycleKey>,
}

#[near]
impl Registry {
    #[init]
    #[payable]
    pub fn new(manager_id: AccountId, network: Network) -> Self {
        assert!(!env::state_exists(), "ERR_ALREADY_INITIALIZED");
        assert!(
            env::predecessor_account_id() == env::current_account_id(),
            "ERR_INIT_NOT_SELF"
        );
        assert!(
            env::signer_account_id() == env::current_account_id(),
            "ERR_INIT_NOT_SELF"
        );
        assert_zero_deposit();
        let registry = Self {
            schema_version: SCHEMA_VERSION,
            manager_id,
            network,
            next_template_id: 0,
            cycle_count: 0,
            templates: LookupMap::new(StorageKey::Templates),
            cycles: LookupMap::new(StorageKey::Cycles),
            proposal_links: LookupMap::new(StorageKey::ProposalLinks),
        };
        RegistryInitialized {
            manager_id: registry.manager_id.clone(),
            network: registry.network,
            schema_version: registry.schema_version,
        }
        .emit();
        registry
    }

    pub fn foundation_status(&self) -> String {
        "foundation: no business behavior".to_owned()
    }
}

impl Registry {
    pub fn assert_manager(&self) -> AccountId {
        let caller = assert_direct_caller();
        assert!(caller == self.manager_id, "ERR_NOT_MANAGER");
        caller
    }

    pub fn assert_storage_backed(&self) {
        assert!(
            env::account_balance().as_yoctonear() >= storage_reserve_cost(env::storage_usage()),
            "ERR_STORAGE_NOT_BACKED"
        );
    }
}

pub fn assert_direct_caller() -> AccountId {
    let caller = env::predecessor_account_id();
    assert!(caller == env::signer_account_id(), "ERR_INDIRECT_CALLER");
    caller
}

pub fn assert_zero_deposit() {
    assert!(
        env::attached_deposit().as_yoctonear() == 0,
        "ERR_UNEXPECTED_DEPOSIT"
    );
}

#[cfg(test)]
mod tests;
