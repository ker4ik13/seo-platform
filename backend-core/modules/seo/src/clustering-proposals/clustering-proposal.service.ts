import { createHash } from "node:crypto";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  ClusteringProposalApplyResult,
  ClusteringProposalConflictReason,
  ClusteringProposalItemState,
  ClusteringProposalResultRow,
  ClusteringProposalSummary,
  InternalApplyClusteringProposalInput,
  InternalClusteringKeyword,
  InternalClusteringKeywords,
  InternalClusteringProposalResult,
  InternalClusteringProposalResultInput,
  InternalClusteringProposalSectionResult,
  InternalClusteringProposalSectionResultInput,
  InternalPersistClusteringProposalInput,
  InternalRejectClusteringProposalInput,
  InternalResolveClusteringKeywordsInput,
  SemanticClusterMethod
} from "@seo-platform/contracts";
import { clusteringProposalUnclusteredSectionId } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { lockSemanticKeywordWrites } from "../semantic-versions/semantic-version.service.js";
import {
  SemanticVersionService,
  type SemanticClusterChange,
  type SemanticClusterVersionState,
  type SemanticKeywordChange,
  type SemanticKeywordVersionState
} from "../semantic-versions/semantic-version.service.js";

const ITEM_WRITE_BATCH = 2_000;
const VERSION_CHANGE_BATCH = 500;
const PERSIST_TRANSACTION_TIMEOUT_MS = 90_000;
const GROUP_COLORS = ["#6366f1", "#8b5cf6", "#0ea5e9", "#14b8a6", "#f59e0b", "#ef4444"] as const;

const CURRENT_KEYWORD_INCLUDE = {
  cluster: {
    select: {
      id: true,
      name: true,
      isLocked: true,
      excludeFromReclustering: true,
      status: true
    }
  },
  memberships: {
    orderBy: { createdAt: "asc" as const },
    select: { groupId: true }
  },
  tags: {
    orderBy: { createdAt: "asc" as const },
    select: { tagId: true }
  }
} satisfies Prisma.KeywordInclude;

type CurrentKeyword = Prisma.KeywordGetPayload<{
  include: typeof CURRENT_KEYWORD_INCLUDE;
}>;

const APPLY_PROPOSAL_INCLUDE = {
  clusters: { orderBy: { sequence: "asc" as const } },
  items: {
    orderBy: { sequence: "asc" as const },
    include: { proposalCluster: true }
  }
} satisfies Prisma.ClusteringProposalInclude;

type ApplyProposal = Prisma.ClusteringProposalGetPayload<{
  include: typeof APPLY_PROPOSAL_INCLUDE;
}>;

