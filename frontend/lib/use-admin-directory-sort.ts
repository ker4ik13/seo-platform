"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { adminDirectorySorts, type AdminDirectorySort } from "@seo-platform/contracts";

export function useAdminDirectorySort(scope: "project" | "workspace") {
  const router = useRouter();
  const params = useSearchParams();
  const key = `${scope}Sort`;
  const value = params.get(key);
  const sort: AdminDirectorySort = adminDirectorySorts.includes(value as AdminDirectorySort) ? value as AdminDirectorySort : "CREATED_DESC";
  return { sort, changeSort: (next: AdminDirectorySort) => {
    const search = new URLSearchParams(params.toString()); search.set(key, next);
    router.replace(`/admin?${search}`, { scroll: false });
  } };
}
