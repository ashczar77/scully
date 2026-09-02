# Pragtig Naming and Brand Research Plan

**Status:** Draft for Gate G0.4  
**Date:** 2026-09-02  
**Current name status:** Selected provisional working name  
**Pronunciation:** prakh-tik

## 1. Purpose

Define how the Pragtig name, artifact coordinates, package namespace,
domains, and public identity will be evaluated before public release.

This document records a preliminary collision check. It is not a trademark
clearance opinion or legal advice.

## 2. Preliminary findings

### 2.1 Exact-name software use

A preliminary web and software-ecosystem search did not identify a prominent
framework or developer tool using the exact name Pragtig. The search did find
unrelated businesses and ordinary-language uses. This is encouraging, but it
does not establish trademark or identifier availability.

### 2.2 Searchability

Pragtig is an Afrikaans adjective meaning beautiful, magnificent, or splendid.
Ordinary-language use creates some search noise, but exact searches remain
reasonably distinctive for a software framework.

The intended pronunciation is prakh-tik. Public documentation should provide
the pronunciation until it becomes familiar to the project's audience.

### 2.3 Similar framework name

Pracht is an existing full-stack Preact framework. Pracht is not the same
name, but its spelling, linguistic origin, meaning, and software category make
it relevant to the confusion assessment.

Source: https://github.com/JoviDeCroock/pracht

This adjacent use is not an automatic rejection. It must be included in the
formal similarity review.

### 2.4 JVM ecosystem

A preliminary general search did not establish a prominent current Java
application framework named Pragtig. This is not sufficient evidence of
artifact or namespace availability.

Maven Central is the default repository for JVM components, and its official
search must be checked directly before coordinates are selected.

Sources:

- https://central.sonatype.com
- https://central.sonatype.org/search/

### 2.5 Trademark databases

WIPO states that its Global Brand Database covers international and
participating national or regional collections, but also advises searching
national and regional registers. The USPTO similarly explains that a federal
database search is only one part of a comprehensive clearance search.

Official search sources:

- WIPO Global Brand Database:
  https://www.wipo.int/en/web/global-brand-database
- USPTO trademark search:
  https://www.uspto.gov/trademarks/search
- EUIPO search:
  https://www.euipo.europa.eu/en/search
- South Africa CIPC IP Online:
  https://iponline.cipc.co.za/

## 3. Immediate policy

- Pragtig is the selected provisional working name.
- Do not claim trademark ownership.
- Do not use the registered trademark symbol.
- Do not commission a final logo or publish branded artifacts.
- Do not register package coordinates, domains, or social handles as a
  substitute for legal clearance.
- Internal module names may use Pragtig temporarily if renaming remains
  straightforward.

## 4. Clearance plan

### Step N1: Define intended use

Document:

- software framework and developer-tool goods or services;
- whether hosted services, training, consulting, or commercial support are
  planned;
- expected initial jurisdictions;
- expected project owner or legal entity.

**Review criterion:** Search scope and relevant goods/services are defined.

### Step N2: Search exact and similar marks

Search:

- Pragtig;
- Pragtig Framework;
- Pragtig JVM;
- visually, phonetically, and conceptually similar marks identified during
  research;
- relevant live and pending marks for software and developer services.

Use WIPO, USPTO, EUIPO, CIPC, and other target-jurisdiction registers.

**Review criterion:** Results include status, owner, jurisdiction,
goods/services, and similarity assessment.

### Step N3: Search common-law and ecosystem use

Search:

- GitHub and other source hosts;
- Maven Central;
- Gradle Plugin Portal;
- npm, PyPI, crates.io, and other software registries;
- framework lists and technical publications;
- company and product directories;
- domains and social handles;
- ordinary web results.

**Review criterion:** Active software uses and likelihood of developer
confusion are documented.

### Step N4: Check technical identifiers

Evaluate availability and ownership requirements for:

- GitHub organization or repository;
- Maven group and artifact identifiers;
- Java package namespace;
- Gradle plugin identifier;
- documentation domain;
- CLI executable name;
- social and community handles.

**Review criterion:** A coherent identifier set is realistically obtainable.

### Step N5: Legal review

Before public branding or meaningful investment, obtain a qualified trademark
review appropriate to target jurisdictions if the project owner intends
commercial or broad public use.

**Review criterion:** Risks are accepted, mitigated, or the name is rejected.

### Step N6: Brand decision

Record an ADR that:

- approves Pragtig;
- approves Pragtig with limitations;
- or selects a replacement from separately evaluated candidates.

**Review criterion:** The decision includes evidence, ownership, identifiers,
and a migration plan for internal working names.

## 5. Name acceptance criteria

A public name should:

- have an acceptable trademark-conflict assessment;
- avoid likely confusion with active developer tools;
- be discoverable in web and package searches;
- support coherent package, repository, domain, and CLI identifiers;
- be pronounceable and memorable for an international audience;
- avoid unintended negative meanings in major target languages where
  practical;
- remain usable if the framework grows beyond HTTP services.

## 6. Current assessment

**Risk level:** Medium pending formal clearance.

The preliminary search found no prominent exact-name framework or developer
tool. The adjacent Pracht framework and incomplete trademark, registry,
domain, and identifier searches mean Pragtig must not yet be treated as
cleared. It is suitable as the selected internal name while the remaining
clearance work continues.

## 7. Required decision timing

Complete full name clearance before:

- public repository launch;
- Maven or Gradle coordinate registration;
- public preview announcement;
- logo or visual identity work;
- domain or social campaign;
- accepting external contributions under the brand.