@Injectable()
export class ClusteringProposalService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly semanticVersions: SemanticVersionService
  ) {}

  public async resolveBatch(
    input: InternalResolveClusteringKeywordsInput
  ): Promise<InternalClusteringKeywords> {
    const rows = await this.prisma.keyword.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        id: { in: input.items.map(({ id }) => id) },
        status: "ACTIVE"
      },
      select: { id: true, textOriginal: true, version: true }
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = input.items.map(({ id, version }) => {
      const row = byId.get(id);
      if (!row) throw keywordUnavailable();
      if (row.version !== version) throw keywordVersionConflict(row.version);
      return {
        id: row.id,
        text: row.textOriginal,
        version: row.version
      } satisfies InternalClusteringKeyword;
    });
    return { items };
  }

  public async persist(
    input: InternalPersistClusteringProposalInput
  ): Promise<ClusteringProposalSummary> {
    const keywordCountByClusterSequence = new Map<number, number>();
    for (const item of input.items) {
      if (item.clusterSequence === undefined) continue;
      keywordCountByClusterSequence.set(
        item.clusterSequence,
        (keywordCountByClusterSequence.get(item.clusterSequence) ?? 0) + 1
      );
    }
    const existing = await this.prisma.clusteringProposal.findUnique({
      where: { jobId: input.jobId }
    });
    if (existing) {
      assertProposalScope(existing, input.workspaceId, input.projectId);
      return this.summary(
        existing,
        existing.status === "READY" ? existing.keywordCount : 0,
        0,
        0
      );
    }
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const proposal = await transaction.clusteringProposal.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            jobId: input.jobId,
            provider: input.provider,
            connectorVersion: input.connectorVersion,
            parameters: json(input.parameters),
            keywordCount: input.items.length,
            clusterCount: input.clusters.length,
            unclusteredCount: input.items.filter(({ clusterSequence }) => clusterSequence === undefined).length,
            createdBy: input.actorId
          }
        });
        const clusters = input.clusters.length === 0
          ? []
          : await transaction.clusteringProposalCluster.createManyAndReturn({
              data: input.clusters.map((cluster) => ({
                proposalId: proposal.id,
                sequence: cluster.sequence,
                providerKey: cluster.providerKey,
                name: cluster.name,
                ...(cluster.topUrl ? { topUrl: cluster.topUrl } : {}),
                topUrls: json(cluster.topUrls),
                ...(cluster.frequencySum === undefined
                  ? {}
                  : { frequencySum: BigInt(cluster.frequencySum) }),
                ...(cluster.mainPageCount === undefined
                  ? {}
                  : { mainPageCount: cluster.mainPageCount }),
                keywordCount: keywordCountByClusterSequence.get(cluster.sequence) ?? 0
              }))
            });
        const clusterIdBySequence = new Map(
          clusters.map(({ sequence, id }) => [sequence, id])
        );
        for (const batch of chunked(input.items, ITEM_WRITE_BATCH)) {
          await transaction.clusteringProposalItem.createMany({
            data: batch.map((item) => ({
              proposalId: proposal.id,
              sequence: item.sequence,
              keywordId: item.keywordId,
              keywordVersion: item.keywordVersion,
              keywordText: item.keywordText,
              ...(item.clusterSequence === undefined
                ? {}
                : { proposalClusterId: required(clusterIdBySequence.get(item.clusterSequence)) }),
              ...(item.frequency === undefined ? {} : { frequency: BigInt(item.frequency) }),
              ...(item.exactFrequency === undefined
                ? {}
                : { exactFrequency: BigInt(item.exactFrequency) }),
              ...(item.aggregatorsPercent === undefined
                ? {}
                : { aggregatorsPercent: item.aggregatorsPercent }),
              ...(item.toponym ? { toponym: item.toponym } : {}),
              ...(item.geoDependent === undefined
                ? {}
                : { geoDependent: item.geoDependent })
            }))
          });
        }
        return proposal;
      }, { maxWait: 10_000, timeout: PERSIST_TRANSACTION_TIMEOUT_MS });
      return this.summary(created, created.keywordCount, 0, 0);
    } catch (error) {
      if (!unique(error)) throw error;
      const winner = await this.prisma.clusteringProposal.findUnique({
        where: { jobId: input.jobId }
      });
      if (!winner) throw new ConflictException("Clustering proposal command conflicted");
      assertProposalScope(winner, input.workspaceId, input.projectId);
      return this.summary(
        winner,
        winner.status === "READY" ? winner.keywordCount : 0,
        0,
        0
      );
    }
  }

  public async result(
    input: InternalClusteringProposalResultInput
  ): Promise<InternalClusteringProposalResult> {
    const proposal = await this.prisma.clusteringProposal.findFirst({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        jobId: input.jobId
      },
      include: { clusters: { orderBy: { sequence: "asc" } } }
    });
    if (!proposal) {
      return {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        jobId: input.jobId,
        clusters: [],
        rows: [],
        page: { hasNext: false }
      };
    }
    const [allItems, pageItems] = await Promise.all([
      this.prisma.clusteringProposalItem.findMany({
        where: { proposalId: proposal.id },
        orderBy: { sequence: "asc" },
        select: {
          keywordId: true,
          keywordVersion: true,
          proposalClusterId: true,
          appliedClusterId: true,
          appliedGroupId: true
        }
      }),
      this.prisma.clusteringProposalItem.findMany({
        where: {
          proposalId: proposal.id,
          ...(input.cursor === undefined ? {} : { sequence: { gt: input.cursor } })
        },
        orderBy: { sequence: "asc" },
        take: input.limit + 1,
        include: { proposalCluster: true }
      })
    ]);
    const currentKeywords = await this.currentKeywords(
      input.workspaceId,
      input.projectId,
      allItems.map(({ keywordId }) => keywordId)
    );
    const currentById = new Map(currentKeywords.map((keyword) => [keyword.id, keyword]));
    const currentClusterKeywordCountByProposalId = new Map<string, number>();
    for (const item of allItems) {
      if (!item.proposalClusterId) continue;
      const current = currentById.get(item.keywordId);
      if (current?.status !== "ACTIVE" || current.cluster?.status !== "ACTIVE") continue;
      currentClusterKeywordCountByProposalId.set(
        item.proposalClusterId,
        (currentClusterKeywordCountByProposalId.get(item.proposalClusterId) ?? 0) + 1
      );
    }
    const states = allItems.map((item) => itemState(
      item,
      currentById.get(item.keywordId),
      proposal.status
    ));
    const visible = pageItems.slice(0, input.limit);
    const hasNext = pageItems.length > input.limit;
    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      jobId: input.jobId,
      proposal: this.summary(
        proposal,
        states.filter((state) => state === "READY").length,
        states.filter((state) => state === "LOCKED" || state === "EXCLUDED").length,
        states.filter((state) => state === "CONFLICTED" || state === "UNAVAILABLE").length
      ),
      clusters: proposal.clusters.map((cluster) => proposalClusterSummary(
        cluster,
        currentClusterKeywordCountByProposalId.get(cluster.id) ?? 0
      )),
      rows: visible.map((item) => proposalRow(
        item,
        currentById.get(item.keywordId),
        item.proposalClusterId
          ? currentClusterKeywordCountByProposalId.get(item.proposalClusterId) ?? 0
          : 0,
        proposal.status
      )),
      page: {
        hasNext,
        ...(hasNext && visible.at(-1)
          ? { nextCursor: String(visible.at(-1)!.sequence) }
          : {})
      }
    };
  }

  public async sectionResult(
    input: InternalClusteringProposalSectionResultInput
  ): Promise<InternalClusteringProposalSectionResult> {
    const proposal = await this.prisma.clusteringProposal.findFirst({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        jobId: input.jobId
      },
      select: { id: true, status: true }
    });
    if (!proposal) throw new NotFoundException("Clustering proposal not found");

    const proposalClusterId =
      input.sectionId === clusteringProposalUnclusteredSectionId
        ? null
        : input.sectionId;
    if (proposalClusterId) {
      const cluster = await this.prisma.clusteringProposalCluster.findFirst({
        where: { id: proposalClusterId, proposalId: proposal.id },
        select: { id: true }
      });
      if (!cluster) {
        throw new NotFoundException("Clustering proposal section not found");
      }
    }

    const pageItems = await this.prisma.clusteringProposalItem.findMany({
      where: {
        proposalId: proposal.id,
        proposalClusterId,
        ...(input.cursor === undefined
          ? {}
          : { sequence: { gt: input.cursor } })
      },
      orderBy: { sequence: "asc" },
      take: input.limit + 1,
      include: { proposalCluster: true }
    });
    const visible = pageItems.slice(0, input.limit);
    const currentKeywords = await this.currentKeywords(
      input.workspaceId,
      input.projectId,
      visible.map(({ keywordId }) => keywordId)
    );
    const currentById = new Map(
      currentKeywords.map((keyword) => [keyword.id, keyword])
    );
    const hasNext = pageItems.length > input.limit;
    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      jobId: input.jobId,
      sectionId: input.sectionId,
      rows: visible.map((item) => proposalSectionRow(
        item,
        currentById.get(item.keywordId),
        proposal.status
      )),
      page: {
        hasNext,
        ...(hasNext && visible.at(-1)
          ? { nextCursor: String(visible.at(-1)!.sequence) }
          : {})
      }
    };
  }

  public async apply(
    input: InternalApplyClusteringProposalInput
  ): Promise<ClusteringProposalApplyResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockClusteringProposal(transaction, input.jobId);
      await lockSemanticKeywordWrites(transaction, input.projectId);
      await lockGroupTree(transaction, input.projectId);
      await lockClusterSet(transaction, input.projectId);
      const proposal = await transaction.clusteringProposal.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          jobId: input.jobId
        },
        include: APPLY_PROPOSAL_INCLUDE
      });
      if (!proposal) throw new NotFoundException("Clustering proposal not found");
      if (proposal.status !== "READY") throw proposalAlreadySettled();
      if (proposal.version !== input.proposalVersion) throw proposalVersionConflict(proposal.version);
      validateApplySelection(proposal, input);
      const parameters = proposalParameters(proposal.parameters);
      const overrides = new Map(
        input.clusterNameOverrides.map(({ proposalClusterId, name }) => [proposalClusterId, name])
      );
      const explicitClusterAssignmentById = new Map(
        input.clusterAssignmentOverrides.map((override) => [override.proposalClusterId, override])
      );
      const groupOverrideByKeywordId = new Map(
        input.keywordGroupOverrides.map(({ keywordId, groupId }) => [keywordId, groupId])
      );
      const clusterFolderOverrideById = new Map(
        input.clusterFolderOverrides.map((override) => [override.proposalClusterId, override])
      );
      const excluded = new Set(input.excludedClusterIds);
      const requestedGroupIds = [...new Set([
        ...groupOverrideByKeywordId.values(),
        ...(input.parentGroupId ? [input.parentGroupId] : []),
        ...input.clusterFolderOverrides.flatMap(({ action, groupId, parentGroupId }) => {
          if (action === "EXISTING" && groupId) return [groupId];
          if (action === "NEW" && parentGroupId) return [parentGroupId];
          return [];
        })
      ])];
      const availableGroups = requestedGroupIds.length > 0
        ? await transaction.keywordGroup.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            id: { in: requestedGroupIds },
            status: "ACTIVE",
            systemKind: null
          },
          select: { id: true, name: true, path: true }
        })
        : [];
      if (availableGroups.length !== requestedGroupIds.length) {
        throw new ConflictException("A selected destination folder is unavailable");
      }
      const availableGroupById = new Map(
        availableGroups.map((group) => [group.id, group])
      );
      const keywordRows = await transaction.keyword.findMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          id: { in: proposal.items.map(({ keywordId }) => keywordId) }
        },
        include: CURRENT_KEYWORD_INCLUDE
      });
      const currentById = new Map(keywordRows.map((keyword) => [keyword.id, keyword]));
      const targetNameByProposalCluster = new Map(
        proposal.clusters.map((cluster) => [cluster.id, overrides.get(cluster.id) ?? cluster.name])
      );
      const clusterAssignmentById = new Map(
        proposal.clusters.map((cluster) => {
          const explicit = explicitClusterAssignmentById.get(cluster.id);
          if (explicit) return [cluster.id, explicit] as const;
          const hasCurrentCluster = proposal.items.some(
            (item) =>
              item.proposalClusterId === cluster.id &&
              currentById.get(item.keywordId)?.cluster?.status === "ACTIVE"
          );
          return [
            cluster.id,
            {
              proposalClusterId: cluster.id,
              action: parameters.replaceExistingClusters || !hasCurrentCluster ? "NEW" : "KEEP"
            }
          ] as const;
        })
      );
      const applicableItems = proposal.items.filter((item) => {
        if (item.proposalClusterId && excluded.has(item.proposalClusterId)) return false;
        const current = currentById.get(item.keywordId);
        return itemState(item, current, proposal.status) === "READY";
      });
      const applicableClusterIds = new Set(
        applicableItems.flatMap(({ proposalClusterId }) => proposalClusterId ? [proposalClusterId] : [])
      );
      const applicableItemIdsByProposalCluster = new Map<string, string[]>();
      for (const item of applicableItems) {
        if (!item.proposalClusterId) continue;
        const itemIds = applicableItemIdsByProposalCluster.get(item.proposalClusterId) ?? [];
        itemIds.push(item.id);
        applicableItemIdsByProposalCluster.set(item.proposalClusterId, itemIds);
      }
      const activeClusters = await transaction.cluster.findMany({
        where: { workspaceId: input.workspaceId, projectId: input.projectId, status: "ACTIVE" },
        select: { id: true, name: true, isLocked: true, excludeFromReclustering: true }
      });
      const activeClusterById = new Map(activeClusters.map((cluster) => [cluster.id, cluster]));
      for (const decision of clusterAssignmentById.values()) {
        if (decision.action !== "EXISTING") continue;
        const target = decision.clusterId
          ? activeClusterById.get(decision.clusterId)
          : undefined;
        if (!target || target.isLocked || target.excludeFromReclustering) {
          throw new ConflictException("A selected SEO cluster is unavailable for assignment");
        }
      }
      const usedClusterNames = new Set(
        activeClusters.map(({ name }) => normalizedName(name))
      );
      const clusterChangeRows: SemanticClusterChange[] = [];
      const appliedClusterByProposalId = new Map<string, string>();
      const method = semanticClusterMethod(parameters.method);
      for (const proposalCluster of proposal.clusters) {
        if (!applicableClusterIds.has(proposalCluster.id)) continue;
        const assignment = required(clusterAssignmentById.get(proposalCluster.id));
        if (assignment.action === "KEEP") continue;
        if (assignment.action === "EXISTING") {
          appliedClusterByProposalId.set(
            proposalCluster.id,
            required(assignment.clusterId)
          );
          continue;
        }
        const name = uniqueName(
          targetNameByProposalCluster.get(proposalCluster.id) ?? proposalCluster.name,
          usedClusterNames
        );
        const created = await transaction.cluster.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            name,
            method,
            evidence: {
              source: "ARSENKIN",
              jobId: proposal.jobId,
              proposalId: proposal.id,
              proposalClusterId: proposalCluster.id,
              connectorVersion: proposal.connectorVersion,
              providerKey: proposalCluster.providerKey,
              topUrl: proposalCluster.topUrl,
              topUrls: proposalCluster.topUrls,
              frequencySum: proposalCluster.frequencySum?.toString(),
              overlapCount: parameters.overlapCount,
              depth: parameters.depth
            }
          }
        });
        usedClusterNames.add(normalizedName(name));
        appliedClusterByProposalId.set(proposalCluster.id, created.id);
        clusterChangeRows.push({
          entityId: created.id,
          operation: "CREATE",
          beforeState: null,
          afterState: clusterState(created, method),
          beforeVersion: null,
          afterVersion: created.version
        });
      }

      const unclusteredItems = applicableItems.filter(({ proposalClusterId }) => !proposalClusterId);
      const automaticUnclusteredItems = unclusteredItems.filter(
        ({ keywordId }) => !groupOverrideByKeywordId.has(keywordId)
      );
      const needsUnclusteredGroup =
        input.folderMode === "CREATE_SUBGROUPS" &&
        input.createUnclusteredGroup &&
        automaticUnclusteredItems.length > 0;
      const newFolderProposalClusterIds = new Set(
        [...applicableClusterIds].filter(
          (proposalClusterId) => {
            const decision = clusterFolderOverrideById.get(proposalClusterId);
            return !decision || decision.action === "NEW";
          }
        )
      );
      const groupsToCreate = input.folderMode === "CREATE_SUBGROUPS"
        ? newFolderProposalClusterIds.size + (needsUnclusteredGroup ? 1 : 0)
        : 0;
      if (input.folderMode === "CREATE_SUBGROUPS") {
        await assertFolderCapacity(
          transaction,
          input.workspaceId,
          input.projectId,
          groupsToCreate,
          input.entitlement.foldersPerProject,
          input.entitlement.planCode,
          input.entitlement.planVersion
        );
      }
      const groupByProposalCluster = new Map<string, string>();
      let unclusteredGroupId: string | undefined;
      if (input.folderMode === "CREATE_SUBGROUPS" && groupsToCreate > 0) {
        const parentIdByProposalCluster = new Map(
          [...newFolderProposalClusterIds].map((proposalClusterId) => {
            const decision = clusterFolderOverrideById.get(proposalClusterId);
            return [
              proposalClusterId,
              decision?.action === "NEW"
                ? decision.parentGroupId ?? input.parentGroupId
                : input.parentGroupId
            ] as const;
          })
        );
        const parentIds = [...new Set([
          ...parentIdByProposalCluster.values(),
          ...(needsUnclusteredGroup ? [input.parentGroupId] : [])
        ].filter((value): value is string => Boolean(value)))];
        const needsRootSiblings =
          [...parentIdByProposalCluster.values()].some((value) => !value) ||
          (needsUnclusteredGroup && !input.parentGroupId);
        const siblingParentWhere: Prisma.KeywordGroupWhereInput[] = [];
        if (needsRootSiblings) siblingParentWhere.push({ parentId: null });
        if (parentIds.length > 0) siblingParentWhere.push({ parentId: { in: parentIds } });
        const siblings = await transaction.keywordGroup.findMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            status: "ACTIVE",
            systemKind: null,
            OR: siblingParentWhere
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { name: true, parentId: true, position: true }
        });
        const usedGroupNamesByParent = new Map<string, Set<string>>();
        const nextPositionByParent = new Map<string, number>();
        for (const sibling of siblings) {
          const parentKey = sibling.parentId ?? "";
          const names = usedGroupNamesByParent.get(parentKey) ?? new Set<string>();
          names.add(normalizedName(sibling.name));
          usedGroupNamesByParent.set(parentKey, names);
          nextPositionByParent.set(
            parentKey,
            Math.max(nextPositionByParent.get(parentKey) ?? 0, sibling.position + 1)
          );
        }
        for (const proposalCluster of proposal.clusters) {
          if (
            !applicableClusterIds.has(proposalCluster.id) ||
            !newFolderProposalClusterIds.has(proposalCluster.id)
          ) continue;
          const parentId = parentIdByProposalCluster.get(proposalCluster.id);
          const parent = parentId ? availableGroupById.get(parentId) : undefined;
          const parentKey = parentId ?? "";
          const usedGroupNames = usedGroupNamesByParent.get(parentKey) ?? new Set<string>();
          const groupName = uniqueName(
            targetNameByProposalCluster.get(proposalCluster.id) ?? proposalCluster.name,
            usedGroupNames
          );
          const path = parentPath(parent ?? undefined, groupName);
          const color = GROUP_COLORS[proposalCluster.sequence % GROUP_COLORS.length] ?? GROUP_COLORS[0];
          const position = nextPositionByParent.get(parentKey) ?? 0;
          const group = await transaction.keywordGroup.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              ...(parent ? { parentId: parent.id } : {}),
              name: groupName,
              path,
              pathHash: sha256(path),
              color,
              position
            }
          });
          nextPositionByParent.set(parentKey, position + 1);
          usedGroupNames.add(normalizedName(groupName));
          usedGroupNamesByParent.set(parentKey, usedGroupNames);
          groupByProposalCluster.set(proposalCluster.id, group.id);
        }
        if (needsUnclusteredGroup) {
          const parentId = input.parentGroupId;
          const parent = parentId ? availableGroupById.get(parentId) : undefined;
          const parentKey = parentId ?? "";
          const usedGroupNames = usedGroupNamesByParent.get(parentKey) ?? new Set<string>();
          const groupName = uniqueName("Некластеризовано", usedGroupNames);
          const path = parentPath(parent ?? undefined, groupName);
          const position = nextPositionByParent.get(parentKey) ?? 0;
          const group = await transaction.keywordGroup.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              ...(parent ? { parentId: parent.id } : {}),
              name: groupName,
              path,
              pathHash: sha256(path),
              color: "#94a3b8",
              position
            }
          });
          usedGroupNames.add(normalizedName(groupName));
          usedGroupNamesByParent.set(parentKey, usedGroupNames);
          nextPositionByParent.set(parentKey, position + 1);
          unclusteredGroupId = group.id;
        }
      }
      for (const [proposalClusterId, override] of clusterFolderOverrideById) {
        if (override.action === "EXISTING" && override.groupId) {
          groupByProposalCluster.set(proposalClusterId, override.groupId);
        }
      }

      const keywordChanges: SemanticKeywordChange[] = [];
      const memberships: { projectId: string; keywordId: string; groupId: string }[] = [];
      const movedKeywordIds: string[] = [];
      const appliedItemIds: string[] = [];
      for (const item of applicableItems) {
        const current = currentById.get(item.keywordId);
        if (!current) continue;
        const clusterId = item.proposalClusterId
          ? appliedClusterByProposalId.get(item.proposalClusterId)
          : undefined;
        const explicitGroupId = groupOverrideByKeywordId.get(item.keywordId);
        const clusterFolderOverride = item.proposalClusterId
          ? clusterFolderOverrideById.get(item.proposalClusterId)
          : undefined;
        const groupId = explicitGroupId ?? (clusterFolderOverride?.action === "KEEP"
          ? undefined
          : item.proposalClusterId
            ? groupByProposalCluster.get(item.proposalClusterId)
            : unclusteredGroupId);
        const clusterChanged = Boolean(clusterId && clusterId !== current.clusterId);
        const currentGroupIds = current.memberships.map(({ groupId: id }) => id);
        const groupChanged = Boolean(
          groupId && (currentGroupIds.length !== 1 || currentGroupIds[0] !== groupId)
        );
        if (!clusterChanged && !groupChanged) continue;
        const beforeState = keywordState(current);
        const updated = await transaction.keyword.update({
          where: {
            workspaceId_projectId_id: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              id: current.id
            }
          },
          data: {
            ...(clusterChanged && clusterId ? { clusterId } : {}),
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
        if (groupChanged && groupId) {
          memberships.push({ projectId: input.projectId, keywordId: current.id, groupId });
          movedKeywordIds.push(current.id);
        }
        keywordChanges.push({
          entityId: current.id,
          operation: "UPDATE",
          beforeState,
          afterState: {
            ...beforeState,
            clusterId: clusterChanged && clusterId ? clusterId : beforeState.clusterId,
            groupId: groupChanged && groupId ? groupId : beforeState.groupId
          },
          beforeVersion: current.version,
          afterVersion: updated.version
        });
        appliedItemIds.push(item.id);
      }
      for (const batch of chunked(movedKeywordIds, ITEM_WRITE_BATCH)) {
        await transaction.keywordGroupMembership.deleteMany({
          where: { projectId: input.projectId, keywordId: { in: batch } }
        });
      }
      for (const batch of chunked(memberships, ITEM_WRITE_BATCH)) {
        await transaction.keywordGroupMembership.createMany({ data: batch, skipDuplicates: true });
      }
      for (const proposalClusterId of applicableClusterIds) {
        const itemIds = applicableItemIdsByProposalCluster.get(proposalClusterId) ?? [];
        if (itemIds.length === 0) continue;
        const appliedClusterId = appliedClusterByProposalId.get(proposalClusterId);
        const appliedGroupId = groupByProposalCluster.get(proposalClusterId);
        if (!appliedClusterId && !appliedGroupId) continue;
        await transaction.clusteringProposalItem.updateMany({
          where: { id: { in: itemIds } },
          data: {
            ...(appliedClusterId ? { appliedClusterId } : {}),
            ...(appliedGroupId
              ? { appliedGroupId }
              : {})
          }
        });
        await transaction.clusteringProposalCluster.update({
          where: { id: proposalClusterId },
          data: {
            ...(appliedClusterId ? { appliedClusterId } : {}),
            ...(appliedGroupId
              ? { appliedGroupId }
              : {})
          }
        });
      }
      if (unclusteredGroupId && unclusteredItems.length > 0) {
        await transaction.clusteringProposalItem.updateMany({
          where: { id: { in: unclusteredItems.map(({ id }) => id) } },
          data: { appliedGroupId: unclusteredGroupId }
        });
      }
      for (const [groupId, keywordIds] of groupKeywordOverrides(
        input.keywordGroupOverrides
      )) {
        const itemIds = applicableItems
          .filter((item) => keywordIds.has(item.keywordId))
          .map(({ id }) => id);
        for (const batch of chunked(itemIds, ITEM_WRITE_BATCH)) {
          await transaction.clusteringProposalItem.updateMany({
            where: { id: { in: batch } },
            data: { appliedGroupId: groupId }
          });
        }
      }

      const semanticVersionIds: string[] = [];
      const allChanges: Array<
        | { readonly kind: "CLUSTER"; readonly change: SemanticClusterChange }
        | { readonly kind: "KEYWORD"; readonly change: SemanticKeywordChange }
      > = [
        ...clusterChangeRows.map((change) => ({ kind: "CLUSTER" as const, change })),
        ...keywordChanges.map((change) => ({ kind: "KEYWORD" as const, change }))
      ];
      for (const batch of chunked(allChanges, VERSION_CHANGE_BATCH)) {
        const version = await this.semanticVersions.createWithChanges(
          transaction,
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            actorId: input.actorId,
            reason: "CLUSTER_BULK_UPDATE",
            summary: `Применена кластеризация Arsenkin (${proposal.jobId})`
          },
          batch.flatMap((entry) => entry.kind === "KEYWORD" ? [entry.change] : []) as SemanticKeywordChange[],
          batch.flatMap((entry) => entry.kind === "CLUSTER" ? [entry.change] : []) as SemanticClusterChange[]
        );
        if (version) semanticVersionIds.push(version.id);
      }
      const settled = await transaction.clusteringProposal.update({
        where: { id: proposal.id },
        data: {
          status: "APPLIED",
          appliedKeywordCount: appliedItemIds.length,
          createdGroupCount: groupsToCreate,
          semanticVersionIds,
          appliedBy: input.actorId,
          appliedAt: new Date(),
          version: { increment: 1 }
        }
      });
      const skippedKeywordCount = proposal.keywordCount - appliedItemIds.length;
      const conflictedKeywordCount = proposal.items.filter((item) => {
        const current = currentById.get(item.keywordId);
        const state = itemState(item, current, proposal.status);
        return state === "CONFLICTED" || state === "UNAVAILABLE";
      }).length;
      return {
        proposal: this.summary(settled, 0, 0, conflictedKeywordCount),
        createdClusterCount: clusterChangeRows.length,
        createdGroupCount: groupsToCreate,
        appliedKeywordCount: appliedItemIds.length,
        skippedKeywordCount,
        conflictedKeywordCount,
        semanticVersionIds
      };
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  public async reject(
    input: InternalRejectClusteringProposalInput
  ): Promise<ClusteringProposalSummary> {
    return this.prisma.$transaction(async (transaction) => {
      await lockClusteringProposal(transaction, input.jobId);
      const proposal = await transaction.clusteringProposal.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          jobId: input.jobId
        }
      });
      if (!proposal) throw new NotFoundException("Clustering proposal not found");
      if (proposal.status === "REJECTED") return this.summary(proposal, 0, 0, 0);
      if (proposal.status !== "READY") throw proposalAlreadySettled();
      if (proposal.version !== input.proposalVersion) throw proposalVersionConflict(proposal.version);
      const updated = await transaction.clusteringProposal.update({
        where: { id: proposal.id },
        data: {
          status: "REJECTED",
          rejectedBy: input.actorId,
          rejectedAt: new Date(),
          version: { increment: 1 }
        }
      });
      return this.summary(updated, 0, 0, 0);
    }, { maxWait: 5_000, timeout: 15_000 });
  }

  private async currentKeywords(
    workspaceId: string,
    projectId: string,
    keywordIds: readonly string[]
  ): Promise<readonly CurrentKeyword[]> {
    if (keywordIds.length === 0) return [];
    return this.prisma.keyword.findMany({
      where: { workspaceId, projectId, id: { in: [...keywordIds] } },
      include: CURRENT_KEYWORD_INCLUDE
    });
  }

  private summary(
    proposal: Readonly<{
      id: string;
      jobId: string;
      status: "READY" | "APPLIED" | "REJECTED";
      keywordCount: number;
      clusterCount: number;
      unclusteredCount: number;
      appliedKeywordCount: number;
      createdGroupCount: number;
      semanticVersionIds: unknown;
      version: number;
      createdAt: Date;
      updatedAt: Date;
      appliedAt: Date | null;
      rejectedAt: Date | null;
    }>,
    readyCount: number,
    protectedCount: number,
    conflictedCount: number
  ): ClusteringProposalSummary {
    return {
      id: proposal.id,
      jobId: proposal.jobId,
      status: proposal.status,
      keywordCount: proposal.keywordCount,
      clusterCount: proposal.clusterCount,
      unclusteredCount: proposal.unclusteredCount,
      readyCount,
      protectedCount,
      conflictedCount,
      appliedKeywordCount: proposal.appliedKeywordCount,
      createdGroupCount: proposal.createdGroupCount,
      semanticVersionIds: stringArray(proposal.semanticVersionIds),
      version: proposal.version,
      createdAt: proposal.createdAt.toISOString(),
      updatedAt: proposal.updatedAt.toISOString(),
      ...(proposal.appliedAt ? { appliedAt: proposal.appliedAt.toISOString() } : {}),
      ...(proposal.rejectedAt ? { rejectedAt: proposal.rejectedAt.toISOString() } : {})
    };
  }
}

