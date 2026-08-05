import type {
  ApiCollectionResponse,
  ApiResponse,
  CursorPage
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
  data: readonly Data[],
  page?: CursorPage
): ApiCollectionResponse<Data> {
  return {
    data,
    page: page ?? {
      hasNext: false,
      totalApprox: data.length
    },
    meta: {
      requestId: request.id
    }
  };
}
