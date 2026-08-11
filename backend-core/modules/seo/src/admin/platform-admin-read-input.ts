import { BadRequestException } from "@nestjs/common";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PROJECTS = 50;

export function adminProjectIds(value: unknown): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value.projectIds)) {
    throw invalidInput();
  }
  if (
    value.projectIds.length === 0 ||
    value.projectIds.length > MAX_PROJECTS ||
    Object.keys(value).some((key) => key !== "projectIds")
  ) {
    throw invalidInput();
  }
  const projectIds = value.projectIds.map((projectId) => {
    if (typeof projectId !== "string" || !UUID_PATTERN.test(projectId)) {
      throw invalidInput();
    }
    return projectId.toLowerCase();
  });
  if (new Set(projectIds).size !== projectIds.length) throw invalidInput();
  return projectIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidInput(): BadRequestException {
  return new BadRequestException("Invalid platform admin project selection");
}
