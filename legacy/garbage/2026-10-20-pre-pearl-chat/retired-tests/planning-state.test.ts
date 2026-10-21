import { describe, expect, it } from "vitest";
import {
  approvePlan,
  approveStaffing,
  initialPlanningState,
  pendingPlanningQuestions,
  proposeStaffing,
  recordPlanningTurn,
  submitPlanForReview,
} from "../src/shared/planning-state";

const now = () => new Date("2026-10-18T00:00:00.000Z");
const assignment = (
  memberId: string,
  role: string,
  dependsOn: string[] = [],
) => ({
  memberId,
  role,
  objective: `${memberId} owns a distinct deliverable`,
  evidence: "The project brief and inspected source establish this work",
  permissions:
    role === "auditor" ? ["read", "check", "audit"] : ["read", "edit", "check"],
  dependsOn,
  environment: {
    tools: ["node"],
    reason: "The assigned checks use this runtime",
    checks: [],
  },
});

describe("durable planning decisions and staffing", () => {
  it("requires explicit approval of the current plan revision before team formation", () => {
    const state = initialPlanningState();
    const assignments = [
      assignment("maya", "builder"),
      assignment("ellis", "auditor", ["maya"]),
    ];
    const proposal = { assignments, rationale: "Distinct build and review" };
    expect(() =>
      proposeStaffing(state, proposal, ["maya", "ellis"], "rev-a"),
    ).toThrow(/Approve the current plan/);
    const review = submitPlanForReview(state, "rev-a");
    expect(() =>
      proposeStaffing(review, proposal, ["maya", "ellis"], "rev-a"),
    ).toThrow(/Approve the current plan/);
    expect(() => approvePlan(review, "rev-b", now)).toThrow(/current plan/);
    const approved = approvePlan(review, "rev-a", now);
    expect(() =>
      proposeStaffing(approved, proposal, ["maya", "ellis"], "rev-b"),
    ).toThrow(/Approve the current plan/);
    expect(
      proposeStaffing(approved, proposal, ["maya", "ellis"], "rev-a").proposal
        ?.assignments,
    ).toHaveLength(2);
    const changed = recordPlanningTurn(approved, {
      questions: [
        { text: "New material choice?", recommendation: "Discuss it" },
      ],
    });
    expect(changed.planReview).toBeUndefined();
  });
  it("withdraws an obsolete pending question while retaining the earlier record", () => {
    const asked = recordPlanningTurn(
      initialPlanningState(),
      {
        questions: [
          {
            text: "Where should storage live?",
            recommendation: "Local",
            options: ["Local", "Shared"],
          },
        ],
      },
      now,
    );
    const id = asked.questions[0].id;
    const revised = recordPlanningTurn(
      asked,
      {
        withdrawnQuestionIds: [id],
        questions: [
          {
            text: "Should lists be shared across devices?",
            recommendation: "Yes",
            options: ["Yes", "No"],
          },
        ],
      },
      now,
    );
    expect(revised.questions[0].status).toBe("withdrawn");
    expect(revised.questions[1].status).toBe("pending");
    expect(() =>
      recordPlanningTurn(revised, { withdrawnQuestionIds: [id] }),
    ).toThrow(/no longer pending/i);
    expect(asked.questions[0].status).toBe("pending");
  });
  it("supersedes an answered decision without erasing the user's original answer", () => {
    const asked = recordPlanningTurn(
      initialPlanningState(),
      {
        questions: [
          {
            text: "Where should the data live?",
            recommendation: "Local",
            options: ["Local", "Shared"],
          },
        ],
      },
      now,
    );
    const answered = recordPlanningTurn(
      asked,
      {
        resolvedQuestionIds: [asked.questions[0].id],
        answer: "Local",
      },
      now,
    );
    const revised = recordPlanningTurn(
      answered,
      {
        supersededQuestionIds: [asked.questions[0].id],
        questions: [
          {
            text: "Should devices share data?",
            recommendation: "Yes",
            options: ["Yes", "No"],
          },
        ],
      },
      now,
    );
    expect(revised.questions[0]).toMatchObject({
      status: "superseded",
      answer: "Local",
    });
    expect(revised.questions[1].status).toBe("pending");
    expect(() =>
      recordPlanningTurn(revised, {
        supersededQuestionIds: [asked.questions[0].id],
      }),
    ).toThrow(/answered question/i);
  });
  it("holds a proposal while any real question remains open, then accepts an unnumbered answer", () => {
    const asked = recordPlanningTurn(
      initialPlanningState(),
      {
        questions: [
          {
            text: "Where should the data live?",
            recommendation: "Use a local file",
          },
        ],
      },
      now,
    );
    expect(pendingPlanningQuestions(asked)).toHaveLength(1);
    expect(() =>
      proposeStaffing(
        asked,
        { assignments: [], rationale: "ready" },
        [],
        "rev",
      ),
    ).toThrow(/Resolve planning questions/);
    const answered = recordPlanningTurn(
      asked,
      {
        resolvedQuestionIds: [asked.questions[0].id],
        answer: "Keep it in a JSON file, and make a web interface.",
      },
      now,
    );
    expect(answered.questions[0].answer).toContain("JSON file");
    expect(pendingPlanningQuestions(answered)).toHaveLength(0);
  });

  it("rejects replacement questions while an earlier decision is unresolved", () => {
    const asked = recordPlanningTurn(initialPlanningState(), {
      questions: [{ text: "Browser or desktop?", recommendation: "Browser." }],
    });
    expect(() =>
      recordPlanningTurn(asked, {
        answer: "A browser app works for me.",
        resolvedQuestionIds: [],
        questions: [
          { text: "Should it be a browser app?", recommendation: "Yes." },
        ],
      }),
    ).toThrow(/earlier pending questions/);
    expect(asked.questions).toHaveLength(1);
  });

  it("accepts several builders and testers but never silently substitutes a person", () => {
    const ids = ["maya", "tessa", "jun", "malik", "ellis"];
    const assignments = [
      assignment("maya", "builder"),
      assignment("tessa", "builder"),
      assignment("jun", "tester", ["maya"]),
      assignment("malik", "tester", ["tessa"]),
      assignment("ellis", "auditor", ["jun", "malik"]),
    ];
    const proposed = proposeStaffing(
      approvePlan(
        submitPlanForReview(initialPlanningState(), "rev-1"),
        "rev-1",
        now,
      ),
      {
        assignments,
        rationale: "Two independent components and two distinct test scopes",
      },
      ids,
      "rev-1",
    );
    expect(proposed.proposal?.assignments).toHaveLength(5);
    const approved = approveStaffing(proposed, "rev-1", assignments, ids, now);
    expect(
      approved.approved?.assignments.filter((a) => a.role === "builder"),
    ).toHaveLength(2);
    expect(() =>
      proposeStaffing(
        approvePlan(
          submitPlanForReview(initialPlanningState(), "rev-2"),
          "rev-2",
          now,
        ),
        {
          assignments: [
            assignment("maya", "builder"),
            assignment("ellis", "auditor"),
          ],
          rationale: "A small task",
        },
        ["tessa", "meryl"],
        "rev-2",
      ),
    ).toThrow(/available teammate/);
  });

  it("rejects forged resolutions, inappropriate roles, and unavailable dependencies", () => {
    expect(() =>
      recordPlanningTurn(initialPlanningState(), {
        resolvedQuestionIds: ["missing"],
        answer: "yes",
      }),
    ).toThrow(/current user answer/);
    expect(() =>
      proposeStaffing(
        approvePlan(
          submitPlanForReview(initialPlanningState(), "rev"),
          "rev",
          now,
        ),
        {
          assignments: [
            assignment("maya", "auditor"),
            assignment("ellis", "auditor"),
          ],
          rationale: "bad",
        },
        ["maya", "ellis"],
        "rev",
      ),
    ).toThrow(/role/);
    expect(() =>
      proposeStaffing(
        approvePlan(
          submitPlanForReview(initialPlanningState(), "rev"),
          "rev",
          now,
        ),
        {
          assignments: [
            assignment("maya", "builder", ["unknown"]),
            assignment("ellis", "auditor"),
          ],
          rationale: "bad",
        },
        ["maya", "ellis"],
        "rev",
      ),
    ).toThrow(/dependency/);
  });
});
