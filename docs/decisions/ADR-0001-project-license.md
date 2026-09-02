# ADR-0001: Project license

**Status:** Proposed  
**Date:** 2026-09-02  
**Owner:** Project owner  
**Related gate:** G0.4  
**Supersedes:** None  
**Superseded by:** None

## Context

Pragtig is intended to become a serious framework adopted by Java and Kotlin
developers, including commercial users and extension authors. The license
should permit broad use while providing clear contributor and patent terms.

This proposal is project planning, not legal advice. The project owner should
obtain legal advice if the ownership structure, employment obligations,
contributors, or commercialization model requires it.

## Decision drivers

- Low friction for individual and commercial adoption.
- Familiarity in the Java framework ecosystem.
- Permission to use, modify, redistribute, and create commercial derivatives.
- Explicit patent terms.
- Compatibility with likely framework dependencies and extensions.
- Clear machine-readable SPDX identification.
- A contribution model that can scale beyond one maintainer.

## Options considered

### Apache License 2.0

Benefits:

- OSI-approved permissive license.
- Explicit copyright and patent grants.
- Patent-termination provision.
- Familiar to enterprise Java users.
- Used by Spring Framework and Quarkus.
- Supports commercial and open-source use.

Costs:

- Longer and more operationally detailed than MIT.
- Redistribution and NOTICE obligations require care.
- Patent language may require legal review for some contributors.

### MIT License

Benefits:

- Short and widely understood.
- Very permissive.
- Low administrative overhead.

Costs:

- Does not provide the same explicit patent grant as Apache License 2.0.
- Provides less detailed contribution and redistribution language.

### Mozilla Public License 2.0

Benefits:

- OSI-approved.
- File-level copyleft can preserve changes to covered files.
- Can support commercial use alongside proprietary code.

Costs:

- More compliance obligations for adopters.
- Less aligned with the permissive licensing commonly expected for JVM
  frameworks.
- May reduce adoption or extension participation.

### Eclipse Public License 2.0

Benefits:

- Familiar within parts of the Java ecosystem.
- Includes patent terms and a weak-copyleft model.

Costs:

- More compliance complexity than a permissive license.
- Less aligned with the intended low-friction adoption position.

## Proposed decision

Adopt **Apache License 2.0**, SPDX identifier **Apache-2.0**, subject to project
owner approval and any necessary legal review.

Do not create the final LICENSE, NOTICE, source headers, or contributor process
until this ADR is approved.

## Rationale

Apache License 2.0 best balances commercial adoption, open collaboration,
enterprise familiarity, and explicit patent protection. Spring Framework and
Quarkus both use Apache License 2.0, which reduces licensing surprise for the
initial audience.

The Apache Software Foundation describes Apache License 2.0 as containing
copyright and patent licensing terms. The official license text includes an
explicit patent grant. The Open Source Initiative lists Apache-2.0 as an
approved license in its Popular / Strong Community category.

## Consequences

### Positive

- Broad commercial and open-source use is permitted.
- Contributor patent terms are explicit.
- The license is familiar to the target ecosystem.
- Standard SPDX and compliance tooling can identify it.

### Negative

- Distribution packaging must correctly preserve license and applicable notice
  information.
- Contributor and ownership questions still need a policy.
- License compatibility must be checked for every production dependency.

### Operational

After approval:

- add the unmodified official Apache License 2.0 text as LICENSE;
- determine whether a NOTICE file is required and maintain it correctly;
- add SPDX metadata to published artifacts;
- decide between a Developer Certificate of Origin, contributor agreement, or
  another contribution attestation before accepting external contributions;
- document third-party licenses in distributions;
- add automated license checks during Phase 4.1.

## Compatibility impact

The proposed license permits proprietary applications and extensions to use
Pragtig without requiring their code to use the same license. Individual
dependency compatibility still requires review.

## Security and privacy impact

None directly. The contribution policy must still define trusted release and
security processes.

## Performance impact

None.

## Validation

- Confirm project ownership and any employer obligations.
- Verify the final official license text before adding it.
- Review artifact and NOTICE requirements before distribution.
- Reassess if a commercial open-core model is proposed.

## Reconsideration triggers

- A governing foundation requires another license.
- Legal advice identifies ownership or patent concerns.
- The project adopts an open-core model with different licensing needs.
- A critical dependency has incompatible terms.

## References

- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- Apache guidance: https://www.apache.org/legal/apply-license
- OSI approved licenses: https://opensource.org/licenses
- MIT License: https://opensource.org/license/mit
- Spring Framework repository: https://github.com/spring-projects/spring-framework
- Quarkus repository: https://github.com/quarkusio/quarkus

## Approval

- Decision: Pending
- Reviewer: Project owner
- Date:
- Conditions:
