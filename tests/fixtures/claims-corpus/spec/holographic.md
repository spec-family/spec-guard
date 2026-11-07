# Holographic modules

The claims of a specification, each with what its label asks: a fixture for
`spec-guard claims` (ADR-0020), with one of each finding.

1. Hashes.
   - `Implemented`: a private field's change changes the spec hash.
     <!-- @assert-count target="compiler" symbol="fn test_spec_hash" min="1" -->
   - `Implemented`, as a token check only: raises `E0501 [Totality Error]`.
     <!-- @assert-count target="compiler" symbol="E0501 [Totality Error]" min="1" -->
   - `Specified`; the conversion is `Implemented`.
   - `Hypothesis`: agents write fewer guards.
   - `Hypothesis`: agents repair less. Criterion: the repair count.
