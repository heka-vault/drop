/// <reference lib="dom" />
// The redeem page's script. It reads the link secret from the URL fragment, clears it from the
// address bar at once, and only talks to the server when the recipient clicks Reveal. All crypto
// is in envelope.js, which the tests cover; this file is the thin DOM layer around it.
import { open, revealToken } from "./envelope.js";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const status = el("status");
const button = /** @type {HTMLButtonElement} */ (el("reveal"));

async function main() {
  const secret = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const id = location.pathname.split("/")[2];

  let token;
  try {
    token = await revealToken(secret);
  } catch {
    status.textContent = "This link is incomplete. Ask the sender for the full link.";
    return;
  }

  button.disabled = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Revealing…";
    const res = await fetch(`/d/${encodeURIComponent(id)}/reveal`, {
      method: "POST",
      headers: { "x-drop-reveal": "1" },
      body: token,
      cache: "no-store",
    }).catch(() => null);
    if (!res) {
      status.textContent = "Could not reach the server. Nothing was used up; try again.";
      button.disabled = false;
      return;
    }
    if (!res.ok) {
      status.textContent = res.status === 404
        ? "This drop is gone: it was already opened, revoked, or it expired."
        : "Something went wrong. The drop may already have been used.";
      return;
    }
    try {
      const { meta, content } = await open(new Uint8Array(await res.arrayBuffer()), secret);
      if (meta.kind === "text") {
        const pre = el("secret");
        pre.textContent = new TextDecoder().decode(content);
        pre.hidden = false;
      } else {
        const link = /** @type {HTMLAnchorElement} */ (el("download"));
        link.href = URL.createObjectURL(new Blob([content], { type: "application/octet-stream" }));
        link.download = meta.name; // open() only accepts plain, single-segment names
        link.textContent = `Download ${link.download}`;
        link.hidden = false;
      }
      status.textContent =
        "Revealed. It has been deleted from the server if this was its last open.";
    } catch {
      status.textContent = "This drop could not be decrypted. The link may be damaged.";
    }
    button.hidden = true;
  });
}

main();
