export interface ResponseMeta {
  readonly requestId: string;
  readonly version?: number;
}

export interface ApiResponse<Data> {
  readonly data: Data;
  readonly meta: ResponseMeta;
}

export interface CursorPage {
  readonly nextCursor?: string;
  readonly hasNext: boolean;
  readonly totalApprox?: number;
}

export interface ApiCollectionResponse<Data> {
  readonly data: readonly Data[];
  readonly page: CursorPage;
  readonly meta: ResponseMeta;
}
