import type {
  ClusteringFrequencyType,
  ClusteringMethod
} from "@seo-platform/contracts";

export const semanticClusteringMethodOptions = [
  { value: "HARD", label: "Жёсткая" },
  { value: "SOFT", label: "Мягкая" }
] as const satisfies readonly {
  readonly value: ClusteringMethod;
  readonly label: string;
}[];

export const defaultSemanticClusteringMethod: ClusteringMethod = "HARD";

export const defaultSemanticClusteringFrequencyTypes =
  [] as const satisfies readonly ClusteringFrequencyType[];
