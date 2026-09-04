# Problem-First Opportunity Search

## Nebius x NVIDIA Global AI Hackathon

**Audience:** A small independent team seeking a distinctive, high-impact, zero-out-of-pocket-cost submission

**Date:** 4 September 2026

**Decision:** Which problem territories deserve validation before any new product is designed?

## Executive answer

Going back to the problem is the correct move. The earlier general-purpose "future simulator" was a platform without a sufficiently exclusive problem, and direct competitors already implement much of its language and architecture.

This search found a stronger organizing insight: the sponsor stack is unusually well suited to problems where **public or user-supplied evidence is fragmented, an artifact can be executed, and a claim must be proven rather than merely explained**. Nemotron can reason across the evidence and choose tools; Tavily can retrieve and refresh external evidence; Token Factory Sandboxes can execute competing hypotheses in isolated, branchable filesystem states.

That is narrower than "AI for decisions" and more defensible than another copilot. It suggests three problem territories worth validating next:

1. **Production failures cannot be safely reproduced away from production.** Engineers either give an AI sensitive telemetry and live access, or receive plausible diagnoses that were never reproduced.
2. **Important software and digital artifacts stop being executable.** Source code or files may remain, while the operating system, dependencies, build knowledge, and original behavior disappear.
3. **Digital accessibility tests do not prove that a person can complete a real task.** Automated rules find defects, but standards bodies still require knowledgeable human evaluation and public-sector conformance remains weak.

These are not product decisions yet. They are the best research candidates. The recommended next step is a short validation sprint that tries to disprove each one before committing.

## Scope and assumptions

The search covers globally relevant problems visible in 2024-2026 evidence, with particular attention to problems that:

- can be demonstrated with public, synthetic, or user-sanitized data;
- do not require unrestricted AI access to production systems;
- can produce a working public demo by 30 October 2026;
- can be built using the hackathon's supplied credits and local development;
- require reasoning, retrieval, and execution rather than a single chatbot response;
- have a credible user and a costly failure mode;
- are not already fully occupied by a dominant or fast-moving product category.

Excluded from the shortlist were hardware-dependent physical-AI concepts, projects requiring proprietary training datasets, autonomous legal or medical decisions, and products whose value depends on continuous production integrations.

## What the competition actually rewards

