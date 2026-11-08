/** Sends a player's request to the GM's client (see core/turns.ts). */
import OBR from "@owlbear-rodeo/sdk";
import { REQUEST_CHANNEL, type PlayerRequest } from "../core/turns";

type Body<T> = T extends unknown ? Omit<T, "v" | "playerId" | "playerName"> : never;

/** Players send to the others (the GM's client applies it); a GM sends to everyone, its own background included. */
export async function sendRequest(body: Body<PlayerRequest>, role: "GM" | "PLAYER" = "PLAYER") {
  const req = { v: 1, playerId: OBR.player.id, playerName: await OBR.player.getName(), ...body } as PlayerRequest;
  await OBR.broadcast.sendMessage(REQUEST_CHANNEL, req, { destination: role === "GM" ? "ALL" : "REMOTE" });
}
