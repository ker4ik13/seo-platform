import type {
  ApiCollectionResponse,
  ApiResponse
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";

export function apiResponse<Data>(
  request: FastifyRequest,
  data: Data,
  version?: number
): ApiResponse<Data> {
  return {
    data,
    meta: {
      requestId: request.id,
      ...(version === undefined ? {} : { version })
    }
  };
}

export function collectionResponse<Data>(
  request: FastifyRequest,
  data: readonly Data[]
): ApiCollectionResponse<Data> {
  return {
    data,
    page: {
      hasNext: false,
      totalApprox: data.length
    },
    meta: {
      requestId: request.id
    }
  };
}
