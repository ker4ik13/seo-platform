import { relayObjectStorageUpload } from "../../../../lib/storage-upload-relay";

export const dynamic = "force-dynamic";

export function PUT(request: Request): Promise<Response> {
  return relayObjectStorageUpload(request);
}