function proposalRow(
  item: Prisma.ClusteringProposalItemGetPayload<{ include: { proposalCluster: true } }>,
  current: CurrentKeyword | undefined,
  currentClusterKeywordCount: number,
  proposalStatus: "READY" | "APPLIED" | "REJECTED"
): ClusteringProposalResultRow {
  const state = itemState(
    item,
    current,
    proposalStatus
  );
  return {
    sequence: item.sequence,
    keywordId: item.keywordId,
    keyword: item.keywordText,
    state,
    ...(state === "CONFLICTED"
      ? { conflictReason: itemConflictReason(item, current) }
      : {}),
    ...(current?.cluster?.status === "ACTIVE" ? { currentClusterName: current.cluster.name } : {}),
    ...(item.proposalCluster
      ? {
          proposedCluster: proposalClusterSummary(
            item.proposalCluster,
            currentClusterKeywordCount
          )
        }
      : {}),
    ...(item.frequency === null ? {} : { frequency: item.frequency.toString() }),
    ...(item.exactFrequency === null ? {} : { exactFrequency: item.exactFrequency.toString() }),
    ...(item.aggregatorsPercent === null ? {} : { aggregatorsPercent: item.aggregatorsPercent }),
    ...(item.toponym ? { toponym: item.toponym } : {}),
    ...(item.geoDependent === null ? {} : { geoDependent: item.geoDependent })
  };
}

