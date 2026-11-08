/** Sends a player's request to the GM's client (see core/turns.ts). */
import OBR from "@owlbear-rodeo/sdk";
import { splitMessage } from "../core/chunks";
import { REQUEST_CHANNEL, REQUEST_CHUNK_CHANNEL, type PlayerRequest } from "../core/turns";

type Body<T> = T extends unknown ? Omit<T, "v" | "playerId" | "playerName"> : never;

/** Players send to the others (the GM's client applies it); a GM sends to everyone, its own background included. */
export async function sendRequest(body: Body<PlayerRequest>, role: "GM" | "PLAYER" = "PLAYER") {
  const req = { v: 1, playerId: OBR.player.id, playerName: await OBR.player.getName(), ...body } as PlayerRequest;
  const destination = role === "GM" ? "ALL" : "REMOTE";
  // Big requests (a synced sheet) go in chunks: Owlbear broadcasts are limited to 16 kB.
  if (JSON.stringify(req).length > 14_000) {
    for (const c of splitMessage(globalThis.crypto.randomUUID(), req)) await OBR.broadcast.sendMessage(REQUEST_CHUNK_CHANNEL, c, { destination });
  } else {
    await OBR.broadcast.sendMessage(REQUEST_CHANNEL, req, { destination });
  }
}