The hackathon requires a working project using Nebius Token Factory or Nebius AI Cloud and at least one NVIDIA open-source model. The four equally weighted judging dimensions are technological implementation, coherent product design, credible impact, and non-obvious idea quality. A public repository, working demo, and video of no more than three minutes are required. The deadline is 30 October 2026. The official resource page offers two paths to a combined $50 in Token Factory credits: $25 through the event form and another $25 through the free Builders Program. [Devpost overview](https://nebiusglobalaihackathon.devpost.com/) [Devpost rules](https://nebiusglobalaihackathon.devpost.com/rules) [Devpost resources](https://nebiusglobalaihackathon.devpost.com/resources)

This has three implications:

1. A technically ambitious backend without a complete user experience will score poorly.
2. Superficial use of Nemotron will fail the baseline and quality tests.
3. The demo must make the problem and the proof visible within minutes; a dashboard full of AI prose is weak evidence.

## The sponsor stack's non-obvious advantage

### Nemotron is useful as an investigator, not an oracle

NVIDIA describes Nemotron 3 Ultra as a text reasoning model with a native 256K context window, tool calling, and agentic workflow support. Its value here is long-context investigation: reconciling logs, documentation, standards, source code, and failed experiment output. It should propose hypotheses and tools, while deterministic commands decide whether a hypothesis survives. [NVIDIA Nemotron 3 Ultra documentation](https://docs.nvidia.com/nim/large-language-models/2.0.6/day-0/get-started-nemotron-3-ultra.html)

### Branchable sandboxes change the shape of an agent

ConTree, which powers Token Factory Sandboxes, snapshots the complete filesystem after an execution and can fork multiple microVMs from the same checkpoint. Its stated uses include tree search, best-of-N sampling, speculative execution, SWE-bench, rollback, and comparing parallel fixes. It is optimized for batch execution, has no inbound network access, and is currently a gated beta. [ConTree product documentation](https://contree.dev/)

This is more than "a safe place to run code." It allows an agent to preserve one evidence state, pursue contradictory hypotheses independently, and retain the exact branch that produced a result.

### Tavily is strongest when freshness and provenance matter

Tavily exposes search with domain and date controls, plus extraction, crawling, and research endpoints. This is useful when the external evidence changes - regulations, security advisories, package documentation, product recalls, or historical build instructions - and when the system needs source provenance rather than model memory. [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search) [Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract) [Tavily Crawl](https://docs.tavily.com/documentation/api-reference/endpoint/crawl)

### Zero-cost caveat

The $50 Token Factory credit is documented, but public event materials do not say that Sandbox beta usage is included, nor do they establish a hard no-overage spending cap. Sandbox access and credit coverage must be confirmed before selecting a concept that cannot work without it. A local container fallback can support development, but the Coding and Agentic Engineering track explicitly calls for agents that run and test code in Token Factory Sandboxes.

## Evaluation method

Each problem is scored out of 100 using six judgment-based dimensions:

- Severity and urgency: 20
- Native fit with Nemotron, Tavily, and Sandboxes: 20
- Whether AI is essential: 15
- Demonstration impact: 15
- Feasibility under the time and cost constraints: 15
- Competitive whitespace: 15

Scores are comparative judgments, not market-size estimates. A high-severity problem can still rank poorly if it needs inaccessible data or is already crowded.

## Ranked problem landscape

| Rank | Problem territory | Score | Research disposition |
|---:|---|---:|---|
| 1 | Safe reproduction of production failures | 85 | Validate first |
| 2 | Resurrection of non-executable software and digital artifacts | 83 | Validate for originality |
| 3 | Real-task digital accessibility failures | 82 | Validate with affected users |
| 4 | Open-source dependency maintenance and upgrade risk | 77 | Keep as adjacent evidence |
| 5 | Public-procurement investigation capacity | 76 | Consider for Tavily-specific angle |
| 6 | Regulatory change becoming operational proof | 75 | Real need, crowded and legally sensitive |
| 7 | Verification of AI-generated software claims | 74 | Need is strong; direct entrants emerging rapidly |
| 8 | Computational research reproducibility | 72 | Important but costly and increasingly crowded |
| 9 | Adaptive AI-agent security evaluation | 70 | Urgent but saturated |
| 10 | Legacy-system modernization | 66 | Large market, poor small-team wedge |
| - | Disaster early action, food loss, occupational safety | - | Important, rejected on accessible-data and intervention fit |

## 1. Safe reproduction of production failures

### The problem

Modern incident tools can correlate telemetry and suggest a root cause, but the decisive gap is often reproduction. An explanation based on logs is not the same as an executable failure. Giving an autonomous agent broad production access creates a different and unacceptable risk. Without reproduction, engineers remain uncertain whether a proposed patch addresses the cause, a symptom, or an unrelated code path.

This problem is especially credible because it matches a pain observed directly by the intended builder: AI is useful on local code but becomes constrained when the evidence lives on remote production hosts.

### Evidence and market pressure

The market validates the demand. Sentry Seer uses errors, traces, logs, profiles, and repositories to identify root causes and propose patches. Resolve AI sends specialized agents to investigate production evidence in parallel. Rollbar Resolve performs root-cause analysis and changes code in a sandbox. These products demonstrate urgency, but they also make generic "AI incident diagnosis" a crowded proposition. [Sentry Seer](https://docs.sentry.io/product/ai-in-sentry/seer) [Resolve AI incidents agent](https://website-prod.resolve.ai/product/incidents) [Rollbar root-cause analysis](https://docs.rollbar.com/docs/root-cause-analysis)

### Remaining gap

The defensible problem is not incident summarization. It is this:

> A team needs to convert a sanitized, read-only incident evidence bundle into a minimal executable reproduction, without giving the agent production credentials.

This is an inference from the product landscape, not a proven empty market. Sentry and newer incident agents are moving toward reproduction. The proposed boundary would need to remain strict: no production write access; user-controlled evidence export; every hypothesis executed in an isolated branch; success defined by recreating an observed symptom; final output a failing regression test and reproducible environment.

### Why it fits the stack

- Tavily retrieves version-specific documentation, changelogs, advisories, and known failure modes.
- Nemotron constructs and revises causal hypotheses across logs, config, code, and command output.
- Branchable sandboxes test mutually exclusive environment, dependency, data, and timing hypotheses from the same clean checkpoint.
- The demo can show twelve plausible diagnoses collapse to the one branch that recreates the failure.

### Fatal risk

If reliable reproduction requires a full copy of proprietary production state, the wedge fails. The validation spike must prove that a small, sanitized bundle is enough for a meaningful class of incidents.

## 2. Resurrection of non-executable software and digital artifacts

### The problem

Keeping bytes is not the same as preserving use. The Library of Congress notes that files in obsolete formats may no longer render without legacy software, codecs, hardware, operating systems, and metadata. Scientific datasets can become unusable when specialized analysis software disappears even when source code survives. [Library of Congress: bit-level preservation and usability](https://www.loc.gov/programs/digital-collections-management/digital-formats/bit-level-preservation-and-long-term-usability/) [Library of Congress: sustainability factors](https://www.loc.gov/preservation/digital/formats/sustain/sustain.shtml)

This affects cultural archives, research laboratories, abandoned open-source projects, vendor escrow, long-lived industrial systems, and personal digital history. The work is investigative: determine the original environment, recover dependencies, resolve historical documentation, and prove that behavior is preserved.

### Existing responses

Preservica offers active digital preservation and format management. Emulation-as-a-Service has been explored by libraries for years. New entrants are moving closer to the proposed territory: Castler says AI agents rebuild vendor software in clean environments for escrow recoverability, while Revenant uses LLMs to reverse-engineer abandoned firmware and software. [Preservica](https://preservica.com/) [Library of Congress on Emulation-as-a-Service](https://blogs.loc.gov/thesignal/2014/08/emulation-as-a-service-eaas-at-yale-university-library/) [Castler](https://castler.com/) [Revenant](https://github.com/DatanoiseTV/revenant)

### Remaining gap

The most distinctive unresolved problem is the autonomous recovery of an **executable historical environment with an evidence trail**, rather than file conversion, modernization, or clean-room reimplementation. Branch exploration is natural because dependency archaeology involves competing versions, build tools, operating systems, and patches.

### Why it fits the stack

- Tavily searches archived documentation, releases, package histories, mirrors, and format specifications.
- Nemotron reasons over inconsistent historical instructions and build errors.
- Sandbox branches try dependency and environment combinations without contaminating the baseline.
- The visible "before/after" moment - dead artifact to working artifact - is unusually strong.

### Fatal risk

The commercial urgency is weaker than incident response, and licensing can prevent distribution of recovered environments. The concept must demonstrate a valuable open-source, scientific, or public-domain artifact and avoid proprietary binaries.

## 3. Real-task digital accessibility failures

### The problem

An estimated 1.3 billion people, 16% of the world's population, experience significant disability. Digital services increasingly mediate health care, education, permits, voting information, benefits, and employment. [WHO disability fact sheet](https://www.who.int/news-room/fact-sheets/detail/disability-and-health)

W3C explicitly states that no evaluation tool alone can determine whether a site meets accessibility standards; knowledgeable human evaluation remains necessary. The 2025 US federal Section 508 assessment found uneven manual and automated testing, about half of agencies lacking a mechanism to track conformance testing and results, and roughly 70% reporting no required remediation timelines. [W3C evaluation overview](https://www.w3.org/WAI/test-evaluate/) [FY2025 Section 508 assessment](https://www.section508.gov/manage/section-508-assessment/2025/reading/)

The core problem is not missing alt text in isolation. It is that a technically scanned service may still prevent a user from completing a consequential task: applying for assistance, booking care, paying a bill, or submitting a permit.

### Existing responses

Deque's axe platform combines automated and guided manual testing, user-flow analysis, AI assistance, and remediation guidance. New autonomous QA products also test complete journeys and accessibility. The market is therefore established and increasingly AI-enabled. [Deque axe platform](https://www.deque.com/axe/) [Deque user-flow analysis](https://www.deque.com/blog/introducing-the-new-axe-devtools-extensions-user-flow-analysis-feature/) [SUSA autonomous QA](https://www.susatest.com/)

### Remaining gap

A plausible gap remains between standards conformance and **goal completion under a specific access need**, particularly for small public bodies and nonprofits that cannot afford specialist continuous testing. A credible tool must not impersonate disabled people or claim to replace them. It can identify and reproduce probable barriers, generate an exact journey trace, and hand the result to a human tester.

### Why it fits the stack

- Tavily grounds requirements in current standards and jurisdiction-specific rules.
- Nemotron plans a real task and reasons over the accessibility tree, DOM, page text, and failures.
- Sandboxes fork browser journeys for keyboard-only, screen-reader-oriented, low-vision, and simplified-language constraints.
- A side-by-side replay makes the failure emotionally and technically legible to judges.

### Fatal risk

Without participation from people with relevant disabilities, the product risks making confident but invalid claims. Human validation is a product requirement, not optional research polish.

## 4. Open-source dependency maintenance and upgrade risk

CISA describes open-source software as foundational across every critical-infrastructure sector. The Linux Foundation's 2024 funding research found that only 6% of surveyed organizations prioritized comprehensive security audits, while CISA has highlighted the expensive and unpredictable burden created by under-maintained dependencies. [CISA OSS Security Roadmap](https://www.cisa.gov/sites/default/files/2024-02/CISA-Open-Source-Software-Security-Roadmap-508c.pdf) [Linux Foundation funding study](https://www.linuxfoundation.org/blog/understanding-the-state-of-open-source-funding-in-2024) [Cyber Safety Review Board Log4j report](https://www.cisa.gov/sites/default/files/2023-02/CSRB-Report-on-Log4-July-11-2022_508_0.pdf)

The problem is real and sandboxes are an excellent fit for testing upgrade branches. However, Dependabot-style updates, security scanners, coding agents, and modernization products make the broad space crowded. It is better treated as a source of incident or preservation test cases than as the initial market.

## 5. Public-procurement investigation capacity

Public procurement represents about 12.9% of GDP in OECD countries. In 2024, only 8% of 40 surveyed OECD member and partner countries reported using AI to identify, analyze, and monitor procurement integrity risks. Procurement records are often fragmented between structured portals, PDFs, company registries, ownership information, and news. [OECD Anti-Corruption and Integrity Outlook 2026](https://www.oecd.org/en/publications/anti-corruption-and-integrity-outlook-2026_16708b78-en/full-report/component-14.html)

The Open Contracting Partnership publishes 73 data-based red-flag indicators, and Datanomix already combines rule-based indicators with LLM extraction from unstructured procurement documents. This proves both feasibility and direct competition. [Open Contracting red-flags guide](https://www.open-contracting.org/resources/red-flags-in-public-procurement-a-guide-to-using-data-to-detect-and-mitigate-risks/) [Datanomix case study](https://www.open-contracting.org/2025/05/19/how-datanomix-pro-is-using-ai-to-fight-fraud-and-misconduct-in-kazakhstan/)

The unmet problem is investigative capacity, not automated accusations. A system could assemble and reproduce evidence for a human investigator, but inconsistent national data, entity resolution, and defamation risk weaken a hackathon-scale product. This territory is highly compatible with the Best Use of Tavily prize, but less naturally dependent on branchable execution.

## 6. Regulatory change becoming operational proof

More than 80% of business organizations surveyed across countries place regulatory requirements and compliance among their three most significant challenges. OECD research says governments remain early in using technology to reduce burden: 37% describe their digital tools as limited or experimental, and only 20% use digital tools for personalized regulatory advice. [OECD Smart Regulations, Strong Business](https://www.oecd.org/en/publications/smart-regulations-strong-business_93d38770-en/full-report/diagnostic-trends-and-challenges-in-regulatory-simplification-and-burden-reduction_a8f562d5.html) [OECD drivers of regulatory burden](https://www.oecd.org/en/publications/smart-regulations-strong-business_93d38770-en/full-report/diagnostic-drivers-of-regulatory-burden-and-complexity_7296019b.html)

The interesting problem is the gap between an obligation written in prose and evidence that a system or process actually implements it. But the market is advancing quickly: Norm-style regulatory agents, product-compliance platforms, control generators, and compliance-as-code systems already extract obligations and map controls. Legal ambiguity also prevents an unsupervised AI from being authoritative. This is worth revisiting only with a narrow jurisdiction and control family.

## 7. Verification of AI-generated software claims

The 2025 Stack Overflow survey found that 46% of developers distrusted AI output accuracy, while only 33% trusted it. Sixty-six percent cited "almost right" AI solutions as a frustration, and 45% said debugging AI-generated code was time-consuming. [Stack Overflow 2025 AI survey](https://survey.stackoverflow.co/2025/ai)

This is highly sponsor-native: let one model make a claim and another agent prove it in a sandbox. Unfortunately, the exact category is emerging rapidly. Verify, Evigate, SetupProof, and Prove It already compare agent claims with execution evidence or run documented setup paths. The problem remains valuable, but "a verifier for coding agents" is no longer non-obvious. [Verify](https://github.com/Orthogon-AI-Labs/agent-verify) [Evigate](https://github.com/shiki-yusuke/evigate) [SetupProof](https://github.com/setupproof/setupproof)

## 8. Computational research reproducibility

The National Academies found that systematic computational reproduction attempts often fail because code, data, parameters, environments, and workflows are missing or incomplete. OpenAI's PaperBench later tested agents on reproducing 20 ICML 2024 papers; the best tested agent averaged only 21% on the benchmark, demonstrating both importance and technical difficulty. [National Academies reproducibility report](https://www.ncbi.nlm.nih.gov/books/NBK547532/) [OpenAI PaperBench](https://openai.com/index/paperbench/)

The fit with reasoning and sandbox execution is excellent, but the MVP economics are poor: scientific reproductions can require restricted data, large compute, domain expertise, and hours or days per run. The space now includes PaperBench, CORE, Veritas, NewScience, and other research agents. It should not be the primary submission unless narrowed to small CPU-only artifacts and one discipline.

## 9. Adaptive AI-agent security evaluation

NIST reports that indirect prompt injection can hijack tool-using agents and emphasizes that evaluations must adapt because defenses against known attacks can remain vulnerable to newly optimized attacks. OWASP's agentic risk work highlights goal hijacking, tool misuse, privilege abuse, supply-chain compromise, and unexpected code execution. [NIST agent-hijacking evaluation](https://www.nist.gov/news-events/news/2025/01/technical-blog-strengthening-ai-agent-hijacking-evaluations) [OWASP Agentic AI threats](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/)

This almost perfectly matches branchable sandbox infrastructure. It is also one of the least attractive competitive openings: NVIDIA garak, AgentDojo, Promptfoo, Microsoft tooling, and a dense commercial red-team ecosystem already exist. Promptfoo itself is being acquired by OpenAI. [NVIDIA garak](https://github.com/NVIDIA/garak) [Promptfoo](https://www.promptfoo.dev/) [OpenAI acquisition announcement](https://openai.com/index/openai-to-acquire-promptfoo/)

## 10. Legacy-system modernization

The US government spends more than $100 billion on IT annually, mostly operating and maintaining existing systems. GAO's 2025 review of 11 critical federal legacy systems found eight using outdated languages, four with unsupported hardware or software, and seven with known cybersecurity vulnerabilities. [GAO legacy systems report](https://www.gao.gov/products/gao-25-107795)

The need is indisputable, but the market is occupied by AWS Transform, IBM and specialist modernization firms. AWS Transform already analyzes repositories, extracts business logic, generates documentation, modernizes code, and automates testing. A hackathon team would struggle to demonstrate the scale or fidelity buyers require. [AWS Transform documentation](https://docs.aws.amazon.com/transform/latest/userguide/what-is-service.html)

## Important problems rejected for now

Some problems are more consequential than the shortlist but do not fit the available build conditions.

- **Disaster early action:** Countries with limited warning coverage have far higher disaster mortality, and early-warning systems generate strong returns. However, a useful intervention needs trusted real-time hazard data, local communication channels, government coordination, and validation under life-safety conditions. [WMO global early-warning status](https://wmo.int/resources/publication-series/global-status-of-multi-hazard-early-warning-systems/global-status-of-multi-hazard-early-warning-systems-2024)
- **Food loss:** FAO estimates that 13.3% of food was lost between post-harvest and retail in 2023, rising to 23% in sub-Saharan Africa. The principal constraints include physical handling, cold chains, storage, and logistics rather than missing language-model reasoning. [FAO SDG food-loss indicator](https://www.fao.org/sustainable-development-goals-data-portal/data/indicators/1231-global-food-losses/en/)
- **Occupational safety:** ILO reports 2.93 million work-related deaths and 395 million non-fatal injuries annually. A responsible product would need site-specific sensor, process, and human-factors data and expert validation; a text-first hackathon demo could easily overclaim safety. [ILO safety and health at work](https://www.ilo.org/topics-and-sectors/safety-and-health-work)

Rejecting these is not a judgment that they are unimportant. It is recognition that the proposed AI stack is not automatically the right intervention.

## Strategic conclusion

The search does not reveal a pristine blue ocean. In 2026, fast-moving teams are already applying agents to nearly every obvious workflow. Novelty must therefore come from a precise failure boundary, not from attaching AI to an industry.

The most promising boundary is:

> **No claim without an executable witness.**

This principle is useful only when attached to one painful job. The best current job is safe incident reproduction because it combines direct founder knowledge, current demand, all three sponsor technologies, a clear safety stance, and a dramatic proof. Its hard question is whether a sanitized evidence bundle can reproduce enough real incidents to matter.

The most original alternative is software resurrection. Its hard question is whether preservation teams, maintainers, or software-escrow buyers experience this often enough and urgently enough to adopt a new tool.

The strongest human-impact alternative is accessibility task completion. Its hard question is whether the tool can find semantic barriers beyond existing scanners without making invalid claims on behalf of disabled users.

## Recommended validation sprint

Do not design branding or architecture yet. Spend the next stage trying to kill the top three problems.

### Test A: incident reproduction

- Collect three public postmortems or personally known, safely reconstructable incidents.
- Define the smallest sanitized evidence bundle for each: logs, stack trace, versions, configuration excerpts, and relevant source.
- Time how long a skilled engineer needs to create a failing local test.
- Attempt one automated branch search.
- Kill the opportunity if the failure cannot be reproduced without essentially cloning production, or if existing tools already solve the same input-to-test path.

### Test B: software resurrection

- Select three abandoned public repositories with broken documented builds and meaningful historical or scientific value.
- Measure the manual archaeology required to recover one.
- Attempt branches across dependency and runtime versions.
- Kill the opportunity if the work is mostly package-manager automation, if licensing blocks the resulting artifact, or if users value migration rather than faithful execution.

### Test C: accessibility task completion

- Choose one consequential public-service journey and define a concrete user goal.
- Run established automated checks first to establish the baseline.
- Ask at least three people with relevant lived experience or accessibility expertise whether the proposed journey evidence would be useful.
- Attempt an agent trace using accessibility-tree and keyboard-only constraints.
- Kill the opportunity if it finds nothing beyond established tools or cannot communicate uncertainty responsibly.

### Decision gate

Advance a problem only if it meets all five conditions:

1. A real user confirms the failure happens repeatedly and is painful.
2. The hardest technical step works on at least two independent examples.
3. The output contains independently checkable evidence, not an AI score.
4. Nemotron, Tavily, and sandbox execution each have a necessary role.
5. The complete value can be demonstrated in under three minutes using hackathon credits.

## Limitations

- This is desk research, not customer discovery. No market gap is validated until target users confirm it.
- Vendor feature claims were treated as evidence of competitive direction, not independently verified performance.
- New 2026 open-source projects demonstrate that categories are moving quickly; low adoption today does not imply durable whitespace.
- Sandbox beta availability, pricing, and event-credit coverage remain unverified.
- Global problem statistics do not prove willingness to adopt or pay for a particular intervention.

## Source ledger

The report relied primarily on official hackathon materials; first-party Nebius, NVIDIA, Tavily, W3C, WHO, ILO, WMO, OECD, CISA, NIST, GAO, Library of Congress, and National Academies publications; original project repositories; and first-party product documentation. All links were accessed on 4 September 2026. Product pages were used only to establish feature overlap and competitive direction. Scores and whitespace assessments are the author's synthesis from those sources.