function proposalSectionRow(
  item: Prisma.ClusteringProposalItemGetPayload<{
    include: { proposalCluster: true };
  }>,
  current: CurrentKeyword | undefined,
  proposalStatus: "READY" | "APPLIED" | "REJECTED"
): ClusteringProposalResultRow {
  const { proposedCluster: _proposedCluster, ...row } = proposalRow(
    item,
    current,
    0,
    proposalStatus
  );
  return row;
}

function itemConflictReason(
  item: Readonly<{ keywordVersion: number }>,
  current: CurrentKeyword | undefined
): ClusteringProposalConflictReason {
  if (current && current.version !== item.keywordVersion) return "KEYWORD_CHANGED";
  throw new Error("Clustering conflict reason requested for a non-conflicted item");
}

function proposalClusterSummary(
  cluster: Readonly<{
    id: string;
    sequence: number;
    name: string;
    keywordCount: number;
    topUrl: string | null;
    topUrls: Prisma.JsonValue;
    frequencySum: bigint | null;
    mainPageCount: number | null;
  }>,
  currentClusterKeywordCount: number
) {
  return {
    id: cluster.id,
    sequence: cluster.sequence,
    name: cluster.name,
    keywordCount: cluster.keywordCount,
    currentClusterKeywordCount,
    ...(cluster.topUrl ? { topUrl: cluster.topUrl } : {}),
    topUrls: proposalTopUrls(cluster.topUrls),
    ...(cluster.frequencySum === null
      ? {}
      : { frequencySum: cluster.frequencySum.toString() }),
    ...(cluster.mainPageCount === null
      ? {}
      : { mainPageCount: cluster.mainPageCount })
  };
}

