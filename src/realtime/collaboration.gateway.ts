import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway
} from "@nestjs/websockets";
import type { Socket } from "socket.io";

interface JoinPresenceMessage {
  readonly projectId?: string;
}

interface RealtimeError {
  readonly ok: false;
  readonly error: {
    readonly code: "AUTH_NOT_IMPLEMENTED";
    readonly message: string;
  };
}

@WebSocketGateway({
  namespace: "/collaboration",
  transports: ["websocket"]
})
export class CollaborationGateway {
  @SubscribeMessage("presence.join")
  public joinPresence(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _message: JoinPresenceMessage
  ): RealtimeError {
    for (const room of socket.rooms) {
      if (room !== socket.id) socket.leave(room);
    }
    return {
      ok: false,
      error: {
        code: "AUTH_NOT_IMPLEMENTED",
        message: "Project rooms are closed until token and role checks are enabled"
      }
    };
  }
}
