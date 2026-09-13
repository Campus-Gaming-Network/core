import { createFileRoute } from "@tanstack/react-router";
import {
  schoolsApiResponse,
  schoolsMethodNotAllowedResponse
} from "../features/school-slice/schools-api.server";
import { goBFFForHeaders } from "../server/request-boundary.server";

export const Route = createFileRoute("/api/schools")({
  server: {
    handlers: {
      GET: ({ request }) => handleSchoolsRequest(request),
      HEAD: ({ request }) => handleSchoolsRequest(request),
      POST: schoolsMethodNotAllowedResponse,
      PUT: schoolsMethodNotAllowedResponse,
      PATCH: schoolsMethodNotAllowedResponse,
      DELETE: schoolsMethodNotAllowedResponse,
      OPTIONS: schoolsMethodNotAllowedResponse
    }
  }
});

function handleSchoolsRequest(request: Request): Promise<Response> {
  return schoolsApiResponse(request, {
    api: goBFFForHeaders(request.headers)
  });
}