function itemState(
  item: Readonly<{
    keywordVersion: number;
    proposalClusterId: string | null;
    appliedClusterId: string | null;
    appliedGroupId: string | null;
  }>,
  current: CurrentKeyword | undefined,
  proposalStatus: "READY" | "APPLIED" | "REJECTED"
): ClusteringProposalItemState {
  if (!current || current.status !== "ACTIVE") return "UNAVAILABLE";
  if (
    proposalStatus === "APPLIED" &&
    (item.appliedGroupId !== null ||
      (item.appliedClusterId !== null && current.clusterId === item.appliedClusterId))
  ) return "UNCHANGED";
  if (current.version !== item.keywordVersion) return "CONFLICTED";
  if (current.cluster?.status === "ACTIVE" && current.cluster.isLocked) return "LOCKED";
  if (current.cluster?.status === "ACTIVE" && current.cluster.excludeFromReclustering) return "EXCLUDED";
  return "READY";
}

function validateApplySelection(
  proposal: ApplyProposal,
  input: InternalApplyClusteringProposalInput
): void {
  const ids = new Set(proposal.clusters.map(({ id }) => id));
  if (
    input.excludedClusterIds.some((id) => !ids.has(id)) ||
    input.clusterNameOverrides.some(({ proposalClusterId }) => !ids.has(proposalClusterId)) ||
    input.clusterAssignmentOverrides.some(({ proposalClusterId }) => !ids.has(proposalClusterId)) ||
    input.clusterFolderOverrides.some(({ proposalClusterId }) => !ids.has(proposalClusterId))
  ) throw new ConflictException("Clustering proposal selection is stale");
  const keywordIds = new Set(proposal.items.map(({ keywordId }) => keywordId));
  if (input.keywordGroupOverrides.some(({ keywordId }) => !keywordIds.has(keywordId))) {
    throw new ConflictException("Clustering proposal keyword selection is stale");
  }
  if (input.folderMode === "NONE" && (input.parentGroupId || input.createUnclusteredGroup)) {
    throw new ConflictException("Folder settings require subgroup creation");
  }
  if (
    input.folderMode === "NONE" &&
    input.clusterFolderOverrides.some(({ action }) => action === "NEW")
  ) {
    throw new ConflictException("New cluster folders require subgroup creation");
  }
}

