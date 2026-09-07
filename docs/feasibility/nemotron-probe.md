# Step 1.2 Nemotron Capability Probe

**Status:** In review at checkpoint G1.2e

**Attempt date:** 2026-09-07

## Objective

Verify that one real Nemotron request through the Scully scaffold returns a
schema-valid structured tool call within the reviewed request, token, timeout,
retry, and cost boundaries.

## Approved scope

The G1.2d approval authorized one Nemotron request only. The attempt used:

- model `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`;
- one synthetic proxy-identity incident;
- one forced function tool with four required fields;
- 8,192 maximum input tokens;
- 1,024 maximum output tokens;
- $0.01 maximum calculated model cost;
- 60-second timeout;
- zero automatic retries;
- no Tavily request and no Sandbox operation.

## Attempt result

The request reached Token Factory and returned after 4.069136 seconds. The
response failed the local provider contract, and execution stopped without a
retry.

The initial runner retained:

- one request and zero retries;
- start, end, and duration measurements;
- the exception class `ProviderContractError`;
- the names of eleven returned rate-limit headers;
- no prompt, generated argument value, credential, or provider error message.

The redacted record is
`validation/results/g1.2-nemotron-probe-001.json`.

## Instrumentation finding

The first attempt exposed an ordering defect in the probe runner. Usage was
read by the adapter only after structural tool-call validation. When that
validation failed, the outer failure record could report neither the safe
contract-failure category nor the response token usage. The recorded zero cost
from the initial process output therefore did not establish that the request
was free. The durable result correctly records token use and cost as unknown.

No second provider request was made.

## Corrective work

The runner now:

- captures response usage before local contract validation;
- maps known local contract failures to safe category codes;
- distinguishes request, response-processing, and contract-validation stages;
- calculates failure-path cost when usage is present;
- continues to omit provider messages and generated argument values;
- closes the client in every outcome.

Offline tests cover a successful tool call, a closed preflight, a request
exception, and a contract failure with early usage capture. The full suite now
passes 52 tests.

## Conclusion

The first attempt proves connectivity, authentication, a completed response,
rate-limit metadata availability, and zero-retry behavior. It does not prove a
schema-valid Nemotron tool call or a measured cost ceiling.

The next safe action is one second bounded Nemotron attempt through the
corrected runner. That request remains blocked until checkpoint G1.2e is
reviewed. Tavily and Sandbox execution remain blocked.
