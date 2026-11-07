# Refunds

The claims of a specification, each with what its label asks: a fixture for
`spec-guard claims` (ADR-0020), with one of each finding.

1. Limits.
   - `Implemented`: a refund over the captured amount is refused.
     <!-- @assert-count target="payments" symbol="fn test_refund_limit" min="1" -->
   - `Implemented`, as a token check only: raises `E0420 [Refund Error]`.
     <!-- @assert-count target="payments" symbol="E0420 [Refund Error]" min="1" -->
   - `Specified`; the partial refund is `Implemented`.
   - `Hypothesis`: retries cut failed captures.
   - `Hypothesis`: batching halves the fees. Criterion: the fee per capture.