function groupKeywordOverrides(
  overrides: readonly Readonly<{ keywordId: string; groupId: string }>[]
): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  for (const { keywordId, groupId } of overrides) {
    const keywordIds = result.get(groupId) ?? new Set<string>();
    keywordIds.add(keywordId);
    result.set(groupId, keywordIds);
  }
  return result;
}

function keywordState(keyword: CurrentKeyword): SemanticKeywordVersionState {
  return {
    textOriginal: keyword.textOriginal,
    textNormalized: keyword.textNormalized,
    normalizedHash: keyword.normalizedHash,
    language: keyword.language,
    priority: keyword.priority,
    isFavorite: keyword.isFavorite,
    isTracked: keyword.isTracked,
    intent: keyword.intent,
    status: keyword.status === "DELETED" ? "DELETED" : "ACTIVE",
    clusterId: keyword.clusterId,
    targetPageId: keyword.targetPageId,
    groupId: keyword.memberships[0]?.groupId ?? null,
    tagIds: keyword.tags.map(({ tagId }) => tagId)
  };
}

function clusterState(
  cluster: Readonly<{
    name: string;
    status: "ACTIVE" | "ARCHIVED" | "DELETED";
    primaryPageId: string | null;
    pageMappingSource: string | null;
    pageMappingConfidence: number | null;
    pageMappingRationale: string | null;
    isLocked: boolean;
    excludeFromReclustering: boolean;
  }>,
  method: SemanticClusterMethod
): SemanticClusterVersionState {
  return {
    name: cluster.name,
    method,
    status: cluster.status === "DELETED" ? "DELETED" : "ACTIVE",
    primaryPageId: cluster.primaryPageId,
    pageMappingSource: null,
    pageMappingConfidence: cluster.pageMappingConfidence,
    pageMappingRationale: cluster.pageMappingRationale,
    isLocked: cluster.isLocked,
    excludeFromReclustering: cluster.excludeFromReclustering
  };
}

