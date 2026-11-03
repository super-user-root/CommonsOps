mod domain;

pub use domain::*;
use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U64;
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

    #[payable]
    pub fn create_template(&mut self, input: TemplateInput) -> Template {
        self.assert_manager();
        input.validate();
        assert!(
            self.next_template_id < MAX_TEMPLATES,
            "ERR_TEMPLATE_CAPACITY"
        );
        self.assert_storage_funding(TEMPLATE_RESERVE_BYTES);
        let id = self.next_template_id;
        let next_id = id.checked_add(1).expect("ERR_ID_OVERFLOW");
        let template = Template {
            id: U64(id),
            manager_id: self.manager_id.clone(),
            input,
            active: true,
            next_period_index: U64(0),
            created_at_ns: U64(env::block_timestamp()),
        };
        self.templates.insert(id, template.clone());
        self.templates.flush();
        self.next_template_id = next_id;
        self.assert_storage_backed();
        emit_event("template_created", &template);
        template
    }

    pub fn set_template_active(&mut self, template_id: U64, active: bool) -> Template {
        self.assert_manager();
        assert_zero_deposit();
        let template = self
            .templates
            .get_mut(&template_id.0)
            .expect("ERR_TEMPLATE_NOT_FOUND");
        template.active = active;
        let updated = template.clone();
        self.templates.flush();
        emit_event("template_active_changed", &updated);
        updated
    }

    #[payable]
    pub fn materialize_cycle(&mut self, template_id: U64) -> Cycle {
        self.assert_manager();
        let template = self
            .templates
            .get(&template_id.0)
            .expect("ERR_TEMPLATE_NOT_FOUND")
            .clone();
        assert!(template.active, "ERR_TEMPLATE_PAUSED");
        assert!(self.cycle_count < MAX_CYCLES, "ERR_CYCLE_CAPACITY");
        let (opens_at_ns, deadline_at_ns) =
            template.input.period_bounds(template.next_period_index.0);
        let now_ns = env::block_timestamp();
        assert!(now_ns >= opens_at_ns, "ERR_PERIOD_NOT_DUE");
        assert!(now_ns < deadline_at_ns, "ERR_PERIOD_EXPIRED");
        let key = CycleKey {
            template_id,
            period_index: template.next_period_index,
        };
        assert!(!self.cycles.contains_key(&key), "ERR_DUPLICATE_CYCLE");
        self.assert_storage_funding(CYCLE_RESERVE_BYTES);
        let next_period = template
            .next_period_index
            .0
            .checked_add(1)
            .expect("ERR_PERIOD_OVERFLOW");
        let next_count = self.cycle_count.checked_add(1).expect("ERR_CYCLE_OVERFLOW");
        let cycle = Cycle {
            key: key.clone(),
            status: CycleStatus::Open,
            opens_at_ns: U64(opens_at_ns),
            deadline_at_ns: U64(deadline_at_ns),
            dao_account_id: template.input.dao_account_id,
            amount_yocto: template.input.amount_yocto,
            claim: None,
            evidence: None,
            submitted_at_ns: None,
            proposal_link: None,
        };
        cycle.validate();
        self.cycles.insert(key, cycle.clone());
        self.templates
            .get_mut(&template_id.0)
            .unwrap()
            .next_period_index = U64(next_period);
        self.cycles.flush();
        self.templates.flush();
        self.cycle_count = next_count;
        self.assert_storage_backed();
        emit_event("cycle_opened", &cycle);
        cycle
    }

    pub fn skip_expired_periods(&mut self, template_id: U64, count: U64) -> U64 {
        self.assert_manager();
        assert_zero_deposit();
        assert!(
            count.0 > 0 && count.0 <= MAX_SKIP_COUNT,
            "ERR_INVALID_SKIP_COUNT"
        );
        let template = self
            .templates
            .get(&template_id.0)
            .expect("ERR_TEMPLATE_NOT_FOUND");
        let first = template.next_period_index.0;
        let next = first.checked_add(count.0).expect("ERR_PERIOD_OVERFLOW");
        let last = next.checked_sub(1).expect("ERR_PERIOD_OVERFLOW");
        let (_, deadline_at_ns) = template.input.period_bounds(last);
        assert!(
            env::block_timestamp() >= deadline_at_ns,
            "ERR_SKIP_LIVE_PERIOD"
        );
        self.templates
            .get_mut(&template_id.0)
            .unwrap()
            .next_period_index = U64(next);
        self.templates.flush();
        emit_event(
            "periods_skipped",
            &near_sdk::serde_json::json!({"template_id": template_id, "first_period_index": U64(first), "count": count, "next_period_index": U64(next)}),
        );
        U64(next)
    }

    pub fn get_template(&self, template_id: U64) -> Option<Template> {
        self.templates.get(&template_id.0).cloned()
    }

    pub fn get_cycle(&self, cycle_key: CycleKey) -> Option<Cycle> {
        self.cycles.get(&cycle_key).cloned()
    }
}

fn emit_event(event: &str, data: &impl near_sdk::serde::Serialize) {
    let value = near_sdk::serde_json::json!({"standard": "commonsops", "version": "1.0.0", "event": event, "data": [data]});
    env::log_str(&format!("EVENT_JSON:{value}"));
}

impl Registry {
    pub fn assert_manager(&self) -> AccountId {
        let caller = assert_direct_caller();
        assert!(caller == self.manager_id, "ERR_NOT_MANAGER");
        caller
    }

    pub fn assert_storage_funding(&self, reserve_bytes: u64) {
        assert!(
            env::attached_deposit().as_yoctonear() >= storage_reserve_cost(reserve_bytes),
            "ERR_INSUFFICIENT_STORAGE_DEPOSIT"
        );
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
