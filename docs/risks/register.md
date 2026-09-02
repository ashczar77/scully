# Pragtig Risk Register

**Status:** Active; approved at Gate G0.4  
**Version:** 0.3  
**Date:** 2026-09-02

## 1. Assessment scale

Likelihood and impact use Low, Medium, or High. Overall severity considers both
dimensions and may be Low, Medium, High, or Critical.

An owner is responsible for monitoring and presenting evidence. Ownership does
not grant authority to accept a risk. Risk acceptance occurs at the named
review gate.

## 2. Active risks

| ID | Risk | Likelihood | Impact | Severity | Owner | Next review |
|---|---|---|---|---|---|---|
| RISK-0001 | Scope expands toward recreating all of Spring | High | High | Critical | Project owner | Every scope gate |
| RISK-0002 | Pragtig lacks a defensible advantage over existing JVM frameworks | Medium | High | High | Phase 1 author | G1.1 and G1.3 |
| RISK-0003 | The Pragtig name conflicts with an existing or similar software brand | Medium | High | High | Project owner | Before package registration or major promotion |
| RISK-0004 | Compile-time processing creates slow clean or incremental builds | Medium | High | High | Compiler owner | G3.2, G4.3, and Phase 10 |
| RISK-0005 | Java and Kotlin semantics or diagnostics diverge | Medium | High | High | Language frontend owners | Every language gate |
| RISK-0006 | Annotation convenience recreates hidden framework behavior | Medium | High | High | API owner | G2.1 through G2.4 |
| RISK-0007 | Extensions recreate classpath auto-configuration or opaque mutation | Medium | High | High | Extension owner | G3.6 and G9.4 |
| RISK-0008 | Generated code is difficult to read, debug, or keep stable | Medium | High | High | Compiler owner | G4.2, G5.4, and G8.3 |
| RISK-0009 | Diagnostics make sense to framework authors but not users | Medium | High | High | Developer experience owner | G2.3, G8.4, and G10.5 |
| RISK-0010 | Benchmark design unintentionally favors Pragtig | Medium | High | High | Benchmark owner | G10.1 through G10.4 |
| RISK-0011 | The small runtime requires an excessively complex compiler | Medium | Medium | Medium | Architecture owner | Phase 3 exit |
| RISK-0012 | Public dependencies increase security, license, or footprint costs | Medium | High | High | Dependency owner | Every dependency ADR |
| RISK-0013 | Compiler or extension input enables unsafe file or code behavior | Medium | High | High | Security owner | G3.2, G3.6, and G11.2 |
| RISK-0014 | The gated process creates disproportionate overhead | Medium | Medium | Medium | Project owner | G4.1 and each phase exit |
| RISK-0015 | Maintainer capacity is insufficient for framework and ecosystem support | High | High | Critical | Project owner | G1.3, G11.6, and G12.3 |
| RISK-0016 | License or contribution policy discourages commercial adoption | Low | High | Medium | Project owner | G0.4 and G11.3 |
| RISK-0017 | JVM, compiler, KSP, or build-tool APIs force architectural rework | Medium | High | High | Compiler owner | G4.3 and G4.4 |
| RISK-0018 | Explainability metadata increases artifacts, build time, or runtime memory | Medium | Medium | Medium | Architecture owner | G3.1 and Phase 10 |
| RISK-0019 | Secret values leak through manifests, diagnostics, tests, or benchmarks | Medium | High | High | Security owner | G6.4 and G11.2 |
| RISK-0020 | Public claims about intuitiveness cannot be measured credibly | Medium | Medium | Medium | Developer experience owner | G1.4, G8.4, and G10.5 |

## 3. Initial mitigations

### RISK-0001: Scope expansion

- Enforce the approved v0.1 non-goals.
- Require an impact assessment and project-owner approval for scope changes.
- Tie every capability to an approved reference scenario.

### RISK-0002: Weak differentiation

- Complete current market research before product design.
- Treat explainability, ordinary language semantics, and measurable usability
  as product requirements rather than slogans.
- Stop or reposition if Phase 1 does not establish a meaningful opening.

### RISK-0003: Name conflict

- Keep Pragtig as the provisional public project name for limited repository
  use.
- Do not publish release artifacts, register coordinates, commission a final
  logo, or build substantial brand equity before clearance.
- Include the adjacent Pracht framework in the similarity assessment.
- Follow the naming research and legal-review plan.

### RISK-0004: Build performance

- Design incremental processing before full implementation.
- Measure clean and incremental builds from the first compiler spike.
- Set regression budgets before public preview.

### RISK-0005: Language divergence

- Use a shared normalized application model and validation engine.
- Review Java and Kotlin APIs together.
- Maintain cross-language contract tests and mixed-project examples.

### RISK-0006 and RISK-0007: Hidden behavior

- Require explicit feature activation and explicit ambiguous choices.
- Preserve provenance for every component and extension contribution.
- Reject opaque global-container mutation.

### RISK-0008 and RISK-0009: Poor explainability

- Design diagnostics and inspection before implementation.
- Treat generated readability as a reviewed product surface.
- Validate with representative developer tasks.

### RISK-0010: Benchmark credibility

- Approve methodology before collecting comparative results.
- Use equivalent behavioral contracts and retain raw data.
- Seek independent review before public performance claims.

### RISK-0012, RISK-0013, and RISK-0019: Security and dependencies

- Threat-model compiler and extension boundaries.
- Review every production dependency.
- Add vulnerability, license, secret, and generated-artifact checks.
- Never rely on .gitignore as a security control.

### RISK-0014 and RISK-0015: Project sustainability

- Keep review depth proportional to risk.
- Automate repeatable evidence.
- Delay ecosystem expansion until maintainership is credible.

## 4. Risk review rules

- Update this register at every phase exit.
- Add a risk when material uncertainty is identified.
- Link detailed risk records when a table entry needs more evidence.
- A Critical risk must have a current mitigation and project-owner decision.
- A realized risk becomes an issue or incident while remaining linked here.
- Closing a risk requires evidence and a recorded review decision.

## 5. Gate G0.4 decisions

- Accept the current risks as sufficient to begin Phase 1 research.
- Keep RISK-0003 open and Pragtig provisional.
- Keep RISK-0016 open until the contribution model is approved.

## 6. Revision history

| Version | Date | Summary | Gate |
|---|---|---|---|
| 0.1 | 2026-09-02 | Initial risk register | Pending G0.4 |
| 0.2 | 2026-09-02 | Updated naming risk for the selected Pragtig working name | Pending G0.4 |
| 0.3 | 2026-09-02 | Accepted Phase 1 risks and limited public use of the provisional name | Approved G0.4 |
