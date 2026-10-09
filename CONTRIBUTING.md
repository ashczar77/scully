# Contributing

Scully is undergoing a clean desktop rebuild. Run `npm ci`, `npm test`, and `npm run build`. Use `npm run test:desktop` for the real-window persistence and isolation smoke test, and `npm run package` for an unsigned local application bundle.

Keep changes focused, include tests for behaviour changes, and document checks performed and known limitations. Do not commit credentials, local application data or private planning files.

## Regression prevention

- Include tests in the same change as each new behaviour. Test user requirements, negative cases and interactions with existing features, not only the happy path.
- Add a reproducing regression test for bug fixes wherever practical.
- Keep core logic independently testable. Routine tests must be deterministic and must not require live credentials or paid services.
- Use unit/component tests alongside real storage and desktop integration checks. Mocks do not prove that a real service integration works.
- Run `npm test`, `npm run build` and `npm run format:check` before handoff. Run `npm run test:desktop` for changes affecting desktop journeys, persistence or IPC. Rebuild and smoke-test the package when packaging or runtime loading changes.
- Do not weaken or skip failing tests to hide a regression. Explain intentional changes to existing behaviour and update the corresponding acceptance criteria.
- Report failed or skipped checks and known gaps explicitly. Passing tests reduce risk; they are not proof that every possible behaviour is correct.