function semanticClusterMethod(method: "SOFT" | "HARD"): SemanticClusterMethod {
  return method === "SOFT" ? "ARSENKIN_SOFT" : "ARSENKIN_HARD";
}

function proposalParameters(value: unknown): {
  readonly method: "SOFT" | "HARD";
  readonly overlapCount: number;
  readonly depth: 10 | 20 | 30;
  readonly replaceExistingClusters: boolean;
} {
  const input = object(value);
  if (
    (input.method !== "SOFT" && input.method !== "HARD") ||
    !Number.isSafeInteger(input.overlapCount) ||
    Number(input.overlapCount) < 2 ||
    Number(input.overlapCount) > 10 ||
    ![10, 20, 30].includes(Number(input.depth)) ||
    typeof input.replaceExistingClusters !== "boolean"
  ) throw new Error("Invalid clustering proposal parameters");
  return {
    method: input.method,
    overlapCount: Number(input.overlapCount),
    depth: Number(input.depth) as 10 | 20 | 30,
    replaceExistingClusters: input.replaceExistingClusters
  };
}

async function assertFolderCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  additional: number,
  limit: number,
  planCode: string,
  planVersion: number
): Promise<void> {
  if (additional === 0 || limit === 0) return;
  const current = await transaction.keywordGroup.count({
    where: { workspaceId, projectId, status: "ACTIVE", systemKind: null }
  });
  if (current + additional <= limit) return;
  throw new HttpException({
    error: {
      code: "QUOTA_EXCEEDED",
      message: "The foldersPerProject limit for the current plan would be exceeded",
      details: { resource: "foldersPerProject", current, additional, limit, planCode, planVersion }
    }
  }, HttpStatus.CONFLICT);
}

