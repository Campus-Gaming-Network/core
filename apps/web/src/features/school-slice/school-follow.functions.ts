import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse
} from "../../server/request-boundary.server.js";
import {
  validateSchoolFollowServerInput,
  type SchoolFollowInput,
  type SchoolFollowRedirectResult
} from "./contracts.js";
import {
  followSchoolOperation,
  unfollowSchoolOperation
} from "./school-follow-operations.server.js";

export const followSchool = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: SchoolFollowInput | FormData) =>
    validateSchoolFollowServerInput(input)
  )
  .handler(async ({ data }) =>
    handleSchoolFollow(data, followSchoolOperation)
  );

export const unfollowSchool = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: SchoolFollowInput | FormData) =>
    validateSchoolFollowServerInput(input)
  )
  .handler(async ({ data }) =>
    handleSchoolFollow(data, unfollowSchoolOperation)
  );

type Operation = (
  input: SchoolFollowInput,
  dependencies: ReturnType<typeof currentSessionRequest>
) => Promise<SchoolFollowRedirectResult>;

async function handleSchoolFollow(
  data: ReturnType<typeof validateSchoolFollowServerInput>,
  operation: Operation
): Promise<SchoolFollowRedirectResult> {
  setPrivateNoStoreResponse();
  const result = data.valid
    ? await operation(data.value, currentSessionRequest())
    : {
        status: "success" as const,
        redirectTo: "/schools?follow=failed"
      };

  if (isNativeFormPost()) {
    throw redirect({ href: result.redirectTo, statusCode: 303 });
  }
  return result;
}
