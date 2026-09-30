import { createFileRoute } from "@tanstack/react-router";
import {
  avatarMethodNotAllowedResponse,
  avatarResponse,
} from "../server/avatar.server";

export const Route = createFileRoute("/api/avatars/$id")({
  server: {
    handlers: {
      GET: ({ params }) => avatarResponse(params.id),
      HEAD: ({ params }) => avatarResponse(params.id),
      POST: avatarMethodNotAllowedResponse,
      PUT: avatarMethodNotAllowedResponse,
      PATCH: avatarMethodNotAllowedResponse,
      DELETE: avatarMethodNotAllowedResponse,
      OPTIONS: avatarMethodNotAllowedResponse,
    },
  },
});
