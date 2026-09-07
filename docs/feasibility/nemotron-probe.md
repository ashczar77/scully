# Step 1.2 Nemotron Capability Probe

**Status:** Final corrective result in review at checkpoint G1.2h

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
exception, and a contract failure with early usage capture.

## Conclusion

The first attempt proves connectivity, authentication, a completed response,
rate-limit metadata availability, and zero-retry behavior. It does not prove a
schema-valid Nemotron tool call or a measured cost ceiling.

Checkpoint G1.2e approved one second bounded Nemotron attempt through the
corrected runner. Attempt 002 also disables parallel tool calls explicitly.
Tavily and Sandbox execution remain blocked.

## Attempt 002 result

The second request reached Token Factory and returned after 4.016622 seconds.
The corrected instrumentation identified the local failure as
`tool_call_count`. The response did not contain one usable tool call.

Measured usage was:

- 474 input tokens;
- 1,024 output tokens, equal to the configured maximum;
- $0.0002742 calculated cost;
- one request;
- zero retries.

The setup is therefore not the cause. Authentication, endpoint selection,
model selection, request acceptance, response parsing, and usage reporting all
worked.

## Root-cause assessment

[NVIDIA's model reference](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b)
states that thinking is enabled by default and that the model produces a
reasoning trace before its final response. NVIDIA recommends `temperature=0.6`
and `top_p=0.95` for tool calling. The
[NVIDIA model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4)
also recommends a high `max_tokens` value, with 10,000 as its example.

Attempt 002 consumed the entire 1,024-token output allowance without producing
the required tool call. The evidence supports output-budget exhaustion during
reasoning as the cause.

## Implemented correction

The request prepared for attempt 003:

- increase the output limit from 1,024 to 10,000 tokens;
- set `temperature` to 0.6;
- set `top_p` to 0.95;
- retain one choice, one forced tool, disabled parallel tool calls, disabled
  retries, a 60-second timeout, and strict local validation;
- retain the $0.01 hard cost ceiling.

At the current published prices and the existing 8,192-token input cap, the
worst-case calculated cost is $0.00289152. The execution preflight now requires
the exact 10,000-token output limit. The ordinary 1,024-token configuration
therefore cannot open the Nemotron live gate.

Offline tests verify the model-specific sampling values, exact output limit,
disabled parallel calls, early structural capture, and closed ordinary
configuration. No third request was made while preparing checkpoint G1.2g.

## Attempt 003 result

Checkpoint G1.2g approved exactly one final corrective request. Attempt 003
reached Token Factory and returned a schema-valid call to
`record_incident_hypothesis` after 3.830568 seconds.

The redacted result records:

- one request and zero retries;
- 474 input tokens and 935 output tokens;
- $0.00025284 calculated model cost;
- all four required argument field names;
- no generated argument values, prompt content, credential, or provider error
  message;
- no Tavily credit and no Sandbox operation.

The request used less than one tenth of its 10,000-token output allowance and
less than three percent of its $0.01 hard cost ceiling. The durable record is
`validation/results/g1.2-nemotron-probe-003.json`.

## Capability conclusion

Nemotron has now demonstrated the required structured tool-call behavior over
the project adapter. The two earlier failures establish why model-specific
reasoning allowance matters. The final corrective attempt establishes that the
reviewed configuration resolves that limitation within the safety and cost
boundaries.
