/*
 * SPDX-FileCopyrightText: 2026 Coffey Labs LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// inbuxa: DLP on send: the override travels with the submission, and the
// server's refusals are told apart from other errors.
import { describe, expect, it } from "vitest";
import { buildSubmission, dlpRefusalOf } from "../compose";

const base = {
  identityId: "i1",
  fromEmail: "dana@example.com",
  emailRef: "#m",
  rcpts: [{ email: "x@elsewhere.org" }],
  sentId: "sent",
  draftsId: "drafts",
  scheduledId: null,
  sendAt: null,
};

describe("DLP on send", () => {
  it("sends the override reason only when there is one", () => {
    expect(buildSubmission(base).create["inbuxa:dlpOverride"]).toBeUndefined();
    expect(buildSubmission({ ...base, dlpOverride: "  " }).create["inbuxa:dlpOverride"]).toBeUndefined();
    expect(buildSubmission({ ...base, dlpOverride: " Client asked " }).create["inbuxa:dlpOverride"]).toEqual({ reason: "Client asked" });
  });

  it("recognizes the server's refusals", () => {
    expect(dlpRefusalOf({ type: "inbuxa:dlpWarning", rules: [{ name: "Cards", notice: "Looks like a card." }] })).toEqual({
      kind: "warning",
      rules: [{ name: "Cards", notice: "Looks like a card." }],
    });
    expect(dlpRefusalOf({ type: "inbuxa:dlpBlocked" })).toEqual({ kind: "blocked", rules: [] });
    expect(dlpRefusalOf({ type: "forbiddenToSend" })).toBeNull();
    expect(dlpRefusalOf(undefined)).toBeNull();
  });
});
