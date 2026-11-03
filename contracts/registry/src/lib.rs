use near_sdk::{PanicOnDefault, near};

/// Foundation only: no records, claims, payouts, or external calls.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {}

#[near]
impl Registry {
    #[init]
    pub fn new() -> Self {
        Self {}
    }

    pub fn foundation_status(&self) -> String {
        "foundation: no business behavior".to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{env, test_utils::VMContextBuilder, testing_env};

    #[test]
    fn initialized_scaffold_reports_foundation_after_serialization() {
        testing_env!(VMContextBuilder::new().build());
        let registry = Registry::new();
        let bytes = near_sdk::borsh::to_vec(&registry).unwrap();
        let restored: Registry = near_sdk::borsh::from_slice(&bytes).unwrap();
        env::state_write(&restored);
        assert!(env::state_exists());
        let restored: Registry = env::state_read().unwrap();
        assert_eq!(
            restored.foundation_status(),
            "foundation: no business behavior"
        );
    }

    #[test]
    #[should_panic(expected = "The contract is not initialized")]
    fn default_does_not_implicitly_initialize_contract() {
        let _ = Registry::default();
    }
}
