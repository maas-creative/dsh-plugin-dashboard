// Harness-agnostic model definition shape shared by core and harness packages.

export interface ProviderModel {
  cost?: {
    input: number
    output: number
  }
  [key: string]: unknown
}
