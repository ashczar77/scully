# Agent collaboration direction

Status: future product direction. The active Room is Pearl's solo chat and coding workflow. This document does not describe a working team feature or authorize its implementation before the solo workflow is reliable.

Pearl remains the user's primary contact in the Room. Collaboration can grow in two distinct ways:

| Pattern          | Purpose                                                                                                                                    | Communication                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Focused subagent | Handle a bounded piece of work, such as inspecting a module, researching a question, or reviewing a change, in a separate working context. | Reports findings and evidence to Pearl. Pearl integrates the result and remains responsible for what she tells the user. |
| Team teammate    | Own a visible part of a larger task over multiple exchanges, with its own context, progress, and permissions.                              | Can coordinate directly with Pearl and other teammates. The user can address a teammate in the Room when useful.         |

Both patterns need explicit task ownership, scoped tools and permissions, source revisions, observable progress, and a way to recover interrupted work. Parallel edits need isolated work and a deliberate integration step so one agent cannot silently overwrite another. A teammate's report is evidence to inspect, not automatic proof of completion or authority to change product scope.

Use focused delegation when a task can be completed independently and its result can be returned to Pearl. Use a team when work requires ongoing coordination, shared decisions, or direct conversation among specialists. Additional agents consume model requests and other resources, so the system should add them because the work benefits from them, not to fill a preset roster.

Team formation and the collaborative Room remain deferred until Pearl's solo coding workflow is reliable. The [earlier collaboration plan](collaborative-sandbox-orchestration-plan.md) contains historical design and implementation evidence; it must be checked against current code and product decisions before any team work resumes.
