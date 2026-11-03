export interface AdapterFoundationMetadata {
  readonly stage: "foundation";
  readonly networkConfigured: false;
  readonly walletConnected: false;
  readonly liveReadsEnabled: false;
  readonly transactionsEnabled: false;
}

export const adapterFoundationMetadata: AdapterFoundationMetadata =
  Object.freeze({
    stage: "foundation",
    networkConfigured: false,
    walletConnected: false,
    liveReadsEnabled: false,
    transactionsEnabled: false,
  });
