/** The D&D Beyond bookmark ("Copy party for Encounter Butler") and the message it posts back, shared by the GM's party tab and the player view. */
import bookmarkletSource from "../../scripts/ddb-export.browser.js?raw";
import { h } from "./dom";

export const DDB_ORIGIN = "https://www.dndbeyond.com";
export const DDB_MSG_TYPE = "encounter-butler/ddb-export";

/** On a campaign page it exports the party; on a character page, that character. It posts only to this extension's origin. */
export const BOOKMARKLET = `javascript:${encodeURIComponent(`(async()=>{${bookmarkletSource}\nawait ddbExport(undefined,{targetOrigin:${JSON.stringify(location.origin)}});})()`)}`;

export const bookmarkButton = () =>
  h("a", { className: "bookmarklet", href: BOOKMARKLET, onclick: (e: Event) => e.preventDefault(), title: "Drag me to the bookmarks bar" }, "⭳ Copy party for Encounter Butler");

/** Calls `fn` with each export the bookmark posts back from D&D Beyond. */
export function onDdbExport(fn: (bundle: unknown) => void) {
  window.addEventListener("message", (e) => {
    if (e.origin !== DDB_ORIGIN || e.data?.type !== DDB_MSG_TYPE) return;
    fn(e.data.bundle);
  });
}