async function lockGroupTree(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-group-tree:${projectId}`}, 0)
    )
  `;
}

async function lockClusteringProposal(
  transaction: Prisma.TransactionClient,
  jobId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`clustering-proposal:${jobId}`}, 0)
    )
  `;
}

async function lockClusterSet(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`semantic-cluster-set:${projectId}`}, 0)
    )
  `;
}

function parentPath(
  parent: Readonly<{ path: string | null; name: string }> | undefined,
  name: string
): string {
  return parent ? `${parent.path ?? parent.name} / ${name}` : name;
}

function uniqueName(base: string, used: Set<string>): string {
  const boundedBase = base.slice(0, 255).trim() || "Кластер";
  if (!used.has(normalizedName(boundedBase))) return boundedBase;
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const marker = ` (${suffix})`;
    const candidate = `${boundedBase.slice(0, 255 - marker.length).trim()}${marker}`;
    if (!used.has(normalizedName(candidate))) return candidate;
  }
  throw new ConflictException("Unable to allocate a unique clustering name");
}

function normalizedName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Invalid clustering proposal versions");
  }
  return value;
}

function proposalTopUrls(value: unknown): readonly Readonly<{
  url: string;
  overlapCount?: number;
}>[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("Invalid clustering proposal top URLs");
  }
  return value.map((candidate) => {
    const item = object(candidate);
    if (
      typeof item.url !== "string" ||
      item.url.length > 8_192 ||
      (item.overlapCount !== undefined &&
        (!Number.isSafeInteger(item.overlapCount) || Number(item.overlapCount) < 0))
    ) {
      throw new Error("Invalid clustering proposal top URL");
    }
    let parsed: URL;
    try {
      parsed = new URL(item.url);
    } catch {
      throw new Error("Invalid clustering proposal top URL");
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("Invalid clustering proposal top URL");
    }
    return {
      url: parsed.toString(),
      ...(item.overlapCount === undefined
        ? {}
        : { overlapCount: Number(item.overlapCount) })
    };
  });
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid clustering proposal record");
  }
  return value as Readonly<Record<string, unknown>>;
}

function chunked<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Clustering proposal cluster mapping is incomplete");
  return value;
}

function assertProposalScope(
  proposal: Readonly<{ workspaceId: string; projectId: string }>,
  workspaceId: string,
  projectId: string
): void {
  if (proposal.workspaceId !== workspaceId || proposal.projectId !== projectId) {
    throw new ConflictException("Clustering proposal job ID belongs to another project");
  }
}

function unique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function keywordUnavailable(): HttpException {
  return new HttpException(
    { code: "KEYWORD_NOT_AVAILABLE", message: "A clustering keyword is not active in this project" },
    HttpStatus.CONFLICT
  );
}

function keywordVersionConflict(currentVersion: number): HttpException {
  return new HttpException(
    { code: "KEYWORD_VERSION_CONFLICT", message: "A clustering keyword changed", currentVersion },
    HttpStatus.PRECONDITION_FAILED
  );
}

function proposalAlreadySettled(): HttpException {
  return new HttpException(
    { code: "RESOURCE_STATE_CONFLICT", message: "Clustering proposal is already settled" },
    HttpStatus.CONFLICT
  );
}

function proposalVersionConflict(currentVersion: number): HttpException {
  return new HttpException(
    { code: "VERSION_CONFLICT", message: "Clustering proposal version conflict", currentVersion },
    HttpStatus.PRECONDITION_FAILED
  );
}
